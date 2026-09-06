/**
 * Purger les fichiers d'un dossier — sur demande écrite, jamais autrement.
 *
 *   node db/pilote/purger-pieces.mjs <tenant_id>              ce qui serait effacé
 *   node db/pilote/purger-pieces.mjs <tenant_id> --confirmer  efface
 *
 * Sur le serveur, dans le conteneur de l'API (il voit le disque des pièces) :
 *   docker compose --project-directory /srv/regalica/depot/infra --env-file /srv/regalica/.env \
 *     run --rm -e DATABASE_URL_ADMIN=postgres://postgres:<mdp>@postgres:5432/regalica \
 *     api node db/pilote/purger-pieces.mjs <tenant_id> --confirmer
 *
 * Ce qui part : les fichiers (photos, PDF, versions) du dossier sur le
 * disque — `<STOCKAGE_RACINE>/<tenant_id>/…`. Ce qui reste : les lignes en
 * base (pièces, écritures, extractions), documents comptables conservés dix
 * ans par la convention (R7). Les sauvegardes déjà prises expirent avec leur
 * rétention ; les suivantes ne contiennent plus les fichiers.
 *
 * Le geste est consigné dans app.signalements, sous le dossier, avec le
 * nombre de fichiers : la purge se retrouve dans le tableau de bord.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

const [tenantId, drapeau] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId)) {
  console.error("usage : purger-pieces.mjs <tenant_id (uuid)> [--confirmer]");
  process.exit(2);
}
const confirmer = drapeau === "--confirmer";

const racine = process.env["STOCKAGE_RACINE"];
const url = process.env["DATABASE_URL_ADMIN"];
if (!racine || !url) {
  console.error("STOCKAGE_RACINE et DATABASE_URL_ADMIN sont exigées.");
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(
    `select count(*)::int as pieces, min(created_at) as premiere, max(created_at) as derniere
       from capture.pieces where tenant_id = $1`,
    [tenantId],
  );
  const dossier = join(racine, tenantId);
  const fichiers = [];
  const parcourir = (d) => {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else fichiers.push(chemin);
    }
  };
  if (existsSync(dossier)) parcourir(dossier);

  console.log(
    `dossier ${tenantId} : ${rows[0].pieces} pièces en base (${rows[0].premiere?.toISOString?.() ?? "—"} → ${rows[0].derniere?.toISOString?.() ?? "—"}), ${fichiers.length} fichiers sur le disque`,
  );

  if (!confirmer) {
    console.log("Rien n'est effacé sans --confirmer.");
  } else {
    // Le geste est signé par l'opérateur de la plateforme : sans opérateur
    // déclaré, personne ne purge.
    const operateur = await client.query(
      "select user_id from app.platform_operators order by granted_at limit 1",
    );
    if (operateur.rows.length === 0) {
      console.error(
        "aucun opérateur de plateforme (app.platform_operators) : la purge n'a pas d'auteur, rien n'est effacé.",
      );
      process.exit(1);
    }
    if (existsSync(dossier)) rmSync(dossier, { recursive: true, force: true });
    await client.query(
      `insert into app.signalements (id, cree_le, user_id, tenant_id, version_client, ou, message)
       values (gen_random_uuid(), now(), $1, $2, 'exploitation', 'db/pilote/purger-pieces.mjs', $3)`,
      [
        operateur.rows[0].user_id,
        tenantId,
        `purge des fichiers sur demande écrite : ${fichiers.length} fichiers effacés`,
      ],
    );
    console.log(
      `${fichiers.length} fichiers effacés ; la base garde les lignes (conservation dix ans).`,
    );
  }
} finally {
  await client.end();
}
