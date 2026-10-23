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

for (const largeur of [390, 1440]) {
  test(`abonnements : vues séparées et formulaire à la demande à ${largeur} px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto("/cabinet/abonnements");
    await expect(page.locator("#cab-abonnement-formulaire")).toHaveCount(0);
    await page.locator(".cab-library-header > button").click();
    await expect(page.locator("#cab-abonnement-formulaire")).toBeVisible();
    await page.locator(".cab-library-header > button").click();
    await expect(page.locator("#cab-abonnement-formulaire")).toHaveCount(0);
    const vues = page.locator(".cab-view-switch button");
    await vues.nth(1).click();
    await expect(vues.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".cab-library-search")).toHaveCount(0);
    await vues.nth(0).click();
    await expect(page.locator(".cab-library-search")).toBeVisible();
    await page.addStyleTag({
      content:
        "[data-repere] { outline: 2px solid #7754c4; position: relative; } [data-repere]::after { content: attr(data-repere); position: absolute; top: -10px; right: 8px; background: #7754c4; color: white; padding: 2px 8px; border-radius: 20px; font: 12px sans-serif; z-index: 5; }",
    });
    await page.locator(".cab-summary-grid").evaluate((el) => {
      el.setAttribute("data-repere", "1 · Vue rapide");
    });
    await page.locator(".cab-library-toolbar").evaluate((el) => {
      el.setAttribute("data-repere", "2 · Clients / factures / recherche");
    });
    await testInfo.attach(`abonnements-annote-${largeur}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test(`statistiques : vue accessible à ${largeur} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto("/cabinet/pilotage");
    const statistiques = page.locator(".cab-view-switch button").last();
    await statistiques.click();
    await expect(statistiques).toHaveAttribute("aria-pressed", "true");
    await testInfo.attach(`statistiques-${largeur}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement).toBeLessThanOrEqual(1);
  });
}

test("invitation : accès direct et adresse invalide refusée sans envoi", async ({ page }) => {
  const envois: string[] = [];
  page.on("request", (requete) => {
    if (!requete.url().endsWith("/rpc") || requete.method() !== "POST") return;
    const appel = requete.postDataJSON() as { depot?: string; methode?: string };
    if (appel.depot === "collab" && appel.methode === "inviter") envois.push(requete.url());
  });
  await page.goto("/cabinet/mise-en-route?etape=2");
  const adresse = page.locator("#cab-inviter-equipe input[type=email]");
  await expect(adresse).toBeVisible();
  await adresse.fill("adresse-invalide");
  await page.locator('button[form="cab-inviter-equipe"]').click();
  expect(await adresse.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  expect(envois).toEqual([]);
});
