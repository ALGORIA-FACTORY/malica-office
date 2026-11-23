/**
 * La facture de Malica Office, mise en page — et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * Le modèle est celui du dirigeant (23 novembre 2026) : en tête le monogramme rG et la
 * marque, « FACTURE · ORIGINAL » ; le titre et le numéro ; le net à payer, seul chiffre en
 * accent ; la date, l'échéance, la référence, la devise ; l'émetteur (« DE ») et le client
 * (« À ») ; les lignes ; les totaux ; le montant en toutes lettres ; l'objet et les
 * conditions ; les coordonnées bancaires ; un pied.
 *
 * Le contenu vient de `factureImprimable` : ce module ne choisit aucun texte et ne calcule
 * aucun chiffre. Il dessine sur un canevas puis réutilise le chemin canevas → PDF du reçu
 * (`page-a4.ts`), pour la raison que `recu-pdf.ts` explique : un PDF texte demanderait une
 * fonte embarquée et un moteur de liaison de l'arabe ; le navigateur sait déjà écrire les trois
 * langues. Aucune dépendance PDF de plus.
 *
 * La couleur est fonctionnelle : l'encre, le papier et les gris portent tout ; le point devant
 * le numéro dit l'état de la facture (payée, à échoir, en retard) ; le net à payer porte le
 * seul accent de la page. Inter pour le texte, IBM Plex Mono pour les chiffres. En arabe, la
 * page est en miroir ; un nombre garde son sens de lecture.
 */
import type { FactureImprimable, SignalDeFacture } from "@/lib/facture-imprimable";

import { HAUTEUR_A4, LARGEUR_A4, MARGE_A4, nouvelleToileA4, pdfDesToiles } from "./page-a4";

const LARGEUR = LARGEUR_A4;
const HAUTEUR = HAUTEUR_A4;
const MARGE = MARGE_A4;
const UTILE = LARGEUR - 2 * MARGE;
/** Sous cette ligne, le pied : rien d'autre ne s'y écrit. */
const BAS = HAUTEUR - MARGE - 60;

/* La charte : 80 % d'encre, de papier et de gris ; la couleur ne sert qu'à dire. */
const ENCRE = "#0A0A0A";
const GRIS = "#5F6673";
const GRIS_CLAIR = "#9AA0A9";
const FILET = "#D9DBDF";
const ACCENT = "#D97757";
const SIGNAL: Record<SignalDeFacture, string> = {
  succes: "#3A8F54",
  erreur: "#BF4424",
  alerte: "#B58614",
  neutre: GRIS_CLAIR,
};

const SANS = `Inter, "Noto Kufi Arabic", system-ui, sans-serif`;
const MONO = `"IBM Plex Mono", ui-monospace, monospace`;
const police = (graisse: number, taille: number, famille = SANS) =>
  `${graisse} ${taille}px ${famille}`;

/** Les polices de la charte, chargées avant de dessiner ; sans elles, le système dessine. */
async function chargerLesPolices(): Promise<void> {
  const polices = typeof document !== "undefined" ? document.fonts : undefined;
  if (!polices?.load) return;
  try {
    await Promise.all([
      polices.load(police(400, 28)),
      polices.load(police(600, 28)),
      polices.load(police(700, 28)),
      polices.load(police(500, 28, MONO)),
      polices.load(police(600, 28, MONO)),
    ]);
  } catch {
    // Une police absente n'empêche pas la facture : le système la remplace.
  }
}

export interface FactureRendue {
  blob: Blob;
  name: string;
}

/**
 * Dessine la facture et rend un PDF (une page, davantage si ses lignes débordent).
 *
 * `marque` : le monogramme rG, déjà chargé (`useTelechargerLaFacture`) ; absent, la page
 * garde sa place vide plutôt qu'un logo inventé.
 */
