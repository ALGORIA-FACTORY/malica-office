/**
 * Une panne survenue sur un téléphone laisse une trace, et elle est en base.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. « Générer le reçu » ne faisait rien. La base ne contenait
 * aucun reçu et le dossier portait bien son matricule : l'échec était réel.
 *
 * Sa raison a été perdue deux fois — le message s'affichait à deux cent vingt
 * pixels sous le bouton, donc hors écran, et le journal qui l'aurait gardée ne
 * tourne qu'en développement. La seule façon de savoir ce qui avait échoué
 * était de demander une photo de l'écran.
 *
 * Une panne qu'on ne peut pas relire n'existe pas.
 *
 *   node --experimental-strip-types --test src/scan/une-panne-laisse-une-trace.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Panne = { id: string; ou: string; message: string; version: string | null };

describe("une panne laisse une trace en base", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `panne-${Date.now()}`;
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

  it("ce qui a échoué se consigne, et se relit", async () => {
    await rpc("journal", "consigner", {
      tenantId: org,
      ou: "components/malica/comment-c-est-paye",
      message: "le canevas du reçu n'a pas pu être créé",
      pile: "at rendreRecuEnPdf (recu-pdf.ts:52)",
      version: "0.2.13",
      plateforme: "Android 14 / WebView 131",
    });
    const pannes = (await rpc("journal", "dernieres", org, 10)) as Panne[];
    assert.equal(pannes.length, 1);
    assert.equal(pannes[0]!.ou, "components/malica/comment-c-est-paye");
    assert.match(pannes[0]!.message, /canevas/);
    assert.equal(pannes[0]!.version, "0.2.13");
  });

  it("une trace trop longue se tronque — elle ne se refuse pas", async () => {
    /*
     * Signaler une panne ne doit pas en créer une seconde. Refuser une pile
     * de dix mille caractères ferait disparaître la seule trace de l'incident
     * le plus intéressant : celui qui a beaucoup à dire.
     */
    const id = (await rpc("journal", "consigner", {
      tenantId: org,
      ou: "x".repeat(400),
      message: "y".repeat(5_000),
      pile: "z".repeat(20_000),
    })) as string;
    assert.ok(id);
    const { ou, message } = await admin(async (p) => {
      const { rows } = await p.query<{ ou: string; message: string }>(
        `select ou, message from audit.journal_client where id = $1`,
        [id],
      );
      return rows[0]!;
    });
    assert.equal(ou.length, 200);
    assert.equal(message.length, 2_000);
  });

  it("une trace vide ne passe pas pour une trace muette", async () => {
    // Un message absent dirait « quelque chose a échoué » sans rien de plus,
    // et serait indistinguable d'un journal qui ne marche pas.
    const id = (await rpc("journal", "consigner", {
      tenantId: org,
      ou: "",
      message: "",
    })) as string;
    const { ou, message } = await admin(async (p) => {
      const { rows } = await p.query<{ ou: string; message: string }>(
        `select ou, message from audit.journal_client where id = $1`,
        [id],
      );
      return rows[0]!;
    });
    assert.equal(ou, "inconnu");
    assert.equal(message, "sans message");
  });

  it("on n'écrit pas dans le dossier d'un autre", async () => {
    // Sans ce refus, le journal deviendrait un moyen d'écrire chez autrui.
    const autre = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from identity.organizations where id <> $1 and archived_at is null limit 1`,
        [org],
      );
      return rows[0]?.id ?? null;
    });
    if (autre === null) return; // Base neuve : rien à usurper.
    await assert.rejects(() =>
      rpc("journal", "consigner", { tenantId: autre, ou: "essai", message: "intrusion" }),
    );
  });

  it("une trace ne se réécrit pas, et ne s'efface pas (R7)", async () => {
    await assert.rejects(
      () =>
        admin(async (p) => {
          await p.query(`set role malica_api`);
          return p.query(
            `update audit.journal_client set message = 'rature' where tenant_id = $1`,
            [org],
          );
        }),
      /mutation|interdit|denied|refus/i,
    );
  });
});
