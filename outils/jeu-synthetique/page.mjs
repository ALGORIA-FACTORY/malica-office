/**
 * La page d'une facture fabriquée : ses polices, ses libellés, sa mise en page
 * classique, la boîte de chaque champ, et un PDF aux dates figées.
 *
 * Partagée par le rendu du jeu synthétique (`rendre.mjs`) et par celui du jeu
 * d'ALGORIA (`outils/jeu-algoria/rendre.mjs`), qui reprend la facture
 * classique telle quelle et y ajoute ses propres mises en page.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { mulberry32 } from "./hasard.mjs";

const require = createRequire(import.meta.url);

/* ------------------------------------------------------------- les polices */

/** Une police des paquets @fontsource, embarquée en data URL : aucun réseau. */
export const police = (chemin) =>
  `data:font/woff2;base64,${readFileSync(chemin).toString("base64")}`;

export const POLICES = `
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
    rc: "RC :",
    rib: "RIB :",
    reglement: "Règlement :",
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
    rc: "السجل التجاري :",
    rib: "المعرّف البنكي :",
    reglement: "طريقة الدفع :",
  },
};
/** Un libellé dans la langue du cas ; l'hybride porte les deux. */
function libelle(langue, cle) {
  if (langue === "fr") return LIBELLES.fr[cle];
  if (langue === "ar") return `<span class="ar">${LIBELLES.ar[cle]}</span>`;
  return `${LIBELLES.fr[cle]} <span class="ar">/ ${LIBELLES.ar[cle]}</span>`;
}

export const echapper = (t) =>
  String(t).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/* ------------------------------------------------------------- la page */

export function html(cas) {
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
  /*
   * Ce que le jeu d'ALGORIA (`outils/jeu-algoria/`) mesure en plus : un texte
   * de l'en-tête devient un champ quand le cas l'imprime sous ce chemin, et des
   * lignes s'ajoutent (RC, RIB, règlement, mentions). Sans ces chemins — le jeu
   * synthétique — la page est celle d'avant, à l'octet.
   */
  const zone = (chemin, texte) =>
    p.imprime[chemin] !== undefined ? champ(chemin, { ltr: false }) : echapper(texte);
  const ligne = (chemin, cle) =>
    p.imprime[chemin] !== undefined ? `<div>${cle ? `${L(cle)} ` : ""}${champ(chemin)}</div>` : "";
  const mention = (chemin) =>
    p.imprime[chemin] !== undefined
      ? `<div class="mention">${champ(chemin, { ltr: false })}</div>`
      : "";
  const lettresDe = (texte) => {
    const mots = p.imprime.montant_en_lettres;
    const i = mots === undefined ? -1 : texte.indexOf(mots);
    if (i < 0) return echapper(texte);
    return `${echapper(texte.slice(0, i))}${champ("montant_en_lettres", { ltr: false })}${echapper(texte.slice(i + mots.length))}`;
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
    <div>${zone("adresse_emetteur", p.emetteur.adresse)}</div>
    <div>${L("mf")} ${champ("references.matricule_fiscal")}</div>
    <div>${L("tel")} ${p.imprime.telephone_emetteur !== undefined ? champ("telephone_emetteur") : `<span dir="ltr">${p.emetteur.telephone}</span>`}</div>${ligne("forme_juridique")}${ligne("registre_commerce_emetteur", "rc")}${ligne("rib_emetteur", "rib")}
  </div>
  <div class="bloc client">
    <div>${L("client")} ${zone("nom_client", p.client.nom)}</div>
    <div>${zone("adresse_client", p.client.adresse)}</div>
    <div>${L("mfClient")} ${champ("references.matricule_fiscal_client")}</div>${ligne("mode_reglement", "reglement")}
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
${p.enLettres ? `<div class="lettres ${manuscrit ? "main" : ""}">${lettresDe(p.enLettres)}</div>` : ""}${mention("mention_exoneration")}${mention("mention_export")}
<div class="cachet">${L("cachet")}</div>
</div></body></html>`;
}

/* ------------------------------------------------------------- les boîtes */

/**
 * Les boîtes, en fractions de la PAGE : celle de la feuille pour un PDF (le
 * PDF est la feuille), celle de la vue pour une photo (la photo est la vue).
 */
export async function boites(page, pdf) {
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
export function pdfFige(octets) {
  const texte = Buffer.from(octets).toString("latin1");
  const fige = texte.replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, (m, cle) => {
    const date = "D:20261031000000+00'00'";
    const brut = m.slice(cle.length + 3, -1);
    return `/${cle} (${date.padEnd(brut.length, " ").slice(0, Math.max(brut.length, date.length))})`;
  });
  if (fige.length !== texte.length) throw new Error("la date figée change la longueur du PDF");
  return Buffer.from(fige, "latin1");
}
