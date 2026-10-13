/**
 * L'écriture d'un règlement : ce que le moyen de paiement engage vraiment.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. Le dirigeant : « l'écriture comptable et le rapprochement
 * dépendent énormément du moyen de paiement ». Il a raison deux fois, et le
 * produit ne tenait ni l'une ni l'autre.
 *
 * Le référentiel portait pourtant déjà le compte de trésorerie de chaque
 * moyen — 54 Caisse pour les espèces, 532 Banques pour le chèque, la carte et
 * le virement, 403 Effets à payer pour la traite, chacun avec sa référence au
 * Système Comptable des Entreprises. Vérifié le 13 octobre :
 * `tresorerie_account` n'était lu par AUCUN code de production. L'expert
 * lisait le moyen à l'écran et choisissait le compte à la main.
 *
 * C'est le motif récurrent de ce dépôt — l'outil construit, le consommateur
 * absent — et il tombait ici sur la moitié de la promesse faite au cabinet.
 *
 * ================================================= CE QUE CETTE ÉCRITURE DIT
 *
 * La facture constate une dette ; le règlement l'éteint. Ce sont DEUX faits,
 * à deux dates, et les confondre est l'erreur qui empêche tout rapprochement
 * bancaire — une facture de septembre payée en octobre touche la trésorerie
 * en octobre, pas en septembre.
 *
 *   Achat   : débit 401 fournisseur   / crédit trésorerie (54, 532, 403)
 *   Vente   : débit trésorerie        / crédit 411 client
 *
 * Le compte du tiers vient de `counterparty_account`, celui de la trésorerie
 * de `tresorerie_account`, et le journal de `journal_code` — tous trois du
 * pack, datés, surchargeables. R4 : aucun numéro de compte n'est écrit ici.
 *
 * ========================================================= CE QU'ELLE REFUSE
 *
 * Un règlement sans montant, sans date, ou dont le moyen n'ouvre aucun compte
 * de trésorerie — « pas encore payé » en est un, et c'est précisément pour
 * cela qu'il n'a pas de compte. Refuser est la seule réponse juste : une
 * écriture déséquilibrée ou posée sur un compte deviné est pire qu'une
 * écriture absente.
 *
 * R1 : ce module ne connaît ni la base, ni le réseau, ni le modèle. Il reçoit
 * des valeurs et rend des valeurs.
 */
import { sommeDecimale } from "../somme-decimale.ts";

/** Le sens que le moteur sait traiter. Le reste n'y entre pas. */
export type SensDuReglement = "facture_achat" | "facture_vente";

export interface EntreeReglement {
  /** Le sens de la pièce réglée. */
  sens: SensDuReglement;
  /** Le montant réglé, tel que le Socle le rend — jamais recalculé ici. */
  montant: string;
  devise: string;
  /** La date du règlement, déclarée. C'est elle qui date l'écriture. */
  payeLe: string;
  /** Le libellé du moyen, tel que le pack le traduit : « Chèque », « Espèces ». */
  moyenLibelle: string;
  /** Le compte de trésorerie du moyen, du pack. */
  tresorerieAccount: string;
  /** Le journal du moyen, du pack : caisse, banque, effets. */
  journalCode: string;
  /** Le compte du tiers, du pack : 401 à l'achat, 411 à la vente. */
  counterpartyAccount: string;
  /** Le tiers, pour le libellé — jamais pour un compte. */
  tiers: string | null;
  /** La référence du règlement : numéro de chèque, de traite, du virement. */
  reference: string | null;
  /** La référence de la pièce réglée, pour relier les deux écritures. */
  referencePiece: string | null;
}

export interface LigneDeReglement {
  account_code: string;
  libelle: string;
  debit: string;
  credit: string;
}

export interface EcritureDeReglement {
  journal: string;
  dateEcriture: string;
  devise: string;
  libelle: string;
  lignes: LigneDeReglement[];
}

