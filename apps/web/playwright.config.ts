/**
 * Les parcours dans un navigateur — ce que la personne fait, à l'écran.
 *
 * Trois projets : le dirigeant sur un téléphone en français, le même en
 * arabe (miroir, police, chiffres), et le cabinet sur un bureau. Chacun
 * s'appuie sur une session ouverte une fois par compte (`connexion.setup.ts`).
 * Ils parlent à l'application vivante — le site avec son relais, l'API, la
 * base et le jeu de données — sur `REGALICA_BASE` (le poste : 8080 ; la CI :
 * pareil). Si rien ne tourne, Playwright lance le site sur 8090 contre l'API
 * du poste.
 *
 *   npm run e2e -w @regalica/web                 tout
 *   npx playwright test --project pme-android-fr  un projet
 *   npx playwright test --ui                      pas à pas
 */
import { defineConfig, devices } from "@playwright/test";

import { ETAT_DIRIGEANT, ETAT_EXPERT, SORTIE } from "./e2e/comptes";

const BASE = process.env["REGALICA_BASE"] ?? "http://localhost:8090";
const PORT = Number(new URL(BASE).port || 80);

export default defineConfig({
  testDir: "./e2e",
  outputDir: SORTIE,
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never", outputFolder: `${SORTIE}/rapport` }]]
    : "list",
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "connexion",
      testMatch: /connexion\.setup\.ts/,
      use: { ...devices["Pixel 7"], locale: "fr-FR" },
    },
    {
      name: "pme-android-fr",
      testMatch: /pme\.spec\.ts/,
      dependencies: ["connexion"],
      use: { ...devices["Pixel 7"], locale: "fr-FR", storageState: ETAT_DIRIGEANT },
    },
    {
      name: "pme-android-ar",
      testMatch: /pme-arabe\.spec\.ts/,
      dependencies: ["connexion"],
      use: { ...devices["Pixel 7"], locale: "ar-TN", storageState: ETAT_DIRIGEANT },
    },
    {
      name: "cabinet-bureau-fr",
      testMatch: /cabinet\.spec\.ts/,
      dependencies: ["connexion"],
      use: { ...devices["Desktop Chrome"], locale: "fr-FR", storageState: ETAT_EXPERT },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: `${BASE}/sante`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { REGALICA_PORT: String(PORT) },
  },
});
