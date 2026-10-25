/**
 * L'expert-comptable, sur un bureau : le cabinet s'ouvre, ses dossiers sont
 * là, un dossier client s'ouvre.
 */
import { expect, test } from "@playwright/test";

import { preparerLAppareil, ETAT_DIRIGEANT } from "./comptes";
import { lecture } from "../../api/src/scan/lecture-d-essai";

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
  await expect(page.getByRole("alert")).toContainText("Statistiques temporairement indisponibles", {
    timeout: 20_000,
  });
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

// Base d'épreuve réelle : profil et affectation passent par RPC, RLS et migrations.
for (const largeur of [390, 1440]) {
  test(`profil fiscal : enregistrer puis appliquer à un dossier à ${largeur} px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: largeur, height: 950 });
    const rpc = async (depot: string, methode: string, args: unknown[]) => {
      const r = await page.request.post("/rpc", { data: { depot, methode, args } });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).resultat;
    };
    const orgs = (await rpc("identite", "listMyOrganizations", [])) as Array<{
      id: string;
      kind: string;
    }>;
    const cabinet = orgs.find((o) => o.kind === "cabinet")!;
    const marque = `Fiscalité ${largeur} ${Date.now()}`;
    const chiffres = String(Date.now()).slice(-7);
    const client = (await rpc("identite", "ouvrirDossier", [
      { cabinetTenantId: cabinet.id, name: marque, legalId: `${chiffres}W/A/M/000`, adresse: null },
    ])) as { id: string };
    await page.goto("/cabinet/reglages");
    await page.getByRole("button", { name: "Comptabilité et fiscalité", exact: true }).click();
    await page.getByRole("button", { name: "Créer un profil", exact: true }).click();
    await page.getByLabel("Nom du profil", { exact: true }).fill(marque);
    await page.getByLabel("Catégorie de clients", { exact: true }).first().fill(marque);
    await page
      .getByLabel("Activités concernées", { exact: true })
      .fill("Activité du parcours de test");
    await page.getByRole("button", { name: "Enregistrer cette version" }).click();
    await expect(page.getByText("Version enregistrée.", { exact: true })).toBeVisible();
    await page.getByLabel("Rechercher un client").fill(marque);
    await page.getByLabel("Sélectionner les clients affichés").check();
    await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
    await expect(page.getByText(/Modification prévue/)).toBeVisible();
    await page.getByRole("button", { name: "Appliquer aux 1 clients éligibles" }).click();
    await expect(
      page.getByText("1 dossiers mis à jour · 0 écartés", { exact: true }),
    ).toBeVisible();
    const ds = (await rpc("parametrage", "historiqueFiscal", [cabinet.id, client.id])) as Array<{
      configuration: { regles: Array<{ applicabilite: string; valeur: string | null }> };
    }>;
    expect(ds).toHaveLength(1);
    expect(ds[0]!.configuration.regles).toHaveLength(5);
    expect(
      ds[0]!.configuration.regles.every(
        (r) => r.applicabilite === "a_qualifier" && r.valeur === null,
      ),
    ).toBeTruthy();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await testInfo.attach(`profils-fiscaux-${largeur}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

// La qualification utilise une lecture synthétique citée, les vrais RPC et la RLS.
for (const largeur of [390, 1440]) {
  test(`qualification fiscale de pièce : vérifier et enregistrer à ${largeur} px`, async ({
    page,
    browser,
  }, testInfo) => {
    await page.setViewportSize({ width: largeur, height: 950 });
    const rpc = async (depot: string, methode: string, args: unknown[]) => {
      const r = await page.request.post("/rpc", { data: { depot, methode, args } });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).resultat;
    };
    const orgs = (await rpc("identite", "listMyOrganizations", [])) as {
      id: string;
      kind: string;
    }[];
    const cabinet = orgs.find((o) => o.kind === "cabinet")!;
    const ctx = await browser.newContext({ storageState: ETAT_DIRIGEANT });
    try {
      const appel = async (depot: string, methode: string, args: unknown[]) => {
        const r = await ctx.request.post(new URL("/rpc", page.url()).href, {
          data: { depot, methode, args },
        });
        expect(r.ok(), await r.text()).toBeTruthy();
        return (await r.json()).resultat;
      };
      // page.url vaut about:blank avant navigation : utiliser la base de Playwright.
      await page.goto("/cabinet/bibliotheque");
      const mesOrgs = (await appel("identite", "listMyOrganizations", [])) as {
        id: string;
        kind: string;
        legalId: string;
      }[];
      const client = mesOrgs.find((o) => o.kind === "pme")!;
      expect(client).toBeTruthy();
      const pack = (await rpc("referentiel", "activePack", ["TN"])) as { id: string };
      const l = lecture({
        clientMf: client.legalId,
        numero: `FQ-${largeur}-${Date.now()}`,
        ht: ["1", "000,000"],
        tva: "191,900",
        ttc: ["1", "201,900"],
      });
      l.tokens[10]!.text = "10,000";
      l.extract.other_charges = [{ code: "FODEC", label: "FODEC", amount: "10.000" }];
      const piece = (await appel("capture", "enregistrer", [
        {
          tenantId: client.id,
          source: "pdf",
          vis: "partage",
          idempotencyKey: `fq-${largeur}-${Date.now()}`,
          contentType: "application/pdf",
          pageCount: 1,
        },
      ])) as { id: string };
      await appel("capture", "persisterLecture", [
        {
          pieceId: piece.id,
          packId: pack.id,
          tokens: l.tokens,
          contract: "extract.v1",
          extract: l.extract,
          citations: l.citations,
          flags: [],
          articles: [],
          documentKind: "facture_achat",
          documentDate: l.extract.document_date,
          mode: "pdf-text",
          confianceParChamp: { "totals.ttc": 0.95 },
        },
      ]);
      await appel("capture", "analyser", [piece.id]);
      await page.goto(`/cabinet/piece/${piece.id}`);
      await page
        .getByRole("button", { name: "Qualifier la fiscalité de cette pièce", exact: true })
        .click();
      const c = (await rpc("office", "contexteQualificationFiscale", [piece.id])) as {
        comptes: { code: string }[];
      };
      expect(c.comptes.length).toBeGreaterThan(0);
      await page
        .getByLabel("Qualité du redevable de la taxe", { exact: true })
        .selectOption("fabricant");
      await page.getByLabel("Part du HT affectée", { exact: true }).fill("1000.000");
      await page
        .getByLabel("Imputation du HT et des coûts non récupérables", { exact: true })
        .selectOption(c.comptes[0]!.code);
      await page
        .getByLabel("Affectation de la TVA", { exact: true })
        .selectOption("non_deductible");
      await page
        .getByLabel("FODEC · Base assujettie (zéro si non soumise)", { exact: true })
        .fill("1000.000");
      await page
        .getByLabel("Justification et pièces établissant l’assujettissement ou l’exonération", {
          exact: true,
        })
        .fill("Produits et usage vérifiés pour le scénario navigateur");
      const sauvegarde = page.waitForResponse(
        (r) =>
          r.url().endsWith("/rpc") && r.request().postDataJSON()?.methode === "qualifierFiscalite",
      );
      await page.getByRole("button", { name: "Vérifier et enregistrer", exact: true }).click();
      const response = await sauvegarde;
      expect(response.ok(), await response.text()).toBeTruthy();
      const q = (await rpc("office", "qualificationFiscale", [piece.id])) as { id: string };
      expect(q.id).toBeTruthy();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBeTruthy();
      await testInfo.attach(`qualification-fiscale-${largeur}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      expect(cabinet.id).toBeTruthy();
    } finally {
      await ctx.close();
    }
  });
}
