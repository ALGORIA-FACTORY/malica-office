/**
 * Les captures d'écran du Play Store : de vraies captures, rien d'autre.
 *
 * ============================================================== POURQUOI
 *
 * Une fiche de magasin montre ce que la personne installera. Pas une
 * maquette, pas un cadre marketing : l'application qui tourne, photographiée
 * telle que le dirigeant et l'expert-comptable la voient. Quand l'écran
 * change, on relance ce script et la fiche suit.
 *
 * L'icône et la bannière ne sont pas produites ici : ce sont des fichiers
 * dessinés, versionnés dans `android/play/icone` et `android/play/feature_graphic`.
 *
 * ============================================================== COMMENT
 *
 *   node outils/captures.mjs                      sur http://localhost:8080
 *   MALICA_BASE=https://staging.malica-office.algoria-factory.com node outils/captures.mjs
 *
 * Il faut l'application vivante avec son jeu de données (`outils/jeu-de-donnees.mjs`) :
 * le script se connecte avec les comptes du jeu (un dirigeant, une experte), deux
 * connexions en tout — la limite de connexions par minute de l'API est respectée.
 *
 * Ce que produit chaque série (le dossier est vidé d'abord : une série est complète ou n'est pas) :
 *   screenshots_telephone     1080 × 1920 — le dirigeant : accueil, documents, une pièce lue,
 *                             son espace, les réglages, puis l'accueil en arabe
 *   screenshots_tablette_7    1920 × 1200 — l'experte : le cabinet, les clients, un dossier
 *   screenshots_tablette_10   2560 × 1600 — les mêmes écrans
 *
 * Le rendu passe par le Chromium de Playwright, déjà là pour les parcours e2e.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, devices } from "playwright";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(RACINE, "android/play");

const BASE = (process.env["MALICA_BASE"] ?? "http://localhost:8080").replace(/\/+$/, "");
// Les comptes de parcours : un seul fichier, lu aussi par Playwright et Maestro.
const COMPTES = JSON.parse(readFileSync(join(RACINE, "outils/comptes-de-parcours.json"), "utf8"));
const MOT_DE_PASSE = COMPTES.motDePasse;
const DIRIGEANT = COMPTES.dirigeant.email;
const EXPERT = COMPTES.expert.email;

async function seConnecter(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.getByLabel(/Adresse e-mail|Email address|البريد الإلكتروني/).fill(email);
  await page.getByLabel(/Mot de passe|Password|كلمة المرور/).fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /^(Entrer|Enter|دخول)$/ }).click();
  await page.waitForURL((u) => !/\/auth$/.test(u.pathname));
}

/** Une série de captures dans un dossier vidé d'abord. */
function serie(dossier, echelle) {
  const chemin = join(PLAY, dossier);
  rmSync(chemin, { recursive: true, force: true });
  mkdirSync(chemin, { recursive: true });
  let n = 0;
  return async (page, nom) => {
    n += 1;
    const { width, height } = page.viewportSize();
    const fichier = join(
      chemin,
      `${String(n).padStart(2, "0")}_${nom}_${width * echelle}x${height * echelle}.png`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: fichier, type: "png" });
    console.log("  écrit", fichier.slice(RACINE.length + 1));
  };
}

async function contexte(navigateur, { largeur, hauteur, echelle, mobile, locale, etat }) {
  const ctx = await navigateur.newContext({
    ...(mobile ? devices["Pixel 7"] : devices["Desktop Chrome"]),
    viewport: { width: largeur, height: hauteur },
    deviceScaleFactor: echelle,
    locale: locale === "ar" ? "ar-TN" : "fr-FR",
    ignoreHTTPSErrors: true,
    storageState: etat,
  });
  // Le fil de Malica ne s'ouvre pas tout seul : la personne l'a déjà vu.
  await ctx.addInitScript((l) => {
    window.localStorage.setItem("malica.locale", l);
    window.localStorage.setItem("malica.panneau.ouvert.pme", "0");
  }, locale);
  return ctx;
}

async function capturer(navigateur) {
  console.log(`Les captures, sur ${BASE}`);
  const sessions = {};
  for (const [nom, email] of [
    ["dirigeant", DIRIGEANT],
    ["expert", EXPERT],
  ]) {
    const ctx = await navigateur.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await seConnecter(page, email);
    sessions[nom] = await ctx.storageState();
    await ctx.close();
  }

  // Le téléphone : 1080 × 1920, le dirigeant, en français puis en arabe.
  const tel = await contexte(navigateur, {
    largeur: 360,
    hauteur: 640,
    echelle: 3,
    mobile: true,
    locale: "fr",
    etat: sessions.dirigeant,
  });
  let page = await tel.newPage();
  let capture = serie("screenshots_telephone", 3);
  await page.goto(`${BASE}/pme`, { waitUntil: "networkidle" });
  await capture(page, "accueil");
  await page.goto(`${BASE}/pme/list`, { waitUntil: "networkidle" });
  await capture(page, "documents");
  // Une pièce lue, pas une pièce illisible : ce que l'écran a de mieux à montrer.
  const piece = page
    .locator('a[href^="/pme/piece/"]')
    .filter({ hasNotText: /Pas encore lue|non trouvé/ })
    .first();
  await piece.waitFor();
  await piece.click();
  await page.waitForURL(/\/pme\/piece\//);
  await page.waitForLoadState("networkidle");
  await capture(page, "piece");
  await page.goto(`${BASE}/pme/coffre`, { waitUntil: "networkidle" });
  await capture(page, "espace");
  await page.goto(`${BASE}/pme/reglages`, { waitUntil: "networkidle" });
  await capture(page, "reglages");
  await tel.close();

  const telAr = await contexte(navigateur, {
    largeur: 360,
    hauteur: 640,
    echelle: 3,
    mobile: true,
    locale: "ar",
    etat: sessions.dirigeant,
  });
  page = await telAr.newPage();
  await page.goto(`${BASE}/pme`, { waitUntil: "networkidle" });
  await capture(page, "accueil-arabe");
  await telAr.close();

  // Les tablettes, en paysage : le cabinet de l'experte-comptable.
  for (const [dossier, largeur, hauteur] of [
    ["screenshots_tablette_7", 960, 600],
    ["screenshots_tablette_10", 1280, 800],
  ]) {
    const tab = await contexte(navigateur, {
      largeur,
      hauteur,
      echelle: 2,
      mobile: false,
      locale: "fr",
      etat: sessions.expert,
    });
    page = await tab.newPage();
    capture = serie(dossier, 2);
    await page.goto(`${BASE}/cabinet`, { waitUntil: "networkidle" });
    await capture(page, "cabinet");
    await page.goto(`${BASE}/cabinet/clients`, { waitUntil: "networkidle" });
    await capture(page, "clients");
    const client = page.getByText(/SOTUMAG/).first();
    await client.waitFor();
    await client.click();
    await page.waitForURL(/\/cabinet\/(dossier|clients)\//);
    await page.waitForLoadState("networkidle");
    await capture(page, "dossier");
    await tab.close();
  }
}

const navigateur = await chromium.launch();
try {
  await capturer(navigateur);
} finally {
  await navigateur.close();
}
console.log("terminé");
