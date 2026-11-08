/**
 * Les mises en page du jeu d'ALGORIA, en HTML que Chromium dessine.
 *
 * - A : le « Bon de Livraison/Facture » d'un magasin de détail, tel que le
 *   dirigeant en a reçu un (fournisseur en haut à gauche, « Livré à » en haut à
 *   droite, tableau d'en-tête où la date jouxte le numéro, prix TTC et montants
 *   HT, numéros de série sous les lignes, « Total avec Timbre », RIB / MF / RC
 *   du fournisseur en bas à droite) ;
 * - B, C, D : la facture classique du jeu synthétique (`page.mjs`), en
 *   français, en arabe, bilingue — reprise telle quelle ;
 * - E, F : le carnet à souche rempli à la main, en français et en arabe, avec
 *   son en-tête pré-imprimé, son numéro rouge, son papier carbone.
 *
 * Chaque valeur imprimée porte `data-champ` (son chemin dans `piece.imprime`) :
 * le rendu en mesure la boîte. Le tampon, la signature et l'annotation sont
 * posés par `realisme.mjs`.
 */
import { createRequire } from "node:module";

import { mulberry32 } from "../jeu-synthetique/hasard.mjs";
import { echapper, html as pageClassique, POLICES, police } from "../jeu-synthetique/page.mjs";

const require = createRequire(import.meta.url);

/** Les graisses que le jeu synthétique ne charge pas : la seconde main, le carnet. */
export const POLICES_EN_PLUS = `
@font-face { font-family: "Main2"; src: url(${police(require.resolve("@fontsource/caveat/files/caveat-latin-700-normal.woff2"))}); }
@font-face { font-family: "Main2"; src: url(${police(require.resolve("@fontsource/caveat/files/caveat-latin-ext-700-normal.woff2"))}); unicode-range: U+0100-024F; }
@font-face { font-family: "MainArabe2"; src: url(${police(require.resolve("@fontsource/aref-ruqaa/files/aref-ruqaa-arabic-700-normal.woff2"))}); }
@font-face { font-family: "MainArabe2"; src: url(${police(require.resolve("@fontsource/aref-ruqaa/files/aref-ruqaa-latin-700-normal.woff2"))}); unicode-range: U+0000-00FF; }
`;

/** Une valeur imprimée, dans une boîte mesurée. */
export function champ(p, chemin, { classe = "", style = "" } = {}) {
  const texte = p.imprime[chemin];
  if (texte === undefined) return "";
  // Des chiffres orientaux seuls (matricule, date, montant) se lisent de gauche à droite.
  const arabe = /[\u0621-\u064A]/.test(texte);
  return `<span data-champ="${chemin}" class="${classe}" ${arabe ? "" : 'dir="ltr"'} ${style ? `style="${style}"` : ""}>${echapper(texte)}</span>`;
}

/* ================================================================ A — détail */

