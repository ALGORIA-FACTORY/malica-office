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

import type {
  AccountMapping,
  CoursASaisir,
  FiscalCharge,
  PropositionDePiece,
  TaxRate,
} from "@malica/socle/ports/repositories";
import { ConversionRefusee } from "@malica/socle/engines/fx/convertir-l-extrait";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";
import { buildProposal, LectureIncomplete } from "@malica/socle/use-cases/propose-ecriture";
import { autoriseUneEcriture, codeDuVerdict } from "@malica/socle/verdicts";

import type { Requete } from "../db.ts";
import { dateDeLaPiece } from "../depots/dates.ts";
import { referentiel } from "../depots/referentiel.ts";

import { analyserPiece, lireLesDevises, lireParametres } from "./analyse.ts";
import type { ResultatControle } from "./controles.ts";
import type { CoursLu } from "./cours-de-change.ts";
import { tvaDeBase, type ResultatNormalisation } from "./normaliser-montants.ts";
import { droitsAuCout, lireLesReglagesComptables } from "./reglages-comptables.ts";

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
 * Le 30 octobre 2026, une troisième copie a été trouvée au Socle
 * (`depuisUniteMineure`, que les écrans appelaient déjà) : c'est elle qui
 * reste, pour l'API comme pour le web.
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

/** Ce que le jugement a posé, et ce que la personne a dit, pour proposer. */
export interface JugementAProposer {
  pieceId: string;
  payload: Record<string, unknown>;
  verdict: string;
  motifs: Array<{ motif: string; code?: string }> | null;
  normalisation: ResultatNormalisation;
  /** Le sens confirmé par une personne, s'il l'a été. */
  sensDit: string | null;
  /** La date retenue : lue, à défaut enregistrée ou saisie. */
  date: string | null;
  /**
   * Les contrôles du jugement : celui du cours de change dit, pour une pièce
   * en devise, le cours qui la convertit — ou celui qui manque. Nuls pour un
   * jugement qui ne les porte pas.
   */
  controles: ReadonlyArray<Pick<ResultatControle, "code" | "statut" | "motif" | "preuves">> | null;
}

/** Le référentiel daté de la proposition : le pack, à la date de la pièce. */
export interface ReferentielDeLaProposition {
  packVersionId: string;
  /** La devise du dossier : celle de ses livres. */
  deviseDuDossier: string;
  /** L'exposant de la devise de la pièce (`ref.devises`). */
  decimales: number;
  /** L'exposant de la devise du dossier (`ref.devises`) : celui d'une pièce convertie. */
  decimalesDuDossier: number;
  confianceReserve: number;
  confianceBloquante: number;
  taxRates: TaxRate[];
  mappings: Array<AccountMapping & SensConnu>;
  fiscalCharges: Array<FiscalCharge & SensConnu>;
  compteDeNature: string | null;
  tvaNonDeductible: boolean;
  /**
   * Les droits hors TVA qu'un achat incorpore au coût, selon le réglage du
   * cabinet (`fodec.traitement`, `droitsAuCout`). Vide : le compte du pack.
   */
  droitsAuCout: readonly string[];
}

/**
 * Le jugement refuse-t-il, avant tout référentiel ? Le verdict d'abord, puis
 * des montants que la normalisation n'a pas retenus. Pure.
 */
function refusDuJugement(j: JugementAProposer): PropositionDePiece | null {
  const { verdict, normalisation: n } = j;
  if (!autoriseUneEcriture(verdict))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: `Aucune écriture ne se propose : la pièce est « ${verdict} ». ${(j.motifs ?? [])
        .map((m) => m.motif)
        .join(" ")}`,
      // Les CODES des contrôles en défaut : l'écran branche dessus (le geste
      // « confirmer le sens », 20 octobre 2026), jamais sur la phrase.
      controlesEnDefaut: (j.motifs ?? [])
        .map((m) => m.code)
        .filter((c): c is string => typeof c === "string"),
    };
  if (n.etat !== "tranche" && n.etat !== "non_verifie")
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: `Aucune écriture ne se propose : ${n.raison}.`,
      raisonCode: "montants",
    };
  return null;
}

