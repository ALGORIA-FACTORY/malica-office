/**
 * Le journal d'observabilité tient ses promesses en base : il ne s'ouvre à
 * aucun client, il ne parle pas pour un autre dossier, il survit à la
 * transaction qu'il raconte, il ne compte un renvoi qu'une fois, et une pièce
 * se diagnostique en une requête.
 *
 * Tout passe par les vrais chemins : les rôles de connexion réels
 * (`malica_api`, `authenticated` sous `sousIdentite`, `anon`), la vraie
 * application Express et sa route `/rpc`. Seule la lecture du résultat se
 * fait en superutilisateur — c'est la consultation que le journal prévoit.
 *
 *   node --experimental-strip-types --test src/observabilite/le-journal-survit-a-l-echec.test.ts
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
import { consignerEnBase, fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../db.ts";
import { consigner, mesurer, tracerUnTravail, type Evenement } from "./journal.ts";
import { nouvelleTrace, noterLObjet, sousLaTrace } from "./trace.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

/** Un événement minimal, tel que l'API l'envoie. */
function evenement(
  trace: {
    id: string;
    acteur?: string | null;
    tenant?: string | null;
    piece?: string | null;
    parente?: string | null;
  },
  etape: string,
  cle: string,
  champs: Partial<Evenement> = {},
): Evenement {
  const maintenant = new Date().toISOString();
  return {
    trace: {
      id: trace.id,
      parente: trace.parente ?? null,
      origine: "web",
      tenant: trace.tenant ?? null,
      acteur: trace.acteur ?? null,
      piece: trace.piece ?? null,
      version: "web/essai",
      debut: maintenant,
    },
    etape,
    issue: "ok",
    cle,
    debut: maintenant,
    dureeMs: 3,
    acteur: trace.acteur ?? null,
    piece: null,
    audits: [],
    detail: {},
    ...champs,
  };
}

