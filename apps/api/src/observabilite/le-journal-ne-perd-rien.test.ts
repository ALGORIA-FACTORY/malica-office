/**
 * Le journal ne perd rien de ce qu'il peut garder, et compte ce qu'il perd.
 *
 * Quatre épreuves, sur la vraie porte d'écriture : une saturation (la base
 * répond lentement et la mémoire doit rester bornée), une base coupée (tout
 * part sur disque, puis se rejoue sans doublon), un arrêt brutal (un
 * processus tué net, un autre rejoue ce qu'il avait déversé, ligne coupée
 * comprise), et un arrêt demandé (l'API reçoit SIGTERM et vide sa file avant
 * de rendre la main). Un disque inutilisable, enfin : la perte est dite.
 *
 *   node --experimental-strip-types --test src/observabilite/le-journal-ne-perd-rien.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { consignerEnBase } from "../db.ts";
import { Journal, type Evenement, type OptionsDuJournal } from "./journal.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

const ICI = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(ICI, "../..");

/** Une panne de connexion, telle que `pg` la lève : sans code SQL. */
const panne = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

function evenement(trace: string, i: number): Evenement {
  const maintenant = new Date().toISOString();
  return {
    trace: {
      id: trace,
      parente: null,
      origine: "api",
      tenant: null,
      acteur: null,
      piece: null,
      version: null,
      debut: maintenant,
    },
    etape: "upload",
    issue: "ok",
    cle: `essai-${i}`,
    debut: maintenant,
    dureeMs: 1,
    acteur: null,
    piece: null,
    audits: [],
    detail: {},
  };
}

