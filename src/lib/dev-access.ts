/**
 * Jeu de démonstration local — désactivé par défaut.
 *
 * Les données réelles (tenants, pièces, citations, écritures) vivent en base.
 * Le jeu de démonstration n'est donc jamais choisi implicitement : il faut le
 * demander avec `?demo=1` en développement, et `?demo=0` le quitte.
 * En production publiée, il est inaccessible.
 */
const FLAG = "regalica.demo";

export function isRegalicaDevAccessEnabled(): boolean {
  const dev = import.meta.env.DEV || import.meta.env.MODE === "development";
  if (!dev) return false;
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("demo");
    if (param === "1") window.localStorage.setItem(FLAG, "1");
    if (param === "0") window.localStorage.removeItem(FLAG);
    return window.localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}
