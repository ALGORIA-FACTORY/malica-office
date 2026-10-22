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

import { memeMatricule, normaliserMatricule } from "@malica/socle/matricule";

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
    | "confiance_lecture"
    /** Le sens lu contredit ce que la pièce porte (5 octobre 2026). */
    | "sens_de_la_piece";
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
}

export interface ContexteControle {
  tenant: { nom: string; identifiantFiscal: string | null };
  typesDocument: Array<{ code: string; porteEcriture: boolean }>;
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
      /*
       * Le total imprimé n'a pas pu être lu, et la facture tient quand même —
       * sa TVA la vérifie. On comptabilise, et on le DIT.
       *
       * « Conforme » serait un repli implicite : la pièce passerait, et
       * personne ne saurait qu'un montant imprimé a été laissé de côté. Une
       * réserve comptabilise et signale à la fois.
       */
      if (m.totalNonLu)
        return {
          code: "coherence_arithmetique",
          statut: "reserve",
          motif: `Le total imprimé « ${m.totalNonLu} » n'a pas pu être lu ; les montants retenus se vérifient entre eux — ${m.raison}.`,
          preuves,
        };
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
  if (!p.emetteur.nom)
    return {
      code: "sens_de_la_piece",
      statut: "non_evaluable",
      motif: "Le nom de l'émetteur n'a pas été lu : le sens ne peut pas être confronté.",
      preuves: {},
    };

  const emetteurEstLeDossier = memeEntreprise(p.emetteur.nom, ctx.tenant.nom);
  if (vente === emetteurEstLeDossier)
    return {
      code: "sens_de_la_piece",
      statut: "conforme",
      motif: vente
        ? `Vente : la pièce est bien émise par ${ctx.tenant.nom}.`
        : `Achat : la pièce est émise par un tiers, ${p.emetteur.nom}.`,
      preuves: { documentKind: p.documentKind, emetteur: p.emetteur.nom },
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
    motif: vente
      ? `La pièce est lue comme une VENTE, mais elle est émise par ${p.emetteur.nom}, et non par ${ctx.tenant.nom} : le sens est à confirmer.`
      : `La pièce est lue comme un ACHAT, mais elle est émise par ${ctx.tenant.nom} : le sens est à confirmer.`,
    preuves: {
      documentKind: p.documentKind,
      emetteur: p.emetteur.nom,
      dossier: ctx.tenant.nom,
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
  const emetteur = normaliserMatricule(p.emetteur.identifiantFiscal).chiffres;
  const numero = normNumero(p.numero);
  const semblable =
    emetteur && numero
      ? ctx.autresPieces.find(
          (a) =>
            normaliserMatricule(a.emetteurIdentifiantFiscal).chiffres === emetteur &&
            normNumero(a.numero) === numero,
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
  if (p.date > p.reception.recueLe)
    return {
      code: "coherence_dates",
      statut: "anomalie",
      motif: `La pièce est datée du ${p.date}, après sa réception le ${p.reception.recueLe}.`,
      preuves: { date: p.date, recueLe: p.reception.recueLe },
    };
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

function confiance(p: PieceAControler, ctx: ContexteControle): ResultatControle {
  const entrees = Object.entries(p.confianceParChamp);
  const bloquants = entrees.filter(([, c]) => c < ctx.seuilConfianceBloquant).map(([k]) => k);
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
    sensDeLaPiece(p, ctx),
    doublon(p, ctx),
    dates(p, ctx),
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
