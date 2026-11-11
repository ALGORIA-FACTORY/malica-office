/**
 * Un bloc de réponse, en PDF — mis en page, et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * Le contenu vient de `blocImprimable` : ce que l'écran affiche déjà, ligne par
 * ligne. Ce module ne décide de rien. Il dessine, comme le reçu
 * (`recu-pdf.ts`) et pour la même raison : un PDF texte demanderait une fonte
 * embarquée et un moteur de liaison de l'arabe écrit à la main. Le navigateur
 * sait déjà écrire les trois langues ; on dessine donc sur un canevas, puis on
 * réutilise l'encodeur PDF du numériseur.
 *
 * A4 à 200 dpi, comme les pages numérisées et le reçu : même échelle à
 * l'impression. Un tableau trop long pour une page continue sur la suivante,
 * avec son en-tête.
 */
import type { BlocImprimable } from "@/lib/bloc-imprimable";

/** A4 à 200 dpi, en pixels. La même échelle que les pages numérisées. */
const LARGEUR = 1654;
const HAUTEUR = 2339;
const MARGE = 130;
const QUALITE = 0.82;
const INTERLIGNE = 62;
const POLICE = "system-ui, sans-serif";

const ENCRE = "#0A0A0A";
const GRIS = "#5F6673";
const FILET = "#D9DBDF";

export async function rendreBlocEnPdf(
  bloc: BlocImprimable,
  direction: "ltr" | "rtl",
): Promise<Blob> {
  const rtl = direction === "rtl";
  const utile = LARGEUR - 2 * MARGE;
  const colonnes = Math.max(bloc.entete.length, bloc.numerique.length, 1);
  // La première colonne porte les libellés : elle prend la moitié quand elles sont deux,
  // un peu moins quand elles sont nombreuses.
  const premiere = colonnes === 1 ? utile : utile * (colonnes === 2 ? 0.55 : 0.4);
  const autres = colonnes === 1 ? 0 : (utile - premiere) / (colonnes - 1);
  const debutDe = (i: number) => (i === 0 ? 0 : premiere + (i - 1) * autres);
  const largeurDe = (i: number) => (i === 0 ? premiere : autres);

  const pages: HTMLCanvasElement[] = [];
  let ctx!: CanvasRenderingContext2D;
  let y = 0;

  /** Écrit une cellule : un nombre à la fin de sa colonne, un texte à son début. */
  const cellule = (texte: string, i: number, police: string, couleur = ENCRE) => {
    ctx.font = police;
    ctx.fillStyle = couleur;
    const finDeColonne = Boolean(bloc.numerique[i]);
    // En arabe la page est miroir : le début d'une colonne est à droite.
    const gauche = MARGE + (rtl ? utile - debutDe(i) - largeurDe(i) : debutDe(i));
    const aDroite = finDeColonne !== rtl;
    ctx.textAlign = aDroite ? "right" : "left";
    // Un nombre garde son sens de lecture, quelle que soit la langue de la page.
    ctx.direction = finDeColonne ? "ltr" : direction;
    ctx.fillText(texte, aDroite ? gauche + largeurDe(i) - 12 : gauche + 12, y, largeurDe(i) - 24);
  };
  const filet = (epaisseur = 2, couleur = FILET) => {
    ctx.fillStyle = couleur;
    ctx.fillRect(MARGE, y, utile, epaisseur);
  };
  const enTete = () => {
    if (bloc.entete.length === 0) return;
    bloc.entete.forEach((t, i) => cellule(t, i, `600 26px ${POLICE}`, GRIS));
    y += 22;
    filet(3, ENCRE);
    y += INTERLIGNE - 10;
  };
  const nouvellePage = () => {
    const canevas = document.createElement("canvas");
    canevas.width = LARGEUR;
    canevas.height = HAUTEUR;
    const c = canevas.getContext("2d");
    if (!c) throw new Error("bloc.canevas_indisponible");
    ctx = c;
    pages.push(canevas);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    ctx.textBaseline = "alphabetic";
    y = MARGE + 60;
    ctx.direction = direction;
    ctx.textAlign = rtl ? "right" : "left";
    ctx.fillStyle = ENCRE;
    ctx.font = `600 ${pages.length === 1 ? 46 : 32}px ${POLICE}`;
    ctx.fillText(bloc.titre, rtl ? LARGEUR - MARGE : MARGE, y, utile);
    if (bloc.sousTitre) {
      y += 50;
      ctx.font = `400 28px ${POLICE}`;
      ctx.fillStyle = GRIS;
      ctx.fillText(bloc.sousTitre, rtl ? LARGEUR - MARGE : MARGE, y, utile);
    }
    y += 110;
    enTete();
  };
  const place = (hauteur: number) => {
    if (y + hauteur > HAUTEUR - MARGE - 80) nouvellePage();
  };

  nouvellePage();
  for (const ligne of bloc.lignes) {
    place(INTERLIGNE);
    ligne.forEach((t, i) => cellule(t, i, `400 30px ${POLICE}`));
    y += 20;
    filet(1);
    y += INTERLIGNE - 20;
  }
  for (const total of bloc.totaux) {
    place(INTERLIGNE + 10);
    y -= INTERLIGNE - 22;
    filet(3, ENCRE);
    y += INTERLIGNE - 6;
    total.forEach((t, i) => cellule(t, i, `700 32px ${POLICE}`));
    y += INTERLIGNE;
  }
  place(INTERLIGNE);
  y += 30;
  ctx.direction = direction;
  ctx.textAlign = rtl ? "right" : "left";
  ctx.font = `400 24px ${POLICE}`;
  ctx.fillStyle = GRIS;
  ctx.fillText(bloc.pied, rtl ? LARGEUR - MARGE : MARGE, y, utile);

  const jpegs = await Promise.all(
    pages.map(
      (canevas) =>
        new Promise<Blob>((resoudre, rejeter) => {
          canevas.toBlob(
            (b) => (b ? resoudre(b) : rejeter(new Error("bloc.encodage_impossible"))),
            "image/jpeg",
            QUALITE,
          );
        }),
    ),
  );
  const { buildImagesPdf } = await import("./scanner");
  return buildImagesPdf(
    await Promise.all(
      jpegs.map(async (jpeg) => ({
        jpeg: new Uint8Array(await jpeg.arrayBuffer()),
        widthPx: LARGEUR,
        heightPx: HAUTEUR,
      })),
    ),
    bloc.titre,
  );
}
