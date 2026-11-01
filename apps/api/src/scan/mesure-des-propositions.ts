/**
 * La mesure des propositions — combien de pièces reçoivent une écriture, et
 * combien une écriture JUSTE.
 *
 * ================================================================= POURQUOI
 *
 * 30 octobre 2026, le dirigeant : « le Socle doit PROPOSER, et être EXACT ».
 * Trop de pièces arrivaient chez le cabinet avec « Le Socle ne propose rien :
 * saisissez l'écriture ». Proposer plus ne vaut rien si c'est proposer faux ;
 * il faut donc compter les deux, sur la même chaîne que la production :
 *
 *   lecture citée → `jugerLaLecture` (normalisation, contrôles, verdict)
 *                 → `composerLaProposition` (référentiel daté, moteur du Socle)
 *
 * Aucune copie de la chaîne : ces deux fonctions sont celles qu'appellent
 * `analyserPiece` et `propositionDePiece`. Seul le référentiel est recopié
 * (`referentiel-d-essai.ts`), et une épreuve en base vérifie la copie.
 *
 * ============================================================ CE QU'ELLE VAUT
 *
 * Une écriture attendue est calculée À LA MAIN, depuis ce que la pièce
 * IMPRIME, jamais depuis ce que la machine a lu — sans quoi la mesure
 * vérifierait que le produit fait ce qu'il fait. `null` dit que ne rien
 * proposer est la bonne réponse (une proforma, une facture qui ne tient pas).
 *
 * Le jeu porte UNE pièce réelle (le jeu d'or) et des reproductions des
 * défauts relevés : ses pourcentages mesurent la couverture des causes
 * connues, pas leur fréquence chez les clients. La fréquence se lit sur les
 * jugements posés en base (`capture.analyses`).
 *
 * Les comptes comparés sont ceux du paramétrage : la nature de la charge
 * (`compteDeLaNature`) se lit en base et n'entre pas ici.
 */
import { createHash } from "node:crypto";

import { confianceParChamp } from "./confiance.ts";
import { HAUT_DE_PAGE, jugerLaLecture, type LectureAJuger } from "./analyse.ts";
import { composerLaProposition } from "./proposition.ts";
import { jourDuCours, type CoursLu } from "./cours-de-change.ts";
import { optionDuTimbre } from "./bareme-du-timbre.ts";
import {
  BAREME_DES_DROITS_D_ESSAI,
  BIENS_IMMOBILISABLES_D_ESSAI,
  DROITS_D_ESSAI,
  DEVISE_D_ESSAI,
  DEVISES_D_ESSAI,
  REGLE_DE_CHANGE_D_ESSAI,
  IMPUTATIONS_D_ESSAI,
  MENTIONS_D_ESSAI,
  JOUR_DU_RELEVE_D_ESSAI,
  NATURES_DE_VENTE_D_ESSAI,
  PARAMETRES_D_ESSAI,
  REGLAGES_D_ESSAI,
  TAUX_D_ESSAI,
  TITRES_D_ESSAI,
  TYPES_D_ESSAI,
} from "./referentiel-d-essai.ts";
import { optionDesVentes } from "./nature-de-vente.ts";
import { reglageDesAvoirs, reglageDImmobilisation } from "./reglages-comptables.ts";
import { JEU_D_OR } from "../malica/lecture/jeu-d-or.ts";
import { buildExtractFromTokenPlan, type BuiltRead } from "../malica/lecture/read-piece.ts";
import { texteDuMontantCite, type PageToken } from "../malica/lecture/token-plan.ts";
import { DEVISES_LUES_D_ESSAI, devisesDEssai } from "./devise-d-essai.ts";

/** Une ligne d'écriture attendue : compte, débit, crédit, et le code de taxe d'une ligne de TVA. */
type LigneAttendue = readonly [string, string, string, string?];

export interface CasDeMesure {
  nom: string;
  /** La pièce réelle, ou le défaut relevé que le cas reproduit. */
  provenance: string;
  lecture: LectureAJuger;
  /** Le dossier qui reçoit la pièce : son nom et son matricule. */
  dossier?: { nom: string; identifiantFiscal: string };
  /**
   * L'écriture juste, calculée à la main ; null : ne rien proposer est juste.
   * `origines` : pour une pièce en devise, le montant d'origine de chaque
   * ligne, par compte — une conversion juste dit aussi d'où elle part.
   */
  attendu: {
    journal: string;
    lignes: LigneAttendue[];
    origines?: ReadonlyArray<readonly [string, string]>;
  } | null;
  /**
   * Le contrôle qui DOIT poser une réserve : une écriture exacte sans elle est
   * fausse — la pièce passerait sans que le cabinet sache pourquoi douter.
   */
  reserve?: string;
  /**
   * Le motif du refus quand ne rien proposer est juste : un refus pour une
   * autre raison n'est pas juste (le cabinet ne saurait pas quoi faire).
   */
  refus?: string;
  /**
   * Une question que le Socle ne tranche PAS, et qu'il doit dire : l'écriture
   * du paramétrage (`attendu`), proposée AVEC la réserve qui la nomme
   * (`reserve`). Une immobilisation que le Socle impute en charge n'est pas
   * fausse quand elle porte la réserve « à trancher » : elle est à trancher.
   * Sans la réserve, elle redevient fausse ; avec une autre écriture aussi.
   */
  aTrancher?: {
    reserve: string;
    attendu: { journal: string; lignes: LigneAttendue[] };
  };
  /**
   * Le cours que `app.cours_applicable` rendrait pour la devise de la pièce ;
   * absent : aucun cours. Un cours est une donnée : celui-ci est fictif.
   */
  cours?: { devise: string } & CoursLu;
  /**
   * La devise des livres du dossier, quand ce n'est pas celle du pack : un
   * dossier tenu en francs CFA (forme) éprouve une conversion vers une devise
   * SANS décimale. La règle de change reste celle du pack d'essai.
   */
  deviseDuDossier?: string;
}

/** Le dossier des cas fabriqués : un nom et un matricule fictifs. */
const DOSSIER = { nom: "SOCIETE D'ESSAI SARL", identifiantFiscal: "1856324K/A/M/000" };
const FOURNISSEUR = { nom: "FOURNISSEUR D'ESSAI SA", identifiantFiscal: "1234567B/B/M/000" };
const CLIENT = { nom: "CLIENT D'ESSAI SARL", identifiantFiscal: "1765432C/A/M/000" };
/** La devise des livres du dossier d'essai. */
const DEVISE_DU_DOSSIER = DEVISE_D_ESSAI;

interface Facture {
  sens?: "facture_achat" | "facture_vente";
  sensDit?: string | null;
  emetteur?: { nom: string; identifiantFiscal: string };
  destinataire?: { identifiantFiscal: string };
  titre?: string;
  date?: string | null;
  recueLe?: string;
  currency?: string | null;
  /** Une ligne par taux : le code lu, et la base imprimée sur la ligne (null : non citée). */
  lignes: Array<{ code: string | null; ht?: string | null }>;
  /** Les droits que la lecture nomme : leur code, et leur montant imprimé (null : non cité). */
  droits?: Array<{ code: string; montant: string | null }>;
  ht?: string | null;
  tva?: string | null;
  ttc?: string | null;
  /** La confiance de certains champs ; les autres sont lus à 0,95. */
  confiance?: Record<string, number>;
  /** Les articles lus : leur désignation, leur total HT et leur code de taux, s'ils sont lus. */
  articles?: Array<{ designation: string; total_ht?: string; tax_code?: string }>;
}

