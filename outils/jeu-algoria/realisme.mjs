/**
 * Le réel autour de la page : tampon, signature, annotation, et la prise de
 * vue — photo de téléphone sur un bureau, ou passage au scanner.
 *
 * Tout ce qui varie est tiré de la graine du cas (`mulberry32`) et dessiné par
 * Chromium lui-même (CSS, SVG, canevas) : relancer le rendu redonne les mêmes
 * octets, à version de Chromium et de polices égale.
 *
 * Les effets, nommés comme dans `cas.realisme` :
 * - photo : `fond_bureau`, `perspective` (trapèze), `rotation`,
 *   `eclairage_inegal`, `flou`, `ombre_main` (l'ombre de la main et du
 *   téléphone), `froisse` (relief du papier), `pli` (ombre et reflet d'un pli) ;
 * - scan : `biais`, `grain`, `photocopie` (gris dur, points de toner, traînée,
 *   bord noir du couvercle), `pale` (page passée) ;
 * - sur le papier : `tampon` (rond, à l'encre, irrégulier), `signature`,
 *   `annotation` (« Payé le… », « Reçu ») ;
 * - carnet : `souche_carbone`, `ratures`, `deux_ecritures`, `chiffres_orientaux`
 *   (posés par `gabarits.mjs`).
 */
import { echapper } from "../jeu-synthetique/page.mjs";
import { mulberry32 } from "../jeu-synthetique/hasard.mjs";

import { POLICES_EN_PLUS } from "./gabarits.mjs";

const entre = (h, a, b) => a + h() * (b - a);
const fixe = (x, n = 2) => x.toFixed(n);

/* ---------------------------------------------------------------- l'ancrage */

/*
 * Où se posent le tampon et la signature, par rapport à un élément de la page
 * (décalages en px CSS) : sur le ticket, au pied, à gauche des identifiants du
 * fournisseur ; sur la facture classique, sur le cadre « Cachet et
 * signature » ; sur le carnet, sous « Signature et cachet », la signature sous
 * le matricule du tampon — elle le frôle sans le couvrir. L'annotation va dans
 * un blanc de la page : sous le pied du ticket, à gauche du cadre du cachet.
 */
const ANCRES = {
  A: {
    tampon: [".pied", [200, 300], [-12, 18]],
    signature: [".pied", [60, 160], [-12, 10]],
    annotation: [".pied", [300, 450], [40, 80]],
  },
  carnet: {
    tampon: [".signature", [0, 30], [14, 26]],
    signature: [".signature", [100, 160], [96, 116]],
  },
  classique: {
    tampon: [".cachet", [-20, 30], [-40, -8]],
    signature: [".cachet", [70, 130], [18, 40]],
    annotation: [".cachet", [-300, -190], [0, 40]],
  },
};
function ancrage(cas, marque, h) {
  const g =
    cas.gabarit === "A" ? "A" : cas.gabarit === "E" || cas.gabarit === "F" ? "carnet" : "classique";
  const [ancre, [x0, x1], [y0, y1]] = ANCRES[g][marque];
  return `data-ancre="${ancre}" data-dx="${Math.floor(entre(h, x0, x1))}" data-dy="${Math.floor(entre(h, y0, y1))}"`;
}

/* ---------------------------------------------------------------- le tampon */

