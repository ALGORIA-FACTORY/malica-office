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
import {
  DROITS_D_ESSAI,
  DEVISE_D_ESSAI,
  IMPUTATIONS_D_ESSAI,
  MENTIONS_D_ESSAI,
  PARAMETRES_D_ESSAI,
  TAUX_D_ESSAI,
  TITRES_D_ESSAI,
  TYPES_D_ESSAI,
} from "./referentiel-d-essai.ts";
import { JEU_D_OR } from "../malica/lecture/jeu-d-or.ts";
import { buildExtractFromTokenPlan } from "../malica/lecture/read-piece.ts";
import { texteDuMontantCite } from "../malica/lecture/token-plan.ts";
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
  /** L'écriture juste, calculée à la main ; null : ne rien proposer est juste. */
  attendu: { journal: string; lignes: LigneAttendue[] } | null;
  /**
   * Le contrôle qui DOIT poser une réserve : une écriture exacte sans elle est
   * fausse — la pièce passerait sans que le cabinet sache pourquoi douter.
   */
  reserve?: string;
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
      articles: [],
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

/** Le jeu d'or, joué comme la production : désignation relue au plan, citations, confiance. */
function depuisLeJeuDOr(): CasDeMesure[] {
  return JEU_D_OR.map((cas) => {
    const lu = buildExtractFromTokenPlan({
      tokens: cas.tokens,
      selection: cas.designation,
      ...devisesDEssai(cas.decimales),
      matriculeDossier: cas.matriculeDossier,
    });
    // Le texte de chaque citation, comme `analyserPiece` le relit.
    const textes = new Map<string, string[]>();
    for (const c of lu.citations) {
      const texte = texteDuMontantCite(cas.tokens, c);
      if (texte !== null) textes.set(c.field, [...(textes.get(c.field) ?? []), texte]);
    }
    const premiere = Math.min(...cas.tokens.map((t) => t.page));
    const haut = cas.tokens
      .filter((t) => t.page === premiere && t.y0 <= HAUT_DE_PAGE)
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      .map((t) => t.text);
    const extrait = lu.extract as LectureAJuger["payload"];
    return {
      nom: `jeu d'or — ${cas.nom}`,
      provenance: cas.provenance,
      dossier: { nom: DOSSIER.nom, identifiantFiscal: cas.matriculeDossier ?? "" },
      lecture: {
        payload: extrait,
        imprime: (champ) => textes.get(champ)?.join(" ") ?? null,
        titre: haut.join(" ") || null,
        sensDit: null,
        date: extrait.document_date ?? null,
        // Lue le 4 octobre 2026 (provenance du cas).
        recueLe: "2026-10-04",
        confianceParChamp: confianceParChamp(
          lu.citations,
          cas.tokens,
          (cas.designation as { overall_confidence: number }).overall_confidence,
        ),
        doublonDe: null,
      },
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
    }),
    attendu: {
      journal: "VEN",
      lignes: [
        ["411", "2976.000", "0"],
        ["4367", "0", "475.000", "TVA19"],
        ["701", "0", "2500.000"],
        ["4371", "0", "1.000"],
      ],
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
    nom: "un timbre imprimé à une autre valeur que celle fixée : il n'ancre pas l'échelle",
    reserve: "coherence_arithmetique",
    provenance: `${REPRODUIT} (revue de la PR 144)`,
    lecture: facture({
      lignes: [{ code: "TVA19", ht: "100,000" }],
      ht: "100,000",
      tva: "19,000",
      droits: [{ code: "DROIT_TIMBRE", montant: "2,000" }],
      ttc: "121,000",
    }),
    attendu: null,
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
  },
];

/* ------------------------------------------------------------- la mesure */

export type Issue =
  | { type: "exacte" }
  | { type: "fausse"; cause: string }
  | { type: "refus_juste"; motif: string }
  | { type: "aucune"; motif: string };

/** Pourquoi rien n'est proposé, en un code : le contrôle en défaut, précisé. */
function motifDuRefus(jugement: ReturnType<typeof jugerLaLecture>, raison: string): string {
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
  if (/une base n'a pas été lue/.test(raison)) return "proposition/base_non_lue";
  if (/droit hors TVA n'a pas été lu/.test(raison)) return "proposition/droit_non_lu";
  if (/à compléter/.test(raison)) return `proposition/a_completer`;
  if (/dossier tenu en|devise/.test(raison)) return "proposition/devise";
  if (/ne s'équilibre pas/.test(raison)) return "proposition/desequilibre";
  return "proposition/autre";
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
    deviseDuDossier: DEVISE_DU_DOSSIER,
    droitsFixes: new Map(
      DROITS_D_ESSAI.flatMap((d) =>
        d.fixedAmount !== null && d.documentKind === sens ? [[d.code, d.fixedAmount] as const] : [],
      ),
    ),
    tenant: cas.dossier ?? DOSSIER,
    typesDocument: TYPES_D_ESSAI,
    titres: TITRES_D_ESSAI,
    mentionsObligatoires: MENTIONS_D_ESSAI,
    doublonProbable: null,
    devises: DEVISES_LUES_D_ESSAI,
  });
}

/** Joue un cas sur la vraie chaîne, et compare à ce que la pièce imprime. */
function jouer(cas: CasDeMesure): Issue {
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
    },
    {
      packVersionId: "pack-d-essai",
      deviseDuDossier: DEVISE_DU_DOSSIER,
      // Une devise inconnue : le jugement a déjà refusé, rien ne se compose.
      decimales: decimales ?? 0,
      confianceReserve: PARAMETRES_D_ESSAI["lecture.confiance_reserve"],
      confianceBloquante: PARAMETRES_D_ESSAI["lecture.confiance_bloquante"],
      taxRates: TAUX_D_ESSAI,
      mappings: IMPUTATIONS_D_ESSAI,
      fiscalCharges: DROITS_D_ESSAI,
      compteDeNature: null,
      tvaNonDeductible: false,
    },
  );
  // La réserve attendue se vérifie aussi sur un refus : un refus juste dont le
  // jugement tait le doute n'est pas juste.
  const reserveAbsente =
    cas.reserve !== undefined &&
    !jugement.motifs.some((m) => m.code === cas.reserve && m.statut === "reserve");
  if (!p.ok) {
    const motif = motifDuRefus(jugement, p.raison);
    if (cas.attendu === null && reserveAbsente)
      return { type: "aucune", motif: `${motif} — réserve « ${cas.reserve} » attendue, absente` };
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
  return causes.length === 0 ? { type: "exacte" } : { type: "fausse", cause: causes.join(" · ") };
}

export interface Mesure {
  total: number;
  proposees: number;
  exactes: number;
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
    proposees: issues.filter((i) => i.type === "exacte" || i.type === "fausse").length,
    exactes: issues.filter((i) => i.type === "exacte").length,
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
    `issue juste (écriture exacte, ou refus juste) : ${pc(justes, m.total)}`,
    "motifs sans proposition :",
    ...Object.entries(m.motifs)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([motif, n]) => `  ${n} × ${motif}`),
    "par pièce :",
    ...Object.entries(m.parCas).map(
      ([nom, i]) =>
        `  ${i.type.padEnd(11)} ${nom}${"motif" in i ? ` — ${i.motif}` : ""}${"cause" in i ? ` — ${i.cause}` : ""}`,
    ),
  ].join("\n");
}