/** Une lecture citée, telle que la base la porterait : champ par champ, le texte imprimé. */
function facture(f: Facture): LectureAJuger {
  const sens = f.sens ?? "facture_achat";
  const emetteur = f.emetteur ?? (sens === "facture_vente" ? DOSSIER : FOURNISSEUR);
  const client =
    f.destinataire ??
    (sens === "facture_vente" ? CLIENT : { identifiantFiscal: DOSSIER.identifiantFiscal });
  const cite = new Map<string, string>();
  const citer = (champ: string, texte: string | null | undefined) => {
    if (texte !== null && texte !== undefined) cite.set(champ, texte);
  };
  citer("issuer", emetteur.nom);
  citer("references.numero", "F-2026-0042");
  citer("references.matricule_fiscal", emetteur.identifiantFiscal);
  citer("references.matricule_fiscal_client", client.identifiantFiscal);
  if (f.date !== null) citer("document_date", f.date ?? "2026-09-10");
  f.lignes.forEach((l, i) => citer(`lines[${i}].base_ht`, l.ht));
  (f.droits ?? []).forEach((d, i) => citer(`other_charges[${i}].amount`, d.montant));
  citer("totals.base_ht", f.ht);
  citer("totals.vat", f.tva);
  citer("totals.ttc", f.ttc);
  const confiance = Object.fromEntries(
    [...cite.keys()].map((champ) => [champ, f.confiance?.[champ] ?? 0.95]),
  );
  return {
    // L'extraction telle que la lecture la pose ; ses montants sont remplacés
    // par ceux que la normalisation relit sur le texte imprimé.
    payload: {
      contract: "extract.v1",
      issuer: emetteur.nom,
      document_date: f.date === null ? null : (f.date ?? "2026-09-10"),
      document_kind: sens,
      currency: f.currency === undefined ? "TND" : f.currency,
      lines: f.lignes.map((l) => ({ label: "Achats", tax_code: l.code })),
      articles: f.articles ?? [],
      other_charges: (f.droits ?? []).map((d) => ({ code: d.code, label: "" })),
      references: {
        numero: "F-2026-0042",
        matricule_fiscal: emetteur.identifiantFiscal,
        matricule_fiscal_client: client.identifiantFiscal,
      },
      totals: { ttc: null },
      field_confidence: { overall: 0.95 },
    } as LectureAJuger["payload"],
    imprime: (champ) => cite.get(champ) ?? null,
    titre: f.titre ?? "FACTURE",
    sensDit: f.sensDit ?? null,
    date: f.date === null ? null : (f.date ?? "2026-09-10"),
    recueLe: f.recueLe ?? "2026-09-15",
    confianceParChamp: confiance,
    doublonDe: null,
  };
}

/**
 * Une lecture citée, telle que la base la porterait après `persisterLecture` :
 * l'extraction relue au plan, le texte imprimé de chaque citation, le haut de
 * la première page (le titre), la confiance de chaque champ.
 *
 * Partagée par le jeu d'or et le jeu synthétique (`jeu-synthetique.ts`) : les
 * deux jugent une lecture construite par la MÊME relecture que la production.
 */
export function lectureCitee(
  tokens: readonly PageToken[],
  lu: BuiltRead,
  confianceGlobale: number,
  recueLe: string,
): LectureAJuger {
  // Le texte de chaque citation, comme `analyserPiece` le relit.
  const textes = new Map<string, string[]>();
  for (const c of lu.citations) {
    const texte = texteDuMontantCite(tokens, c);
    if (texte !== null) textes.set(c.field, [...(textes.get(c.field) ?? []), texte]);
  }
  const premiere = Math.min(...tokens.map((t) => t.page));
  const haut = tokens
    .filter((t) => t.page === premiere && t.y0 <= HAUT_DE_PAGE)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .map((t) => t.text);
  const extrait = lu.extract as LectureAJuger["payload"];
  return {
    payload: extrait,
    imprime: (champ) => textes.get(champ)?.join(" ") ?? null,
    titre: haut.join(" ") || null,
    sensDit: null,
    date: extrait.document_date ?? null,
    recueLe,
    confianceParChamp: confianceParChamp(lu.citations, tokens, confianceGlobale),
    doublonDe: null,
  };
}

/** Le jeu d'or, joué comme la production : désignation relue au plan, citations, confiance. */
function depuisLeJeuDOr(): CasDeMesure[] {
  return JEU_D_OR.map((cas) => {
    const lu = buildExtractFromTokenPlan({
      tokens: cas.tokens,
      selection: cas.designation,
      ...devisesDEssai(cas.decimales),
      matriculeDossier: cas.matriculeDossier,
    });
    return {
      nom: `jeu d'or — ${cas.nom}`,
      provenance: cas.provenance,
      dossier: { nom: DOSSIER.nom, identifiantFiscal: cas.matriculeDossier ?? "" },
      // Lue le 4 octobre 2026 (provenance du cas).
      lecture: lectureCitee(
        cas.tokens,
        lu,
        (cas.designation as { overall_confidence: number }).overall_confidence,
        "2026-10-04",
      ),
      // 3 020,000 HT, 573,800 TVA, 1,000 de timbre, 3 594,800 TTC (imprimés).
      attendu: {
        journal: "ACH",
        lignes: [
          ["601", "3020.000", "0"],
          ["4366", "573.800", "0", "TVA19"],
          ["6654", "1.000", "0"],
          ["401", "0", "3594.800"],
        ],
      },
    };
  });
}

/** 1 234,560 HT à 19 %, 234,566 de TVA, 1,000 de timbre : 1 470,126 TTC. */
const ACHAT_SIMPLE: CasDeMesure["attendu"] = {
  journal: "ACH",
  lignes: [
    ["601", "1234.560", "0"],
    ["4366", "234.566", "0", "TVA19"],
    ["6654", "1.000", "0"],
    ["401", "0", "1470.126"],
  ],
};
const SIMPLE = {
  lignes: [{ code: "TVA19", ht: "1 234,560" }],
  droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
  ht: "1 234,560",
  tva: "234,566",
  ttc: "1 470,126",
};

/**
 * 864,700 à 7 % (TVA 60,529) et 2 696,600 à 19 % (TVA 512,354), 1,000 de
 * timbre : 4 135,183 TTC. La facture du 11 octobre 2026.
 */
const DEUX_TAUX: CasDeMesure["attendu"] = {
  journal: "ACH",
  lignes: [
    ["601", "3561.300", "0"],
    ["4366", "60.529", "0", "TVA07"],
    ["4366", "512.354", "0", "TVA19"],
    ["6654", "1.000", "0"],
    ["401", "0", "4135.183"],
  ],
};
const DEUX = {
  lignes: [
    { code: "TVA07", ht: "864,700" },
    { code: "TVA19", ht: "2 696,600" },
  ],
  droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
  ht: "3 561,300",
  tva: "572,883",
  ttc: "4 135,183",
};

/** 1 000,000 HT à 19 %, 190,000 de TVA, 1,000 de timbre : 1 191,000 TTC. */
const MILLE: CasDeMesure["attendu"] = {
  journal: "ACH",
  lignes: [
    ["601", "1000.000", "0"],
    ["4366", "190.000", "0", "TVA19"],
    ["6654", "1.000", "0"],
    ["401", "0", "1191.000"],
  ],
};

const REPRODUIT = "reproduction, sans modèle, d'un défaut relevé — montants fictifs";

/** Un cours FICTIF de l'euro, publié le jour des pièces d'essai (2026-09-10). */
const COURS_EUR: NonNullable<CasDeMesure["cours"]> = {
  devise: "EUR",
  id: "00000000-0000-4000-8000-0000000000e1",
  date: "2026-09-10",
  taux: "3.3456",
  unite: 1,
  source: REGLE_DE_CHANGE_D_ESSAI!.source,
  origine: "import",
  motif: null,
};

