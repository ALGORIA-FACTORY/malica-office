/**
 * Les cartes de sources de la coque — envoyées à Sentry, puis retirées.
 *
 *   MALICA_CARTES_SOURCES=1 npm run build:coque:staging -w @malica/web
 *   SENTRY_AUTH_TOKEN=… node outils/cartes-sources-sentry.mjs
 *
 * ============================================================== POURQUOI
 *
 * Le bundle de la coque est minifié : sans carte, une pile reçue par Sentry
 * (`apps/web/src/lib/telemetrie.ts`) nomme `a` à la colonne 48 213 et ne sert
 * à personne. Avec la carte, elle nomme le fichier et la ligne du dépôt.
 *
 * =================================================== CE QUI NE PART JAMAIS
 *
 * Une carte porte le code source. Elle va à Sentry, et nulle part ailleurs :
 * ce script la retire du bundle AVANT que Capgo ou Gradle ne le prennent, et
 * il la retire même quand l'envoi échoue. Il échoue lui-même s'il en reste
 * une — un bundle qui embarquerait ses cartes ne doit pas partir.
 *
 * ================================================================ COMMENT
 *
 * Par identifiant de débogage : `inject` écrit le même identifiant dans le
 * script et dans sa carte, et Sentry les apparie par lui. Aucune adresse à
 * faire correspondre — celle d'un bundle servi par Capgo n'est pas celle du
 * bundle embarqué dans le paquet.
 *
 * L'organisation et le projet sont dans `apps/web/.sentryclirc`, des
 * identifiants publics ; le jeton vient de l'environnement (SENTRY_AUTH_TOKEN,
 * un secret du dépôt), jamais d'un fichier.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** La CLI de Sentry, à version arrêtée : une montée est un commit, pas une surprise. */
const CLI = "@sentry/cli@3.8.2";

const WEB = fileURLToPath(new URL("../apps/web/", import.meta.url));
const PUBLIC = join(WEB, ".output", "public");

function cartes(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return cartes(chemin);
    return nom.endsWith(".map") ? [chemin] : [];
  });
}

/** `sentry-cli`, depuis apps/web : c'est là qu'il lit `.sentryclirc`. */
function sentry(...arguments_) {
  const resultat = spawnSync("npx", ["--yes", CLI, ...arguments_], {
    cwd: WEB,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (resultat.status !== 0) {
    throw new Error(`sentry-cli ${arguments_.slice(0, 2).join(" ")} a échoué`);
  }
}

let trouvees;
try {
  trouvees = cartes(PUBLIC);
} catch {
  console.error(
    "Aucun bundle de coque : lancer d'abord `MALICA_CARTES_SOURCES=1 npm run build:coque:staging -w @malica/web`.",
  );
  process.exit(2);
}
if (trouvees.length === 0) {
  console.error(
    "Le bundle de coque ne porte aucune carte de sources : a-t-il été construit avec MALICA_CARTES_SOURCES=1 ?",
  );
  process.exit(2);
}

let echec = null;
try {
  if (!process.env["SENTRY_AUTH_TOKEN"]?.trim()) {
    throw new Error("SENTRY_AUTH_TOKEN n'est pas posé : rien n'est envoyé à Sentry");
  }
  sentry("sourcemaps", "inject", PUBLIC);
  sentry("sourcemaps", "upload", "--validate", PUBLIC);
  console.log(`${trouvees.length} carte(s) de sources envoyée(s) à Sentry.`);
} catch (erreur) {
  echec = erreur;
} finally {
  // Envoyées ou non, elles ne restent pas dans le bundle.
  for (const carte of cartes(PUBLIC)) rmSync(carte);
}

const restantes = cartes(PUBLIC);
if (restantes.length > 0) {
  console.error("Des cartes de sources restent dans le bundle de la coque :");
  for (const carte of restantes) console.error(`  ${relative(PUBLIC, carte)}`);
  process.exit(1);
}
if (echec) {
  console.error(`Les cartes de sources ne sont pas chez Sentry : ${echec.message}`);
  process.exit(1);
}
