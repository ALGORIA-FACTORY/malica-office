/**
 * Où aller après la connexion. UNE seule destination admise en dehors de
 * l'accueil : la page d'invitation, qui ramène le contact à son lien. Une
 * `suite` libre ferait de l'écran de connexion un tremplin vers n'importe
 * quelle adresse.
 */
export interface SuiteApresConnexion {
  suite?: "/invitation";
  mode?: "signin" | "signup";
}

export function lireSuite(search: Record<string, unknown>): SuiteApresConnexion {
  return {
    ...(search["suite"] === "/invitation" ? { suite: "/invitation" as const } : {}),
    ...(search["mode"] === "signup" ? { mode: "signup" as const } : {}),
  };
}
