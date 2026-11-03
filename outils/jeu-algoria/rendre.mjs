/**
 * Rendre le jeu d'ALGORIA : chaque cas en PDF, en PDF-image, en photo ou en
 * scan — et la boîte de chaque champ sur la page.
 *
 *   node outils/jeu-algoria/rendre.mjs            (les 120 cas)
 *   node outils/jeu-algoria/rendre.mjs 001 042    (quelques-uns)
 *
 * ================================================================== LES SORTIES
 *
 * - `rendus/NNN.pdf` : un PDF de logiciel, avec sa couche de texte (`pdf`), ou
 *   une photo / un scan enveloppé dans un PDF, sans texte (`pdf_image`) ;
 * - `rendus/NNN.jpg` : une photo de téléphone ou un scan ;
 * - `rendus/NNN.boites.json` : la boîte, en fractions de la page (ou de
 *   l'image), de chaque valeur imprimée (`champs`, par chemin de
 *   `piece.imprime`) et de chaque champ de la grille (`concepts`, par la clé de
 *   `attendu.concepts`), et le nombre de lignes imprimées (`lignesImprimees` :
 *   lignes de texte distinctes, regroupées par ordonnée — deux blocs côte à
 *   côte comptent une ligne).
 *
 * ============================================================ DÉTERMINISME
 *
 * Tout ce qui varie est tiré de la graine du cas et dessiné par Chromium : les
 * mêmes octets à chaque rendu, à version de Chromium et de polices égale. Les
 * dates que Chromium écrit dans un PDF sont figées (`pdfFige`).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { boites, pdfFige } from "../jeu-synthetique/page.mjs";

import { page as pageDuCas } from "./gabarits.mjs";
import { placerLesMarques, prisDeVue, surLePapier } from "./realisme.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const CAS = join(ICI, "cas");
const SORTIE = join(ICI, "rendus");

/** Les lignes de texte de la feuille, regroupées par ordonnée (les marques exclues). */
function compterLesLignes() {
  const feuille = document.querySelector(".feuille");
  const centres = [];
  const marcheur = document.createTreeWalker(feuille, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    if (!n.textContent.trim() || n.parentElement.closest(".realisme, style, script")) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const b of r.getClientRects())
      if (b.height > 2 && b.width > 1) centres.push([b.top + b.height / 2, b.height]);
  }
  centres.sort((a, b) => a[0] - b[0]);
  let lignes = 0;
  let ancre = -Infinity;
  for (const [y, hauteur] of centres) {
    if (y - ancre > hauteur * 0.45) {
      lignes += 1;
      ancre = y;
    }
  }
  return lignes;
}

/** La feuille déborde-t-elle de son A4 ? Une page coupée ment sur ce qu'elle imprime. */
function deborde() {
  const f = document.querySelector(".feuille");
  return f.scrollHeight > f.clientHeight + 1;
}

const poser = async (page, source) => {
  await page.setContent(source, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(placerLesMarques);
  // Deux images d'animation : la page placée est peinte avant d'être capturée.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
};

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
    const image = cas.rendu !== "pdf";
    const dense = cas.scenario === "dense";
    const contexte = await navigateur.newContext({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: image ? (dense ? 2 : 1.5) : 1,
    });
    const page = await contexte.newPage();
    let feuille = surLePapier(cas, pageDuCas(cas));

    // La page à plat d'abord : ses lignes, son débordement, et le PDF de logiciel.
    await poser(page, feuille);
    // Une page qui ne tient pas se resserre, comme le logiciel du magasin ou la
    // main qui écrit plus petit : le corps descend par pas de 0,1 pt (jamais sous 5 pt).
    const corpsInitial = await page.evaluate(
      () => Math.round(parseFloat(getComputedStyle(document.body).fontSize) * 7.5) / 10,
    );
    let corps = corpsInitial;
    while ((await page.evaluate(deborde)) && corps > 5) {
      corps = Math.round((corps - 0.1) * 10) / 10;
      await page.evaluate((pt) => (document.body.style.fontSize = `${pt}pt`), corps);
    }
    if (corps !== corpsInitial) {
      feuille = feuille.replace("</style>", `body { font-size: ${corps}pt; }</style>`);
      await poser(page, feuille);
    }
    if (await page.evaluate(deborde)) throw new Error(`${cas.id} : la feuille déborde de l'A4`);
    const lignesImprimees = await page.evaluate(compterLesLignes);
    // Chaque valeur imprimée tient dans la feuille : une valeur coupée par le bord
    // serait « imprimée » pour la vérité et illisible sur la page.
    const coupes = Object.entries(await boites(page, true))
      .filter(([, b]) => b.x0 < 0 || b.y0 < 0 || b.x1 > 1 || b.y1 > 1)
      .map(([c]) => c);
    if (coupes.length > 0)
      throw new Error(`${cas.id} : valeurs hors de la feuille — ${coupes.join(", ")}`);
    let champs;
    if (!image) {
      champs = await boites(page, true);
      const pdf = await page.pdf({
        width: "210mm",
        height: "297mm",
        printBackground: true,
        pageRanges: "1",
      });
      writeFileSync(join(SORTIE, `${cas.id}.pdf`), pdfFige(pdf));
    } else {
      // Puis la prise de vue : photo ou scan, et ses boîtes dans l'image.
      await poser(page, prisDeVue(cas, feuille));
      champs = await boites(page, false);
      const photo = cas.capture === "photo";
      const qualite = (photo ? 72 : 64) + (cas.graineDuRendu % 12);
      const jpeg = await page.screenshot({ type: "jpeg", quality: qualite, fullPage: false });
      if (cas.rendu === "pdf_image") {
        // Une image dans un PDF, sans couche de texte : comme le ticket réel.
        await page.setContent(
          `<!doctype html><html><head><style>@page{size:210mm 297mm;margin:0}html,body{margin:0}</style></head><body><img src="data:image/jpeg;base64,${jpeg.toString("base64")}" style="display:block;width:210mm;height:297mm"></body></html>`,
          { waitUntil: "load" },
        );
        const pdf = await page.pdf({
          width: "210mm",
          height: "297mm",
          printBackground: true,
          pageRanges: "1",
        });
        writeFileSync(join(SORTIE, `${cas.id}.pdf`), pdfFige(pdf));
      } else writeFileSync(join(SORTIE, `${cas.id}.jpg`), jpeg);
    }
    const manquants = Object.keys(cas.piece.imprime).filter((c) => !(c in champs));
    if (manquants.length > 0)
      throw new Error(`${cas.id} : champs non posés sur la page — ${manquants.join(", ")}`);
    const concepts = {};
    for (const [chemin, concept] of Object.entries(cas.piece.versConcept))
      concepts[concept] = champs[chemin];
    for (const marque of ["cachet_emetteur", "signature_emetteur"])
      if (champs[marque]) concepts[marque] = champs[marque];
    writeFileSync(
      join(SORTIE, `${cas.id}.boites.json`),
      `${JSON.stringify({ page: 1, lignesImprimees, champs, concepts }, null, 1)}\n`,
    );
    await contexte.close();
    console.log(
      `  ${cas.id}  ${cas.gabarit} ${cas.langue.padEnd(8)} ${cas.rendu.padEnd(9)} ${String(cas.capture ?? "").padEnd(5)} ${String(lignesImprimees).padStart(3)} lignes  ${cas.scenario}`,
    );
  }
} finally {
  await navigateur.close();
}
console.log(`${fichiers.length} rendus dans ${SORTIE}`);
