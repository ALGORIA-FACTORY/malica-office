/**
 * Le PDF d'une facture ou d'un avoir — un document calme, lisible d'un coup
 * d'œil, qui ne dit que ce que la base a émis.
 *
 * Un seul chemin de lecture, de haut en bas : qui émet et quel document
 * (logo, nature, numéro), quand (émission, échéance, période), entre qui
 * (émetteur et client côte à côte), quoi (les lignes, montants alignés), le
 * total qui domine, comment payer, puis les mentions, petites, en bas.
 *
 * Encre sur blanc, gris pour le secondaire, filets plutôt que cadres. Une
 * seule couleur, et seulement quand elle dit quelque chose : le vert de
 * « Payée », le vermillon de « En retard ». Inter pour le texte, IBM Plex
 * Mono pour les montants (espaces fines entre les milliers), Noto Kufi
 * Arabic en arabe, mise en page entièrement en miroir.
 *
 * Fonction PURE : mêmes données, mêmes polices, mêmes octets. Aucune date
 * du jour n'entre dans le fichier (Skia n'écrit pas de date de création) :
 * l'empreinte inscrite à l'émission (`facture_documents.sha256`) se vérifie
 * en rendant de nouveau. Aucun texte n'est écrit ici : rubriques, libellés,
 * mois, nature viennent de la base dans la langue demandée (R4, R12).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createCanvas, GlobalFonts, Image, PDFDocument, type SKRSContext2D } from "@napi-rs/canvas";

import type { DocumentDeFacture, LigneDuDocument } from "./document.ts";

/** La version du rendu, inscrite avec l'empreinte : un rendu qui change de forme change de nom. */
export const GABARIT_DU_RENDU = "facture-2026-11";

type Contexte = SKRSContext2D;

/* ------------------------------------------------------------------ la charte */

const ENCRE = "#0A0A0A";
/** Le gris du texte secondaire : 7,5:1 sur blanc, contraste AAA. */
const GRIS = "#555555";
const FILET = "#D4D4D4";
const FILET_LEGER = "#EBEBEB";
const PAPIER = "#FFFFFF";
const VERT = "#3A8F54";
const VERMILLON = "#BF4424";

/** A4, en points. */
const L = 595.28;
const H = 841.89;
const MARGE = 56;
const UTILE = L - 2 * MARGE;
const BAS_DU_CORPS = H - MARGE - 46;

/* ------------------------------------------------------------------ les polices */

const require = createRequire(import.meta.url);

const TEXTE = '"Inter Malica", "Inter Malica Ext"';
const ARABE = '"Kufi Malica", "Inter Malica", "Inter Malica Ext"';
const CHIFFRES = '"Plex Malica", "Inter Malica"';

let policesPosees = false;

function poserLesPolices(): void {
  if (policesPosees) return;
  const poser = (paquet: string, fichier: string, nom: string) => {
    if (!GlobalFonts.registerFromPath(require.resolve(`${paquet}/files/${fichier}`), nom)) {
      throw new Error(`police introuvable : ${paquet}/${fichier}`);
    }
  };
  for (const poids of [400, 500, 600]) {
    poser("@fontsource/inter", `inter-latin-${poids}-normal.woff2`, "Inter Malica");
    poser("@fontsource/inter", `inter-latin-ext-${poids}-normal.woff2`, "Inter Malica Ext");
    poser("@fontsource/ibm-plex-mono", `ibm-plex-mono-latin-${poids}-normal.woff2`, "Plex Malica");
    poser(
      "@fontsource/noto-kufi-arabic",
      `noto-kufi-arabic-arabic-${poids}-normal.woff2`,
      "Kufi Malica",
    );
  }
  policesPosees = true;
}

let logo: Image | null = null;

function leLogo(): Image {
  if (!logo) {
    logo = new Image();
    logo.src = readFileSync(new URL("./algoria-factory.svg", import.meta.url));
  }
  return logo;
}

/* ------------------------------------------------------------------ les nombres */

