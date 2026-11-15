/**
 * Le nom qu'une personne a donné, tel qu'on le montre (recette du 11 novembre
 * 2026, 4.4).
 *
 * Le nom saisi à l'inscription vit dans `identity.profiles.display_name` ; le
 * prénom et le nom écrits dans les Réglages, dans `prenom` et `nom`. Ce que la
 * personne a écrit en dernier, en détail, l'emporte ; sinon le nom de
 * l'inscription. Rien de deviné : sans nom, `null`, et l'écran montre l'adresse.
 */
export interface NomsDuProfil {
  prenom?: string | null;
  nom?: string | null;
  display_name?: string | null;
}

export function nomDeLaPersonne(p: NomsDuProfil | null | undefined): string | null {
  if (!p) return null;
  const detail = [p.prenom, p.nom]
    .map((x) => x?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return detail || p.display_name?.trim() || null;
}

/**
 * Ce que la carte du Compte montre : le nom (ou l'e-mail, faute de nom), son initiale, et
 * l'e-mail en second seulement quand le nom le remplace. Un nom absent n'est jamais deviné.
 */
export function identitePourAffichage(
  p: NomsDuProfil | null | undefined,
  courriel: string | null,
): { nom: string; initiale: string; courriel: string | null } {
  const nom = nomDeLaPersonne(p);
  const affiche = nom ?? courriel ?? "—";
  const initiale = (nom ?? courriel ?? "").trim().charAt(0).toLocaleUpperCase() || "·";
  return { nom: affiche, initiale, courriel: nom ? courriel : null };
}

/** Pour saluer : le prénom écrit, sinon le nom donné à l'inscription. */
export function nomPourSaluer(p: NomsDuProfil | null | undefined): string | null {
  return p?.prenom?.trim() || p?.display_name?.trim() || null;
}
