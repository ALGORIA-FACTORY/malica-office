/**
 * Des plans de jetons SYNTHÉTIQUES, et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * Le jeu d'or (`malica/lecture/jeu-d-or.ts`) porte de VRAIES factures, et
 * c'est lui qui fait foi pour la lecture des valeurs. Il ne peut pas servir
 * ici : la signature structurelle se juge sur des COUPLES — deux formats
 * voisins, la même facture recadrée, la même facture aux valeurs changées —
 * et le jeu d'or ne porte pas ces couples.
 *
 * Les plans de ce fichier sont donc **fabriqués**, et c'est dit en toutes
 * lettres pour qu'aucune mesure ne les prenne pour des pièces réelles. Ils
 * n'autorisent aucune conclusion sur le taux de reconnaissance en production ;
 * ils prouvent seulement qu'une propriété de la signature tient ou ne tient
 * pas — ce qu'un plan réel prouverait aussi, en plus cher et en moins varié.
 *
 * Aucun appel de modèle, aucun fournisseur payant : tout est posé à la main.
 */
import type { PageToken } from "@malica/socle/ports/malica";

/** Un mot posé sur une ligne, avec son empan horizontal (0..1 dans la page). */
export interface MotSynthetique {
  texte: string;
  x0: number;
  x1: number;
}

/** Une ligne de la page : son bord haut, sa hauteur, ses mots. */
export interface LigneSynthetique {
  y: number;
  hauteur?: number;
  mots: MotSynthetique[];
}

const HAUTEUR_DE_LIGNE = 0.02;

const mot = (texte: string, x0: number, x1: number): MotSynthetique => ({ texte, x0, x1 });

/**
 * Compose un plan de jetons à partir de pages de lignes.
 *
 * Les ordinaux suivent l'ordre d'écriture de la liste, comme le fait
 * `fusionnerBandes` pour un relevé réel : l'ordre de lecture, et non l'ordre
 * géométrique recalculé.
 */
function planSynthetique(pages: ReadonlyArray<ReadonlyArray<LigneSynthetique>>): PageToken[] {
  const sortie: PageToken[] = [];
  pages.forEach((lignes, index) => {
    let ordinal = 0;
    for (const ligne of lignes) {
      const hauteur = ligne.hauteur ?? HAUTEUR_DE_LIGNE;
      for (const m of ligne.mots) {
        sortie.push({
          page: index + 1,
          ordinal,
          text: m.texte,
          x0: m.x0,
          y0: ligne.y,
          x1: m.x1,
          y1: ligne.y + hauteur,
        });
        ordinal += 1;
      }
    }
  });
  return sortie;
}

/**
 * Le même document photographié autrement : décalé, et pris de plus loin.
 *
 * C'est le cas ORDINAIRE du produit — une photo au téléphone, jamais deux
 * fois le même cadrage —, et c'est pour lui que la signature se calcule dans
 * la boîte de contenu plutôt que dans la page.
 */
export function recadrer(
  tokens: readonly PageToken[],
  decalageX: number,
  decalageY: number,
  echelle: number,
): PageToken[] {
  return tokens.map((t) => ({
    ...t,
    x0: t.x0 * echelle + decalageX,
    x1: t.x1 * echelle + decalageX,
    y0: t.y0 * echelle + decalageY,
    y1: t.y1 * echelle + decalageY,
  }));
}

/** La même pièce posée de travers sur la vitre : une page cisaillée. */
export function incliner(tokens: readonly PageToken[], pente: number): PageToken[] {
  return tokens.map((t) => {
    const glissement = pente * ((t.x0 + t.x1) / 2);
    return { ...t, y0: t.y0 + glissement, y1: t.y1 + glissement };
  });
}

/* ------------------------------------------------- une facture française */

interface ValeursDeFacture {
  client: readonly [string, string];
  numero: string;
  date: string;
  entetePrixUnitaire: string;
  articles: ReadonlyArray<readonly [string, string, string, string]>;
  ht: string;
  tva: string;
  ttc: string;
  /** Faux : le total TTC est imprimé AVANT la TVA — un format voisin, et autre. */
  ttcAvantTva?: boolean;
}

