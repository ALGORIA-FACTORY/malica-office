import type { FiscalCharge } from "@malica/socle/ports/repositories";
import { enUnitesExactes } from "@malica/socle/somme-decimale";
import { lignesQualifiees } from "./qualification-fiscale.ts";
import { appliquerAttentesFiscales } from "@malica/socle/engines/fiscalite/profil";
import { fiscaliteDuDossier } from "./fiscalite-du-dossier.ts";
/**
 * 3B-6 — La proposition d'écriture, calculée côté serveur.
 *
 * Jusqu'au 18 septembre 2026, le navigateur composait l'écriture : il relisait
 * l'extraction, appliquait les taux, posait les comptes, puis envoyait les
 * lignes à l'API, qui les enregistrait telles quelles. Désormais le serveur la
 * calcule, depuis ce qu'il a lui-même jugé :
 *
 *   • pas d'écriture pour une pièce que le verdict ne déclare pas
 *     comptabilisable — le refus porte les motifs du verdict ;
 *   • les montants sont ceux IMPRIMÉS et normalisés (analyse.ts), jamais ceux
 *     que le solveur de la lecture a posés dans l'extraction ;
 *   • décimales et seuils viennent du paramétrage daté, pas d'une table de
 *     devises ni de constantes ;
 *   • le moteur est le même : `buildProposal` du socle.
 *
 * Le navigateur des versions installées calcule encore de son côté ; les
 * nouvelles demandent `office.propositionDePiece`, puis `office.proposerDepuisPiece`
 * enregistre sans qu'aucune ligne ne transite par le client.
 */

import type { PropositionDePiece } from "@malica/socle/ports/repositories";
import { buildProposal, LectureIncomplete } from "@malica/socle/use-cases/propose-ecriture";
import { autoriseUneEcriture, codeDuVerdict } from "@malica/socle/verdicts";

import type { Requete } from "../db.ts";
import { enDecimal } from "../malica/lecture/montants.ts";
import { dateDeLaPiece } from "../depots/dates.ts";
import { referentiel } from "../depots/referentiel.ts";

import { analyserPiece, lireParametres } from "./analyse.ts";
import { tvaDeBase, type ResultatNormalisation } from "./normaliser-montants.ts";

type SensConnu = { documentKind: "facture_achat" | "facture_vente" };
const sensConnu = (k: string): k is SensConnu["documentKind"] =>
  k === "facture_achat" || k === "facture_vente";

// La liste vivait ici, en phrases francaises. Elle vit au Socle, avec son
// epreuve, parce que les deux rives en ont besoin — celle qui inscrit et
// celle qui affiche. Un verdict inconnu n autorise rien.

// Le type de la réponse vit au Socle, avec le port qui la sert : il était
// recopié ici à l'identique, et la copie aurait dérivé au premier champ ajouté
// (ANO-025 : `champsAVerifier`).
export type { PropositionDePiece };

/*
 * `enDecimal` vivait ici en double : même signature, même sémantique, deux
 * implémentations. La première qui aurait corrigé un cas limite aurait laissé
 * l'autre en arrière — et c'est celle-ci qui écrit l'écriture comptable.
 * Elle vient désormais de la lecture, où elle est éprouvée.
 */

/**
 * Le compte de la nature de la charge, ou rien.
 *
 * Recette du 20 octobre 2026 : honoraires, loyer, électricité partaient tous
 * au 601, parce que l'imputation venait du seul SENS de la pièce. La nature,
 * elle, se lit sur le libellé de chaque article (`piece_articles_v`), et
 * `ref.charge_familles` porte son compte depuis le 7 octobre.
 *
 * Trois conditions, sinon on garde le paramétrage :
 *   • tous les articles tombent dans la MÊME nature — une pièce mêlée ne se
 *     range pas d'un seul compte ;
 *   • aucun n'est au repli (« non classé ») : ne pas savoir n'est pas savoir ;
 *   • le compte de la nature est de la même CLASSE que celui du paramétrage —
 *     une nature de charge ne s'applique pas à une vente.
 */
