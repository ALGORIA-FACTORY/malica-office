// @vitest-environment node
/**
 * La page d'erreur du serveur parle la langue de la personne, porte la marque,
 * et ne dit rien de technique (audit du 6 novembre 2026, web constat 2 : elle
 * était en anglais seul, en `system-ui`, grise et arrondie).
 */
import { describe, expect, it } from "vitest";

import { referenceDePanne, renderErrorPage, SECOURS } from "../error-page";

describe("la page d'erreur du serveur", () => {
  const page = renderErrorPage("7F3A21C9");

  it("dit les trois langues de l'écran de secours, le français par défaut", () => {
    for (const langue of ["fr", "en", "ar"] as const) {
      expect(page).toContain(SECOURS[langue].titre.replace(/'/g, "&#39;"));
    }
    expect(page).toMatch(/data-langue="fr">/);
    expect(page).toMatch(/lang="ar" dir="rtl" data-langue="ar" hidden>/);
    expect(page).not.toContain("This page didn't load");
  });

  it("cite la référence que le serveur a inscrite, et rien d'autre", () => {
    expect(page.match(/7F3A21C9/g)).toHaveLength(3);
    expect(referenceDePanne()).toMatch(/^[0-9A-F]{8}$/);
  });

  it("ne porte que les couleurs et les polices de la marque", () => {
    const couleurs = new Set(page.match(/#[0-9A-Fa-f]{3,6}\b/g)?.map((c) => c.toUpperCase()));
    expect([...couleurs].sort()).toEqual(["#0A0A0A", "#FAFAFA"]);
    expect(page).not.toContain("system-ui");
    expect(page).toContain("Inter");
    expect(page).toContain('"IBM Plex Mono"');
    expect(page).not.toMatch(/border-radius:\s*0\.\d/);
  });
});
