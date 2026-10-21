/**
 * L'espace privé l'est aussi du patron.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * L'écran de l'espace privé promet, mot pour mot : « Invisible pour votre
 * cabinet, vos sièges et la vue consolidée ». Les deux derniers tiers de cette
 * phrase étaient faux. `capture_pieces_sel` ouvrait la pièce à tout membre de
 * l'organisation, sans regarder `vis` : `vis` ne cachait qu'au cabinet.
 *
 * Mesuré le 18 octobre 2026, sur une ordonnance photographiée par un
 * collaborateur et gardée pour lui :
 *
 *     dépôt actuel         → le dirigeant voit 1 pièce, 1 lecture
 *     avec la migration    → le dirigeant voit 0 pièce, 0 lecture
 *     avec la migration    → son auteur la voit toujours
 *
 * Ce n'est pas une fuite entre clients — R6 tenait. C'est une promesse d'écran
 * que la base ne tenait pas, sur la seule fonctionnalité dont l'argument est la
 * confidentialité : un collaborateur qui découvre que son patron voit son
 * espace « privé » ne redéposera jamais rien.
 *
 * ================================== LE POINT QUI A FAILLI ÊTRE RETIRÉ
 *
 * Rendre la pièce invisible ne suffit pas. Ses dépendances — extraction,
 * paiements, citations — portent un `tenant_id` et restaient lisibles de tout
 * membre : la pièce disparaissait et sa LECTURE restait, avec le montant et le
 * fournisseur. La fuite passait par la porte de service. Elles suivent donc la
 * pièce (`app.piece_lisible`), et c'est ce que la dernière moitié du fichier
 * éprouve — un lecteur qui ne verrait que `capture.pieces` laisserait ce
 * contrôle disparaître sans qu'un seul test rougisse.
 *
 * ================================================== CE QUI NE CHANGE PAS
 *
 * `entite` reste visible aux membres, `partage` l'est au cabinet sous mandat
 * actif. Ces deux-là prouvent que le privé ne casse rien d'autre.
 *
 *   node --experimental-strip-types --test src/scan/l-espace-prive-l-est-aussi-du-patron.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("l'espace privé l'est aussi du dirigeant", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `prive-${Date.now()}`;
  let dirigeant: Utilisateur;
  let collaborateur: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let pack = "";

  /** La pièce que le collaborateur a photographiée et gardée pour lui. */
  let ordonnance = "";
  let entite = "";
  let partagee = "";

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Ce que `qui` lit, sous la RLS de la base : l'API ne filtre rien. */
  const nombre = (qui: Utilisateur, table: string, colonne: string, valeur: string) =>
    sousIdentiteDuServeur(qui.id, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from ${table} where ${colonne} = $1`,
        [valeur],
      );
      return Number(rows[0]!.n);
    });

  const pieceVue = (qui: Utilisateur, id: string) => nombre(qui, "capture.pieces", "id", id);

  async function deposer(cle: string, vis: "personnel" | "entite" | "partage") {
    const p = (await sousIdentiteDuServeur(collaborateur.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "enregistrer",
          args: [
            {
              tenantId: pme,
              source: "photo",
              vis,
              idempotencyKey: `${marque}-${cle}`,
              contentType: "image/jpeg",
              pageCount: 1,
            },
          ],
        },
        "serveur",
      ),
    )) as { id: string };
    return p.id;
  }

  before(async () => {
    const d = await creerCompte(`${marque}-dir@essai.local`, "MotDePasseTresLong2026!");
    const s = await creerCompte(`${marque}-siege@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`${marque}-cab@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && s && e);
    dirigeant = d;
    collaborateur = s;
    expert = e;

    pme = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    cabinet = await sousIdentiteDuServeur(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', 'AUDICORP', 'autonome',
                                           '${matriculeDEssai("B", "C")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });

    // Une licence Team : elle ouvre les sièges, et elle fixe le décor commercial
    // de l'audit (un dirigeant et un collaborateur sur la même organisation).
    // La société est née en Basic ; le dirigeant passe en Team par la vraie porte.
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query("select public.forfait_changer('team', $1, current_date)", [pme]),
    );

    await admin(async (p) => {
      await p.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
        [pme, collaborateur.id],
      );
      await p.query(
        `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
         values ($1, $2, 'actif', current_date - 1)`,
        [cabinet, pme],
      );
      const { rows: packs } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      pack = packs[0]!.id;
    });

    // Le siège photographie une ordonnance, et la garde pour lui.
    ordonnance = await deposer("ordonnance", "personnel");
    entite = await deposer("entite", "entite");
    partagee = await deposer("partagee", "partage");

    // Ses dépendances : ce que la lecture en a tiré, le règlement qu'il a saisi,
    // et la citation qui pointe un mot de la page.
    await admin(async (p) => {
      await p.query(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'v1', '{"montant":"42,000"}'::jsonb)`,
        [pme, ordonnance],
      );
      const { rows: jeton } = await p.query<{ id: string }>(
        `insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text, x0, y0, x1, y1)
         values ($1, $2, 1, 0, '42,000', 0.1, 0.1, 0.2, 0.2) returning id`,
        [pme, ordonnance],
      );
      await p.query(
        `insert into capture.citations (tenant_id, piece_id, field, token_id, page, bbox)
         values ($1, $2, 'montant', $3, 1, '{"x0":0.1,"y0":0.1,"x1":0.2,"y1":0.2}'::jsonb)`,
        [pme, ordonnance, jeton[0]!.id],
      );
      await p.query(
        `insert into capture.paiements (tenant_id, vis, piece_id, moyen_code, pack_version_id, devise)
         values ($1, 'personnel', $2, 'especes', $3, 'TND')`,
        [pme, ordonnance, pack],
      );
    });
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [[pme, cabinet]],
      ),
    );
    await fermerLePool();
  });

  it("le dirigeant ne voit PAS la pièce personnelle de son collaborateur", async () => {
    /*
     * Le défaut : « dépôt actuel → 1 ligne vue ». Le dirigeant n'est pas une
     * exception, parce qu'une hiérarchie qui s'arrête à la porte du chef n'est
     * pas une règle de confidentialité, c'est un privilège.
     */
    assert.equal(await pieceVue(dirigeant, ordonnance), 0);
  });

  it("son auteur la voit toujours", async () => {
    // Sans cette moitié, on aurait fermé plus que le trou : la pièce serait
    // perdue pour celui qui l'a déposée.
    assert.equal(await pieceVue(collaborateur, ordonnance), 1);
  });

  it("le cabinet engagé ne la voit pas non plus — c'était déjà vrai", async () => {
    assert.equal(await pieceVue(expert, ordonnance), 0);
  });

  it("l'extraction suit la pièce : l'auteur la lit, le dirigeant non", async () => {
    /*
     * Le défaut : « lectures_vues » valait 1 pour le dirigeant. Sans cela la
     * pièce serait invisible et son contenu — le montant, l'ordonnance —
     * resterait consultable.
     */
    assert.equal(await nombre(collaborateur, "capture.extractions", "piece_id", ordonnance), 1);
    assert.equal(await nombre(dirigeant, "capture.extractions", "piece_id", ordonnance), 0);
  });

  it("les paiements suivent la pièce : l'auteur les lit, le dirigeant non", async () => {
    assert.equal(await nombre(collaborateur, "capture.paiements", "piece_id", ordonnance), 1);
    assert.equal(await nombre(dirigeant, "capture.paiements", "piece_id", ordonnance), 0);
  });

  it("les citations suivent la pièce : l'auteur les lit, le dirigeant non", async () => {
    // Une citation dit OÙ, sur la page, se trouve le montant : elle est une
    // lecture au même titre que l'extraction.
    assert.equal(await nombre(collaborateur, "capture.citations", "piece_id", ordonnance), 1);
    assert.equal(await nombre(dirigeant, "capture.citations", "piece_id", ordonnance), 0);
  });

  it("le plan de jetons suit la pièce : c'est le texte entier de la page", async () => {
    assert.equal(await nombre(collaborateur, "capture.token_plan", "piece_id", ordonnance), 1);
    assert.equal(await nombre(dirigeant, "capture.token_plan", "piece_id", ordonnance), 0);
  });

  it("le quota ne se lit pas par une pièce personnelle : le dirigeant n'apprend rien", async () => {
    /*
     * `lecture_autorisee` est `security definer` : elle court-circuite la RLS,
     * donc elle refait ICI le contrôle de lisibilité. Sans cela elle serait
     * une sonde, qui répondrait « personnelle » — c'est-à-dire « elle existe »
     * — à quelqu'un qui n'a pas le droit de savoir.
     */
    await assert.rejects(
      sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query("select public.lecture_autorisee($1)", [ordonnance]),
      ),
      /piece introuvable ou non autorisee/,
    );
  });

  it("une pièce `entite` reste visible aux membres, pas au cabinet", async () => {
    assert.equal(await pieceVue(dirigeant, entite), 1, "la société la voit");
    assert.equal(await pieceVue(collaborateur, entite), 1);
    assert.equal(await pieceVue(expert, entite), 0, "le cabinet n'a rien reçu");
  });

  it("une pièce `partage` reste visible aux membres ET au cabinet engagé", async () => {
    assert.equal(await pieceVue(dirigeant, partagee), 1);
    assert.equal(await pieceVue(collaborateur, partagee), 1);
    assert.equal(await pieceVue(expert, partagee), 1, "c'est la seule que le mandat ouvre");
  });
});