function pageDetail(cas) {
  const p = cas.piece;
  const f = (c, o) => champ(p, c, o);
  const dense = cas.scenario === "dense";
  const e = p.emetteur;
  const c = p.client;
  const lignes = p.articles
    .map(
      (a, k) => `<tr class="art">
  <td>${f(`articles[${k}].reference`)}</td><td class="cb">${a.codeBarre}</td>
  <td class="g">${f(`articles[${k}].designation`)}</td><td>${f(`articles[${k}].quantity`)}</td>
  <td>${f(`articles[${k}].unit_price_ttc`)}</td><td>${a.remise}</td>
  <td>${f(`articles[${k}].total_ht`)}</td><td>${a.taux}</td></tr>${a.sousLignes
    .map(
      (s) =>
        `<tr class="sous"><td></td><td></td><td class="g">${echapper(s)}</td><td></td><td></td><td></td><td></td><td></td></tr>`,
    )
    .join("")}`,
    )
    .join("");
  const timbre = p.droits.indexOf("DROIT_TIMBRE");
  const recap = p.tableauParTaux
    ? `<table class="recap"><tr><th>Taux</th><th>Base HT</th><th>Montant TVA</th></tr>${p.parTaux
        .map(
          (l, i) =>
            `<tr><td>${l.tauxImprime}</td><td>${f(`lines[${i}].base_ht`)}</td><td>${f(`lines[${i}].vat_amount`)}</td></tr>`,
        )
        .join("")}</table>`
    : "<div></div>";
  return `<!doctype html><html lang="fr" dir="ltr"><head><meta charset="utf-8"><style>
${POLICES}${POLICES_EN_PLUS}
@page { size: 210mm 297mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: 210mm; height: 297mm; background: #fff; color: #111; font-family: "Imprime"; font-size: ${dense ? "6.1pt" : "7.6pt"}; line-height: ${dense ? 1.12 : 1.3}; }
.feuille { position: relative; width: 210mm; height: 297mm; padding: ${dense ? "6mm 8mm" : "10mm 11mm"}; box-sizing: border-box; background: #fff; overflow: hidden; }
.haut { display: flex; justify-content: space-between; gap: 6mm; }
.four { width: 45%; }
.marque { font-weight: 700; font-size: ${dense ? "13pt" : "17pt"}; letter-spacing: 1px; line-height: 1.05; }
.marque small { display: block; font-size: ${dense ? "6pt" : "7pt"}; font-weight: 400; letter-spacing: 2px; color: #555; text-transform: uppercase; }
.livre { width: 53%; border: 1px solid #222; padding: 2mm 3mm; border-radius: 2mm; }
.livre .t { font-weight: 700; text-decoration: underline; }
.une { white-space: nowrap; font-size: 0.84em; letter-spacing: -0.1px; }
.titre { display: flex; justify-content: space-between; align-items: baseline; margin: ${dense ? "2.5mm" : "5mm"} 0 1.5mm; border-bottom: 2px solid #111; }
.titre .t { font-size: ${dense ? "11pt" : "14pt"}; font-weight: 700; }
.titre .n { font-size: ${dense ? "8pt" : "10pt"}; font-weight: 700; }
table { border-collapse: collapse; width: 100%; }
table.entete th, table.entete td { border: 1px solid #555; padding: 0.6mm 1.5mm; text-align: center; }
table.entete th { background: #e8e8e8; font-weight: 700; }
table.articles { margin-top: ${dense ? "1.5mm" : "3mm"}; }
table.articles th { background: #e8e8e8; border: 1px solid #555; padding: 0.8mm 1mm; font-weight: 700; }
table.articles td { padding: ${dense ? "0 1mm" : "0.6mm 1mm"}; vertical-align: top; text-align: end; border-left: 1px solid #bbb; border-right: 1px solid #bbb; }
table.articles td.g { text-align: start; }
table.articles td.cb { text-align: start; font-family: "Imprime"; letter-spacing: 0.3px; }
table.articles tr.art td { border-top: 1px dotted #bbb; }
table.articles tr.sous td { font-size: 0.88em; color: #333; line-height: 1.02; }
table.articles tbody { border-bottom: 1px solid #555; }
.bas { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 2mm; gap: 6mm; }
table.recap { width: 48%; }
table.recap th, table.recap td { border: 1px solid #777; padding: 0.4mm 1.5mm; text-align: end; }
table.totaux { width: 44%; }
table.totaux th { text-align: start; font-weight: 400; padding: 0.4mm 2mm; }
table.totaux td { text-align: end; padding: 0.4mm 2mm; }
table.totaux tr.ttc th, table.totaux tr.ttc td { font-weight: 700; font-size: 1.15em; border-top: 1.5px solid #111; }
.arretee { margin-top: 2mm; font-weight: 700; }
.pied { display: flex; justify-content: space-between; gap: 6mm; margin-top: ${dense ? "2mm" : "4mm"}; border-top: 1px solid #999; padding-top: 1.5mm; }
.legal { width: 60%; font-size: 0.86em; color: #333; text-align: justify; }
.ids { width: 36%; text-align: end; }
</style></head><body><div class="feuille">
<div class="haut">
  <div class="four">
    <div class="marque" style="color:${e.couleur ?? "#0a0a0a"}">${echapper(e.enseigne ?? "ALGORIA FACTORY")}<small>${echapper(e.slogan ?? "IA souveraine pour la finance")}</small></div>
    <div><b>${f("issuer")}</b>${p.imprime.forme_juridique ? ` — ${f("forme_juridique")}` : ""}</div>
    <div>${f("adresse_emetteur")}</div>
    <div>Tél: ${f("telephone_emetteur")}${e.fax ? ` &nbsp; Fax: <span dir="ltr">${e.fax}</span>` : ""}</div>
    ${e.email ? `<div>Email: ${echapper(e.email)}</div>` : ""}
    ${e.site ? `<div>Site web: ${echapper(e.site)}</div>` : ""}
  </div>
  <div class="livre">
    <div class="t">Livré à:</div>
    <div><b>${f("nom_client")}</b></div>
    <div>${f("adresse_client")}</div>
    <div>Tel: <span dir="ltr">${c.telephone}</span></div>
    <div class="une">MF/CIN: ${f("references.matricule_fiscal_client")} &nbsp; RC: ${echapper(c.rc)} &nbsp; Mode de règlement: ${f("mode_reglement")}</div>
  </div>
</div>
<div class="titre"><span class="t">${echapper(p.titre)}</span><span class="n">N° ${f("references.numero")}</span></div>
<table class="entete">
  <tr><th>Date</th><th>Numéro pièce</th><th>Client</th><th>Votre référence</th><th>Chargé(e)</th></tr>
  <tr><td>${f("document_date")}</td><td>${echapper(p.imprime["references.numero"])}</td><td>${f("code_client")}</td><td>${echapper(p.votreReference)}</td><td>${echapper(p.chargee)}</td></tr>
</table>
<table class="articles"><thead><tr><th>Référence</th><th>Code à Barre</th><th class="g">Désignation</th><th>Qtité</th><th>PU TTC</th><th>R.</th><th>Montant</th><th>T</th></tr></thead>
<tbody>${lignes}</tbody></table>
<div class="bas">${recap}
  <table class="totaux">
    <tr><th>TOTAL HT:</th><td>${f("totals.base_ht")}</td></tr>
    <tr><th>TVA :</th><td>${f("totals.vat")}</td></tr>
    ${timbre >= 0 ? `<tr><th>Timbre fiscal:</th><td>${f(`other_charges[${timbre}].amount`)}</td></tr><tr><th>Total avec Timbre:</th><td dir="ltr">${p.totalAvecTimbre}</td></tr>` : ""}
    <tr class="ttc"><th>TTC:</th><td>${f("totals.ttc")} DNT</td></tr>
  </table>
</div>
${p.imprime.mention_exoneration ? `<div>${f("mention_exoneration")}</div>` : ""}
${p.enLettres ? `<div class="arretee">Arrêtée la présente pièce à la somme de: ${f("montant_en_lettres")}</div>` : ""}
<div class="pied">
  <div class="legal">${f("conditions_generales")}</div>
  <div class="ids">RIB: ${f("rib_emetteur")}<br>MF: ${f("references.matricule_fiscal")}<br>RC: ${f("registre_commerce_emetteur")}</div>
</div>
</div></body></html>`;
}

