/**
 * La lisibilité d'une pièce ne se replanifie plus à chaque ligne (25 novembre 2026).
 *
 * `app.piece_lisible` est appelée pour chaque pièce et chaque article lus, et
 * descend jusqu'à `app.adhesions_de`. Sous PostgreSQL 17, une fonction SQL
 * `security definer` (ou munie d'un `set search_path`) n'est jamais intégrée à
 * la requête : elle est analysée et planifiée à CHAQUE appel, et chacune de
 * celles qu'elle appelle aussi. La TVA du mois en payait cinq planifications par
 * pièce (`la-tva-du-mois-tient-la-charge.test.ts`). En PL/pgSQL, les plans se
 * gardent pour la session (db/migrations/20261231350000_la_lisibilite_ne_se_replanifie_plus.sql).
 *
 * Un `create or replace … language sql` sur l'une d'elles passerait toutes les
 * preuves d'isolation, et le temps ne le verrait que sur une base chargée :
 * cette épreuve le refuse tout de suite.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

/** Le chemin de la sécurité par ligne : appelées pour chaque ligne lue. */
const SUR_LE_CHEMIN_DE_CHAQUE_LIGNE = [
  "a_l_acces_total",
  "adhesions_de",
  "archive_orgs",
  "dossier_du_service",
  "dossiers_du_comptable_interne",
  "engaged_orgs",
  "has_org_role",
  "is_platform",
  "member_orgs",
  "mes_archives",
  "orgs_avec_droit",
  "orgs_avec_droit_de",
  "piece_connue_du_cabinet",
  "piece_lisible",
  "piece_remplacee",
  "plateforme_requise",
  "relecture_due",
  "service",
  "version_courante",
];

describe("la lisibilité ne se replanifie plus", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  after(() => admin.end());

  it("les fonctions de la sécurité par ligne sont en PL/pgSQL, sans rien perdre de leur garde", async () => {
    const { rows } = await admin.query<{
      nom: string;
      langage: string;
      stable: boolean;
      definer: boolean;
      chemin: string[] | null;
    }>(
      `select p.proname as nom, l.lanname as langage, p.provolatile = 's' as stable,
              p.prosecdef as definer, p.proconfig as chemin
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
        where n.nspname = 'app' and p.proname = any($1::text[])`,
      [SUR_LE_CHEMIN_DE_CHAQUE_LIGNE],
    );
    assert.deepEqual(
      rows.map((r) => r.nom).sort(),
      [...SUR_LE_CHEMIN_DE_CHAQUE_LIGNE].sort(),
      "une fonction du chemin a disparu ou changé de nom : la liste se met à jour avec elle",
    );
    for (const r of rows) {
      assert.equal(r.langage, "plpgsql", `app.${r.nom} est replanifiée à chaque appel`);
      assert.ok(r.stable, `app.${r.nom} n'est plus stable`);
      assert.ok(r.definer, `app.${r.nom} n'est plus security definer`);
      assert.deepEqual(r.chemin, ['search_path=""'], `app.${r.nom} a perdu son search_path vide`);
    }
  });
});
