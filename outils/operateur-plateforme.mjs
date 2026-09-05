/**
 * Faire d'un compte un opérateur de plateforme — le développeur qui voit tout.
 *
 *   node outils/operateur-plateforme.mjs dev@regalica.local
 *
 * La base lit `app.platform_operators` dans chaque politique de lecture
 * (`app.is_platform()`), et le rail du cabinet le dit : « Développeur · accès
 * à tout ». L'URL d'administration vient de apps/api/.env et n'est jamais
 * affichée.
 */
import { readFileSync } from "node:fs";

import pg from "pg";

const email = process.argv[2]?.trim();
if (!email) {
  console.error("usage : node outils/operateur-plateforme.mjs <email>");
  process.exit(1);
}

const env = readFileSync("apps/api/.env", "utf8");
const url = /^DATABASE_URL_ADMIN=(.*)$/m.exec(env)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) {
  console.error("DATABASE_URL_ADMIN absente de apps/api/.env");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const compte = await client.query("select id from auth.users where email = $1", [email]);
  if (compte.rowCount === 0) {
    console.error(`compte inconnu : ${email}`);
    process.exit(1);
  }
  const r = await client.query(
    `insert into app.platform_operators (user_id, note)
     values ($1, $2)
     on conflict (user_id) do nothing`,
    [compte.rows[0].id, "développeur — accès à tout"],
  );
  console.log(
    r.rowCount ? `opérateur de plateforme : ${email}` : `déjà opérateur de plateforme : ${email}`,
  );
} finally {
  await client.end();
}
