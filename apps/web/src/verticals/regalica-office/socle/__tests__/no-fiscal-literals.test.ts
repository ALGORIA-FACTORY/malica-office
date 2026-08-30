/**
 * R4 — « Aucune constante fiscale en TypeScript ».
 *
 * Ce garde-fou interdit tout littéral réglementaire sous `socle/juridictions/**` :
 * taux, numéro de compte du plan comptable, jour d'échéance, seuil, référence
 * d'article. Ces valeurs vivent en base, versionnées par date d'effet.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "juridictions");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Retire commentaires et chaînes : seul le code exécutable est jugé. */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b0\.(?:0[1-9]|[1-9]\d?)\b/, "taux fiscal en dur (décimale)"],
  [/\b(?:[1-9]\d?|100)\s*%/, "taux fiscal en dur (pourcentage)"],
  [/\b[1-8]\d{2,6}\b/, "numéro de compte du plan comptable en dur"],
  [/\bday_of_month\s*:\s*\d/, "jour d'échéance en dur"],
  [/\bmonth_offset\s*:\s*\d/, "décalage d'échéance en dur"],
  [/\brate\s*:\s*["'`]?\d/, "taux en dur"],
  [/\b(?:art(?:icle)?\.?\s*\d|code\s+tva)/i, "référence d'article en dur"],
  [/\bTVA_[A-Z_]+\s*[:=]/, "nomenclature d'échéance en dur"],
];

describe("R4 — aucun littéral fiscal sous socle/juridictions", () => {
  const files = walk(ROOT);

  it("le dossier est bien analysé", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`sans littéral fiscal : ${file.replace(ROOT, "juridictions")}`, () => {
      const code = strip(readFileSync(file, "utf8"));
      for (const [re, reason] of FORBIDDEN) {
        const hit = re.exec(code);
        expect(hit, `${reason} détecté dans ${file} : « ${hit?.[0]} »`).toBeNull();
      }
    });
  }
});