export const CAS_DE_MESURE: CasDeMesure[] = [
  ...depuisLeJeuDOr(),
  {
    nom: "achat simple, un taux et le timbre",
    provenance: "lecture d'essai du dépôt (`lecture-d-essai.ts`)",
    lecture: facture(SIMPLE),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "achat à deux taux et le timbre",
    provenance: "facture du 11 octobre 2026 (`un-total-illisible-n-efface-pas-la-facture.test.ts`)",
    lecture: facture(DEUX),
    attendu: DEUX_TAUX,
  },
  {
    nom: "le HT imprimé comprend le timbre (MYTEK)",
    provenance: "facture MYTEK du 26 octobre 2026 (`normaliser-montants.test.ts`)",
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "428,731" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "428,731",
      tva: "81,269",
      ttc: "510,000",
    }),
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "427.731", "0"],
        ["4366", "81.269", "0", "TVA19"],
        ["6654", "1.000", "0"],
        ["401", "0", "510.000"],
      ],
    },
  },
  {
    nom: "vente simple, un taux et le timbre",
    provenance: REPRODUIT,
    lecture: facture({
      sens: "facture_vente",
      lignes: [{ code: "TVA19", ht: "2 500,000" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "2 500,000",
      tva: "475,000",
      ttc: "2 976,000",
      articles: [{ designation: "Prestation de conseil, septembre" }],
    }),
    // Une prestation : 705 (`ventes.compte`, défaut du CEO), la base avec son taux.
    attendu: {
      journal: "VEN",
      lignes: [
        ["411", "2976.000", "0"],
        ["4367", "0", "475.000", "TVA19"],
        ["705", "0", "2500.000", "TVA19"],
        ["4371", "0", "1.000"],
      ],
    },
  },
  {
    nom: "vente de marchandises : 707, la base avec son taux",
    provenance: "réglage ventes.compte du 1er novembre 2026",
    lecture: facture({
      sens: "facture_vente",
      lignes: [{ code: "TVA19", ht: "2 500,000" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "2 500,000",
      tva: "475,000",
      ttc: "2 976,000",
      articles: [{ designation: "Farine de blé, sac 50 kg" }],
    }),
    attendu: {
      journal: "VEN",
      lignes: [
        ["411", "2976.000", "0"],
        ["4367", "0", "475.000", "TVA19"],
        ["707", "0", "2500.000", "TVA19"],
        ["4371", "0", "1.000"],
      ],
    },
  },
  {
    nom: "vente mêlée : une ligne par nature, chacune avec son taux, prouvée par les articles",
    provenance: "réglage ventes.compte du 1er novembre 2026",
    lecture: facture({
      sens: "facture_vente",
      lignes: [{ code: "TVA19", ht: "2 500,000" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "2 500,000",
      tva: "475,000",
      ttc: "2 976,000",
      articles: [
        { designation: "Prestation de maintenance", total_ht: "1800.000" },
        { designation: "Cartouche d'encre noire", total_ht: "700.000" },
      ],
    }),
    attendu: {
      journal: "VEN",
      lignes: [
        ["411", "2976.000", "0"],
        ["4367", "0", "475.000", "TVA19"],
        ["705", "0", "1800.000", "TVA19"],
        ["707", "0", "700.000", "TVA19"],
        ["4371", "0", "1.000"],
      ],
    },
  },
  {
    nom: "vente dont la nature ne se reconnaît pas : le repli, et la réserve qui le dit",
    provenance: "réglage ventes.compte du 1er novembre 2026",
    lecture: facture({
      sens: "facture_vente",
      lignes: [{ code: "TVA19", ht: "2 500,000" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "2 500,000",
      tva: "475,000",
      ttc: "2 976,000",
      articles: [{ designation: "Médicament vétérinaire" }],
    }),
    // L'écriture juste dépend de ce que le dossier vend : le Socle ne la
    // devine pas. Il propose le repli (701), et la réserve « nature de la
    // vente à préciser » : à trancher.
    attendu: {
      journal: "VEN",
      lignes: [
        ["411", "2976.000", "0"],
        ["4367", "0", "475.000", "TVA19"],
        ["707", "0", "2500.000", "TVA19"],
        ["4371", "0", "1.000"],
      ],
    },
    aTrancher: {
      reserve: "nature_de_vente",
      attendu: {
        journal: "VEN",
        lignes: [
          ["411", "2976.000", "0"],
          ["4367", "0", "475.000", "TVA19"],
          ["701", "0", "2500.000", "TVA19"],
          ["4371", "0", "1.000"],
        ],
      },
    },
  },
  {
    nom: "total illisible, la TVA vérifie le reste",
    provenance:
      "bande noire du 13 octobre 2026 (`un-total-illisible-n-efface-pas-la-facture.test.ts`)",
    lecture: facture({ ...SIMPLE, ttc: "+ 470,126" }),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "une proforma ne se comptabilise pas",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, titre: "FACTURE PROFORMA" }),
    attendu: null,
  },
  {
    nom: "une facture qui ne tient pas",
    provenance: REPRODUIT,
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "1 000,000" }],
      ht: "1 000,000",
      tva: "190,000",
      ttc: "1 250,000",
    }),
    attendu: null,
  },
  {
    nom: "TVA illisible, deux taux : HT et TTC la prouvent",
    provenance: `${REPRODUIT} (TVA « 572,883 » relue « + 72,883 »)`,
    lecture: facture({ ...DEUX, tva: "+ 72,883" }),
    attendu: DEUX_TAUX,
  },
  {
    nom: "TVA illisible, un taux : HT et TTC la prouvent",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, tva: "Z34,566" }),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "TVA illisible, et la facture ne tient pas : rien ne se déduit",
    provenance: REPRODUIT,
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "1 000,000" }],
      ht: "1 000,000",
      tva: "Z90,000",
      ttc: "1 250,000",
    }),
    attendu: null,
  },
  {
    nom: "aucune ligne par taux lue : le taux se retrouve",
    provenance: REPRODUIT,
    lecture: facture({
      lignes: [],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "1 000,000",
      tva: "190,000",
      ttc: "1 191,000",
    }),
    attendu: MILLE,
  },
  {
    nom: "code de taux inconnu du paramétrage : le taux se retrouve",
    provenance: `${REPRODUIT} (code « TVA_19 » rendu par la désignation)`,
    lecture: facture({
      lignes: [{ code: "TVA_19", ht: "1 000,000" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "1 000,000",
      tva: "190,000",
      ttc: "1 191,000",
    }),
    attendu: MILLE,
  },
  {
    nom: "TVA nulle sans ligne de taux : exonéré ou export, on ne choisit pas",
    provenance: REPRODUIT,
    lecture: facture({
      lignes: [],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "500,000",
      tva: "0,000",
      ttc: "501,000",
    }),
    attendu: null,
  },
  {
    nom: "deux taux, une base illisible : le HT du pied la prouve",
    provenance: REPRODUIT,
    lecture: facture({
      ...DEUX,
      lignes: [
        { code: "TVA07", ht: "864,700" },
        { code: "TVA19", ht: "2 6g6,600" },
      ],
    }),
    attendu: DEUX_TAUX,
  },
  {
    nom: "un total peu sûr que l'arithmétique vérifie",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, confiance: { "totals.ttc": 0.3 } }),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "un émetteur peu sûr : rien ne le vérifie",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, confiance: { issuer: 0.3 } }),
    attendu: null,
  },
  {
    // Le loyer de septembre reçu fin août partirait dans la déclaration de
    // septembre, encore à venir : la date se demande (revue de la PR 142).
    nom: "datée après sa réception (loyer facturé d'avance)",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, date: "2026-09-01", recueLe: "2026-08-28" }),
    attendu: null,
  },
  {
    nom: "datée après sa réception, dans la même période de TVA",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, date: "2026-09-20", recueLe: "2026-09-15" }),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "jour et mois inversés : 2026-11-09 pour une pièce reçue le 2026-09-30",
    provenance: "revue indépendante de la PR 142",
    lecture: facture({ ...SIMPLE, date: "2026-11-09", recueLe: "2026-09-30" }),
    attendu: null,
  },
  {
    nom: "lue « vente », émise par un tiers : le cabinet tranche",
    provenance: "facture du 5 octobre 2026 (`controles.ts`, sens de la pièce)",
    // La désignation a tout inversé, et de façon cohérente : le matricule du
    // dossier côté émetteur, celui du fournisseur côté client.
    lecture: facture({
      ...SIMPLE,
      sens: "facture_vente",
      emetteur: { nom: FOURNISSEUR.nom, identifiantFiscal: DOSSIER.identifiantFiscal },
      destinataire: { identifiantFiscal: FOURNISSEUR.identifiantFiscal },
    }),
    attendu: null,
  },
  {
    nom: "le timbre nommé, son montant non cité",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, droits: [{ code: "DROIT_TIMBRE", montant: null }] }),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "le timbre cité, illisible",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, droits: [{ code: "DROIT_TIMBRE", montant: "1,OOO" }] }),
    attendu: ACHAT_SIMPLE,
  },
  {
    nom: "le timbre illisible, et l'écart n'est pas un timbre",
    provenance: REPRODUIT,
    lecture: facture({
      ...SIMPLE,
      droits: [{ code: "DROIT_TIMBRE", montant: "1,OOO" }],
      ttc: "1 471,126",
    }),
    attendu: null,
  },
  {
    nom: "aucune ligne par taux lue, et aucun taux ne fait tenir la facture",
    provenance: REPRODUIT,
    lecture: facture({
      lignes: [],
      ht: "1 000,000",
      tva: "150,000",
      ttc: "1 150,000",
    }),
    attendu: null,
  },
  {
    // Revue de la PR 142 : 1 000 à 7 % + 1 000 à 19 % donnent 260 sur 2 000,
    // soit 13 % — un taux du paramétrage, et pourtant un MÉLANGE.
    nom: "aucune ligne par taux lue : 13 % peut être un mélange de 7 % et de 19 %",
    provenance: "revue indépendante de la PR 142",
    lecture: facture({
      lignes: [],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "2 000,000",
      tva: "260,000",
      ttc: "2 261,000",
    }),
    attendu: null,
  },
  {
    nom: "aucune ligne par taux lue, le total illisible : le taux ne se prouve pas",
    provenance: "revue indépendante de la PR 142",
    lecture: facture({
      lignes: [],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,000" }],
      ht: "1 000,000",
      tva: "190,000",
      ttc: "+ 191,000",
    }),
    attendu: null,
  },
  {
    nom: "deux inconnues : la TVA et le timbre illisibles",
    provenance: REPRODUIT,
    lecture: facture({
      ...SIMPLE,
      tva: "Z34,566",
      droits: [{ code: "DROIT_TIMBRE", montant: "1,OOO" }],
    }),
    attendu: null,
  },
  {
    nom: "un total peu sûr, sur une facture qui ne tient pas",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, ttc: "1 570,126", confiance: { "totals.ttc": 0.3 } }),
    attendu: null,
  },
  {
    nom: "datée trois mois après sa réception : la date est mal lue",
    provenance: REPRODUIT,
    lecture: facture({ ...SIMPLE, date: "2026-12-10", recueLe: "2026-09-15" }),
    attendu: null,
  },
  {
    // Avant le 30 octobre 2026, la normalisation lisait aussi « 100,000 » à
    // l'anglaise : sans timbre pour ancrer l'échelle, dinars et milliers de
    // dinars vérifiaient tous deux la facture, et rien n'était proposé. La
    // virgule du dinar est décimale ; mais lus à l'anglaise, les montants
    // tiennent aussi : décidé par la convention, donc en réserve (revue de la
    // PR 144).
    nom: "montants ronds à la virgule, sans timbre : la virgule du dinar est décimale",
    reserve: "coherence_arithmetique",
    provenance: `${REPRODUIT} (lecteurs de montants unifiés)`,
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "100,000" }],
      ht: "100,000",
      tva: "19,000",
      ttc: "119,000",
    }),
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "100.000", "0"],
        ["4366", "19.000", "0", "TVA19"],
        ["401", "0", "119.000"],
      ],
    },
  },
  {
    // Revue de la PR 144 (Codex) : le timbre que le paramétrage fixe à 1,000
    // s'imprime 2,000. Il ne tombe pas sur sa valeur : il n'ancre pas
    // l'échelle, et lus à l'anglaise les montants tiennent encore. La seule
    // présence d'un montant attendu taisait la convention. La réserve doit se
    // poser ; et aucune écriture : le moteur inscrit le timbre à sa valeur
    // fixée, que la pièce contredit — le cabinet tranche.
    // Depuis le barème daté (`timbre.bareme`, 1er novembre 2026), 2,000 sur
    // 121 D est le tarif des grandes surfaces (cas suivant) : la pièce imprime
    // donc 3,000, le tarif d'aucune catégorie, pour garder le même défaut.
    nom: "un timbre imprimé à une autre valeur que celle fixée : il n'ancre pas l'échelle",
    reserve: "coherence_arithmetique",
    provenance: `${REPRODUIT} (revue de la PR 144)`,
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "100,000" }],
      ht: "100,000",
      tva: "19,000",
      droits: [{ code: "DROIT_TIMBRE", montant: "3,000" }],
      ttc: "122,000",
    }),
    attendu: null,
  },
  {
    // Le barème daté du timbre (1er novembre 2026) : 2,000 sur une facture de
    // plus de 100 D est le tarif des grandes surfaces (CDET art. 117-I-6 bis).
    // L'émetteur n'est classé nulle part : l'écriture se propose au timbre
    // imprimé, avec la réserve qui dit la catégorie à préciser — jamais devinée.
    nom: "un timbre au tarif des grandes surfaces, l'émetteur non classé : la réserve le dit",
    reserve: "categorie_d_emetteur",
    provenance: "barème daté du timbre, réglage timbre.bareme (bareme_date)",
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "100,000" }],
      ht: "100,000",
      tva: "19,000",
      droits: [{ code: "DROIT_TIMBRE", montant: "2,000" }],
      ttc: "121,000",
    }),
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "100.000", "0"],
        ["4366", "19.000", "0", "TVA19"],
        ["6654", "2.000", "0"],
        ["401", "0", "121.000"],
      ],
    },
  },
  {
    // Revue de la PR 144 (Codex), le même défaut par une autre branche : le HT
    // imprimé comprend un droit qu'aucun montant fixé n'ancre (FODEC). La base
    // taxable se déduit (101,000 − 1,000) ; lus à l'anglaise, les montants
    // tiennent aussi. La branche rendait sa lecture avant le contrôle de la
    // convention : « conforme », en silence.
    nom: "le HT imprimé comprend un droit non fixé : la convention décide, et se dit",
    reserve: "coherence_arithmetique",
    provenance: `${REPRODUIT} (revue de la PR 144)`,
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "101,000" }],
      ht: "101,000",
      tva: "19,000",
      droits: [{ code: "FODEC", montant: "1,000" }],
      ttc: "120,000",
    }),
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "100.000", "0"],
        ["4366", "19.000", "0", "TVA19"],
        ["6652", "1.000", "0"],
        ["401", "0", "120.000"],
      ],
    },
  },
  {
    // Jeu synthétique, 31 octobre 2026 (cas 005, 017, 042, 081) : le FODEC
    // entre dans la base de la TVA, comme le référentiel le dit
    // (`ref.fiscal_charges.taxable`). L'équation l'ignorait : « incohérente ».
    nom: "un FODEC dans la base de la TVA, comme le référentiel le dit",
    provenance: "jeu synthétique, cas 005",
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "1 000,000" }],
      ht: "1 000,000",
      tva: "191,900",
      droits: [
        { code: "FODEC", montant: "10,000" },
        { code: "DROIT_TIMBRE", montant: "1,000" },
      ],
      ttc: "1 202,900",
    }),
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "1000.000", "0"],
        ["4366", "191.900", "0", "TVA19"],
        ["6652", "10.000", "0"],
        ["6654", "1.000", "0"],
        ["401", "0", "1202.900"],
      ],
    },
  },
  {
    // Négatif comptable, ou base entre parenthèses (« (base 514,700) », le
    // 15 octobre 2026) : le texte ne dit pas le signe, rien ne se propose.
    nom: "des montants entre parenthèses : le signe ne se devine pas",
    provenance: `${REPRODUIT} (lecteurs de montants unifiés)`,
    lecture: facture({
      ...SIMPLE,
      lignes: [{ code: "TVA19", ht: "(1 234,560)" }],
      ht: "(1 234,560)",
      tva: "(234,566)",
      ttc: "(1 470,126)",
    }),
    attendu: null,
  },
  {
    nom: "titrée AVOIR, aux montants positifs : jamais un achat",
    provenance: "revue indépendante de la PR 144",
    lecture: facture({ ...SIMPLE, titre: "AVOIR N° A-2026-0007" }),
    attendu: null,
    // Lié à sa facture (`avoirs.traitement`, défaut du CEO) : sans facture
    // rattachée — la mesure n'a pas de base —, rien ne se propose, et la raison
    // le nomme.
    refus: "proposition/facture_d_origine",
  },
  {
    /*
     * Jeu synthétique, 31 octobre 2026 : un avoir arabe titré « إشعار دائن »
     * se proposait en ACHAT — `ref.titres_de_piece` ne connaissait que des
     * titres français. Le pire résultat : une écriture fausse, sans réserve.
     */
    nom: "titré « إشعار دائن » (avoir, en arabe), aux montants positifs : jamais un achat",
    provenance: "jeu synthétique, cas 047 (outils/jeu-synthetique/cas/047.json)",
    lecture: facture({ ...SIMPLE, titre: "إشعار دائن رقم 2026/0045" }),
    attendu: null,
    refus: "proposition/facture_d_origine",
  },
  {
    /*
     * Le même avoir, quand son titre est PERDU (31 octobre 2026) : la couche
     * de texte d'un PDF imprimé par Chromium rend ses glyphes liés sans
     * correspondance Unicode. Aucun titre ne s'y reconnaissait, et la pièce
     * passait pour une facture, par défaut. Le haut de la pièce est relevé
     * ici tel que la couche le rendait (cas 047), en échappements.
     */
    nom: "un titre perdu (glyphes sans Unicode) ne fait pas une facture : jamais un achat",
    provenance: "jeu synthétique, cas 047 (outils/jeu-synthetique/rendus/047.pdf)",
    lecture: facture({
      ...SIMPLE,
      titre: "ﺎ\u0000 \u0000 ﻨ راعشإ\u0000 2026/1524",
    }),
    attendu: null,
    refus: "nature_piece",
  },
  {
    /*
     * Jeu synthétique, 31 octobre 2026 (cas 007, 071, 083) : un serveur
     * acheté partait en charge, en silence. Le Socle ne tranche pas entre
     * charge et immobilisation — aucune règle de capitalisation n'est écrite —,
     * il propose l'imputation du paramétrage ET la réserve qui dit la
     * question (`ref.biens_immobilisables`). L'écriture du comptable, si le
     * cabinet immobilise, est au compte 2282 (INCERTAIN, référentiel
     * complémentaire du jeu).
     */
    nom: "un serveur acheté : l'imputation du paramétrage, et la question à trancher",
    provenance: "jeu synthétique, cas 007 (outils/jeu-synthetique/cas/007.json)",
    lecture: {
      ...facture(SIMPLE),
      payload: {
        ...facture(SIMPLE).payload,
        articles: [{ designation: "Serveur de stockage en baie" }],
      } as LectureAJuger["payload"],
    },
    attendu: {
      journal: "ACH",
      lignes: [
        ["2282", "1234.560", "0"],
        ["4366", "234.566", "0", "TVA19"],
        ["6654", "1.000", "0"],
        ["401", "0", "1470.126"],
      ],
    },
    aTrancher: {
      reserve: "immobilisation_a_trancher",
      attendu: {
        journal: "ACH",
        lignes: [
          ["601", "1234.560", "0"],
          ["4366", "234.566", "0", "TVA19"],
          ["6654", "1.000", "0"],
          ["401", "0", "1470.126"],
        ],
      },
    },
  },
  {
    nom: "un avoir aux montants négatifs : un avoir, pas une facture incohérente",
    provenance: "revue indépendante de la PR 144",
    lecture: facture({
      ...SIMPLE,
      lignes: [{ code: "TVA19", ht: "-1 234,560" }],
      ht: "-1 234,560",
      tva: "-234,566",
      ttc: "-1 470,126",
    }),
    attendu: null,
  },
  {
    nom: "un avoir coupé par la citation : « 1 234,560) » ne se lit pas positif",
    provenance: "revue indépendante de la PR 144",
    lecture: facture({
      ...SIMPLE,
      lignes: [{ code: "TVA19", ht: "1 234,560)" }],
      ht: "1 234,560)",
      tva: "234,566)",
      ttc: "1 470,126)",
    }),
    attendu: null,
  },
  {
    nom: "une base seule en chiffres arabes, que rien ne vérifie",
    provenance: "revue indépendante de la PR 144 (chiffres que le modèle de vision inverse)",
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "٤ ٣٢١٫٥٦٥" }],
      ht: "٤ ٣٢١٫٥٦٥",
      tva: null,
      ttc: null,
    }),
    attendu: null,
  },
  {
    nom: "des euros imprimés, aucune devise lue : jamais des dinars",
    provenance: "revue indépendante de la PR 144",
    lecture: facture({
      currency: null,
      lignes: [{ code: "TVA19", ht: "100,00 €" }],
      ht: "100,00 €",
      tva: "19,00 €",
      ttc: "119,00 €",
    }),
    attendu: null,
  },
  {
    nom: "des euros imprimés, des dinars lus : la devise imprimée contredit la devise lue",
    provenance: "revue indépendante de la PR 144",
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "100,00 €" }],
      ht: "100,00 €",
      tva: "19,00 €",
      ttc: "119,00 €",
    }),
    attendu: null,
  },
  {
    // Sans cours : rien ne se propose, et la raison nomme le cours à saisir.
    nom: "facture en euros pour un dossier en dinars",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "EUR",
      lignes: [{ code: "TVA19", ht: "1 000,00" }],
      ht: "1 000,00",
      tva: "190,00",
      ttc: "1 190,00",
    }),
    attendu: null,
    refus: "proposition/taux_de_change",
  },
  /*
   * ======================================== LES PIÈCES EN DEVISE (31 octobre 2026)
   *
   * Les écritures attendues sont calculées à la main : chaque montant
   * imprimé × le taux ÷ l'unité, arrondi au millime au plus proche, à
   * égalité au pair ; la TVA et le total tels quels, l'écart sur la plus
   * grande base (`change.ecart`). Les cours sont FICTIFS : un cours est une
   * donnée, aucun n'est livré.
   */
  {
    nom: "facture en euros, cours du jour : convertie au millime, réserve « taux de change »",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "EUR",
      lignes: [{ code: "TVA19", ht: "1 000,00 €" }],
      ht: "1 000,00 €",
      tva: "190,00 €",
      ttc: "1 190,00 €",
    }),
    cours: COURS_EUR,
    reserve: "cours_de_change",
    // 1 000,00 × 3,3456 = 3 345,600 ; 190,00 × 3,3456 = 635,664 ; 1 190,00 × 3,3456 = 3 981,264.
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "3345.600", "0"],
        ["4366", "635.664", "0", "TVA19"],
        ["401", "0", "3981.264"],
      ],
      origines: [
        ["601", "1000.00"],
        ["4366", "190.00"],
        ["401", "1190.00"],
      ],
    },
  },
  {
    nom: "vente en euros : le client au total converti, la TVA collectée convertie",
    provenance: REPRODUIT,
    lecture: facture({
      sens: "facture_vente",
      currency: "EUR",
      lignes: [{ code: "TVA19", ht: "2 000,00" }],
      ht: "2 000,00",
      tva: "380,00",
      ttc: "2 380,00",
      articles: [{ designation: "Huile d'olive en vrac, tonne" }],
    }),
    cours: COURS_EUR,
    reserve: "cours_de_change",
    // 2 000,00 × 3,3456 = 6 691,200 ; 380,00 × 3,3456 = 1 271,328 ; 2 380,00 × 3,3456 = 7 962,528.
    // Une marchandise : 707, la base avec son taux.
    attendu: {
      journal: "VEN",
      lignes: [
        ["411", "7962.528", "0"],
        ["4367", "0", "1271.328", "TVA19"],
        ["707", "0", "6691.200", "TVA19"],
      ],
    },
  },
  {
    nom: "facture en dollars : l'écart d'arrondi de la conversion va à la base",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "USD",
      lignes: [{ code: "TVA19", ht: "333.33 US$" }],
      ht: "333.33 US$",
      tva: "63.33 US$",
      ttc: "396.66 US$",
    }),
    cours: {
      ...COURS_EUR,
      devise: "USD",
      id: "00000000-0000-4000-8000-0000000000d1",
      taux: "3.0125",
    },
    reserve: "cours_de_change",
    /*
     * 333,33 × 3,0125 = 1 004,1566… → 1 004,157 ; 63,33 × 3,0125 = 190,7816… →
     * 190,782 ; 396,66 × 3,0125 = 1 194,9382… → 1 194,938. 1 004,157 +
     * 190,782 = 1 194,939 : un millime de trop, retiré de la base (1 004,156).
     */
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "1004.156", "0"],
        ["4366", "190.782", "0", "TVA19"],
        ["401", "0", "1194.938"],
      ],
      origines: [
        ["601", "333.33"],
        ["4366", "63.33"],
        ["401", "396.66"],
      ],
    },
  },
  {
    nom: "facture en dollars sans cours : rien ne se propose, le cours à saisir",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "USD",
      lignes: [{ code: "TVA19", ht: "333.33" }],
      ht: "333.33",
      tva: "63.33",
      ttc: "396.66",
    }),
    attendu: null,
    refus: "proposition/taux_de_change",
  },
  {
    nom: "un demi-millime exact s'arrondit au pair, jamais vers le haut",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "EUR",
      lignes: [{ code: "TVA19", ht: "100,25" }],
      ht: "100,25",
      tva: "19,05",
      ttc: "119,30",
    }),
    cours: { ...COURS_EUR, taux: "3.345" },
    reserve: "cours_de_change",
    /*
     * 119,30 × 3,345 = 399,0585 : au pair, 399,058 (vers le haut : 399,059).
     * 100,25 × 3,345 = 335,33625 → 335,336 ; 19,05 × 3,345 = 63,72225 → 63,722 ;
     * 335,336 + 63,722 = 399,058 : aucun écart.
     */
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "335.336", "0"],
        ["4366", "63.722", "0", "TVA19"],
        ["401", "0", "399.058"],
      ],
    },
  },
  {
    nom: "facture en francs CFA, cours pour 1 000 : de l'unité au millime",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "XOF",
      lignes: [{ code: "TVA19", ht: "1 000 000 F CFA" }],
      ht: "1 000 000 F CFA",
      tva: "190 000 F CFA",
      ttc: "1 190 000 F CFA",
    }),
    cours: {
      ...COURS_EUR,
      devise: "XOF",
      id: "00000000-0000-4000-8000-0000000000c1",
      taux: "5.0123",
      unite: 1000,
    },
    reserve: "cours_de_change",
    // 5,0123 pour 1 000 F CFA : 5 012,300 ; 952,337 ; 5 964,637.
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "5012.300", "0"],
        ["4366", "952.337", "0", "TVA19"],
        ["401", "0", "5964.637"],
      ],
      origines: [
        ["601", "1000000"],
        ["4366", "190000"],
        ["401", "1190000"],
      ],
    },
  },
  {
    nom: "un droit de timbre imprimé en euros n'est pas le timbre du pack",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "EUR",
      lignes: [{ code: "TVA19", ht: "1 000,00" }],
      droits: [{ code: "DROIT_TIMBRE", montant: "1,00" }],
      ht: "1 000,00",
      tva: "190,00",
      ttc: "1 191,00",
    }),
    cours: COURS_EUR,
    // Converti, le « timbre » vaut 3,346 DT, quand le pack le fixe à 1,000 DT.
    attendu: null,
    refus: "proposition/droit_fixe_en_devise",
  },
  /*
   * ============================== CAS ADVERSES (revue de #148, 31 octobre 2026)
   *
   * Plusieurs lignes, plusieurs taux, une devise d'arrivée SANS décimale
   * (un dossier tenu en francs CFA), une devise de départ à deux décimales.
   * La TVA de chaque taux est celle de la facture au cours ; les lignes se
   * partagent bases et TVA par sommes cumulées ; l'écart va à la plus grande
   * base. Calculs refaits à la main, montant par montant.
   */
  {
    nom: "trois lignes, deux taux, en euros, pour un dossier tenu en francs CFA",
    provenance: REPRODUIT,
    deviseDuDossier: "XOF",
    lecture: facture({
      currency: "EUR",
      lignes: [
        { code: "TVA19", ht: "10,01" },
        { code: "TVA07", ht: "10,01" },
        { code: "TVA19", ht: "10,01" },
      ],
      ht: "30,03",
      tva: "4,50",
      ttc: "34,53",
    }),
    cours: { ...COURS_EUR, id: "00000000-0000-4000-8000-0000000000e2", taux: "655.957" },
    reserve: "cours_de_change",
    /*
     * À 655,957 : TVA 19 % de la facture 3,80 € → 2 492,64 → 2 493 ; TVA 7 %
     * 0,70 € → 459,17 → 459 ; bases 30,03 € → 19 698,39 → 19 698 ; total
     * 34,53 € → 22 650,19 → 22 650 = 19 698 + 2 493 + 459 : aucun écart.
     */
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "19698", "0"],
        ["4366", "2493", "0", "TVA19"],
        ["4366", "459", "0", "TVA07"],
        ["401", "0", "22650"],
      ],
      origines: [
        ["601", "30.03"],
        ["4366", "3.80"],
        ["4366", "0.70"],
        ["401", "34.53"],
      ],
    },
  },
  {
    nom: "deux lignes, deux taux, en dollars : la TVA de chaque taux, l'écart à la plus grande base",
    provenance: REPRODUIT,
    lecture: facture({
      currency: "USD",
      lignes: [
        { code: "TVA19", ht: "333.33" },
        { code: "TVA07", ht: "100.01" },
      ],
      ht: "433.34",
      tva: "70.33",
      ttc: "503.67",
    }),
    cours: {
      ...COURS_EUR,
      devise: "USD",
      id: "00000000-0000-4000-8000-0000000000d2",
      taux: "3.0125",
    },
    reserve: "cours_de_change",
    /*
     * À 3,0125 : TVA 19 % 63,33 → 190,782 ; TVA 7 % 7,00 → 21,0875 → 21,088
     * (au pair) ; bases 433,34 → 1 305,437 ; total 503,67 → 1 517,306.
     * 1 305,437 + 190,782 + 21,088 = 1 517,307 : un millième de trop, retiré
     * de la base (1 305,436).
     */
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "1305.436", "0"],
        ["4366", "190.782", "0", "TVA19"],
        ["4366", "21.088", "0", "TVA07"],
        ["401", "0", "1517.306"],
      ],
    },
  },
  {
    nom: "soixante lignes de 0,01 € pour un dossier en francs CFA : aucune base négative",
    provenance: "revue indépendante de la PR 148 (−53 F CFA d'écart sur une base)",
    deviseDuDossier: "XOF",
    lecture: facture({
      currency: "EUR",
      lignes: Array.from({ length: 60 }, () => ({ code: "TVA19", ht: "0,01" })),
      ht: "0,60",
      tva: "0,00",
      ttc: "0,60",
    }),
    cours: { ...COURS_EUR, id: "00000000-0000-4000-8000-0000000000e3", taux: "655.957" },
    reserve: "cours_de_change",
    // 0,60 € à 655,957 = 393,57 → 394 F CFA de bases, réparties ; aucune TVA (0,0019 € par ligne).
    attendu: {
      journal: "ACH",
      lignes: [
        ["601", "394", "0"],
        ["401", "0", "394"],
      ],
    },
  },
];

