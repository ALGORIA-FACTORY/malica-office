/**
 * Les Réglages sur ordinateur (maquettes NavReglages, Reglages*) : deux
 * colonnes, et le téléphone intact.
 *
 * Deux choses se vérifient sans navigateur : l'adresse accepte la page
 * « Préférences » (et rien d'inventé), et la feuille de bureau ne dessine rien
 * sous 1024 px — hors l'aiguillage qui cache ce que seul l'ordinateur montre.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  Link: () => null,
  useNavigate: () => vi.fn(),
}));

import { Route } from "../routes/_authenticated/pme.reglages";

const valider = (Route as unknown as { options: { validateSearch: (s: object) => object } }).options
  .validateSearch;

describe("l'adresse des Réglages", () => {
  it("connaît la page Préférences, à côté des trois pages de la licence", () => {
    for (const page of ["abonnement", "societes", "utilisateurs", "preferences"]) {
      expect(valider({ page })).toEqual({ page });
    }
  });

  it("ignore une page qui n'existe pas : le sommaire, pas une page vide", () => {
    expect(valider({ page: "compte" })).toEqual({});
    expect(valider({ page: "n-importe" })).toEqual({});
  });
});

describe("la feuille de bureau", () => {
  const feuille = readFileSync(path.resolve(__dirname, "../styles-pme-bureau-reglages.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

  it("ne dessine rien hors de (min-width: 1024px), sauf les groupes sans boîte et l'aiguillage", () => {
    const blocs = [...feuille.matchAll(/@media([^{]*)\{/g)].map((m) => m[1]!.trim());
    expect(blocs[0]).toBe("not all and (min-width: 1024px)");
    expect(blocs[1]).toBe("(min-width: 1024px)");

    // Ce qui précède le premier bloc : les groupes, qui ne dessinent aucune boîte.
    const avant = feuille.slice(0, feuille.indexOf("@media"));
    expect(avant.match(/\{[^}]*\}/g)).toEqual(["{ display: contents; }"]);

    // Sous 1024 px, une seule déclaration : cacher ce que seul l'ordinateur montre.
    const mobile = feuille.slice(
      feuille.indexOf("@media"),
      feuille.indexOf("@media", 1 + feuille.indexOf("@media")),
    );
    expect(mobile.match(/[a-z-]+\s*:\s*[^;{}]+;?\s*\}/g)).toEqual(["display: none !important; }"]);
  });

  it("n'écrit aucune couleur : les jetons portent le clair et le sombre", () => {
    expect(feuille).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});
