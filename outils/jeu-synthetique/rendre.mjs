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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ICI = dirname(fileURLToPath(import.meta.url));
const CAS = join(ICI, "cas");
const SORTIE = join(ICI, "rendus");
const require = createRequire(import.meta.url);

/* ------------------------------------------------------------- les polices */

/** Une police des paquets @fontsource, embarquée en data URL : aucun réseau. */
const police = (chemin) => `data:font/woff2;base64,${readFileSync(chemin).toString("base64")}`;

const POLICES = `
@font-face { font-family: "Imprime"; src: url(${police(require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2"))}); }
@font-face { font-family: "Imprime"; font-weight: 700; src: url(${police(require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2"))}); }
@font-face { font-family: "Imprime"; src: url(${police(require.resolve("@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2"))}); unicode-range: U+0100-024F; }
@font-face { font-family: "Naskh"; src: url(${police(require.resolve("@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff2"))}); }
@font-face { font-family: "Naskh"; font-weight: 700; src: url(${police(require.resolve("@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-700-normal.woff2"))}); }
@font-face { font-family: "Machine"; src: url(${police(require.resolve("@fontsource/special-elite/files/special-elite-latin-400-normal.woff2"))}); }
@font-face { font-family: "Main"; src: url(${police(require.resolve("@fontsource/caveat/files/caveat-latin-500-normal.woff2"))}); }
@font-face { font-family: "Main"; src: url(${police(require.resolve("@fontsource/caveat/files/caveat-latin-ext-500-normal.woff2"))}); unicode-range: U+0100-024F; }
@font-face { font-family: "MainArabe"; src: url(${police(require.resolve("@fontsource/aref-ruqaa/files/aref-ruqaa-arabic-400-normal.woff2"))}); }
`;

/* ------------------------------------------------------------- le hasard */