/** Un montant : espaces fines entre les milliers, la décimale et l'exposant de la devise. */
export function montant(valeur: number, devise: { exposant: number; separateur: string }): string {
  const exposant = devise.exposant;
  const unites = Math.round(Math.abs(valeur) * 10 ** exposant);
  const chiffres = unites.toString().padStart(exposant + 1, "0");
  const entier = chiffres.slice(0, chiffres.length - exposant);
  const decimales = chiffres.slice(chiffres.length - exposant);
  const groupes = entier.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${valeur < 0 && unites > 0 ? "−" : ""}${groupes}${exposant > 0 ? devise.separateur + decimales : ""}`;
}

/** Un taux en pour cent, sans zéros inutiles : 0,19 → « 19 ». */
function pourCent(taux: number, separateur: string): string {
  return String(Math.round(taux * 10000) / 100).replace(".", separateur);
}

/** Une date ISO en jour/mois/année : lisible en fr, en et ar sans locale du serveur. */
function jour(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}

function quantite(q: number, separateur: string): string {
  return Number.isInteger(q) ? String(q) : String(q).replace(".", separateur);
}

const remplir = (gabarit: string, valeurs: Record<string, string>) =>
  Object.entries(valeurs).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), gabarit);

/* ------------------------------------------------------------------ le rendu */

export interface OptionsDuRendu {
  /** L'adresse de l'espace client où payer, ou `null` (avoir, aperçu hors ligne). */
  lienPaiement: string | null;
}

interface Mise {
  ctx: Contexte;
  rtl: boolean;
  texte: string;
}

/**
 * Le point d'ancrage d'un texte dans la mise en page en miroir : `x` se lit
 * depuis le bord de DÉBUT (gauche en fr/en, droite en ar), `cote` dit de quel
 * côté du point le texte s'étend.
 */
function ancre(
  m: Mise,
  x: number,
  cote: "debut" | "fin",
): { px: number; aligne: "left" | "right" } {
  const px = m.rtl ? L - x : x;
  const versLaDroite = (cote === "debut") !== m.rtl;
  return { px, aligne: versLaDroite ? "left" : "right" };
}

function ecrire(
  m: Mise,
  s: string,
  x: number,
  y: number,
  o: {
    taille: number;
    poids?: number;
    couleur?: string;
    cote?: "debut" | "fin";
    chiffres?: boolean;
  },
): number {
  const { px, aligne } = ancre(m, x, o.cote ?? "debut");
  m.ctx.font = `${o.poids ?? 400} ${o.taille}px ${o.chiffres ? CHIFFRES : m.texte}`;
  m.ctx.fillStyle = o.couleur ?? ENCRE;
  m.ctx.textAlign = aligne;
  // Un nombre se lit de gauche à droite, même dans une page arabe.
  m.ctx.direction = o.chiffres || !m.rtl ? "ltr" : "rtl";
  m.ctx.fillText(s, px, y);
  return m.ctx.measureText(s).width;
}

/** Une étiquette : petite, grise, en capitales espacées quand l'écriture en a. */
function etiquette(m: Mise, s: string, x: number, y: number, cote: "debut" | "fin" = "debut") {
  m.ctx.letterSpacing = m.rtl ? "0px" : "0.6px";
  ecrire(m, m.rtl ? s : s.toLocaleUpperCase("fr"), x, y, {
    taille: 7,
    poids: 600,
    couleur: GRIS,
    cote,
  });
  m.ctx.letterSpacing = "0px";
}

function filet(m: Mise, y: number, de = MARGE, a = L - MARGE, couleur = FILET, epaisseur = 0.6) {
  m.ctx.strokeStyle = couleur;
  m.ctx.lineWidth = epaisseur;
  m.ctx.beginPath();
  m.ctx.moveTo(m.rtl ? L - de : de, y);
  m.ctx.lineTo(m.rtl ? L - a : a, y);
  m.ctx.stroke();
}

/** Coupe un texte en lignes qui tiennent dans `largeur`, mot à mot. */
function couper(m: Mise, s: string, largeur: number, taille: number, poids = 400): string[] {
  m.ctx.font = `${poids} ${taille}px ${m.texte}`;
  const lignes: string[] = [];
  let courante = "";
  for (const mot of s.split(/\s+/).filter(Boolean)) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (m.ctx.measureText(essai).width <= largeur || !courante) courante = essai;
    else {
      lignes.push(courante);
      courante = mot;
    }
  }
  if (courante) lignes.push(courante);
  return lignes.length ? lignes : [""];
}

/* Les colonnes du tableau, depuis le bord de début. */
const COL_QTE_FIN = MARGE + UTILE - 178;
const COL_PU_FIN = MARGE + UTILE - 92;
const COL_MONTANT_FIN = MARGE + UTILE;
const COL_DESIGNATION_LARGEUR = COL_QTE_FIN - 40 - MARGE;
const INTERLIGNE = 13;

function hauteurDeLigne(m: Mise, l: LigneDuDocument): number {
  return couper(m, l.libelle, COL_DESIGNATION_LARGEUR, 9.5).length * INTERLIGNE + 12;
}

function enTeteDuTableau(m: Mise, d: DocumentDeFacture, y: number): number {
  const r = d.rubriques;
  etiquette(m, r["designation"]!, MARGE, y);
  etiquette(m, r["quantite"]!, COL_QTE_FIN, y, "fin");
  etiquette(m, r["prix_unitaire"]!, COL_PU_FIN, y, "fin");
  etiquette(m, r["montant_ht"]!, COL_MONTANT_FIN, y, "fin");
  filet(m, y + 8, MARGE, L - MARGE, ENCRE, 0.6);
  return y + 8;
}

function ligneDuTableau(m: Mise, d: DocumentDeFacture, l: LigneDuDocument, y: number): number {
  const devise = d.devise!;
  const lignes = couper(m, l.libelle, COL_DESIGNATION_LARGEUR, 9.5);
  const base = y + 16;
  lignes.forEach((t, i) => ecrire(m, t, MARGE, base + i * INTERLIGNE, { taille: 9.5 }));
  ecrire(m, quantite(Number(l.quantite), devise.separateur), COL_QTE_FIN, base, {
    taille: 9.5,
    chiffres: true,
    cote: "fin",
  });
  ecrire(m, montant(Number(l.prix_unitaire), devise), COL_PU_FIN, base, {
    taille: 9.5,
    chiffres: true,
    cote: "fin",
    couleur: GRIS,
  });
  ecrire(m, montant(Number(l.montant_ht), devise), COL_MONTANT_FIN, base, {
    taille: 9.5,
    chiffres: true,
    cote: "fin",
  });
  const fin = y + lignes.length * INTERLIGNE + 12;
  filet(m, fin, MARGE, L - MARGE, FILET_LEGER, 0.5);
  return fin;
}

/** Le tampon d'état : un filet et un point de couleur, le mot à l'encre (lisible, AAA). */
function tampon(m: Mise, mot: string, couleur: string, xFin: number, y: number) {
  m.ctx.font = `600 8px ${m.texte}`;
  m.ctx.letterSpacing = m.rtl ? "0px" : "0.6px";
  const s = m.rtl ? mot : mot.toLocaleUpperCase("fr");
  const largeur = m.ctx.measureText(s).width + 26;
  const gauche = m.rtl ? L - xFin : xFin - largeur;
  m.ctx.strokeStyle = couleur;
  m.ctx.lineWidth = 1;
  m.ctx.beginPath();
  m.ctx.roundRect(gauche, y, largeur, 16, 8);
  m.ctx.stroke();
  m.ctx.fillStyle = couleur;
  m.ctx.beginPath();
  m.ctx.arc(m.rtl ? gauche + largeur - 10 : gauche + 10, y + 8, 2.4, 0, Math.PI * 2);
  m.ctx.fill();
  m.ctx.fillStyle = ENCRE;
  m.ctx.textAlign = m.rtl ? "right" : "left";
  m.ctx.direction = m.rtl ? "rtl" : "ltr";
  m.ctx.fillText(s, m.rtl ? gauche + largeur - 17 : gauche + 17, y + 11);
  m.ctx.letterSpacing = "0px";
}

function enTete(m: Mise, d: DocumentDeFacture, page: number): number {
  const f = d.facture;
  const largeurLogo = page === 1 ? 128 : 96;
  const hauteurLogo = (largeurLogo * 181.2) / 1063.7;
  m.ctx.drawImage(
    leLogo(),
    m.rtl ? L - MARGE - largeurLogo : MARGE,
    MARGE,
    largeurLogo,
    hauteurLogo,
  );
  if (page > 1) {
    ecrire(m, `${d.nature_libelle} ${f.numero}`, L - MARGE, MARGE + 14, {
      taille: 9,
      couleur: GRIS,
      cote: "fin",
    });
    filet(m, MARGE + 32);
    return MARGE + 56;
  }
  ecrire(m, d.nature_libelle, L - MARGE, MARGE + 20, { taille: 24, poids: 600, cote: "fin" });
  ecrire(m, f.numero, L - MARGE, MARGE + 40, {
    taille: 10.5,
    poids: 500,
    chiffres: true,
    cote: "fin",
  });
  const etat = d.encours?.etat;
  if (f.nature === "facture" && etat === "payee") {
    tampon(m, d.rubriques["payee"]!, VERT, L - MARGE, MARGE + 50);
  } else if (f.nature === "facture" && etat === "en_retard") {
    tampon(m, d.rubriques["en_retard"]!, VERMILLON, L - MARGE, MARGE + 50);
  }
  filet(m, MARGE + 80);

  // Quand : une bande de repères, alignée sur la grille.
  const r = d.rubriques;
  const reperes: Array<[string, string, boolean]> = [
    [r["date_emission"]!, jour(f.emise_le), true],
    ...(f.nature === "facture"
      ? [[r["date_echeance"]!, jour(f.echeance_le), true] as [string, string, boolean]]
      : []),
    [r["periode"]!, `${d.periode.mois ?? ""} ${d.periode.annee}`.trim(), false],
    ...(f.reference_abonne
      ? [[r["reference_abonne"]!, f.reference_abonne, true] as [string, string, boolean]]
      : []),
  ];
  const pas = UTILE / 4;
  reperes.forEach(([lib, val, chiffres], i) => {
    etiquette(m, lib, MARGE + i * pas, MARGE + 102);
    ecrire(m, val, MARGE + i * pas, MARGE + 117, { taille: 10, poids: 500, chiffres });
  });
  filet(m, MARGE + 134);
  return MARGE + 134;
}

function parties(m: Mise, d: DocumentDeFacture, y: number): number {
  const f = d.facture;
  const r = d.rubriques;
  const moitie = UTILE / 2;
  const colonne = (
    x: number,
    titre: string,
    nom: string,
    matricule: string | null,
    adresse: string | null,
  ) => {
    etiquette(m, titre, x, y + 22);
    let yy = y + 40;
    for (const t of couper(m, nom, moitie - 24, 11, 600)) {
      ecrire(m, t, x, yy, { taille: 11, poids: 600 });
      yy += 15;
    }
    if (matricule) {
      ecrire(m, `${r["matricule_fiscal"]} ${matricule}`, x, yy, { taille: 9, couleur: GRIS });
      yy += 13;
    }
    for (const t of adresse ? couper(m, adresse, moitie - 24, 9) : []) {
      ecrire(m, t, x, yy, { taille: 9, couleur: GRIS });
      yy += 13;
    }
    return yy;
  };
  const a = colonne(
    MARGE,
    r["emetteur"]!,
    f.emetteur_nom ?? "",
    f.emetteur_matricule,
    f.emetteur_adresse,
  );
  const b = colonne(
    MARGE + moitie,
    r["client"]!,
    f.destinataire_nom,
    f.destinataire_legal_id,
    f.destinataire_adresse,
  );
  let fin = Math.max(a, b) + 6;
  if (f.nature === "avoir" && d.avoir_de) {
    fin += 8;
    ecrire(
      m,
      remplir(r["avoir_sur"]!, { numero: d.avoir_de.numero, date: jour(d.avoir_de.emise_le) }),
      MARGE,
      fin,
      { taille: 9.5, poids: 500 },
    );
    fin += 14;
    if (f.motif) {
      for (const t of couper(m, `${r["motif"]} : ${f.motif}`, UTILE, 9)) {
        ecrire(m, t, MARGE, fin, { taille: 9, couleur: GRIS });
        fin += 13;
      }
    }
  }
  return fin + 18;
}

const HAUTEUR_DES_TOTAUX = 190;

function totaux(m: Mise, d: DocumentDeFacture, y: number, lienPaiement: string | null): void {
  const f = d.facture;
  const r = d.rubriques;
  const devise = d.devise!;
  const debut = MARGE + UTILE - 236;
  let yy = y + 26;
  const rangee = (lib: string, val: number, gras = false) => {
    ecrire(m, lib, debut, yy, {
      taille: 9.5,
      couleur: gras ? ENCRE : GRIS,
      poids: gras ? 600 : 400,
    });
    ecrire(m, montant(val, devise), COL_MONTANT_FIN, yy, {
      taille: 9.5,
      chiffres: true,
      cote: "fin",
      poids: gras ? 600 : 400,
    });
    yy += 17;
  };
  rangee(r["total_ht"]!, Number(f.montant_ht));
  rangee(
    remplir(r["tva_au_taux"]!, { taux: pourCent(Number(f.taux_tva), devise.separateur) }),
    Number(f.montant_tva),
  );
  rangee(r["droit_de_timbre"]!, Number(f.timbre));
  filet(m, yy - 6, debut, L - MARGE, ENCRE, 0.8);
  yy += 16;
  ecrire(m, r["total_ttc"]!, debut, yy, { taille: 12, poids: 600 });
  ecrire(m, montant(Number(f.montant_ttc), devise), COL_MONTANT_FIN, yy, {
    taille: 18,
    poids: 600,
    chiffres: true,
    cote: "fin",
  });
  ecrire(m, devise.code, COL_MONTANT_FIN, yy + 14, {
    taille: 7.5,
    couleur: GRIS,
    cote: "fin",
    chiffres: true,
  });
  yy += 34;
  if (f.nature === "facture" && d.encours) {
    rangee(r["deja_paye"]!, Number(d.encours.encaisse));
    if (Number(d.encours.avoirs) > 0) rangee(r["avoir"]!, Number(d.encours.avoirs));
    filet(m, yy - 6, debut, L - MARGE, FILET, 0.5);
    yy += 8;
    ecrire(m, r["reste_a_payer"]!, debut, yy, { taille: 11, poids: 600 });
    ecrire(m, montant(Math.max(0, Number(d.encours.reste_du)), devise), COL_MONTANT_FIN, yy, {
      taille: 13,
      poids: 600,
      chiffres: true,
      cote: "fin",
    });
  }

  // Comment payer : à gauche du total, dans la même bande.
  if (f.nature === "facture") {
    const largeur = debut - MARGE - 32;
    let py = y + 26;
    etiquette(m, r["paiement"]!, MARGE, py);
    py += 16;
    ecrire(m, remplir(r["a_regler_avant"]!, { date: jour(f.echeance_le) }), MARGE, py, {
      taille: 9.5,
    });
    py += 18;
    if (lienPaiement) {
      for (const t of couper(m, r["payer_en_ligne"]!, largeur, 9)) {
        ecrire(m, t, MARGE, py, { taille: 9, couleur: GRIS });
        py += 13;
      }
      const w = ecrire(m, lienPaiement, MARGE, py, { taille: 9, poids: 500 });
      const x0 = m.rtl ? L - MARGE - w : MARGE;
      m.ctx.strokeStyle = ENCRE;
      m.ctx.lineWidth = 0.5;
      m.ctx.beginPath();
      m.ctx.moveTo(x0, py + 2);
      m.ctx.lineTo(x0 + w, py + 2);
      m.ctx.stroke();
      m.ctx.annotateLinkUrl(x0, py - 10, x0 + w, py + 4, lienPaiement);
    }
  }
}

function piedDePage(m: Mise, d: DocumentDeFacture, page: number, pages: number) {
  const f = d.facture;
  const r = d.rubriques;
  const y = H - MARGE - 30;
  filet(m, y);
  const identite = [
    f.emetteur_nom,
    f.emetteur_matricule ? `${r["matricule_fiscal"]} ${f.emetteur_matricule}` : null,
    f.emetteur_adresse,
  ]
    .filter(Boolean)
    .join("  ·  ");
  ecrire(m, identite, MARGE, y + 14, { taille: 7, couleur: GRIS });
  ecrire(
    m,
    `${r["numerotation"]}  ${remplir(r["montants_en"]!, { devise: d.devise!.code })}.  ${r["produit"]}`,
    MARGE,
    y + 25,
    { taille: 7, couleur: GRIS },
  );
  ecrire(m, remplir(r["page"]!, { n: String(page), total: String(pages) }), L - MARGE, y + 14, {
    taille: 7,
    couleur: GRIS,
    cote: "fin",
  });
}

/** Les lignes réparties sur les pages, le bloc des totaux tenant entier sur la dernière. */
function paginer(m: Mise, d: DocumentDeFacture, debutDuTableau: number): LigneDuDocument[][] {
  const pages: LigneDuDocument[][] = [[]];
  let y = debutDuTableau + 8;
  for (const l of d.lignes) {
    const h = hauteurDeLigne(m, l);
    if (y + h > BAS_DU_CORPS) {
      pages.push([]);
      y = MARGE + 56 + 8;
    }
    pages[pages.length - 1]!.push(l);
    y += h;
  }
  if (y + HAUTEUR_DES_TOTAUX > BAS_DU_CORPS) pages.push([]);
  return pages;
}

export function rendreLaFacture(d: DocumentDeFacture, o: OptionsDuRendu): Buffer {
  if (!d.devise) throw new Error("refus.referentiel.manquant");
  poserLesPolices();
  const rtl = d.langue === "ar";
  const texte = rtl ? ARABE : TEXTE;

  // Une première passe, sur une toile de mesure, pour savoir combien de pages.
  // Sans alternances contextuelles ni ligatures : la parenthèse d'Inter devant
  // un chiffre devient un glyphe sans correspondance Unicode, que la couche de
  // texte perd (« (30/30 jours) » se relisait « 30/30 jours) »).
  const sobre = <C extends { textRendering: string }>(ctx: C): C => {
    ctx.textRendering = "optimizeSpeed";
    return ctx;
  };
  const mesure: Mise = { ctx: sobre(createCanvas(1, 1).getContext("2d")), rtl, texte };
  const pdf = new PDFDocument({
    title: `${d.nature_libelle} ${d.facture.numero}`,
    author: d.facture.emetteur_nom ?? "",
    creator: d.rubriques["produit"] ?? "",
    producer: d.rubriques["produit"] ?? "",
    compressionLevel: 6,
  });

  const page = () => sobre(pdf.beginPage(L, H) as unknown as Contexte);
  const premiere: Mise = { ctx: page(), rtl, texte };
  premiere.ctx.fillStyle = PAPIER;
  premiere.ctx.fillRect(0, 0, L, H);
  const y0 = parties(premiere, d, enTete(premiere, d, 1));
  const pages = paginer(mesure, d, y0);

  let m = premiere;
  let y = enTeteDuTableau(m, d, y0);
  pages.forEach((lignes, i) => {
    if (i > 0) {
      piedDePage(m, d, i, pages.length);
      pdf.endPage();
      m = { ctx: page(), rtl, texte };
      m.ctx.fillStyle = PAPIER;
      m.ctx.fillRect(0, 0, L, H);
      y = enTete(m, d, i + 1);
      if (lignes.length) y = enTeteDuTableau(m, d, y);
    }
    for (const l of lignes) y = ligneDuTableau(m, d, l, y);
  });
  totaux(m, d, y, d.facture.nature === "facture" ? o.lienPaiement : null);
  piedDePage(m, d, pages.length, pages.length);
  pdf.endPage();
  return pdf.close();
}

export const empreinte = (pdf: Buffer): string => createHash("sha256").update(pdf).digest("hex");
