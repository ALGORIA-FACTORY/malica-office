/**
 * Un matricule, une société.
 *
 * ================================================================= POURQUOI
 *
 * Recette du 20 octobre 2026 : un second compte pouvait créer une société
 * portant le matricule d'une société existante — « Algoria Factory » existait
 * deux fois sur le staging. Une identité fiscale n'a qu'un titulaire, et un
 * mandat proposé par matricule doit savoir vers QUI il part.
 *
 * ============================================================= CE QU'ON EXIGE
 *
 * - le second compte est refusé, avec un motif qui lui dit quoi faire ;
 * - la casse et les espaces ne contournent pas la règle ;
 * - une société archivée libère son matricule ;
 * - une autre juridiction n'est pas concernée (le motif est par juridiction).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("un matricule, une société", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `um-${Date.now()}`;
  let a: Utilisateur;
  let b: Utilisateur;
  const creees: Array<{ user: string; id: string }> = [];

  async function creer(u: Utilisateur, legalId: string): Promise<string> {
    const id = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`${marque} ${u.email}`, legalId],
      );
      return rows[0]!.id;
    });
    creees.push({ user: u.id, id });
    return id;
  }

  async function archiver(user: string, id: string): Promise<void> {
    await sousIdentite(user, (db) =>
      db.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [id],
      ),
    );
  }

  before(async () => {
    const ca = await creerCompte(`${marque}-a@essai.local`, "MotDePasseTresLong2026!");
    const cb = await creerCompte(`${marque}-b@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(ca && cb);
    a = ca;
    b = cb;
  });

  after(async () => {
    for (const c of creees) await archiver(c.user, c.id);
    await fermerLePool();
  });

  it("un second compte ne crée pas la société d'un autre, et apprend quoi faire", async () => {
    const mf = matriculeDEssai();
    await creer(a, mf);
    await assert.rejects(creer(b, mf), (e: Error & { code?: string }) => {
      assert.equal(e.code, "23505");
      assert.match(e.message, /porte déjà ce matricule/);
      assert.match(e.message, /Demandez l'accès à son dirigeant/);
      return true;
    });
  });

  it("ni la casse ni les espaces ne contournent la règle", async () => {
    const mf = matriculeDEssai();
    await creer(a, mf);
    await assert.rejects(creer(b, `  ${mf.toLowerCase()}  `), /porte déjà ce matricule/);
  });

  it("le même compte non plus ne crée pas deux fois la même société", async () => {
    const mf = matriculeDEssai();
    await creer(a, mf);
    await assert.rejects(creer(a, mf), /porte déjà ce matricule/);
  });

  it("une société archivée libère son matricule", async () => {
    const mf = matriculeDEssai();
    const id = await creer(a, mf);
    await archiver(a.id, id);
    assert.ok(await creer(b, mf));
  });
});