function tampon(cas, h) {
  const p = cas.piece;
  const e = p.emetteur;
  const arabe = cas.langue === "ar" && e.nomAr && e.role !== "dossier";
  const nom = (arabe ? e.nomAr : e.nom).toUpperCase();
  const ville = (
    cas.langue === "ar" ? e.adresse.split("،").pop() : e.adresse.split(",").pop()
  ).trim();
  const encre = ["#2747b5", "#4b3aa6", "#a3302b", "#1f5f9e"][Math.floor(h() * 4)];
  const angle = fixe(entre(h, -24, 24), 1);
  const graine = Math.floor(h() * 1000);
  const mf = p.tampon.porteLeMatricule ? p.imprime["references.matricule_fiscal"] : null;
  const centre = mf
    ? `<text x="80" y="76" text-anchor="middle" font-size="10" font-family="Imprime">M.F.</text>
       <text data-champ="references.matricule_fiscal" x="80" y="92" text-anchor="middle" font-size="12.5" font-weight="700" font-family="Imprime" direction="ltr">${echapper(mf)}</text>`
    : `<text x="80" y="78" text-anchor="middle" font-size="11" font-family="Imprime">${cas.langue === "ar" ? "الإدارة" : "LA DIRECTION"}</text>
       <text x="80" y="94" text-anchor="middle" font-size="9.5" font-family="Imprime" direction="ltr">Tél ${echapper(e.telephone)}</text>`;
  return `<div class="realisme tampon" data-champ="cachet_emetteur" ${ancrage(cas, "tampon", h)}
  style="position:absolute;width:42mm;height:42mm;transform:rotate(${angle}deg);opacity:${fixe(entre(h, 0.62, 0.86))};mix-blend-mode:multiply;z-index:5">
<svg viewBox="0 0 160 160" width="100%" height="100%" style="overflow:visible">
  <defs>
    <filter id="encre${graine}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${graine}"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>
    <path id="haut${graine}" d="M 18 80 A 62 62 0 0 1 142 80"/>
    <path id="bas${graine}" d="M 24 86 A 56 56 0 0 0 136 86"/>
  </defs>
  <g fill="${encre}" stroke="${encre}" filter="url(#encre${graine})">
    <circle cx="80" cy="80" r="76" fill="none" stroke-width="3.2"/>
    <circle cx="80" cy="80" r="52" fill="none" stroke-width="1.4"/>
    <text font-size="${nom.length > 26 ? 9.5 : 11.5}" font-weight="700" font-family="${arabe ? "Naskh" : "Imprime"}" stroke="none" letter-spacing="0.6"><textPath href="#haut${graine}" startOffset="50%" text-anchor="middle">${echapper(nom)}</textPath></text>
    <text font-size="10" font-family="${cas.langue === "ar" ? "Naskh" : "Imprime"}" stroke="none"><textPath href="#bas${graine}" startOffset="50%" text-anchor="middle">${echapper(ville)}</textPath></text>
    <g stroke="none">${centre}</g>
  </g>
</svg></div>`;
}

/* -------------------------------------------------------------- la signature */

function signature(cas, h) {
  let d = `M ${fixe(entre(h, 5, 25))} ${fixe(entre(h, 40, 60))}`;
  let x = 20;
  for (let i = 0; i < 5 + Math.floor(h() * 4); i += 1) {
    x += entre(h, 12, 30);
    d += ` C ${fixe(x - entre(h, 20, 35))} ${fixe(entre(h, 0, 90))}, ${fixe(x - entre(h, 0, 15))} ${fixe(entre(h, 0, 90))}, ${fixe(x)} ${fixe(entre(h, 25, 70))}`;
  }
  const trait = `M ${fixe(entre(h, 10, 40))} ${fixe(entre(h, 70, 85))} Q ${fixe(entre(h, 80, 120))} ${fixe(entre(h, 60, 95))} ${fixe(entre(h, 150, 190))} ${fixe(entre(h, 55, 80))}`;
  const encre = h() < 0.6 ? "#1d2a7a" : "#141418";
  return `<div class="realisme signature-main" data-champ="signature_emetteur" ${ancrage(cas, "signature", h)}
  style="position:absolute;width:52mm;height:24mm;transform:rotate(${fixe(entre(h, -12, 6), 1)}deg);z-index:6">
<svg viewBox="0 0 200 100" width="100%" height="100%"><path d="${d}" fill="none" stroke="${encre}" stroke-width="${fixe(entre(h, 1.3, 2.2))}" stroke-linecap="round" stroke-linejoin="round"/><path d="${trait}" fill="none" stroke="${encre}" stroke-width="1.4" stroke-linecap="round"/></svg></div>`;
}

/* ------------------------------------------------------------- l'annotation */

function annotation(cas, h) {
  const texte = cas.piece.annotation;
  const arabe = /[؀-ۿ]/.test(texte);
  return `<div class="realisme annotation" data-champ="annotation" ${ancrage(cas, "annotation", h)}
  style="position:absolute;white-space:nowrap;font-family:${arabe ? '"MainArabe"' : '"Main2"'};font-size:${fixe(entre(h, 17, 23), 1)}pt;color:${h() < 0.5 ? "#b3261e" : "#1d3c9c"};transform:rotate(${fixe(entre(h, -9, 5), 1)}deg);z-index:7" ${arabe ? 'dir="rtl"' : ""}>${echapper(texte)}${arabe ? "" : ` <span style="font-size:0.8em">✓</span>`}</div>`;
}

/** Les marques posées sur le papier, dans la feuille : elles en suivent la prise de vue. */
export function surLePapier(cas, html) {
  const h = mulberry32(cas.graineDuRendu ^ 0x7a3b);
  const r = cas.realisme;
  const marques = [
    r.includes("tampon") ? tampon(cas, h) : "",
    r.includes("signature") ? signature(cas, h) : "",
    r.includes("annotation") ? annotation(cas, h) : "",
  ].join("");
  const fin = "</div></body></html>";
  if (!html.endsWith(fin)) throw new Error(`${cas.id} : la page ne se termine pas par la feuille`);
  // La facture classique ne charge pas la seconde main : l'annotation en a besoin.
  const polices = html.includes('"Main2"') ? "" : `<style>${POLICES_EN_PLUS}</style>`;
  return `${html.slice(0, -fin.length)}${polices}${marques}${fin}`;
}

