/**
 * La recherche ⌘K trouve pièces et écritures, dans les droits de qui cherche
 * (recette du 11 novembre 2026, point 2.6) : « FA-2026-1111 », « PAPETERIE »,
 * « 358 », « 606 » renvoyaient « Rien ne correspond ».
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-recherche-trouve-pieces-et-ecritures.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

interface Resultats {
  pieces: Array<{ pieceId: string; montant: string | null }>;
  ecritures: Array<{ ecritureId: string; compte: string | null; pieceId: string | null }>;
}

describe("la recherche trouve pièces et écritures", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let autre: SocieteDEssai;
  let piece: string;
  let ecriture: string;
  const chercher = (qui: SocieteDEssai, texte: string) =>
    qui.fait("expert", "supervision.chercher", qui.cabinet, texte) as Promise<Resultats>;

  before(async () => {
    const marque = `cherche-${Date.now()}`;
    s = await monterUneSociete(marque);
    autre = await monterUneSociete(`${marque}-autre`);
    piece = await s.deposer("amel", "entite");
    await s.lire("amel", piece);
    await s.fait("amel", "collab.envoyer", piece);
    // L'émetteur dit par la personne, et la pièce inscrite (601 / 401, 100,000).
    await s.fait("amel", "capture.preciser", piece, "issuer", "Papeterie Él Amen");
    ecriture = await s.priseEnCharge(piece);
  });
  after(async () => {
    await s.fermer();
    await autre.fermer();
    await fermerLePool();
  });

  it("une pièce par son émetteur, sans accents ni casse", async () => {
    const r = await chercher(s, "papeterie el");
    assert.ok(r.pieces.some((p) => p.pieceId === piece));
  });

  it("une pièce par son montant, entier compris", async () => {
    assert.ok((await chercher(s, "100")).pieces.some((p) => p.pieceId === piece));
    assert.ok((await chercher(s, "100,000")).pieces.some((p) => p.pieceId === piece));
    assert.equal(
      (await chercher(s, "101")).pieces.some((p) => p.pieceId === piece),
      false,
    );
  });

  it("une écriture par son compte", async () => {
    const r = await chercher(s, "601");
    const e = r.ecritures.find((x) => x.ecritureId === ecriture);
    assert.equal(e?.compte, "601");
    assert.equal(e?.pieceId, piece);
  });

  it("une autre comptabilité ne trouve rien de ce dossier", async () => {
    const r = await chercher(autre, "papeterie");
    assert.equal(
      r.pieces.some((p) => p.pieceId === piece),
      false,
    );
    const e = await chercher(autre, "601");
    assert.equal(
      e.ecritures.some((x) => x.ecritureId === ecriture),
      false,
    );
  });
});