function lignesDeFacture(v: ValeursDeFacture): LigneSynthetique[] {
  const pied: LigneSynthetique[] = v.ttcAvantTva
    ? [
        { y: 0.72, mots: [mot("Total", 0.6, 0.68), mot("TTC", 0.69, 0.74), mot(v.ttc, 0.8, 0.92)] },
        { y: 0.77, mots: [mot("TVA", 0.6, 0.66), mot(v.tva, 0.8, 0.92)] },
        { y: 0.82, mots: [mot("Total", 0.6, 0.68), mot("HT", 0.69, 0.73), mot(v.ht, 0.8, 0.92)] },
      ]
    : [
        { y: 0.72, mots: [mot("Total", 0.6, 0.68), mot("HT", 0.69, 0.73), mot(v.ht, 0.8, 0.92)] },
        { y: 0.77, mots: [mot("TVA", 0.6, 0.66), mot(v.tva, 0.8, 0.92)] },
        { y: 0.82, mots: [mot("Total", 0.6, 0.68), mot("TTC", 0.69, 0.74), mot(v.ttc, 0.8, 0.92)] },
      ];

  return [
    { y: 0.05, mots: [mot("SOTUPAP", 0.05, 0.2), mot("FACTURE", 0.62, 0.8)] },
    {
      y: 0.1,
      mots: [mot("Matricule", 0.05, 0.15), mot("Fiscal", 0.16, 0.23), mot("1234567A", 0.24, 0.36)],
    },
    {
      y: 0.15,
      mots: [mot("Client", 0.05, 0.12), mot(v.client[0], 0.14, 0.24), mot(v.client[1], 0.25, 0.35)],
    },
    { y: 0.2, mots: [mot("Numero", 0.62, 0.72), mot(v.numero, 0.74, 0.9)] },
    { y: 0.25, mots: [mot("Date", 0.62, 0.68), mot(v.date, 0.72, 0.88)] },
    {
      y: 0.36,
      mots: [
        mot("Designation", 0.05, 0.24),
        mot("Qte", 0.45, 0.51),
        mot(v.entetePrixUnitaire, 0.58, 0.7),
        mot("Total", 0.8, 0.9),
      ],
    },
    // Les lignes se resserrent quand elles sont nombreuses : une facture
    // longue reste une facture, et son tableau ne déborde pas sur son pied.
    ...v.articles.map((a, i) => ({
      y: 0.44 + i * Math.min(0.06, 0.18 / v.articles.length),
      mots: [mot(a[0], 0.05, 0.18), mot(a[1], 0.46, 0.5), mot(a[2], 0.6, 0.7), mot(a[3], 0.8, 0.9)],
    })),
    ...pied,
    {
      y: 0.9,
      mots: [
        mot("Arretee", 0.05, 0.15),
        mot("la", 0.16, 0.19),
        mot("presente", 0.2, 0.32),
        mot("facture", 0.33, 0.43),
      ],
    },
  ];
}

const ARTICLES_A: ValeursDeFacture["articles"] = [
  ["Papier", "2", "400,000", "800,000"],
  ["Encre", "1", "380,000", "380,000"],
];

/** Le format de référence : prix unitaires HORS taxe, TVA puis TTC. */
export const FACTURE_A = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["DREAM", "OPTIC"],
      numero: "FA-2026-118",
      date: "04/10/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: ARTICLES_A,
      ht: "1180,000",
      tva: "224,200",
      ttc: "1404,200",
    }),
  ]);

/** Le MÊME format, un autre mois : seules les valeurs chiffrées changent. */
export const FACTURE_A_AUTRES_VALEURS = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["DREAM", "OPTIC"],
      numero: "FA-2026-240",
      date: "12/11/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: [
        ["Papier", "7", "400,000", "2800,000"],
        ["Encre", "3", "380,000", "1140,000"],
      ],
      ht: "3940,000",
      tva: "748,600",
      ttc: "4688,600",
    }),
  ]);

