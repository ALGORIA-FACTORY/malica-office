/**
 * La preuve d'isolation, exécutable.
 *
 * Elle vérifie la seule chose qui, si elle cède, expose les données d'un
 * cabinet à un autre : qu'un utilisateur ne voit que les lignes de ses
 * organisations, et que c'est la base — non le code de l'API — qui le décide.
 *
 * Aucun `set_config` posé à la main dans le test, aucun rôle emprunté : tout
 * passe par `sousIdentite`, exactement comme une requête réelle. Un test qui
 * tricherait sur ce point ne prouverait rien.
 *
 *   node --experimental-strip-types --test src/isolation.test.ts
 */

import assert from "node:assert/strict";
import pg from "pg";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, horsRlsAuthentificationSeule, sousIdentite } from "./db.ts";

/** Sans base, la suite s'ignore au lieu d'échouer : un rouge permanent ne se lit plus. */
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("isolation des tenants", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `essai-${Date.now()}`;
  let a: Utilisateur;
  let b: Utilisateur;
  let orgA = "";

  before(async () => {
    const compteA = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const compteB = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compteA && compteB, "les deux comptes doivent être créés");
    a = compteA;
    b = compteB;

    // La mise en place emprunte le VRAI chemin applicatif : A crée son
    // organisation par la RPC gouvernée, puis y dépose une pièce, sous sa
    // propre identité. Aucun droit administratif n'est requis — et ce que le
    // test vérifie ensuite porte donc sur des données créées comme en
    // production, pas injectées par-dessous.
    await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query<{ create_organization: string }>(
        `select public.create_organization($1, $2, $3) as create_organization`,
        ["pme", `ESSAI ${marque}`, "autonome"],
      );
      orgA = rows[0]!.create_organization;

      await db.query(
        `insert into capture.pieces
           (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'personnel', $2, $3)`,
        [orgA, `essai/${marque}.pdf`, marque],
      );
    });
  });

  after(async () => {
    // On range derrière soi — mais on ARCHIVE, on ne supprime pas.
    //
    // Supprimer l'organisation cascade vers `audit.event_log`, où le déclencheur
    // `app.deny_mutation()` refuse toute mutation : R7, une correction est une
    // écriture nouvelle. C'est précisément pour cela que l'audit a trouvé 88
    // organisations « SMOKE » abandonnées en production — la suite précédente
    // tentait de supprimer, échouait, et laissait tout derrière elle.
    //
    // Le schéma prévoyait la sortie : `archived_at` et `archived_reason`.
    //
    // L'archivage demande des droits que `regalica_api` n'a pas — et ne doit pas
    // avoir. On passe par une connexion d'administration propre au test ; sans
    // elle, on le dit plutôt que de laisser croire que c'est fait.
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (BASE_CONFIGUREE && admin && orgA) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = $1 and archived_at is null`,
          [orgA],
        );
      } finally {
        await pool.end();
      }
    } else if (BASE_CONFIGUREE) {
      console.warn(
        `[isolation] DATABASE_URL_ADMIN absente : l'organisation « ESSAI ${marque} » reste active.`,
      );
    }
    await fermerLePool();
  });

  it("le propriétaire voit son organisation", async () => {
    const vues = await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query(`select id from identity.organizations`);
      return rows;
    });
    assert.deepEqual(
      vues.map((r) => (r as { id: string }).id),
      [orgA],
    );
  });

  it("le propriétaire voit sa pièce", async () => {
    const vues = await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query(`select id from capture.pieces`);
      return rows;
    });
    assert.equal(vues.length, 1);
  });

  it("un tiers ne voit aucune organisation", async () => {
    const vues = await sousIdentite(b.id, async (db) => {
      const { rows } = await db.query(`select id from identity.organizations`);
      return rows;
    });
    assert.equal(vues.length, 0);
  });

  it("un tiers ne voit aucune pièce", async () => {
    const vues = await sousIdentite(b.id, async (db) => {
      const { rows } = await db.query(`select id from capture.pieces`);
      return rows;
    });
    assert.equal(vues.length, 0);
  });

  it("un tiers ne peut pas écrire dans le tenant d'un autre", async () => {
    await assert.rejects(
      sousIdentite(b.id, async (db) => {
        await db.query(
          `insert into capture.pieces
             (tenant_id, source, vis, storage_path, idempotency_key, created_by)
           values ($1, 'pdf', 'partage', $2, $3, $4)`,
          [orgA, `intrusion/${marque}.pdf`, `intrusion-${marque}`, b.id],
        );
      }),
      "l'écriture dans le tenant d'autrui doit être refusée par la RLS",
    );
  });

  it("le rôle de connexion ne contourne pas la RLS", async () => {
    // Si `regalica_api` était superutilisateur, propriétaire ou `bypassrls`,
    // tout ce qui précède passerait sans rien prouver. On le vérifie.
    const { superuser, bypassrls } = await horsRlsAuthentificationSeule(async (db) => {
      const { rows } = await db.query<{ superuser: boolean; bypassrls: boolean }>(
        `select rolsuper as superuser, rolbypassrls as bypassrls
           from pg_roles where rolname = current_user`,
      );
      return rows[0]!;
    });
    assert.equal(superuser, false, "le rôle de connexion ne doit pas être superutilisateur");
    assert.equal(bypassrls, false, "le rôle de connexion ne doit pas contourner la RLS");
  });
});
