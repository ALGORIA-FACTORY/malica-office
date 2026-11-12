/**
 * Le PDF d'impression — une page de garde par société, l'index, puis les pièces.
 *
 * ============================================================== POURQUOI
 *
 * 12 novembre 2026 : « un bouton Imprimer, à côté de Télécharger, pour un
 * document, un dossier ou une sélection ». Le serveur compose UN PDF à partir
 * des originaux conservés, dans l'ordre de l'index — la même composition que
 * le dossier téléchargé. Ce PDF est éphémère : il se rend, il ne se garde pas.
 *
 * ========================================================= AVEC QUOI
 *
 * Aucune bibliothèque d'assemblage de PDF n'est installée. Ce fichier emploie
 * ce que l'API a déjà : `@napi-rs/canvas`, dont `PDFDocument` écrit des pages
 * (texte et images), et pdf.js, qui rend les pages d'un PDF dans son fil
 * borné (`pagesDuPdf`, `miniature.ts`). Conséquence, à dire : une pièce PDF
 * entre dans l'impression comme l'IMAGE de ses pages (200 points par pouce),
 * pas comme ses objets d'origine — fidèle à l'œil et à l'imprimante, mais son
 * texte n'y est plus sélectionnable.
 *
 * ========================================================= LES POLICES
 *
 * L'image de l'API n'a aucune police système. Les mentions s'écrivent avec
 * Liberation Sans, livrée par pdf.js (`standard_fonts`) : elle couvre le
 * latin, pas l'arabe. Une police arabe présente sur la machine est employée
 * (`POLICES_ARABES`) ; sans elle, `saitEcrire` le constate et l'appelant écrit
 * les mentions en français plutôt qu'en carrés vides.
 *
 * Ce fichier ne lit ni la base ni le disque des pièces : il reçoit des
 * valeurs, et un chargeur d'octets.
 */
import { createRequire } from "node:module";
import path from "node:path";