/**
 * Le MÊME format encore, mais six lignes d'articles au lieu de deux.
 *
 * C'est le piège du comptage : un libellé d'article vu six fois plutôt que
 * deux ne change pas la forme du document. Une mesure qui compterait les
 * occurrences éloignerait une facture longue de la facture courte qui a
 * pourtant exactement la même structure.
 */
export const FACTURE_A_SIX_LIGNES = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["DREAM", "OPTIC"],
      numero: "FA-2026-402",
      date: "18/12/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: [
        ["Papier", "2", "400,000", "800,000"],
        ["Encre", "1", "380,000", "380,000"],
        ["Papier", "4", "400,000", "1600,000"],
        ["Encre", "3", "380,000", "1140,000"],
        ["Papier", "1", "400,000", "400,000"],
        ["Encre", "6", "380,000", "2280,000"],
      ],
      ht: "6600,000",
      tva: "1254,000",
      ttc: "7854,000",
    }),
  ]);

/** Le même format encore, mais un AUTRE client et d'autres désignations. */
export const FACTURE_A_AUTRE_CLIENT = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["SOCIETE", "BARAKA"],
      numero: "FA-2026-301",
      date: "02/12/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: [
        ["Cartouche", "4", "150,000", "600,000"],
        ["Classeur", "9", "12,000", "108,000"],
      ],
      ht: "708,000",
      tva: "134,520",
      ttc: "842,520",
    }),
  ]);

/**
 * Le format VOISIN, et incompatible : prix unitaires TTC, pied inversé.
 *
 * C'est la confusion qui coûte cher — les libellés, l'ossature et la place des
 * blocs sont les mêmes ; ce qui change décide de ce qu'on inscrit en compta.
 */
export const FACTURE_B_TTC = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["DREAM", "OPTIC"],
      numero: "FB-2026-118",
      date: "04/10/2026",
      entetePrixUnitaire: "P.U.TTC",
      articles: [
        ["Papier", "2", "476,000", "952,000"],
        ["Encre", "1", "452,200", "452,200"],
      ],
      ht: "1180,000",
      tva: "224,200",
      ttc: "1404,200",
      ttcAvantTva: true,
    }),
  ]);

/** Le format de référence, dont le tableau déborde sur une seconde page. */
export const FACTURE_A_DEUX_PAGES = (): PageToken[] => {
  const entete: LigneSynthetique = {
    y: 0.36,
    mots: [
      mot("Designation", 0.05, 0.24),
      mot("Qte", 0.45, 0.51),
      mot("P.U.HT", 0.58, 0.7),
      mot("Total", 0.8, 0.9),
    ],
  };
  const page1 = lignesDeFacture({
    client: ["DREAM", "OPTIC"],
    numero: "FA-2026-118",
    date: "04/10/2026",
    entetePrixUnitaire: "P.U.HT",
    articles: ARTICLES_A,
    ht: "1180,000",
    tva: "224,200",
    ttc: "1404,200",
  }).filter((l) => l.y < 0.6);
  const page2: LigneSynthetique[] = [
    entete,
    {
      y: 0.44,
      mots: [
        mot("Stylo", 0.05, 0.18),
        mot("5", 0.46, 0.5),
        mot("8,000", 0.6, 0.7),
        mot("40,000", 0.8, 0.9),
      ],
    },
    { y: 0.72, mots: [mot("Total", 0.6, 0.68), mot("HT", 0.69, 0.73), mot("1220,000", 0.8, 0.92)] },
    { y: 0.77, mots: [mot("TVA", 0.6, 0.66), mot("231,800", 0.8, 0.92)] },
    {
      y: 0.82,
      mots: [mot("Total", 0.6, 0.68), mot("TTC", 0.69, 0.74), mot("1451,800", 0.8, 0.92)],
    },
  ];
  return planSynthetique([page1, page2]);
};

/* ---------------------------------------------------- une facture arabe */

/*
 * Les entêtes arabes sont écrits SANS espace — « سعرالوحدة » — parce que
 * `detectColumnBands` compare une clé dont les espaces sont retirés à un seul
 * jeton. Un plan réel découpe « سعر الوحدة » en DEUX jetons, et la colonne
 * n'est alors jamais reconnue : c'est une limite de l'existant, relevée et
 * non corrigée ici (la chaîne de lecture appartient à une autre tâche).
 */
