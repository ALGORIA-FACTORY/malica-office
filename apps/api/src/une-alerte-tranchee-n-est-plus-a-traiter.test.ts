/**
 * Une alerte tranchée n'est plus « à traiter » (décision du 8 novembre 2026,
 * recette du 11 novembre, point 2.3).
 *
 * L'alerte d'une pièce retournée restait non lue après le renvoi et la
 * validation, et celle d'un mandat proposé après son acceptation : « Mes
 * sociétés » comptait deux choses à traiter qui ne l'étaient plus. Et l'alerte
 * d'une prise en charge déjà démarrée disait encore « propose ».
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-alerte-tranchee-n-est-plus-a-traiter.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

interface Alerte {
  id: string;
  kind: string;
  payload: { piece_id?: string; tranchee?: string; acces_id?: string };
  readAt: string | null;
}

describe("une alerte tranchée n'est plus à traiter", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  const alertes = async () => (await s.fait("amel", "collab.notifications", [s.pme])) as Alerte[];
  const duRetour = async (piece: string) =>
    (await alertes()).find((a) => a.kind === "piece.retournee" && a.payload.piece_id === piece);
  const retournee = async () => {
    const piece = await s.deposer("amel", "entite");
    await s.lire("amel", piece);
    await s.fait("amel", "collab.envoyer", piece);
    await s.fait("expert", "supervision.retourner", {
      pieceId: piece,
      motifId: s.motifs["montant_incoherent"]!,
      note: "Le total ne tombe pas juste.",
    });
    return piece;
  };

  before(async () => {
    s = await monterUneSociete(`tranchee-${Date.now()}`);
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("l'alerte d'un retour attend tant que la pièce est retournée, plus après le renvoi", async () => {
    const piece = await retournee();
    assert.equal((await duRetour(piece))?.readAt, null, "elle attend un geste");
    await s.fait("amel", "collab.envoyer", piece);
    assert.ok((await duRetour(piece))?.readAt, "renvoyée : l'alerte est tranchée");
  });

  it("un second retour de la même pièce attend à son tour", async () => {
    const piece = await retournee();
    await s.fait("amel", "collab.envoyer", piece);
    await s.fait("expert", "supervision.retourner", {
      pieceId: piece,
      motifId: s.motifs["montant_incoherent"]!,
      note: "Toujours pas.",
    });
    const deLaPiece = (await alertes()).filter(
      (a) => a.kind === "piece.retournee" && a.payload.piece_id === piece,
    );
    assert.deepEqual(deLaPiece.map((a) => a.readAt === null).sort(), [false, true]);
  });

  it("gardée par le dirigeant, la pièce retournée n'attend plus", async () => {
    const piece = await retournee();
    await s.fait("amel", "collab.garderPiece", piece);
    assert.ok((await duRetour(piece))?.readAt);
  });

  it("l'alerte du mandat proposé est tranchée dès qu'il est accepté", async () => {
    const mandat = (await alertes()).find((a) => a.kind === "mandat.propose");
    assert.ok(mandat, "l'alerte du mandat");
    assert.ok(mandat.readAt, "accepté : plus rien à traiter");
    assert.equal(mandat.payload.tranchee, "actif");
  });

  it("l'alerte d'une prise en charge dit qu'elle a démarré", async () => {
    const { id } = (await s.fait(
      "expert",
      "facturation.proposerAbonnement",
      s.cabinet,
      s.pme,
      "solo",
    )) as { id: string };
    const avant = (await alertes()).find(
      (a) => a.kind === "acces.propose" && a.payload.acces_id === id,
    );
    assert.equal(avant?.readAt, null);
    assert.equal(avant?.payload.tranchee, undefined);
    await s.fait("amel", "facturation.repondreAbonnement", id, true);
    const apres = (await alertes()).find(
      (a) => a.kind === "acces.propose" && a.payload.acces_id === id,
    );
    assert.ok(apres?.readAt);
    assert.equal(apres?.payload.tranchee, "actif");
  });
});