async function compteDeLaNature(db: Requete, pieceId: string): Promise<string | null> {
  const { rows } = await db.query<{ compte: string | null }>(
    `with a as (
       select a.famille_code, a.pack_version_id, p.document_kind
         from piece_articles_v a
         join pieces_v p on p.id = a.piece_id
        where a.piece_id = $1)
     select case
              when count(*) > 0
               and count(distinct a.famille_code) = 1
               and bool_and(not coalesce(f.is_fallback, true))
               and bool_and(f.main_account is not null)
               and bool_and(left(f.main_account, 1) = left(m.main_account, 1))
              then min(f.main_account)
            end as compte
       from a
       left join ref_charge_familles_v f
              on f.pack_version_id = a.pack_version_id and f.code = a.famille_code
             and f.valid_to is null
       left join lateral (
              select mm.main_account from ref_account_mappings_v mm
               where mm.pack_version_id = a.pack_version_id and mm.document_kind = a.document_kind
               order by mm.main_account limit 1) m on true`,
    [pieceId],
  );
  return rows[0]?.compte ?? null;
}

/**
 * Les champs dont la lecture est sous le seuil de réserve, tels que le DERNIER
 * jugement de la DERNIÈRE lecture les a nommés (contrôle `confiance_lecture`).
 *
 * ANO-025 : un émetteur mal lu s'affichait avec la coche « source », sans
 * aucun signal. Le moteur savait — le contrôle le nommait dans ses preuves —
 * mais l'écran ne le recevait pas. Rien n'est recalculé ici : on rend ce que
 * le jugement déterministe a posé, seuils de la base compris. Un jugement
 * d'une lecture plus ancienne ne dit rien de la lecture courante : il est
 * ignoré.
 */
export async function champsAVerifier(db: Requete, pieceId: string): Promise<string[]> {
  const { rows } = await db.query<{ controles: unknown }>(
    `select a.controles
       from capture.analyses a
       join lateral (select id from capture.extractions x
                      where x.piece_id = a.piece_id order by created_at desc limit 1) e
         on e.id = a.extraction_id
      where a.piece_id = $1
      order by a.created_at desc limit 1`,
    [pieceId],
  );
  const controles = rows[0]?.controles;
  if (!Array.isArray(controles)) return [];
  const confiance = controles.find(
    (c): c is { statut: string; preuves?: { champs?: unknown; aRelire?: unknown } } =>
      typeof c === "object" && c !== null && (c as { code?: unknown }).code === "confiance_lecture",
  );
  if (!confiance || confiance.statut === "conforme") return [];
  // Une anomalie nomme ses champs bloquants dans `champs`, et TOUS les champs
  // sous la réserve dans `aRelire` (jugements posés depuis le 22 octobre 2026).
  const champs = confiance.preuves?.aRelire ?? confiance.preuves?.champs;
  return Array.isArray(champs) ? champs.filter((x): x is string => typeof x === "string") : [];
}

export async function propositionDePiece(
  db: Requete,
  pieceId: string,
  dateSaisie: string | null = null,
): Promise<PropositionDePiece> {
  const resultat = await proposerDepuisLeJugement(db, pieceId, dateSaisie);
  return { ...resultat, champsAVerifier: await champsAVerifier(db, pieceId) };
}

