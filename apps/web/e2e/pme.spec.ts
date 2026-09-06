/**
 * Le dirigeant, sur son téléphone, en français.
 *
 * Le parcours de base : arriver sur son accueil, refermer Regalica à la
 * première visite, aller à son espace et à ses pièces, en ouvrir une,
 * signaler un problème depuis les réglages. Ce que la caméra fait n'est pas
 * ici (protocole d'appareil) ; ce que la lecture par un modèle rend non plus
 * (épreuve réelle) ; le dépôt d'une pièce par l'API est dans
 * `outils/epreuve-bout-en-bout.mjs`.
 */
import { expect, test } from "@playwright/test";

import { preparerLAppareil } from "./comptes";

test.beforeEach(async ({ page }) => {
  await preparerLAppareil(page, "fr");
});

test("la session ouverte mène à l'accueil du dirigeant", async ({ page }) => {
  await page.goto("/office");
  await expect(page).toHaveURL(/\/pme$/);
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  await expect(page.getByText("Vos documents")).toBeVisible();
});

test("à la première visite, Regalica accueille, et se referme d'un geste", async ({ page }) => {
  await preparerLAppareil(page, "fr", { premiereVisite: true });
  await page.goto("/pme");
  const panneau = page.locator("div.fixed.inset-0");
  await expect(panneau.getByText(/conversation en cours/i)).toBeVisible();
  await panneau.getByRole("button", { name: "Fermer le fil de Regalica" }).click();
  await expect(page.getByText("Vos documents")).toBeVisible();
  // Et le choix tient : la page rechargée s'ouvre sur l'accueil.
  await page.reload();
  await expect(page.getByText("Vos documents")).toBeVisible();
});

test("la barre basse porte l'obturateur, l'accueil et l'espace", async ({ page }) => {
  await page.goto("/pme");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("button", { name: "Photographier" })).toBeEnabled();
  await nav.getByText("Mon espace").click();
  await expect(page).toHaveURL(/\/pme\/coffre$/);
  await nav.getByText("Accueil").click();
  await expect(page).toHaveURL(/\/pme$/);
});

test("les pièces du dossier se listent et s'ouvrent", async ({ page }) => {
  await page.goto("/pme/list");
  await expect(page.getByText("Vos documents").first()).toBeVisible();
  // Le jeu de données donne des pièces lues à SOTUMAG : la première s'ouvre.
  const piece = page.locator('a[href^="/pme/piece/"]').first();
  await expect(piece).toBeVisible();
  await piece.click();
  await expect(page).toHaveURL(/\/pme\/piece\/[0-9a-f-]{36}$/);
});

test("un signalement part depuis les réglages", async ({ page }) => {
  await page.goto("/pme/reglages");
  await expect(page.getByText("Quelque chose n'a pas marché ?")).toBeVisible();
  await page
    .getByLabel("Quelque chose n'a pas marché ?")
    .fill("Épreuve Playwright : rien à signaler.");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Reçu. Merci — on regarde.")).toBeVisible();
});
