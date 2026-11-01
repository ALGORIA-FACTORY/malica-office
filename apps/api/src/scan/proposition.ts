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

import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import { contrepartieDuDocument } from "@malica/socle/domain/contrepartie";
import type {
  AccountMapping,
  CoursASaisir,
  FactureDOrigine,
  FiscalCharge,
  PropositionDePiece,
  RaisonSansEcriture,
  TaxRate,
} from "@malica/socle/ports/repositories";
import { ConversionRefusee } from "@malica/socle/engines/fx/convertir-l-extrait";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";
import {
  ecritureDAvoir,
  type EcritureDAvoir,
  type LigneDeLaFacture,
  type NatureDeLigne,
} from "@malica/socle/use-cases/ecriture-d-avoir";
import { referenceDuDocument } from "@malica/socle/use-cases/libelle-de-piece";
import { buildProposal, LectureIncomplete } from "@malica/socle/use-cases/propose-ecriture";
import { autoriseUneEcriture, codeDuVerdict } from "@malica/socle/verdicts";

import type { Requete } from "../db.ts";
import { dateDeLaPiece } from "../depots/dates.ts";
import { referentiel } from "../depots/referentiel.ts";
import {
  REFERENCE_DE_LA_FACTURE_D_ORIGINE,
  REFERENCES_QUI_TRANCHENT_LE_SENS,
} from "../fabrique/recette.ts";

import { analyserPiece, lireLesDevises, lireParametres, nonAssujetti } from "./analyse.ts";
import {
  categorieDeLEmetteur,
  droitsAuBareme,
  lireLeBaremeDesDroits,
  optionDuTimbre,
  type TimbreDeLaPiece,
} from "./bareme-du-timbre.ts";
import { cleDeDoublon, type ResultatControle } from "./controles.ts";
import type { CoursLu } from "./cours-de-change.ts";
import {
  lireLesNaturesDeVente,
  optionDesVentes,
  ventilerLesVentes,
  type VentesDuDossier,
} from "./nature-de-vente.ts";
import { reserveDuMoisDeTva } from "./mois-de-tva.ts";
import { tvaDeBase, type ResultatNormalisation } from "./normaliser-montants.ts";
import { AMBIGU, compteDuRole } from "./reglement.ts";
import {
  droitsAuCout,
  lireLesReglagesComptables,
  reglageDesAvoirs,
} from "./reglages-comptables.ts";

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
  /**
   * Les comptes de vente par nature d'article (`ventes.compte`, 1er novembre
   * 2026) ; nul quand le pack ne porte pas le réglage : le compte unique du
   * paramétrage, comme avant.
   */
  ventes: VentesDuDossier | null;
  /**
   * Le barème daté du timbre et la catégorie de l'émetteur (`timbre.bareme`
   * = `bareme_date`, 1er novembre 2026) ; nul : le droit standard seul
   * (`fixe_1d`, ou un pack qui ne porte pas le réglage).
   */
  timbre: TimbreDeLaPiece | null;
  /**
   * Un avoir lié : sa facture d'origine, l'écriture de celle-ci et le
   * traitement du cabinet ; nul pour une pièce qui n'est pas un avoir.
   */
  avoir: AvoirAProposer | null;
}

/** Ce que la proposition d'un avoir lit en base : la facture d'origine, et comment l'écrire. */
interface AvoirAProposer {
  /** La facture, son lien, ou ce qui manque. */
  origine: FactureDOrigine;
  /** L'écriture prise en charge de la facture : son journal, sa devise, ses lignes rangées. */
  ecriture: { journal: string; devise: string; lignes: LigneDeLaFacture[] } | null;
  /** L'extourne, le rabais, ou selon l'avoir (`avoirs.ecriture`). */
  traitement: EcritureDAvoir;
  /** Le compte des RRR par préfixe du compte d'origine (`ref.comptes_de_rabais`), résolu. */
  comptesDeRabais: ReadonlyArray<{ prefixe: string; compte: string }>;
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