export async function rendreFactureEnPdf(
  f: FactureImprimable,
  direction: "ltr" | "rtl",
  marque: CanvasImageSource | null = null,
): Promise<FactureRendue> {
  await chargerLesPolices();
  const rtl = direction === "rtl";
  const pages: HTMLCanvasElement[] = [];
  let ctx!: CanvasRenderingContext2D;
  let y = 0;

  /** L'abscisse physique d'une position comptée depuis le DÉBUT de la ligne (miroir en arabe). */
  const px = (x: number) => (rtl ? LARGEUR - x : x);

  const espacer = (lettres: number) => {
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${lettres}px`;
  };

  /** Un texte, calé au début ou à la fin de sa position. Un nombre se lit de gauche à droite. */
  const ecrire = (
    texte: string,
    x: number,
    yy: number,
    p: string,
    options: {
      fin?: boolean;
      couleur?: string;
      nombre?: boolean;
      largeur?: number;
      espace?: number;
    } = {},
  ) => {
    ctx.font = p;
    ctx.fillStyle = options.couleur ?? ENCRE;
    espacer(options.espace ?? 0);
    ctx.direction = options.nombre ? "ltr" : direction;
    const aDroite = Boolean(options.fin) !== rtl;
    ctx.textAlign = aDroite ? "right" : "left";
    if (options.largeur) ctx.fillText(texte, px(x), yy, options.largeur);
    else ctx.fillText(texte, px(x), yy);
    espacer(0);
  };

  /** Des morceaux de couleurs différentes, lus de gauche à droite, calés au début ou à la fin. */
  const segments = (
    morceaux: { texte: string; p: string; couleur: string; espace?: number }[],
    x: number,
    yy: number,
    fin = false,
  ) => {
    const largeurs = morceaux.map((m) => {
      ctx.font = m.p;
      espacer(m.espace ?? 0);
      const l = ctx.measureText(m.texte).width;
      espacer(0);
      return l;
    });
    const total = largeurs.reduce((a, b) => a + b, 0);
    let gauche = fin ? (rtl ? LARGEUR - x : x - total) : rtl ? LARGEUR - x - total : x;
    morceaux.forEach((m, i) => {
      ctx.font = m.p;
      ctx.fillStyle = m.couleur;
      espacer(m.espace ?? 0);
      ctx.direction = "ltr";
      ctx.textAlign = "left";
      ctx.fillText(m.texte, gauche, yy);
      espacer(0);
      gauche += largeurs[i]!;
    });
  };

  const filet = (yy: number, epaisseur = 2, couleur = FILET, debut = 0, largeur = UTILE) => {
    ctx.fillStyle = couleur;
    const x0 = MARGE + debut;
    ctx.fillRect(rtl ? LARGEUR - x0 - largeur : x0, yy, largeur, epaisseur);
  };

  /** Les lignes d'un texte coupé à la largeur donnée. */
  const couper = (texte: string, largeur: number, p: string): string[] => {
    ctx.font = p;
    const lignes: string[] = [];
    for (const paragraphe of texte.split("\n")) {
      let courante = "";
      for (const mot of paragraphe.split(/\s+/).filter(Boolean)) {
        const essai = courante ? `${courante} ${mot}` : mot;
        if (courante && ctx.measureText(essai).width > largeur) {
          lignes.push(courante);
          courante = mot;
        } else courante = essai;
      }
      if (courante) lignes.push(courante);
    }
    return lignes;
  };

  const capitales = (texte: string, x: number, yy: number, fin = false) =>
    ecrire(texte, x, yy, police(600, 22), { fin, couleur: GRIS, espace: 3 });

  const pied = () => {
    filet(HAUTEUR - MARGE - 40, 1);
    ecrire(f.pied.gauche, MARGE, HAUTEUR - MARGE + 6, police(400, 22), {
      couleur: GRIS,
      largeur: UTILE * 0.62,
    });
    ecrire(f.pied.droite, LARGEUR - MARGE, HAUTEUR - MARGE + 6, police(500, 22), {
      fin: true,
      couleur: GRIS,
    });
    if (f.specimen) {
      ctx.save();
      ctx.translate(LARGEUR / 2, HAUTEUR / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.font = police(700, 120);
      ctx.fillStyle = "rgba(10, 10, 10, 0.07)";
      ctx.textAlign = "center";
      ctx.direction = direction;
      ctx.fillText(f.specimen, 0, 0);
      ctx.restore();
    }
  };

  const nouvellePage = () => {
    if (pages.length > 0) pied();
    const toile = nouvelleToileA4();
    if (!toile) throw new Error("facture.pdf.canevas_indisponible");
    pages.push(toile.canevas);
    ctx = toile.ctx;
    ctx.textBaseline = "alphabetic";
    y = MARGE;
    if (pages.length > 1) {
      // Une page qui continue : le titre et le numéro, pour qu'elle se range seule.
      ecrire(`${f.titre} ${f.numero}`, MARGE, y + 30, police(600, 28));
      y += 80;
    }
  };

  /** Une page de plus si `hauteur` ne tient plus avant le pied. */
  const besoin = (hauteur: number): boolean => {
    if (y + hauteur <= BAS) return false;
    nouvellePage();
    return true;
  };

  nouvellePage();

  /* ------------------------------------------------------------ l'en-tête */
  const COTE = 96;
  if (marque) {
    ctx.drawImage(marque, rtl ? LARGEUR - MARGE - COTE : MARGE, y, COTE, COTE);
  }
  const [gauche = f.marque, droite = ""] = f.marque.split("|").map((s) => s.trim());
  segments(
    [
      { texte: gauche, p: police(700, 38), couleur: ENCRE, espace: 6 },
      ...(droite
        ? [
            { texte: "  |  ", p: police(400, 38), couleur: GRIS_CLAIR },
            { texte: droite, p: police(500, 38), couleur: ENCRE, espace: 6 },
          ]
        : []),
    ],
    MARGE + COTE + 30,
    y + 62,
  );
  capitales(f.surtitre, LARGEUR - MARGE, y + 40, true);

  // Le titre et le numéro ; le net à payer en face.
  ecrire(f.titre, MARGE, y + 236, police(700, 96));
  ctx.fillStyle = SIGNAL[f.signal];
  ctx.beginPath();
  ctx.arc(px(MARGE + 11), y + 292, 11, 0, 2 * Math.PI);
  ctx.fill();
  ecrire(f.numero, MARGE + 40, y + 306, police(500, 40, MONO), { nombre: true });

  capitales(f.net.libelle, LARGEUR - MARGE, y + 170, true);
  segments(
    [
      { texte: f.net.montant, p: police(600, 88, MONO), couleur: ACCENT },
      { texte: ` ${f.net.devise}`, p: police(500, 38, MONO), couleur: GRIS },
    ],
    LARGEUR - MARGE,
    y + 266,
    true,
  );
  y += 350;

  /* -------------------------------------------------- date, échéance, réf. */
  filet(y);
  const quart = UTILE / f.meta.length;
  f.meta.forEach((m, i) => {
    capitales(m.libelle, MARGE + i * quart, y + 58);
    ecrire(m.valeur, MARGE + i * quart, y + 102, police(500, 32, MONO), {
      nombre: true,
      largeur: quart - 30,
    });
  });
  y += 124;
  filet(y);

  /* ------------------------------------------------------------ DE et À */
  const moitie = UTILE / 2;
  const bloc = (b: FactureImprimable["de"], debut: number): number => {
    let yy = y + 64;
    capitales(b.titre, MARGE + debut, yy);
    yy += 54;
    for (const l of couper(b.nom, moitie - 60, police(600, 34))) {
      ecrire(l, MARGE + debut, yy, police(600, 34));
      yy += 46;
    }
    for (const ligne of b.lignes) {
      for (const l of couper(ligne, moitie - 60, police(400, 28))) {
        ecrire(l, MARGE + debut, yy, police(400, 28), { couleur: GRIS });
        yy += 40;
      }
    }
    return yy;
  };
  y = Math.max(bloc(f.de, 0), bloc(f.a, moitie)) + 10;

  /* ----------------------------------------------------------- les lignes */
  const COL = [0, UTILE * 0.52, UTILE * 0.64, UTILE * 0.82, UTILE] as const;
  const enteteDuTableau = () => {
    y += 44;
    capitales(f.colonnes.designation, MARGE, y);
    capitales(f.colonnes.quantite, MARGE + COL[2] - 20, y, true);
    capitales(f.colonnes.prixUnitaire, MARGE + COL[3] - 20, y, true);
    capitales(f.colonnes.montant, MARGE + COL[4], y, true);
    y += 22;
    filet(y, 3, ENCRE);
  };
  besoin(200);
  enteteDuTableau();
  for (const l of f.lignes) {
    const texte = couper(l.libelle, COL[1] - 30, police(400, 28));
    const hauteur = 30 + texte.length * 40;
    if (besoin(hauteur + 20)) enteteDuTableau();
    let yy = y + 54;
    for (const t of texte) {
      ecrire(t, MARGE, yy, police(400, 28));
      yy += 40;
    }
    const base = y + 54;
    const chiffre = (v: string, fin: number) =>
      ecrire(v, MARGE + fin, base, police(500, 28, MONO), { fin: true, nombre: true });
    chiffre(l.quantite, COL[2] - 20);
    chiffre(l.prixUnitaire, COL[3] - 20);
    chiffre(l.montant, COL[4]);
    y = yy - 10;
    filet(y, 1);
  }

  /* ------------------------------------------------------------- totaux */
  besoin(60 + f.totaux.length * 54);
  y += 30;
  const DEBUT_TOTAUX = UTILE * 0.5;
  for (const t of f.totaux) {
    if (t.fort) {
      y += 12;
      filet(y, 3, ENCRE, DEBUT_TOTAUX, UTILE - DEBUT_TOTAUX);
      y += 8;
    }
    y += t.fort ? 52 : 44;
    ecrire(t.libelle, MARGE + DEBUT_TOTAUX, y, police(t.fort ? 700 : 400, t.fort ? 32 : 28), {
      couleur: t.fort ? ENCRE : GRIS,
    });
    ecrire(t.valeur, LARGEUR - MARGE, y, police(t.fort ? 600 : 500, t.fort ? 34 : 28, MONO), {
      fin: true,
      nombre: true,
    });
  }
  y += 20;

  /* ------------------------------------------------- en toutes lettres */
  if (f.arretee) {
    const lignes = couper(f.arretee, UTILE, police(400, 28));
    besoin(40 + lignes.length * 40);
    y += 24;
    for (const l of lignes) {
      ecrire(l, MARGE, y, police(400, 28));
      y += 40;
    }
  }

  /* ------------------------------------------------ objet et conditions */
  const objet = couper(f.objet.texte, moitie - 60, police(400, 26));
  const conditions = f.conditions.lignes.flatMap((l) => couper(l, moitie - 60, police(400, 26)));
  besoin(110 + Math.max(objet.length, conditions.length) * 38);
  y += 24;
  filet(y);
  const colonne = (titre: string, lignes: string[], debut: number) => {
    let yy = y + 58;
    capitales(titre, MARGE + debut, yy);
    yy += 46;
    for (const l of lignes) {
      ecrire(l, MARGE + debut, yy, police(400, 26));
      yy += 38;
    }
    return yy;
  };
  y = Math.max(colonne(f.objet.titre, objet, 0), colonne(f.conditions.titre, conditions, moitie));

  /* ------------------------------------------------------------- banque */
  if (f.banque && f.banque.lignes.length > 0) {
    // Trois colonnes : le RIB et l'IBAN sont longs, mais tiennent dans un tiers en Plex Mono.
    const tiers = UTILE / 3;
    const rangs = Math.ceil(f.banque.lignes.length / 3);
    besoin(90 + rangs * 64);
    y += 16;
    filet(y);
    capitales(f.banque.titre, MARGE, y + 50);
    y += 56;
    f.banque.lignes.forEach((l, i) => {
      const debut = (i % 3) * tiers;
      const yy = y + Math.floor(i / 3) * 64;
      ecrire(l.libelle, MARGE + debut, yy + 28, police(400, 22), { couleur: GRIS });
      ecrire(l.valeur, MARGE + debut, yy + 58, police(500, 26, MONO), {
        nombre: true,
        largeur: tiers - 30,
      });
    });
    y += rangs * 64;
  }

  pied();
  const pdf = await pdfDesToiles(
    pages,
    `${f.titre} ${f.numero}`,
    "facture.pdf.encodage_impossible",
  );
  return { blob: pdf, name: f.fichier };
}
