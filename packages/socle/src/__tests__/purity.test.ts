/**
 * Garde-fou de pureté : aucun fichier de `socle/**` ne doit importer un
 * client réseau ou un client LLM. Les données arrivent en paramètres.
 *
 * L'interdiction de l'ancien fournisseur a quitté cette liste : elle est
 * désormais posée sur tout `src/**` par le garde-fou de sortie dans `src/__tests__/`,
 * et la répéter ici en ferait une règle à tenir à deux endroits.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const FORBIDDEN = [
  /from ["']node:https?["']/,
  /from ["']axios["']/,
  /\bfetch\s*\(/,
  /createClient\s*\(/,
  /from ["']openai["']/,
  /from ["']@ai-sdk\//,
];

describe("purity — socle/**", () => {
  const files = walk(ROOT).filter((f) => !f.includes("__tests__"));
  for (const file of files) {
    it(`pur : ${file.replace(ROOT, "socle")}`, () => {
      const src = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        expect(src, `import interdit ${re} dans ${file}`).not.toMatch(re);
      }
    });
  }
});