/**
 * Placer les marques sur leur ancre, une fois la page posée (polices
 * chargées) : à exécuter dans la page.
 */
export function placerLesMarques() {
  // Les mesures se prennent sur la page à plat : la prise de vue la transforme.
  document.body.style.setProperty("transform", "none", "important");
  const feuille = document.querySelector(".feuille");
  const f = feuille.getBoundingClientRect();
  for (const m of document.querySelectorAll("[data-ancre]")) {
    const a = document.querySelector(m.getAttribute("data-ancre"))?.getBoundingClientRect();
    if (!a) throw new Error(`ancre absente : ${m.getAttribute("data-ancre")}`);
    const dx = Number(m.getAttribute("data-dx"));
    const dy = Number(m.getAttribute("data-dy"));
    const largeur = m.offsetWidth;
    const gauche = Math.max(8, Math.min(f.width - largeur - 8, a.left - f.left + dx));
    const haut = Math.max(8, Math.min(f.height - m.offsetHeight - 8, a.top - f.top + dy));
    m.style.left = `${gauche}px`;
    m.style.top = `${haut}px`;
  }
  document.body.style.removeProperty("transform");
}

/* -------------------------------------------------------------- la prise de vue */

/** Le canevas du grain du papier (ou des points de toner), graine du cas. */
const grain = (graine, { fort = false, toner = false } = {}) => `
<canvas class="realisme" id="grain" width="794" height="1123" style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply;pointer-events:none;z-index:8"></canvas>
<script>
  (() => {
    const r = (${mulberry32})(${graine});
    const c = document.getElementById("grain").getContext("2d");
    const img = c.createImageData(794, 1123);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = ${fort ? 200 : 228} + Math.floor(r() * ${fort ? 55 : 27});
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v - 5; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    ${
      toner
        ? `c.fillStyle = "rgba(20,20,20,0.85)";
    for (let k = 0; k < 900; k += 1) { const x = r() * 794, y = r() * 1123, s = r() * 1.6 + 0.3; c.fillRect(x, y, s, s); }
    c.fillStyle = "rgba(60,60,60,0.25)"; const x = 40 + r() * 700; c.fillRect(x, 0, 1.5 + r() * 2, 1123);`
        : ""
    }
  })();
</script>`;

/**
 * La page dans sa prise de vue. Le papier (grain, pli, froissé) est posé DANS
 * la feuille ; le bureau, la lumière et l'ombre de la main, autour.
 */