export const MOTS_AR = {
  facture: "فاتورة",
  date: "التاريخ",
  numero: "الرقم",
  designation: "البيان",
  quantite: "الكمية",
  prixUnitaire: "سعرالوحدة",
  total: "المجموع",
  taxe: "الأداء",
} as const;

const FACTURE_AR = MOTS_AR.facture;
const DATE_AR = MOTS_AR.date;
const NUMERO_AR = MOTS_AR.numero;
const DESIGNATION_AR = MOTS_AR.designation;
const QUANTITE_AR = MOTS_AR.quantite;
const PRIX_UNITAIRE_AR = MOTS_AR.prixUnitaire;
const TOTAL_AR = MOTS_AR.total;
const TAXE_AR = MOTS_AR.taxe;

/** Une page entièrement en arabe : l'ancre est à DROITE de ce qu'elle qualifie. */
export const FACTURE_ARABE = (): PageToken[] =>
  planSynthetique([
    [
      { y: 0.05, mots: [mot(FACTURE_AR, 0.75, 0.92)] },
      { y: 0.12, mots: [mot(DATE_AR, 0.78, 0.92), mot("04/10/2026", 0.58, 0.74)] },
      { y: 0.18, mots: [mot(NUMERO_AR, 0.8, 0.92), mot("118", 0.62, 0.76)] },
      {
        y: 0.36,
        mots: [
          mot(DESIGNATION_AR, 0.78, 0.92),
          mot(QUANTITE_AR, 0.56, 0.68),
          mot(PRIX_UNITAIRE_AR, 0.32, 0.48),
          mot(TOTAL_AR, 0.08, 0.24),
        ],
      },
      {
        y: 0.44,
        mots: [
          mot("ورق", 0.8, 0.9),
          mot("2", 0.6, 0.64),
          mot("650,000", 0.34, 0.46),
          mot("1300,000", 0.08, 0.22),
        ],
      },
      { y: 0.72, mots: [mot(TOTAL_AR, 0.78, 0.92), mot("1300,000", 0.08, 0.22)] },
      { y: 0.8, mots: [mot(TAXE_AR, 0.78, 0.92), mot("247,000", 0.08, 0.22)] },
    ],
  ]);

/** Les deux écritures sur la même page — le cas courant, pas le cas limite. */
export const FACTURE_MIXTE = (): PageToken[] =>
  planSynthetique([
    [
      { y: 0.05, mots: [mot("SOTUPAP", 0.05, 0.2), mot(FACTURE_AR, 0.75, 0.92)] },
      { y: 0.12, mots: [mot("Date", 0.05, 0.12), mot(DATE_AR, 0.78, 0.92)] },
      { y: 0.18, mots: [mot("Numero", 0.05, 0.14), mot(NUMERO_AR, 0.8, 0.92)] },
      {
        y: 0.36,
        mots: [
          mot("Designation", 0.05, 0.22),
          mot(QUANTITE_AR, 0.56, 0.68),
          mot("Qte", 0.45, 0.51),
          mot(TOTAL_AR, 0.08, 0.24),
        ],
      },
      { y: 0.72, mots: [mot("Total", 0.6, 0.68), mot(TAXE_AR, 0.78, 0.92)] },
    ],
  ]);

/**
 * Une page qui ne porte qu'un libellé, répété douze fois.
 *
 * Elle existe pour un piège précis : une ancre répétée gonfle les comptages,
 * et une mesure naïve rapprocherait cette page de toute facture portant le
 * même mot. Elle doit en rester loin.
 */
export const PAGE_DE_TOTAUX = (): PageToken[] =>
  planSynthetique([
    Array.from({ length: 12 }, (_, i) => ({
      y: 0.06 + i * 0.07,
      mots: [mot("Total", 0.1 + (i % 3) * 0.25, 0.2 + (i % 3) * 0.25)],
    })),
  ]);
