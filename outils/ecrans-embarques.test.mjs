/**
 * Les écrans de l'APK sont ceux du dépôt — épreuve hors ligne.
 *
 * Trois choses, une source :
 *   1. `ecrans-embarques.mjs` échoue quand le tampon du bundle diffère de
 *      `package.json` (la seule version des écrans), et ne lit jamais
 *      `versionName` (0.0.0 sur l'émulateur : un autre nombre).
 *   2. La chaîne qui produit ce tampon et qui le contrôle (vite.config.ts,
 *      android.yml, android-e2e.yml, ota.yml) n'a pas de seconde liste.
 *   3. La feuille `styles-pme.css`, `.sieges` comprise, entre dans la coque
 *      par la même chaîne que sur le site : il n'y a pas d'entrée de coque
 *      séparée qui puisse l'oublier.
 *
 * Ce que cette épreuve ne prouve pas : le rendu. Il se juge sur les captures
 * de `android/maestro/bibliotheque-sieges.yaml`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { verdict } from "./ecrans-embarques.mjs";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(RACINE, "outils", "ecrans-embarques.mjs");
const lire = (...chemin) => readFileSync(join(RACINE, ...chemin), "utf8");
const VERSION_DU_DEPOT = JSON.parse(lire("package.json")).version;

/** Un dépôt factice (`package.json`) et un bundle factice (`ecrans.json`). */
function banc(versionDepot, tampon) {
  const dossier = mkdtempSync(join(tmpdir(), "ecrans-"));
  const racine = join(dossier, "depot");
  const bundle = join(dossier, "bundle");
  mkdirSync(racine);
  mkdirSync(bundle);
  writeFileSync(join(racine, "package.json"), JSON.stringify({ version: versionDepot }));
  if (tampon !== undefined) writeFileSync(join(bundle, "ecrans.json"), tampon);
  return { racine, bundle };
}

describe("ecrans-embarques.mjs : le tampon contre le dépôt", () => {
  it("des écrans à la version du dépôt passent", () => {
    const { racine, bundle } = banc("1.2.3", JSON.stringify({ ecrans: "1.2.3" }));
    assert.equal(verdict(bundle, racine), null);
  });

  it("des écrans plus anciens que le dépôt échouent, et disent les deux versions", () => {
    const { racine, bundle } = banc("1.2.3", JSON.stringify({ ecrans: "1.2.2" }));
    const raison = verdict(bundle, racine);
    assert.match(raison ?? "", /1\.2\.2/);
    assert.match(raison ?? "", /1\.2\.3/);
  });

  it("un bundle sans tampon, ou au tampon vide ou illisible, échoue", () => {
    for (const tampon of [undefined, "pas du json", "{}", JSON.stringify({ ecrans: "" })]) {
      const { racine, bundle } = banc("1.2.3", tampon);
      assert.notEqual(verdict(bundle, racine), null, String(tampon));
    }
  });

  it("la version native n'entre pas en jeu : un versionName à 0.0.0 ne change pas le verdict", () => {
    // L'émulateur construit `-PversionName=0.0.0`. Les écrans de cet APK
    // portent la version du dépôt, et c'est tout ce que le script compare.
    const { racine, bundle } = banc("1.2.3", JSON.stringify({ ecrans: "1.2.3" }));
    assert.equal(verdict(bundle, racine), null);
    const source = lire("outils", "ecrans-embarques.mjs").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.equal(/versionName/.test(source), false, "le script ne doit pas lire versionName");
  });

  it("la ligne de commande sort en 1 sur un écart, en 0 sinon, en 2 sans argument", () => {
    const bon = banc(VERSION_DU_DEPOT, JSON.stringify({ ecrans: VERSION_DU_DEPOT }));
    const perime = banc(VERSION_DU_DEPOT, JSON.stringify({ ecrans: "0.0.0-perime" }));
    // Le script lit le `package.json` du vrai dépôt : le bundle seul varie.
    assert.equal(spawnSync("node", [SCRIPT, bon.bundle]).status, 0);
    assert.equal(spawnSync("node", [SCRIPT, perime.bundle]).status, 1);
    assert.equal(spawnSync("node", [SCRIPT]).status, 2);
  });
});