describe("le journal survit à l'échec métier", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `obs-${Date.now()}`;
  let admin: pg.Pool;
  let a: Utilisateur;
  let b: Utilisateur;
  let orgA = "";
  let orgB = "";
  let base = "";
  let racineEssai = "";
  let arret: (() => Promise<void>) | null = null;

  const lire = async <T extends pg.QueryResultRow>(sql: string, valeurs: unknown[] = []) =>
    (await admin.query<T>(sql, valeurs)).rows;

  /** Le journal écrit par lots, après coup : on attend qu'il l'ait fait. */
  async function attendre<T>(
    lecture: () => Promise<T | null | undefined>,
    quoi: string,
  ): Promise<T> {
    const limite = Date.now() + 10_000;
    for (;;) {
      const valeur = await lecture();
      if (valeur) return valeur;
      if (Date.now() > limite) assert.fail(`le journal n'a pas écrit : ${quoi}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const evenementsDe = (trace: string) =>
    lire<{
      etape: string;
      issue: string;
      cle: string;
      detail: Record<string, unknown>;
      audit_ids: string[];
      repetitions: number;
      piece_id: string | null;
    }>(
      `select etape, issue::text, cle, detail, audit_ids, repetitions, piece_id
         from observabilite.evenements where trace_id = $1 order by debut, id`,
      [trace],
    );

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
    const compteA = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const compteB = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compteA && compteB);
    a = compteA;
    b = compteB;
    orgA = await creerOrganisation(a, `ESSAI A ${marque}`);
    orgB = await creerOrganisation(b, `ESSAI B ${marque}`);

    racineEssai = await mkdtemp(path.join(tmpdir(), "malica-obs-"));
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

  it("ni anon, ni authenticated, ni malica_api ne lisent ni n'écrivent le journal", async () => {
    const lectures = [
      "select 1 from observabilite.traces limit 1",
      "select 1 from observabilite.evenements limit 1",
      "select 1 from observabilite.chronologie_v limit 1",
      `select 1 from observabilite.diagnostic_piece('${randomUUID()}')`,
    ];
    const api = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
    try {
      for (const sql of lectures) {
        await assert.rejects(api.query(sql), { code: "42501" }, `malica_api : ${sql}`);
        await assert.rejects(
          sousIdentite(a.id, (db) => db.query(sql)),
          { code: "42501" },
          `authenticated : ${sql}`,
        );
        const c = await admin.connect();
        try {
          await c.query("begin; set local role anon");
          await assert.rejects(c.query(sql), { code: "42501" }, `anon : ${sql}`);
        } finally {
          await c.query("rollback");
          c.release();
        }
      }
      // L'écriture : la porte seule, et pas sous l'identité d'un client.
      await assert.rejects(
        api.query(
          "insert into observabilite.traces (id, origine, debut) values (gen_random_uuid(), 'api', now())",
        ),
        { code: "42501" },
      );
      await assert.rejects(
        sousIdentite(a.id, (db) => db.query("select observabilite.consigner('[]'::jsonb)")),
        { code: "42501" },
      );
    } finally {
      await api.end();
    }

    // L'exploitation lit, et n'écrit pas.
    const c = await admin.connect();
    try {
      await c.query("begin; set local role malica_exploitation");
      await c.query("select count(*) from observabilite.chronologie_v");
      await c.query(`select * from observabilite.diagnostic_piece('${randomUUID()}')`);
      await assert.rejects(
        c.query(
          "insert into observabilite.traces (id, origine, debut) values (gen_random_uuid(), 'api', now())",
        ),
        { code: "42501" },
      );
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("un utilisateur ne trace pas pour une autre organisation", async () => {
    // Le chemin du serveur : le dossier d'un autre est écarté, la trace reste.
    const chez = { id: randomUUID(), acteur: a.id, tenant: orgA };
    const ailleurs = { id: randomUUID(), acteur: a.id, tenant: orgB };
    const bilan = await consignerEnBase([
      evenement(chez, "http", "k"),
      evenement(ailleurs, "http", "k"),
    ]);
    assert.equal(bilan.dossiers_ecartes, 1);
    assert.equal(bilan.inscrits, 2);
    const traces = await lire<{ id: string; tenant_id: string | null }>(
      "select id, tenant_id from observabilite.traces where id = any ($1)",
      [[chez.id, ailleurs.id]],
    );
    assert.equal(traces.find((t) => t.id === chez.id)?.tenant_id, orgA);
    assert.equal(traces.find((t) => t.id === ailleurs.id)?.tenant_id, null);

    // Sous l'identité d'un utilisateur : le refus, sans rien écrire.
    const sousA = async (lot: Evenement[]) => {
      const c = await admin.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [a.id]);
        await c.query("select observabilite.consigner($1::jsonb)", [JSON.stringify(lot)]);
      } finally {
        await c.query("rollback");
        c.release();
      }
    };
    await assert.rejects(
      sousA([evenement({ id: randomUUID(), acteur: a.id, tenant: orgB }, "http", "k")]),
      {
        code: "42501",
        message: "refus.geste.non_permis",
      },
    );
    await assert.rejects(
      sousA([evenement({ id: randomUUID(), acteur: b.id, tenant: orgB }, "http", "k")]),
      {
        code: "42501",
      },
    );
  });

  it("la trace d'une opération annulée par rollback reste", async () => {
    const trace = nouvelleTrace("web", { acteur: a.id });
    let piece = "";
    await assert.rejects(
      sousLaTrace(trace, () =>
        sousIdentiteDuServeur(a.id, async (db) => {
          const { rows } = await db.query<{ id: string }>(
            `select public.capture_piece_register($1, 'pdf', $2, $3, null, 'personnel') as id`,
            [orgA, `essai/${marque}.pdf`, marque],
          );
          piece = rows[0]!.id;
          noterLObjet({ tenant: orgA, piece });
          // L'étape mesurée échoue DANS la transaction, qui s'annule ensuite.
          await mesurer(
            "persistance",
            () => Promise.reject(new Error("annulée après l'inscription")),
            { piece },
          );
        }),
      ),
      /annulée/,
    );
    // La pièce n'existe pas : la transaction est annulée…
    assert.deepEqual(await lire("select 1 from capture.pieces where id = $1", [piece]), []);
    // … et sa trace est là, avec le dossier et la pièce qu'elle nommait.
    const [ligne] = await attendre(async () => {
      const r = await lire<{ tenant_id: string; piece_id: string; issue: string }>(
        `select t.tenant_id, t.piece_id, e.issue::text
           from observabilite.traces t join observabilite.evenements e on e.trace_id = t.id
          where t.id = $1 and e.etape = 'persistance'`,
        [trace.id],
      );
      return r.length ? r : null;
    }, "persistance annulée");
    assert.deepEqual(ligne, { tenant_id: orgA, piece_id: piece, issue: "erreur" });
  });

  it("un renvoi ou un retry ne fait pas de doublon : il compte une répétition", async () => {
    const trace = { id: randomUUID(), acteur: a.id };
    const premier = evenement(trace, "upload", "piece-1:essai-1", { issue: "erreur" });
    await consignerEnBase([premier]);
    // Le même renvoi deux fois dans un lot, puis encore une fois.
    await consignerEnBase([
      { ...premier, issue: "ok" },
      { ...premier, issue: "ok" },
    ]);
    const bilan = await consignerEnBase([{ ...premier, issue: "ok" }]);
    assert.deepEqual(
      { inscrits: bilan.inscrits, repetes: bilan.repetes },
      { inscrits: 0, repetes: 1 },
    );
    const lignes = await evenementsDe(trace.id);
    assert.equal(lignes.length, 1);
    // La première vaut ; les suivantes sont comptées.
    assert.equal(lignes[0]!.issue, "erreur");
    assert.equal(lignes[0]!.repetitions, 3);
  });

  it("le détail est borné aux clés de l'étape, sans objet ni liste", async () => {
    const trace = { id: randomUUID() };
    await consignerEnBase([
      evenement(trace, "http", "k", {
        detail: {
          methode: "POST",
          statut: 200,
          route: "x".repeat(500),
          jeton: "secret",
        } as Evenement["detail"],
      }),
      // Un objet imbriqué (une photo, un texte découpé) n'entre pas.
      { ...evenement(trace, "rpc", "k"), detail: { depot: { image: "AAAA" } } as never },
    ]);
    const [http, rpc] = await evenementsDe(trace.id);
    assert.deepEqual(Object.keys(http!.detail).sort(), ["methode", "route", "statut"]);
    assert.equal((http!.detail["route"] as string).length, 200);
    assert.deepEqual(rpc!.detail, {});
  });

  it("l'en-tête de trace se propage, et l'étape rpc référence l'audit sans le recopier", async () => {
    const trace = randomUUID();
    const jeton = emettreJeton(a);
    const appeler = (args: unknown[], cle: string) =>
      fetch(`${base}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jeton}`,
          "X-Malica-Client": "web/0.2.99",
          "x-malica-trace": trace,
          "x-malica-cle": cle,
        },
        body: JSON.stringify({ depot: "identite", methode: "createOrganization", args }),
      });

    const reussi = await appeler(
      [
        {
          kind: "pme",
          name: `ESSAI C ${marque}`,
          validationMode: "autonome",
          jurisdiction: "TN",
          currency: "TND",
        },
      ],
      "creer-1",
    );
    assert.equal(reussi.status, 200);
    assert.equal(reussi.headers.get("x-malica-trace"), trace);
    const orgC = ((await reussi.json()) as { resultat: string }).resultat;

    // Refusé par la base : la transaction est annulée, l'étape reste.
    const refuse = await appeler(
      [{ kind: "pas-un-genre", name: "x", jurisdiction: "TN", currency: "TND" }],
      "creer-2",
    );
    assert.equal(refuse.status, 400);

    const lignes = await attendre(async () => {
      const r = await evenementsDe(trace);
      return r.filter((e) => e.etape === "rpc").length === 2 ? r : null;
    }, "les deux étapes rpc");

    const [rpcOk, rpcRefus] = lignes.filter((e) => e.etape === "rpc");
    assert.equal(rpcOk!.issue, "ok");
    assert.deepEqual(
      {
        depot: rpcOk!.detail["depot"],
        methode: rpcOk!.detail["methode"],
        statut: rpcOk!.detail["statut"],
      },
      { depot: "identite", methode: "createOrganization", statut: 200 },
    );
    assert.ok(rpcOk!.audit_ids.length > 0, "la création est auditée : l'étape le référence");
    const audits = await lire<{ tenant_id: string }>(
      "select tenant_id from audit.event_log where id = any ($1)",
      [rpcOk!.audit_ids],
    );
    assert.equal(audits.length, rpcOk!.audit_ids.length);
    assert.ok(audits.every((x) => x.tenant_id === orgC));

    assert.equal(rpcRefus!.issue, "refus");
    assert.match(String(rpcRefus!.detail["code_refus"]), /^refus\./);
    assert.deepEqual(rpcRefus!.audit_ids, []);

    const http = lignes.filter((e) => e.etape === "http");
    assert.equal(http.length, 2);
    assert.ok(http.every((e) => e.detail["route"] === "/rpc"));

    const [t] = await lire<{ origine: string; acteur: string; version: string }>(
      "select origine::text, acteur, version from observabilite.traces where id = $1",
      [trace],
    );
    assert.deepEqual(t, { origine: "web", acteur: a.id, version: "web/0.2.99" });

    // Le même appel renvoyé après une reconnexion : aucune ligne de plus.
    await appeler(
      [{ kind: "pas-un-genre", name: "x", jurisdiction: "TN", currency: "TND" }],
      "creer-2",
    );
    await attendre(async () => {
      const r = await evenementsDe(trace);
      return r.some((e) => e.cle === "creer-2" && e.etape === "rpc" && e.repetitions === 1)
        ? r
        : null;
    }, "la répétition comptée");
    assert.equal((await evenementsDe(trace)).length, 4);

    await admin.query(
      `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé'
        where id = $1`,
      [orgC],
    );

    // Un en-tête mal formé n'est pas cru : une trace neuve est rendue.
    const neuve = await fetch(`${base}/moi`, { headers: { "x-malica-trace": "pas-une-trace" } });
    assert.equal(neuve.status, 401);
    assert.match(neuve.headers.get("x-malica-trace") ?? "", /^[0-9a-f-]{36}$/);
    assert.notEqual(neuve.headers.get("x-malica-trace"), "pas-une-trace");
  });

  it("le diagnostic d'une pièce rend sa chronologie, travaux différés compris", async () => {
    const piece = randomUUID();
    const origine = nouvelleTrace("android", { acteur: a.id });
    await sousLaTrace(origine, async () => {
      noterLObjet({ tenant: orgA, piece });
      consigner("capture", "ok", { cle: "capture" });
      // La lecture différée : sa propre trace, rattachée, et son échec.
      await assert.rejects(
        tracerUnTravail("lecture", origine.id, () => Promise.reject(new Error("modèle muet")), {
          tenant: orgA,
          tentative: 2,
        }),
      );
    });
    // Une trace sans pièce, dont une étape nomme la pièce ; et une étrangère.
    const autre = { id: randomUUID() };
    await consignerEnBase([
      evenement(autre, "affiche", "ecran", { piece }),
      evenement({ id: randomUUID(), piece: randomUUID() }, "affiche", "ecran"),
    ]);

    const chronologie = await attendre(async () => {
      const c = await admin.connect();
      try {
        await c.query("begin; set local role malica_exploitation");
        const { rows } = await c.query<{
          trace_id: string;
          parente_id: string | null;
          etape: string;
          issue: string;
        }>(
          "select trace_id, parente_id, etape, issue::text from observabilite.diagnostic_piece($1)",
          [piece],
        );
        return rows.length === 3 ? rows : null;
      } finally {
        await c.query("rollback");
        c.release();
      }
    }, "la chronologie de la pièce");

    assert.deepEqual(chronologie.map((r) => `${r.etape}:${r.issue}`).sort(), [
      "affiche:ok",
      "capture:ok",
      "tache:erreur",
    ]);
    const tache = chronologie.find((r) => r.etape === "tache")!;
    assert.equal(tache.parente_id, origine.id);
    assert.notEqual(tache.trace_id, origine.id);
  });
});
