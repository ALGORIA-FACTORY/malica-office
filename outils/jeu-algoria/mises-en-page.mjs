/**
 * Les mises en page des pièces qui ne sont pas des factures (cas 121 à 161),
 * en HTML que Chromium dessine.
 *
 * Une pièce se décrit par ses BLOCS (`cas.piece.blocs`), posés par
 * `pieces.mjs` : en-tête, titre, champs étiquetés, tableau, texte d'acte,
 * cases d'un formulaire, cadre d'un chèque ou d'une carte, rouleau d'un
 * ticket, signatures. Le cas porte ainsi sa page entière, et ce fichier n'en
 * connaît que la forme — jamais le contenu.
 *
 * Les gabarits :
 * - G : le document de gestion imprimé (formulaire, relevé, bulletin,
 *   déclaration) — `style` « encadre » (sections encadrées, bandeaux gris) ou
 *   « bande » (bandeau de couleur, filets seuls) ;
 * - H : l'acte (procès-verbal, statuts, contrat, bail, attestation) — texte
 *   justifié, titres centrés ; `police` « machine » pour l'acte dactylographié ;
 * - I : le ticket de caisse, rouleau étroit au milieu de la page ;
 * - J : le formulaire pré-imprimé rempli à la main (reçu, bon de livraison,
 *   note de frais), souche et numéro rouge ;
 * - K : la petite pièce posée seule (chèque, carte d'identification fiscale).
 *
 * Les morceaux d'un bloc : un texte ; `{ c }` une valeur imprimée (son chemin
 * dans `piece.imprime`, mesuré par `data-champ`) ; `{ c, imp }` une valeur
 * pré-imprimée sur une page manuscrite ; `{ c, m2 }` la seconde main ;
 * `{ t, cls }` un texte stylé ; `{ main }` un texte écrit à la main hors
 * champ ; `{ qr }` un motif de code QR tiré de son texte ; `{ barres }` le
 * barrement d'un chèque ; `{ br }` un retour à la ligne.
 */
import { mulberry32 } from "../jeu-synthetique/hasard.mjs";
import { echapper, POLICES } from "../jeu-synthetique/page.mjs";

import { champ, cssDeLaMain, POLICES_EN_PLUS, uneMain } from "./gabarits.mjs";

/** Un motif de code QR, tiré de son texte : 21 × 21 modules et trois repères. */
function motifQr(texte) {
  let graine = 7;
  for (const c of texte) graine = (Math.imul(graine, 31) + c.charCodeAt(0)) >>> 0;
  const h = mulberry32(graine);
  const n = 21;
  const repere = (x, y) => {
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      const dx = x - ox;
      const dy = y - oy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7)
        return (
          dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5)
        );
    }
    return null;
  };
  let carres = "";
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1) {
      const r = repere(x, y);
      if (r ?? h() < 0.47) carres += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  return `<svg class="qr" viewBox="-1 -1 ${n + 2} ${n + 2}" width="22mm" height="22mm" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><g fill="#111">${carres}</g></svg>`;
}

