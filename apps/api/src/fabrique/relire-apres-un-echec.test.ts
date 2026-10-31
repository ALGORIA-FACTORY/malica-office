/**
 * Relire après un échec ouvre un NOUVEAU travail — et l'échec se voit.
 *
 * Audit du 24 octobre 2026. La clé d'une demande de lecture était
 * `lecture_piece:<pièce>`, une fois pour toutes : après un échec définitif,
 * « Relire » retombait par idempotence sur le travail mort, que personne ne
 * reprend. Et rien ne disait aux écrans que la lecture avait échoué :
 * `capture.listAvecLecture` porte désormais le dernier travail de chaque
 * pièce, avec le seul CODE reconnu de son motif.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/relire-apres-un-echec.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { fabrique } from "../depots/fabrique.ts";
import { executerRpc } from "../rpc.ts";

import { inscrireIssue, prendreUnTravail } from "./travaux.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("relire après un échec", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `relire-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}R/A/M/000`;
  let patron: Utilisateur;
  let pme = "";
  let piece = "";

  before(async () => {
    const u = await creerCompte(`pme-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u, "le compte doit être créé");
    patron = u;
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6) as org`,
        ["pme", `ESSAI ${marque} PME`, "mandate", legalId, "TN", "TND"],
      );
      pme = rows[0]!.org;
      const p = await db.query<{ id: string }>(
        `select public.capture_piece_register($1, 'pdf', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}.pdf`, marque],
      );
      piece = p.rows[0]!.id;
    });
  });

  after(async () => {
    await fermerLePool();
  });

  const etatDansLaListe = () =>
    sousIdentiteDuServeur(patron.id, async (db) => {
      // Par le vrai chemin des écrans : la RPC, sous l'identité du dirigeant.
      const liste = (await executerRpc(db, {
        depot: "capture",
        methode: "listAvecLecture",
        args: [pme],
      })) as Array<{ id: string; lecture: { etat: string; code: string | null } | null }>;
      return liste.find((p) => p.id === piece)?.lecture ?? null;
    });

  it("tant qu'un travail vit, la même demande le retrouve", async () => {
    const a = await sousIdentiteDuServeur(patron.id, (db) =>
      fabrique.enregistrerLecture(db, piece),
    );
    const b = await sousIdentiteDuServeur(patron.id, (db) =>
      fabrique.enregistrerLecture(db, piece),
    );
    assert.equal(b.travailId, a.travailId, "un rejeu ne doit pas doubler le travail");
    assert.equal(b.deja, true);
    assert.equal((await etatDansLaListe())?.etat, "a_faire");
  });

  it("un échec se voit dans la liste, avec son code et sans le message brut", async () => {
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const pris = await prendreUnTravail(db, pme, ["lecture_piece"]);
      assert.ok(pris, "le travail doit être prenable");
      await inscrireIssue(db, {
        tenantId: pme,
        travailId: pris.travailId,
        tentative: pris.tentative,
        nature: "erreur_technique",
        motif: "lecture.illisible",
      });
    });
    const l = await etatDansLaListe();
    assert.equal(l?.etat, "en_erreur");
    assert.equal(l?.code, "lecture.illisible");
  });

  it("après l'échec, « Relire » ouvre un nouveau travail que la file reprend", async () => {
    const avant = await sousIdentiteDuServeur(patron.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select id from fabrique.travaux where piece_id = $1`,
        [piece],
      );
      return rows.map((r) => r.id);
    });
    const relu = await sousIdentiteDuServeur(patron.id, (db) =>
      fabrique.enregistrerLecture(db, piece),
    );
    assert.equal(relu.deja, false, "la relecture doit être un nouveau travail");
    assert.ok(!avant.includes(relu.travailId));
    assert.equal((await etatDansLaListe())?.etat, "a_faire", "la liste suit le dernier travail");

    const repris = await sousIdentiteDuServeur(patron.id, (db) =>
      prendreUnTravail(db, pme, ["lecture_piece"]),
    );
    assert.equal(repris?.travailId, relu.travailId, "la file doit reprendre la relecture");
  });

  it("un motif technique ne sort jamais vers l'écran", async () => {
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select travail_id as id from fabrique.etat_des_travaux_v
          where piece_id = $1 and etat = 'en_cours'`,
        [piece],
      );
      await inscrireIssue(db, {
        tenantId: pme,
        travailId: rows[0]!.id,
        tentative: 1,
        nature: "erreur_technique",
        motif: "connect ECONNREFUSED 10.0.0.12:8000",
      });
    });
    const l = await etatDansLaListe();
    assert.equal(l?.etat, "en_erreur");
    assert.equal(l?.code, null);
  });
});
