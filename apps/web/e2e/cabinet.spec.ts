/**
 * L'expert-comptable, sur un bureau : le cabinet s'ouvre, ses dossiers sont
 * là, un dossier client s'ouvre.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { DIRIGEANT, ETAT_DIRIGEANT, preparerLAppareil } from "./comptes";

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
  // Une panne (5xx) part au journal : l'écran dit sa phrase et offre la
  // relance, jamais le texte brut du serveur (27 octobre 2026).
  const alerte = page
    .getByRole("alert")
    .filter({ has: page.getByRole("button", { name: "Réessayer", exact: true }) });
  await expect(alerte).toBeVisible({ timeout: 20_000 });
  await expect(alerte).not.toContainText("Portefeuille temporairement indisponible");
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
    "bibliotheque",
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
      if (chemin === "pilotage") {
        await expect(page.locator('.cab-rail a[aria-current="page"]')).toHaveCount(1);
        await expect(page.locator('.cab-rail a[aria-current="page"]')).toHaveText("Pilotage");
      }
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

/*
 * Réglages comptabilité (décisions du CEO du 31 octobre 2026) : douze sujets,
 * chacun arrêtable pour le cabinet, à 390 px, en français et en arabe (RTL),
 * des boutons de 48 px, et le ⓘ qui dit l'INCERTAIN.
 */
for (const [locale, onglet, pourLeCabinet, incertain] of [
  ["fr", "Comptabilité", "Pour tout le cabinet", "INCERTAIN"],
  ["ar", "المحاسبة", "لكامل المكتب", "غير مؤكد"],
] as const) {
  test(`réglages comptabilité : douze sujets à 390 px, en ${locale}`, async ({ page }) => {
    const plantages: string[] = [];
    page.on("pageerror", (e) => plantages.push(e.message));
    await preparerLAppareil(page, locale);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/cabinet/reglages");
    await page.getByRole("button", { name: onglet, exact: true }).click();
    const boutons = page.getByRole("button", { name: pourLeCabinet, exact: true });
    await expect(boutons).toHaveCount(12, { timeout: 20_000 });
    const hauteur = (await boutons.first().boundingBox())?.height ?? 0;
    expect(hauteur).toBeGreaterThanOrEqual(48);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    const premier = page.locator("li").filter({ has: boutons.first() }).first();
    await premier.getByRole("button", { name: /^(En savoir plus|اعرف المزيد) — / }).click();
    await expect(page.getByRole("dialog").getByText(incertain, { exact: true })).toBeVisible();
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement).toBeLessThanOrEqual(1);
    expect(plantages).toEqual([]);
  });
}

/**
 * La bibliothèque se range par mois, puis par type (maquette du 4 novembre
 * 2026) : on ouvre le mois le plus récent, puis son premier type, et l'on
 * revient par la flèche pour éprouver le retour.
 */
async function ouvrirLesPremieresPieces(page: Page) {
  await page.locator(".cab-doclib-carte-lien").first().click();
  await expect(page).toHaveURL(/mois=\d{4}-\d{2}/);
  await page.locator(".cab-doclib-retour").click();
  await expect(page).not.toHaveURL(/mois=/);
  await page.locator(".cab-doclib-carte-lien").first().click();
  await page.locator(".cab-doclib-carte-lien").first().click();
  await expect(page).toHaveURL(/type=/);
}