/**
 * La devise de la pièce, telle que le JUGEMENT l'a décidée (`deviseDeLaPiece`,
 * `analyse.ts`), et nulle autre : relire `payload.currency ?? dossier` ici
 * rendait « 100,00 € » en dinars (revue de la PR 144).
 *
 * Un jugement posé avant le 30 octobre 2026 ne la porte pas : il garde la
 * règle sous laquelle il a été rendu, et `REGLES_DU_JUGEMENT` le date — le
 * rejeu aux règles du jour (`rejugerLaPiece`) le refait. Le refaire ICI, à
 * l'ouverture, toucherait une pièce dont l'écriture est déjà au journal.
 */
function deviseDuJugement(
  n: ResultatNormalisation,
  payload: unknown,
  deviseDuDossier: string,
): string | null {
  if (n.devise !== undefined) return n.devise;
  return (payload as { currency?: string | null }).currency ?? deviseDuDossier;
}

/** Les preuves du contrôle `cours_de_change` (`controles.ts`), telles qu'il les pose. */
interface PreuvesDuCours {
  devise: string;
  versDevise: string;
  jour: string | null;
  source?: string;
  ecart?: string;
  cours: CoursLu | null;
}

/**
 * Le cours qu'a lu le jugement d'une pièce en devise, prêt pour la
 * conversion — ou le refus qui nomme ce qui manque. Pure.
 *
 * Un jugement d'avant le 31 octobre 2026 ne porte pas le contrôle : il se
 * refuse comme alors (« montant converti à saisir »), et le rejeu aux règles
 * du jour (`REGLES_DU_JUGEMENT`) le refait.
 */
function coursDuJugement(
  j: JugementAProposer,
  devise: string | null,
  r: ReferentielDeLaProposition,
):
  | { ok: true; conversion: NonNullable<Parameters<typeof buildProposal>[0]["conversion"]> }
  | {
      ok: false;
      raison: string;
      raisonCode: "devise" | "taux_de_change";
      coursASaisir?: CoursASaisir;
    } {
  const controle = (j.controles ?? []).find((c) => c.code === "cours_de_change");
  if (!controle)
    return {
      ok: false,
      raison: `Aucune écriture ne se propose : facture en ${devise}, dossier tenu en ${r.deviseDuDossier} — montant converti à saisir.`,
      raisonCode: "devise",
    };
  const p = controle.preuves as unknown as PreuvesDuCours;
  if (controle.statut !== "reserve" || !p.cours || !p.ecart)
    return {
      ok: false,
      raison: `Aucune écriture ne se propose : ${controle.motif}.`,
      raisonCode: "taux_de_change",
      ...(p.jour && p.source
        ? {
            coursASaisir: {
              devise: p.devise,
              versDevise: p.versDevise,
              jour: p.jour,
              source: p.source,
            },
          }
        : {}),
    };
  return {
    ok: true,
    conversion: {
      vers: { code: r.deviseDuDossier, decimals: r.decimalesDuDossier },
      cours: {
        id: p.cours.id,
        date: p.cours.date,
        source: p.cours.source,
        taux: p.cours.taux,
        unite: p.cours.unite,
      },
      ecart: p.ecart,
    },
  };
}

/**
 * Composer l'écriture d'un jugement qui l'autorise : montants IMPRIMÉS et
 * normalisés, référentiel daté, moteur du Socle. Pure — c'est la chaîne même
 * que `propositionDePiece` sert, et que la mesure des propositions joue.
 */