/* ============================================================ E, F — carnet */

/**
 * La main qui écrit une valeur : police manuscrite, ligne de base et
 * inclinaison irrégulières (tirées de `h`), et la valeur barrée d'une rature
 * écrite juste avant. `m` : la première main (`m1`) ou la seconde (`m2`).
 */
export function uneMain(p, h) {
  return (chemin, m) => {
    const jitter = `transform:translateY(${((h() - 0.5) * 4).toFixed(1)}px) rotate(${((h() - 0.5) * 3).toFixed(1)}deg)`;
    const barre = (p.ratures ?? []).find((r) => r.chemin === chemin);
    const avant = barre
      ? `<span class="main ${m} rature" style="display:inline-block">${echapper(barre.barre)}</span> `
      : "";
    return `${avant}${champ(p, chemin, { classe: `main ${m}`, style: `display:inline-block;${jitter}` })}`;
  };
}

/** Les deux mains et la rature, en CSS : l'encre de la première main est celle du cas. */
export const cssDeLaMain = (ar, encre) =>
  `.main { font-family: ${ar ? '"MainArabe", "Main"' : '"Main", "MainArabe"'}; font-size: ${ar ? "1.45em" : "1.65em"}; color: ${encre}; text-shadow: 0 0 0.6px ${encre}, 0.4px 0.3px 0.9px rgba(30,30,90,0.45); }
.main.m2 { font-family: ${ar ? '"MainArabe2", "Main2"' : '"Main2", "MainArabe2"'}; color: #1b1b1f; transform: skewX(-12deg); letter-spacing: -0.3px; }
.rature { text-decoration: line-through; text-decoration-thickness: 2px; opacity: 0.85; }
`;