async function proposerDepuisLeJugement(
  db: Requete,
  pieceId: string,
  dateSaisie: string | null,
): Promise<PropositionDePiece> {
  // Le jugement de la DERNIÈRE lecture ; s'il manque, on juge maintenant.
  const { rows: derniers } = await db.query<{
    extraction: string;
    tenant_id: string;
    payload: Record<string, unknown>;
    analyse_extraction: string | null;
    verdict: string | null;
    motifs: Array<{ motif: string }> | null;
    normalisation: ResultatNormalisation | null;
    pack_version_id: string | null;
    jurisdiction: string;
    sens_dit: string | null;
    date_dite: string | null;
    recue_le: string;
  }>(
    `select p.tenant_id, e.id as extraction, e.payload, to_char(p.created_at, 'YYYY-MM-DD') as recue_le,
            a.extraction_id as analyse_extraction, a.verdict, a.motifs, a.normalisation,
            a.pack_version_id, o.jurisdiction,
            case when p.document_kind_statut = 'confirme' then p.document_kind end as sens_dit,
            (select q.valeur from capture.precisions q
              where q.piece_id = p.id and q.champ = 'document_date'
              order by q.decided_at desc limit 1) as date_dite
       from capture.pieces p
       join identity.organizations o on o.id = p.tenant_id
       join lateral (select id, payload from capture.extractions x
                      where x.piece_id = p.id order by created_at desc limit 1) e on true
       left join lateral (select * from capture.analyses y
                           where y.piece_id = p.id order by created_at desc limit 1) a on true
      where p.id = $1`,
    [pieceId],
  );
  let ligne = derniers[0];
  if (!ligne) return { ok: false, raison: "Cette pièce n'a pas encore été lue." };
  const fiscalQualifie = await lignesQualifiees(db, pieceId);
  if (
    ligne.analyse_extraction !== ligne.extraction ||
    (ligne.normalisation?.qualificationFiscaleId ?? null) !==
      (fiscalQualifie.qualification?.id ?? null) ||
    (ligne.normalisation?.fiscaliteVersionId ?? null) !==
      (fiscalQualifie.contexte.profil?.id ?? null)
  ) {
    const a = await analyserPiece(db, pieceId);
    const { rows } = await db.query<{ pack_version_id: string }>(
      `select pack_version_id from capture.analyses where id = $1`,
      [a.id],
    );
    ligne = {
      ...ligne,
      verdict: a.verdict,
      motifs: a.motifs,
      normalisation: a.normalisation,
      pack_version_id: rows[0]!.pack_version_id,
    };
  }
  const verdict = ligne.verdict!;
  const n = ligne.normalisation!;
  const pack = ligne.pack_version_id!;

  if (!autoriseUneEcriture(verdict))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: `Aucune écriture ne se propose : la pièce est « ${verdict} ». ${(ligne.motifs ?? [])
        .map((m) => m.motif)
        .join(" ")}`,
      // Les CODES des contrôles en défaut : l'écran branche dessus (le geste
      // « confirmer le sens », 20 octobre 2026), jamais sur la phrase.
      controlesEnDefaut: (ligne.motifs ?? [])
        .map((m) => (m as { code?: string }).code)
        .filter((c): c is string => typeof c === "string"),
    };
  if (n.etat !== "tranche" && n.etat !== "non_verifie")
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: `Aucune écriture ne se propose : ${n.raison}.`,
    };

  const payload = ligne.payload as {
    document_date?: string | null;
    lines?: Array<Record<string, unknown>>;
    other_charges?: Array<Record<string, unknown>>;
  };
  // La date imprimée, puis la précision enregistrée, puis la qualification.
  const date = dateDeLaPiece(
    payload.document_date,
    ligne.date_dite ?? fiscalQualifie.qualification?.dateOperation ?? dateSaisie,
  );
  // Le paramétrage et le barème se lisent à la date de la pièce, par la même
  // règle que l'analyse : la date de la facture, à défaut celle de sa
  // réception (« la pièce vit à la date de sa facture », note du 10 octobre
  // 2026). Le jour de la LECTURE n'en est pas une : au lendemain d'un
  // changement du timbre, il bloquait toute facture antérieure.
  const jour = date ?? ligne.recue_le;
  const p = await lireParametres(db, pack, jour);
  const dec = p["money.decimals"];

  const m = n.montants;
  const lignesLues = payload.lines ?? [];
  const droits = payload.other_charges ?? [];
  if (m.bases.length !== lignesLues.length || m.bases.some((b) => b.ht === null))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : une base n'a pas été lue.",
    };
  if (m.autres.length !== droits.length || m.autres.some((a) => a === null))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : un droit hors TVA n'a pas été lu.",
    };

  const tvas = m.bases.map((b, i) => {
    if (lignesLues.length === 1 && m.tva !== null) return m.tva;
    const majoration = (fiscalQualifie.lignes ?? [])
      .filter((l) => l.index === i)
      .reduce((s, l) => s + Number(enUnitesExactes(l.majorationTva, dec)), 0);
    return tvaDeBase(b.ht! + majoration, m.bases[i]!.taux);
  });
  const somme = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const totalHt = somme(m.bases.map((b) => b.ht!));
  const totalTva = m.tva ?? somme(tvas);
  const autres = m.autres as number[];

  const normalise = {
    ...ligne.payload,
    // Le sens dit par la personne l'emporte sur le sens lu (ANO-LIVE-002/004),
    // comme dans l'analyse : le dirigeant sait s'il a payé ou encaissé.
    ...(ligne.sens_dit ? { document_kind: ligne.sens_dit } : {}),
    document_date: date,
    lines: lignesLues.map((l, i) => ({
      ...l,
      base_ht: enDecimal(m.bases[i]!.ht!, dec),
      vat_amount: enDecimal(tvas[i]!, dec),
      ttc: enDecimal(m.bases[i]!.ht! + tvas[i]!, dec),
    })),
    other_charges: droits.map((c, i) => ({ ...c, amount: enDecimal(autres[i]!, dec) })),
    totals: {
      base_ht: enDecimal(totalHt, dec),
      vat: enDecimal(totalTva, dec),
      ttc: enDecimal(m.ttc ?? totalHt + totalTva + somme(autres), dec),
    },
  };

  const [tauxDuPack, tousLesComptes, tousLesDroits] = await Promise.all([
    referentiel.taxRates(db, pack, ligne.jurisdiction),
    referentiel.accountMappings(db, pack),
    referentiel.fiscalCharges(db, pack, "fr", jour),
  ]);
  // Le moteur ne connaît que l'achat et la vente : le reste n'y entre pas.
  const mappings = tousLesComptes.filter((c): c is typeof c & SensConnu =>
    sensConnu(c.documentKind),
  );
  let fiscalCharges: FiscalCharge[] = tousLesDroits.filter((c): c is typeof c & SensConnu =>
    sensConnu(c.documentKind),
  );

  const compteDeNature = await compteDeLaNature(db, pieceId);
  // Le régime de TVA du dossier, tel que sa fiche fiscale en vigueur le dit :
  // un non-assujetti ne déduit pas la TVA qu'il paie (ANO-LIVE-001).
  const { rows: regimes } = await db.query<{ regime_tva: string | null }>(
    `select f.regime_tva
       from capture.pieces p
       join identity.fiches_fiscales f on f.tenant_id = p.tenant_id and f.valid_from <= $2::date and (f.valid_to is null or f.valid_to > $2::date)
      where p.id = $1
      order by f.valid_from desc limit 1`,
    [pieceId, jour],
  );
  if (
    normalise.document_kind === "facture_achat" &&
    regimes[0]?.regime_tva === "partiel" &&
    !fiscalQualifie.lignes
  )
    return {
      ok: false,
      raison: "Qualifiez l’affectation directe et le prorata de TVA par ligne fiscale.",
    };
  let tvaNonDeductible = regimes[0]?.regime_tva === "non_assujetti";
  let taxRates = tauxDuPack;
  const fiscalite = await fiscaliteDuDossier(db, ligne.tenant_id, jour);
  if (fiscalite) {
    try {
      const attentes = appliquerAttentesFiscales({
        configuration: fiscalite.configuration,
        ...(fiscalQualifie.lignes ? { qualification: fiscalQualifie.lignes } : {}),
        dateEffet: fiscalite.date_effet,
        operation: normalise.document_kind === "facture_vente" ? "vente" : "achat",
        codesTva: lignesLues.map((l) => String(l["tax_code"] ?? "")),
        droits: droits.map((d, i) => ({
          code: String(d["code"] ?? ""),
          amount: enDecimal(autres[i]!, dec),
        })),
        taxRates,
        fiscalCharges,
      });
      taxRates = attentes.taxRates;
      fiscalCharges = attentes.fiscalCharges;
      tvaNonDeductible = attentes.tvaNonDeductible;
    } catch (e) {
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: e instanceof Error ? e.message : "Profil fiscal à qualifier.",
      };
    }
  }

  try {
    const proposition = buildProposal({
      pieceId,
      payload: normalise,
      taxRates,
      mappings,
      fiscalCharges,
      ...(fiscalQualifie.lignes ? { lignesFiscales: fiscalQualifie.lignes } : {}),
      compteDeNature,
      tvaNonDeductible,
      currency: String((ligne.payload as { currency?: string }).currency ?? ""),
      parametres: {
        decimals: dec,
        confianceReserve: p["lecture.confiance_reserve"],
        confianceBloquante: p["lecture.confiance_bloquante"],
      },
    });
    if (!proposition.pivot.approvable)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `L'écriture ne s'équilibre pas : ${proposition.pivot.motifs.map((x) => x.message).join(" ; ")}`,
      };
    return {
      ok: true,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      packVersionId: pack,
      proposition,
      ...(fiscalite ? { fiscaliteVersionId: fiscalite.id } : {}),
      ...(fiscalQualifie.qualification
        ? { qualificationFiscaleId: fiscalQualifie.qualification.id }
        : {}),
    };
  } catch (e) {
    if (e instanceof LectureIncomplete)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `Aucune écriture ne se propose : à compléter — ${e.champs.join(", ")}.`,
      };
    if (e instanceof Error && e.message === "MISSING_ACCOUNT_MAPPING")
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison:
          "Aucune écriture ne se propose : le paramétrage n'a pas de compte pour ce type de pièce.",
      };
    throw e;
  }
}
