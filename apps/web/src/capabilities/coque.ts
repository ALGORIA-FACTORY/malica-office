/**
 * La coque — ce que l'application sait de l'enveloppe qui la porte.
 *
 * Deux questions, qu'il ne faut jamais confondre :
 *
 *   CIBLE_COQUE   à la compilation : ce bundle est-il celui qu'on embarque dans
 *                 la coque ? Décide de ce qui ENTRE dans le paquet — le coffre,
 *                 les greffons. Le tree-shaking retire l'autre branche.
 *
 *   estNatif()    à l'exécution : ce bundle tourne-t-il DANS la coque, ou dans
 *                 un navigateur ? Décide des comportements — jeton porteur ou
 *                 cookie, scanner de l'appareil ou cadrage de la page.
 *
 * Un bundle de coque ouvert dans Chrome (`vite preview --mode coque-staging`)
 * a CIBLE_COQUE vrai et estNatif() faux : il se comporte comme le web, et
 * c'est ce qui permet de l'éprouver sans téléphone.
 *
 * Même patron que `numerisation.ts` : le monde natif est derrière une
 * interface, jamais un import direct. Les greffons de Capacitor viennent en
 * import différé, au moment où l'on en a besoin, et jamais dans un navigateur.
 */

export const CIBLE_COQUE = import.meta.env["VITE_CIBLE"] === "coque";

/** Vrai dans la coque iOS ou Android ; faux dans un navigateur. */
export function estNatif(): boolean {
  // `Capacitor` n'est posé sur la fenêtre que par la coque native.
  const global = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  return global.Capacitor?.isNativePlatform?.() === true;
}

/**
 * Ce que la coque dit d'elle à l'API : « coque-android/0.1.0 », ou
 * « web/0.1.0 » depuis un navigateur. La version est celle du dépôt, posée
 * au build ; sans elle, « atelier » — que l'API ignore, comme il se doit.
 */
export function versionClient(): string {
  const version = (import.meta.env["VITE_VERSION_CLIENT"] as string | undefined) ?? "0.0.0";
  if (!CIBLE_COQUE) return `web/${version}`;
  const global = globalThis as { Capacitor?: { getPlatform?: () => string } };
  const plateforme = global.Capacitor?.getPlatform?.() ?? "web";
  return `coque-${plateforme}/${version}`;
}
