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

import { periodeDeTva } from "@malica/socle/exercice";
import { memeMatricule, normaliserMatricule } from "@malica/socle/matricule";
import { enChiffresLatins } from "@malica/socle/chiffres";
import { texteSansUnicode } from "@malica/socle/texte-sans-unicode";

import { D } from "@malica/socle/domain/decimal";

import type { ChangeDuJugement } from "./cours-de-change.ts";
import type { ResultatNormalisation } from "./normaliser-montants.ts";
import type { ReglageDImmobilisation } from "./reglages-comptables.ts";

type Statut = "conforme" | "non_evaluable" | "reserve" | "rapprocher" | "anomalie" | "rejet";

export interface ResultatControle {
  code:
    | "coherence_arithmetique"
    | "mentions_obligatoires"
    | "nature_piece"
    | "destinataire"
    | "doublon"
    | "coherence_dates"
    | "confiance_lecture"
    /** Le sens lu contredit ce que la pièce porte (5 octobre 2026). */
    | "sens_de_la_piece"
    /** Une pièce en devise : le cours qui la convertit, ou celui qui manque (31 octobre 2026). */
    | "cours_de_change"
    /** Un achat qui désigne un bien susceptible d'être immobilisé : le cabinet tranche (31 octobre 2026). */
    | "immobilisation_a_trancher"
    /** Un bien reconnu sous le seuil du cabinet : à l'actif, amorti à 100 % (31 octobre 2026). */
    | "immobilisation_faible_valeur";
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
  /**
   * La personne a confirmé le sens de la pièce (achat ou vente), le même que
   * celui de la lecture. Facultatif : absent vaut « non confirmé ».
   */
  sensConfirme?: boolean;
  /** Les articles lus : la désignation telle qu'imprimée, et ses montants. Absents : aucun. */
  articles?: readonly ArticleAControler[];
}

/** Un article lu : sa désignation et ses montants, en écriture décimale, ou nuls. */
export interface ArticleAControler {
  designation: string;
  quantite: string | null;
  prixUnitaireHt: string | null;
  totalHt: string | null;
  prixUnitaireTtc: string | null;
  /** Le taux de TVA de l'article (ratio du référentiel, « 0.19 »), quand son code est connu. */
  tauxDeTva: string | null;
}

export interface ContexteControle {
  tenant: { nom: string; identifiantFiscal: string | null };
  typesDocument: Array<{ code: string; porteEcriture: boolean }>;
  /**
   * Ce que le titre imprimé dit de la nature de la pièce (`ref.titres_de_piece`),
   * dans l'ordre du référentiel : le motif du titre (expression régulière, lue
   * sans casse), le type de `ref.document_types` s'il existe, le statut et le
   * refus — où « {titre} » est le titre lu.
   */
  titres: Array<{
    motif: string;
    documentType: string | null;
    statut: "rejet" | "anomalie";
    refus: string;
  }>;
  /**
   * Les mots qui désignent un bien SUSCEPTIBLE d'être immobilisé
   * (`ref.biens_immobilisables`, datés) : le motif (expression régulière, lue
   * sans casse et en Unicode) et la famille de biens qu'il reconnaît.
   */
  biensImmobilisables: Array<{ motif: string; famille: string }>;
  /**
   * Le seuil et le traitement d'un bien de faible valeur que le cabinet a
   * arrêtés (`app.reglage_comptable`) ; nul quand le pack n'en porte aucun.
   */
  immobilisation: ReglageDImmobilisation | null;
  mentionsObligatoires: Array<{ code: string; libelle: string }>;
  seuilConfianceReserve: number;
  seuilConfianceBloquant: number;
  /**
   * Au-dela de combien de jours l ecart entre la date de la piece et celle de
   * sa reception est signale. Lu au pack (R4) : soixante jours en Tunisie,
   * c est-a-dire le delai au-dela duquel une facture echappe a la declaration
   * du mois de sa date.
   */
  ecartDateJours: number;
  /**
   * La pièce arrivée avant celle-ci qu'elle répète, selon sa clé
   * (`cleDeDoublon`) et la règle de la base (`app.doublon_probable_de`), ou
   * null.
   */
  doublonProbable: string | null;
  /** La devise des livres du dossier. */
  deviseDuDossier: string;
  /**
   * Ce que le référentiel et les cours disent du change (`lireLeChange`) ;
   * nul quand le jugement ne les a pas lus — une pièce en devise est alors
   * « non évaluable » sur ce point, jamais convertie.
   */
  change: ChangeDuJugement | null;
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
 * L'identité fiscale tunisienne tient dans ses sept chiffres et sa lettre de
 * CONTRÔLE ; le reste — code de TVA, catégorie, établissement — varie d'une
 * écriture à l'autre.
 *
 * ============================= LE BUG QUI VIVAIT ICI, ET QUI REJETAIT DES PIÈCES
 *
 * Ce fichier portait sa propre version :
 *
 *     const nu = mf.toUpperCase().replace(/[^0-9A-Z]/g, "");
 *     const m = /^(\d{7})([A-Z])/.exec(nu);
 *
 * Elle COMPACTE tout, puis prend la première lettre venue pour la lettre de
 * contrôle. Sur « 1856324/A/M/000 » — un matricule qui n'en porte PAS — elle
 * rend « 1856324A » : elle fabrique une identité à partir du code de TVA.
 *
 * Deux conséquences, et les deux sont des verdicts liants :
 *
 *   — « 1856324/A/M/000 » et « 1856324A/B/M/000 » reçoivent la même clé, donc
 *     deux entreprises différentes sont jugées identiques ;
 *   — « 1856324/A/M/000 » et « 1856324/B/M/000 » en reçoivent deux
 *     différentes, alors qu'on ne sait rien de leur lettre de contrôle.
 *
 * C'est EXACTEMENT le défaut que le normaliseur du Socle a été écrit pour
 * tuer le 5 octobre, et dont il documente la coïncidence silencieuse. Le
 * Socle a donc été corrigé, et la copie fautive est restée ici — dans le
 * contrôle qui REJETTE les pièces.
 *
 * Le normaliseur du Socle travaille sur la forme ÉCRITE, séparateurs
 * compris, et sait dire qu'un matricule est « partiel » plutôt que d'en
 * inventer la clé. Sa fonction de comparaison n'avait, jusqu'ici, aucun
 * appelant de production.
 */

// Les chiffres arabes orientaux d'abord ramenés aux latins (`enChiffresLatins`) :
// ils tombaient avec la ponctuation, et « ٢٠٢٦/٥٠٣٦ » n'avait pas de clé.
const normNumero = (n: string | null) =>
  n
    ? enChiffresLatins(n)
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, "")
    : null;

