/**
 * 3B-4 et 3B-5 — Les contrôles d'une pièce, et le verdict qu'ils motivent.
 *
 * Fonctions pures : une pièce lue, un contexte (le tenant, le paramétrage
 * daté, les autres pièces du tenant) — des statuts motivés, puis un verdict.
 *
 * ============================================================== UN STATUT, PAS UN BOOLÉEN
 *
 * Chaque contrôle dit ce qu'il a vu (preuves), ce qu'il en conclut (statut) et
 * pourquoi (motif, en clair). Par gravité croissante :
 *
 *   conforme      rien à redire
 *   non_evaluable le contrôle ne peut pas conclure — il le dit, sans aggraver
 *   reserve       comptabilisable, mais quelqu'un doit le savoir
 *   rapprocher    ressemble à une autre pièce : à rapprocher avant toute écriture
 *   anomalie      quelque chose ne tient pas : à signaler au cabinet
 *   rejet         ce n'est pas une pièce à comptabiliser ici
 *
 * ============================================================== LE VERDICT
 *
 * Le verdict est le plus grave des statuts ; il porte TOUS les contrôles de ce
 * rang comme motifs. Un verdict sans motif est un bug : `rendreVerdict` lève.
 *
 * Aucune valeur fiscale ici : les mentions obligatoires, les types de documents
 * et les seuils de confiance arrivent par le contexte, lus dans le paramétrage.
 */

import type { ResultatNormalisation } from "./normaliser-montants.ts";

type Statut = "conforme" | "non_evaluable" | "reserve" | "rapprocher" | "anomalie" | "rejet";

export interface ResultatControle {
  code:
    | "coherence_arithmetique"
    | "mentions_obligatoires"
    | "nature_piece"
    | "destinataire"
    | "doublon"
    | "coherence_dates"
    | "confiance_lecture";
  statut: Statut;
  motif: string;
  preuves: Record<string, unknown>;
}

export interface PieceAControler {
  documentKind: string | null;
  /** Le titre imprimé (« FACTURE », « FACTURE PROFORMA », « DEVIS »…), tel que lu. */
  titre: string | null;
  emetteur: { nom: string | null; identifiantFiscal: string | null };
  destinataire: { nom: string | null; identifiantFiscal: string | null };
  numero: string | null;
  /** Date de la pièce, AAAA-MM-JJ, ou null si illisible. */
  date: string | null;
  montants: ResultatNormalisation;
  confianceParChamp: Record<string, number>;
  reception: { doublonDe: string | null; recueLe: string };
}

export interface ContexteControle {
  tenant: { nom: string; identifiantFiscal: string | null };
  typesDocument: Array<{ code: string; porteEcriture: boolean }>;
  mentionsObligatoires: Array<{ code: string; libelle: string }>;
  seuilConfianceReserve: number;
  seuilConfianceBloquant: number;
  autresPieces: Array<{
    id: string;
    emetteurIdentifiantFiscal: string | null;
    numero: string | null;
  }>;
}

export type Verdict =
  | "à comptabiliser"
  | "à comptabiliser avec réserve"
  | "à rapprocher"
  | "à rejeter"
  | "anomalie à signaler";

const GRAVITE: Record<Statut, number> = {
  conforme: 0,
  non_evaluable: 0,
  reserve: 1,
  rapprocher: 2,
  anomalie: 3,
  rejet: 4,
};

const VERDICT_DU_RANG: Record<number, Verdict> = {
  0: "à comptabiliser",
  1: "à comptabiliser avec réserve",
  2: "à rapprocher",
  3: "anomalie à signaler",
  4: "à rejeter",
};

/**
 * L'identité fiscale tunisienne tient dans ses sept chiffres et sa lettre clé ;
 * le reste (code TVA, catégorie, établissement) varie d'une écriture à
 * l'autre. « 1856324K/A/M/000 », « 1856324 A M 000 », « 1856324A » : une même
 * entreprise.
 */
function identite(mf: string | null): string | null {
  if (!mf) return null;
  const nu = mf.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const m = /^(\d{7})([A-Z])/.exec(nu);
  return m ? `${m[1]}${m[2]}` : nu || null;
}

const normNumero = (n: string | null) => (n ? n.toUpperCase().replace(/[^0-9A-Z]/g, "") : null);

/** Ce qu'un titre imprimé dit de la nature du document, quand ce n'est pas une facture. */
const TITRES_NON_COMPTABLES: Array<[RegExp, string]> = [
  [/pro\s*-?\s*forma/i, "une facture proforma"],
  [/\bdevis\b/i, "un devis"],
  [/bon\s+de\s+livraison/i, "un bon de livraison"],
  [/bon\s+de\s+commande/i, "un bon de commande"],
];

