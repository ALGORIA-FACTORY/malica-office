/**
 * Le budget du bundle de la coque — ce qu'un téléphone télécharge avant le
 * premier écran, et ce qu'une mise à jour en vol lui coûte.
 *
 *   npm run build:coque:staging -w @regalica/web && node scripts/budget-bundle.mjs
 *
 * Deux nombres, deux plafonds :
 *   - le JavaScript initial (l'entrée et ce que index.html précharge), gzippé :
 *     350 Ko — au-delà, le démarrage à froid sur un Tecno dépasse 3,5 s ;
 *   - le bundle entier tel que Capgo l'envoie (tout .output/public, gzippé
 *     fichier par fichier) : 3 Mo — au-delà, une mise à jour en 3G se coupe.
 *
 * Le script échoue si un plafond est dépassé : la CI le dit avant Play.
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RACINE = new URL("../.output/public/", import.meta.url);
const PUBLIC = decodeURIComponent(RACINE.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const PLAFOND_INITIAL = 350 * 1024;
const PLAFOND_BUNDLE = 3 * 1024 * 1024;

const gz = (chemin) => gzipSync(readFileSync(chemin)).length;
const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;

const index = readFileSync(join(PUBLIC, "index.html"), "utf8");
const initiaux = [
  ...new Set([...index.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])),
];
if (initiaux.length === 0) {
  console.error("index.html ne précharge aucun script : le bundle de coque est-il construit ?");
  process.exit(2);
}

let initial = 0;
for (const f of initiaux) initial += gz(join(PUBLIC, f));

function parcourir(dossier) {
  let total = 0;
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) total += parcourir(chemin);
    else total += gz(chemin);
  }
  return total;
}
const bundle = parcourir(PUBLIC);

const lignes = [
  ["JavaScript initial (gzip)", initial, PLAFOND_INITIAL, `${initiaux.length} fichiers`],
  ["bundle entier (gzip)", bundle, PLAFOND_BUNDLE, relative(process.cwd(), PUBLIC)],
];
let depasse = false;
for (const [nom, mesure, plafond, detail] of lignes) {
  const ok = mesure <= plafond;
  depasse ||= !ok;
  console.log(`${ok ? "OK " : "KO "} ${nom} : ${ko(mesure)} / ${ko(plafond)}  (${detail})`);
}
process.exit(depasse ? 1 : 0);
