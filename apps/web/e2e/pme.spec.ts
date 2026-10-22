/**
 * Le dirigeant, sur son téléphone, en français.
 *
 * Le parcours de base : arriver sur son accueil, aller à la conversation avec
 * Malica et en revenir, aller à son espace et à ses pièces, en ouvrir une,
 * signaler un problème depuis les réglages. Ce que la caméra fait n'est pas ici
 * (protocole d'appareil) ; ce que la lecture par un modèle rend non plus
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

test("depuis l'accueil, la barre de demande mène à la conversation, et on en revient", async ({
  page,
}) => {
  /*
   * ======================================= CE QUE CETTE ÉPREUVE REMPLACE, ET POURQUOI
   *
   * Elle cherchait un panneau flottant — `div.fixed.inset-0` — ouvert à la
   * toute première visite par-dessus l'accueil, et le refermait par son bouton
   * « Fermer le fil de Malica ». Ce panneau a été retiré de la surface PME : la
   * barre de demande de l'accueil NAVIGUE maintenant vers `/pme/malica`, qui
   * est un écran à part entière. L'épreuve décrivait donc un comportement qui
   * n'existe plus, et elle échouait en CI sur un localisateur qui ne trouvait
   * rien. Le panneau, lui, vit toujours — mais sur la surface CABINET, et
   * « Fermer le fil de Malica » ne se dit plus que là-bas.
   *
   * Le RECHARGEMENT est gardé, avec un autre objet. Il vérifiait que le
   * congédiement du panneau tenait, ce qui n'a plus de sens : il n'y a plus de
   * congédiement à ranger. Il vérifie maintenant que l'ADRESSE tient — c'est
   * exactement ce qu'un écran apporte et qu'un panneau n'apportait pas : on
   * peut y revenir, la partager, l'ouvrir d'un lien.
   */
  await page.goto("/pme");

  // Le micro de la barre de demande porte le nom accessible ; la barre
  // entière reste cliquable au doigt.
  await page.getByRole("button", { name: "Parler à Malica" }).click();
  await expect(page).toHaveURL(/\/pme\/malica$/);

  // L'écran du dessin : son composeur, et le pied qui dit ce que Malica ne
  // tranche pas à la place de l'expert-comptable.
  await expect(page.getByLabel(/Écrivez à Malica/)).toBeVisible();
  await expect(
    page.getByText(/Je ne tranche pas à la place de votre expert-comptable/),
  ).toBeVisible();

  // L'adresse tient au rechargement.
  await page.reload();
  await expect(page).toHaveURL(/\/pme\/malica$/);
  await expect(page.getByLabel(/Écrivez à Malica/)).toBeVisible();

  // Et on en revient par la barre du bas, qui reste rendue sur cet écran.
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await nav.getByText("Accueil").click();
  await expect(page).toHaveURL(/\/pme$/);
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
  /*
   * ============================================ CE QUE CETTE ÉPREUVE GARANTIT
   *
   * Qu'une pièce du dossier s'atteint depuis la bibliothèque, et qu'elle
   * s'ouvre sur sa propre adresse. C'est cela qui ne doit jamais casser.
   *
   * Le CHEMIN pour y arriver, lui, a changé le 18 octobre : la bibliothèque
   * porte désormais les quatre axes de la livraison — mois, dossier, tiers,
   * type d'opération — et les pièces vivent dans un groupe qu'on ouvre. Cette
   * épreuve cherchait un lien dès l'arrivée et ne trouvait plus rien.
   *
   * Elle est donc mise à jour, et non assouplie : elle ouvre un groupe, puis
   * exige toujours qu'une pièce s'ouvre. Constaté au rendu avant d'être écrit —
   * l'écran a raison, c'était l'épreuve qui était périmée.
   */
  await page.goto("/pme/list");
  await expect(page.getByText("Vos documents").first()).toBeVisible();

  // Un groupe au moins existe : le jeu de données donne des pièces à SOTUMAG.
  const groupe = page.locator("button.grp").first();
  await expect(groupe).toBeVisible();
  await groupe.click();

  // Et dedans, la première pièce s'ouvre.
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

test("le même accueil utilise le desktop et conserve la navigation du téléphone", async ({
  page,
}) => {
  for (const largeur of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto("/pme");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(page.getByText("Vos documents")).toBeVisible();
    await expect(nav.getByRole("button", { name: "Photographier" })).toBeEnabled();
    const dimensions = await page.locator("main").evaluate((element) => ({
      contenu: element.getBoundingClientRect().width,
      page: document.documentElement.scrollWidth,
      fenetre: window.innerWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.fenetre + 1);
    if (largeur >= 1024) {
      expect(dimensions.contenu).toBeGreaterThan(largeur * 0.65);
      await expect(nav.getByRole("link", { name: "Mes pièces", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Échéances", exact: true })).toBeVisible();
    } else {
      await expect(nav.getByRole("link", { name: "Mes pièces", exact: true })).toBeHidden();
    }
  }
});
