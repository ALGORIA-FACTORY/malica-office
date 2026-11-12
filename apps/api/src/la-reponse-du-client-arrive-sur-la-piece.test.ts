/**
 * La réponse du client à un retour arrive à la comptabilité (recette du
 * 11 novembre 2026, point 2.2) : elle se lit sur la pièce et dans son journal,
 * avec son texte, que la pièce soit renvoyée ou non.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-reponse-du-client-arrive-sur-la-piece.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

interface Fait {
  action: string;
  actor: string | null;
  payload: { texte?: string; chez?: string } | null;
}

describe("la réponse du client arrive sur la pièce", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let piece: string;
  const TEXTE = "Le bon de livraison est chez le transporteur, je vous l'envoie lundi.";

  const journal = async () =>
    (await s.fait("expert", "supervision.auditForPiece", piece)) as Fait[];

  before(async () => {
    s = await monterUneSociete(`reponse-${Date.now()}`);
    piece = await s.deposer("amel", "entite");
    await s.lire("amel", piece);
    await s.fait("amel", "collab.envoyer", piece);
    await s.fait("expert", "supervision.retourner", {
      pieceId: piece,
      motifId: s.motifs["montant_incoherent"]!,
      note: "Le bon de livraison manque.",
    });
    await s.fait("amel", "capture.repondreAuCabinet", piece, TEXTE);
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("la comptabilité lit le texte dans le journal de la pièce, sans renvoi", async () => {
    const reponse = (await journal()).find((f) => f.action === "piece.reponse_client");
    assert.ok(reponse, "le fait est au journal de la pièce");
    assert.equal(reponse.payload?.texte, TEXTE);
    assert.equal(reponse.actor, s.gens.amel.id);
  });

  it("la comptabilité en est prévenue, texte compris", async () => {
    const notifs = (await s.fait("expert", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string; note?: string };
    }>;
    const n = notifs.find((x) => x.kind === "piece.reponse_client" && x.payload.piece_id === piece);
    assert.equal(n?.payload.note, TEXTE);
  });

  it("le texte reste au journal de la pièce après le renvoi", async () => {
    await s.fait("amel", "collab.envoyer", piece);
    const faits = await journal();
    assert.ok(faits.some((f) => f.action === "piece.renvoyee"));
    assert.equal(faits.find((f) => f.action === "piece.reponse_client")?.payload?.texte, TEXTE);
  });
});
