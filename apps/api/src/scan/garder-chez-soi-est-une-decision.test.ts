/**
 * Garder une pièce chez soi est une DÉCISION, pas un défaut.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « et le choix entre transmettre au cabinet ou espace
 * privé ? S'il n'est pas fait, fais-le. »
 *
 * Il ne l'était pas. L'écran de la pièce portait un commentaire affirmant
 * « deux boutons de même poids », et il n'y en avait qu'UN : « Transmettre à
 * {cabinet} », surmonté de la question, suivi d'une ligne de 12,5 px disant
 * « sinon elle reste chez vous ». Garder n'était pas un choix qu'on fait,
 * c'était ce qui arrivait quand on ne faisait rien.
 *
 * Deux conséquences, et la seconde est la vraie :
 *
 *   — l'un des deux chemins n'avait pas de bouton, donc la décision n'était
 *     pas offerte ;
 *   — rien ne distinguait « j'ai décidé de la garder » de « je n'ai pas
 *     encore répondu ». La question restait donc posée à chaque visite, sur
 *     toutes les pièces, pour toujours — un écran qui redemande ce qu'on
 *     vient de lui dire apprend à ne plus répondre.
 *
 * ====================================================== CE QUI NE CHANGE PAS
 *
 * La règle du retour, telle que le commanditaire l'a posée : « la seule
 * action qui demande l'autorisation du cabinet est celle d'une pièce
 * transmise ». Garder se défait donc librement — « j'ai classé dans mon
 * coffre, j'aurai toujours la possibilité de transmettre au cabinet ».
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le choix entre le cabinet et l'espace privé", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `garder-${Date.now()}`;
  let u: Utilisateur;
  let org = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  async function piece(cle: string) {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    return p.id;
  }

  const etat = (id: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{
        vis: string;
        gardee_le: Date | null;
        transmise_le: Date | null;
      }>(`select vis, gardee_le, transmise_le from capture.pieces where id = $1`, [id]);
      return rows[0]!;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      ),
    );
    await fermerLePool();
  });

  it("une pièce qui vient d'être lue n'a RÉPONDU À RIEN", async () => {
    /*
     * C'est l'état qui manquait. « Personnel » ne voulait rien dire : c'était
     * à la fois l'état de départ et celui d'un choix assumé, donc l'écran ne
     * pouvait pas savoir s'il devait poser la question.
     */
    const id = await piece("neuve");
    const e = await etat(id);
    assert.equal(e.vis, "personnel");
    assert.equal(e.gardee_le, null, "rien n'a été décidé, et cela se lit");
    assert.equal(e.transmise_le, null);
  });

  it("garder chez soi s'inscrit, et se date", async () => {
    const id = await piece("gardee");
    await rpc("collab", "garderPiece", id);
    const e = await etat(id);
    assert.equal(e.vis, "personnel", "garder ne change pas la visibilité : il la CONFIRME");
    assert.ok(e.gardee_le, "sans date, l'écran reposerait la question à la visite suivante");
  });

  it("le même geste deux fois ne redate rien", async () => {
    // Le doigt ripe, l'écran revient : la date de la décision est celle du
    // jour où elle a été prise, pas celle du dernier tap.
    const id = await piece("deux-fois");
    await rpc("collab", "garderPiece", id);
    const premier = (await etat(id)).gardee_le;
    await rpc("collab", "garderPiece", id);
    assert.deepEqual((await etat(id)).gardee_le, premier);
  });

  it("et une pièce gardée part au cabinet quand on veut, sans rien demander", async () => {
    /*
     * L'exemple du commanditaire, mot pour mot : « j'ai classé dans mon
     * coffre, j'aurai toujours la possibilité de transmettre au cabinet ».
     * Garder n'est donc pas une porte qui se ferme.
     */
    const id = await piece("gardee-puis-partie");
    await rpc("collab", "garderPiece", id);
    await rpc("collab", "setPieceVis", id, "partage");

    const e = await etat(id);
    assert.equal(e.vis, "partage");
    assert.ok(e.transmise_le, "c'est cette date qui range la TVA");
    assert.equal(
      e.gardee_le,
      null,
      "la pièce n'est plus gardée : laisser les deux dates donnerait deux vérités sur le même fait",
    );
  });

  it("une pièce DÉJÀ transmise ne se « garde » pas en silence", async () => {
    /*
     * Ce serait le retrait unilatéral que la base refuse depuis le
     * 11 octobre, repeint en décision d'espace privé. Le chemin du retour
     * existe, et il passe par l'accord du cabinet.
     */
    const id = await piece("deja-partie");
    await rpc("collab", "setPieceVis", id, "partage");
    await assert.rejects(
      () => rpc("collab", "garderPiece", id),
      /accord du cabinet/,
      "sinon un bouton « garder » contournerait la seule règle qui exige un accord",
    );
    assert.equal((await etat(id)).vis, "partage");
  });

  it("la décision est lisible par l'application, pas seulement par la base", async () => {
    // Une colonne que la vue n'expose pas est une colonne qui n'existe pas :
    // c'est l'oubli exact du 11 octobre sur `transmise_le`.
    const id = await piece("lisible");
    await rpc("collab", "garderPiece", id);
    const vue = (await rpc("capture", "dossier", id)) as {
      piece: { gardeeLe: string | null };
    };
    assert.ok(vue.piece.gardeeLe, "l'écran doit pouvoir arrêter de poser la question");
  });
});
