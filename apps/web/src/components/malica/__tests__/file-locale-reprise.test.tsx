/**
 * Une photo reprise hors ligne, refusée au retour du réseau : l'ancienne a été
 * remplacée, inscrite ou retirée entre-temps. La photo ne se perd pas — elle
 * se garde comme une pièce à part, ou remplace la version actuelle.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ElementDeFile } from "@/lib/hors-ligne/file";

const etat = vi.hoisted(() => ({ elements: [] as unknown[] }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => createElement("a", null, children as never),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    file: { elements: etat.elements, reessayer: vi.fn(), abandonner: vi.fn(), recibler: vi.fn() },
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({ office: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { FileLocale } from "@/components/malica/file-locale";

function refusee(derniereErreur: string, remplace: string | null = "A"): ElementDeFile {
  return {
    cle: `k-${derniereErreur}`,
    tenantId: "t",
    entityId: null,
    source: "photo",
    vis: "partage",
    contentType: "image/jpeg",
    remplace,
    nomFichier: "photo.jpg",
    taille: 1000,
    creeLe: "2026-10-29T08:00:00.000Z",
    etat: "echec_definitif",
    pieceId: null,
    tentatives: 0,
    prochainEssaiLe: null,
    derniereErreur,
  };
}

const rendre = () => renderToStaticMarkup(createElement(FileLocale, {}));

describe("une reprise refusée dans la file", () => {
  beforeEach(() => {
    etat.elements = [];
  });

  it("l'ancienne déjà remplacée : garder à part (d'abord), ou remplacer la version actuelle", () => {
    etat.elements = [refusee("refus.piece.remplacee")];
    const html = rendre();
    expect(html).toContain("pme.file.reprise.libre");
    expect(html).toContain("pme.file.reprise.courante");
    expect(html.indexOf("pme.file.reprise.libre")).toBeLessThan(
      html.indexOf("pme.file.reprise.courante"),
    );
    // Le code brut ne s'affiche pas : l'état se dit, l'explication est derrière ⓘ.
    expect(html).toContain("pme.file.reprise.etat");
    expect(html).not.toContain("refus.piece.remplacee");
  });

  it("l'ancienne inscrite ou retirée : seulement la garder à part", () => {
    for (const code of ["refus.remplacement.inscrite", "refus.remplacement.introuvable"]) {
      etat.elements = [refusee(code)];
      const html = rendre();
      expect(html).toContain("pme.file.reprise.libre");
      expect(html).not.toContain("pme.file.reprise.courante");
    }
  });

  it("un autre refus garde ses deux gestes d'avant", () => {
    etat.elements = [refusee("pièce trop volumineuse", null)];
    const html = rendre();
    expect(html).toContain("pme.file.reessayer");
    expect(html).not.toContain("pme.file.reprise.libre");
  });
});
