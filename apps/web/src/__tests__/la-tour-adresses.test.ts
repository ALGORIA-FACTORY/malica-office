/**
 * Les adresses de la tour (2 novembre 2026) : la tour s'ouvre sur ses cabinets, une section inconnue ne
 * rend jamais une page vide — et le menu porte, dans l'ordre, ce que la
 * maquette nomme. Le dictionnaire dit chaque libellé de la tour en fr, en, ar.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { ar } from "@malica/socle/messages-ar";
import { en } from "@malica/socle/messages-en";
import { fr } from "@malica/socle/messages-fr";

vi.mock("@/verticals/malica-office/composition", () => ({ office: () => ({}) }));

import { entreeActive, MENU, SECTIONS } from "../components/malica/tour/sections";
import { Route as Section } from "../routes/_authenticated/tour.$section";
import { Route as Accueil } from "../routes/_authenticated/tour.index";

type AvantChargement = (ctx: { params?: Record<string, string> }) => void;
const avant = (r: unknown) =>
  (r as { options: { beforeLoad: AvantChargement } }).options.beforeLoad;

/** L'adresse vers laquelle `beforeLoad` redirige, ou `null` s'il laisse passer. */
function cible(f: AvantChargement, params?: Record<string, string>): string | null {
  try {
    f({ params: params ?? {} });
    return null;
  } catch (e) {
    if (!isRedirect(e)) throw e;
    return String(e.options.to);
  }
}

describe("les adresses de la tour", () => {
  it("l'ancienne adresse /cabinet/tour n'existe plus (4 novembre 2026)", () => {
    const routes = readdirSync(join(__dirname, "../routes/_authenticated"));
    expect(routes.filter((f) => f.startsWith("cabinet.tour"))).toEqual([]);
  });

  it("/tour s'ouvre sur les cabinets", () => {
    expect(cible(avant(Accueil))).toBe("/tour/cabinets");
  });

  it("une section connue s'ouvre, une inconnue ramène aux cabinets", () => {
    for (const s of Object.keys(SECTIONS)) expect(cible(avant(Section), { section: s })).toBeNull();
    expect(cible(avant(Section), { section: "constructor" })).toBe("/tour/cabinets");
    expect(cible(avant(Section), { section: "inconnue" })).toBe("/tour/cabinets");
  });

  it("le menu porte les trois groupes de la maquette, dans l'ordre", () => {
    expect(MENU.map((g) => [g.cle, g.entrees.map((e) => e.cle)])).toEqual([
      ["clients", ["cabinets", "pme"]],
      [
        "plateforme",
        ["grille", "paiement", "emetteur", "facturation", "relances", "calendrier", "licences"],
      ],
      ["lecture", ["nuit", "modeles", "compte"]],
    ]);
  });

  it("l'entrée active suit l'adresse, fiche d'un cabinet comprise", () => {
    expect(entreeActive("/tour/cabinets")?.entree.cle).toBe("cabinets");
    expect(entreeActive("/tour/cabinets/abc")?.entree.cle).toBe("cabinets");
    expect(entreeActive("/tour/pme")?.entree.cle).toBe("pme");
    expect(entreeActive("/tour/nuit")?.entree.cle).toBe("nuit");
    expect(entreeActive("/tour/nuitee")).toBeNull();
  });
});

describe("la tour parle trois langues", () => {
  it("chaque clé « tour.* » est dite en fr, en et ar, jamais vide", () => {
    const cles = Object.keys(fr).filter((k) => k.startsWith("tour."));
    expect(cles.length).toBeGreaterThan(100);
    const manques = cles.filter(
      (k) =>
        !(en as Record<string, string>)[k]?.trim() || !(ar as Record<string, string>)[k]?.trim(),
    );
    expect(manques).toEqual([]);
  });

  it("l'arabe ne recopie pas le français sur les libellés du menu et des états", () => {
    const cles = [
      ...MENU.flatMap((g) => [g.libelle, ...g.entrees.map((e) => e.libelle)]),
      "tour.etat.paye",
      "tour.etat.impaye",
      "tour.etat.suspendu",
      "tour.etat.a_echoir",
    ] as const;
    const recopies = cles.filter((k) => ar[k] === fr[k]);
    expect(recopies).toEqual([]);
  });
});

describe("la tour se lit de droite à gauche", () => {
  /*
   * L'arabe retourne la page par `dir="rtl"` : un écran qui écrit `left`,
   * `ml-`, `pr-` ou `text-right` ne se retourne pas. Les écrans de la tour
   * n'emploient que des propriétés LOGIQUES (`start`, `end`, `ms-`, `pe-`…).
   */
  it("aucune propriété physique de gauche ou de droite dans les écrans de la tour", () => {
    const racine = join(__dirname, "..");
    const fichiers = [
      ...readdirSync(join(racine, "components/malica/tour")).map((f) =>
        join(racine, "components/malica/tour", f),
      ),
      ...readdirSync(join(racine, "routes/_authenticated"))
        .filter((f) => f.startsWith("tour"))
        .map((f) => join(racine, "routes/_authenticated", f)),
    ].filter((f) => /\.tsx?$/.test(f));
    expect(fichiers.length).toBeGreaterThan(10);
    const PHYSIQUE =
      /(?<![\w-])(?:-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](?:-|\b)|rounded-[lr]-)/;
    const fautes = fichiers.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => /className=|cn\(|"[^"]*"/.test(l) && PHYSIQUE.test(l))
        .map((l) => `${f.slice(racine.length)} : ${l.trim()}`),
    );
    expect(fautes).toEqual([]);
  });
});
