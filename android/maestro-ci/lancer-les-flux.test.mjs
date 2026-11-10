/**
 * La boucle des flux Maestro, éprouvée sans émulateur.
 *
 * `adb` et `maestro` sont remplacés par deux doublures qui jouent un scénario
 * écrit dans des fichiers. Ce que l'épreuve tient :
 *   - un flux tombé sur une ASSERTION n'est jamais rejoué, relève ou non ;
 *   - un émulateur mort arrête la boucle et nomme les flux sans verdict ;
 *   - après la relève, seuls ces flux-là sont joués.
 * (qemu en SIGSEGV, exécution 42821890932, 10 novembre 2026.)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./lancer-les-flux.sh", import.meta.url));

/** L'émulateur est « mort » tant que le fichier `mort` existe. */
const ADB = `#!/usr/bin/env bash
if [ -e "$BANC/mort" ]; then
  case "$1" in wait-for-device) exit 1 ;; shell) exit 1 ;; *) exit 0 ;; esac
fi
[ "$1 $2 $3" = "shell getprop sys.boot_completed" ] && echo 1
exit 0
`;

/** Chaque appel consomme la première ligne du scénario du flux. */
const MAESTRO = `#!/usr/bin/env bash
flux="\${@: -1}"; nom=$(basename "$flux" .yaml)
echo "$nom" >> "$BANC/appels"
pas=$(head -n 1 "$BANC/scenario/$nom" 2>/dev/null); sed -i 1d "$BANC/scenario/$nom" 2>/dev/null
case "$pas" in
  assertion) echo "Assertion is false: \\"Accueil\\" is visible"; exit 1 ;;
  deconnexion) echo "device 'emulator-5554' not found"; exit 1 ;;
  chute) echo "device 'emulator-5554' not found"; touch "$BANC/mort"; exit 1 ;;
  *) exit 0 ;;
esac
`;

function banc(scenario) {
  const dossier = mkdtempSync(join(tmpdir(), "flux-"));
  mkdirSync(join(dossier, "android", "maestro"), { recursive: true });
  mkdirSync(join(dossier, "bin"));
  mkdirSync(join(dossier, "scenario"));
  for (const nom of ["a", "b", "c"]) {
    writeFileSync(join(dossier, "android", "maestro", `${nom}.yaml`), "");
    writeFileSync(join(dossier, "scenario", nom), (scenario[nom] ?? []).map((p) => `${p}\n`).join(""));
  }
  for (const [nom, corps] of [
    ["adb", ADB],
    ["maestro", MAESTRO],
  ]) {
    writeFileSync(join(dossier, "bin", nom), corps);
    chmodSync(join(dossier, "bin", nom), 0o755);
  }
  const lire = (fichier) =>
    existsSync(join(dossier, fichier))
      ? readFileSync(join(dossier, fichier), "utf8").split("\n").filter(Boolean)
      : null;
  return {
    lancer() {
      rmSync(join(dossier, "appels"), { force: true });
      const r = spawnSync("bash", [SCRIPT], {
        cwd: dossier,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(dossier, "bin")}:${process.env.PATH}`,
          BANC: dossier,
          MALICA_EMAIL: "x",
          MALICA_MOT_DE_PASSE: "x",
        },
      });
      return { code: r.status, appels: lire("appels") ?? [] };
    },
    releverLEmulateur: () => rmSync(join(dossier, "mort"), { force: true }),
    reussis: () => lire("maestro-reussis.txt"),
    echecs: () => lire("maestro-echecs.txt"),
    perdu: () => lire("maestro-emulateur-perdu.txt"),
  };
}

describe("la boucle des flux Maestro", () => {
  it("tous les flux passent : rien à relever", () => {
    const b = banc({});
    assert.equal(b.lancer().code, 0);
    assert.deepEqual(b.reussis(), ["a", "b", "c"]);
    assert.equal(b.perdu(), null);
  });

  it("une déconnexion passagère donne droit à un rejeu, et un seul", () => {
    const b = banc({ b: ["deconnexion"] });
    const r = b.lancer();
    assert.equal(r.code, 0);
    assert.deepEqual(r.appels, ["a", "b", "b", "c"]);
    assert.equal(b.perdu(), null);
  });

  it("une assertion fausse échoue sans rejeu ni relève", () => {
    const b = banc({ b: ["assertion"] });
    const r = b.lancer();
    assert.equal(r.code, 1);
    assert.deepEqual(r.appels, ["a", "b", "c"]);
    assert.deepEqual(b.echecs(), ["b"]);
    assert.equal(b.perdu(), null, "aucun émulateur perdu : android-e2e.yml ne relève rien");
  });

  it("l'émulateur mort arrête la boucle et nomme les flux sans verdict ; la relève ne joue qu'eux", () => {
    const b = banc({ b: ["chute"] });
    const premier = b.lancer();
    assert.equal(premier.code, 1);
    assert.deepEqual(premier.appels, ["a", "b"], "c n'est pas tenté sur un émulateur mort");
    assert.deepEqual(b.reussis(), ["a"]);
    assert.deepEqual(b.perdu(), ["b", "c"]);
    assert.deepEqual(b.echecs(), [], "une chute de l'émulateur n'est pas un verdict sur le flux");

    b.releverLEmulateur();
    const second = b.lancer();
    assert.equal(second.code, 0);
    assert.deepEqual(second.appels, ["b", "c"], "a, déjà réussi, n'est pas rejoué");
    assert.deepEqual(b.reussis(), ["a", "b", "c"]);
    assert.equal(b.perdu(), null);
  });

  it("un flux tombé sur une assertion reste en échec après la relève", () => {
    const b = banc({ a: ["assertion"], b: ["chute"] });
    assert.equal(b.lancer().code, 1);
    assert.deepEqual(b.perdu(), ["b", "c"]);

    b.releverLEmulateur();
    const second = b.lancer();
    assert.equal(second.code, 1, "la relève ne blanchit pas l'assertion");
    assert.deepEqual(second.appels, ["b", "c"]);
    assert.deepEqual(b.echecs(), ["a"]);
  });

  it("une seconde chute pendant la relève échoue, et le dit", () => {
    const b = banc({ b: ["chute", "chute"] });
    b.lancer();
    b.releverLEmulateur();
    const second = b.lancer();
    assert.equal(second.code, 1);
    assert.deepEqual(b.perdu(), ["b", "c"]);
  });
});