export function composerLaProposition(
  j: JugementAProposer,
  r: ReferentielDeLaProposition,
): PropositionDePiece {
  const refus = refusDuJugement(j);
  if (refus) return refus;
  const { verdict, normalisation: n } = j;
  const dec = r.decimales;
  const m = n.montants;
  const payload = j.payload as {
    lines?: Array<Record<string, unknown>>;
    other_charges?: Array<Record<string, unknown>>;
  };
  /*
   * UNE PIÈCE EN DEVISE NE S'INSCRIT PAS TELLE QUELLE (30 octobre 2026).
   *
   * Une facture en euros d'un dossier tenu en dinars partait au journal avec
   * ses montants en euros, dans des livres en dinars : équilibrée, plausible,
   * fausse. La conversion demande le cours que la règle de change désigne ;
   * on ne le devine pas. Le jugement l'a lu (contrôle `cours_de_change`) :
   * avec lui, l'écriture se compose convertie (31 octobre 2026) ; sans lui,
   * rien ne se propose, et la raison nomme le cours à saisir.
   */
  const devise = deviseDuJugement(n, j.payload, r.deviseDuDossier);
  if (devise === null)
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : la devise de la pièce n'est pas décidée.",
      raisonCode: "devise",
    };
  const change = devise === r.deviseDuDossier ? null : coursDuJugement(j, devise, r);
  if (change && !change.ok) return { verdict, verdictCode: codeDuVerdict(verdict), ...change };
  /*
   * Le taux que la facture prouve (`analyse.ts`) : la ligne qui le porte est
   * posée, ou son code corrigé — jamais en silence, la déduction est au
   * jugement et sa réserve au verdict.
   */
  const tauxDeduit = (n.deduits ?? []).find((d) => d.champ === "lines[0].tax_code");
  const libelleDuTaux = r.taxRates.find((t) => t.code === tauxDeduit?.valeur)?.label;
  const lignesLues = tauxDeduit
    ? [
        {
          ...payload.lines?.[0],
          label: payload.lines?.[0]?.["label"] || libelleDuTaux || tauxDeduit.valeur,
          tax_code: tauxDeduit.valeur,
        },
      ]
    : (payload.lines ?? []);
  const droits = payload.other_charges ?? [];
  if (m.bases.length !== lignesLues.length || m.bases.some((b) => b.ht === null))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : une base n'a pas été lue.",
      raisonCode: "base_non_lue",
    };
  if (m.autres.length !== droits.length || m.autres.some((a) => a === null))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : un droit hors TVA n'a pas été lu.",
      raisonCode: "droit_non_lu",
    };

  const tvas = m.bases.map((b, i) =>
    lignesLues.length === 1 && m.tva !== null ? m.tva : tvaDeBase(b.ht!, m.bases[i]!.taux),
  );
  const somme = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const totalHt = somme(m.bases.map((b) => b.ht!));
  const totalTva = m.tva ?? somme(tvas);
  const autres = m.autres as number[];

  const normalise = {
    ...j.payload,
    // Le sens dit par la personne l'emporte sur le sens lu (ANO-LIVE-002/004),
    // comme dans l'analyse : le dirigeant sait s'il a payé ou encaissé.
    ...(j.sensDit ? { document_kind: j.sensDit } : {}),
    currency: devise,
    document_date: j.date,
    lines: lignesLues.map((l, i) => ({
      ...l,
      base_ht: depuisUniteMineure(m.bases[i]!.ht!, dec),
      vat_amount: depuisUniteMineure(tvas[i]!, dec),
      ttc: depuisUniteMineure(m.bases[i]!.ht! + tvas[i]!, dec),
    })),
    other_charges: droits.map((c, i) => ({ ...c, amount: depuisUniteMineure(autres[i]!, dec) })),
    totals: {
      base_ht: depuisUniteMineure(totalHt, dec),
      vat: depuisUniteMineure(totalTva, dec),
      ttc: depuisUniteMineure(m.ttc ?? totalHt + totalTva + somme(autres), dec),
    },
  };

  try {
    const proposition = buildProposal({
      pieceId: j.pieceId,
      payload: normalise,
      taxRates: r.taxRates,
      mappings: r.mappings,
      fiscalCharges: r.fiscalCharges,
      compteDeNature: r.compteDeNature,
      tvaNonDeductible: r.tvaNonDeductible,
      droitsAuCout: r.droitsAuCout,
      currency: devise,
      ...(change?.ok ? { conversion: change.conversion } : {}),
      parametres: {
        decimals: dec,
        confianceReserve: r.confianceReserve,
        confianceBloquante: r.confianceBloquante,
      },
    });
    if (!proposition.pivot.approvable)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `L'écriture ne s'équilibre pas : ${proposition.pivot.motifs.map((x) => x.message).join(" ; ")}`,
        /*
         * Une pièce en devise qui imprime un droit que le pack FIXE dans la
         * devise du dossier (le timbre) : ce n'est pas ce droit-là. La raison
         * se dit en propre, pas comme un déséquilibre quelconque.
         */
        raisonCode:
          change?.ok && proposition.pivot.motifs.some((x) => x.code === "FISCAL_CHARGE_MISMATCH")
            ? "droit_fixe_en_devise"
            : "desequilibre",
      };
    return {
      ok: true,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      packVersionId: r.packVersionId,
      proposition,
    };
  } catch (e) {
    // Une conversion que le Socle refuse (facture déséquilibrée dans sa
    // devise, écart hors borne, ou qui changerait le signe d'une base).
    if (e instanceof ConversionRefusee)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `Aucune écriture ne se propose : ${e.message}`,
        raisonCode: "conversion_refusee",
      };
    if (e instanceof LectureIncomplete)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `Aucune écriture ne se propose : à compléter — ${e.champs.join(", ")}.`,
        raisonCode: "a_completer",
      };
    if (e instanceof Error && e.message === "MISSING_ACCOUNT_MAPPING")
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison:
          "Aucune écriture ne se propose : le paramétrage n'a pas de compte pour ce type de pièce.",
        raisonCode: "compte_manquant",
      };
    throw e;
  }
}

