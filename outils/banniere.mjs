/**
 * La bannière du Play Store (1024 × 500), rendue depuis le sigle et le nom.
 *
 * Le sigle est celui de l'application (`apps/web/src/assets/rg-mark.svg`),
 * la police est celle de l'application (Inter, embarquée par fontsource) : la
 * bannière dit la même chose que l'écran. On la régénère quand le nom ou la
 * ligne change ; on ne la retouche pas à la main.
 *
 *   node outils/banniere.mjs      →  android/play/feature_graphic/feature_graphic_1024x500.png
 *
 * Le rendu passe par le Chromium de Playwright, déjà là pour les parcours e2e.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIGLE = join(RACINE, "apps/web/src/assets/rg-mark.svg");
const POLICES = join(RACINE, "node_modules/@fontsource/inter/files");
const SORTIE = join(RACINE, "android/play/feature_graphic/feature_graphic_1024x500.png");

// Les couleurs de l'application (styles.css) : papier, encre, signal « ok ».
const PAPIER = "#FAFAFA";
const ENCRE = "#0A0A0A";
const VERT = "oklch(0.5 0.11 150)";

function police(graisse) {
  const donnees = readFileSync(join(POLICES, `inter-latin-${graisse}-normal.woff2`)).toString(
    "base64",
  );
  return `@font-face{font-family:Inter;font-weight:${graisse};src:url(data:font/woff2;base64,${donnees}) format("woff2")}`;
}

const sigle = readFileSync(SIGLE, "utf8").replace(
  /<svg /,
  `<svg style="display:block;width:100%;height:100%;color:${ENCRE}" `,
);

const html = `<!doctype html><meta charset="utf-8"><style>${police(400)}${police(600)}
  html,body{margin:0;width:1024px;height:500px;overflow:hidden;background:${PAPIER};font-family:Inter,sans-serif;color:${ENCRE}}
  .sigle{position:absolute;left:96px;top:110px;width:300px;height:300px}
  .point{position:absolute;left:372px;top:312px;width:34px;height:34px;background:${VERT}}
  .sur{position:absolute;left:420px;top:132px;font-size:14px;letter-spacing:.18em;color:#6B6B70;font-weight:500}
  .nom{position:absolute;left:418px;top:160px;font-size:60px;letter-spacing:-.02em;font-weight:400}
  .nom b{font-weight:600}
  .ligne{position:absolute;left:420px;top:232px;font-size:24px;line-height:1.4;color:#48484A}
  .bas{position:absolute;left:420px;top:390px;font-size:13px;letter-spacing:.18em;color:#9A9AA0;font-weight:500}</style>
  <div class="sigle">${sigle}</div><div class="point"></div>
  <div class="sur">AN ALGORIA FACTORY INTELLIGENCE</div>
  <div class="nom">Malica <b>Office</b></div>
  <div class="ligne">Le cockpit comptable de la PME.<br>Lu, tenu et vérifié par Malica.</div>
  <div class="bas">COMPTABILITÉ · FISCALITÉ · CABINET · FR · AR</div>`;

const navigateur = await chromium.launch();
try {
  const page = await navigateur.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(SORTIE, await page.screenshot({ type: "png" }));
  console.log("écrit", SORTIE.slice(RACINE.length + 1));
} finally {
  await navigateur.close();
}
