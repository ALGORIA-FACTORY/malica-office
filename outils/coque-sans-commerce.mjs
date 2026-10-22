/**
 * La coque ne vend rien — la preuve sur le paquet lui-même.
 *
 *   npm run build:coque:staging -w @malica/web
 *   node --experimental-strip-types outils/coque-sans-commerce.mjs
 *
 * Règles de Google Play sur les biens numériques (décision du 22 octobre
 * 2026) : ni prix, ni offre, ni paiement, ni acceptation d'un abonnement dans
 * l'application installée depuis le store. L'écran s'en garde par une
 * constante de compilation (`COMMERCE`, `apps/web/src/capabilities/coque.ts`),
 * le serveur par une liste (`@malica/socle/commerce`). Cette garde lit la
 * MÊME liste et échoue si un seul de ces noms reste dans le JavaScript du
 * bundle de la coque : une branche que le tree-shaking n'aurait pas retirée
 * se voit ici, avant Play.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { METHODES_COMMERCIALES } from "../packages/socle/src/commerce.ts";

const RACINE = new URL("../apps/web/.output/public/", import.meta.url);
const PUBLIC = decodeURIComponent(RACINE.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function scripts(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return scripts(chemin);
    return nom.endsWith(".js") ? [chemin] : [];
  });
}

let fichiers;
try {
  fichiers = scripts(PUBLIC);
} catch {
  console.error(
    "Aucun bundle de coque : lancer d'abord `npm run build:coque:staging -w @malica/web`.",
  );
  process.exit(2);
}
if (fichiers.length === 0) {
  console.error("Le bundle de coque ne porte aucun script : est-il construit ?");
  process.exit(2);
}

const motifs = [...METHODES_COMMERCIALES].map((m) => [m, new RegExp(`\\b${m}\\b`)]);
const fautes = [];
for (const f of fichiers) {
  const code = readFileSync(f, "utf8");
  for (const [m, motif] of motifs) {
    if (motif.test(code)) fautes.push(`${relative(PUBLIC, f)} : ${m}`);
  }
}

// Les logos des moyens de paiement ne servent que la page de choix du web.
if (existsSync(join(PUBLIC, "paiement"))) {
  fautes.push("paiement/ : les logos des moyens de paiement (vite.config.ts les retire)");
}

if (fautes.length > 0) {
  console.error("Le bundle de la coque porte encore du commerce :");
  for (const l of fautes) console.error(`  - ${l}`);
  console.error("Envelopper l'écran fautif dans `COMMERCE` (capabilities/coque.ts).");
  process.exit(1);
}
console.log(
  `Coque sans commerce : ${METHODES_COMMERCIALES.size} méthodes absentes de ${fichiers.length} scripts.`,
);