/** Un nom d'émetteur comparable : sans accents, sans ponctuation, en capitales. */
const normNom = (n: string | null) =>
  n
    ? n
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toUpperCase()
        .replace(/[^\p{L}\p{N}]/gu, "") || null
    : null;

/** Un montant lu comparable : la valeur, pas l'écriture (« 8772.7280 » = « 8772.728 »). */
const normMontant = (m: string | null) => {
  // Une écriture décimale canonique, sans passer par un flottant : zéros de
  // tête et de fin retirés, « -0 » ramené à « 0 ».
  const lu = m === null ? null : /^(-?)0*(\d*?)(?:\.(\d*?)0*)?$/.exec(m.trim());
  if (!lu || !/\d/.test(m!)) return null;
  const entier = lu[2] || "0";
  const decimales = lu[3] ? `.${lu[3]}` : "";
  const absolu = `${entier}${decimales}`;
  return absolu === "0" ? "0" : `${lu[1]}${absolu}`;
};

/**
 * La clé de doublon d'une pièce, normalisée ICI et rangée avec son jugement
 * (`capture.analyses.doublon_*`). La règle qui compare deux clés vit en base,
 * une fois (`app.doublon_probable_de`) : la file du cabinet l'applique au
 * moment où elle est lue, et l'ordre des lectures n'y fait rien.
 *
 * Deux façons d'être la même pièce, au même numéro :
 *   — même émetteur au matricule (sept chiffres) ;
 *   — quand l'une des deux n'a pas de matricule, même nom, même date et même
 *     total.
 *
 * La seconde est née sur staging le 30 octobre 2026 : MEUBLES EL AMEN du 20
 * janvier, 8 772,728, deux fois ; INFOTECH, 13 690,165, deux fois. Aucune des
 * deux n'imprimait de matricule lisible. Sans numéro lu, la clé est vide et
 * rien n'est signalé : deux achats du même jour, au même prix, chez le même
 * fournisseur, sont deux factures plausibles.
 */
export function cleDeDoublon(piece: {
  emetteurIdentifiantFiscal: string | null;
  emetteurNom: string | null;
  numero: string | null;
  /** AAAA-MM-JJ, ou null. */
  date: string | null;
  /** Le total TTC lu, chaîne décimale, ou null. */
  ttc: string | null;
}): { numero: string | null; mf: string | null; lu: string | null } {
  const numero = normNumero(piece.numero) || null;
  if (!numero) return { numero: null, mf: null, lu: null };
  const nom = normNom(piece.emetteurNom);
  const ttc = normMontant(piece.ttc);
  return {
    numero,
    mf: normaliserMatricule(piece.emetteurIdentifiantFiscal).chiffres || null,
    lu: nom && piece.date && ttc ? `${nom}|${piece.date}|${ttc}` : null,
  };
}

