/**
 * La route du PDF d'une facture : `GET /factures/:id/pdf?langue=fr|en|ar`.
 *
 * Un flux binaire n'a pas sa place dans `/rpc`. L'autorisation est un
 * `select` sous l'identité de l'appelant (`facturation.document_de_facture`) :
 * si la RLS ne rend pas la facture, la réponse est 404 — jamais 403, qui
 * dirait qu'elle existe. Le PDF se rend depuis l'instantané de la facture,
 * qui ne change plus : rendu de nouveau, il redonne les octets de l'original.
 */
import type { Request, Response } from "express";

import { sousIdentite } from "../../db.ts";
import { lienDePaiement } from "../../depots/tour-commerce.ts";
import { langueDemandee, lireDocument } from "./document.ts";
import { rendreLaFacture } from "./rendu.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function servirLaFacture(req: Request, res: Response): Promise<void> {
  const id = String(req.params["id"] ?? "");
  if (!UUID.test(id)) {
    res.status(404).end();
    return;
  }
  const document = await sousIdentite(req.utilisateur!.id, (db) =>
    lireDocument(db, id, langueDemandee(req.query["langue"])),
  );
  if (!document) {
    res.status(404).end();
    return;
  }
  const pdf = rendreLaFacture(document, { lienPaiement: lienDePaiement(document.route_paiement) });
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `inline; filename="${document.facture.numero}.pdf"`);
  res.setHeader("cache-control", "private, no-store");
  res.send(pdf);
}
