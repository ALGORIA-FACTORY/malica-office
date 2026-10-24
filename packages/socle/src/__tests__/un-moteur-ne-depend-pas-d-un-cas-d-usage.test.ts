/**
 * Les couches du Socle : un moteur, et le domaine qu'il calcule, ne dépendent
 * jamais d'un cas d'usage.
 *
 * Le 24 octobre 2026, le moteur d'équilibre (`engines/p4/balance.ts`)
 * importait `contrepartieDuDocument` depuis `use-cases/libelle-de-piece.ts` :
 * la flèche allait à rebours. Un cas d'usage orchestre des moteurs ; si un
 * moteur l'importe, un changement d'orchestration peut casser un calcul, et le
 * premier cycle d'imports qui en naît ne se voit qu'au démarrage.
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

const VERS_UN_CAS_D_USAGE = /(?:from|import)\s*\(?\s*["'][^"']*\/use-cases\//;

describe("couches — engines/** et domain/** n'importent aucun cas d'usage", () => {
  const fichiers = ["engines", "domain"]
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => !f.includes("__tests__"));
  for (const fichier of fichiers) {
    it(fichier.replace(ROOT, "socle"), () => {
      expect(readFileSync(fichier, "utf8")).not.toMatch(VERS_UN_CAS_D_USAGE);
    });
  }
});