/** Ce qui manque pour qu'un règlement s'écrive. Jamais un message seul. */
export class ReglementIncomplet extends Error {
  /**
   * Ce qui manque, nommé.
   *
   * Déclaré ici et non en propriété de paramètre : `--experimental-strip-types`
   * retire les types sans les compiler, et ne sait pas construire le champ
   * qu'une propriété de paramètre sous-entend.
   */
  readonly manque: string;

  constructor(manque: string) {
    super(`Le règlement ne peut pas s'écrire : ${manque}.`);
    this.name = "ReglementIncomplet";
    this.manque = manque;
  }
}

const ZERO = /^-?0+([.,]0+)?$/;

/**
 * Composer le libellé d'un règlement.
 *
 * Il porte la nature, le tiers, le moyen et la référence — ce qu'un
 * rapprochement bancaire cherche, et dans cet ordre. Deux règlements du même
 * fournisseur le même mois doivent rester discernables en balance.
 */
function composerLibelle(e: EntreeReglement): string {
  const nature = e.sens === "facture_achat" ? "Règlement fournisseur" : "Encaissement client";
  const morceaux = [nature];
  if (e.tiers !== null && e.tiers.trim() !== "") morceaux.push(e.tiers.trim());
  morceaux.push(e.moyenLibelle);
  if (e.reference !== null && e.reference.trim() !== "") morceaux.push(`n° ${e.reference.trim()}`);
  if (e.referencePiece !== null && e.referencePiece.trim() !== "")
    morceaux.push(`sur ${e.referencePiece.trim()}`);
  return morceaux.join(" · ");
}

/**
 * L'écriture du règlement, ou un refus motivé.
 *
 * Deux lignes, jamais plus : un règlement éteint une dette, il ne la ventile
 * pas. La TVA a été traitée par l'écriture de la facture, et la reprendre ici
 * la compterait deux fois.
 */
export function construireReglement(e: EntreeReglement): EcritureDeReglement {
  if (e.montant.trim() === "" || ZERO.test(e.montant.trim()))
    throw new ReglementIncomplet("aucun montant n'a été réglé");
  if (e.payeLe.trim() === "")
    throw new ReglementIncomplet("la date du règlement n'est pas renseignée");
  if (e.tresorerieAccount.trim() === "")
    throw new ReglementIncomplet("ce moyen de paiement n'ouvre aucun compte de trésorerie");
  if (e.journalCode.trim() === "")
    throw new ReglementIncomplet("ce moyen de paiement n'a pas de journal au paramétrage");
  if (e.counterpartyAccount.trim() === "")
    throw new ReglementIncomplet("le compte du tiers n'est pas au paramétrage");

  // Le montant tel qu'il est rendu, normalisé une seule fois — et jamais
  // recalculé : il vient du Socle, qui l'a déjà tranché.
  const montant = sommeDecimale([e.montant]);
  const libelle = composerLibelle(e);

  const tresorerie: LigneDeReglement = {
    account_code: e.tresorerieAccount,
    libelle: e.moyenLibelle,
    debit: e.sens === "facture_vente" ? montant : "0.000",
    credit: e.sens === "facture_vente" ? "0.000" : montant,
  };
  const tiers: LigneDeReglement = {
    account_code: e.counterpartyAccount,
    libelle: e.tiers ?? e.moyenLibelle,
    debit: e.sens === "facture_achat" ? montant : "0.000",
    credit: e.sens === "facture_achat" ? "0.000" : montant,
  };

  return {
    journal: e.journalCode,
    // La date du RÈGLEMENT, pas celle de la facture. Une facture de septembre
    // payée en octobre touche la trésorerie en octobre : les confondre rend
    // tout rapprochement bancaire impossible.
    dateEcriture: e.payeLe,
    devise: e.devise,
    libelle,
    // À l'achat, la dette s'éteint d'abord ; à la vente, la trésorerie entre
    // d'abord. L'ordre suit la lecture, et le débit précède toujours.
    lignes: e.sens === "facture_achat" ? [tiers, tresorerie] : [tresorerie, tiers],
  };
}
