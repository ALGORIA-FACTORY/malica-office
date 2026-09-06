/**
 * Une connexion par compte, puis la session est réutilisée par tous les
 * parcours : l'API limite les tentatives de connexion par minute et par
 * adresse (`AUTH_ESSAIS_PAR_MINUTE`), et une personne ne se reconnecte pas à
 * chaque écran non plus.
 */
import { test as setup } from "@playwright/test";

import { DIRIGEANT, ETAT_DIRIGEANT, ETAT_EXPERT, EXPERT, seConnecter } from "./comptes";

setup("le dirigeant se connecte", async ({ page }) => {
  await seConnecter(page, DIRIGEANT.email);
  await page.context().storageState({ path: ETAT_DIRIGEANT });
});

setup("l'expert-comptable se connecte", async ({ page }) => {
  await seConnecter(page, EXPERT.email);
  await page.context().storageState({ path: ETAT_EXPERT });
});
