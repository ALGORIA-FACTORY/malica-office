/**
 * Recevoir la notification de Flouci — voir `notification-flouci.ts` pour ce
 * qui fait foi. Ce module ne fait que relier la signature vérifiée au chemin
 * ordinaire de vérification d'un paiement.
 *
 * Les réponses : 200 quand il n'y a rien (ou plus rien) à faire, ou que le
 * paiement est vérifié ; 401 pour une signature invalide ; 400 pour un corps
 * illisible ; 503 quand la vérification n'a pas pu aboutir — Flouci relance
 * alors, jusqu'à cinq fois. Aucune réponse ne dit l'état du paiement.
 */
import type { Request, Response } from "express";

import { horsRlsAuthentificationSeule, sousIdentiteDuServeur } from "../db.ts";
import { facturation } from "../depots/facturation.ts";
import { lireNotification, signatureFlouciValide } from "./notification-flouci.ts";

export async function recevoirNotificationFlouci(req: Request, res: Response): Promise<void> {
  const cle = process.env["FLOUCI_CLE_PRIVEE"]?.trim();
  if (!cle) {
    res.status(503).end();
    return;
  }
  const corps = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!signatureFlouciValide(req.get("x-flouci-signature"), corps, cle)) {
    res.status(401).end();
    return;
  }
  const n = lireNotification(corps);
  if (!n) {
    res.status(400).end();
    return;
  }
  const { rows } = await horsRlsAuthentificationSeule((db) =>
    db.query<{ u: string | null }>(
      "select public.paiement_payeur_a_relire($1, 'flouci', $2) as u",
      [n.paiementId, n.reference],
    ),
  );
  const payeur = rows[0]?.u ?? null;
  // Déjà constaté, ou inconnu sous cette référence : rien à faire, et Flouci
  // n'a pas à relancer.
  if (!payeur) {
    res.status(200).end();
    return;
  }
  try {
    await sousIdentiteDuServeur(payeur, (db) => facturation.verifierPaiement(db, n.paiementId));
    res.status(200).end();
  } catch (e) {
    const err = e as Error;
    console.error(`[paiement] notification flouci : ${err.name} ${err.message}`);
    res.status(503).end();
  }
}