for (const largeur of [360, 390, 1440]) {
  test(`bibliothèque : mois, types et pièces lisibles à ${largeur} px`, async ({
    page,
  }, testInfo) => {
    const plantages: string[] = [];
    page.on("pageerror", (e) => plantages.push(e.message));
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto("/cabinet/bibliotheque");
    const clients = page.getByRole("combobox", { name: "Client", exact: true });
    const option = clients
      .locator("option")
      .filter({ hasText: /SOTUMAG/ })
      .first();
    await expect(option).toBeAttached();
    await clients.selectOption((await option.getAttribute("value"))!);
    for (const niveau of ["mois", "types", "pieces"]) {
      if (niveau !== "mois") await page.locator(".cab-doclib-carte-lien").first().click();
      await expect(
        page
          .locator(niveau === "pieces" ? ".cab-doclib-documents li" : ".cab-doclib-carte")
          .first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await testInfo.attach(`bibliotheque-${niveau}-${largeur}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    // Échap remonte d'un niveau, comme la flèche.
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/type=/);
    await expect(page).toHaveURL(/mois=/);
    expect(plantages).toEqual([]);
  });
}

test("la bibliothèque ouvre les documents réels et prépare une sélection", async ({ page }) => {
  await page.goto("/cabinet/bibliotheque");
  await expect(page.getByRole("heading", { name: "Bibliothèque", exact: true })).toBeVisible();
  const clients = page.getByRole("combobox", { name: "Client", exact: true });
  const option = clients
    .locator("option")
    .filter({ hasText: /SOTUMAG/ })
    .first();
  await expect(option).toBeAttached();
  const id = await option.getAttribute("value");
  expect(id).toBeTruthy();
  await clients.selectOption(id!);
  await ouvrirLesPremieresPieces(page);
  const ligne = page.locator(".cab-doclib-documents li").first();
  await expect(ligne).toBeVisible();
  await ligne.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Télécharger la sélection (1)", exact: true }).click();
  const dialogue = page.getByRole("dialog");
  await expect(dialogue).toBeVisible();
  await expect(dialogue.getByText(/Les justificatifs et documents liés/)).toBeVisible();
  await dialogue.getByRole("button", { name: "Annuler", exact: true }).last().click();
  await expect(dialogue).not.toBeVisible();
  await ligne.locator("a").first().click();
  await expect(page).toHaveURL(/\/cabinet\/piece\//);
  await page.getByRole("tab", { name: "Contrôles", exact: true }).click();
  await expect(
    page.getByText(/ne constituent pas une validation fiscale exhaustive/),
  ).toBeVisible();
});

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

test("une panne des statistiques laisse les affectations accessibles", async ({ page }) => {
  await page.route("**/rpc", async (route) => {
    const appel = route.request().postDataJSON() as { depot?: string; methode?: string };
    if (
      (appel.depot === "supervision" && appel.methode === "statistiques") ||
      (appel.depot === "collab" && appel.methode === "stats")
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ erreur: "Statistiques temporairement indisponibles" }),
      });
    } else await route.continue();
  });
  await page.goto("/cabinet/pilotage");
  await expect(page.locator("#affecter form")).toBeVisible();
  // Une panne (5xx) part au journal : l'alerte reste, sans le texte brut.
  await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert").first()).not.toContainText(
    "Statistiques temporairement indisponibles",
  );
  await expect(page.locator("#affecter select").first()).toBeEnabled();
  await expect(page.locator(".cab-summary-value").last()).toHaveText("—");
});

// Données synthétiques pour exercer le geste de qualification sans inscrire
// une écriture dans le dossier de démonstration. L'API PostgreSQL prouve les calculs.
for (const largeur of [390, 1440]) {
  test(`retenue : rien ne s'inscrit avant qualification explicite à ${largeur} px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    let qualifie = false;
    await page.route("**/rpc", async (route) => {
      const appel = route.request().postDataJSON() as {
        depot?: string;
        methode?: string;
        args?: unknown[];
      };
      if (appel.depot === "capture" && appel.methode === "paiementsDUnePiece") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            resultat: [
              {
                id: "36a5e187-5430-47a4-a75e-7ebc9ef06940",
                moyenCode: "virement",
                montantMineur: 1970000,
                devise: "TND",
                payeLe: "2026-10-13",
                justificatifPieceId: null,
                createdAt: "2026-10-13T12:00:00Z",
                reference: "ESSAI-PARTIEL",
                annulePaiementId: null,
                eteint: false,
              },
            ],
          }),
        });
      } else if (appel.depot === "office" && appel.methode === "propositionDeReglement") {
        const q = appel.args?.[1] as
          { codes?: string[]; justification?: string; baseReglee?: string } | undefined;
        qualifie = !!q;
        if (q) {
          expect(q.codes).toEqual(["RAS_MARCHES_ACQUISITIONS"]);
          expect(q.justification).toBe("Certificat synthétique RS-1, acquisition qualifiée");
          expect(q.baseReglee).toBe("2000.000");
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            resultat: {
              ok: true,
              inscrite: null,
              ttc: "2000.000",
              paye: "1970.000",
              tauxDisponibles: [
                {
                  code: "RAS_MARCHES_ACQUISITIONS",
                  libelle: "Acquisition qualifiée — taux du pack",
                  taux: "0.015",
                  famille: "ir",
                  base: "ttc",
                  seuil: "1000",
                },
              ],
              retenue: q
                ? {
                    cas: "operee",
                    code: "RAS_MARCHES_ACQUISITIONS",
                    taux: "0.015",
                    libelle: "Acquisition qualifiée",
                    montant: "30.000",
                    ttc: "2000.000",
                    retenues: [
                      {
                        code: "RAS_MARCHES_ACQUISITIONS",
                        taux: "0.015",
                        libelle: "Acquisition qualifiée",
                        famille: "ir",
                        montant: "30.000",
                      },
                    ],
                  }
                : { cas: "a_confirmer" },
              ecriture: {
                journal: "BQ",
                dateEcriture: "2026-10-13",
                devise: "TND",
                libelle: "Règlement fournisseur · ESSAI-PARTIEL",
                lignes: [
                  {
                    account_code: "401",
                    libelle: "Fournisseur",
                    debit: q ? "2000.000" : "1970.000",
                    credit: "0.000",
                  },
                  { account_code: "532", libelle: "Virement", debit: "0.000", credit: "1970.000" },
                  ...(q
                    ? [
                        {
                          account_code: "432",
                          libelle: "Retenue",
                          debit: "0.000",
                          credit: "30.000",
                        },
                      ]
                    : []),
                ],
              },
            },
          }),
        });
      } else await route.continue();
    });
    await page.goto("/cabinet/bibliotheque");
    const clients = page.getByRole("combobox", { name: "Client", exact: true });
    const option = clients
      .locator("option")
      .filter({ hasText: /SOTUMAG/ })
      .first();
    await expect(option).toBeAttached();
    await clients.selectOption((await option.getAttribute("value"))!);
    await ouvrirLesPremieresPieces(page);
    await page.locator(".cab-doclib-documents li").first().locator("a").first().click();
    const inscription = page
      .getByText("Règlement fournisseur · ESSAI-PARTIEL", { exact: true })
      .locator("..")
      .getByRole("button", { name: "Inscrire", exact: true });
    await expect(inscription).toBeDisabled();
    await page
      .getByRole("combobox", { name: "Retenue à la source", exact: true })
      .selectOption("RAS_MARCHES_ACQUISITIONS");
    await page
      .getByLabel("Certificat ou justification fiscale", { exact: true })
      .fill("Certificat synthétique RS-1, acquisition qualifiée");
    await page.getByRole("button", { name: "Vérifier l’écriture", exact: true }).click();
    await expect(inscription).toBeEnabled();
    expect(qualifie).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await testInfo.attach(`qualification-retenue-${largeur}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

/*
 * « Ce que le lecteur a lu » (lecture prouvée en observation) : la section est
 * repliée, dit qu'elle n'est qu'une observation, met l'avertissement sous son
 * champ, à 390 px, en français et en arabe (RTL), sans défilement de côté. La
 * lecture est une réponse d'essai : le jeu de données n'en inscrit aucune.
 */
for (const [locale, titre, observation, avertissement] of [
  ["fr", "Ce que le lecteur a lu", /rien n’est modifié dans la lecture retenue/, "Avertissement"],
  ["ar", "ما قرأه القارئ", /لا يتغيّر شيء في القراءة المعتمدة/, "تنبيه"],
] as const) {
  test(`ce que le lecteur a lu : observation lisible à 390 px, en ${locale}`, async ({
    page,
  }, testInfo) => {
    const plantages: string[] = [];
    page.on("pageerror", (e) => plantages.push(e.message));
    await preparerLAppareil(page, locale);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.route("**/rpc", async (route) => {
      const appel = route.request().postDataJSON() as { depot?: string; methode?: string };
      if (appel.depot === "capture" && appel.methode === "lectureObservee") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            resultat: {
              lectureId: "00000000-0000-4000-8000-000000000001",
              issue: "signalee",
              grille: { code: "facture", libelle: "Facture" },
              le: "2026-11-01T10:00:00.000Z",
              champs: [
                {
                  code: "matricule_fiscal_emetteur",
                  libelle: "Matricule fiscal de l'émetteur",
                  role: { code: "fournisseur", libelle: "Fournisseur" },
                  expert: { code: "identifiant", libelle: "Identifiant" },
                  statut: "prouve",
                  valeur: "1876543W/A/M/000",
                  rang: null,
                  instance: null,
                  citations: [{ page: 1, ordinal: 12 }],
                  avertissement: {
                    code: "lettre_de_controle_discordante",
                    libelle: "Lettre de contrôle discordante (essai)",
                  },
                },
                {
                  code: "quantite",
                  libelle: "Quantité",
                  role: null,
                  expert: { code: "nombre", libelle: "Nombre" },
                  statut: "deduit",
                  valeur: "40",
                  rang: 1,
                  instance: null,
                  citations: [],
                  avertissement: null,
                },
              ],
            },
          }),
        });
      } else await route.continue();
    });
    await page.goto("/cabinet/bibliotheque");
    const clients = page.getByRole("combobox", { name: /^(Client|العميل)$/ });
    const option = clients
      .locator("option")
      .filter({ hasText: /SOTUMAG/ })
      .first();
    await expect(option).toBeAttached();
    await clients.selectOption((await option.getAttribute("value"))!);
    await ouvrirLesPremieresPieces(page);
    await page.locator(".cab-doclib-documents li").first().locator("a").first().click();
    await expect(page).toHaveURL(/\/cabinet\/piece\//);
    const bouton = page.getByRole("button", { name: titre });
    await expect(bouton).toHaveAttribute("aria-expanded", "false");
    await bouton.click();
    const section = page.locator(".cab-lecteur");
    await expect(section.getByText(observation)).toBeVisible();
    await expect(section.getByText("1876543W/A/M/000", { exact: true })).toBeVisible();
    await expect(section.locator("tr.cab-lecteur-avertissement")).toContainText(avertissement);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    const debordement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(debordement).toBeLessThanOrEqual(1);
    expect(plantages).toEqual([]);
    await testInfo.attach(`ce-que-le-lecteur-a-lu-${locale}-390`, {
      body: await section.screenshot(),
      contentType: "image/png",
    });
  });
}

/*
 * La comptabilité au clic (maquette du 8 novembre 2026) : la file en piles,
 * l'écriture proposée, les demandes de la société, à toutes les tailles.
 */
const sansDebordement = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

/** Une page peut ne pas défiler et couper quand même un bouton au bord. */
const rienHorsDeLEcran = async (page: Page) =>
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main a, main button, main select, main input")]
        .filter((el) => el.offsetParent !== null && !el.closest(".overflow-x-auto"))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName),
    ),
  ).toEqual([]);

const pile = (page: Page, nom: RegExp) =>
  page
    .locator("section:not(.cab-worklist)")
    .filter({ has: page.getByRole("button", { name: nom }) });

/** Plusieurs pièces d'un même tiers se rangent dans un groupe plié. */
const ouvrirUnGroupe = async (dansLaPile: Locator, nom?: RegExp) => {
  const groupe = dansLaPile
    .locator('li button[aria-expanded="false"]')
    .filter({ hasText: nom ?? /./ });
  if (await groupe.count()) await groupe.first().click();
};

for (const largeur of [320, 375, 768, 1024, 1280, 1440]) {
  for (const chemin of ["", "/notifications", "/echeances", "/clients", "/propositions"]) {
    test(`au clic : ${chemin || "/aujourd'hui"} à ${largeur} px`, async ({ page }, testInfo) => {
      const plantages: string[] = [];
      page.on("pageerror", (e) => plantages.push(e.message));
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`/cabinet${chemin}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await sansDebordement(page);
      await rienHorsDeLEcran(page);
      expect(plantages).toEqual([]);
      await testInfo.attach(`clic${chemin.replace("/", "-")}-${largeur}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
}

test("au clic : chaque pile s'ouvre et mène à une pièce", async ({ page }) => {
  await page.goto("/cabinet");
  const compteurs = page.locator("[data-pile]");
  await expect(compteurs.first()).toBeVisible({ timeout: 20_000 });
  const n = await compteurs.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const bouton = compteurs.nth(i).locator("xpath=ancestor::button[1]");
    if ((await bouton.getAttribute("aria-expanded")) === "false") await bouton.click();
    await expect(bouton).toHaveAttribute("aria-expanded", "true");
  }
  await page.locator('a[href*="/cabinet/piece/"]').first().click();
  await expect(page).toHaveURL(/\/cabinet\/piece\//);
  await expect(page.getByRole("tab", { name: "Écritures" })).toBeVisible({ timeout: 20_000 });
  // Le journal de la pièce se replie et se déplie.
  const journal = page.getByRole("button", { name: "Journal de la pièce" });
  await expect(journal).toHaveAttribute("aria-expanded", "false");
  await journal.click();
  await expect(journal).toHaveAttribute("aria-expanded", "true");
  await journal.click();
  await expect(journal).toHaveAttribute("aria-expanded", "false");
});

test("au clic : l'écriture proposée se lit, se modifie, se valide et passe à la suite", async ({
  page,
}, testInfo) => {
  await page.goto("/cabinet");
  await expect(page.locator("[data-pile]").first()).toBeVisible({ timeout: 20_000 });
  const pretes = pile(page, /Prêtes à valider/);
  await expect(pretes).toBeVisible();
  await ouvrirUnGroupe(pretes);
  const lien = pretes.locator('a[href*="/cabinet/piece/"]').first();
  await lien.click();
  await expect(page.getByText("Malica propose")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Débit = crédit")).toBeVisible();
  await testInfo.attach("ecriture-resume", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const adresse = page.url();
  // Une ligne se déplie, le formulaire d'avant reste là derrière « Modifier ».
  await page.locator(".cab-ligne button").first().click();
  await expect(page.getByRole("button", { name: "Changer de compte" })).toBeVisible();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /Journal/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Malica propose")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Valider", exact: false }).last().click();
  await expect(page).not.toHaveURL(adresse, { timeout: 20_000 });
  // Rouverte, elle est prise en charge et se corrige encore.
  await page.goto(adresse);
  await expect(page.getByRole("button", { name: "Modifier", exact: true })).toBeVisible({
    timeout: 20_000,
  });
});

test("au clic : une demande de la société se refuse avec un motif", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/cabinet");
  await expect(page.locator("[data-pile]").first()).toBeVisible({ timeout: 20_000 });
  // La société demande le retour d'une de SES pièces, envoyée au cabinet.
  const lecture = pile(page, /Lecture en cours/);
  const entete = lecture.getByRole("button", { name: /Lecture en cours/ });
  if ((await entete.getAttribute("aria-expanded")) === "false") await entete.click();
  await ouvrirUnGroupe(lecture, new RegExp(DIRIGEANT.dossier));
  const lienDeLaSociete = lecture
    .locator("li", { hasText: DIRIGEANT.dossier })
    .locator('a[href*="/cabinet/piece/"]')
    .first();
  await expect(lienDeLaSociete).toBeVisible();
  const aRappeler = ((await lienDeLaSociete.getAttribute("href")) ?? "").split("/").pop();
  const societe = await browser.newContext({ storageState: ETAT_DIRIGEANT });
  const appel = async (depot: string, methode: string, args: unknown[]) => {
    const r = await societe.request.post("/rpc", { data: { depot, methode, args } });
    expect(r.ok(), await r.text()).toBeTruthy();
  };
  await appel("collab", "demanderSurPiece", [aRappeler, "rappel"]);
  await societe.close();

  await page.reload();
  const demandes = pile(page, /Demandes de la société/);
  await expect(demandes).toBeVisible({ timeout: 20_000 });
  await testInfo.attach("demande", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await demandes.getByRole("button", { name: "Refuser", exact: true }).click();
  const envoyer = demandes.getByRole("button", { name: "Refuser", exact: true });
  await expect(envoyer).toBeDisabled();
  await demandes.getByRole("textbox").fill("La pièce est déjà comptabilisée.");
  await envoyer.click();
  await expect(demandes).toHaveCount(0, { timeout: 20_000 });
});

test("au clic : une échéance se coche par date sur un téléphone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/cabinet/echeances");
  const coche = page.getByRole("button", { name: "Marquer faite" }).first();
  await expect(coche).toBeVisible({ timeout: 20_000 });
  await coche.click();
  await expect(page.getByRole("button", { name: /Rouvrir/ }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByRole("button", { name: /Rouvrir/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Marquer faite" }).first()).toBeVisible();
});

test("au clic : les échéances lointaines se déplient", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/cabinet/echeances");
  const suite = page.getByRole("button", { name: /Voir les \d+ échéances suivantes/ });
  await expect(suite).toBeVisible({ timeout: 20_000 });
  const avant = await page.getByRole("button", { name: "Marquer faite" }).count();
  await suite.click();
  await expect(page.getByRole("button", { name: "Ne garder que ce qui presse" })).toBeVisible();
  expect(await page.getByRole("button", { name: "Marquer faite" }).count()).toBeGreaterThan(avant);
});

test("au clic : les notifications se regroupent et les informations se déplient", async ({
  page,
}) => {
  await page.goto("/cabinet/notifications");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const infos = page.getByRole("button", { name: /Voir les \d+ informations/ });
  if (await infos.count()) {
    await infos.click();
    await expect(page.getByRole("button", { name: "Masquer les informations" })).toBeVisible();
  }
});

test("l'accueil de la société lit ses sociétés et ses mois en un appel", async ({ browser }) => {
  const contexte = await browser.newContext({ storageState: ETAT_DIRIGEANT });
  const page = await contexte.newPage();
  const appels: string[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/rpc") || !r.postData()) return;
    const { depot, methode } = JSON.parse(r.postData()!) as { depot: string; methode: string };
    appels.push(`${depot}.${methode}`);
  });
  await page.goto("/pme");
  await expect
    .poll(() => appels.filter((a) => a === "identite.mandatsProposesDesSocietes").length, {
      timeout: 20_000,
    })
    .toBe(1);
  await page.waitForLoadState("networkidle");
  expect(appels.filter((a) => a === "identite.mandatsProposes")).toEqual([]);
  // Le mois affiché peut garder sa lecture ; la série de douze mois n'en fait qu'une.
  expect(appels.filter((a) => a === "referentiel.declarationTva").length).toBeLessThanOrEqual(1);
  await contexte.close();
});
