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
import { montantLisible } from "@malica/socle/montant-lisible";

import { datesEnLettres } from "../conseil/redaction.ts";
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

/**
 * Le texte relu, mis dans la langue du lecteur — après la relecture, jamais
 * avant.
 *
 * Le modèle recopie les chiffres sous leur forme brute du Socle, « 3600.000 »,
 * et les dates sous leur forme ISO : c'est la forme que la garde « aucun
 * nombre étranger » lit sans ambiguïté (« 3,600.000 » en anglais lui
 * échapperait). Le PV du 5 novembre 2026, sur staging, écrivait donc
 * « 3600.000 TND » et « 2026-11-30 » dans sa prose, sous un tableau qui disait
 * « 3 600,000 TND ». On formate ici ce qui a déjà été vérifié : chaque montant
 * EXACTEMENT tel qu'un chiffre le porte, chaque date ISO. Aucun nombre n'est
 * créé — un remplacement de texte, pas un calcul.
 */
export function misEnForme(
  sections: SectionsRedigees,
  chiffres: ReadonlyArray<{ valeur: string; genre: "montant" | "nombre" }>,
  locale: string,
): SectionsRedigees {
  // Un négatif se cite aussi sans son signe (« un déficit de 601.000 »).
  // Les plus longs d'abord : « -601.000 » avant « 601.000 », et « 3600.000 »
  // n'est pas mordu par « 600.000 ».
  const montants = [
    ...new Set(
      chiffres
        .filter((c) => c.genre === "montant")
        .flatMap((c) => [c.valeur, c.valeur.replace(/^-/, "")]),
    ),
  ].sort((a, b) => b.length - a.length);
  const formater = (texte: string) => {
    let rendu = datesEnLettres(texte, locale);
    for (const valeur of montants) {
      const echappee = valeur.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
      rendu = rendu.replace(
        new RegExp(`(?<![\\d.,])${echappee}(?![\\d.,])`, "g"),
        montantLisible(valeur, locale),
      );
    }
    return rendu;
  };
  return sections.map((s) => ({ kicker: formater(s.kicker), corps: formater(s.corps) }));
}

/** Tout ce qu'un lecteur verra du texte : intitulés et corps, à la suite. */
export function texteDesSections(sections: ReadonlyArray<{ kicker: string; corps: string }>) {
  return sections.map((s) => `${s.kicker}\n${s.corps}`).join("\n\n");
}
