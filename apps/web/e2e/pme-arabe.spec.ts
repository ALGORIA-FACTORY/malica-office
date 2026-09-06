/**
 * Le dirigeant, en arabe : tout en miroir, la police de l'application, les
 * montants en chiffres latins.
 */
import { expect, test } from "@playwright/test";

import { preparerLAppareil } from "./comptes";

test.beforeEach(async ({ page }) => {
  await preparerLAppareil(page, "ar");
});

test("l'application se tient de droite à gauche, en arabe", async ({ page }) => {
  await page.goto("/pme");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByText("وثائقك")).toBeVisible();
});

test("la police arabe est celle de l'application, et les chiffres restent latins", async ({
  page,
}) => {
  await page.goto("/pme");
  await expect(page.getByText("وثائقك")).toBeVisible();
  const police = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(police).toMatch(/Noto Kufi Arabic/);
  // Aucun chiffre arabe-indien (٠–٩) sur l'accueil : les montants s'alignent avec le cabinet.
  const texte = await page.locator("main").innerText();
  expect(texte).not.toMatch(/[٠-٩]/);
});

test("les réglages disent la langue, et permettent d'en changer", async ({ page }) => {
  await page.goto("/pme/reglages");
  await expect(page.getByText("الإعدادات", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Français" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText("Réglages", { exact: true })).toBeVisible();
});