describe("le journal ne perd rien", { skip: !BASE_CONFIGUREE }, () => {
  let admin: pg.Pool;
  let dossier = "";
  const debutDuTest = new Date();

  const compter = async (trace: string) =>
    (
      await admin.query<{ n: number; r: number }>(
        `select count(*)::int as n, coalesce(sum(repetitions), 0)::int as r
           from observabilite.evenements where trace_id = $1`,
        [trace],
      )
    ).rows[0]!;

  const fichiers = async (rep: string) => (await readdir(rep).catch(() => [])).sort();

  const journal = (repertoire: string | null, options: Partial<OptionsDuJournal> = {}) =>
    new Journal({
      ecrire: consignerEnBase,
      repertoire,
      borne: 10,
      taille: 5,
      intervalleMs: 10,
      rejeuMs: 50,
      ...options,
    });

  before(async () => {
    admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    dossier = await mkdtemp(path.join(tmpdir(), "malica-journal-"));
  });

  after(async () => {
    await admin?.end();
    if (dossier) await rm(dossier, { recursive: true, force: true });
  });

  it("saturation : la mémoire reste bornée, le débordement dort sur disque, rien ne se perd", async () => {
    const rep = path.join(dossier, "saturation");
    let ouvrir: () => void = () => undefined;
    const porte = new Promise<void>((r) => {
      ouvrir = r;
    });
    // Une base qui ne répond pas tant que la porte est fermée.
    const j = journal(rep, { ecrire: async (lot) => porte.then(() => consignerEnBase(lot)) });
    const trace = randomUUID();
    let pic = 0;
    for (let i = 0; i < 100; i += 1) {
      j.consigner(evenement(trace, i));
      pic = Math.max(pic, j.enMemoire());
    }
    assert.ok(pic <= 10, `la file a tenu ${pic} événements en mémoire, pour une borne de 10`);
    assert.ok((await fichiers(rep)).length > 0, "le débordement est sur disque");

    ouvrir();
    await j.vider();
    await j.rejouer();
    assert.deepEqual(await compter(trace), { n: 100, r: 0 });
    assert.deepEqual(await fichiers(rep), [], "le fichier d'attente rejoué est effacé");
  });

  it("base coupée : tout part sur disque, puis se rejoue — deux fois, sans doublon", async () => {
    const rep = path.join(dossier, "coupee");
    let coupee = true;
    const j = journal(rep, {
      ecrire: async (lot) => {
        if (coupee) throw panne();
        return consignerEnBase(lot);
      },
    });
    const trace = randomUUID();
    for (let i = 0; i < 20; i += 1) j.consigner(evenement(trace, i));
    await j.vider();
    assert.deepEqual(await compter(trace), { n: 0, r: 0 });
    const [attente] = await fichiers(rep);
    assert.ok(attente);
    const lignes = (await readFile(path.join(rep, attente), "utf8")).trim().split("\n");
    assert.equal(lignes.length, 20);
    const copie = path.join(dossier, "copie.jsonl");
    await copyFile(path.join(rep, attente), copie);

    coupee = false;
    await new Promise((r) => setTimeout(r, 60)); // l'attente après une panne
    await j.rejouer();
    assert.deepEqual(await compter(trace), { n: 20, r: 0 });

    // Le même fichier rejoué une seconde fois (une instance tuée avant de
    // l'effacer) : aucune ligne de plus, des répétitions comptées.
    await copyFile(copie, path.join(rep, "attente-reprise-0.jsonl"));
    await j.rejouer();
    assert.deepEqual(await compter(trace), { n: 20, r: 20 });
  });

  it("arrêt brutal : ce qu'un processus tué avait déversé revient au démarrage suivant", async () => {
    const rep = path.join(dossier, "brutal");
    const trace = randomUUID();
    // An ESM import takes a URL: a Windows absolute path ("C:…") is refused.
    const module = pathToFileURL(path.join(ICI, "journal.ts")).href;
    // Le processus : une base coupée, 12 événements déversés, puis il attend
    // qu'on le tue. La dernière ligne est coupée, comme par un arrêt en
    // pleine écriture.
    const evenements = Array.from({ length: 12 }, (_, i) => evenement(trace, i));
    const script = `
      import { appendFileSync, readdirSync } from "node:fs";
      import { Journal } from ${JSON.stringify(module)};
      const j = new Journal({
        ecrire: async () => { throw Object.assign(new Error("coupée"), { code: "ECONNREFUSED" }); },
        repertoire: ${JSON.stringify(rep)}, borne: 1000, taille: 5, intervalleMs: 10, rejeuMs: 60000,
      });
      for (const e of ${JSON.stringify(evenements)}) j.consigner(e);
      await j.vider();
      const [f] = readdirSync(${JSON.stringify(rep)});
      appendFileSync(${JSON.stringify(rep)} + "/" + f, '{"trace":{"id":"coupée en plein');
      console.log("pret");
      setInterval(() => {}, 1000);
    `;
    const enfant = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
      { cwd: API, env: process.env, stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resoudre, rejeter) => {
      enfant.stdout.on("data", (d: Buffer) => {
        if (d.toString().includes("pret")) resoudre();
      });
      enfant.once("exit", (code) => rejeter(new Error(`l'enfant est sorti seul (${code})`)));
    });
    const mort = new Promise((r) => enfant.once("exit", r));
    enfant.kill("SIGKILL");
    await mort;

    const j = journal(rep);
    await j.rejouer();
    await j.vider(); // la ligne illisible se dit au lot suivant
    assert.deepEqual(await compter(trace), { n: 12, r: 0 });
    assert.deepEqual(await fichiers(rep), []);
    const { rows } = await admin.query(
      `select 1 from observabilite.evenements
        where etape = 'perte' and detail = '{"nombre": 1, "raison": "illisible"}'::jsonb
          and inscrit_le >= $1`,
      [debutDuTest],
    );
    assert.ok(rows.length >= 1, "la ligne coupée est comptée comme perdue, et dite");
  });

  // Windows has no SIGTERM: process.kill("SIGTERM") ends the process without running its
  // handler. The graceful drain is proven on Linux (CI, servers), where the API runs.
  it(
    "arrêt demandé : l'API vide sa file sur SIGTERM avant de rendre la main",
    {
      skip:
        process.platform === "win32" && "SIGTERM n'existe pas sous Windows : prouvé en CI (Linux)",
    },
    async () => {
      const rep = path.join(dossier, "sigterm");
      const pieces = path.join(dossier, "pieces");
      const port = await new Promise<number>((resoudre) => {
        const s = createServer().listen(0, () => {
          const p = (s.address() as AddressInfo).port;
          s.close(() => resoudre(p));
        });
      });
      const api = spawn(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", "src/server.ts"],
        {
          cwd: API,
          env: {
            ...process.env,
            PORT: String(port),
            STOCKAGE_RACINE: pieces,
            JOURNAL_ATTENTE: rep,
            // Rien ne s'écrit avant l'arrêt : seul le vidage de SIGTERM peut écrire.
            JOURNAL_INTERVALLE_MS: "600000",
            JOURNAL_LOT: "1000",
          },
          stdio: ["ignore", "pipe", "inherit"],
        },
      );
      const sortie = new Promise<number | null>((r) => api.once("exit", (code) => r(code)));
      await new Promise<void>((resoudre, rejeter) => {
        api.stdout.on("data", (d: Buffer) => {
          if (d.toString().includes("à l'écoute")) resoudre();
        });
        void sortie.then((code) => rejeter(new Error(`l'API est sortie seule (${code})`)));
      });

      const trace = randomUUID();
      const r = await fetch(`http://127.0.0.1:${port}/moi`, {
        headers: { "x-malica-trace": trace },
      });
      assert.equal(r.status, 401);
      assert.equal(r.headers.get("x-malica-trace"), trace);
      assert.deepEqual(await compter(trace), { n: 0, r: 0 }, "rien n'est écrit avant l'arrêt");

      api.kill("SIGTERM");
      assert.equal(await sortie, 0);
      const { rows } = await admin.query<{ issue: string; statut: number }>(
        `select issue::text, (detail ->> 'statut')::int as statut
         from observabilite.evenements where trace_id = $1 and etape = 'http'`,
        [trace],
      );
      assert.deepEqual(rows, [{ issue: "refus", statut: 401 }]);
      assert.deepEqual(await fichiers(rep), [], "tout est en base, rien n'attend sur disque");
    },
  );

  it("disque inutilisable et base coupée : la perte est comptée, puis dite", async () => {
    // Un fichier à la place du dossier : aucun déversement ne peut réussir.
    const pasUnDossier = path.join(dossier, "pas-un-dossier");
    writeFileSync(pasUnDossier, "");
    appendFileSync(pasUnDossier, "occupé");
    let coupee = true;
    const j = journal(pasUnDossier, {
      ecrire: async (lot) => {
        if (coupee) throw panne();
        return consignerEnBase(lot);
      },
    });
    const trace = randomUUID();
    for (let i = 0; i < 7; i += 1) j.consigner(evenement(trace, i));
    await j.vider();
    coupee = false;
    await new Promise((r) => setTimeout(r, 60));
    j.consigner(evenement(trace, 100));
    await j.vider();
    assert.deepEqual(
      await compter(trace),
      { n: 1, r: 0 },
      "les sept sont perdus, le suivant passe",
    );
    const { rows } = await admin.query(
      `select 1 from observabilite.evenements
        where etape = 'perte' and detail = '{"nombre": 7, "raison": "disque"}'::jsonb
          and inscrit_le >= $1`,
      [debutDuTest],
    );
    assert.equal(rows.length, 1, "la perte est dite : sept événements, faute de disque");
  });

  it("un fichier d'attente tourne : il ne grossit pas au-delà de sa borne", async () => {
    const rep = path.join(dossier, "rotation");
    const j = journal(rep, {
      ecrire: async () => {
        throw panne();
      },
      borne: 1000,
      fichierMaxOctets: 4096,
    });
    for (let i = 0; i < 60; i += 1) j.consigner(evenement(randomUUID(), i));
    await j.vider();
    const noms = await fichiers(rep);
    assert.ok(noms.length > 1, `un seul fichier pour 60 événements : ${noms.join(", ")}`);
    for (const nom of noms) {
      const taille = (await readFile(path.join(rep, nom))).length;
      // Un lot (5 événements) peut déborder la borne d'au plus lui-même.
      assert.ok(taille <= 4096 + 5 * 1024, `${nom} : ${taille} octets`);
    }
  });

  it("un long fichier d'attente se rejoue en flux, la mémoire bornée", async () => {
    // Un fichier de plusieurs dizaines de Mo, rejoué par un processus au tas
    // de 64 Mo : lu d'un bloc puis découpé, il ne tiendrait pas.
    const rep = path.join(dossier, "flux");
    const { mkdirSync, writeSync, openSync, closeSync } = await import("node:fs");
    mkdirSync(rep, { recursive: true });
    const fd = openSync(path.join(rep, "attente-longue-0.jsonl"), "w");
    const trace = randomUUID();
    const bloc: string[] = [];
    for (let i = 0; i < 150_000; i += 1) {
      bloc.push(
        JSON.stringify({ ...evenement(trace, i), detail: { remplissage: "x".repeat(200) } }),
      );
      if (bloc.length === 5_000) {
        writeSync(fd, bloc.join("\n") + "\n");
        bloc.length = 0;
      }
    }
    closeSync(fd);
    const script = `
      import { Journal } from ${JSON.stringify(pathToFileURL(path.join(ICI, "journal.ts")).href)};
      let n = 0;
      const j = new Journal({
        ecrire: async (lot) => { n += lot.length; return { rejetes: 0 }; },
        repertoire: ${JSON.stringify(rep)}, borne: 1000, taille: 200, intervalleMs: 10, rejeuMs: 50,
      });
      await j.rejouer();
      console.log("rejoues " + n);
    `;
    const enfant = spawn(
      process.execPath,
      [
        "--max-old-space-size=64",
        "--experimental-strip-types",
        "--no-warnings",
        "--input-type=module",
        "-e",
        script,
      ],
      { cwd: API, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let sortie = "";
    enfant.stdout.on("data", (d: Buffer) => (sortie += d.toString()));
    enfant.stderr.on("data", (d: Buffer) => (sortie += d.toString()));
    const code = await new Promise((r) => enfant.once("exit", r));
    assert.equal(code, 0, sortie.slice(-500));
    assert.match(sortie, /rejoues 150000/);
    assert.deepEqual(await fichiers(rep), []);
  });

  it("base coupée pendant le rejeu et disque plein : le fichier réclamé reste, rien n'est détruit", async () => {
    const rep = path.join(dossier, "garde");
    const trace = randomUUID();
    let coupee = false;
    let lots = 0;
    let disquePlein = false;
    const j = journal(rep, {
      // La base tombe après le premier lot du rejeu.
      ecrire: async (lot) => {
        if (coupee) throw panne();
        lots += 1;
        if (lots > 1) throw panne();
        return consignerEnBase(lot);
      },
      ajouter: (chemin, texte) => {
        if (disquePlein)
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        appendFileSync(chemin, texte);
      },
    });
    coupee = true;
    for (let i = 0; i < 20; i += 1) j.consigner(evenement(trace, i));
    await j.vider();
    assert.equal((await fichiers(rep)).length, 1);
    coupee = false;
    disquePlein = true;
    await new Promise((r) => setTimeout(r, 60));
    await j.rejouer();
    assert.deepEqual(await compter(trace), { n: 5, r: 0 }, "le premier lot est passé");
    const restants = await fichiers(rep);
    assert.equal(restants.length, 1, "le fichier réclamé est gardé");
    const lignes = (await readFile(path.join(rep, restants[0]!), "utf8")).trim().split("\n");
    assert.equal(lignes.length, 20);

    // Base et disque revenus : la reprise inscrit le reste, sans doublon.
    disquePlein = false;
    const reprise = journal(rep);
    await reprise.rejouer();
    const { n } = await compter(trace);
    assert.equal(n, 20);
    assert.deepEqual(await fichiers(rep), []);
  });

  it("un événement que la porte rejette est une perte dite, avec sa raison", async () => {
    const j = journal(null);
    const trace = randomUUID();
    j.consigner(evenement(trace, 1));
    j.consigner({ ...evenement(trace, 2), etape: "etape_inconnue" });
    await j.vider();
    // La perte part au lot suivant.
    await j.vider();
    assert.deepEqual(await compter(trace), { n: 1, r: 0 });
    const { rows } = await admin.query(
      `select 1 from observabilite.evenements
        where etape = 'perte' and detail = '{"nombre": 1, "raison": "rejete"}'::jsonb
          and inscrit_le >= $1`,
      [debutDuTest],
    );
    assert.equal(rows.length, 1, "l'événement rejeté par la porte est compté et dit");
  });
});
