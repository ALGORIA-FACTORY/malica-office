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

test("une panne du portefeuille ne devient pas un mandat vide et la relance retrouve les dossiers", async ({
  page,
}) => {
  let panne = true;
  await page.route("**/rpc", async (route) => {
    const appel = route.request().postDataJSON() as { depot?: string; methode?: string };
    if (panne && appel.depot === "supervision" && appel.methode === "listClients") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ erreur: "Portefeuille temporairement indisponible" }),
      });
    } else await route.continue();
  });
  await page.goto("/cabinet/clients");
  const alerte = page
    .getByRole("alert")
    .filter({ hasText: "Portefeuille temporairement indisponible" });
  await expect(alerte).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Aucun mandat actif.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Mandats actifs", { exact: true })).toHaveCount(0);
  panne = false;
  await alerte.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByText(/SOTUMAG/).first()).toBeVisible();
  await expect(alerte).toHaveCount(0);
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
    test(`comptabilité ${chemin} reste accessible à ${largeur} px`, async ({ page }, testInfo) => {
      const plantages: string[] = [];
      page.on("pageerror", (e) => plantages.push(e.message));
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`/cabinet/${chemin}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/cabinet/${chemin}$`));
      const debordement = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(debordement).toBeLessThanOrEqual(1);
      expect(plantages).toEqual([]);
      await testInfo.attach(`comptabilite-${chemin}-${largeur}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
}
