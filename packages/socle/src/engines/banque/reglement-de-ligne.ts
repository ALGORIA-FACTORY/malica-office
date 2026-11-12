/**
 * Le règlement qu'une ligne de relevé éteint — désignation déterministe.
 *
 * Recette du 11 novembre 2026 : « VIR PAPETERIE EL AMEN FA-2026-1111
 * −358,000 » ne proposait qu'« Ignorer », alors que la facture d'achat de
 * 358,000 attendait son règlement. Le rapprochement ne regardait que les
 * écritures déjà passées au compte de banque : un paiement pas encore inscrit
 * n'avait aucun vis-à-vis.
 *
 * Ce moteur désigne, pour une ligne sans vis-à-vis, la FACTURE OUVERTE qu'elle
 * règle. Il ne compose pas l'écriture : le règlement s'inscrit par le chemin
 * qui existe déjà (`construireReglement`, comptes lus au rôle et au
 * paramétrage de la comptabilité — R4, R10). Aucun modèle ne décide (R3).
 *
 *   - le SENS : une sortie règle une facture d'achat, une entrée une facture
 *     de vente ;
 *   - le MONTANT : exactement le reste dû, sans tolérance — un écart est une
 *     autre opération (escompte, frais) que l'expert inscrit lui-même ;
 *   - la RÉFÉRENCE : le numéro de la facture lu dans le libellé ou la
 *     référence de la ligne départage ;
 *   - aucune facture n'est proposée à deux lignes, aucune ligne ne reçoit une
 *     proposition ambiguë : dans le doute, rien n'est proposé.
 */
import { D } from "../../domain/decimal.ts";
import type { BankLine } from "../../contracts/rapprochement.v1.ts";
import type { SensDeLaPiece } from "../../sens-de-la-piece.ts";

/** Une facture inscrite dont le règlement n'est pas (entièrement) inscrit. */
export interface FactureOuverte {
  pieceId: string;
  sens: SensDeLaPiece;
  /** Ce qui reste dû, dans la devise du dossier. */
  reste: string;
  /**
   * Le compte du tiers que l'écriture de la facture porte, et que son
   * règlement solde. `null` quand il n'est pas univoque : rien ne se propose.
   */
  compteTiers: string | null;
  /** Le numéro de la facture, tel que lu. */
  reference: string | null;
  tiers: string | null;
  date: string;
}

export interface ReglementPropose {
  ligneId: string;
  facture: FactureOuverte;
  /** Le numéro de la facture figure sur la ligne. */
  referenceExacte: boolean;
}

function normaliser(texte: string | null): string {
  return (texte ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** La facture que chaque ligne règle, quand une seule le peut. */
export function reglementsDesLignes(
  lignes: readonly BankLine[],
  factures: readonly FactureOuverte[],
): ReglementPropose[] {
  const candidates = (l: BankLine) => {
    const montant = D(l.montant);
    if (montant.isZero()) return [];
    const sens: SensDeLaPiece = montant.isNegative() ? "facture_achat" : "facture_vente";
    return factures.filter(
      (f) => f.compteTiers !== null && f.sens === sens && D(f.reste).eq(montant.abs()),
    );
  };
  const citee = (l: BankLine, f: FactureOuverte) => {
    const ref = normaliser(f.reference);
    return ref.length > 0 && normaliser(`${l.label} ${l.reference ?? ""}`).includes(ref);
  };

  const parLigne = new Map<string, ReglementPropose>();
  const prises = new Map<string, number>();
  const retenir = (l: BankLine, f: FactureOuverte, referenceExacte: boolean) => {
    parLigne.set(l.id, { ligneId: l.id, facture: f, referenceExacte });
    prises.set(f.pieceId, (prises.get(f.pieceId) ?? 0) + 1);
  };

  // D'abord la référence : la facture que la ligne nomme.
  for (const l of lignes) {
    const nommees = candidates(l).filter((f) => citee(l, f));
    if (nommees.length === 1) retenir(l, nommees[0]!, true);
  }
  // Puis le montant seul, quand une seule facture non nommée le porte.
  const nommees = new Set(prises.keys());
  for (const l of lignes) {
    if (parLigne.has(l.id)) continue;
    const libres = candidates(l).filter((f) => !nommees.has(f.pieceId));
    if (libres.length === 1) retenir(l, libres[0]!, false);
  }
  // Une facture désignée par deux lignes n'est proposée à aucune.
  return lignes.flatMap((l) => {
    const p = parLigne.get(l.id);
    return p && prises.get(p.facture.pieceId) === 1 ? [p] : [];
  });
}

export interface LigneDeReglement {
  account_code: string;
  debit: string;
  credit: string;
}

/**
 * L'écriture que le règlement inscrira, telle que la ligne la porte : le
 * tiers de la facture contre le compte de la banque, au montant de la ligne.
 * Une sortie solde un fournisseur (débit du tiers, crédit de la banque), une
 * entrée un client (l'inverse). Aucun compte n'est écrit ici : le tiers vient
 * de l'écriture de la facture, la banque du compte que la comptabilité a
 * ouvert (R4, R10).
 */
export function lignesDuReglement(
  ligne: BankLine,
  facture: FactureOuverte,
  compteBanque: string,
): LigneDeReglement[] {
  const montant = D(ligne.montant).abs().toString();
  const tiers = facture.compteTiers ?? "";
  return D(ligne.montant).isNegative()
    ? [
        { account_code: tiers, debit: montant, credit: "0" },
        { account_code: compteBanque, debit: "0", credit: montant },
      ]
    : [
        { account_code: compteBanque, debit: montant, credit: "0" },
        { account_code: tiers, debit: "0", credit: montant },
      ];
}
