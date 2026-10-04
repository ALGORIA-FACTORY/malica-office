/**
 * Faire d'un compte un opérateur de plateforme — le développeur qui voit tout.
 *
 *   node outils/operateur-plateforme.mjs dev@malica.local
 *   node outils/operateur-plateforme.mjs moi@exemple.tn --base <url>
 *
 * La base lit `app.platform_operators` dans chaque politique de lecture
 * (`app.is_platform()`), et le rail du cabinet le dit : « Développeur · accès
 * à tout ». L'URL d'administration n'est jamais affichée.
 *
 * `--base` existe parce que ce niveau ne s'accorde par aucune route : il se
 * pose dans la base, et les bases d'un serveur ne sont pas celles du poste.
 * Même ordre de résolution que `db/migrer.mjs` et `db/registre.mjs` — l'option,
 * puis l'environnement, puis `apps/api/.env` — pour qu'un seul réflexe serve
 * partout. Le fichier se lit depuis la racine du dépôt et non le dossier
 * courant : l'outil se lance d'où l'on veut.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
const iBase = args.indexOf("--base");
const base = iBase === -1 ? undefined : args[iBase + 1]?.trim();
if (iBase !== -1 && !base) {
  console.error("--base attend une URL");
  process.exit(1);
}
const positionnels = iBase === -1 ? args : args.filter((_, i) => i !== iBase && i !== iBase + 1);
const email = positionnels[0]?.trim();
if (!email) {
  console.error("usage : node outils/operateur-plateforme.mjs <email> [--base <url>]");
  process.exit(1);
}

function duFichier() {
  try {
    const env = readFileSync(join(RACINE, "apps", "api", ".env"), "utf8");
    return /^DATABASE_URL_ADMIN=(.*)$/m.exec(env)?.[1]?.trim().replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}

const url = base || process.env["DATABASE_URL_ADMIN"]?.trim() || duFichier();
if (!url) {
  console.error("aucune base : passez --base <url>, DATABASE_URL_ADMIN, ou apps/api/.env");
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