/** La page d'une pièce, d'après ses blocs. */
export function pagePiece(cas) {
  const p = cas.piece;
  const ar = cas.langue === "ar";
  const h = mulberry32(cas.graineDuRendu ^ 0xb10c);
  const ecrire = uneMain(p, h);
  const main = cas.graineDuRendu % 2 === 0 ? "m1" : "m2";
  const seconde = main === "m1" ? "m2" : "m1";
  const manuscrit = cas.gabarit === "J" || p.main === true;

  /* les morceaux */
  const m = (x) => {
    if (x === null || x === undefined) return "";
    if (typeof x === "string") return echapper(x);
    if (Array.isArray(x)) return x.map(m).join("");
    if (x.br) return "<br>";
    if (x.qr !== undefined) return motifQr(x.qr);
    if (x.barres !== undefined)
      return `<span data-champ="${x.barres}" class="barres" aria-label="barrement"></span>`;
    if (x.main !== undefined)
      return `<span class="main ${main}" style="display:inline-block">${echapper(x.main)}</span>`;
    if (x.t !== undefined) return `<span class="${x.cls ?? ""}">${echapper(x.t)}</span>`;
    if (x.c !== undefined) {
      if (p.imprime[x.c] === undefined) throw new Error(`${cas.id} : chemin non imprimé ${x.c}`);
      if (manuscrit && !x.imp) return ecrire(x.c, x.m2 ? seconde : main);
      return champ(p, x.c, { classe: x.cls ?? "" });
    }
    throw new Error(`${cas.id} : morceau inconnu ${JSON.stringify(x)}`);
  };
  const lignes = (ls) => (ls ?? []).map((l) => `<div>${m(l)}</div>`).join("");

  /* les blocs */
  const bloc = (b) => {
    switch (b.k) {
      case "entete":
        return `<div class="entete"><div class="g">${lignes(b.gauche)}</div>${b.centre ? `<div class="c">${lignes(b.centre)}</div>` : ""}<div class="d">${lignes(b.droite)}</div></div>`;
      case "titre":
        return `<div class="titre"><div class="t">${m(b.texte)}</div>${b.sous ? `<div class="s">${m(b.sous)}</div>` : ""}</div>`;
      case "section":
        return `<div class="section">${m(b.texte)}</div>`;
      case "champs": {
        const cellules = b.lignes
          .map(
            ([l, v]) =>
              `<div class="kv"><span class="l">${m(l)}</span> <span class="v">${m(v)}</span></div>`,
          )
          .join("");
        return `<div class="champs col${b.colonnes ?? 1}">${cellules}</div>`;
      }
      case "tableau": {
        const num = new Set(b.nombres ?? []);
        const td = (c, i) => `<td class="${num.has(i) ? "n" : ""}">${m(c)}</td>`;
        const th = (c, i) => `<th class="${num.has(i) ? "n" : ""}">${m(c)}</th>`;
        const vides = Array.from(
          { length: Math.max(0, (b.minimum ?? 0) - b.lignes.length) },
          () => `<tr>${b.entetes.map(() => "<td>&nbsp;</td>").join("")}</tr>`,
        ).join("");
        const pied = (b.pied ?? [])
          .map(
            ([l, v]) =>
              `<tr class="pied"><th colspan="${b.entetes.length - 1}">${m(l)}</th><td class="n">${m(v)}</td></tr>`,
          )
          .join("");
        return `<table class="tableau ${b.classe ?? ""}"><thead><tr>${b.entetes.map(th).join("")}</tr></thead><tbody>${b.lignes.map((l) => `<tr>${l.map(td).join("")}</tr>`).join("")}${vides}${pied}</tbody></table>`;
      }
      case "texte":
        return `<p class="texte ${b.classe ?? ""}">${m(b.morceaux)}</p>`;
      case "cases":
        return `<table class="cases">${b.lignes
          .map(
            ([code, l, v]) =>
              `<tr><td class="code">${echapper(code)}</td><td class="l">${m(l)}</td><td class="v">${m(v)}</td></tr>`,
          )
          .join("")}</table>`;
      case "signatures":
        return `<div class="signatures"><div class="sg">${m(b.gauche)}</div><div class="cachet">${m(b.droite)}</div></div>`;
      case "duo":
        return `<div class="duo"><div>${b.gauche.map(bloc).join("")}</div><div>${b.droite.map(bloc).join("")}</div></div>`;
      case "cadre":
        return `<div class="cadre ${b.style}">${b.blocs.map(bloc).join("")}</div>`;
      case "rouleau":
        return `<div class="rouleau">${b.blocs.map(bloc).join("")}</div>`;
      case "espace":
        return `<div style="height:${b.h}"></div>`;
      default:
        throw new Error(`${cas.id} : bloc inconnu ${b.k}`);
    }
  };

  const g = cas.gabarit;
  const machine = p.police === "machine";
  const couleur = p.couleur ?? "#1f3b63";
  const encre = main === "m1" ? "#27307f" : "#1b1b1f";
  const familles = ar
    ? `"Naskh", "Imprime"`
    : machine || g === "I"
      ? `"Machine", "Imprime", "Naskh"`
      : `"Imprime", "Naskh"`;
  const taille = { G: "8.6pt", H: machine ? "9.6pt" : "9.4pt", I: "8.8pt", J: "9.6pt", K: "9pt" }[
    g
  ];
  const fond = g === "J" ? "#f4f1e8" : "#fff";
  const souche = p.souche
    ? `<div class="souche"><div>${echapper(p.souche.texte)}</div><div class="no">N° <span dir="ltr">${echapper(p.souche.numero)}</span></div></div>`
    : "";
  return `<!doctype html><html lang="${ar ? "ar" : "fr"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>
${POLICES}${POLICES_EN_PLUS}
@page { size: 210mm 297mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: 210mm; height: 297mm; background: ${g === "K" ? "transparent" : fond}; color: #141414; font-family: ${familles}; font-size: ${taille}; line-height: ${g === "H" ? 1.42 : 1.3}; }
.feuille { position: relative; width: 210mm; height: 297mm; padding: ${g === "H" ? "14mm 17mm" : g === "J" ? "10mm 12mm" : "10mm 12mm"}; ${p.souche ? "padding-inline-start: 38mm;" : ""} box-sizing: border-box; background: ${g === "K" ? "transparent" : fond}; overflow: hidden; }
${g === "K" ? ".feuille { box-shadow: none !important; }" : ""}
.entete { display: flex; justify-content: space-between; gap: 6mm; margin-bottom: 3mm; }
.entete .g { max-width: 55%; } .entete .d { text-align: end; max-width: 45%; } .entete .c { text-align: center; flex: 1; }
.titre { text-align: center; margin: 3mm 0 3mm; }
.titre .t { font-size: 1.55em; font-weight: 700; letter-spacing: 0.4px; }
.titre .s { font-size: 1.02em; margin-top: 1mm; }
.section { font-weight: 700; margin: 2.6mm 0 1.2mm; padding: 0.6mm 2mm; }
.champs { display: grid; gap: 0.6mm 6mm; margin: 1mm 0 2mm; }
.champs.col1 { grid-template-columns: 1fr; } .champs.col2 { grid-template-columns: 1fr 1fr; } .champs.col3 { grid-template-columns: 1fr 1fr 1fr; }
.kv .l { color: #444; }
.kv .v { font-weight: 600; }
table { border-collapse: collapse; width: 100%; }
table.tableau { margin: 1.5mm 0 2mm; }
table.tableau th { background: #ececec; border: 1px solid #666; padding: 0.7mm 1.2mm; font-weight: 700; text-align: start; }
table.tableau td { border: 1px solid #999; padding: 0.5mm 1.2mm; vertical-align: top; }
table.tableau .n { text-align: end; white-space: nowrap; }
table.tableau tr.pied th { background: none; text-align: end; border: none; font-weight: 400; }
table.tableau tr.pied td { font-weight: 700; }
table.cases { margin: 1mm 0 2mm; }
table.cases td { border: 1px solid #555; padding: 0.7mm 1.5mm; }
table.cases td.code { width: 10mm; text-align: center; background: #efefef; font-family: "Imprime"; font-size: 0.9em; }
table.cases td.v { width: 38mm; text-align: end; white-space: nowrap; }
p.texte { margin: 1.2mm 0; text-align: justify; }
p.texte.centre { text-align: center; } p.texte.petit { font-size: 0.82em; color: #444; } p.texte.gras { font-weight: 700; }
p.texte.article { text-indent: 0; } p.texte .art { font-weight: 700; }
.signatures { display: flex; justify-content: space-between; margin-top: 6mm; gap: 10mm; padding-inline-end: 24mm; }
.signatures > div { width: 46%; min-height: 26mm; text-align: center; }
.duo { display: flex; gap: 6mm; } .duo > div { flex: 1; min-width: 0; }
.souche { position: absolute; top: 0; bottom: 0; inset-inline-start: 0; width: 30mm; border-inline-end: 2px dashed #9aa6c8; padding: 14mm 3mm; box-sizing: border-box; font-size: 8pt; color: #7b86ad; }
.souche .no { color: #c0392b; font-size: 12pt; font-weight: 700; margin-top: 4mm; }
.rouge { color: #c0392b; font-weight: 700; letter-spacing: 1px; }
.gros { font-size: 1.35em; font-weight: 700; }
.petit { font-size: 0.82em; color: #444; }
.codage { font-family: "Machine"; letter-spacing: 1.5px; font-size: 1.1em; color: #111; }
.barres { display: inline-block; width: 16mm; height: 9mm; border-left: 1.6px solid #222; border-right: 1.6px solid #222; transform: skewX(-28deg); vertical-align: middle; }
${cssDeLaMain(ar, encre)}
${
  g === "G"
    ? p.style === "bande"
      ? `.titre { background: ${couleur}; color: #fff; padding: 2mm; } .section { border-bottom: 1.5px solid ${couleur}; color: ${couleur}; padding-inline: 0; } table.tableau th { background: none; border: none; border-bottom: 1.5px solid ${couleur}; } table.tableau td { border: none; border-bottom: 1px solid #ccc; }`
      : `.titre { border: 2px solid #222; padding: 2mm; } .section { background: #e4e4e4; border: 1px solid #888; } .champs { border: 1px solid #aaa; padding: 1.5mm 2mm; }`
    : ""
}
${g === "H" ? `.titre .t { font-size: 1.4em; text-transform: ${ar ? "none" : "uppercase"}; } .section { text-align: center; text-decoration: underline; padding: 0; }` : ""}
${g === "I" ? `.rouleau { width: 78mm; margin: 6mm auto; padding: 4mm 4mm 10mm; background: #fbfaf6; box-shadow: 0 0 0 1px #ddd; text-align: center; line-height: 1.25; } .rouleau .champs { text-align: start; } .rouleau table.tableau th, .rouleau table.tableau td { border: none; padding: 0.2mm 0.6mm; background: none; font-weight: 400; } .rouleau table.tableau thead tr { border-bottom: 1px dashed #333; } .rouleau .section { border-top: 1px dashed #333; border-bottom: 1px dashed #333; padding: 0.5mm 0; } .rouleau .titre .t { font-size: 1.2em; } .signatures { display: none; }` : ""}
${g === "J" ? `body { color: #2c4f9e; } .titre .t { color: #2c4f9e; } .champs .kv { border-bottom: 1px dotted #2c4f9e; min-height: 7mm; } .kv .l { color: #2c4f9e; } table.tableau th { background: rgba(44,79,158,0.07); border-color: #2c4f9e; color: #2c4f9e; } table.tableau td { border-color: rgba(44,79,158,0.55); height: 2.1em; } .entete { border: 1.5px solid #2c4f9e; border-radius: 2mm; padding: 2.5mm 4mm; }` : ""}
${g === "K" ? `.cadre { background: #fdfcf7; box-shadow: 0 2px 10px rgba(0,0,0,0.35); position: relative; } .cadre.cheque { width: 186mm; height: 84mm; margin: 40mm auto 0; padding: 5mm 7mm; box-sizing: border-box; background: linear-gradient(115deg, #f4f8f1 0%, #e9f1ea 45%, #f6f4ea 100%); border: 1px solid #b8c7b6; } .cadre.carte { width: 150mm; min-height: 96mm; margin: 50mm auto 0; padding: 6mm 8mm; box-sizing: border-box; border: 1.5px solid #6a7d92; border-radius: 4mm; background: linear-gradient(160deg, #f7f9fb, #eaf0f5); } .cadre .signatures { margin-top: 2mm; } .cadre .signatures > div { min-height: 14mm; }` : ""}
</style></head><body><div class="feuille">
${souche}${p.blocs.map(bloc).join("\n")}
</div></body></html>`;
}
