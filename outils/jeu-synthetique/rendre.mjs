/**
 * Rendre le jeu synthétique : chaque facture en PDF, en photo ou en carnet
 * rempli à la main — et la boîte de chaque champ sur la page.
 *
 *   node outils/jeu-synthetique/rendre.mjs            (les 100 cas)
 *   node outils/jeu-synthetique/rendre.mjs 001 042    (quelques-uns)
 *
 * ================================================================= POURQUOI
 *
 * Une facture tapée part en PDF : sa couche de texte est le premier lecteur
 * du produit (`pdf-text.ts`), exact et gratuit. Une facture photographiée ou
 * écrite à la main part en JPEG : ce sont les pièces que le second lecteur
 * (PaddleOCR) doit relever.
 *
 * Chaque rendu écrit aussi `NNN.boites.json` : la boîte, en fractions de page,
 * de chaque champ imprimé. C'est ce que la désignation ATTENDUE vise — un
 * désignateur idéal désigne les jetons qui tombent dans la boîte du champ. Les
 * VALEURS, elles, ne viennent jamais d'ici : elles sont relues dans le plan de
 * jetons que le vrai lecteur a relevé.
 *
 * ============================================================ DÉTERMINISME
 *
 * Tout ce qui varie — rotation, perspective, flou, ombre, grain du papier,
 * bavure — est tiré d'un générateur graine propre au cas, et dessiné par
 * Chromium lui-même : relancer le rendu redonne les mêmes octets, à version de
 * Chromium et de polices égale. Les dates que Chromium écrit dans un PDF sont
 * remplacées par une date fixe.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { mulberry32 } from "./hasard.mjs";
import { boites, html, pdfFige } from "./page.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const CAS = join(ICI, "cas");
const SORTIE = join(ICI, "rendus");

/* ------------------------------------------------------------- la scène */

/**
 * La photo : la page posée sur un fond, tournée, en perspective, floutée,
 * ombrée, avec le grain du papier — tout tiré de la graine du cas.
 */
function scene(cas, page) {
  const h = mulberry32(cas.graineDuRendu ^ 0x5eed);
  const angle = ((h() - 0.5) * 4).toFixed(2);
  const incline = ((h() - 0.5) * 8).toFixed(2);
  const flou = (0.2 + h() * 0.6).toFixed(2);
  const ombre = (0.15 + h() * 0.25).toFixed(2);
  const grain = Math.floor(h() * 2 ** 31);
  const illisible = cas.defaut === "montant_illisible";
  return page.replace(
    "</body>",
    `<canvas id="grain" width="794" height="1123" style="position:absolute;inset:0;width:210mm;height:297mm;mix-blend-mode:multiply;pointer-events:none"></canvas>
<div style="position:absolute;inset:0;width:210mm;height:297mm;background:linear-gradient(${Math.floor(h() * 360)}deg, rgba(0,0,0,${ombre}), rgba(0,0,0,0) 55%);pointer-events:none"></div>
<script>
  // Le grain du papier, graine du cas : le même à chaque rendu.
  const r = (${mulberry32})(${grain});
  const c = document.getElementById("grain").getContext("2d");
  const img = c.createImageData(794, 1123);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 225 + Math.floor(r() * 30);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v - 6; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  ${illisible ? `for (const s of document.querySelectorAll('[data-champ="totals.ttc"],[data-champ="totals.vat"]')) { s.style.textShadow = "0 0 4px #333"; s.style.filter = "blur(1.2px)"; }` : ""}
  document.body.style.transformOrigin = "50% 50%";
  document.body.style.transform = "perspective(1400px) rotateX(${incline}deg) rotate(${angle}deg) scale(0.92)";
  document.body.style.filter = "blur(${flou}px)";
  document.documentElement.style.background = "#5b5f63";
</script></body>`,
  );
}

/* ------------------------------------------------------------- le rendu */

const demandes = process.argv.slice(2);
const fichiers = readdirSync(CAS)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => demandes.length === 0 || demandes.includes(f.replace(".json", "")))
  .sort();
mkdirSync(SORTIE, { recursive: true });

const navigateur = await chromium.launch();
try {
  for (const f of fichiers) {
    const cas = JSON.parse(readFileSync(join(CAS, f), "utf8"));
    const contexte = await navigateur.newContext({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: cas.rendu === "pdf" ? 1 : 1.3,
    });
    const page = await contexte.newPage();
    const source =
      cas.rendu === "photo"
        ? scene(cas, html(cas))
        : cas.rendu === "manuscrit"
          ? scene(cas, html(cas))
          : html(cas);
    await page.setContent(source, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const champs = await boites(page, cas.rendu === "pdf");
    const manquants = Object.keys(cas.piece.imprime).filter((c) => !(c in champs));
    if (manquants.length > 0)
      throw new Error(`${cas.id} : champs non posés sur la page — ${manquants.join(", ")}`);
    if (cas.rendu === "pdf") {
      const pdf = await page.pdf({
        width: "210mm",
        height: "297mm",
        printBackground: true,
        pageRanges: "1",
      });
      writeFileSync(join(SORTIE, `${cas.id}.pdf`), pdfFige(pdf));
    } else {
      const qualite = 55 + (cas.graineDuRendu % 20);
      const jpeg = await page.screenshot({ type: "jpeg", quality: qualite, fullPage: false });
      writeFileSync(join(SORTIE, `${cas.id}.jpg`), jpeg);
    }
    writeFileSync(
      join(SORTIE, `${cas.id}.boites.json`),
      `${JSON.stringify({ page: 1, champs }, null, 1)}\n`,
    );
    await contexte.close();
    console.log(`  ${cas.id}  ${cas.langue.padEnd(8)} ${cas.rendu.padEnd(9)} ${cas.scenario}`);
  }
} finally {
  await navigateur.close();
}
console.log(`${fichiers.length} rendus dans ${SORTIE}`);