function arithmetique(p: PieceAControler): ResultatControle {
  const m = p.montants;
  const preuves = { etat: m.etat, conventions: m.conventions, confiance: m.confiance };
  switch (m.etat) {
    case "tranche":
      return {
        code: "coherence_arithmetique",
        statut: "conforme",
        motif: `Les montants vérifient HT × (1 + taux) + autres = TTC — ${m.raison}.`,
        preuves,
      };
    case "non_verifie":
      return {
        code: "coherence_arithmetique",
        statut: "reserve",
        motif: `Les montants se lisent, mais rien ne permet de les vérifier : ${m.raison}.`,
        preuves,
      };
    case "incoherent":
      return {
        code: "coherence_arithmetique",
        statut: "anomalie",
        motif: `La facture ne tient pas : ${m.raison}.`,
        preuves,
      };
    default:
      return {
        code: "coherence_arithmetique",
        statut: "anomalie",
        motif: `Aucun montant n'est retenu — ils sont à saisir : ${m.raison}.`,
        preuves,
      };
  }
}

function mentions(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  // Ce que la lecture sait observer ; les autres mentions ne comptent pas contre la pièce.
  const presente: Record<string, () => boolean> = {
    IDENT_FISCAL_EMETTEUR: () => Boolean(p.emetteur.identifiantFiscal),
    IDENT_FISCAL_CLIENT: () => Boolean(p.destinataire.identifiantFiscal),
    DATE_FACTURE: () => Boolean(p.date),
    NUMERO_SEQUENTIEL: () => Boolean(p.numero),
    /*
     * Sur `imprime`, jamais sur `montants`.
     *
     * Ce contrôle répond à « la pièce porte-t-elle cette mention ? ». La
     * sortie de la normalisation répond à « quelle valeur retient-on ? », et
     * elle est légitimement vide quand la facture ne tient pas. Les confondre
     * faisait dire au produit qu'un total imprimé en gras était « absent ou
     * illisible » — un message vérifiable, et faux (5 octobre 2026).
     */
    BASE_HT: () => p.montants.imprime.bases.some((ht) => ht !== null),
    MONTANT_TVA: () => p.montants.imprime.tva !== null,
    TOTAL_TTC: () => p.montants.imprime.ttc !== null,
  };
  const manquantes: string[] = [];
  const nonObservables: string[] = [];
  for (const m of ctx.mentionsObligatoires) {
    const test = presente[m.code];
    if (!test) nonObservables.push(m.code);
    else if (!test()) manquantes.push(m.code);
  }
  const libelles = ctx.mentionsObligatoires
    .filter((m) => manquantes.includes(m.code))
    .map((m) => m.libelle);
  return manquantes.length === 0
    ? {
        code: "mentions_obligatoires",
        statut: "conforme",
        motif: `Les mentions obligatoires observables sont présentes (${ctx.mentionsObligatoires.length - nonObservables.length} vérifiées).`,
        preuves: { manquantes, non_observables: nonObservables },
      }
    : {
        code: "mentions_obligatoires",
        statut: "reserve",
        motif: `Mentions obligatoires absentes ou illisibles : ${libelles.join(", ")}.`,
        preuves: { manquantes, non_observables: nonObservables },
      };
}

function nature(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  for (const [motif, quoi] of TITRES_NON_COMPTABLES) {
    if (p.titre && motif.test(p.titre))
      return {
        code: "nature_piece",
        statut: "rejet",
        motif: `Le document est ${quoi} (titre « ${p.titre} ») : ce n'est pas une pièce comptable, il ne se comptabilise pas.`,
        preuves: { titre: p.titre, documentKind: p.documentKind },
      };
  }
  if (!p.documentKind)
    return {
      code: "nature_piece",
      statut: "reserve",
      motif: "La nature de la pièce n'a pas été déterminée (achat ou vente) : à confirmer.",
      preuves: { titre: p.titre },
    };
  const type = ctx.typesDocument.find((t) => t.code === p.documentKind);
  if (!type || !type.porteEcriture)
    return {
      code: "nature_piece",
      statut: "rejet",
      motif: `Le type « ${p.documentKind} » ne porte pas d'écriture comptable selon le paramétrage.`,
      preuves: { documentKind: p.documentKind },
    };
  return {
    code: "nature_piece",
    statut: "conforme",
    motif: `Pièce de type « ${p.documentKind} », qui porte une écriture comptable.`,
    preuves: { documentKind: p.documentKind, titre: p.titre },
  };
}

function destinataire(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const tenant = identite(ctx.tenant.identifiantFiscal);
  if (!tenant)
    return {
      code: "destinataire",
      statut: "non_evaluable",
      motif: "Le dossier n'a pas de matricule fiscal : le destinataire ne peut pas être vérifié.",
      preuves: {},
    };
  // Un achat est adressé au tenant ; une vente est émise par lui.
  const vente = p.documentKind === "facture_vente";
  const partie = vente ? p.emetteur : p.destinataire;
  const role = vente ? "l'émetteur" : "le destinataire";
  const lu = identite(partie.identifiantFiscal);
  if (!lu)
    return {
      code: "destinataire",
      statut: "reserve",
      motif: `Le matricule fiscal de ${role} n'a pas été lu : impossible de vérifier que la pièce concerne ${ctx.tenant.nom}.`,
      preuves: { role },
    };
  if (lu !== tenant)
    return {
      code: "destinataire",
      statut: "rejet",
      motif: `La pièce concerne ${partie.identifiantFiscal}${partie.nom ? ` (${partie.nom})` : ""}, pas ${ctx.tenant.nom} (${ctx.tenant.identifiantFiscal}).`,
      preuves: { role, lu: partie.identifiantFiscal, attendu: ctx.tenant.identifiantFiscal },
    };
  return {
    code: "destinataire",
    statut: "conforme",
    motif: `${role[0]!.toUpperCase()}${role.slice(1)} est bien ${ctx.tenant.nom} (${partie.identifiantFiscal}).`,
    preuves: { role, lu: partie.identifiantFiscal },
  };
}

