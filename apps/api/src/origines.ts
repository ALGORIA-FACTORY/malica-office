/**
 * Quelles origines l'API accepte.
 *
 * ============================================================== LE PROBLÈME
 *
 * `CORS_ORIGINS=http://localhost:8080` est juste sur le poste et faux partout
 * ailleurs. Ouverte depuis un téléphone du réseau — `http://192.168.1.192:8080`
 * — l'application est refusée par le navigateur avant même d'atteindre l'API.
 *
 * Élargir la liste à la main ne tient pas : l'adresse change de réseau en
 * réseau, et personne ne pense à la remettre.
 *
 * ================================================================ LA RÈGLE
 *
 * Les origines déclarées sont toujours acceptées. EN DÉVELOPPEMENT SEULEMENT,
 * on accepte en plus une origine dont l'hôte est une adresse de réseau privé
 * — celles qui ne sortent jamais d'un local : 10.x, 172.16-31.x, 192.168.x,
 * la boucle locale, et les noms en `.local`.
 *
 * ====================================================== POURQUOI PAS UN JOKER
 *
 * Parce que la session voyage en cookie. Un `*` avec `credentials` est refusé
 * par les navigateurs, et refléter aveuglément l'origine reçue reviendrait à
 * n'avoir aucune restriction : n'importe quel site pourrait faire agir le
 * navigateur d'un client authentifié sur son propre dossier.
 *
 * Une adresse privée, elle, désigne une machine du même local. Ce n'est pas
 * une garantie d'identité — mais c'est une frontière réelle, et elle disparaît
 * entièrement en production.
 */

/** Les noms qui désignent la machine elle-même. */
const BOUCLE = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Une adresse qui ne sort pas du réseau local.
 *
 * RFC 1918 pour IPv4, plus la boucle et les noms mDNS. Un hôte public — un
 * domaine, une IP routable — n'y entre jamais.
 */
export function estReseauPrive(hote: string): boolean {
  const h = hote.toLowerCase().replace(/^\[|\]$/g, "");
  if (BOUCLE.has(h)) return true;
  if (h.endsWith(".local")) return true;
  // IPv6 unique-local (fc00::/7) et lien-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254.x : lien-local, attribué quand aucun DHCP ne répond.
  if (a === 169 && b === 254) return true;
  return false;
}

export function origineAutorisee(
  origine: string | undefined,
  declarees: readonly string[],
  production: boolean,
): boolean {
  // Sans origine — un appel serveur à serveur, ou `curl` — il n'y a pas de
  // navigateur à protéger : le CORS ne s'applique pas.
  if (!origine) return true;

  const propres = declarees.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  if (propres.includes(origine.replace(/\/+$/, ""))) return true;

  // En production, ce qui est déclaré fait foi, sans exception.
  if (production) return false;

  try {
    return estReseauPrive(new URL(origine).hostname);
  } catch {
    return false;
  }
}
