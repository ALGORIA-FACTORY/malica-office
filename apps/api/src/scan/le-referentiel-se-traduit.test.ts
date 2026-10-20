/**
 * Tout libellé du référentiel montré à l'écran est traduit.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « corrige le hardcoding ».
 *
 * `ref.labels` porte sept espaces de noms et cent cinquante libellés traduits
 * en trois langues. Au matin du 11, QUATRE n'étaient joints par aucun code :
 *
 *   mention         36 libellés — joints dans la journée, pour le reçu
 *   charge_famille  27 libellés — jamais
 *   moyen_paiement  24 libellés — joints la veille
 *   tva_rate        15 libellés — jamais
 *   fiscal_charge    3 libellés — jamais
 *
 * Les écrans lisaient la colonne `label` des tables de référentiel, qui est
 * FRANÇAISE. Un dirigeant qui met son application en arabe voyait donc
 * « Fournitures de bureau », « TVA 19 % » et « Droit de timbre » au milieu
 * d'un écran arabe — et la traduction existait, à côté, depuis le 24 août.
 *
 * C'est le motif récurrent de ce dépôt : l'outil est construit, daté, traduit,
 * et le consommateur ne l'importe pas. Ces épreuves le tiennent par les trois
 * lectures qui alimentent un écran.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("les libellés du référentiel", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `labels-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let packId = "";

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
    packId = await admin(async (p) => {
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

  it("les familles de charges se traduisent", async () => {
    const fr = (await rpc("charges", "familles", packId, "fr")) as Array<{
      code: string;
      label: string;
    }>;
    const en = (await rpc("charges", "familles", packId, "en")) as Array<{
      code: string;
      label: string;
    }>;
    assert.equal(fr.find((f) => f.code === "FOURNITURES")!.label, "Fournitures");
    assert.equal(en.find((f) => f.code === "FOURNITURES")!.label, "Supplies");
  });

  it("les taux de TVA aussi", async () => {
    const en = (await rpc("referentiel", "taxRates", packId, "TN", "en")) as Array<{
      code: string;
      label: string;
    }>;
    assert.equal(en.find((t) => t.code === "EXO")!.label, "Exempt");
  });

  it("et les droits et taxes hors TVA", async () => {
    const en = (await rpc("referentiel", "fiscalCharges", packId, "en")) as Array<{
      code: string;
      label: string;
    }>;
    assert.equal(en.find((c) => c.code === "DROIT_TIMBRE")!.label, "Stamp duty");
  });

  it("une langue sans traduction retombe sur le français, elle ne vide pas l'écran", async () => {
    /*
     * Le repli est explicite et il compte : un référentiel incomplet dans une
     * langue doit s'afficher en français, pas disparaître. Une liste vide
     * ferait croire que le pack ne porte rien.
     */
    const xx = (await rpc("charges", "familles", packId, "xx")) as Array<{
      code: string;
      label: string;
    }>;
    assert.ok(xx.length > 0);
    assert.equal(xx.find((f) => f.code === "FOURNITURES")!.label, "Fournitures");
  });

  it("et AUCUN espace de noms de `ref.labels` ne reste orphelin", async () => {
    /*
     * La garde qui empêche la rechute. Elle ne vérifie pas un écran : elle
     * vérifie que chaque espace de noms traduit est joint par au moins une
     * requête du code de production. Un namespace qu'on sème sans le lire est
     * du travail payé deux fois — une fois pour l'écrire, une fois pour le
     * découvrir des semaines plus tard.
     */
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (nom.endsWith(".ts") && !nom.includes(".test.")) fichiers.push(chemin);
      }
    };
    parcourir("src");
    const code = fichiers.map((f) => readFileSync(f, "utf8")).join("\n");

    const namespaces = await admin(async (p) => {
      const { rows } = await p.query<{ ns: string }>(
        `select distinct ns from ref.labels order by ns`,
      );
      return rows.map((r) => r.ns);
    });

    const orphelins = namespaces.filter((ns) => !code.includes(`ns = '${ns}'`));
    assert.deepEqual(
      orphelins,
      [],
      `espace(s) de noms traduits que personne ne lit : ${orphelins.join(", ")} — ` +
        `l'écran affiche alors la colonne française de la table de référentiel`,
    );
  });
});