async function proposerDepuisLeJugement(
  db: Requete,
  pieceId: string,
  dateSaisie: string | null,
): Promise<PropositionDePiece> {
  // Le jugement de la DERNIÈRE lecture ; s'il manque, on juge maintenant.
  const { rows: derniers } = await db.query<{
    extraction: string;
    payload: Record<string, unknown>;
    analyse_extraction: string | null;
    verdict: string | null;
    motifs: Array<{ motif: string }> | null;
    controles: JugementAProposer["controles"];
    normalisation: ResultatNormalisation | null;
    pack_version_id: string | null;
    tenant_id: string;
    jurisdiction: string;
    devise_du_dossier: string;
    cours_a_jour: boolean;
    sens_dit: string | null;
    date_dite: string | null;
    recue_le: string;
  }>(
    `select e.id as extraction, e.payload, to_char(p.created_at, 'YYYY-MM-DD') as recue_le,
            a.extraction_id as analyse_extraction, a.verdict, a.motifs, a.controles,
            a.normalisation,
            a.pack_version_id, p.tenant_id, o.jurisdiction, o.currency as devise_du_dossier,
            app.cours_du_jugement_a_jour(p.tenant_id, a.controles) as cours_a_jour,
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
  if (!ligne)
    return { ok: false, raison: "Cette pièce n'a pas encore été lue.", raisonCode: "non_lue" };
  if (ligne.analyse_extraction !== ligne.extraction) {
    const a = await analyserPiece(db, pieceId);
    const { rows } = await db.query<{ pack_version_id: string }>(
      `select pack_version_id from capture.analyses where id = $1`,
      [a.id],
    );
    ligne = {
      ...ligne,
      verdict: a.verdict,
      motifs: a.motifs,
      controles: a.controles,
      normalisation: a.normalisation,
      pack_version_id: rows[0]!.pack_version_id,
      // Jugée à l'instant : son cours est celui du jour.
      cours_a_jour: true,
    };
  }
  /*
   * Un jugement qui a lu un cours que la base ne rendrait plus (un cours
   * importé, saisi ou corrigé depuis, une règle arrêtée autrement) ne propose
   * rien : la pièce attend d'être rejugée — l'ouverture et VALIDER le font
   * (`rejugerALOuverture`). Revue de #148 : un cours périmé s'inscrivait.
   */
  if (!ligne.cours_a_jour)
    return {
      ok: false,
      ...(ligne.verdict ? { verdict: ligne.verdict } : {}),
      verdictCode: codeDuVerdict(ligne.verdict),
      raison:
        "Aucune écriture ne se propose : le cours de change a changé depuis le jugement de la pièce, qui attend d'être rejugée.",
      raisonCode: "taux_de_change",
    };
  const pack = ligne.pack_version_id!;
  const payload = ligne.payload as { document_date?: string | null };
  // Une date lue n'est jamais remplacée ; à défaut, la date que la personne a
  // ENREGISTRÉE l'emporte sur celle que l'écran propose sans l'avoir écrite.
  const date = dateDeLaPiece(payload.document_date, ligne.date_dite ?? dateSaisie);
  const jugement: JugementAProposer = {
    pieceId,
    payload: ligne.payload,
    verdict: ligne.verdict!,
    motifs: ligne.motifs,
    normalisation: ligne.normalisation!,
    sensDit: ligne.sens_dit,
    controles: ligne.controles,
    date,
  };
  const refus = refusDuJugement(jugement);
  if (refus) return refus;

  // Le paramétrage et le barème se lisent à la date de la pièce, par la même
  // règle que l'analyse : la date de la facture, à défaut celle de sa
  // réception (« la pièce vit à la date de sa facture », note du 10 octobre
  // 2026). Le jour de la LECTURE n'en est pas une : au lendemain d'un
  // changement du timbre, il bloquait toute facture antérieure.
  const jour = date ?? ligne.recue_le;
  const p = await lireParametres(db, pack, jour);
  // L'exposant de la devise que le jugement a décidée (`analyse.ts`).
  const devise = deviseDuJugement(ligne.normalisation!, ligne.payload, ligne.devise_du_dossier);
  // Et celui de la devise du dossier : une pièce convertie s'y écrit.
  const devises = await lireLesDevises(db);
  const exposant = (code: string | null) => devises.find((d) => d.code === code)?.decimales ?? null;
  const decimales = exposant(devise);
  const decimalesDuDossier = exposant(ligne.devise_du_dossier);
  if (decimales === null || decimalesDuDossier === null)
    return {
      ok: false,
      raison: `Aucune écriture ne se propose : devise « ${decimales === null ? devise : ligne.devise_du_dossier} » inconnue.`,
      raisonCode: "devise",
    };

  const [taxRates, tousLesComptes, tousLesDroits] = await Promise.all([
    referentiel.taxRates(db, pack, ligne.jurisdiction),
    referentiel.accountMappings(db, pack),
    referentiel.fiscalCharges(db, pack, "fr", jour),
  ]);

  // Le régime de TVA du dossier, tel que sa fiche fiscale en vigueur le dit :
  // un non-assujetti ne déduit pas la TVA qu'il paie (ANO-LIVE-001).
  const { rows: regimes } = await db.query<{ regime_tva: string | null }>(
    `select f.regime_tva
       from capture.pieces p
       join identity.fiches_fiscales f on f.tenant_id = p.tenant_id and f.valid_to is null
      where p.id = $1
      order by f.valid_from desc limit 1`,
    [pieceId],
  );

  return composerLaProposition(jugement, {
    packVersionId: pack,
    deviseDuDossier: ligne.devise_du_dossier,
    decimales,
    decimalesDuDossier,
    confianceReserve: p["lecture.confiance_reserve"],
    confianceBloquante: p["lecture.confiance_bloquante"],
    taxRates,
    // Le moteur ne connaît que l'achat et la vente : le reste n'y entre pas.
    mappings: tousLesComptes.filter((c): c is typeof c & SensConnu => sensConnu(c.documentKind)),
    fiscalCharges: tousLesDroits.filter((c): c is typeof c & SensConnu =>
      sensConnu(c.documentKind),
    ),
    compteDeNature: await compteDeLaNature(db, pieceId),
    tvaNonDeductible: regimes[0]?.regime_tva === "non_assujetti",
    // Le FODEC d'un achat, au coût ou au compte du pack : le réglage du
    // cabinet pour ce dossier, au jour de la pièce (R10).
    droitsAuCout: await droitsAuCout(
      db,
      await lireLesReglagesComptables(db, ligne.tenant_id, pack, jour),
    ),
  });
}