/* ------------------------------------------------------------- la mesure */

export type Issue =
  | { type: "exacte" }
  /** L'écriture du paramétrage, avec la réserve qui dit la question à trancher (`aTrancher`). */
  | { type: "a_trancher"; reserve: string }
  | { type: "fausse"; cause: string }
  | { type: "refus_juste"; motif: string }
  | { type: "aucune"; motif: string };

/** Pourquoi rien n'est proposé, en un code : le contrôle en défaut, précisé. */
function motifDuRefus(
  jugement: ReturnType<typeof jugerLaLecture>,
  raisonCode: string | undefined,
): string {
  const n = jugement.normalisation;
  const sousMotif = (): string => {
    if (n.etat === "illisible") {
      if (/aucune base par taux|taux de TVA à préciser/.test(n.raison)) return "taux_non_lu";
      if (/taux « .* » inconnu/.test(n.raison)) return "taux_inconnu";
      if (/un HT est absent/.test(n.raison)) return "base_absente";
      const illisible = /montant illisible « (.*?) »/.exec(n.raison)?.[1];
      if (illisible === n.imprime.tva) return "tva_illisible";
      if (n.imprime.autres.includes(illisible ?? null)) return "droit_illisible";
      if (n.imprime.bases.includes(illisible ?? null)) return "base_illisible";
      return "illisible";
    }
    return n.etat;
  };
  const bloquants = jugement.motifs.filter(
    (m) => m.statut !== "reserve" && m.statut !== "conforme",
  );
  if (bloquants.length > 0)
    return bloquants
      .map((m) => (m.code === "coherence_arithmetique" ? `${m.code}/${sousMotif()}` : m.code))
      .join("+");
  if (n.etat !== "tranche" && n.etat !== "non_verifie") return `normalisation/${sousMotif()}`;
  // Le code stable de la proposition (`RaisonSansEcriture`), jamais sa phrase :
  // une expression régulière sur la phrase classait un timbre en euros parmi
  // les déséquilibres quelconques (revue de #148).
  return `proposition/${raisonCode ?? "autre"}`;
}

