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
import { randomUUID } from "node:crypto";

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
  await expect(nav.getByRole("button", { name: "Ajouter une pièce" })).toBeEnabled();
  await nav.getByText("Mon espace").click();
  await expect(page).toHaveURL(/\/pme\/coffre$/);
  await nav.getByText("Accueil").click();
  await expect(page).toHaveURL(/\/pme$/);
});

test("ajouter une pièce donne accès aux trois sources sans ouvrir la caméra", async ({
  page,
}, testInfo) => {
  await page.goto("/pme");
  await page.getByRole("button", { name: "Ajouter une pièce", exact: true }).click();
  await expect(page).toHaveURL(/\/pme\/capturer$/);
  await expect(page.getByRole("button", { name: "Photographier", exact: true })).toBeEnabled();
  for (const nom of ["Photographier", "Importer des images", "Importer des PDF"])
    await expect(page.getByRole("button", { name: nom, exact: true })).toBeInViewport();
  await testInfo.attach("ajout-trois-sources", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const images = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer des images", exact: true }).click();
  const galerie = await images;
  expect(galerie.isMultiple()).toBe(true);
  expect(await galerie.element().getAttribute("accept")).toBe("image/*");
  expect(await galerie.element().getAttribute("capture")).toBeNull();
  await galerie.setFiles([]);

  const pdfs = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer des PDF", exact: true }).click();
  const pdf = await pdfs;
  expect(pdf.isMultiple()).toBe(true);
  expect(await pdf.element().getAttribute("accept")).toBe("application/pdf");
  await pdf.setFiles([]);
  await expect(page.getByRole("button", { name: "Photographier", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Revenir", exact: true }).click();
  await expect(page).toHaveURL(/\/pme$/);
});

test("un faux PDF est refusé depuis le parcours d'ajout avant tout dépôt", async ({ page }) => {
  await page.goto("/pme");
  await page.getByRole("button", { name: "Ajouter une pièce", exact: true }).click();
  const attente = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer des PDF", exact: true }).click();
  const selecteur = await attente;
  await selecteur.setFiles({
    name: "document-invalide.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("Ceci n'est pas un PDF."),
  });
  await expect(page.getByRole("alert")).toContainText("Ce fichier n'est pas un PDF");
  await expect(page).toHaveURL(/\/pme\/capturer$/);
  await expect(page.getByRole("button", { name: "Importer des PDF", exact: true })).toBeEnabled();
});

/** Un vrai PDF texte, sans appel modèle ni interception de l'application. */
function pdfDeRecette(texte: string): Buffer {
  const flux = `BT /F1 12 Tf 40 780 Td (${texte}) Tj ET`;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(flux)} >>\nstream\n${flux}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const positions = [0];
  objets.forEach((objet, i) => {
    positions.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objet}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${positions.length}\n0000000000 65535 f \n`;
  for (const position of positions.slice(1))
    pdf += `${String(position).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${positions.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("deux PDF se déposent réellement et un nouvel ajout quitte l'étape précédente", async ({
  page,
}) => {
  await page.goto("/pme");
  const ajouter = page.getByRole("button", { name: "Ajouter une pièce", exact: true });
  await ajouter.click();
  const attente = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importer des PDF", exact: true }).click();
  const selecteur = await attente;
  const passage = randomUUID();
  await selecteur.setFiles(
    [1, 2].map((n) => ({
      name: `recette-import-${n}.pdf`,
      mimeType: "application/pdf",
      buffer: pdfDeRecette(`Recette import ${passage} document ${n}`),
    })),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Je ne sais pas — lis-le quand même" })
    .click();
  await expect(page).toHaveURL(/\/pme\/capturer\?pieces=/);
  const ids = new URL(page.url()).searchParams.get("pieces")!.split(",");
  expect(new Set(ids).size).toBe(2);
  await expect(page.locator(".bande .vg")).toHaveCount(2);
  await page.locator('[data-ecran="capture"] .go .pr').click();
  await expect(page.getByText("Ces 2 pièces sont pour la société, ou pour vous ?")).toBeVisible();
  await ajouter.click();
  await expect(page).toHaveURL(/\/pme\/capturer$/);
  await expect(page.getByRole("button", { name: "Importer des PDF", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Photographier", exact: true })).toBeVisible();
});

for (const largeur of [390, 1440]) {
  for (const [chemin, ecran] of [
    ["list", "bibliotheque"],
    ["charges", "charges"],
    ["tva", "tva"],
    ["echeances", "echeances"],
    ["coffre", "coffre"],
    ["fiche", "fiche"],
    ["notifications", "notifications"],
    ["reglages", "parametres"],
    ["regler", "manquants"],
    ["malica", "chat"],
  ]) {
    test(`PME ${chemin} reste utilisable à ${largeur} px`, async ({ page }, testInfo) => {
      const plantages: string[] = [];
      page.on("pageerror", (e) => plantages.push(e.message));
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`/pme/${chemin}`);
      await expect(page.locator(`[data-ecran="${ecran}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/pme/${chemin}$`));
      await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
      const debordement = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(debordement).toBeLessThanOrEqual(1);
      expect(plantages).toEqual([]);
      await testInfo.attach(`pme-${chemin}-${largeur}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
}

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
    await expect(nav.getByRole("button", { name: "Ajouter une pièce" })).toBeEnabled();
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
