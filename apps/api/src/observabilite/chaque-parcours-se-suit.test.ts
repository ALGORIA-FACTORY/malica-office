/**
 * Chaque parcours se suit (20261118150000) : le geste métier, l'appareil et
 * l'isolation des traces. Les travaux différés de lecture sont éprouvés par
 * le lot de la lecture (`la-lecture-d-une-piece-se-suit.test.ts`).
 *
 * Les vrais chemins : la vraie application Express et sa route `/rpc`, les
 * rôles de connexion réels sous `sousIdentite`. Seule la lecture du résultat
 * se fait en superutilisateur ou sous `malica_exploitation` — c'est la
 * consultation que le journal prévoit.
 *
 *   node --experimental-strip-types --test src/observabilite/chaque-parcours-se-suit.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { contratRpc } from "../rpc.ts";
import { referentielDuJournal } from "./gestes.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

interface Ligne {
  trace_id: string;
  parente_id: string | null;
  etape: string;
  issue: string;
  cle: string;
  detail: Record<string, unknown>;
  audit_ids: string[];
  repetitions: number;
  piece_id: string | null;
  acteur: string | null;
}

describe("chaque parcours se suit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `parcours-${Date.now()}`;
  let admin: pg.Pool;
  let a: Utilisateur;
  let b: Utilisateur;
  let collegue: Utilisateur;
  let orgA = "";
  let orgB = "";
  let base = "";
  let racineEssai = "";
  let arret: (() => Promise<void>) | null = null;

  const lire = async <T extends pg.QueryResultRow>(sql: string, valeurs: unknown[] = []) =>
    (await admin.query<T>(sql, valeurs)).rows;

  /** Le journal écrit par lots, après coup : on attend qu'il l'ait fait. */
  async function attendre<T>(lecture: () => Promise<T | null>, quoi: string): Promise<T> {
    const limite = Date.now() + 10_000;
    for (;;) {
      const valeur = await lecture();
      if (valeur) return valeur;
      if (Date.now() > limite) assert.fail(`le journal n'a pas écrit : ${quoi}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const evenements = (sql: string, valeurs: unknown[]) =>
    lire<Ligne>(
      `select e.trace_id, t.parente_id, e.etape, e.issue::text, e.cle, e.detail, e.audit_ids,
              e.repetitions, e.piece_id, e.acteur
         from observabilite.evenements e join observabilite.traces t on t.id = e.trace_id
        where ${sql} order by e.debut, e.id`,
      valeurs,
    );

  /** La chronologie d'une pièce, lue comme l'exploitant la lit. */
  async function diagnostic(piece: string): Promise<Ligne[]> {
    const c = await admin.connect();
    try {
      await c.query("begin; set local role malica_exploitation");
      const { rows } = await c.query<Ligne>(
        `select trace_id, parente_id, etape, issue::text, cle, detail, audit_ids, repetitions,
                piece_id, acteur
           from observabilite.diagnostic_piece($1)`,
        [piece],
      );
      return rows;
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  function appeler(
    qui: Utilisateur,
    depot: string,
    methode: string,
    args: unknown[],
    entetes: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(`${base}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${emettreJeton(qui, new Date())}`,
        "X-Malica-Client": "coque-android/9.9.9",
        ...entetes,
      },
      body: JSON.stringify({ depot, methode, args }),
    });
  }

  async function creerOrganisation(qui: Utilisateur, nom: string): Promise<string> {
    return sousIdentiteDuServeur(qui.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
        [nom],
      );
      return rows[0]!.id;
    });
  }

  before(async () => {
    admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const [ca, cb, cc] = await Promise.all(
      ["a", "b", "c"].map((x) =>
        creerCompte(`${x}-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      ),
    );
    assert.ok(ca && cb && cc);
    a = ca;
    b = cb;
    collegue = cc;
    orgA = await creerOrganisation(a, `ESSAI A ${marque}`);
    orgB = await creerOrganisation(b, `ESSAI B ${marque}`);
    // Un collègue du même dossier : il voit la société, pas l'espace privé de A.
    // La licence Team ouvre le siège, par la vraie porte.
    await sousIdentiteDuServeur(a.id, (db) =>
      db.query("select public.forfait_changer('team', $1, current_date)", [orgA]),
    );
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [orgA, collegue.id],
    );

    racineEssai = await mkdtemp(path.join(tmpdir(), "malica-parcours-"));
    process.env["STOCKAGE_RACINE"] = racineEssai;
    const { app } = await import("../app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  });

  after(async () => {
    await arret?.();
    if (admin) {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any ($1) and archived_at is null`,
        [[orgA, orgB].filter(Boolean)],
      );
      await admin.end();
    }
    await fermerLePool();
    if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
  });

  /** Une pièce de l'espace privé de A, enregistrée comme la file hors ligne l'enregistre. */
  async function enregistrer(
    trace: string,
    cle: string,
  ): Promise<{ id: string; reponse: Response }> {
    const reponse = await appeler(
      a,
      "capture",
      "enregistrer",
      [
        {
          tenantId: orgA,
          entityId: null,
          source: "photo",
          vis: "personnel",
          idempotencyKey: cle,
          contentType: "image/jpeg",
        },
      ],
      { "x-malica-trace": trace, "x-malica-cle": `${cle}.enregistrer` },
    );
    assert.equal(reponse.status, 200, await reponse.clone().text());
    const { resultat } = (await reponse.json()) as { resultat: { id: string } };
    return { id: resultat.id, reponse };
  }

  it("chaque geste du référentiel nomme une méthode servie, et l'API le lit", async () => {
    const { gestes, etapesDeLAppareil } = await referentielDuJournal();
    assert.ok(gestes.size > 50, "le référentiel des gestes est lu");
    const contrat = contratRpc();
    const orphelins = [...gestes.values()]
      .filter((g) => !contrat[g.depot]?.includes(g.methode))
      .map((g) => `${g.depot}.${g.methode}`);
    assert.deepEqual(orphelins, [], "un geste nomme une méthode qui n'existe pas");
    assert.deepEqual([...etapesDeLAppareil].sort(), [
      "affiche",
      "capture",
      "file_hors_ligne",
      "perte",
      "synchronisation",
    ]);
  });

  it("un renvoi de capture.enregistrer rend la même pièce, sans doublon ni d'audit ni d'étape", async () => {
    const trace = randomUUID();
    const cle = randomUUID();
    const premier = await enregistrer(trace, cle);
    // La reconnexion : la file rejoue le même pas, même trace, même clé.
    const second = await enregistrer(trace, cle);
    assert.equal(second.id, premier.id);
    assert.equal(second.reponse.headers.get("x-malica-trace"), trace);

    const rpc = await attendre(async () => {
      const r = await evenements("e.trace_id = $1 and e.etape = 'rpc'", [trace]);
      return r.length === 1 && r[0]!.repetitions === 1 ? r : null;
    }, "le renvoi compté comme une répétition");
    assert.equal(rpc[0]!.cle, `${cle}.enregistrer`);
    const audits = await lire<{ n: string }>(
      `select count(*)::text as n from audit.event_log where object_id = $1`,
      [premier.id],
    );
    assert.equal(audits[0]!.n, "1", "la pièce n'est auditée qu'une fois");
  });

  it("un geste sensible a son étape métier : acteur, pièce, issue, et l'audit qui le porte", async () => {
    const trace = randomUUID();
    const { id: piece } = await enregistrer(trace, randomUUID());
    const garde = await appeler(a, "collab", "garderPiece", [piece], { "x-malica-trace": trace });
    assert.equal(garde.status, 200, await garde.clone().text());

    const [transfert] = await attendre(async () => {
      const r = await evenements("e.trace_id = $1 and e.etape = 'transfert'", [trace]);
      return r.length === 1 ? r : null;
    }, "l'étape transfert");
    assert.equal(transfert!.issue, "ok");
    assert.equal(transfert!.piece_id, piece);
    assert.equal(transfert!.acteur, a.id);
    assert.deepEqual(
      {
        geste: transfert!.detail["geste"],
        objet_type: transfert!.detail["objet_type"],
        objet_id: transfert!.detail["objet_id"],
        methode: transfert!.detail["methode"],
      },
      { geste: "piece.garder", objet_type: "piece", objet_id: piece, methode: "garderPiece" },
    );
    assert.ok(transfert!.audit_ids.length > 0, "le geste réussi référence l'audit");
    const audits = await lire<{ object_id: string; action: string }>(
      "select object_id, action from audit.event_log where id = any ($1)",
      [transfert!.audit_ids],
    );
    assert.ok(
      audits.some((x) => x.object_id === piece && x.action === transfert!.detail["action"]),
    );
    // Le diagnostic de la pièce rassemble l'enregistrement et le geste.
    const chronologie = await diagnostic(piece);
    assert.ok(chronologie.some((e) => e.etape === "transfert"));
    assert.ok(chronologie.some((e) => e.etape === "rpc" && e.detail["methode"] === "enregistrer"));
  });

  it("un geste refusé (rollback) garde sa trace, sa clé de refus et sa pièce", async () => {
    const trace = randomUUID();
    const { id: piece } = await enregistrer(trace, randomUUID());
    // Rien n'a été retourné : le renvoi est refusé par la base, la transaction annulée.
    const refuse = await appeler(a, "capture", "renvoyer", [piece], { "x-malica-trace": trace });
    assert.equal(refuse.status, 400, await refuse.clone().text());

    const [retour] = await attendre(async () => {
      const r = await evenements("e.trace_id = $1 and e.etape = 'retour'", [trace]);
      return r.length === 1 ? r : null;
    }, "l'étape retour refusée");
    assert.equal(retour!.issue, "refus");
    assert.match(String(retour!.detail["code_refus"]), /^refus\.[a-z_.]+$/);
    assert.equal(retour!.detail["geste"], "piece.renvoyer");
    assert.equal(retour!.piece_id, piece, "la pièce visée, vue par l'appelant avant l'appel");
    assert.deepEqual(retour!.audit_ids, [], "une transaction annulée n'a rien audité");
    assert.ok((await diagnostic(piece)).some((e) => e.etape === "retour" && e.issue === "refus"));
  });

  it("un geste sur une ÉCRITURE se rattache à sa pièce, sous la RLS de l'appelant", async () => {
    const trace = randomUUID();
    const { id: piece } = await enregistrer(trace, randomUUID());
    // L'écriture de la pièce, posée telle qu'une proposition l'inscrit.
    const [ecriture] = await lire<{ id: string }>(
      `insert into socle.ecritures (tenant_id, vis, journal, date_ecriture, devise, libelle,
                                    pack_version_id, piece_id, created_by)
       values ($1, 'partage', 'ACH', current_date, 'TND', 'Essai', (select id from ref.jurisdiction_packs
               where jurisdiction = 'TN' order by effective_from desc limit 1), $2, $3)
       returning id`,
      [orgA, piece, a.id],
    );
    const traceB = randomUUID();
    await appeler(a, "office", "book", [ecriture!.id], { "x-malica-trace": trace });
    // Un autre dossier ne voit pas l'écriture : son geste ne nomme aucune pièce.
    await appeler(b, "office", "book", [ecriture!.id], { "x-malica-trace": traceB });

    const [deA] = await attendre(async () => {
      const r = await evenements("e.trace_id = $1 and e.etape = 'comptabilisation'", [trace]);
      return r.length === 1 ? r : null;
    }, "la comptabilisation de A");
    assert.equal(deA!.piece_id, piece, "l'écriture mène à sa pièce");
    assert.equal(deA!.detail["objet_type"], "ecriture");
    assert.equal(deA!.detail["objet_id"], ecriture!.id);
    assert.ok((await diagnostic(piece)).some((e) => e.etape === "comptabilisation"));

    const [deB] = await attendre(async () => {
      const r = await evenements("e.acteur = $1 and e.etape = 'comptabilisation'", [b.id]);
      return r.length === 1 ? r : null;
    }, "la comptabilisation refusée de B");
    assert.equal(deB!.piece_id, null);
  });

  it("l'appareil signale ses étapes par lots ; un renvoi ne fait pas de doublon", async () => {
    const trace = randomUUID();
    const { id: piece } = await enregistrer(trace, randomUUID());
    const debut = new Date(Date.now() - 60_000).toISOString();
    const lot = [
      {
        trace,
        etape: "capture",
        issue: "ok",
        cle: "capture",
        debut,
        detail: { plateforme: "android", source: "photo" },
      },
      {
        trace,
        etape: "file_hors_ligne",
        issue: "ok",
        cle: "file_hors_ligne",
        debut,
        detail: { plateforme: "android" },
      },
      {
        trace,
        etape: "synchronisation",
        issue: "ok",
        cle: "synchronisation",
        debut,
        dureeMs: 4200,
        piece,
        detail: { tentatives: 2 },
      },
      {
        trace,
        etape: "affiche",
        issue: "ok",
        cle: "affiche:pme:510.000|427.731",
        debut,
        piece,
        detail: {
          plateforme: "android",
          ecran: "pme",
          ttc: "510.000",
          base_ht: "427.731",
          photo: "AAAA",
        },
      },
      // Ce que l'appareil n'a pas le droit de dire, et ce qui n'est pas bien formé.
      { trace, etape: "validation", issue: "ok", cle: "v", debut, piece },
      { trace, etape: "capture", issue: "ok", cle: "x", debut: "hier" },
    ];
    const envoyer = () =>
      appeler(a, "journal", "etapes", [lot]).then(async (r) => {
        assert.equal(r.status, 200, await r.clone().text());
        return ((await r.json()) as { resultat: { acceptees: number; ecartees: number } }).resultat;
      });
    assert.deepEqual(await envoyer(), { acceptees: 4, ecartees: 2 });
    // La reconnexion : le même lot repart.
    await envoyer();

    const lignes = await attendre(async () => {
      const r = await evenements("e.trace_id = $1 and e.etape = any ($2)", [
        trace,
        ["capture", "file_hors_ligne", "synchronisation", "affiche", "validation"],
      ]);
      return r.length === 4 && r.every((e) => e.repetitions === 1) ? r : null;
    }, "les étapes de l'appareil, renvoyées une fois");
    const affiche = lignes.find((e) => e.etape === "affiche")!;
    assert.deepEqual(affiche.detail, {
      plateforme: "android",
      ecran: "pme",
      ttc: "510.000",
      base_ht: "427.731",
    });
    assert.equal(affiche.piece_id, piece);
    assert.ok(lignes.every((e) => e.acteur === a.id));
    const [t] = await lire<{ origine: string; piece_id: string }>(
      "select origine::text, piece_id from observabilite.traces where id = $1",
      [trace],
    );
    assert.deepEqual(t, { origine: "android", piece_id: piece });
    const chronologie = (await diagnostic(piece)).map((e) => e.etape);
    for (const etape of ["capture", "file_hors_ligne", "synchronisation", "affiche"]) {
      assert.ok(chronologie.includes(etape), `le diagnostic rend ${etape}`);
    }
  });

  it("une trace ne s'écrit pas depuis une autre organisation, ni l'espace privé hors de son auteur", async () => {
    const trace = randomUUID();
    const { id: piece } = await enregistrer(trace, randomUUID());
    const debut = new Date().toISOString();
    const intrus = (qui: Utilisateur, cle: string) =>
      appeler(qui, "journal", "etapes", [
        [{ trace, etape: "affiche", issue: "ok", cle, debut, piece, detail: { ttc: "1.000" } }],
      ]);

    // Un autre dossier, et un collègue qui ne voit pas l'espace privé de A.
    assert.equal((await intrus(b, "affiche:intrus")).status, 200);
    assert.equal((await intrus(collegue, "affiche:collegue")).status, 200);
    // Un autre dossier qui reprend l'identifiant de trace dans une requête.
    const r = await appeler(b, "capture", "renvoyer", [piece], { "x-malica-trace": trace });
    assert.ok(r.status >= 400);

    const isolees = await attendre(async () => {
      const lignes = await evenements("e.acteur = any ($1) and e.etape in ('affiche', 'retour')", [
        [b.id, collegue.id],
      ]);
      return lignes.length === 3 ? lignes : null;
    }, "les étapes des intrus, chacune sous sa trace");
    assert.ok(
      isolees.every((e) => e.trace_id !== trace),
      "rien n'entre dans la trace de A",
    );
    assert.ok(
      isolees.every((e) => e.parente_id === null),
      "ni ne s'y rattache",
    );
    assert.ok(
      isolees.every((e) => e.piece_id === null),
      "la pièce privée n'est nommée pour personne d'autre",
    );
    const deA = await evenements("e.trace_id = $1", [trace]);
    assert.ok(deA.every((e) => e.acteur === a.id || e.acteur === null));
    assert.ok(
      (await diagnostic(piece)).every((e) => e.acteur !== b.id && e.acteur !== collegue.id),
    );
  });
});
