/**
 * Les sorties d'une pièce retournée, mesurées à 375 px (revue de #140).
 *
 * Staging, 30 octobre 2026 : « Reprendre la photo » passait à la ligne et la
 * paire montait à 54 px ; puis « Joindre une facture conforme » aurait été
 * coupée par l’ellipse. Chaque libellé que la carte peut porter — les gestes
 * des motifs (une suppression se dit « Supprimer »), puis les sorties — se pose sur la vraie
 * feuille de style, dans la vraie police, deux par ligne : 48 px de haut,
 * même largeur, rien de coupé.
 */
import { expect, type Page } from "@playwright/test";
import { MESSAGES, type Locale } from "@malica/socle/messages";

const LIBELLES = [
  "pme.retour.geste.joindre_document",
  "pme.retour.geste.joindre_facture_conforme",
  "pme.retour.geste.reprendre_photo",
  "pme.retour.geste.corriger_date",
  "pme.retour.geste.repondre",
  "pme.retour.geste.voir_reglement",
  "pme.retour.renvoyer",
  "pme.retour.garder",
  "pme.retour.supprimer",
] as const;

export async function mesurerLesSortiesDuRetour(page: Page, locale: Locale) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/pme");
  await expect(page.locator('[data-surface="pme"]')).toBeVisible();
  const libelles = LIBELLES.map((cle) => MESSAGES[locale][cle]);
  const mesures = await page.evaluate((textes) => {
    const hote = document.querySelector('[data-surface="pme"] main') ?? document.body;
    const ecran = document.createElement("div");
    ecran.setAttribute("data-ecran", "dossier");
    ecran.innerHTML = `<div class="f-ret"><div class="f-dec-gestes deux f-ret-sorties">${textes
      .map(() => `<button type="button"></button>`)
      .join("")}<button type="button">·</button></div></div>`;
    hote.prepend(ecran);
    const boutons = [...ecran.querySelectorAll("button")].slice(0, textes.length);
    boutons.forEach((b, i) => (b.textContent = textes[i]!));
    return boutons.map((b) => ({
      texte: b.textContent,
      hauteur: Math.round(b.getBoundingClientRect().height),
      largeur: Math.round(b.getBoundingClientRect().width),
      coupe: b.scrollWidth > b.clientWidth,
    }));
  }, libelles);
  const largeur = mesures[0]!.largeur;
  // Tous les écarts d'un coup : le libellé, sa hauteur, sa largeur, s'il est coupé.
  expect(mesures.filter((m) => m.hauteur !== 48 || m.coupe || m.largeur !== largeur)).toEqual([]);
}