function doublon(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  if (p.reception.doublonDe)
    return {
      code: "doublon",
      statut: "rejet",
      motif: "Doublon strict : le même fichier, à l'octet près, a déjà été reçu.",
      preuves: { original: p.reception.doublonDe },
    };
  const emetteur = identite(p.emetteur.identifiantFiscal);
  const numero = normNumero(p.numero);
  const semblable =
    emetteur && numero
      ? ctx.autresPieces.find(
          (a) =>
            identite(a.emetteurIdentifiantFiscal) === emetteur && normNumero(a.numero) === numero,
        )
      : undefined;
  if (semblable)
    return {
      code: "doublon",
      statut: "rapprocher",
      motif: `Même émetteur et même numéro (${p.numero}) qu'une autre pièce : une seconde photo de la même facture, ou une facture rééditée — à rapprocher avant toute écriture.`,
      preuves: { semblable: semblable.id },
    };
  return {
    code: "doublon",
    statut: "conforme",
    motif:
      emetteur && numero
        ? "Aucune autre pièce n'a le même fichier, ni le même émetteur et le même numéro."
        : "Aucune autre pièce n'a le même fichier ; émetteur ou numéro illisible, la ressemblance n'a pas pu être cherchée plus loin.",
    preuves: {},
  };
}

function dates(p: PieceAControler): ResultatControle {
  if (!p.date)
    return {
      code: "coherence_dates",
      statut: "reserve",
      motif: "La date de la pièce n'a pas été lue : à saisir, elle décide de la période.",
      preuves: {},
    };
  if (p.date > p.reception.recueLe)
    return {
      code: "coherence_dates",
      statut: "anomalie",
      motif: `La pièce est datée du ${p.date}, après sa réception le ${p.reception.recueLe}.`,
      preuves: { date: p.date, recueLe: p.reception.recueLe },
    };
  return {
    code: "coherence_dates",
    statut: "conforme",
    motif: `Datée du ${p.date}, reçue le ${p.reception.recueLe}.`,
    preuves: { date: p.date, recueLe: p.reception.recueLe },
  };
}

function confiance(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const entrees = Object.entries(p.confianceParChamp);
  const bloquants = entrees.filter(([, c]) => c < ctx.seuilConfianceBloquant).map(([k]) => k);
  const reserves = entrees.filter(([, c]) => c < ctx.seuilConfianceReserve).map(([k]) => k);
  if (bloquants.length > 0)
    return {
      code: "confiance_lecture",
      statut: "anomalie",
      motif: `Lecture trop incertaine pour ${bloquants.join(", ")} (sous ${ctx.seuilConfianceBloquant}).`,
      preuves: { champs: bloquants, seuil: ctx.seuilConfianceBloquant },
    };
  if (reserves.length > 0)
    return {
      code: "confiance_lecture",
      statut: "reserve",
      motif: `Lecture incertaine pour ${reserves.join(", ")} (sous ${ctx.seuilConfianceReserve}) : à relire.`,
      preuves: { champs: reserves, seuil: ctx.seuilConfianceReserve },
    };
  return {
    code: "confiance_lecture",
    statut: "conforme",
    motif:
      entrees.length > 0
        ? `Tous les champs lus sont au-dessus du seuil de ${ctx.seuilConfianceReserve}.`
        : "Aucune confiance par champ à évaluer.",
    preuves: { champs: [] },
  };
}

export function controlerPiece(p: PieceAControler, ctx: ContexteControle): ResultatControle[] {
  return [
    arithmetique(p),
    mentions(p, ctx),
    nature(p, ctx),
    destinataire(p, ctx),
    doublon(p, ctx),
    dates(p),
    confiance(p, ctx),
  ];
}

export function rendreVerdict(controles: ResultatControle[]): {
  verdict: Verdict;
  motifs: Array<Pick<ResultatControle, "code" | "statut" | "motif">>;
} {
  const rang = Math.max(...controles.map((c) => GRAVITE[c.statut]));
  const motifs = controles
    .filter((c) => (rang === 0 ? c.statut === "conforme" : GRAVITE[c.statut] === rang))
    .map(({ code, statut, motif }) => ({ code, statut, motif }));
  if (motifs.length === 0) throw new Error("un verdict sans motif est un bug");
  return { verdict: VERDICT_DU_RANG[rang]!, motifs };
}