import {
  createCanvas,
  GlobalFonts,
  loadImage,
  PDFDocument,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";

import { estUnPdf, imageDeLaPiece, limitesDuRenduPdf, pagesDuPdf } from "./miniature.ts";

/** Une ligne de l'index : ce qu'on lit d'une pièce avant de la tourner. */
interface PieceAComposer {
  id: string;
  reference: string | null;
  type: string | null;
  tiers: string | null;
  date: string;
  montant: string | null;
  /** Le nombre de pages que la base en connaît : il règle le délai de son rendu. */
  pages: number;
}

export interface SocieteAComposer {
  nom: string;
  matricule: string | null;
  periode: string;
  pieces: PieceAComposer[];
}

/** Les mentions imprimées, dans la langue retenue (`ref.labels`, ns `mention_d_impression`). */
export type Mentions = Readonly<Record<string, string>>;

export interface Composition {
  societes: SocieteAComposer[];
  mentions: Mentions;
  /** Le sens d'écriture des mentions : la page de garde et l'index se lisent en miroir. */
  sens: "ltr" | "rtl";
  /** L'instant de la composition, déjà écrit dans le fuseau de la personne. */
  composeLe: string;
  /** Au-delà, la composition s'arrête : la borne de la tour (`pages_max`). */
  pagesMax: number;
  /** Les octets d'une pièce ; `null` quand son dépôt n'a jamais abouti. */
  charger: (id: string) => Promise<Uint8Array | null>;
}

/** L'impression dépasse la borne de la tour : rien n'est rendu. */
export class ImpressionTropVolumineuse extends Error {}

/** A4, en points. */
const A4 = { largeur: 595.28, hauteur: 841.89 } as const;
const MARGE = 48;
/** Une page de pièce PDF, rendue à 200 points par pouce sur un A4. */
const BOITE_DE_RENDU = { largeur: 1654, hauteur: 2339 } as const;
/** Qualité JPEG des pages rendues, et de leur écriture dans le PDF. */
const QUALITE = 88;

const ENCRE = "#0A0A0A";
const GRIS = "#5C5C5C";
const FILET = "#D9D9D9";

const NORMALE = "MalicaImpression";
const GRASSE = "MalicaImpressionGras";
/** Les polices arabes qu'une machine peut porter ; aucune n'est exigée. */
const POLICES_ARABES = ["Noto Naskh Arabic", "Noto Sans Arabic", "Noto Kufi Arabic", "Amiri"];

let pile: string | null = null;

/** La pile de polices, enregistrée une fois : Liberation Sans, puis l'arabe s'il existe. */
function polices(): string {
  if (pile) return pile;
  const paquet = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const fichier = (nom: string) => path.join(paquet, "standard_fonts", nom);
  GlobalFonts.registerFromPath(fichier("LiberationSans-Regular.ttf"), NORMALE);
  GlobalFonts.registerFromPath(fichier("LiberationSans-Bold.ttf"), GRASSE);
  pile = POLICES_ARABES.filter((p) => GlobalFonts.has(p))
    .map((p) => `, "${p}"`)
    .join("");
  return pile;
}

const police = (taille: number, gras = false) =>
  `${taille}px ${gras ? GRASSE : NORMALE}${polices()}`;

/**
 * Ce texte se dessine-t-il, ou sortirait-il en carrés vides ? Mesuré, pas
 * supposé : le texte et autant de caractères sans glyphe sont dessinés, et
 * comparés point par point.
 */
export function saitEcrire(texte: string): boolean {
  const lettres = [...texte].filter((c) => c.trim() !== "").slice(0, 8);
  if (lettres.length === 0) return true;
  const dessin = (t: string) => {
    const toile = createCanvas(240, 40);
    const ctx = toile.getContext("2d");
    ctx.font = police(20);
    ctx.fillText(t, 4, 30);
    return Buffer.from(ctx.getImageData(0, 0, 240, 40).data);
  };
  return !dessin(lettres.join("")).equals(dessin("￿".repeat(lettres.length)));
}

/** Un texte qui tient dans sa largeur : coupé, avec des points de suspension. */
function ajuster(ctx: SKRSContext2D, texte: string, largeur: number): string {
  if (ctx.measureText(texte).width <= largeur) return texte;
  let court = texte;
  while (court.length > 1 && ctx.measureText(`${court}…`).width > largeur)
    court = court.slice(0, -1);
  return `${court}…`;
}

/** Les pages de garde et d'index s'écrivent d'un bord à l'autre, dans le sens des mentions. */
class Plume {
  private readonly ctx: SKRSContext2D;
  private readonly sens: "ltr" | "rtl";

  constructor(ctx: SKRSContext2D, sens: "ltr" | "rtl") {
    this.ctx = ctx;
    this.sens = sens;
    ctx.textBaseline = "alphabetic";
  }

  /** `x` se compte depuis le bord de lecture ; `fin` aligne sur l'autre bord de la case. */
  ecrire(
    texte: string,
    x: number,
    y: number,
    largeur: number,
    style: { taille: number; gras?: boolean; couleur?: string; fin?: boolean | undefined },
  ): void {
    const { ctx } = this;
    ctx.font = police(style.taille, style.gras);
    ctx.fillStyle = style.couleur ?? ENCRE;
    const debut = this.sens === "ltr" ? x : A4.largeur - x - largeur;
    const aDroite = (this.sens === "rtl") !== (style.fin === true);
    ctx.textAlign = aDroite ? "right" : "left";
    ctx.fillText(ajuster(ctx, texte, largeur), aDroite ? debut + largeur : debut, y);
  }

  filet(y: number): void {
    this.ctx.fillStyle = FILET;
    this.ctx.fillRect(MARGE, y, A4.largeur - 2 * MARGE, 0.75);
  }
}

/** Les colonnes de l'index : la mention de son en-tête, sa largeur, ce qu'elle lit. */
const COLONNES: ReadonlyArray<{
  mention: string;
  largeur: number;
  fin?: boolean;
  lire: (p: PieceAComposer, numero: number) => string;
}> = [
  { mention: "numero", largeur: 30, lire: (_p, n) => String(n) },
  { mention: "reference", largeur: 105, lire: (p) => p.reference ?? "—" },
  { mention: "type", largeur: 95, lire: (p) => p.type ?? "—" },
  { mention: "tiers", largeur: 125, lire: (p) => p.tiers ?? "—" },
  { mention: "date", largeur: 60, lire: (p) => p.date },
  { mention: "montant", largeur: 84, fin: true, lire: (p) => p.montant ?? "—" },
];
const HAUTEUR_DE_LIGNE = 18;
/** Où s'écrit la première ligne d'une page d'index, sous son en-tête. */
const PREMIERE_LIGNE = 136;
const LIGNES_PAR_PAGE = Math.floor((A4.hauteur - MARGE - PREMIERE_LIGNE) / HAUTEUR_DE_LIGNE) + 1;

/** Les pages qui précèdent les pièces d'une société : sa page de garde, puis son index. */
export function pagesDeTete(pieces: number): number {
  return 1 + Math.ceil(pieces / LIGNES_PAR_PAGE);
}

/**
 * Compose le PDF. Rend ses octets et le nombre de pages écrites ; lève
 * `ImpressionTropVolumineuse` dès que la borne est franchie.
 */
export async function composerLImpression(
  composition: Composition,
): Promise<{ pdf: Buffer; pages: number }> {
  const { societes, mentions, sens, composeLe, pagesMax, charger } = composition;
  const m = (code: string) => mentions[code] ?? "";
  const doc = new PDFDocument({
    title: m("titre"),
    creator: "Malica Office",
    encodingQuality: QUALITE,
  });
  let pages = 0;
  const ouvrir = (largeur: number, hauteur: number): SKRSContext2D => {
    if (pages >= pagesMax) throw new ImpressionTropVolumineuse();
    pages += 1;
    // Le type déclaré est celui du DOM ; l'objet rendu est la plume de Skia.
    return doc.beginPage(largeur, hauteur) as unknown as SKRSContext2D;
  };
  /** Une image posée entière sur un A4, dans le sens qui la montre le mieux. */
  const poser = (image: Image): void => {
    const couchee = image.width > image.height;
    const page = couchee
      ? { largeur: A4.hauteur, hauteur: A4.largeur }
      : { largeur: A4.largeur, hauteur: A4.hauteur };
    const ctx = ouvrir(page.largeur, page.hauteur);
    const echelle = Math.min(page.largeur / image.width, page.hauteur / image.height);
    const l = image.width * echelle;
    const h = image.height * echelle;
    ctx.drawImage(image, (page.largeur - l) / 2, (page.hauteur - h) / 2, l, h);
    doc.endPage();
  };

  for (const societe of societes) {
    // ------------------------------------------------------- la page de garde
    {
      const plume = new Plume(ouvrir(A4.largeur, A4.hauteur), sens);
      const largeur = A4.largeur - 2 * MARGE;
      plume.ecrire(m("titre"), MARGE, 120, largeur, { taille: 24, gras: true });
      plume.filet(140);
      let y = 196;
      for (const [mention, valeur, grande] of [
        ["societe", societe.nom, true],
        ["matricule", societe.matricule ?? "—", false],
        ["periode", societe.periode, false],
        ["pieces", String(societe.pieces.length), false],
        ["imprime_le", composeLe, false],
      ] as const) {
        plume.ecrire(m(mention), MARGE, y, largeur, { taille: 10, couleur: GRIS });
        plume.ecrire(valeur, MARGE, y + (grande ? 26 : 20), largeur, {
          taille: grande ? 20 : 14,
          gras: grande,
        });
        y += grande ? 64 : 54;
      }
      doc.endPage();
    }

    // ----------------------------------------------------------------- l'index
    let plume: Plume | null = null;
    let y = 0;
    const enTete = () => {
      plume = new Plume(ouvrir(A4.largeur, A4.hauteur), sens);
      const largeur = A4.largeur - 2 * MARGE;
      plume.ecrire(m("index"), MARGE, 64, largeur, { taille: 16, gras: true });
      plume.ecrire(societe.nom, MARGE, 82, largeur, { taille: 10, couleur: GRIS });
      let x = MARGE;
      for (const c of COLONNES) {
        plume.ecrire(m(c.mention), x, 112, c.largeur - 6, {
          taille: 8,
          couleur: GRIS,
          fin: c.fin,
        });
        x += c.largeur;
      }
      plume.filet(PREMIERE_LIGNE - HAUTEUR_DE_LIGNE);
      y = PREMIERE_LIGNE;
    };
    for (const [i, piece] of societe.pieces.entries()) {
      if (i % LIGNES_PAR_PAGE === 0) {
        if (plume) doc.endPage();
        enTete();
      }
      let x = MARGE;
      for (const c of COLONNES) {
        plume!.ecrire(c.lire(piece, i + 1), x, y, c.largeur - 6, { taille: 9, fin: c.fin });
        x += c.largeur;
      }
      y += HAUTEUR_DE_LIGNE;
    }
    if (plume) doc.endPage();

    // --------------------------------------- les pièces, dans l'ordre de l'index
    for (const [i, piece] of societe.pieces.entries()) {
      const octets = await charger(piece.id);
      const images: Image[] = [];
      if (octets && estUnPdf(octets)) {
        const rendues = await pagesDuPdf(
          octets,
          { boite: BOITE_DE_RENDU, qualite: QUALITE, pages: pagesMax - pages },
          limitesDuRenduPdf.delaiMs * piece.pages,
        );
        for (const jpeg of rendues ?? []) images.push(await loadImage(jpeg));
      } else if (octets) {
        const image = await imageDeLaPiece(octets);
        if (image) images.push(image);
      }
      if (images.length > 0) {
        for (const image of images) poser(image);
        continue;
      }
      // Un original qu'on ne sait pas composer (HEIC, PDF chiffré, octets
      // absents) garde sa place dans l'ordre, et le dit.
      const feuille = new Plume(ouvrir(A4.largeur, A4.hauteur), sens);
      const largeur = A4.largeur - 2 * MARGE;
      feuille.ecrire(
        [String(i + 1), piece.reference, piece.tiers].filter(Boolean).join(" · "),
        MARGE,
        120,
        largeur,
        { taille: 16, gras: true },
      );
      feuille.ecrire(m("original_non_imprimable"), MARGE, 150, largeur, {
        taille: 11,
        couleur: GRIS,
      });
      doc.endPage();
    }
  }
  return { pdf: doc.close(), pages };
}