const decimal = (s: string) => Number(s).toFixed(6);
const cleDeLigne = (l: LigneAttendue) => `${l[0]}|${decimal(l[1])}|${decimal(l[2])}|${l[3] ?? ""}`;

/** Juge un cas sur la vraie chaîne, avec le référentiel d'essai. */
export function juger(cas: CasDeMesure) {
  // Les droits fixés du sens retenu, comme `analyserPiece`.
  const sens = cas.lecture.sensDit ?? cas.lecture.payload.document_kind;
  return jugerLaLecture(cas.lecture, {
    parametres: PARAMETRES_D_ESSAI,
    taux: new Map(TAUX_D_ESSAI.map((t) => [t.code, t.rate])),
    deviseDuDossier: cas.deviseDuDossier ?? DEVISE_DU_DOSSIER,
    droitsFixes: new Map(
      DROITS_D_ESSAI.flatMap((d) =>
        d.fixedAmount !== null && d.documentKind === sens ? [[d.code, d.fixedAmount] as const] : [],
      ),
    ),
    droitsTaxables: new Set(
      DROITS_D_ESSAI.filter((d) => d.taxable && d.documentKind === sens).map((d) => d.code),
    ),
    tenant: cas.dossier ?? DOSSIER,
    typesDocument: TYPES_D_ESSAI,
    titres: TITRES_D_ESSAI,
    biensImmobilisables: BIENS_IMMOBILISABLES_D_ESSAI,
    // Les réglages du pack d'essai (`ref.socle_params`, relevés) : le seuil et
    // le traitement d'un bien de faible valeur entrent dans l'empreinte du
    // jugement, donc dans `REGLES_DU_JUGEMENT`.
    immobilisation: reglageDImmobilisation(REGLAGES_D_ESSAI, {
      pack: "pack-d-essai",
      jour: JOUR_DU_RELEVE_D_ESSAI,
      nonAssujetti: false,
    }),
    avoirs: reglageDesAvoirs(REGLAGES_D_ESSAI, {
      pack: "pack-d-essai",
      jour: JOUR_DU_RELEVE_D_ESSAI,
    }),
    mentionsObligatoires: MENTIONS_D_ESSAI,
    doublonProbable: null,
    devises: DEVISES_LUES_D_ESSAI,
    // La règle du pack, et le cours que la base rendrait pour cette pièce.
    change: {
      regle: REGLE_DE_CHANGE_D_ESSAI,
      pack: "pack-d-essai",
      jourDuParametrage: cas.lecture.date ?? cas.lecture.recueLe,
      // La règle brute ne sert qu'à la péremption en base : sans base, rien.
      regleBrute: null,
      jour: REGLE_DE_CHANGE_D_ESSAI
        ? jourDuCours(REGLE_DE_CHANGE_D_ESSAI, cas.lecture.date, cas.lecture.recueLe)
        : null,
      cours: new Map(cas.cours ? [[cas.cours.devise, cas.cours]] : []),
    },
  });
}

