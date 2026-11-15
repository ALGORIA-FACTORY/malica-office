/**
 * Les écrans embarqués sont ceux du dépôt — la preuve sur le paquet.
 *
 *   node outils/ecrans-embarques.mjs <dossier du bundle>
 *
 * ================================================================ POURQUOI
 *
 * Le bundle web vit dans l'APK (`capacitor.config.ts`, pas de `server.url`).
 * Un APK construit sur un bundle plus ancien que le site affiche des écrans
 * plus anciens : la rangée des sièges sans sa mise en page `.sieges`. Le
 * réglage affiche « Écrans x.y.z » (`versionClient()`), mais personne ne le
 * comparait au dépôt avant l'envoi.
 *
 * ============================================== UNE SEULE SOURCE DE VÉRITÉ
 *
 * La version des écrans est `version` de `package.json` à la racine : le
 * `define` de `apps/web/vite.config.ts` la pose dans le JavaScript, et le
 * greffon `malica:tampon-des-ecrans` l'écrit dans `ecrans.json` à la racine du
 * bundle. Ce script compare ce tampon à `package.json`. Il ne lit JAMAIS
 * `versionName` : c'est la version NATIVE de l'application (`-PversionName`,
 * 0.0.0 sur l'émulateur de `android-e2e.yml`), un autre nombre, qui ne dit
 * rien des écrans. Un APK de l'émulateur en 0.0.0 est donc juste si ses écrans
 * portent la version du dépôt.
 *
 * Où il tourne : `android.yml` (dans l'AAB), `android-e2e.yml` (dans l'APK de
 * l'émulateur), `ota.yml` (le bundle envoyé à Capgo).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

/** La version du dépôt — la seule source. */
function versionDuDepot(racine) {
  return JSON.parse(readFileSync(join(racine, "package.json"), "utf8")).version;
}

/**
 * Le verdict, sans effet de bord : `null` si les écrans du bundle sont ceux du
 * dépôt, sinon la raison de l'échec.
 */
export function verdict(dossier, racine = RACINE) {
  const fichier = join(dossier, "ecrans.json");
  if (!existsSync(fichier)) {
    return `${fichier} est absent : ce bundle n'a pas été construit par build:coque (greffon malica:tampon-des-ecrans).`;
  }
  let tampon;
  try {
    tampon = JSON.parse(readFileSync(fichier, "utf8")).ecrans;
  } catch {
    return `${fichier} n'est pas lisible.`;
  }
  if (typeof tampon !== "string" || tampon === "") {
    return `${fichier} ne porte pas de version des écrans.`;
  }
  const depot = versionDuDepot(racine);
  if (tampon !== depot) {
    return `Les écrans embarqués sont en ${tampon}, le dépôt est en ${depot} : le bundle est périmé, reconstruire (build:coque puis cap sync).`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dossier = process.argv[2];
  if (!dossier) {
    console.error("Usage : node outils/ecrans-embarques.mjs <dossier du bundle>");
    process.exit(2);
  }
  const raison = verdict(dossier);
  if (raison) {
    console.error(`::error::${raison}`);
    process.exit(1);
  }
  console.log(`Écrans embarqués : ${versionDuDepot(RACINE)}, ceux du dépôt.`);
}
