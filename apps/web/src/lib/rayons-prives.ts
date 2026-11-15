/**
 * Les rayons de l'espace privé — planche 10, approuvée le 7 novembre 2026.
 *
 * Cinq rayons proposés, nommés par un CODE (traduit à l'écran), et les
 * rayons que la personne s'est faits, nommés par elle. Un rayon inconnu des
 * codes se lit tel qu'il a été écrit.
 */
import type { MessageKey } from "@/i18n";

export const RAYONS_PROPOSES = [
  {
    code: "maison",
    libelle: "pme.prive.rayon.maison",
    sous: "pme.prive.rayon.maison.sous",
    teinte: "#2B3A4E",
  },
  {
    code: "sante",
    libelle: "pme.prive.rayon.sante",
    sous: "pme.prive.rayon.sante.sous",
    teinte: "#3A2531",
  },
  {
    code: "vehicule",
    libelle: "pme.prive.rayon.vehicule",
    sous: "pme.prive.rayon.vehicule.sous",
    teinte: "#22343A",
  },
  {
    code: "identite",
    libelle: "pme.prive.rayon.identite",
    sous: "pme.prive.rayon.identite.sous",
    teinte: "#2E2840",
  },
  {
    code: "autres",
    libelle: "pme.prive.rayon.autres",
    sous: "pme.prive.rayon.autres.sous",
    teinte: "#262628",
  },
] as const satisfies ReadonlyArray<{
  code: string;
  libelle: MessageKey;
  sous: MessageKey;
  teinte: string;
}>;

/** Le rayon où se range un papier avant que la personne en choisisse un (G2). */
export const RAYON_PAR_DEFAUT = "autres" satisfies (typeof RAYONS_PROPOSES)[number]["code"];

/** Le nom d'un rayon à l'écran : traduit s'il est proposé, tel qu'écrit sinon. */
export function libelleDuRayon(rayon: string, t: (k: MessageKey) => string): string {
  const propose = RAYONS_PROPOSES.find((r) => r.code === rayon);
  return propose ? t(propose.libelle) : rayon;
}

/** Les rayons qu'une personne s'est faits : ceux de ses rangements qui ne sont pas proposés. */
export function rayonsASoi(rayons: readonly string[], locale: string): string[] {
  const codes = new Set<string>(RAYONS_PROPOSES.map((r) => r.code));
  return [...new Set(rayons.filter((r) => !codes.has(r)))].sort((a, b) =>
    a.localeCompare(b, locale),
  );
}
