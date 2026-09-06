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
