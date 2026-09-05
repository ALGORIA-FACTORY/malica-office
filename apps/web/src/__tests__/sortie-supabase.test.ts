/**
 * La sortie de Supabase, rendue irréversible.
 *
 * Une suppression se défait par inadvertance : un import copié depuis une
 * ancienne branche, un générateur qui recrée un client, un exemple collé depuis
 * la documentation. Ce garde-fou est ce qui transforme « nous avons enlevé
 * Supabase » en « Supabase ne peut pas revenir sans que quelqu'un décide de
 * supprimer ce fichier » — et supprimer un test est une décision, pas un oubli.
 *
 * Même motif que `socle/__tests__/purity.test.ts`, à deux nuances près.
 *
 * Ce qui est interdit ici, c'est le NOM, pas seulement l'import : un
 * `process.env` qui lirait encore `SUPABASE_URL`, une URL de projet codée en
 * dur, une clé oubliée. Les chaînes de caractères sont donc inspectées — c'est
 * même là que se cache le pire résidu, celui qui ne casse pas la compilation.
 *
 * Et seuls les commentaires sont ignorés. Expliquer d'où l'on vient a de la
 * valeur ; interdire le mot jusque dans une explication pousserait à écrire des
 * commentaires évasifs plutôt qu'à retirer du code.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..");
/**
 * Le socle a quitté `apps/web/src` pour `packages/socle`, où l'API le lit
 * aussi. Le garde-fou le suit : un paquet partagé est précisément l'endroit où
 * un import copié ferait le plus de dégâts, des deux côtés à la fois.
 */
const SOCLE = join(__dirname, "..", "..", "..", "..", "packages", "socle", "src");

/**
 * Le seul fichier exempté : celui-ci. Un garde-fou doit nommer ce qu'il
 * interdit, et il est donc le dernier endroit du dossier où le mot subsiste.
 */
const GARDE_FOUS = new Set(["__tests__/sortie-supabase.test.ts"]);

function parcourir(dossier: string, trouves: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) parcourir(chemin, trouves);
    else if (/\.(ts|tsx)$/.test(nom)) trouves.push(chemin);
  }
  return trouves;
}

/** Retire les commentaires, et rien d'autre. Le reste est du code. */
function horsCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("sortie de Supabase — apps/web/src et packages/socle/src", () => {
  const fichiers = [...parcourir(RACINE), ...parcourir(SOCLE)];

  it("parcourt bien l'arborescence", () => {
    // Un garde-fou qui ne lit aucun fichier passerait toujours. On vérifie donc
    // qu'il a effectivement du travail.
    expect(fichiers.length).toBeGreaterThan(100);
  });

  for (const fichier of fichiers) {
    const nom = relative(fichier.startsWith(SOCLE) ? SOCLE : RACINE, fichier).replace(/\\/g, "/");
    if (GARDE_FOUS.has(nom)) continue;

    it(`sans Supabase : ${nom}`, () => {
      const code = horsCommentaires(readFileSync(fichier, "utf8"));
      expect(code, `« supabase » réapparaît dans ${nom}`).not.toMatch(/supabase/i);
    });
  }
});