function arithmetique(p: PieceAControler): ResultatControle {
  const m = p.montants;
  const preuves = { etat: m.etat, conventions: m.conventions, confiance: m.confiance };
  switch (m.etat) {
    case "tranche": {
      /*
       * Chaque raison de réserve se DIT, et toutes se disent : une pièce
       * décidée par la convention qui laisse aussi le FODEC hors de la base
       * de la TVA porte les deux (31 octobre 2026 — la première taisait la
       * seconde).
       */
      const reserves: Array<{ motif: string; preuves?: Record<string, unknown> }> = [];
      /*
       * Une valeur que la pièce n'a pas laissé lire, et que son arithmétique
       * prouve (30 octobre 2026). On comptabilise, et l'on dit laquelle, par
       * quelle formule : le cabinet voit pourquoi. Jamais en silence.
       */
      if (m.deduits.length > 0)
        reserves.push({
          motif: `Déduit, non lu : ${m.deduits
            .map((d) => `${d.champ} = ${d.valeur} (${d.formule})`)
            .join(" ; ")}. À vérifier.`,
          preuves: { deduits: m.deduits },
        });
      /*
       * Le total imprimé n'a pas pu être lu, et la facture tient quand même —
       * sa TVA la vérifie. On comptabilise, et on le DIT.
       *
       * « Conforme » serait un repli implicite : la pièce passerait, et
       * personne ne saurait qu'un montant imprimé a été laissé de côté. Une
       * réserve comptabilise et signale à la fois.
       */
      if (m.totalNonLu)
        reserves.push({
          motif: `Le total imprimé « ${m.totalNonLu} » n'a pas pu être lu ; les montants retenus se vérifient entre eux — ${m.raison}.`,
        });
      /*
       * La base de la ligne ne se lisait pas ; celle du pied de facture, que
       * la facture entière vérifie, a été retenue (29 octobre 2026). Même
       * raisonnement : on comptabilise, et on le dit.
       */
      if (m.ligneNonLue)
        reserves.push({
          motif: `Base retenue depuis le pied de facture : la ligne « ${m.ligneNonLue} » ne se lit pas. À vérifier.`,
          preuves: { ligneNonLue: m.ligneNonLue },
        });
      /*
       * Un droit que le référentiel dit taxable (le FODEC) et que la TVA
       * imprimée laisse hors de sa base (31 octobre 2026). La pièce tient
       * ainsi, et l'écriture suit ce qu'elle imprime ; mais la règle dit le
       * contraire : le cabinet le voit.
       */
      if (m.droitsHorsAssiette)
        reserves.push({
          motif: `La TVA imprimée n'est pas assise sur ${m.droitsHorsAssiette.join(", ")}, que le référentiel fait entrer dans la base de la TVA : la facture tient ainsi — ${m.raison}. À vérifier.`,
          preuves: { droitsHorsAssiette: m.droitsHorsAssiette },
        });
      /*
       * La valeur n'est décidée que par le séparateur décimal de la devise :
       * lus autrement, les montants tiennent aussi (revue de la PR 144). On
       * comptabilise la lecture de la convention, et on le dit.
       */
      if (m.parConvention)
        reserves.push({
          motif: `Décidé par la convention : ${m.raison}. À vérifier.`,
          preuves: { parConvention: true },
        });
      if (reserves.length > 0)
        return {
          code: "coherence_arithmetique",
          statut: "reserve",
          motif: reserves.map((r) => r.motif).join(" "),
          preuves: Object.assign({ ...preuves }, ...reserves.map((r) => r.preuves ?? {})),
        };
      return {
        code: "coherence_arithmetique",
        statut: "conforme",
        motif: `Les montants vérifient HT × (1 + taux) + autres = TTC — ${m.raison}.`,
        preuves,
      };
    }
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
    /*
     * Des montants imprimés en négatif : un avoir, et non une facture qui ne
     * tient pas (revue de la PR 144). Ses écritures ne sont pas conçues : rien
     * ne se propose, et le cabinet le saisit.
     */
    case "avoir":
      return {
        code: "coherence_arithmetique",
        statut: "anomalie",
        motif: "Avoir : à saisir par le cabinet (montants imprimés en négatif).",
        preuves,
      };
    default:
      return {
        code: "coherence_arithmetique",
        statut: "anomalie",
        // Court, et dit le geste : l'écran l'affiche sous « le Socle ne
        // propose aucune écriture » (29 octobre 2026).
        motif: `À saisir : ${m.raison}.`,
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

/*
 * ============================================================ LE TITRE DIT LA NATURE
 *
 * Les titres vivaient ici, écrits en TypeScript, et l'AVOIR n'y était pas :
 * une pièce titrée « AVOIR », aux montants positifs, se proposait en achat
 * (revue de la PR 144). Ils vivent désormais au référentiel
 * (`ref.titres_de_piece`) : un avoir se dit, et le cabinet le saisit — ses
 * écritures ne sont pas encore conçues, et jamais un achat ne se propose.
 */
function nature(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const titre = p.titre;
  const reconnu = titre ? ctx.titres.find((t) => new RegExp(t.motif, "iu").test(titre)) : undefined;
  if (titre && reconnu)
    return {
      code: "nature_piece",
      statut: reconnu.statut,
      motif: reconnu.refus.replaceAll("{titre}", titre),
      preuves: { titre, documentKind: p.documentKind, documentType: reconnu.documentType },
    };
  /*
   * ======================================= CE QU'ON N'A PAS LU NE DIT PAS « FACTURE »
   *
   * Jeu synthétique, 31 octobre 2026 (cas 047) : un avoir arabe recevait une
   * écriture d'ACHAT. Son titre « إشعار دائن » est au référentiel ; mais la
   * couche de texte l'avait perdu (glyphes sans correspondance Unicode), aucun
   * titre ne s'y reconnaissait, et ce contrôle concluait « facture » — par
   * défaut, en silence. Ne reconnaître aucun titre n'est une preuve que si le
   * titre a été LU. Un haut de page perdu bloque : facture ou avoir, la pièce
   * ne le dit pas, le cabinet tranche. Un haut de page absent se propose, mais
   * en réserve : on le dit.
   */
  if (titre && texteSansUnicode(titre))
    return {
      code: "nature_piece",
      statut: "anomalie",
      motif:
        "Le haut de la pièce ne se lit pas (texte sans correspondance Unicode) : on ne peut pas dire si c'est une facture ou un avoir. Le cabinet tranche.",
      preuves: { titre, documentKind: p.documentKind },
    };
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
  if (!titre)
    return {
      code: "nature_piece",
      statut: "reserve",
      motif: `Pièce de type « ${p.documentKind} », mais aucun titre n'a été relevé en haut de la pièce : facture ou avoir, à confirmer.`,
      preuves: { documentKind: p.documentKind, titre: null },
    };
  return {
    code: "nature_piece",
    statut: "conforme",
    motif: `Pièce de type « ${p.documentKind} », qui porte une écriture comptable.`,
    preuves: { documentKind: p.documentKind, titre: p.titre },
  };
}

function destinataire(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const tenant = ctx.tenant.identifiantFiscal;
  if (!normaliserMatricule(tenant).cle)
    return {
      code: "destinataire",
      statut: "non_evaluable",
      motif: "Le dossier n'a pas de matricule fiscal : le destinataire ne peut pas être vérifié.",
      preuves: {},
    };
  /*
   * SANS SENS, PAS DE VERDICT.
   *
   * Ce contrôle regardait l'émetteur pour une vente et le destinataire pour
   * tout le reste — donc il traitait un sens INCONNU comme un achat, en
   * silence. Le 6 octobre, une facture d'achat de SUARL CASA-ELECT a été lue
   * « vente » par le modèle : le contrôle a vérifié que l'émetteur était
   * ALGORIA, a trouvé CASA-ELECT, et a REJETÉ une facture parfaitement normale.
   *
   * Le sens se déduit désormais des matricules (`lireLeSens`), et quand il
   * reste à confirmer, ce contrôle ne se prononce pas. Vérifier la mauvaise
   * partie est pire que ne rien vérifier : cela produit un rejet motivé, donc
   * crédible, et faux.
   */
  if (p.documentKind !== "facture_achat" && p.documentKind !== "facture_vente")
    return {
      code: "destinataire",
      statut: "non_evaluable",
      motif:
        "Le sens de la pièce n'est pas confirmé : on ne peut pas encore dire quelle partie devrait être le dossier.",
      preuves: { documentKind: p.documentKind },
    };

  // Un achat est adressé au tenant ; une vente est émise par lui.
  const vente = p.documentKind === "facture_vente";
  const partie = vente ? p.emetteur : p.destinataire;
  const role = vente ? "l'émetteur" : "le destinataire";
  const lu = partie.identifiantFiscal;
  if (!normaliserMatricule(lu).cle)
    return {
      code: "destinataire",
      statut: "reserve",
      motif: `Le matricule fiscal de ${role} n'a pas été lu : impossible de vérifier que la pièce concerne ${ctx.tenant.nom}.`,
      preuves: { role },
    };
  if (!memeMatricule(lu, tenant))
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

/**
 * Les mots d'un nom d'entreprise, sans sa forme juridique ni sa ponctuation.
 *
 * « ALGORIA FACTORY SARL » et « Algoria Factory » désignent la même entreprise.
 * Un contrôle qui exigerait l'égalité stricte crierait sur toutes les ventes, et
 * on apprendrait à l'ignorer — ce qui est pire qu'un contrôle absent.
 *
 * Les formes juridiques sont retirées ici et non dans le référentiel : ce ne
 * sont pas des valeurs réglementaires mais des mots d'une langue, au même titre
 * que les accents. R4 ne les concerne pas.
 */
const FORMES = /\b(sarl|suarl|sa|spa|snc|sas|sasu|eurl|ste|societe|société|et\s+cie)\b/g;

function motsDuNom(nom: string): Set<string> {
  return new Set(
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(FORMES, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((m) => m.length > 2),
  );
}

/**
 * Deux noms se comparent-ils ? Un nom arabe (ou perdu) n'a aucun mot latin :
 * il ne dit ni oui ni non face au nom français de la fiche.
 */
function nomsComparables(a: string | null, b: string | null): boolean {
  return !!a && !!b && motsDuNom(a).size > 0 && motsDuNom(b).size > 0;
}

/** Deux noms désignent-ils la même entreprise ? */
function memeEntreprise(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ma = motsDuNom(a);
  const mb = motsDuNom(b);
  if (ma.size === 0 || mb.size === 0) return false;
  // Tous les mots du plus court se retrouvent dans l'autre : « Algoria Factory »
  // reconnaît « ALGORIA FACTORY SARL », et « Factory » seul ne suffit pas.
  const [court, long] = ma.size <= mb.size ? [ma, mb] : [mb, ma];
  if (court.size < 2 && long.size >= 2) return false;
  return [...court].every((m) => long.has(m));
}

/**
 * Le sens de la pièce tient-il avec ce que la pièce porte ?
 *
 * ================================================================= POURQUOI
 *
 * Posé le 5 octobre 2026, après qu'un modèle de désignation ait rendu, sur une
 * facture d'achat :
 *
 *   document_kind "facture_vente" · issuer « Mme Leila BEN SALEM »
 *   matricule_fiscal celui du DOSSIER · matricule_fiscal_client celui du bailleur
 *
 * Tout était inversé, et COHÉRENT dans son inversion. Le contrôle
 * `destinataire` ne regarde qu'UNE partie — l'émetteur, pour une vente — y
 * trouve le matricule du dossier, et conclut « conforme ». La pièce serait
 * partie en VENTE dans les comptes du client.
 *
 * Aucune arithmétique ne rattrape cela : le sens n'est pas un montant. C'est la
 * définition de l'erreur silencieuse, et elle valait une écriture fausse.
 *
 * Ce qui la trahit est à l'intérieur de la pièce : une vente émise par le
 * dossier porte le NOM du dossier comme émetteur. Ici l'émetteur s'appelle
 * autrement. La contradiction se voit sans modèle, sans référentiel et sans
 * arithmétique — donc ce contrôle est gratuit et sûr.
 *
 * Il rend `anomalie` et non `rejet` : la pièce n'est pas mauvaise, c'est sa
 * LECTURE qui se contredit. Le geste attendu est de confirmer le sens, pas de
 * jeter le document.
 */
function sensDeLaPiece(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const vente = p.documentKind === "facture_vente";
  const achat = p.documentKind === "facture_achat";
  if (!vente && !achat)
    return {
      code: "sens_de_la_piece",
      statut: "non_evaluable",
      motif: "Le sens de la pièce n'est pas déterminé : il reste à confirmer.",
      preuves: { documentKind: p.documentKind },
    };
  /*
   * ============================== LE MATRICULE D'ABORD (31 octobre 2026)
   *
   * Jeu synthétique, cas 046 et 052 : une vente arabe, émise par le dossier
   * à son matricule, refusée parce que son nom arabe ne se compare pas au
   * nom français de la fiche. Le matricule est l'identifiant LÉGAL : lu des
   * deux côtés, il décide. Le nom ne décide que sans lui — et, quand il se
   * compare (mêmes écritures), il peut le CONTREDIRE : l'inversion du
   * 5 octobre (le matricule du dossier, le nom d'un tiers) reste une
   * contradiction, aucun des deux ne l'emporte.
   */
  const parMatricule =
    normaliserMatricule(p.emetteur.identifiantFiscal).cle &&
    normaliserMatricule(ctx.tenant.identifiantFiscal).cle
      ? memeMatricule(p.emetteur.identifiantFiscal, ctx.tenant.identifiantFiscal)
      : null;
  const parLeNom = nomsComparables(p.emetteur.nom, ctx.tenant.nom)
    ? memeEntreprise(p.emetteur.nom, ctx.tenant.nom)
    : null;
  if (parMatricule === null && !p.emetteur.nom)
    return {
      code: "sens_de_la_piece",
      statut: "non_evaluable",
      motif: "Le nom de l'émetteur n'a pas été lu : le sens ne peut pas être confronté.",
      preuves: {},
    };

  const emetteurEstLeDossier =
    parMatricule !== null && (parLeNom === null || parLeNom === parMatricule)
      ? parMatricule
      : parMatricule === null
        ? (parLeNom ?? false)
        : null;
  if (emetteurEstLeDossier !== null && vente === emetteurEstLeDossier)
    return {
      code: "sens_de_la_piece",
      statut: "conforme",
      motif:
        (vente
          ? `Vente : la pièce est bien émise par ${ctx.tenant.nom}`
          : `Achat : la pièce est émise par un tiers, ${p.emetteur.nom ?? p.emetteur.identifiantFiscal}`) +
        (parMatricule === null ? "." : ` (matricule ${p.emetteur.identifiantFiscal}).`),
      preuves: {
        documentKind: p.documentKind,
        emetteur: p.emetteur.nom,
        ...(parMatricule === null ? {} : { matricule: p.emetteur.identifiantFiscal }),
      },
    };

  /*
   * Recette du 20 octobre 2026 : une vente à un payeur public, l'émetteur lu
   * « PME » au lieu du nom de la société. La contradiction est réelle — c'est
   * la lecture qui se trompe —, et rien ne permettait de la lever. La
   * personne qui CONFIRME le sens tranche : c'est une décision humaine,
   * datée et signée (`precisions`), et le contrôle la suit en le disant.
   */
  if (p.sensConfirme)
    return {
      code: "sens_de_la_piece",
      statut: "conforme",
      motif: vente
        ? `Vente confirmée par la personne, bien que l'émetteur lu soit « ${p.emetteur.nom} ».`
        : `Achat confirmé par la personne, bien que l'émetteur lu soit « ${p.emetteur.nom} ».`,
      preuves: { documentKind: p.documentKind, emetteur: p.emetteur.nom, confirme: true },
    };

  return {
    code: "sens_de_la_piece",
    statut: "anomalie",
    motif:
      emetteurEstLeDossier === null
        ? `Le matricule de l'émetteur (${p.emetteur.identifiantFiscal}) ${parMatricule ? "est" : "n'est pas"} celui de ${ctx.tenant.nom}, mais son nom lu est « ${p.emetteur.nom} » : la lecture se contredit, le sens est à confirmer.`
        : vente
          ? `La pièce est lue comme une VENTE, mais elle est émise par ${p.emetteur.nom ?? p.emetteur.identifiantFiscal}, et non par ${ctx.tenant.nom} : le sens est à confirmer.`
          : `La pièce est lue comme un ACHAT, mais elle est émise par ${ctx.tenant.nom} : le sens est à confirmer.`,
    preuves: {
      documentKind: p.documentKind,
      emetteur: p.emetteur.nom,
      dossier: ctx.tenant.nom,
      ...(parMatricule === null ? {} : { matricule: p.emetteur.identifiantFiscal }),
    },
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
  /*
   * ============== UN REJET EXIGE LA CERTITUDE, UN RAPPROCHEMENT LA VRAISEMBLANCE
   *
   * Le contrôle du destinataire REJETTE : il ne compare donc que des clés
   * complètes, lettre de contrôle comprise. Celui-ci ne fait que SIGNALER —
   * « regardez ces deux pièces » — et la bonne mesure n'y est pas la même.
   *
   * Les SEPT CHIFFRES suffisent ici : deux pièces du même numéro, du même
   * émetteur à sept chiffres près, méritent un coup d'œil même si l'une des
   * deux n'imprime pas sa lettre de contrôle. Exiger la clé complète ferait
   * passer le doublon le plus courant — la même facture photographiée deux
   * fois, lue une fois avec la lettre et une fois sans.
   *
   * C'est une distinction, pas un relâchement : la conclusion de ce contrôle
   * est « à rapprocher », et personne n'est rejeté sur sa foi.
   */
  if (ctx.doublonProbable)
    return {
      code: "doublon",
      statut: "rapprocher",
      motif: `Même émetteur et même numéro (${p.numero}) qu'une autre pièce : une seconde photo de la même facture, ou une facture rééditée — à rapprocher avant toute écriture.`,
      preuves: { semblable: ctx.doublonProbable },
    };
  return {
    code: "doublon",
    statut: "conforme",
    motif:
      "Aucune autre pièce n'a le même fichier, ni le même émetteur avec le même numéro, ou la même date et le même total.",
    preuves: {},
  };
}

/** Les jours entiers entre deux dates ISO. Ni fuseau, ni heure : des jours. */
function joursEntre(debut: string, fin: string): number {
  const d = Date.parse(`${debut.slice(0, 10)}T00:00:00Z`);
  const f = Date.parse(`${fin.slice(0, 10)}T00:00:00Z`);
  return Math.round((f - d) / 86_400_000);
}

function dates(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  if (!p.date)
    return {
      code: "coherence_dates",
      statut: "reserve",
      motif: "La date de la pièce n'a pas été lue : à saisir, elle décide de la période.",
      preuves: {},
    };
  /*
   * ================================ DATÉE APRÈS SA RÉCEPTION (30 octobre 2026)
   *
   * C'était toujours une anomalie, qui privait la pièce d'écriture. Deux
   * causes la produisent : une facture émise d'avance, ou une date mal lue
   * (le jour et le mois inversés). Ce qui compte pour l'écriture, c'est la
   * PÉRIODE DE TVA où elle se range (`periodeDeTva`, la règle même du pivot) :
   *
   *   — même période que la réception : l'écriture se propose à la date
   *     imprimée, en RÉSERVE ; le cabinet voit les deux dates ;
   *   — période postérieure : l'écriture partirait dans une déclaration À
   *     VENIR (revue de la PR 142 : « 2026-11-09 » lu pour une pièce reçue le
   *     2026-09-30). Rien ne se propose ; la date est demandée.
   *
   * INCERTAIN : la règle est à confirmer par un expert-comptable.
   */
  if (p.date > p.reception.recueLe) {
    const preuves = { date: p.date, recueLe: p.reception.recueLe };
    return periodeDeTva(p.date) > periodeDeTva(p.reception.recueLe)
      ? {
          code: "coherence_dates",
          statut: "anomalie",
          motif: `Date à préciser : le ${p.date} tombe dans une période de TVA postérieure à la réception (${p.reception.recueLe}).`,
          preuves,
        }
      : {
          code: "coherence_dates",
          statut: "reserve",
          motif: `La pièce est datée du ${p.date}, après sa réception le ${p.reception.recueLe}, dans la même période de TVA : à vérifier.`,
          preuves,
        };
  }
  /*
   * ======================================= UNE DATE TROP ANCIENNE SE SIGNALE
   *
   * Vérification comptable du 11 octobre 2026. L'écran propose le jour du scan
   * quand la date n'a pas été lue — visible et modifiable, donc pas le repli
   * que R4 interdit. Mais RIEN ne distinguait une date vérifiée d'une date
   * acceptée sans la lire, et une facture de janvier confirmée en mars part
   * dans la déclaration de mars.
   *
   * Signalé, jamais refusé : un dirigeant qui rattrape six mois de factures
   * saisit des dates de six mois, et c'est légitime. Ce qui ne l'est pas,
   * c'est que personne ne le remarque. Le seuil vient du pack.
   */
  const ecart = joursEntre(p.date, p.reception.recueLe);
  if (ecart > ctx.ecartDateJours)
    return {
      code: "coherence_dates",
      statut: "reserve",
      motif: `La pièce est datée du ${p.date} et n'a été reçue que le ${p.reception.recueLe}, soit ${ecart} jours plus tard : à vérifier avant de la ranger dans un mois.`,
      preuves: {
        date: p.date,
        recueLe: p.reception.recueLe,
        ecartJours: ecart,
        seuilJours: ctx.ecartDateJours,
      },
    };

  return {
    code: "coherence_dates",
    statut: "conforme",
    motif: `Datée du ${p.date}, reçue le ${p.reception.recueLe}.`,
    preuves: { date: p.date, recueLe: p.reception.recueLe, ecartJours: ecart },
  };
}

/**
 * Un montant peu sûr que l'arithmétique de la facture FERME n'est pas un
 * doute : la normalisation l'a fait entrer dans l'équation que toute la
 * facture vérifie (`fermes`). Un champ qui n'y est pas entré — la TVA d'une
 * ligne, un total écarté, une valeur déduite — ne ferme rien (revue de la
 * PR 142).
 */
function fermeParLArithmetique(p: PieceAControler, champ: string): boolean {
  return p.montants.etat === "tranche" && (p.montants.fermes ?? []).includes(champ);
}

function confiance(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const entrees = Object.entries(p.confianceParChamp);
  /*
   * 30 octobre 2026 : un seul champ sous le seuil bloquant faisait de toute
   * la pièce une anomalie, sans écriture — même un TTC que la TVA et la base
   * vérifiaient au millime. Un montant que l'arithmétique ferme ne bloque
   * plus : il reste « à relire », en réserve. Un champ qu'elle ne ferme pas
   * (l'émetteur, la date, le numéro, un montant d'une facture qui ne tient
   * pas) bloque toujours.
   */
  const bloquants = entrees
    .filter(([k, c]) => c < ctx.seuilConfianceBloquant && !fermeParLArithmetique(p, k))
    .map(([k]) => k);
  const reserves = entrees.filter(([, c]) => c < ctx.seuilConfianceReserve).map(([k]) => k);
  if (bloquants.length > 0)
    return {
      code: "confiance_lecture",
      statut: "anomalie",
      motif: `Lecture trop incertaine pour ${bloquants.join(", ")} (sous ${ctx.seuilConfianceBloquant}).`,
      // `aRelire` : TOUS les champs sous le seuil de réserve, bloquants
      // compris — l'écran les dit « à vérifier », pas seulement les pires.
      preuves: { champs: bloquants, seuil: ctx.seuilConfianceBloquant, aRelire: reserves },
    };
  if (reserves.length > 0) {
    const fermes = reserves.filter(
      (k) =>
        (p.confianceParChamp[k] ?? 1) < ctx.seuilConfianceBloquant && fermeParLArithmetique(p, k),
    );
    return {
      code: "confiance_lecture",
      statut: "reserve",
      motif:
        `Lecture incertaine pour ${reserves.join(", ")} (sous ${ctx.seuilConfianceReserve}) : à relire.` +
        (fermes.length > 0
          ? ` ${fermes.join(", ")} : vérifié par l'arithmétique de la facture.`
          : ""),
      preuves: { champs: reserves, seuil: ctx.seuilConfianceReserve, fermes },
    };
  }
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

/**
 * LE COURS DE CHANGE d'une pièce en devise (31 octobre 2026).
 *
 * Une pièce dans la devise du dossier n'a rien à convertir : aucun contrôle,
 * et son jugement ne change pas. Une pièce en devise :
 *
 *   — un cours applicable (`app.cours_applicable`) : RÉSERVE, « taux de
 *     change {date} {source} ». Elle se comptabilise, convertie ; le cabinet
 *     sait sur quel cours. Les preuves gardent la question et la réponse :
 *     un cours saisi ou corrigé ensuite périme le jugement
 *     (`app.cours_du_jugement_a_jour`), et l'ouverture le rejuge ;
 *   — aucun cours, pas de date pour le lire, ou pas de règle au pack : NON
 *     ÉVALUABLE. Rien ne se propose (`composerLaProposition`), et la raison
 *     nomme le cours à saisir. Ce n'est pas une faute de la pièce : la PME
 *     n'a rien à corriger, le cabinet saisit le cours.
 */
function coursDeChange(p: PieceAControler, ctx: ContexteControle): ResultatControle | null {
  const devise = p.montants.devise;
  if (!devise || devise === ctx.deviseDuDossier) return null;
  const versDevise = ctx.deviseDuDossier;
  const regle = ctx.change?.regle ?? null;
  if (!ctx.change || !regle)
    return {
      code: "cours_de_change",
      statut: "non_evaluable",
      motif: `aucune règle de change au référentiel pour convertir ${devise} en ${versDevise}`,
      preuves: { devise, versDevise, jour: null, cours: null },
    };
  const jour = ctx.change.jour;
  /*
   * La question, entière : la règle telle que la base l'a résolue (pack,
   * jour du paramétrage, valeurs), la devise et le jour du cours. La
   * péremption (`app.cours_du_jugement_a_jour`) la repose telle quelle.
   */
  const question = {
    devise,
    versDevise,
    jour,
    source: regle.source,
    recul: regle.recul,
    ecart: regle.ecart,
    dateRetenue: regle.dateRetenue,
    pack: ctx.change.pack,
    jourDuParametrage: ctx.change.jourDuParametrage,
    regle: ctx.change.regleBrute,
  };
  if (!jour)
    return {
      code: "cours_de_change",
      statut: "non_evaluable",
      motif: `date de la pièce à saisir : le taux ${devise}/${versDevise} se lit à cette date`,
      preuves: { ...question, cours: null },
    };
  const cours = ctx.change.cours.get(devise) ?? null;
  if (!cours)
    return {
      code: "cours_de_change",
      statut: "non_evaluable",
      motif: `taux ${devise}/${versDevise} du ${jour} à saisir`,
      preuves: { ...question, cours: null },
    };
  return {
    code: "cours_de_change",
    statut: "reserve",
    motif: `taux de change ${cours.date} ${cours.source}`,
    preuves: { ...question, cours },
  };
}

/**
 * Un achat désigne-t-il un bien susceptible d'être immobilisé ?
 *
 * ================================================================= POURQUOI
 *
 * Jeu synthétique, 31 octobre 2026 (cas 007, 071, 083) : l'achat d'un serveur
 * ou d'un photocopieur recevait l'écriture d'une charge (601), en silence —
 * une écriture fausse qui ressemblait à une écriture juste. Le Socle ne
 * tranche pas entre charge et immobilisation : il DIT que la question se pose,
 * par une réserve nommée qui cite l'article et la famille de biens que le
 * référentiel reconnaît (`ref.biens_immobilisables`, INCERTAIN).
 *
 * ============================================= LE SEUIL DU CABINET (31 octobre 2026)
 *
 * Le seuil et le traitement d'un bien de faible valeur sont des réglages du
 * cabinet (`immobilisation.seuil`, `immobilisation.traitement` ; défaut du
 * pack : 200 HT, inscrit à l'actif — décret 2008-492, NC 22/2008, INCERTAIN).
 * Un bien reconnu dont la valeur unitaire HT dépasse le seuil reste « à
 * trancher ». Sous le seuil (ou à égalité) : « bien de faible valeur », à
 * inscrire à l'actif et amortir à 100 % dans l'année — ou rien, si le cabinet
 * le passe en charge. La valeur se compare dans la devise du dossier : une
 * valeur absente, illisible ou dans une autre devise ne se juge pas, et la
 * question reste posée (« à trancher »). Sans réglage au pack, aucun seuil
 * n'est deviné : tout bien reconnu est à trancher.
 *
 * Rien pour une vente, rien quand aucun article ne porte un de ces mots : le
 * contrôle n'apparaît alors pas, comme celui du change.
 */
function immobilisationATrancher(p: PieceAControler, ctx: ContexteControle): ResultatControle[] {
  if (p.documentKind !== "facture_achat") return [];
  const motifs = ctx.biensImmobilisables.map((b) => ({
    ...b,
    expression: new RegExp(b.motif, "iu"),
  }));
  const reconnus = (p.articles ?? []).flatMap((article) => {
    const familles = [
      ...new Set(
        motifs.filter((m) => m.expression.test(article.designation)).map((m) => m.famille),
      ),
    ];
    return familles.length > 0 ? [{ ...article, familles }] : [];
  });
  /*
   * Une désignation PERDUE (glyphes sans Unicode) ne se compare à rien : elle
   * peut nommer un serveur. Jeu synthétique, 31 octobre 2026 (cas 044) : le
   * serveur arabe partait en charge, sans un mot. Un texte perdu n'est pas un
   * texte absent — la question se pose, et se dit.
   */
  const illisibles = (p.articles ?? [])
    .map((a) => a.designation)
    .filter((d) => texteSansUnicode(d));
  if (reconnus.length === 0 && illisibles.length === 0) return [];

  const reglage = ctx.immobilisation;
  const dansLaDevise = p.montants.devise === ctx.deviseDuDossier;
  const sousLeSeuil = (a: (typeof reconnus)[number]) =>
    reglage !== null && dansLaDevise && valeurUnitaireAuPlus(a, reglage.seuil, reglage.base);
  const aTrancher = reconnus.filter((a) => !sousLeSeuil(a));
  const faibleValeur = reconnus.filter(sousLeSeuil);
  /*
   * Ce que le jugement a lu des réglages : la base, et le pack, le jour et
   * les valeurs. Si le cabinet les change, le jugement se périme
   * (`app.reglages_du_jugement_a_jour`) et se rejuge — jamais gardé en silence.
   */
  const lu = reglage ? { base: reglage.base, reglages: reglage.lu } : {};

  const controles: ResultatControle[] = [];
  if (aTrancher.length > 0 || illisibles.length > 0) {
    const phrases = [
      ...(aTrancher.length > 0
        ? [
            `Bien susceptible d'être immobilisé : ${aTrancher.map((r) => `« ${r.designation} »`).join(", ")}.`,
          ]
        : []),
      ...(illisibles.length > 0
        ? [
            `Désignation illisible (texte perdu) : ${illisibles.length === 1 ? "un article" : `${illisibles.length} articles`} dont la nature ne se vérifie pas.`,
          ]
        : []),
    ];
    controles.push({
      code: "immobilisation_a_trancher",
      statut: "reserve",
      motif: `${phrases.join(" ")} L'écriture proposée l'impute au compte du paramétrage (une charge) : immobilisation ou charge, le cabinet tranche.`,
      preuves: {
        articles: aTrancher.map((r) => r.designation),
        familles: [...new Set(aTrancher.flatMap((r) => r.familles))].sort(),
        ...lu,
        ...(illisibles.length > 0 ? { illisibles } : {}),
      },
    });
  }
  /*
   * Sous le seuil : à l'actif (une réserve, l'écriture proposée restant au
   * compte du paramétrage), ou en charge (conforme au réglage). Dans les deux
   * cas le contrôle est posé : il garde ce qu'il a lu, pour se périmer si le
   * cabinet change d'avis.
   */
  if (faibleValeur.length > 0 && reglage) {
    const base = reglage.base === "ttc" ? "TTC" : "HT";
    const articles = faibleValeur.map((r) => `« ${r.designation} »`).join(", ");
    controles.push({
      code: "immobilisation_faible_valeur",
      statut: reglage.traitement === "actif_amorti" ? "reserve" : "conforme",
      motif:
        reglage.traitement === "actif_amorti"
          ? `Bien de faible valeur (au plus ${reglage.seuil} ${base}) : ${articles}. Le réglage du cabinet l'inscrit à l'actif et l'amortit à 100 % l'année d'utilisation ; l'écriture proposée l'impute au compte du paramétrage.`
          : `Bien de faible valeur (au plus ${reglage.seuil} ${base}) : ${articles}. Le réglage du cabinet le passe en charge.`,
      preuves: {
        articles: faibleValeur.map((r) => r.designation),
        familles: [...new Set(faibleValeur.flatMap((r) => r.familles))].sort(),
        seuil: reglage.seuil,
        traitement: reglage.traitement,
        ...lu,
      },
    });
  }
  return controles;
}

const DECIMALE = /^\d+(\.\d+)?$/;
const lisible = (v: string | null): v is string => v !== null && DECIMALE.test(v);

/**
 * La valeur unitaire d'un article est-elle au plus le seuil ? HT, ou TTC
 * pour un dossier non assujetti (INCERTAIN). Le prix unitaire s'il est lu ; à
 * défaut le total, comparé au seuil multiplié par la quantité (aucune
 * division, aucun arrondi). Sans quantité lue, le total seul : s'il est au
 * plus le seuil, chaque unité l'est aussi. TTC sans prix TTC lu : le HT
 * multiplié par (1 + taux) de l'article, quand son taux est connu. Une valeur
 * qu'on ne lit pas n'est pas sous le seuil.
 */
function valeurUnitaireAuPlus(a: ArticleAControler, seuil: string, base: "ht" | "ttc"): boolean {
  if (!DECIMALE.test(seuil)) return false;
  const facteur = base === "ht" ? D(1) : lisible(a.tauxDeTva) ? D(1).plus(a.tauxDeTva) : null;
  const enBase = (ht: string | null) => (facteur && lisible(ht) ? D(ht).times(facteur) : null);
  const unitaire =
    base === "ttc" && lisible(a.prixUnitaireTtc) ? D(a.prixUnitaireTtc) : enBase(a.prixUnitaireHt);
  if (unitaire) return unitaire.lte(D(seuil));
  const quantite = lisible(a.quantite) ? D(a.quantite) : D(1);
  const total = enBase(a.totalHt);
  if (!total || quantite.isZero()) return false;
  return total.lte(D(seuil).times(quantite));
}

export function controlerPiece(p: PieceAControler, ctx: ContexteControle): ResultatControle[] {
  const change = coursDeChange(p, ctx);
  const immobilisation = immobilisationATrancher(p, ctx);
  return [
    arithmetique(p),
    mentions(p, ctx),
    nature(p, ctx),
    destinataire(p, ctx),
    sensDeLaPiece(p, ctx),
    doublon(p, ctx),
    dates(p, ctx),
    confiance(p, ctx),
    ...(change ? [change] : []),
    ...immobilisation,
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