export function prisDeVue(cas, html) {
  const h = mulberry32(cas.graineDuRendu ^ 0x5eed);
  const r = (effet) => cas.realisme.includes(effet);
  const photo = r("fond_bureau");
  const papier = [];
  const autour = [];
  const style = [];
  let transformation;
  let filtre;
  if (photo) {
    const rx = fixe(entre(h, -9, 9), 2);
    const ry = fixe(entre(h, -6, 6), 2);
    const rz = fixe(entre(h, -3.5, 3.5), 2);
    const echelle = fixe(entre(h, 0.83, 0.89), 3);
    const dx = fixe(entre(h, -18, 18), 1);
    const dy = fixe(entre(h, -14, 14), 1);
    transformation = `translate(${dx}px, ${dy}px) perspective(1300px) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${rz}deg) scale(${echelle})`;
    filtre = `blur(${fixe(entre(h, 0.35, 1.0))}px) brightness(${fixe(entre(h, 0.92, 1.04))}) contrast(${fixe(entre(h, 0.95, 1.08))})`;
    const bureaux = [
      "repeating-linear-gradient(92deg, #6e4a2f 0px, #7a5536 7px, #5f3f27 13px, #74513a 21px)",
      "repeating-linear-gradient(88deg, #8a8e92 0px, #7f8387 9px, #8d9195 17px)",
      "repeating-linear-gradient(91deg, #d8d2c6 0px, #cfc8bb 11px, #d6d0c4 23px)",
      "linear-gradient(160deg, #3b3f45, #2a2d31)",
    ];
    style.push(`html { background: ${bureaux[Math.floor(h() * bureaux.length)]}; }`);
    style.push(`.feuille { box-shadow: 0 ${fixe(entre(h, 6, 16), 0)}px 28px rgba(0,0,0,0.5); }`);
    const lx = Math.floor(entre(h, 15, 85));
    const ly = Math.floor(entre(h, 10, 70));
    autour.push(
      `<div class="realisme" style="position:fixed;inset:0;pointer-events:none;z-index:20;background:radial-gradient(circle at ${lx}% ${ly}%, rgba(255,248,225,0.30), rgba(255,248,225,0) 45%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${fixe(entre(h, 0.18, 0.38))}) 100%);mix-blend-mode:soft-light"></div>`,
      `<div class="realisme" style="position:fixed;inset:0;pointer-events:none;z-index:21;background:linear-gradient(${Math.floor(h() * 360)}deg, rgba(0,0,0,${fixe(entre(h, 0.08, 0.22))}), rgba(0,0,0,0) 60%)"></div>`,
    );
    if (r("ombre_main")) {
      const coin = Math.floor(h() * 4);
      const x = [0, 100, 0, 100][coin] + entre(h, -10, 10);
      const y = [100, 100, 60, 75][coin] + entre(h, -8, 8);
      autour.push(
        `<div class="realisme" style="position:fixed;left:${fixe(x - 35)}%;top:${fixe(y - 30)}%;width:70%;height:55%;pointer-events:none;z-index:22;border-radius:50%;background:radial-gradient(ellipse at center, rgba(0,0,0,${fixe(entre(h, 0.32, 0.5))}), rgba(0,0,0,0) 68%);filter:blur(18px);transform:rotate(${Math.floor(entre(h, -40, 40))}deg)"></div>`,
      );
    }
    if (r("pli")) {
      const y = fixe(entre(h, 30, 62), 1);
      papier.push(
        `<div class="realisme" style="position:absolute;left:0;right:0;top:${y}%;height:26px;pointer-events:none;z-index:9;background:linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.16) 46%, rgba(255,255,255,0.45) 54%, rgba(0,0,0,0))"></div>`,
      );
      if (h() < 0.5)
        papier.push(
          `<div class="realisme" style="position:absolute;top:0;bottom:0;left:${fixe(entre(h, 40, 60), 1)}%;width:18px;pointer-events:none;z-index:9;background:linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.12) 45%, rgba(255,255,255,0.35) 55%, rgba(0,0,0,0))"></div>`,
        );
    }
    if (r("froisse")) {
      const g = Math.floor(h() * 1000);
      papier.push(
        `<svg class="realisme" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9;mix-blend-mode:multiply;opacity:${fixe(entre(h, 0.45, 0.7))}"><filter id="froisse"><feTurbulence type="fractalNoise" baseFrequency="${fixe(entre(h, 0.008, 0.016), 4)}" numOctaves="4" seed="${g}"/><feDiffuseLighting lighting-color="#ffffff" surfaceScale="${fixe(entre(h, 2.5, 4.5))}"><feDistantLight azimuth="${Math.floor(entre(h, 0, 360))}" elevation="${Math.floor(entre(h, 45, 62))}"/></feDiffuseLighting></filter><rect width="100%" height="100%" filter="url(#froisse)"/></svg>`,
      );
    }
    papier.push(grain(Math.floor(h() * 2 ** 31)));
  } else {
    // Le scanner : un léger biais, le couvercle, le grain ; la photocopie ou la page passée.
    const angle = fixe(entre(h, 0.3, 1.5) * (h() < 0.5 ? -1 : 1), 2);
    transformation = `translate(${fixe(entre(h, -6, 6), 1)}px, ${fixe(entre(h, -5, 5), 1)}px) rotate(${angle}deg) scale(0.975)`;
    filtre = r("photocopie")
      ? `grayscale(1) contrast(${fixe(entre(h, 1.35, 1.6))}) brightness(${fixe(entre(h, 1.0, 1.08))})`
      : r("pale")
        ? `contrast(${fixe(entre(h, 0.55, 0.7))}) brightness(${fixe(entre(h, 1.1, 1.2))}) saturate(0.5)`
        : `grayscale(${fixe(entre(h, 0.1, 0.6))}) contrast(1.05) blur(${fixe(entre(h, 0.15, 0.45))}px)`;
    style.push(`html { background: ${r("photocopie") ? "#f2f2f0" : "#e6e6e2"}; }`);
    if (r("photocopie"))
      autour.push(
        `<div class="realisme" style="position:fixed;top:0;bottom:0;${h() < 0.5 ? "left" : "right"}:0;width:${Math.floor(entre(h, 6, 16))}px;background:#1d1d1d;z-index:20"></div>`,
      );
    papier.push(
      grain(Math.floor(h() * 2 ** 31), { fort: r("photocopie"), toner: r("photocopie") }),
    );
  }
  const fin = "</div></body></html>";
  // Le bureau, la lumière, la main : hors du corps transformé, sur la vue.
  return `${html.slice(0, -fin.length)}${papier.join("")}</div>
<script>document.documentElement.insertAdjacentHTML("beforeend", ${JSON.stringify(autour.join(""))});</script>
<style>${style.join("\n")}
body { transform-origin: 50% 50%; transform: ${transformation}; filter: ${filtre}; }</style></body></html>`;
}