const CARNET = {
  fr: {
    facture: "FACTURE N°",
    date: "Date :",
    client: "Doit M. / Sté :",
    adresse: "Adresse :",
    mf: "M.F. :",
    designation: "Désignation",
    qte: "Qté",
    pu: "P.U.",
    montant: "Montant",
    ht: "Total H.T",
    remise: "Remise",
    fodec: "FODEC 1 %",
    tva: "T.V.A",
    totalTva: "Total T.V.A",
    base: "base",
    timbre: "Timbre",
    ttc: "Total T.T.C",
    lettres: "Arrêtée la présente facture à la somme de :",
    signature: "Signature et cachet",
    rc: "RC :",
    tel: "Tél :",
    reglement: "Règlement :",
    souche: "Souche — à conserver",
  },
  ar: {
    facture: "فاتورة عدد",
    date: "التاريخ :",
    client: "السيد / الشركة :",
    adresse: "العنوان :",
    mf: "المعرف الجبائي :",
    designation: "البيان",
    qte: "الكمية",
    pu: "سعر الوحدة",
    montant: "المبلغ",
    ht: "المجموع دون اعتبار الأداءات",
    remise: "التخفيض",
    fodec: "فوداك 1 %",
    tva: "الأداء على القيمة المضافة",
    totalTva: "مجموع الأداء على القيمة المضافة",
    base: "الأساس",
    timbre: "معلوم الطابع",
    ttc: "المجموع باعتبار الأداءات",
    lettres: "أوقفت هذه الفاتورة بمبلغ :",
    signature: "الإمضاء والختم",
    rc: "السجل التجاري :",
    tel: "الهاتف :",
    reglement: "طريقة الدفع :",
    souche: "الأرومة",
  },
};

