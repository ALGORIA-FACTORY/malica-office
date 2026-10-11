/**
 * Le reçu, mis en page — et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * Le CONTENU du reçu vient du Socle (`construireRecu`) : la somme, le refus
 * d'un reçu vide, les décimales du pack. Ce module ne décide de rien. Il
 * dessine, et si on le supprimait, aucun chiffre ne changerait.
 *
 * ==================================== POURQUOI UNE IMAGE, ET PAS DU TEXTE PDF
 *
 * Un PDF texte demande une fonte embarquée. Trois langues, dont l'arabe, qui
 * exige la liaison des lettres et l'écriture de droite à gauche : écrire ce
 * moteur de rendu à la main produirait un document juste en français et
 * illisible en arabe.
 *
 * Le navigateur sait déjà le faire. On dessine donc sur un canevas — le
 * système choisit la fonte, lie l'arabe, place les accents — puis on réutilise
 * l'encodeur PDF du numériseur, celui par lequel passe déjà chaque pièce.
 *
 * A4 à 200 dpi, comme les pages numérisées : un reçu et une facture
 * s'impriment à la même échelle, et le cabinet reçoit un lot homogène.
 */
import { buildImagesPdf } from "./scanner";

import type { Recu } from "@malica/socle/use-cases/recu-de-paiement";

/** A4 à 200 dpi, en pixels. La même échelle que les pages numérisées. */
const LARGEUR = 1654;
const HAUTEUR = 2339;
const MARGE = 130;

/** Qualité JPEG : la même que les pages numérisées. */
const QUALITE = 0.82;

export interface RecuRendu {
  blob: Blob;
  name: string;
}

/**
 * Dessine le reçu et rend un PDF d'une page.
 *
 * `direction` vient de l'i18n : en arabe, le texte s'aligne à droite et les
 * colonnes s'inversent. Sans cela, un reçu arabe serait un reçu français
 * écrit avec des lettres arabes.
 */
export async function rendreRecuEnPdf(recu: Recu, direction: "ltr" | "rtl"): Promise<RecuRendu> {
  const canevas = document.createElement("canvas");
  canevas.width = LARGEUR;
  canevas.height = HAUTEUR;
  const ctx = canevas.getContext("2d");
  if (!ctx) throw new Error("recu.canevas_indisponible");

  const rtl = direction === "rtl";
  const debut = rtl ? LARGEUR - MARGE : MARGE;
  const fin = rtl ? MARGE : LARGEUR - MARGE;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  ctx.fillStyle = "#0A0A0A";
  ctx.textBaseline = "alphabetic";
  ctx.direction = direction;

  const aDroite = (texte: string, x: number, y: number, police: string) => {
    ctx.font = police;
    ctx.textAlign = rtl ? "left" : "right";
    ctx.fillText(texte, x, y);
  };
  const aGauche = (texte: string, x: number, y: number, police: string) => {
    ctx.font = police;
    ctx.textAlign = rtl ? "right" : "left";
    ctx.fillText(texte, x, y);
  };
  const trait = (y: number, epaisseur = 2) => {
    ctx.fillRect(MARGE, y, LARGEUR - 2 * MARGE, epaisseur);
  };

  let y = MARGE + 60;
  aGauche(recu.titre, debut, y, "600 64px system-ui, sans-serif");
  y += 26;
  trait(y, 5);

  // Le dossier qui émet, et son matricule : c'est la mention que le pack
  // exige, et le Socle a déjà refusé de produire le reçu sans elle.
  y += 78;
  aGauche(recu.dossier.nom, debut, y, "600 38px system-ui, sans-serif");
  y += 46;
  aGauche(
    `${recu.libelles.matricule} : ${recu.dossier.matricule}`,
    debut,
    y,
    "30px system-ui, sans-serif",
  );

  const champ = (libelle: string, valeur: string) => {
    y += 52;
    aGauche(libelle, debut, y, "30px system-ui, sans-serif");
    aDroite(valeur, fin, y, "600 32px system-ui, sans-serif");
  };

  y += 40;
  if (recu.tiers) champ(recu.libelles.tiers, recu.tiers);
  if (recu.piece.reference) champ(recu.libelles.piece, recu.piece.reference);
  if (recu.piece.date) champ(recu.libelles.date, recu.piece.date);
  champ(recu.libelles.emisLe, recu.emisLe);

  // Les paiements, un par ligne. Un acompte et un solde sont deux faits, et
  // le reçu dit comment on a payé — pas seulement combien.
  y += 70;
  trait(y);
  y += 56;
  aGauche(recu.libelles.moyen, debut, y, "600 28px system-ui, sans-serif");
  aDroite(recu.libelles.montant, fin, y, "600 28px system-ui, sans-serif");
  y += 18;
  trait(y, 1);

  for (const p of recu.paiements) {
    y += 56;
    aGauche(p.date ? `${p.moyen} — ${p.date}` : p.moyen, debut, y, "32px system-ui, sans-serif");
    aDroite(`${p.montant} ${recu.devise}`, fin, y, "32px system-ui, sans-serif");
  }

  y += 34;
  trait(y, 3);
  y += 64;
  aGauche(recu.libelles.total, debut, y, "600 40px system-ui, sans-serif");
  aDroite(`${recu.total} ${recu.devise}`, fin, y, "600 44px system-ui, sans-serif");

  // Les mentions obligatoires, en pied : elles viennent du pack (R4), et ce
  // module ne fait que les recopier dans l'ordre reçu.
  let pied = HAUTEUR - MARGE - recu.mentions.length * 40;
  for (const mention of recu.mentions) {
    aGauche(mention, debut, pied, "24px system-ui, sans-serif");
    pied += 40;
  }

  const jpeg = await new Promise<Blob>((resoudre, rejeter) => {
    canevas.toBlob(
      (b) => (b ? resoudre(b) : rejeter(new Error("recu.encodage_impossible"))),
      "image/jpeg",
      QUALITE,
    );
  });
  const pdf = buildImagesPdf(
    [
      {
        jpeg: new Uint8Array(await jpeg.arrayBuffer()),
        widthPx: LARGEUR,
        heightPx: HAUTEUR,
      },
    ],
    recu.titre,
  );
  return { blob: pdf, name: `recu-${recu.emisLe}.pdf` };
}
