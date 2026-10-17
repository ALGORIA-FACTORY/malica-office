/**
 * Une pièce sur laquelle on a saisi un paiement se supprime.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 18 octobre 2026, relevé à l'audit par une exécution contre la base : une
 * pièce `personnel` / `capturee`, qui passe les quatre contrôles de
 * `capture_piece_supprimer`, portait UN paiement. La suppression levait :
 *
 *     R7 : DELETE interdit sur capture.paiements
 *          — une correction est une ecriture nouvelle
 *
 * Avec la migration `20261018120000`, la même pièce est supprimée.
 *
 * La cause : `delete from capture.pieces` cascade vers `capture.paiements`,
 * `capture.paiement_justificatifs` et `collab.demandes_sur_piece`, et ces trois
 * tables portaient le garde STRICT `app.deny_mutation()`, qui ne connaît pas le
 * drapeau `malica.piece_effacable`. Le garde permissif avait été écrit pour les
 * cinq tables d'alors ; les trois autres, nées par le helper, ont reçu le
 * strict. Personne n'a relu la liste.
 *
 * Le chemin le plus fréquent de l'application — lire la pièce, puis saisir le
 * règlement — condamnait donc la pièce, et la promesse « avant transmission,
 * vous supprimez librement » était fausse pour la majorité d'entre elles.
 *
 * ============================================== CE QUE L'ÉPREUVE GARDE AUSSI
 *
 * La garantie inverse est l'essentiel. Le drapeau ouvre la suppression d'UNE
 * pièce ; il n'ouvre pas la table. Un DELETE direct sur `capture.paiements`
 * reste refusé par R7, drapeau posé pour une autre pièce compris.
 *
 *   node --experimental-strip-types --test src/scan/une-piece-avec-un-paiement-se-supprime.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("une pièce portant un paiement se supprime", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `suppr-paiement-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let pack = "";

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

  /** Une pièce personnelle, fraîchement capturée : l'état que le bogue condamnait. */
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

  /** Un règlement par chèque : le moyen qui, en plus, appelle un justificatif. */
  async function payer(pieceId: string, justificatifPieceId?: string) {
    await rpc("capture", "enregistrerPaiement", {
      pieceId,
      packId: pack,
      moyenCode: "cheque",
      montantMineur: 613_493,
      devise: "TND",
      payeLe: "2026-10-09",
      ...(justificatifPieceId ? { justificatifPieceId } : {}),
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", pieceId)) as Array<{ id: string }>;
    return liste[liste.length - 1]!.id;
  }

  const compter = (table: string, colonne: string, valeur: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ n: string }>(
        `select count(*) as n from ${table} where ${colonne} = $1`,
        [valeur],
      );
      return Number(rows[0]!.n);
    });

  const pieceExiste = (id: string) => compter("capture.pieces", "id", id);

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
    pack = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
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

  it("le défaut du 18 octobre : une pièce portant un paiement se supprime", async () => {
    /*
     * Avant la migration : « R7 : DELETE interdit sur capture.paiements ».
     * Saisir le règlement est ce que le produit demande de faire juste après
     * la lecture ; le chemin normal ne doit donc pas condamner la pièce.
     */
    const id = await piece("avec-paiement");
    await payer(id);
    assert.equal(
      await compter("capture.paiements", "piece_id", id),
      1,
      "le décor porte son paiement",
    );

    assert.equal(await rpc("capture", "supprimer", id), true);

    assert.equal(await pieceExiste(id), 0, "la pièce est supprimée");
    assert.equal(
      await compter("capture.paiements", "piece_id", id),
      0,
      "et son paiement part avec elle : une ligne sans pièce n'a pas d'objet",
    );
  });

  it("la trace survit à la pièce", async () => {
    /*
     * Supprimer n'efface pas le fait qu'il y a eu suppression : le journal
     * porte `object_id` sans clé étrangère, justement pour ne pas partir dans
     * la cascade.
     */
    const id = await piece("trace");
    await payer(id);
    await rpc("capture", "supprimer", id);

    const traces = await admin(async (p) => {
      const { rows } = await p.query<{ n: string }>(
        "select count(*) as n from audit.event_log where object_id = $1 and action = 'piece.supprimee'",
        [id],
      );
      return Number(rows[0]!.n);
    });
    assert.equal(traces, 1);
  });

  it("une pièce portant un justificatif rattaché se supprime", async () => {
    /*
     * `capture.paiement_justificatifs` est la deuxième table de la cascade :
     * la preuve tardive s'ajoute dans sa propre table, et elle porte le garde
     * qu'on avait oublié de relâcher.
     *
     * Le défaut du 19 octobre : supprimer la FACTURE emporte la ligne de
     * justificatif par `paiement_id`, dont le `piece_id` est le talon, pas la
     * facture. Le premier passage du garde ne l'ouvrait pas, et le second
     * lisait `old.justificatif_piece_id` sur une table qui n'a pas cette
     * colonne : 42703, au lieu d'un refus ou d'un succès.
     */
    const facture = await piece("facture-prouvee");
    const talon = await piece("talon-tardif");
    const paiement = await payer(facture);
    await rpc("capture", "rattacherJustificatif", paiement, talon);
    assert.equal(await compter("capture.paiement_justificatifs", "paiement_id", paiement), 1);

    assert.equal(await rpc("capture", "supprimer", facture), true);

    assert.equal(await pieceExiste(facture), 0);
    assert.equal(await compter("capture.paiement_justificatifs", "paiement_id", paiement), 0);
    assert.equal(await pieceExiste(talon), 1, "le talon est une autre pièce : il reste");
  });

  it("une pièce qui sert de justificatif se supprime, et le paiement la lâche", async () => {
    /*
     * C'est le quatrième passage de la migration. `paiements.justificatif_piece_id`
     * est en SET NULL : supprimer le reçu déclenche un UPDATE sur le paiement
     * d'une AUTRE pièce, dont le `piece_id` ne vaut pas le drapeau. Le garde
     * permissif ne tolérait que le DELETE, et refusait.
     */
    const facture = await piece("facture-colonne");
    const talon = await piece("talon-colonne");
    const paiement = await payer(facture, talon);

    assert.equal(await rpc("capture", "supprimer", talon), true);

    assert.equal(await pieceExiste(talon), 0);
    assert.equal(await pieceExiste(facture), 1, "la facture, elle, reste");
    const restant = await admin(async (p) => {
      const { rows } = await p.query<{ justificatif_piece_id: string | null }>(
        "select justificatif_piece_id from capture.paiements where id = $1",
        [paiement],
      );
      return rows;
    });
    assert.equal(restant.length, 1, "le paiement n'est pas supprimé : il perd seulement sa preuve");
    assert.equal(restant[0]!.justificatif_piece_id, null);
  });

  it("une pièce qui sert de justificatif rattaché après coup se supprime aussi", async () => {
    // Même passage, par l'autre chemin : la ligne de `paiement_justificatifs`
    // porte `piece_id` = le talon, donc le drapeau du talon l'ouvre.
    const facture = await piece("facture-table");
    const talon = await piece("talon-table");
    const paiement = await payer(facture);
    await rpc("capture", "rattacherJustificatif", paiement, talon);

    assert.equal(await rpc("capture", "supprimer", talon), true);

    assert.equal(await pieceExiste(talon), 0);
    assert.equal(await compter("capture.paiement_justificatifs", "paiement_id", paiement), 0);
    assert.equal(await compter("capture.paiements", "id", paiement), 1);
  });

  it("une pièce portant une demande du cabinet se supprime", async () => {
    /*
     * `collab.demandes_sur_piece` est la troisième table. Une demande porte en
     * principe sur une pièce déjà transmise ; on l'inscrit ici directement,
     * parce que la question est celle de la cascade, pas du chemin qui la crée.
     */
    const id = await piece("avec-demande");
    await admin((p) =>
      p.query(
        `insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur)
         values ($1, $2, 'rappel', 'demandee', $3)`,
        [org, id, u.id],
      ),
    );
    assert.equal(await compter("collab.demandes_sur_piece", "piece_id", id), 1);

    assert.equal(await rpc("capture", "supprimer", id), true);

    assert.equal(await pieceExiste(id), 0);
    assert.equal(await compter("collab.demandes_sur_piece", "piece_id", id), 0);
  });

  it("hors de ce chemin, un DELETE direct sur capture.paiements reste refusé", async () => {
    /*
     * La garantie qui compte : le drapeau ouvre la suppression d'une pièce, il
     * n'ouvre pas la table. Sans drapeau, R7 tient comme avant.
     */
    const id = await piece("delete-direct");
    const paiement = await payer(id);

    await admin(async (p) => {
      await assert.rejects(
        p.query("delete from capture.paiements where id = $1", [paiement]),
        /R7 : DELETE interdit sur capture\.paiements/,
      );
    });
    assert.equal(await compter("capture.paiements", "id", paiement), 1, "le paiement est intact");
  });

  it("le drapeau posé pour UNE pièce n'ouvre pas les paiements des autres", async () => {
    /*
     * Le garde compare le drapeau au `piece_id` de la ligne. Un drapeau resté
     * posé, ou posé pour une autre pièce, ne doit rien lever : sinon la
     * porte de `capture_piece_supprimer` deviendrait une clé universelle.
     */
    const cible = await piece("drapeau-cible");
    const autre = await piece("drapeau-autre");
    const paiement = await payer(cible);

    await admin(async (p) => {
      const db = await p.connect();
      try {
        await db.query("begin");
        await db.query("select set_config('malica.piece_effacable', $1, true)", [autre]);
        await assert.rejects(
          db.query("delete from capture.paiements where id = $1", [paiement]),
          /R7 : DELETE interdit sur capture\.paiements/,
        );
      } finally {
        await db.query("rollback");
        db.release();
      }
    });
    assert.equal(await compter("capture.paiements", "id", paiement), 1);
  });

  it("le détachement du justificatif ne sert à rien d'autre : un UPDATE quelconque est refusé", async () => {
    /*
     * Le second passage du garde est étroit à dessein : une seule colonne, vers
     * NULL, depuis la pièce en cours d'effacement. Ici le drapeau est bien posé
     * pour le talon, mais on tente de changer le MOYEN de paiement — et cela
     * doit lever, parce que rien ne s'écrit sur un fait déclaré.
     */
    const facture = await piece("update-facture");
    const talon = await piece("update-talon");
    const paiement = await payer(facture, talon);

    await admin(async (p) => {
      const db = await p.connect();
      try {
        await db.query("begin");
        await db.query("select set_config('malica.piece_effacable', $1, true)", [talon]);
        await assert.rejects(
          db.query(
            "update capture.paiements set moyen_code = 'especes', justificatif_piece_id = null where id = $1",
            [paiement],
          ),
          /R7 : UPDATE interdit sur capture\.paiements/,
        );
      } finally {
        await db.query("rollback");
        db.release();
      }
    });
  });

  it("un DELETE direct sur capture.paiement_justificatifs reste refusé, drapeau d'une autre pièce compris", async () => {
    /*
     * La porte ouverte pour les preuves des paiements qui partent avec leur
     * facture ne doit pas devenir une porte sur la table : hors de la
     * suppression d'une pièce, la preuve ne se réécrit pas.
     */
    const facture = await piece("preuve-directe-facture");
    const talon = await piece("preuve-directe-talon");
    const autre = await piece("preuve-directe-autre");
    const paiement = await payer(facture);
    await rpc("capture", "rattacherJustificatif", paiement, talon);

    await admin(async (p) => {
      const db = await p.connect();
      try {
        await db.query("begin");
        await assert.rejects(
          db.query("delete from capture.paiement_justificatifs where paiement_id = $1", [paiement]),
          /R7 : DELETE interdit sur capture\.paiement_justificatifs/,
        );
        await db.query("rollback");

        await db.query("begin");
        await db.query("select set_config('malica.piece_effacable', $1, true)", [autre]);
        await assert.rejects(
          db.query("delete from capture.paiement_justificatifs where paiement_id = $1", [paiement]),
          /R7 : DELETE interdit sur capture\.paiement_justificatifs/,
        );
        await db.query("rollback");

        // Un paiement non supprimé ne légitime rien, même avec le drapeau de sa facture.
        await db.query("begin");
        await db.query("select set_config('malica.piece_effacable', $1, true)", [facture]);
        await assert.rejects(
          db.query("delete from capture.paiement_justificatifs where paiement_id = $1", [paiement]),
          /R7 : DELETE interdit sur capture\.paiement_justificatifs/,
        );
      } finally {
        await db.query("rollback");
        db.release();
      }
    });
    assert.equal(await compter("capture.paiement_justificatifs", "paiement_id", paiement), 1);
  });

  it("un utilisateur qui pose lui-même les deux drapeaux n'efface rien", async () => {
    /*
     * Les épreuves ci-dessus tournent sous `postgres` : elles prouvent ce que
     * le DÉCLENCHEUR refuse. Celle-ci dit ce qu'un UTILISATEUR ne peut pas
     * faire. Les réglages `malica.piece_effacable` et
     * `malica.paiements_effacables` se posent sans aucun privilège ; ils ne sont
     * une clé pour personne parce que `authenticated` n'a ni `delete` ni
     * `update` sur ces tables, et que la RLS n'y porte aucune politique. Le jour
     * où l'une de ces deux barrières disparaît, c'est ici — et dans
     * `schema.test.ts` — que cela doit rougir.
     */
    const facture = await piece("cle-facture");
    const talon = await piece("cle-talon");
    const paiement = await payer(facture);
    await rpc("capture", "rattacherJustificatif", paiement, talon);

    const tenter = (sql: string, params: unknown[]) =>
      sousIdentite(u.id, async (db) => {
        await db.query("select set_config('malica.piece_effacable', $1, true)", [facture]);
        await db.query("select set_config('malica.paiements_effacables', $1, true)", [
          `,${paiement}`,
        ]);
        return db.query(sql, params);
      });
    const refuse = (e: { code?: string }) => {
      assert.equal(e.code, "42501", "le droit lui-même est refusé, avant même la RLS");
      return true;
    };

    await assert.rejects(tenter("delete from capture.paiements where id = $1", [paiement]), refuse);
    await assert.rejects(
      tenter("delete from capture.paiement_justificatifs where paiement_id = $1", [paiement]),
      refuse,
    );
    await assert.rejects(tenter("delete from capture.pieces where id = $1", [facture]), refuse);

    assert.equal(await compter("capture.paiements", "id", paiement), 1, "le paiement est intact");
    assert.equal(
      await compter("capture.paiement_justificatifs", "paiement_id", paiement),
      1,
      "la preuve aussi",
    );
    assert.equal(await pieceExiste(facture), 1, "et la pièce");
  });
});
