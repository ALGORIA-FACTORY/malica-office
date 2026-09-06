/**
 * Relever le contrat RPC — ce que l'API sert, dépôt par dépôt.
 *
 *   node --experimental-strip-types contrat/relever.mjs            affiche
 *   node --experimental-strip-types contrat/relever.mjs --ecrire   écrit contrat/rpc.json
 *
 * Le fichier écrit est la frontière figée entre l'application (les ports de
 * `packages/socle/src/ports/repositories.ts`) et l'API (les dépôts de
 * `apps/api/src/rpc.ts`). Deux tests le tiennent : `apps/api/src/contrat.test.ts`
 * échoue si l'API dérive du fichier, et le test web échoue si un port appelle
 * une méthode que le fichier ne connaît pas. Une méthode ajoutée se relève
 * ici, puis se commite avec le code qui l'ajoute.
 */
import { writeFileSync } from "node:fs";

// Les dépôts importent la base, qui exige une adresse au chargement. Rien ne
// s'y connecte : on lit des signatures, pas des lignes.
process.env["DATABASE_URL"] ??= "postgres://contrat@localhost/contrat";
const { contratRpc } = await import("../apps/api/src/rpc.ts");

const CIBLE = new URL("./rpc.json", import.meta.url);
const contrat = contratRpc();
const texte = `${JSON.stringify(contrat, null, 2)}\n`;

if (process.argv.includes("--ecrire")) {
  writeFileSync(CIBLE, texte);
  const methodes = Object.values(contrat).reduce((n, m) => n + m.length, 0);
  console.log(`contrat/rpc.json : ${Object.keys(contrat).length} dépôts, ${methodes} méthodes`);
} else {
  process.stdout.write(texte);
}