  /*
   * ======================================== UN AVOIR LIÉ À SA FACTURE (1er novembre 2026)
   *
   * Le jugement l'a reconnu (`nature_piece`, preuve `avoir`) : il s'écrit en
   * contre-passation de l'écriture prise en charge de sa facture d'origine,
   * aux montants qu'IL imprime (`ecritureDAvoir`). Sans facture rattachée ou
   * comptabilisée, rien ne se propose, et la raison le dit.
   */
  const estUnAvoir = (j.controles ?? []).some(
    (c) => c.code === "nature_piece" && c.preuves["avoir"] === true,
  );
  if (estUnAvoir)
    return proposerLAvoir(j, r, {
      verdict,
      devise,
      normalise,
      bases: m.bases.map((b, i) => ({
        code: String(lignesLues[i]!["tax_code"]),
        ht: depuisUniteMineure(b.ht!, dec),
        tva: depuisUniteMineure(tvas[i]!, dec),
      })),
      droits: droits.map((c, i) => ({
        code: String(c["code"]),
        montant: depuisUniteMineure(autres[i]!, dec),
      })),
      ttc: normalise.totals.ttc,
    });

  /*
   * Une vente : le compte de chaque ligne, par la nature de ce qu'elle vend
   * (`ventes.compte`). Ce qui ne se prouve pas va au repli, avec sa réserve.
   */
  const sens = normalise.document_kind;
  const ventes =
    sens === "facture_vente" && r.ventes
      ? ventilerLesVentes({
          lignes: lignesLues.map((l, i) => ({ code: String(l["tax_code"]), ht: m.bases[i]!.ht! })),
          articles:
            (j.payload as { articles?: Parameters<typeof ventilerLesVentes>[0]["articles"] })
              .articles ?? [],
          exposant: dec,
          enDevise: change !== null,
          ventes: r.ventes,
        })
      : null;

  /*
   * Le timbre au barème daté, selon la catégorie de l'émetteur
   * (`bareme-du-timbre.ts`). Une pièce en devise garde le droit standard : le
   * barème est tarifé dans la devise du dossier, son TTC ne s'y compare pas.
   */
  const timbre =
    r.timbre && change === null
      ? droitsAuBareme({
          droits: r.fiscalCharges,
          imprimes: droits.map((c, i) => ({
            code: String(c["code"]),
            amount: normalise.other_charges[i]!.amount,
          })),
          sens: String(sens),
          ttc: normalise.totals.ttc,
          timbre: r.timbre,
        })
      : null;
  const reserves = [...(ventes?.reserve ? [ventes.reserve] : []), ...(timbre?.reserves ?? [])];

