/**
 * Les demandes se lisent par étape (revue Codex de #146).
 *
 * Une demande de rappel a deux étapes : le siège la fait au propriétaire, le
 * propriétaire au comptable. Le dernier fait TOUTES ÉTAPES confondues n'est
 * pas l'état de la demande : quand le propriétaire tranchait la demande d'un
 * siège après avoir lui-même demandé le rappel au comptable, sa décision
 * devenait « le dernier fait », et la garde d'inscription
 * (`app.pas_d_inscription_sous_rappel`) laissait passer une écriture alors
 * que le rappel du comptable restait en attente ; l'écran du siège, lui,
 * proposait une seconde demande.
 *
 * L'état se lit par une seule fonction de la base, par objet ET par étape
 * (`app.etat_des_demandes`), servie à l'écran par `collab.etatDesDemandes`.
 *
 *   node --experimental-strip-types --test src/les-demandes-se-lisent-par-etape.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

interface Etat {
  objet: string;
  etape: string;
  fait: string;
  transmise: boolean;
}

describe("les demandes se lisent par étape", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`etapes-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  /** Une pièce de Sami, chez le comptable, pas encore inscrite. */
  const chezLeComptable = async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    await s.fait("sami", "collab.envoyer", id);
    await s.fait("amel", "collab.envoyer", id);
    return id;
  };
  const etat = async (qui: "sami" | "amel" | "expert", id: string) => {
    const lignes = (await s.fait(qui, "collab.etatDesDemandes", id)) as Etat[];
    const de = (etape: string) =>
      lignes.find((l) => l.objet === "rappel" && l.etape === etape) ?? null;
    return { proprietaire: de("proprietaire"), cabinet: de("cabinet") };
  };
  const demander = (qui: "sami" | "amel", id: string) =>
    s.fait(qui, "collab.demanderSurPiece", id, "rappel");
  const trancher = (qui: "amel" | "expert", id: string, accorde: boolean) =>
    s.fait(qui, "collab.repondreSurPiece", id, "rappel", accorde, accorde ? null : "Non");
  const inscriptionBloquee = (id: string) =>
    assert.rejects(s.priseEnCharge(id), /refus\.piece\.rappelEnAttente|rappel/);

  it("le propriétaire demande d'abord, puis le siège : l'accord du propriétaire ne lève pas la garde", async () => {
    const id = await chezLeComptable();
    await demander("amel", id);
    await demander("sami", id);
    await trancher("amel", id, true);
    await inscriptionBloquee(id);
    const e = await etat("sami", id);
    assert.equal(e.proprietaire?.fait, "accordee");
    assert.equal(e.proprietaire?.transmise, true, "la demande attend désormais le comptable");
    assert.equal(e.cabinet?.fait, "demandee");
  });

  it("le propriétaire demande d'abord, puis refuse celle du siège : la garde tient", async () => {
    const id = await chezLeComptable();
    await demander("amel", id);
    await demander("sami", id);
    await trancher("amel", id, false);
    await inscriptionBloquee(id);
    const e = await etat("sami", id);
    assert.equal(e.proprietaire?.fait, "refusee");
    assert.equal(e.proprietaire?.transmise, false);
  });

  it("le siège demande d'abord, le propriétaire accorde : la demande part, le comptable refuse, l'inscription reprend", async () => {
    const id = await chezLeComptable();
    await demander("sami", id);
    await trancher("amel", id, true);
    await inscriptionBloquee(id);
    let e = await etat("sami", id);
    assert.equal(e.proprietaire?.transmise, true);
    assert.equal(e.cabinet?.fait, "demandee");
    await trancher("expert", id, false);
    e = await etat("sami", id);
    assert.equal(e.cabinet?.fait, "refusee");
    assert.equal(e.proprietaire?.transmise, true, "le siège lit la réponse du comptable");
    await s.priseEnCharge(id);
  });

  it("le comptable accorde : la pièce revient à la société, la demande est close aux deux étapes", async () => {
    const id = await chezLeComptable();
    await demander("sami", id);
    await trancher("amel", id, true);
    await trancher("expert", id, true);
    const e = await etat("sami", id);
    assert.equal(e.cabinet?.fait, "accordee");
    const { rows } = await s.admin.query(`select vis from capture.pieces where id = $1`, [id]);
    assert.equal(rows[0]?.vis, "entite");
  });

  it("le comptable ne lit que l'étape qui lui est faite", async () => {
    const id = await chezLeComptable();
    await demander("sami", id);
    await trancher("amel", id, true);
    const lignes = (await s.fait("expert", "collab.etatDesDemandes", id)) as Etat[];
    assert.deepEqual(
      lignes.map((l) => l.etape),
      ["cabinet"],
    );
  });
});
