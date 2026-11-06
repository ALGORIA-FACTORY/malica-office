/**
 * Le Caddyfile route vers l'API exactement les chemins que le relais de
 * développement (`apps/web/relais-api.ts`) lui donne. Deux listes, un seul
 * sens : si l'une bouge sans l'autre, une route marche sur le poste et pas en
 * production — ce test le dit avant.
 *
 *   node --test infra/caddy/Caddyfile.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const RACINE = new URL("../../", import.meta.url);
const relais = readFileSync(new URL("apps/web/relais-api.ts", RACINE), "utf8");
const caddyfile = readFileSync(new URL("infra/caddy/Caddyfile", RACINE), "utf8");

/** Les entrées `{ base, exact }` du relais, lues telles qu'écrites. */
function cheminsDuRelais() {
  const bloc = /const CHEMINS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(relais);
  assert.ok(bloc, "CHEMINS introuvable dans relais-api.ts");
  const entrees = [...bloc[1].matchAll(/base:\s*"([^"]+)",\s*exact:\s*(true|false)/g)];
  assert.ok(entrees.length > 0, "aucune entrée lue dans CHEMINS");
  return entrees.map(([, base, exact]) => ({ base, exact: exact === "true" }));
}

/** Ce que le relais envoie à l'API : les sous-chemins toujours, le chemin nu si exact. */
function attendus() {
  return new Set(
    cheminsDuRelais().flatMap(({ base, exact }) => (exact ? [base, `${base}/*`] : [`${base}/*`])),
  );
}

/** Les chemins du matcher `@api` du Caddyfile. */
function cheminsDuCaddyfile() {
  const bloc = /@api\s*\{([\s\S]*?)\}/.exec(caddyfile);
  assert.ok(bloc, "matcher @api introuvable dans le Caddyfile");
  return new Set(
    bloc[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("path "))
      .flatMap((l) => l.slice("path ".length).trim().split(/\s+/)),
  );
}

test("le Caddyfile route vers l'API les mêmes chemins que le relais de développement", () => {
  const relaisSet = attendus();
  const caddySet = cheminsDuCaddyfile();
  const manquants = [...relaisSet].filter((c) => !caddySet.has(c));
  const enTrop = [...caddySet].filter((c) => !relaisSet.has(c));
  assert.deepEqual(
    { manquants, enTrop },
    { manquants: [], enTrop: [] },
    "relais-api.ts et infra/caddy/Caddyfile divergent",
  );
});

/*
 * Audit de sécurité du 6 novembre 2026, constats S1 et S12
 * (`docs/audit-2026-11-06/securite.md`) : `/exports/:id/contenu` partait au
 * serveur web, et la CSP de Caddy, posée sur toute réponse, aurait écrasé la
 * CSP `sandbox` que l'API pose sur les octets d'une pièce ou d'un export.
 */
test("les exports gardés vont à l'API (S12)", () => {
  assert.ok(cheminsDuCaddyfile().has("/exports/*"));
});

test("la CSP du site est un défaut : elle n'écrase pas celle que l'API pose (S1)", () => {
  const bloc = /\n\theader\s*\{([\s\S]*?)\n\t\}/.exec(caddyfile);
  assert.ok(bloc, "bloc header introuvable dans le Caddyfile");
  const csp = bloc[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[?+]?Content-Security-Policy\b/.test(l));
  assert.equal(csp.length, 1, "une seule ligne Content-Security-Policy");
  assert.ok(
    csp[0].startsWith("?Content-Security-Policy "),
    "« ?Content-Security-Policy » : posée seulement si l'API n'en a pas posé",
  );
});

test("l'écran de connexion /auth reste au site, ses sous-chemins vont à l'API", () => {
  const caddySet = cheminsDuCaddyfile();
  assert.ok(caddySet.has("/auth/*"));
  assert.ok(!caddySet.has("/auth"));
});
