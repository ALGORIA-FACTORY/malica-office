/**
 * Tout nom que le service OCR peut rendre a son tarif.
 *
 * ================================================================= POURQUOI
 *
 * `agents.model_pricing` cherche un tarif par le NOM exact du relevé. Un nom
 * sans ligne n'échoue nulle part : l'écriture au journal est refusée, en
 * silence, et le lecteur tourne sans que personne ne le compte — le défaut
 * déjà rencontré le 15 octobre 2026 avec un nom composé.
 *
 * Le service compose ce nom à partir de ses réglages (`infra/ocr/service.py`)
 * et du manifeste des poids (`poids.json`) : les modèles joints par « + »,
 * puis le suffixe du moteur. Cette épreuve refait la composition pour chaque
 * moteur, avec et sans le second alphabet, et cherche chaque nom dans une
 * migration qui le tarife au rôle « vision ». Elle lit les FICHIERS, pas une
 * base : elle tourne dans `npm test`, sans rien démarrer.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ICI = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS = join(ICI, "..", "..", "db", "migrations");
const manifeste = JSON.parse(readFileSync(join(ICI, "poids.json"), "utf8"));
const service = readFileSync(join(ICI, "service.py"), "utf8");

/** Le défaut d'un réglage, tel que le service le lit. */
function defaut(reglage) {
  const m = service.match(new RegExp(`os\\.environ\\.get\\("${reglage}", "([^"]*)"\\)`));
  assert.ok(m, `réglage introuvable dans service.py : ${reglage}`);
  return m[1];
}

const DETECTION = defaut("OCR_MODELE_DETECTION");
const RECONNAISSANCE = defaut("OCR_MODELE_RECONNAISSANCE");
const ARABES = Object.keys(manifeste.modeles).filter(
  (m) => m !== DETECTION && m !== RECONNAISSANCE,
);

const tarifes = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .filter((sql) => /insert into agents\.model_pricing/i.test(sql))
  .flatMap((sql) => [...sql.matchAll(/'interne',\s*'([^']+)',\s*'vision'/g)].map((m) => m[1]));

describe("le service OCR et la table des tarifs", () => {
  it("le moteur par défaut est l'un des moteurs du manifeste", () => {
    assert.ok(defaut("OCR_MOTEUR") in manifeste.moteurs);
  });

  it("chaque modèle chargé par défaut a ses poids dans le manifeste", () => {
    for (const m of [DETECTION, RECONNAISSANCE]) assert.ok(m in manifeste.modeles, m);
  });

  it("chaque fichier de poids est épinglé par une empreinte SHA-256", () => {
    for (const [modele, m] of Object.entries(manifeste.modeles)) {
      for (const [fichier, h] of Object.entries({
        ...m.fichiers,
        "inference.onnx": m["inference.onnx"],
      })) {
        assert.match(h, /^[0-9a-f]{64}$/, `${modele}/${fichier}`);
      }
    }
  });

  it("chaque nom de relevé possible a une ligne de tarif", () => {
    const noms = [];
    for (const { suffixe_du_releve: suffixe } of Object.values(manifeste.moteurs)) {
      noms.push([DETECTION, RECONNAISSANCE].join("+") + suffixe);
      for (const a of ARABES) noms.push([DETECTION, RECONNAISSANCE, a].join("+") + suffixe);
    }
    assert.deepEqual(
      noms.filter((n) => !tarifes.includes(n)),
      [],
      "nom de relevé sans tarif : ses lectures ne se journaliseront pas",
    );
  });
});
