/**
 * Les comptes du jeu de données (`outils/jeu-de-donnees.mjs`) — des
 * identités fixes, sur une base d'essai, jamais un compte réel.
 */
import { expect, type Page } from "@playwright/test";

const MOT_DE_PASSE = "JeuDeDonnees2026!";

export const DIRIGEANT = { email: "contact@sotumag.tn", dossier: "SOTUMAG" };
export const EXPERT = { email: "leila.bensalah@bensalah.tn", cabinet: "Ben Salah" };

/**
 * Où Playwright écrit traces, captures, rapport et sessions. `e2e/sortie`
 * par défaut (la CI y prend son artefact) ; `REGALICA_E2E_SORTIE` pour un
 * dossier hors de OneDrive sur le poste — la synchronisation retire des
 * fichiers de trace pendant qu'ils s'écrivent, et la campagne meurt sur un
 * ENOENT à la fermeture du navigateur.
 */
export const SORTIE = process.env["REGALICA_E2E_SORTIE"] ?? "e2e/sortie";

/** Les sessions ouvertes par `connexion.setup.ts`, réutilisées par les parcours. */
export const ETAT_DIRIGEANT = `${SORTIE}/session-dirigeant.json`;
export const ETAT_EXPERT = `${SORTIE}/session-expert.json`;

/** L'écran de connexion, tel que la personne le remplit. */
export async function seConnecter(page: Page, email: string, motDePasse = MOT_DE_PASSE) {
  /*
   * La page arrive rendue par le serveur, puis React l'hydrate. Un champ
   * rempli avant l'hydratation garde son texte à l'écran mais l'état de React
   * repart vide : le formulaire enverrait un e-mail vide. L'écran demande la
   * session au montage (`/auth/session`) : sa réponse dit que React est là.
   */
  const hydratee = page.waitForResponse((r) => r.url().includes("/auth/session"));
  await page.goto("/auth");
  await hydratee;
  await page.getByLabel(/Adresse e-mail|Email address|البريد الإلكتروني/).fill(email);
  await page.getByLabel(/Mot de passe|Password|كلمة المرور/).fill(motDePasse);
  await page.getByRole("button", { name: /^(Entrer|Enter|دخول)$/ }).click();
  await expect(page).not.toHaveURL(/\/auth$/);
}

/**
 * L'appareil tel qu'une personne qui revient l'a laissé : sa langue, et le
 * fil de Regalica refermé — il est ouvert à la toute première visite, et
 * recouvre alors l'accueil (voir `panneau-regalica.ts`).
 */
export async function preparerLAppareil(
  page: Page,
  locale: "fr" | "en" | "ar",
  { premiereVisite = false } = {},
) {
  await page.addInitScript(
    ({ l, premiere }) => {
      window.localStorage.setItem("regalica.locale", l);
      if (premiere) window.localStorage.removeItem("regalica.panneau.ouvert.pme");
      else window.localStorage.setItem("regalica.panneau.ouvert.pme", "0");
    },
    { l: locale, premiere: premiereVisite },
  );
}
