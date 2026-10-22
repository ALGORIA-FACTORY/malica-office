/**
 * L'expert-comptable, sur un bureau : le cabinet s'ouvre, ses dossiers sont
 * là, un dossier client s'ouvre.
 */
import { expect, test } from "@playwright/test";

import { preparerLAppareil } from "./comptes";

test.beforeEach(async ({ page }) => {
  await preparerLAppareil(page, "fr");
});

test("la session ouverte mène au cabinet", async ({ page }) => {
  await page.goto("/office");
  await expect(page).toHaveURL(/\/cabinet/);
});

test("le cabinet liste ses dossiers et en ouvre un", async ({ page }) => {
  await page.goto("/cabinet/clients");
  await expect(page.getByText(/SOTUMAG/).first()).toBeVisible();
  await page
    .getByText(/SOTUMAG/)
    .first()
    .click();
  await expect(page).toHaveURL(/\/cabinet\/(dossier|clients)\//);
});

for (const largeur of [390, 1440]) {
  for (const chemin of [
    "clients",
    "propositions",
    "echeances",
    "notifications",
    "conseil",
    "pilotage",
    "honoraires",
    "abonnements",
    "export",
    "reglages",
    "plan",
    "rapprochement",
    "immobilisations",
    "stocks",
    "pv",
    "lecteurs",
  ]) {
    test(`comptabilité ${chemin} reste accessible à ${largeur} px`, async ({ page }) => {
      const plantages: string[] = [];
      page.on("pageerror", (e) => plantages.push(e.message));
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`/cabinet/${chemin}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/cabinet/${chemin}$`));
      const debordement = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(debordement).toBeLessThanOrEqual(1);
      expect(plantages).toEqual([]);
    });
  }
}
