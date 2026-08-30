/**
 * Garde-fou de pureté : aucun fichier de `socle/**` ne doit importer un
 * client réseau, un client LLM ou Supabase. Les données arrivent en paramètres.
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
  /from ["']@supabase\//,
  /from ["']@\/integrations\/supabase/,
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