function mulberry32(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- les libellés */

const LIBELLES = {
  fr: {
    numero: "N°",
    date: "Date :",
    mf: "MF :",
    tel: "Tél. :",
    client: "Client :",
    mfClient: "MF client :",
    devise: "Devise :",
    designation: "Désignation",
    qte: "Qté",
    pu: "P.U. HT",
    tva: "TVA",
    montant: "Montant HT",
    brut: "Total brut HT",
    remise: "Remise",
    ht: "Total HT",
    htNet: "Total HT net",
    fodec: "FODEC",
    taux: "Taux",
    base: "Base",
    totalTva: "Total TVA",
    timbre: "Droit de timbre",
    ttc: "Total TTC",
    cachet: "Cachet et signature",
  },
  ar: {
    numero: "رقم",
    date: "التاريخ :",
    mf: "المعرف الجبائي :",
    tel: "الهاتف :",
    client: "الحريف :",
    mfClient: "المعرف الجبائي للحريف :",
    devise: "العملة :",
    designation: "البيان",
    qte: "الكمية",
    pu: "سعر الوحدة",
    tva: "الأداء",
    montant: "المبلغ",
    brut: "المجموع الخام",
    remise: "التخفيض",
    ht: "المبلغ دون اعتبار الأداءات",
    htNet: "المبلغ الصافي دون اعتبار الأداءات",
    fodec: "فوداك",
    taux: "النسبة",
    base: "الأساس",
    totalTva: "الأداء على القيمة المضافة",
    timbre: "معلوم الطابع",
    ttc: "المجموع",
    cachet: "الختم والإمضاء",
  },
};
/** Un libellé dans la langue du cas ; l'hybride porte les deux. */
function libelle(langue, cle) {
  if (langue === "fr") return LIBELLES.fr[cle];
  if (langue === "ar") return `<span class="ar">${LIBELLES.ar[cle]}</span>`;
  return `${LIBELLES.fr[cle]} <span class="ar">/ ${LIBELLES.ar[cle]}</span>`;
}

const echapper = (t) =>
  String(t).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/* ------------------------------------------------------------- la page */

function html(cas) {
  const p = cas.piece;
  const L = (cle) => libelle(cas.langue, cle);
  const hasard = mulberry32(cas.graineDuRendu);
  const manuscrit = cas.rendu === "manuscrit";
  const rtl = cas.langue === "ar";
  /*
   * Un champ imprimé : sa valeur, dans une boîte qu'on mesure. En carnet, la
   * valeur est ÉCRITE : police manuscrite, encre bleue, ligne de base et
   * inclinaison irrégulières.
   */
  const champ = (chemin, { ltr = true } = {}) => {
    const texte = p.imprime[chemin];
    if (texte === undefined) return "";
    const arabe = /[؀-ۿ]/.test(texte);
    const style = manuscrit
      ? `style="display:inline-block;transform:translateY(${((hasard() - 0.5) * 5).toFixed(1)}px) rotate(${((hasard() - 0.5) * 4).toFixed(1)}deg)"`
      : "";
    const classe = manuscrit ? (arabe ? "main ar-main" : "main") : "";
    return `<span data-champ="${chemin}" class="${classe}" ${ltr && !arabe ? 'dir="ltr"' : ""} ${style}>${echapper(texte)}</span>`;
  };
  const marque = p.devise === "TND" ? (cas.langue === "ar" ? "د.ت" : "DT") : p.devise;

  const lignes = p.articles
    .map(
      (a, k) => `<tr>
        <td class="g">${champ(`articles[${k}].designation`, { ltr: false })}</td>
        <td>${champ(`articles[${k}].quantity`)}</td>
        <td>${champ(`articles[${k}].unit_price_ht`)}</td>
        <td dir="ltr">${a.tauxImprime}</td>
        <td>${champ(`articles[${k}].total_ht`)}</td>
      </tr>`,
    )
    .join("");
  const vides = manuscrit
    ? Array.from(
        { length: Math.max(0, 7 - p.articles.length) },
        () => "<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>",
      ).join("")
    : "";

  const droit = (code) => p.droits.indexOf(code);
  const pied = [];
  if (p.remise) {
    pied.push(`<tr><th>${L("brut")}</th><td dir="ltr">${p.remise.brut}</td></tr>`);
    pied.push(
      `<tr><th>${L("remise")} <span dir="ltr">${p.remise.tauxImprime}</span></th><td dir="ltr">${p.remise.montant}</td></tr>`,
    );
    pied.push(`<tr><th>${L("htNet")}</th><td>${champ("totals.base_ht")}</td></tr>`);
  } else {
    pied.push(`<tr><th>${L("ht")}</th><td>${champ("totals.base_ht")}</td></tr>`);
  }
  if (droit("FODEC") >= 0)
    pied.push(
      `<tr><th>${L("fodec")} <span dir="ltr">1 %</span></th><td>${champ(`other_charges[${droit("FODEC")}].amount`)}</td></tr>`,
    );
  if (p.tableauParTaux) {
    p.parTaux.forEach((l, i) => {
      pied.push(
        `<tr class="taux"><th>${L("tva")} <span dir="ltr">${l.tauxImprime}</span> — ${L("base")} ${champ(`lines[${i}].base_ht`)}</th><td>${champ(`lines[${i}].vat_amount`)}</td></tr>`,
      );
    });
  }
  pied.push(`<tr><th>${L("totalTva")}</th><td>${champ("totals.vat")}</td></tr>`);
  if (droit("DROIT_TIMBRE") >= 0)
    pied.push(
      `<tr><th>${L("timbre")}</th><td>${champ(`other_charges[${droit("DROIT_TIMBRE")}].amount`)}</td></tr>`,
    );
  pied.push(`<tr class="ttc"><th>${L("ttc")} (${marque})</th><td>${champ("totals.ttc")}</td></tr>`);

  const machine = cas.rendu === "photo" && cas.graineDuRendu % 2 === 0;
  const fond = manuscrit ? "#fbf8ef" : "#ffffff";

  return `<!doctype html><html lang="${cas.langue === "ar" ? "ar" : "fr"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>
${POLICES}
@page { size: 210mm 297mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: 210mm; height: 297mm; background: ${fond}; color: #111;
  font-family: ${machine ? '"Machine", "Naskh"' : '"Imprime", "Naskh"'}; font-size: 10.5pt; }
.ar { font-family: "Naskh"; }
.feuille { position: relative; width: 210mm; height: 297mm; padding: 14mm 15mm; box-sizing: border-box; background: ${fond}; }
.entete { display: flex; justify-content: space-between; gap: 8mm; }
.emetteur strong { font-size: 13pt; }
.titre { font-size: 20pt; font-weight: 700; letter-spacing: 1px; margin: 8mm 0 3mm; }
.bloc { border: 1px solid #999; padding: 3mm; margin: 2mm 0; }
table.articles { width: 100%; border-collapse: collapse; margin-top: 5mm; }
table.articles th, table.articles td { border: 1px solid #777; padding: 2mm; text-align: end; }
table.articles td.g, table.articles th.g { text-align: start; }
table.pied { margin-top: 5mm; margin-inline-start: auto; border-collapse: collapse; min-width: 95mm; }
table.pied th { text-align: start; font-weight: 400; padding: 1.4mm 3mm; }
table.pied td { text-align: end; padding: 1.4mm 3mm; border-bottom: 1px dotted #aaa; min-width: 30mm; }
table.pied tr.ttc th, table.pied tr.ttc td { font-weight: 700; border-top: 2px solid #111; }
.lettres { margin-top: 6mm; font-style: italic; }
.cachet { margin-top: 10mm; margin-inline-start: auto; width: 60mm; height: 22mm; border: 1px dashed #999; text-align: center; color: #777; }
.main { font-family: "Main", "MainArabe"; color: #1c3d8f; font-size: 15pt; }
.ar-main { font-family: "MainArabe"; font-size: 14pt; }
.carnet .bloc, .carnet table.articles td { border-color: #b5651d; }
.carnet { color: #7a3f12; }
.carnet .souche { position: absolute; top: 6mm; inset-inline-end: 15mm; font-size: 9pt; }
</style></head><body><div class="feuille ${manuscrit ? "carnet" : ""}">
${manuscrit ? `<div class="souche">${L("numero")} ${champ("references.numero")}</div>` : ""}
<div class="entete">
  <div class="emetteur">
    <strong>${champ("issuer", { ltr: false })}</strong>
    ${cas.langue === "hybride" ? `<div class="ar">${echapper(p.emetteur.nomAr)}</div>` : ""}
    <div>${echapper(p.emetteur.adresse)}</div>
    <div>${L("mf")} ${champ("references.matricule_fiscal")}</div>
    <div>${L("tel")} <span dir="ltr">${p.emetteur.telephone}</span></div>
  </div>
  <div class="bloc client">
    <div>${L("client")} ${echapper(p.client.nom)}</div>
    <div>${echapper(p.client.adresse)}</div>
    <div>${L("mfClient")} ${champ("references.matricule_fiscal_client")}</div>
  </div>
</div>
<div class="titre">${cas.langue === "ar" ? `<span class="ar">${p.titre}</span>` : cas.langue === "hybride" ? `${p.titre.split(" / ")[0]} <span class="ar">/ ${p.titre.split(" / ")[1]}</span>` : p.titre}
  ${manuscrit ? "" : `<span style="font-size:12pt;font-weight:400">${L("numero")} ${champ("references.numero")}</span>`}</div>
<div>${p.imprime.document_date !== undefined ? `${L("date")} ${champ("document_date")}` : `${L("date")} ${manuscrit ? "" : "……"}`}
  ${p.devise !== "TND" ? ` &nbsp; ${L("devise")} <span dir="ltr">${p.devise}</span>` : ""}</div>
<table class="articles"><thead><tr>
  <th class="g">${L("designation")}</th><th>${L("qte")}</th><th>${L("pu")}</th><th>${L("tva")}</th><th>${L("montant")}</th>
</tr></thead><tbody>${lignes}${vides}</tbody></table>
<table class="pied">${pied.join("")}</table>
${p.enLettres ? `<div class="lettres ${manuscrit ? "main" : ""}">${echapper(p.enLettres)}</div>` : ""}
<div class="cachet">${L("cachet")}</div>
</div></body></html>`;
}

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
  let a = ${grain} >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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

/* ------------------------------------------------------------- les boîtes */

/**
 * Les boîtes, en fractions de la PAGE : celle de la feuille pour un PDF (le
 * PDF est la feuille), celle de la vue pour une photo (la photo est la vue).
 */
async function boites(page, pdf) {
  return page.evaluate((estPdf) => {
    const cadre = estPdf
      ? document.querySelector(".feuille").getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const L = cadre.width;
    const H = cadre.height;
    const champs = {};
    for (const el of document.querySelectorAll("[data-champ]")) {
      const r = el.getBoundingClientRect();
      champs[el.getAttribute("data-champ")] = {
        x0: +((r.left - cadre.left) / L).toFixed(4),
        y0: +((r.top - cadre.top) / H).toFixed(4),
        x1: +((r.right - cadre.left) / L).toFixed(4),
        y1: +((r.bottom - cadre.top) / H).toFixed(4),
      };
    }
    return champs;
  }, pdf);
}

/** Les dates que Chromium écrit dans un PDF, remplacées : même rendu, mêmes octets. */
function pdfFige(octets) {
  const texte = Buffer.from(octets).toString("latin1");
  const fige = texte.replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, (m, cle) => {
    const date = "D:20261031000000+00'00'";
    const brut = m.slice(cle.length + 3, -1);
    return `/${cle} (${date.padEnd(brut.length, " ").slice(0, Math.max(brut.length, date.length))})`;
  });
  if (fige.length !== texte.length) throw new Error("la date figée change la longueur du PDF");
  return Buffer.from(fige, "latin1");
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