/** Joue un cas sur la vraie chaîne, et compare à ce que la pièce imprime. */
export function jouer(cas: CasDeMesure): Issue {
  const jugement = juger(cas);
  // L'exposant de la devise que le jugement a décidée, comme `propositionDePiece`.
  const decimales =
    DEVISES_LUES_D_ESSAI.find((d) => d.code === jugement.normalisation.devise)?.decimales ?? null;
  const p = composerLaProposition(
    {
      pieceId: "00000000-0000-4000-8000-000000000000",
      payload: cas.lecture.payload as Record<string, unknown>,
      verdict: jugement.verdict,
      motifs: jugement.motifs,
      normalisation: jugement.normalisation,
      sensDit: cas.lecture.sensDit,
      date: cas.lecture.date,
      controles: jugement.controles,
    },
    {
      packVersionId: "pack-d-essai",
      deviseDuDossier: cas.deviseDuDossier ?? DEVISE_DU_DOSSIER,
      // Une devise inconnue : le jugement a déjà refusé, rien ne se compose.
      decimales: decimales ?? 0,
      decimalesDuDossier: DEVISES_D_ESSAI[cas.deviseDuDossier ?? DEVISE_DU_DOSSIER]!.exposant,
      confianceReserve: PARAMETRES_D_ESSAI["lecture.confiance_reserve"],
      confianceBloquante: PARAMETRES_D_ESSAI["lecture.confiance_bloquante"],
      taxRates: TAUX_D_ESSAI,
      mappings: IMPUTATIONS_D_ESSAI,
      fiscalCharges: DROITS_D_ESSAI,
      compteDeNature: null,
      tvaNonDeductible: false,
      // Le FODEC d'achat au compte du pack : les cas mesurés l'attendent là
      // (« INCERTAIN — FODEC à l'achat imputé au compte du pack »). Le réglage
      // du cabinet a ses épreuves (`reglages-comptables.test.ts`).
      droitsAuCout: [],
      // Les comptes de vente par nature, au défaut du pack (`ventes.compte`).
      ventes: ((option) => (option ? { option, natures: NATURES_DE_VENTE_D_ESSAI } : null))(
        optionDesVentes(REGLAGES_D_ESSAI),
      ),
      // Le timbre au barème daté du pack (`timbre.bareme`). Sans base, aucun
      // tiers n'est classé : l'émetteur est « non classé », comme chez un
      // dossier dont le cabinet n'a pas encore classé ses fournisseurs.
      timbre:
        optionDuTimbre(REGLAGES_D_ESSAI) === "bareme_date"
          ? { bareme: BAREME_DES_DROITS_D_ESSAI, categorie: null }
          : null,
      // Un avoir lié se propose depuis l'écriture de sa facture, en base :
      // sans base, aucune facture n'est rattachée.
      avoir: null,
    },
  );
  // La réserve attendue se vérifie aussi sur un refus : un refus juste dont le
  // jugement tait le doute n'est pas juste.
  // Une réserve se dit au jugement, ou sur la proposition (la nature d'une vente).
  const reserveDite = (code: string) =>
    jugement.motifs.some((m) => m.code === code && m.statut === "reserve") ||
    (p.ok && (p.reserves ?? []).some((x) => x.code === code));
  const reserveAbsente = cas.reserve !== undefined && !reserveDite(cas.reserve);
  if (!p.ok) {
    const motif = motifDuRefus(jugement, p.raisonCode);
    if (cas.attendu === null && reserveAbsente)
      return { type: "aucune", motif: `${motif} — réserve « ${cas.reserve} » attendue, absente` };
    if (cas.attendu === null && cas.refus !== undefined && motif !== cas.refus)
      return { type: "aucune", motif: `${motif} — refus « ${cas.refus} » attendu` };
    return cas.attendu === null ? { type: "refus_juste", motif } : { type: "aucune", motif };
  }
  if (cas.attendu === null)
    return { type: "fausse", cause: "proposée alors que rien ne devait l'être" };
  const e = p.proposition!;
  const lues = e.lignes
    .map((l) => cleDeLigne([l.account_code, l.debit, l.credit, l.tax_code ?? ""]))
    .sort();
  const attendues = cas.attendu.lignes.map(cleDeLigne).sort();
  const causes: string[] = [];
  if (e.journal !== cas.attendu.journal)
    causes.push(`journal ${e.journal} ≠ ${cas.attendu.journal}`);
  if (lues.join() !== attendues.join())
    causes.push(`lignes ${lues.join(" ; ")} ≠ ${attendues.join(" ; ")}`);
  if (reserveAbsente) causes.push(`réserve « ${cas.reserve} » attendue, absente`);
  // Une pièce en devise : chaque ligne dit son montant d'origine, et le cours.
  const origines = (cas.attendu.origines ?? []).map(([c, m]) => `${c}|${decimal(m)}`).sort();
  const originesLues = e.lignes
    .flatMap((l) => (l.montant_origine ? [`${l.account_code}|${decimal(l.montant_origine)}`] : []))
    .sort();
  if (cas.attendu.origines && origines.join() !== originesLues.join())
    causes.push(`origines ${originesLues.join(" ; ")} ≠ ${origines.join(" ; ")}`);
  if (cas.cours && e.lignes.some((l) => l.cours_id !== cas.cours!.id))
    causes.push(`cours appliqué ≠ ${cas.cours.id}`);
  if (!cas.cours && e.lignes.some((l) => l.devise_origine))
    causes.push("une devise d'origine sans pièce en devise");
  if (causes.length === 0) return { type: "exacte" };
  // La question que le Socle ne tranche pas : l'écriture du paramétrage, au
  // millime, ET la réserve qui la nomme. Rien d'autre n'y passe.
  const t = cas.aTrancher;
  if (
    t &&
    e.journal === t.attendu.journal &&
    lues.join() === t.attendu.lignes.map(cleDeLigne).sort().join() &&
    reserveDite(t.reserve)
  )
    return { type: "a_trancher", reserve: t.reserve };
  return { type: "fausse", cause: causes.join(" · ") };
}