describe("une seule source pour la version des écrans", () => {
  const vite = lire("apps", "web", "vite.config.ts");

  it("vite.config.ts la lit dans le package.json de la racine, une fois", () => {
    assert.match(vite, /join\(RACINE, "package\.json"\)/);
    assert.equal(vite.match(/VITE_VERSION_CLIENT/g)?.length, 1, "un seul define");
    assert.match(vite, /"import\.meta\.env\.VITE_VERSION_CLIENT": JSON\.stringify\(VERSION\)/);
  });

  it("le tampon écrit dans le bundle vient de cette même constante", () => {
    assert.match(vite, /malica:tampon-des-ecrans/);
    assert.match(vite, /JSON\.stringify\(\{ ecrans: VERSION \}\)/);
  });

  it("l'écran « Écrans x.y.z » lit versionClient(), jamais la version native", () => {
    const reglages = lire("apps", "web", "src", "routes", "_authenticated", "pme.reglages.tsx");
    assert.match(reglages, /const ecrans = versionClient\(\)\.split\("\/"\)\[1\]/);
    assert.match(reglages, /pme\.reglages\.version\.ecrans/);
  });

  it("les trois flux contrôlent le bundle avec le même script", () => {
    const android = lire(".github", "workflows", "android.yml");
    const e2e = lire(".github", "workflows", "android-e2e.yml");
    const ota = lire(".github", "workflows", "ota.yml");
    assert.match(android, /ecrans-embarques\.mjs android\/app\/src\/main\/assets\/public/);
    assert.match(android, /base\/assets\/public\/ecrans\.json/);
    assert.match(e2e, /assets\/public\/ecrans\.json/);
    assert.match(e2e, /ecrans-embarques\.mjs "\$dossier\/assets\/public"/);
    assert.match(ota, /ecrans-embarques\.mjs apps\/web\/\.output\/public/);
  });

  it("la version native de Play vient aussi du dépôt ; seul l'émulateur la pose à 0.0.0", () => {
    const android = lire(".github", "workflows", "android.yml");
    assert.match(
      android,
      /-PversionName="\$\(node -p "require\('\.\.\/package\.json'\)\.version"\)"/,
    );
    const e2e = lire(".github", "workflows", "android-e2e.yml");
    // 0.0.0 n'est admis que sur l'APK d'essai, jamais signé ni envoyé.
    assert.match(e2e, /assembleEmulateurDebug -PversionName=0\.0\.0/);
    assert.equal(e2e.match(/gradlew [^\n]*-PversionName=/g)?.length, 1);
    // Le bundle Capgo prend, lui, la version du dépôt comme nom.
    assert.match(
      lire(".github", "workflows", "ota.yml"),
      /require\('\.\.\/\.\.\/package\.json'\)\.version/,
    );
  });
});

describe("la coque charge la feuille complète, .sieges comprise", () => {
  const src = (...c) => lire("apps", "web", "src", ...c);

  it("la règle .sieges existe dans la feuille", () => {
    assert.match(src("styles-pme.css"), /\[data-surface="pme"\] \.sieges \.rangee\{/);
    assert.match(src("styles-pme.css"), /\[data-surface="pme"\] \.sieges \.past\{/);
  });

  it("la feuille entre par SurfacePme -> styles-espace-pme.css -> styles-pme.css", () => {
    assert.match(
      src("components", "malica", "surface-pme.tsx"),
      /import "@\/styles-espace-pme\.css"/,
    );
    assert.match(src("styles-espace-pme.css"), /@import "\.\/styles-pme\.css"/);
  });

  it("la rangée des sièges se rend sous SurfacePme (le layout pme.tsx)", () => {
    assert.match(src("routes", "_authenticated", "pme.tsx"), /<SurfacePme>/);
    // Les deux écrans qui montrent la rangée sont des enfants de ce layout.
    for (const f of ["pme.list.tsx", "pme.dossier.$type.tsx"]) {
      assert.match(src("routes", "_authenticated", f), /RangeeDesSieges/, f);
    }
  });

  it("il n'y a qu'une entrée : la coque ne peut pas oublier ce que le site importe", () => {
    // Une seule entrée client, un seul fichier racine ; le mode « coque » de
    // vite ne change que le rendu (SPA) et l'adresse de l'API.
    const entrees = readdirSync(join(RACINE, "apps", "web", "src")).filter((f) =>
      /^(client|entry|main|coque)[^/]*\.(tsx?|jsx?)$/.test(f),
    );
    assert.deepEqual(entrees, ["client.tsx"]);
    assert.equal(existsSync(join(RACINE, "apps", "web", "src", "routes", "__root.tsx")), true);
    const vite = lire("apps", "web", "vite.config.ts");
    assert.doesNotMatch(vite, /styles-pme/, "aucune feuille n'est choisie par mode");
  });
});

describe("le flux Maestro de Bibliothèque › Sièges", () => {
  const flux = lire("android", "maestro", "bibliotheque-sieges.yaml");

  it("suit la structure des autres flux", () => {
    assert.match(flux, /^appId: com\.algoriafactory\.malica\.emulateur$/m);
    assert.match(flux, /^androidWebViewHierarchy: devtools$/m);
    assert.match(flux, /- runFlow: connexion\.yaml/);
    assert.match(flux, /- tapOn: "Bibliothèque"/);
  });

  it("n'invente ni compte ni jeu de données : il se connecte par les variables de la CI", () => {
    assert.doesNotMatch(flux, /@|JeuDeDonnees/);
  });

  it("ses libellés sont ceux du dictionnaire français", () => {
    const messages = lire("packages", "socle", "src", "messages-fr.ts");
    assert.match(messages, /"pme\.home\.bibliotheque": "Bibliothèque"/);
    assert.match(messages, /"pme\.dossier\.sieges": "Sièges"/);
    assert.match(messages, /"pme\.vue\.mois": "Mois"/);
  });
});