  try {
    const proposition = buildProposal({
      pieceId: j.pieceId,
      payload: normalise,
      taxRates: r.taxRates,
      mappings: r.mappings,
      fiscalCharges: timbre?.droits ?? r.fiscalCharges,
      compteDeNature: r.compteDeNature,
      tvaNonDeductible: r.tvaNonDeductible,
      droitsAuCout: r.droitsAuCout,
      currency: devise,
      ...(change?.ok ? { conversion: change.conversion } : {}),
      ...(ventes ? { ventilationDesVentes: ventes.ventilation } : {}),
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
      ...(reserves.length > 0 ? { reserves } : {}),
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

/** La raison d'un avoir qui ne se propose pas, en clair : elle va dans le i. */
const RAISON_DE_L_AVOIR: Record<
  "avoir_excede_la_facture" | "avoir_hors_facture" | "avoir_desequilibre" | "facture_illisible",
  string
> = {
  avoir_excede_la_facture:
    "l'avoir excède sa facture d'origine (au total, sur un taux ou sur un droit)",
  avoir_hors_facture: "l'avoir porte un taux ou un droit que sa facture d'origine n'a pas",
  avoir_desequilibre: "l'écriture de l'avoir ne s'équilibrerait pas",
  facture_illisible: "l'écriture de la facture d'origine ne se lit pas comme une facture",
};

/** L'écriture d'un avoir lié, ou le refus qui nomme ce qui manque. Pure. */
function proposerLAvoir(
  j: JugementAProposer,
  r: ReferentielDeLaProposition,
  x: {
    verdict: string;
    devise: string;
    normalise: Record<string, unknown>;
    bases: Array<{ code: string; ht: string; tva: string }>;
    droits: Array<{ code: string; montant: string }>;
    ttc: string;
  },
): PropositionDePiece {
  const a = r.avoir;
  const refus = (raisonCode: RaisonSansEcriture, raison: string): PropositionDePiece => ({
    ok: false,
    verdict: x.verdict,
    verdictCode: codeDuVerdict(x.verdict),
    raison: `Aucune écriture ne se propose : ${raison}.`,
    raisonCode,
    ...(a ? { avoir: a.origine } : {}),
  });
  if (x.devise !== r.deviseDuDossier || (a?.ecriture && a.ecriture.devise !== x.devise))
    return refus(
      "devise",
      "un avoir en devise se saisit, sa conversion n'est pas encore appliquée",
    );
  if (!a?.ecriture || !a.origine.facture)
    return refus(
      "facture_d_origine",
      a?.origine.manque === "non_comptabilisee"
        ? "la facture d'origine n'a pas encore d'écriture prise en charge"
        : "facture d'origine à rattacher",
    );
  const lu = ExtractV1.safeParse(x.normalise);
  if (!lu.success) return refus("a_completer", "la lecture de l'avoir est incomplète");
  const e = lu.data;
  const rabais = [...a.comptesDeRabais].sort((p, q) => q.prefixe.length - p.prefixe.length);
  const ecriture = ecritureDAvoir({
    pieceId: j.pieceId,
    sens: e.document_kind,
    date: e.document_date,
    devise: x.devise,
    decimales: r.decimales,
    facture: { journal: a.ecriture.journal, lignes: a.ecriture.lignes },
    avoir: { bases: x.bases, droits: x.droits, ttc: x.ttc },
    ecriture: a.traitement,
    compteDeRabais: (compte) => rabais.find((c) => compte.startsWith(c.prefixe))?.compte ?? null,
    contrepartie: contrepartieDuDocument(e),
    reference: referenceDuDocument(e.references),
  });
  if (!ecriture.ok) return refus(ecriture.refus, RAISON_DE_L_AVOIR[ecriture.refus]);
  return {
    ok: true,
    verdict: x.verdict,
    verdictCode: codeDuVerdict(x.verdict),
    packVersionId: r.packVersionId,
    proposition: {
      pivot: ecriture.pivot,
      extract: e,
      journal: ecriture.journal,
      libelle: ecriture.libelle,
      lignes: ecriture.lignes,
    },
    avoir: { ...a.origine, traitement: ecriture.traitement },
  };
}

/**
 * Ce qu'un avoir lié demande à la base : sa facture d'origine — le lien posé
 * le plus récent, sinon la SEULE facture du dossier, du même sens (et, pour
 * un achat, du même fournisseur), que le numéro imprimé sur l'avoir désigne —,
 * l'écriture prise en charge de cette facture, rangée par nature, et les
 * comptes des RRR du dossier. Aucune facture n'est devinée : deux candidates,
 * ou aucune, et le cabinet la rattache.
 */
async function lireLAvoirAProposer(
  db: Requete,
  p: {
    pieceId: string;
    dossier: string;
    pack: string;
    jour: string;
    sens: string;
    references: Record<string, string>;
    traitement: EcritureDAvoir;
  },
): Promise<AvoirAProposer> {
  const sans = (origine: FactureDOrigine): AvoirAProposer => ({
    origine,
    ecriture: null,
    traitement: p.traitement,
    comptesDeRabais: [],
  });
  const { rows: liens } = await db.query<{ facture: string; origine: "numero" | "cabinet" }>(
    `select facture_piece_id as facture, origine from capture.avoirs_rattaches
      where piece_id in (select app.versions_de_la_piece($1))
      order by decide_le desc limit 1`,
    [p.pieceId],
  );
  let origine: FactureDOrigine;
  if (liens[0]) origine = { facture: liens[0].facture, origine: liens[0].origine, lie: true };
  else {
    // Le numéro de la facture, normalisé comme la clé de doublon d'une pièce.
    const numero = cleDeDoublon({
      emetteurIdentifiantFiscal: null,
      emetteurNom: null,
      numero: p.references[REFERENCE_DE_LA_FACTURE_D_ORIGINE] ?? null,
      date: null,
      ttc: null,
    }).numero;
    const { rows } = numero
      ? await db.query<{ id: string }>(
          `with avoir as (
             select a.doublon_mf from capture.analyses a
              where a.piece_id = app.version_courante($1) order by a.created_at desc limit 1)
           select f.id
             from capture.pieces f
             join lateral (select a.doublon_numero, a.doublon_mf from capture.analyses a
                            where a.piece_id = f.id order by a.created_at desc limit 1) a on true
            where f.tenant_id = $2 and f.document_kind = $3
              and f.id = app.version_courante(f.id)
              and f.id not in (select app.versions_de_la_piece($1))
              and a.doublon_numero = $4
              and ($3 = 'facture_vente' or a.doublon_mf = (select doublon_mf from avoir))
            limit 2`,
          [p.pieceId, p.dossier, p.sens, numero],
        )
      : { rows: [] };
    origine =
      rows.length === 1
        ? { facture: rows[0]!.id, origine: "numero", lie: false }
        : { facture: null, origine: null, lie: false, manque: "introuvable" };
  }
  if (!origine.facture) return sans(origine);

  const { rows: ecritures } = await db.query<{
    id: string;
    journal: string;
    devise: string;
    pack: string;
    jour: string;
  }>(
    `select e.id, e.journal, e.devise, e.pack_version_id as pack,
            to_char(e.date_ecriture, 'YYYY-MM-DD') as jour
       from ecritures_v e where e.id = app.ecriture_prise_en_charge_de($1)`,
    [origine.facture],
  );
  const e = ecritures[0];
  if (!e) return sans({ ...origine, manque: "non_comptabilisee" });
  const { rows: lignes } = await db.query<{
    account_code: string;
    libelle: string;
    debit: string;
    credit: string;
    tax_code: string | null;
    nature: NatureDeLigne;
    droit_code: string | null;
  }>(
    `with l as (select account_code, libelle, debit::text as debit, credit::text as credit,
                       tax_code, ordinal
                  from ecriture_lignes_v where ecriture_id = $1)
     select l.account_code, l.libelle, l.debit, l.credit, l.tax_code, n.nature, n.droit_code
       from l
       join app.nature_des_comptes(
              (select g.cabinet_org_id from engagements_v g
                where g.pme_org_id = $2 and g.status = 'actif' limit 1),
              $2, $3::uuid, $4, $5::date,
              array(select distinct account_code from l)) n on n.account_code = l.account_code
      order by l.ordinal`,
    [e.id, p.dossier, e.pack, p.sens, e.jour],
  );
  const { rows: rabais } = await db.query<{ prefixe: string; role_code: string }>(
    `select prefixe, role_code from ref.comptes_de_rabais
      where pack_version_id = $1 and document_kind = $2 and valid_from <= $3::date
        and (valid_to is null or valid_to >= $3::date)`,
    [p.pack, p.sens, p.jour],
  );
  const comptesDeRabais: Array<{ prefixe: string; compte: string }> = [];
  for (const x of rabais) {
    const compte = await compteDuRole(db, p.dossier, x.role_code, p.pack, null);
    if (compte === AMBIGU) throw new Error("reglage.avoirs.compte_ambigu");
    if (!compte) throw new Error("reglage.avoirs.compte_absent");
    comptesDeRabais.push({ prefixe: x.prefixe, compte });
  }
  return {
    origine,
    ecriture: { journal: e.journal, devise: e.devise, lignes },
    traitement: p.traitement,
    comptesDeRabais,
  };
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
    reglages_a_jour: boolean;
    sens_dit: string | null;
    date_dite: string | null;
    recue_le: string;
  }>(
    `select e.id as extraction, e.payload, to_char(p.created_at, 'YYYY-MM-DD') as recue_le,
            a.extraction_id as analyse_extraction, a.verdict, a.motifs, a.controles,
            a.normalisation,
            a.pack_version_id, p.tenant_id, o.jurisdiction, o.currency as devise_du_dossier,
            app.cours_du_jugement_a_jour(p.tenant_id, a.controles) as cours_a_jour,
            app.reglages_du_jugement_a_jour(p.tenant_id, a.controles) as reglages_a_jour,
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
      // Jugée à l'instant : son cours et ses réglages sont ceux du jour.
      cours_a_jour: true,
      reglages_a_jour: true,
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
  // De même pour un réglage comptable que le jugement a lu (le seuil
  // d'immobilisation) et que le cabinet a changé depuis : il se rejuge.
  if (!ligne.reglages_a_jour)
    return {
      ok: false,
      ...(ligne.verdict ? { verdict: ligne.verdict } : {}),
      verdictCode: codeDuVerdict(ligne.verdict),
      raison:
        "Aucune écriture ne se propose : un réglage comptable du cabinet a changé depuis le jugement de la pièce, qui attend d'être rejugée.",
      raisonCode: "reglages_perimes",
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

  // Les réglages du cabinet pour ce dossier, au jour de la pièce (R10).
  const reglages = await lireLesReglagesComptables(db, ligne.tenant_id, pack, jour);
  const sens = jugement.sensDit ?? (ligne.payload["document_kind"] as string | null) ?? null;
  const option = sens === "facture_vente" ? optionDesVentes(reglages) : null;
  const natures = option ? await lireLesNaturesDeVente(db, pack, jour, ligne.tenant_id) : [];
  if (option && natures.length === 0) throw new Error("reglage.ventes.natures_absentes");
  const estUnAvoir = (ligne.controles ?? []).some(
    (c) => c.code === "nature_piece" && c.preuves["avoir"] === true,
  );
  const reglageDAvoir = estUnAvoir ? reglageDesAvoirs(reglages, { pack, jour }) : null;
  if (estUnAvoir && !reglageDAvoir) throw new Error("reglage.avoirs.absent");
  // Le barème daté du timbre : l'émetteur d'un achat est un tiers du dossier,
  // que le cabinet classe ; celui d'une vente est le dossier, que rien ne classe.
  const references = (ligne.payload["references"] as Record<string, string> | undefined) ?? {};
  const timbre: TimbreDeLaPiece | null =
    optionDuTimbre(reglages) === "bareme_date"
      ? {
          bareme: await lireLeBaremeDesDroits(db, pack, jour),
          categorie:
            sens === "facture_achat"
              ? await categorieDeLEmetteur(
                  db,
                  ligne.tenant_id,
                  references[REFERENCES_QUI_TRANCHENT_LE_SENS[0]],
                )
              : null,
        }
      : null;

  const proposee = composerLaProposition(jugement, {
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
    // Le régime de TVA du dossier, tel que sa fiche fiscale en vigueur le dit :
    // un non-assujetti ne déduit pas la TVA qu'il paie (ANO-LIVE-001).
    tvaNonDeductible: await nonAssujetti(db, ligne.tenant_id),
    // Le FODEC d'un achat, au coût ou au compte du pack : le réglage du
    // cabinet pour ce dossier, au jour de la pièce (R10).
    droitsAuCout: await droitsAuCout(db, reglages),
    ventes: option ? { option, natures } : null,
    timbre,
    avoir:
      reglageDAvoir && sens
        ? await lireLAvoirAProposer(db, {
            pieceId,
            dossier: ligne.tenant_id,
            pack,
            jour,
            sens,
            references,
            traitement: reglageDAvoir.ecriture,
          })
        : null,
  });
  if (!proposee.ok) return proposee;
  // Le mois de TVA à vérifier (`mois_tva.date`, 11 novembre 2026) : la même
  // fonction que la TVA du mois en décide, sous la même mécanique de réserve.
  const mois = await reserveDuMoisDeTva(db, {
    dossier: ligne.tenant_id,
    pieceId,
    pack,
    jour,
    reglages,
    articles: ligne.payload["articles"],
  });
  return mois ? { ...proposee, reserves: [...(proposee.reserves ?? []), mois] } : proposee;
}