export interface Mesure {
  total: number;
  proposees: number;
  exactes: number;
  /** Proposées avec la réserve qui dit la question à trancher (`aTrancher`). */
  aTrancher: number;
  /** Les cas dont l'écriture attendue existe : la base du taux d'exactitude. */
  attendues: number;
  parCas: Record<string, Issue>;
  motifs: Record<string, number>;
}

export function mesurer(cas: readonly CasDeMesure[] = CAS_DE_MESURE): Mesure {
  const parCas: Record<string, Issue> = {};
  const motifs: Record<string, number> = {};
  for (const c of cas) {
    const issue = jouer(c);
    parCas[c.nom] = issue;
    if (issue.type === "aucune") motifs[issue.motif] = (motifs[issue.motif] ?? 0) + 1;
  }
  const issues = Object.values(parCas);
  return {
    total: cas.length,
    proposees: issues.filter(
      (i) => i.type === "exacte" || i.type === "a_trancher" || i.type === "fausse",
    ).length,
    exactes: issues.filter((i) => i.type === "exacte").length,
    aTrancher: issues.filter((i) => i.type === "a_trancher").length,
    attendues: cas.filter((c) => c.attendu !== null).length,
    parCas,
    motifs,
  };
}

/** Un JSON dont les clés sont triées : l'empreinte ne dépend pas de l'ordre d'écriture. */
const enJsonStable = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