function pageCarnet(cas) {
  const p = cas.piece;
  const ar = cas.langue === "ar";
  const L = CARNET[ar ? "ar" : "fr"];
  const h = mulberry32(cas.graineDuRendu ^ 0xca7e);
  // Deux écritures : celle du cas, et l'autre pour les totaux d'un carnet à deux mains.
  const main = cas.graineDuRendu % 2 === 0 ? "m1" : "m2";
  const autre = cas.realisme.includes("deux_ecritures") ? (main === "m1" ? "m2" : "m1") : main;
  const ecrire = uneMain(p, h);
  const ecrit = (chemin, m = main) => ecrire(chemin, m);
  const lignes = p.articles
    .map(
      (
        a,
        k,
      ) => `<tr><td class="g">${ecrit(`articles[${k}].designation`)}</td><td>${ecrit(`articles[${k}].quantity`)}</td>
  <td>${ecrit(`articles[${k}].unit_price_ht`)}</td><td>${ecrit(`articles[${k}].total_ht`)}</td></tr>`,
    )
    .join("");
  const vides = Array.from(
    { length: Math.max(0, 7 - p.articles.length) },
    () => "<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>",
  ).join("");
  const droit = (code) => p.droits.indexOf(code);
  const pied = [];
  if (p.remise) {
    pied.push(
      `<tr><th>${L.remise} <span dir="ltr">${p.remise.tauxImprime}</span></th><td><span class="main ${autre}">${echapper(p.remise.montant)}</span></td></tr>`,
    );
  }
  pied.push(`<tr><th>${L.ht}</th><td>${ecrit("totals.base_ht", autre)}</td></tr>`);
  if (droit("FODEC") >= 0)
    pied.push(
      `<tr><th>${L.fodec}</th><td>${ecrit(`other_charges[${droit("FODEC")}].amount`, autre)}</td></tr>`,
    );
  if (p.tableauParTaux) {
    p.parTaux.forEach((l, i) =>
      pied.push(
        `<tr><th>${L.tva} <span dir="ltr">${l.tauxImprime}</span> — ${L.base} ${ecrit(`lines[${i}].base_ht`, autre)}</th><td>${ecrit(`lines[${i}].vat_amount`, autre)}</td></tr>`,
      ),
    );
    pied.push(`<tr><th>${L.totalTva}</th><td>${ecrit("totals.vat", autre)}</td></tr>`);
  } else
    pied.push(
      `<tr><th>${L.tva} <span dir="ltr">${p.parTaux[0].tauxImprime}</span></th><td>${ecrit("totals.vat", autre)}</td></tr>`,
    );
  if (droit("DROIT_TIMBRE") >= 0)
    pied.push(
      `<tr><th>${L.timbre}</th><td>${ecrit(`other_charges[${droit("DROIT_TIMBRE")}].amount`, autre)}</td></tr>`,
    );
  pied.push(`<tr class="ttc"><th>${L.ttc}</th><td>${ecrit("totals.ttc", autre)}</td></tr>`);
  const e = p.emetteur;
  const encre = main === "m1" ? "#27307f" : "#1b1b1f";
  return `<!doctype html><html lang="${ar ? "ar" : "fr"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>
${POLICES}${POLICES_EN_PLUS}
@page { size: 210mm 297mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: 210mm; height: 297mm; background: #f3f1ec; color: #2c4f9e; font-family: ${ar ? '"Naskh", "Imprime"' : '"Imprime", "Naskh"'}; font-size: ${ar ? "9.4pt" : "10pt"}; }
.feuille { position: relative; width: 210mm; height: 297mm; padding: 9mm 12mm 8mm 12mm; padding-inline-start: 38mm; box-sizing: border-box; background: #f3f1ec; overflow: hidden; }
.souche { position: absolute; top: 0; bottom: 0; inset-inline-start: 0; width: 30mm; border-inline-end: 2px dashed #9aa6c8; padding: 14mm 3mm; box-sizing: border-box; font-size: 8pt; color: #7b86ad; }
.souche .no { color: #c0392b; font-size: 12pt; font-weight: 700; margin-top: 4mm; }
.preimprime { border: 1.5px solid #2c4f9e; border-radius: 2mm; padding: 3mm 4mm; }
.preimprime .nom { font-size: 15pt; font-weight: 700; }
.numero { margin: 3mm 0 2mm; font-size: 14pt; font-weight: 700; display: flex; justify-content: space-between; }
.numero .rouge { color: #c0392b; letter-spacing: 1px; }
.champ { border-bottom: 1px dotted #2c4f9e; min-height: 7mm; margin: 1mm 0; }
table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
table.lignes th { border: 1.2px solid #2c4f9e; padding: 1.5mm; background: rgba(44,79,158,0.07); }
table.lignes td { border-inline: 1.2px solid #2c4f9e; border-bottom: 1px solid rgba(44,79,158,0.35); height: 2.15em; padding: 0 2mm; text-align: end; }
table.lignes td.g { text-align: start; }
table.lignes tr:last-child td { border-bottom: 1.2px solid #2c4f9e; }
table.pied { width: 70%; margin-inline-start: auto; }
table.pied th { text-align: start; font-weight: 400; padding: 0.6mm 2mm; border-bottom: 1px dotted #2c4f9e; }
table.pied td { text-align: end; padding: 0.6mm 2mm; min-width: 35mm; border-bottom: 1px dotted #2c4f9e; }
table.pied tr.ttc th { font-weight: 700; }
.lettres { margin-top: 2mm; }
.signature { margin-top: 3mm; margin-inline-start: auto; width: 70mm; height: 22mm; text-align: center; font-size: 9pt; }
${cssDeLaMain(ar, encre)}</style></head><body><div class="feuille">
<div class="souche"><div>${L.souche}</div><div class="no">N° <span dir="ltr">${echapper(p.imprime["references.numero"])}</span></div></div>
<div class="preimprime">
  <div class="nom">${champ(p, "issuer")}</div>
  <div>${champ(p, "adresse_emetteur")}</div>
  <div>${L.tel} ${champ(p, "telephone_emetteur")} &nbsp; ${p.imprime.registre_commerce_emetteur ? `${L.rc} ${champ(p, "registre_commerce_emetteur")}` : ""}</div>
</div>
<div class="numero"><span>${L.facture} <span class="rouge">${champ(p, "references.numero")}</span></span><span style="font-size:10pt;font-weight:400">${L.date} ${ecrit("document_date")}</span></div>
<div class="champ">${L.client} ${ecrit("nom_client")}</div>
<div class="champ">${L.adresse} ${ecrit("adresse_client")}</div>
<div class="champ">${p.imprime["references.matricule_fiscal_client"] !== undefined ? `${L.mf} ${ecrit("references.matricule_fiscal_client")}` : `${L.mf}`}</div>
${p.imprime.mode_reglement ? `<div class="champ">${L.reglement} ${ecrit("mode_reglement")}</div>` : ""}
<table class="lignes"><thead><tr><th class="g">${L.designation}</th><th>${L.qte}</th><th>${L.pu}</th><th>${L.montant}</th></tr></thead>
<tbody>${lignes}${vides}</tbody></table>
<table class="pied">${pied.join("")}</table>
${p.imprime.mention_exoneration ? `<div>${ecrit("mention_exoneration", autre)}</div>` : ""}
${p.enLettres ? `<div class="lettres">${L.lettres} ${ecrit("montant_en_lettres", autre)}</div>` : ""}
<div class="signature">${L.signature}</div>
</div></body></html>`;
}

/** La page d'un cas, selon son gabarit. */
export function page(cas) {
  if (cas.gabarit === "A") return pageDetail(cas);
  if (cas.gabarit === "E" || cas.gabarit === "F") return pageCarnet(cas);
  return pageClassique(cas);
}
