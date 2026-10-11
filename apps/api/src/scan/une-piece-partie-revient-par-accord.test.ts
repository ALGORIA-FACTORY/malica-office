/**
 * Une pièce partie ne revient que par accord du cabinet.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026 : j'ai livré un rappel UNILATÉRAL, pour sortir d'un état
 * qu'on n'avait pas choisi. 11 octobre, le commanditaire : « le rappel de la
 * pièce doit être approuvé par le cabinet ».
 *
 * Il a raison, et j'avais corrigé un défaut par un autre. Le cabinet travaille
 * sur ce qu'il a reçu ; une pièce qui disparaît de sa file sans un mot est
 * pire que l'état bloqué qu'on voulait défaire.
 *
 * Et le même jour, la règle générale : « il faut toujours prévoir une action
 * de retour ; la SEULE qui demande l'autorisation du cabinet est celle d'une
 * pièce transmise ». Ces épreuves tiennent les deux faces de cette règle.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le retour d'une pièce", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `retour-${Date.now()}`;
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

  /** Une pièce déposée, chez le dirigeant seul. */
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

  const visDe = (id: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ vis: string; transmise_le: Date | null }>(
        `select vis, transmise_le from capture.pieces where id = $1`,
        [id],
      );
      return rows[0]!;
    });

  const faits = (id: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ fait: string; note: string | null }>(
        `select fait, note from collab.demandes_sur_piece
          where piece_id = $1 order by created_at`,
        [id],
      );
      return rows;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '1876543W/A/M/000', 'TN', 'TND') as id`,
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

  /*
   * ============================= LE SENS LIBRE : DU COFFRE VERS LE CABINET
   *
   * L'exemple du commanditaire : « j'ai classé dans mon coffre, j'aurai
   * toujours la possibilité de transmettre au cabinet ». Ce sens-là ne
   * demande rien à personne, et il ne doit jamais se fermer.
   */
  it("du coffre vers le cabinet : libre, et autant de fois qu'on veut", async () => {
    const id = await piece("libre");
    assert.equal((await visDe(id)).vis, "personnel", "une pièce naît chez son dirigeant");

    await rpc("collab", "setPieceVis", id, "partage");
    const apres = await visDe(id);
    assert.equal(apres.vis, "partage");
    assert.ok(apres.transmise_le, "l'envoi se date, sinon aucune TVA ne peut être rangée");
  });

  it("une pièce gardée au coffre se reprend sans rien demander", async () => {
    // Elle n'est jamais partie : il n'y a personne à qui demander, et exiger
    // un accord inexistant enfermerait le dirigeant chez lui.
    const id = await piece("jamais-partie");
    await assert.rejects(
      () => rpc("collab", "demanderSurPiece", id, "rappel"),
      /n'est pas partagee|rien a demander/,
    );
  });

  /*
   * ======================= LE SENS QUI DEMANDE : DU CABINET VERS LE COFFRE
   */
  it("une pièce transmise ne revient PAS d'elle-même", async () => {
    const id = await piece("demande");
    await rpc("collab", "setPieceVis", id, "partage");

    const r = (await rpc("collab", "demanderSurPiece", id, "rappel")) as {
      dejaDemandee: boolean;
    };
    assert.equal(r.dejaDemandee, false);
    assert.equal(
      (await visDe(id)).vis,
      "partage",
      "demander n'est pas obtenir : la pièce reste chez le cabinet",
    );
    assert.deepEqual(
      (await faits(id)).map((f) => f.fait),
      ["demandee"],
    );
  });

  it("deux fois la même demande ne fait pas deux lignes dans la file du cabinet", async () => {
    const id = await piece("doublon");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    const r = (await rpc("collab", "demanderSurPiece", id, "rappel")) as {
      dejaDemandee: boolean;
    };
    assert.equal(r.dejaDemandee, true);
    assert.equal((await faits(id)).length, 1);
  });

  it("l'accord REND la pièce, dans le même geste", async () => {
    // Deux gestes séparés laisseraient une demande accordée sans effet, et
    // personne ne saurait laquelle des deux vérités croire.
    const id = await piece("accord");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await rpc("collab", "repondreSurPiece", id, "rappel", true, null);

    const apres = await visDe(id);
    assert.equal(apres.vis, "personnel", "accorder un rappel rend la pièce");
    assert.equal(
      apres.transmise_le,
      null,
      "une pièce revenue n'est transmise nulle part : la laisser datée la compterait dans une déclaration qu'elle n'a pas rejointe",
    );
    assert.deepEqual(
      (await faits(id)).map((f) => f.fait),
      ["demandee", "accordee"],
    );
  });

  it("le refus laisse la pièce au cabinet, et EXIGE son motif", async () => {
    const id = await piece("refus");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "rappel");

    await assert.rejects(
      () => rpc("collab", "repondreSurPiece", id, "rappel", false, null),
      /demandes_refus_motive/,
      "un refus sans motif n'apprend rien, et la question reviendra la semaine suivante",
    );

    await rpc("collab", "repondreSurPiece", id, "rappel", false, "Déjà porté à la déclaration.");
    assert.equal((await visDe(id)).vis, "partage", "un refus ne bouge pas la pièce");
    const h = await faits(id);
    assert.equal(h[h.length - 1]!.fait, "refusee");
    assert.match(h[h.length - 1]!.note!, /déclaration/);
  });

  it("LA BASE refuse le retrait unilatéral, pas seulement l'écran", async () => {
    /*
     * Le point faible, trouvé le 11 octobre en inventoriant les actions sans
     * retour : jusque-là, `capture_piece_set_vis` n'interdisait le retour
     * que pour les pièces comptabilisées. Une pièce transmise mais non
     * comptabilisée pouvait être retirée du champ du cabinet sans accord —
     * et la règle ne tenait que par le filtre d'affichage du coffre.
     *
     * Un onglet « tout voir », un filtre modifié, un appel direct : elle
     * tombait. Ce que seul l'écran tient n'est pas tenu.
     */
    const id = await piece("garde-base");
    await rpc("collab", "setPieceVis", id, "partage");
    await assert.rejects(
      () => rpc("collab", "setPieceVis", id, "personnel"),
      /que par accord du cabinet/,
      "le Socle doit refuser, même si aucun écran ne propose le geste",
    );
    assert.equal((await visDe(id)).vis, "partage");
  });

  it("répondre à une demande qui n'existe pas est refusé", async () => {
    const id = await piece("sans-demande");
    await rpc("collab", "setPieceVis", id, "partage");
    await assert.rejects(
      () => rpc("collab", "repondreSurPiece", id, "rappel", true, null),
      /aucune demande en attente/,
    );
  });

  it("et après un refus, on peut redemander : rien ne se ferme", async () => {
    /*
     * La règle générale du 11 octobre : « il faut TOUJOURS prévoir une action
     * de retour ». Un refus qui fermerait la porte pour de bon enfermerait le
     * dirigeant — la situation peut changer, et la demande doit pouvoir
     * revenir.
     */
    const id = await piece("redemande");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await rpc("collab", "repondreSurPiece", id, "rappel", false, "Pas maintenant.");

    const r = (await rpc("collab", "demanderSurPiece", id, "rappel")) as {
      dejaDemandee: boolean;
    };
    assert.equal(r.dejaDemandee, false, "après un refus, la demande peut revenir");
    assert.deepEqual(
      (await faits(id)).map((f) => f.fait),
      ["demandee", "refusee", "demandee"],
      "R7 : chaque fait s'ajoute, aucun n'est réécrit",
    );
  });
});