/**
 * L'empreinte de ce que le jugement rend sur le témoin : normalisation,
 * contrôles, verdict et motifs de chaque cas. Elle change dès qu'une règle
 * change un jugement — et `REGLES_DU_JUGEMENT` (analyse.ts) la porte.
 */
export function empreinteDesJugements(cas: readonly CasDeMesure[] = CAS_DE_MESURE): string {
  const jugements = cas.map((c) => ({ nom: c.nom, ...juger(c) }));
  return createHash("sha256").update(enJsonStable(jugements)).digest("hex");
}

/** Le rapport, en clair : ce que l'épreuve imprime. */
export function rapport(m: Mesure): string {
  const pc = (n: number, d: number) => `${n}/${d} (${d === 0 ? 0 : Math.round((100 * n) / d)} %)`;
  const justes = Object.values(m.parCas).filter(
    (i) => i.type === "exacte" || i.type === "refus_juste",
  ).length;
  return [
    `pièces : ${m.total}`,
    `proposées : ${pc(m.proposees, m.total)}`,
    `exactes (sur les pièces qui ont une écriture juste) : ${pc(m.exactes, m.attendues)}`,
    `à trancher (l'écriture du paramétrage, et la réserve qui dit la question) : ${m.aTrancher}`,
    `issue juste (écriture exacte, ou refus juste) : ${pc(justes, m.total)}`,
    "motifs sans proposition :",
    ...Object.entries(m.motifs)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([motif, n]) => `  ${n} × ${motif}`),
    "par pièce :",
    ...Object.entries(m.parCas).map(
      ([nom, i]) =>
        `  ${i.type.padEnd(11)} ${nom}${"motif" in i ? ` — ${i.motif}` : ""}${"cause" in i ? ` — ${i.cause}` : ""}${"reserve" in i ? ` — réserve « ${i.reserve} »` : ""}`,
    ),
  ].join("\n");
}
