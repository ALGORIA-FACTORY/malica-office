/**
 * Le règlement d'une pièce, composé côté serveur.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026, le dirigeant : « l'écriture comptable et le rapprochement
 * dépendent énormément du moyen de paiement ». Il a raison, et le produit ne
 * tenait rien de cette promesse.
 *
 * Le référentiel portait depuis le 11 octobre le compte de trésorerie de
 * chaque moyen — 54 Caisse, 532 Banques, 403 Effets à payer. Vérifié le
 * 13 octobre : `tresorerie_account` n'était lu par AUCUN code de production.
 * L'expert lisait le moyen à l'écran et choisissait le compte à la main.
 *
 * ========================================================= CE QUE CE MODULE FAIT
 *
 * Il LIT — le paiement, la pièce, le pack — et il APPELLE le moteur du Socle.
 * Il n'émet aucune valeur liante : les comptes viennent du pack, le montant du
 * paiement déclaré, la date du règlement. R3 tient.
 *
 * Et il refuse franchement ce qui ne s'écrit pas : un paiement éteint par une
 * annulation, un « pas encore payé », une pièce dont le sens n'est pas tranché.
 */
import {
  construireReglement,
  ReglementIncomplet,
  type EcritureDeReglement,
} from "@malica/socle/use-cases/ecriture-de-reglement";

import type { Requete } from "../db.ts";
import { enDecimal } from "../malica/lecture/montants.ts";

import { lireParametres } from "./analyse.ts";

export type PropositionDeReglement =
  | { ok: true; ecriture: EcritureDeReglement; packVersionId: string; pieceId: string }
  | { ok: false; raison: string };

const SENS_CONNU = new Set(["facture_achat", "facture_vente"]);

export async function propositionDeReglement(
  db: Requete,
  paiementId: string,
): Promise<PropositionDeReglement> {
  const { rows } = await db.query<{
    piece_id: string;
    moyen_code: string;
    montant_mineur: string | null;
    devise: string;
    paye_le: string | null;
    reference: string | null;
    eteint: boolean;
    pack_version_id: string;
    document_kind: string | null;
    tresorerie_account: string | null;
    journal_code: string | null;
    moyen_libelle: string;
  }>(
    `select p.piece_id, p.moyen_code, p.montant_mineur, p.devise, p.paye_le::text as paye_le,
            p.reference, p.eteint, p.pack_version_id,
            pi.document_kind,
            m.tresorerie_account, m.journal_code, m.libelle as moyen_libelle
       from paiements_v p
       join pieces_v pi on pi.id = p.piece_id
       left join ref_payment_means_v m
         on m.pack_version_id = p.pack_version_id and m.code = p.moyen_code
      where p.id = $1`,
    [paiementId],
  );
  const l = rows[0];
  if (!l) return { ok: false, raison: "Ce règlement n'existe pas, ou n'est pas lisible ici." };

  // Un paiement éteint n'engage plus rien : lui faire produire une écriture
  // ferait entrer en comptabilité un fait que la personne a annulé.
  if (l.eteint)
    return { ok: false, raison: "Ce règlement a été annulé : il ne produit aucune écriture." };
  if (l.montant_mineur === null || l.paye_le === null)
    return { ok: false, raison: "Aucun montant n'a été réglé : il n'y a rien à écrire." };
  if (!SENS_CONNU.has(l.document_kind ?? ""))
    return {
      ok: false,
      raison: "Le sens de la pièce n'est pas tranché : achat ou vente reste à confirmer.",
    };

  // Le compte du tiers vient du pack, par le sens de la pièce. Toutes les
  // lignes d'un même sens le partagent — on lit donc la première venue.
  const { rows: mapping } = await db.query<{ counterparty_account: string }>(
    `select counterparty_account from ref_account_mappings_v
      where pack_version_id = $1 and document_kind = $2
      limit 1`,
    [l.pack_version_id, l.document_kind],
  );
  const counterparty = mapping[0]?.counterparty_account ?? "";

  // Les décimales viennent du paramétrage daté, par la MÊME lecture que
  // l'analyse — deux définitions de la devise finiraient par diverger.
  const parametres = await lireParametres(db, l.pack_version_id, l.paye_le);
  const decimales = parametres["money.decimals"]!;
  try {
    const ecriture = construireReglement({
      sens: l.document_kind as "facture_achat" | "facture_vente",
      montant: enDecimal(Number(l.montant_mineur), decimales),
      devise: l.devise,
      payeLe: l.paye_le,
      moyenLibelle: l.moyen_libelle ?? l.moyen_code,
      tresorerieAccount: l.tresorerie_account ?? "",
      journalCode: l.journal_code ?? "",
      counterpartyAccount: counterparty,
      tiers: null,
      reference: l.reference,
      referencePiece: null,
    });
    return { ok: true, ecriture, packVersionId: l.pack_version_id, pieceId: l.piece_id };
  } catch (e) {
    if (e instanceof ReglementIncomplet) return { ok: false, raison: e.message };
    throw e;
  }
}
