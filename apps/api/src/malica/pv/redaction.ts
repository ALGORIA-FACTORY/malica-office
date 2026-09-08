/**
 * La forme du procès-verbal : ce que le modèle rend, et ce qu'on en relit.
 *
 * ============================================================== POURQUOI
 *
 * Malica rédige le PV en sections — un intitulé, un corps — et les rend en
 * JSON. Ce module dit si ce qu'elle a rendu tient dans cette forme, et met
 * bout à bout tout ce qu'un lecteur en verra, pour que la garde « aucun
 * nombre étranger » (`malica/redaction.server.ts`) relise le texte entier.
 * Il ne parle à personne, ne lit rien : il reçoit un texte, il rend des
 * sections. Donc éprouvable, et rapide.
 */
import { z } from "zod";

const Sections = z.object({
  sections: z
    .array(
      z.object({
        kicker: z.string().trim().min(1).max(80),
        corps: z.string().trim().min(1).max(2400),
      }),
    )
    .min(2)
    .max(6),
});

export type SectionsRedigees = z.infer<typeof Sections>["sections"];

/**
 * Les sections telles que le modèle les a rendues, ou rien.
 *
 * Le modèle répond en JSON, mais pas toujours nu : une clôture de code, une
 * phrase avant. On isole le premier objet et on le valide ; tout ce qui ne
 * tient pas dans la forme attendue est un échec, jamais une devinette.
 */
export function lireSections(reponse: string): SectionsRedigees | null {
  const debut = reponse.indexOf("{");
  const fin = reponse.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return null;
  let brut: unknown;
  try {
    brut = JSON.parse(reponse.slice(debut, fin + 1));
  } catch {
    return null;
  }
  const lu = Sections.safeParse(brut);
  return lu.success ? lu.data.sections : null;
}

/** Tout ce qu'un lecteur verra du texte : intitulés et corps, à la suite. */
export function texteDesSections(sections: ReadonlyArray<{ kicker: string; corps: string }>) {
  return sections.map((s) => `${s.kicker}\n${s.corps}`).join("\n\n");
}
