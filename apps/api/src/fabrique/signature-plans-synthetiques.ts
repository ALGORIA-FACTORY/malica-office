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
  /**
   * Le droit de timbre, imprimé entre la TVA et le TTC.
   *
   * C'est le pied de la facture tunisienne ORDINAIRE : « presque toute facture
   * tunisienne porte un droit de timbre » (`read-piece.ts`, 5 octobre 2026), et
   * l'équation du pied ne boucle que s'il y entre. Tant qu'aucun plan de banc
   * n'en portait, la fabrique se mesurait sur une facture que le marché
   * n'imprime presque jamais.
   */
  timbre?: string;
  /**
   * Le RÉCAPITULATIF PAR TAUX, imprimé entre le tableau d'articles et le pied.
   *
   * Une facture tunisienne le porte, et le contrat l'exige : `extract.v1`
   * demande au moins une ligne de taux (`lines` min 1). Sans lui, un extrait
   * tiré d'une recette ne PARSE pas, et « le contrat sort complet » ne se
   * mesure pas.
   *
   * ====================================== CE QUE CETTE LIGNE A CESSÉ DE CONTOURNER
   *
   * Elle imprimait le code du pack — « TVA19 » — et son commentaire disait que
   * c'était « une facilité de banc ». Le banc était donc plus facile que le
   * réel à l'endroit précis où la limite se mesurait : aucune facture
   * n'imprime « TVA19 », elles impriment un TAUX.
   *
   * Elle imprime désormais le taux, et c'est le langage qui a bougé : le code
   * de taux d'une ligne se NOMME depuis le référentiel
   * (`Tableau.code_de_taux`), comme un droit hors TVA, et comme le modèle le
   * nomme déjà dans `vision.ts`. Mesuré dans
   * `fabrique/une-recette-nomme-le-code-de-taux.test.ts` : désigné, le taux
   * imprimé BLOQUE l'écriture sur `MISSING_TAX_RATE`.
   */
  recapitulatifDeTva?: { taux: string; ht: string; tva: string; ttc: string };
}

function lignesDeFacture(v: ValeursDeFacture): LigneSynthetique[] {
  const ligneDeTimbre: LigneSynthetique[] =
    v.timbre === undefined
      ? []
      : [
          {
            y: 0.795,
            mots: [
              mot("Droit", 0.6, 0.66),
              mot("de", 0.665, 0.69),
              mot("timbre", 0.695, 0.75),
              mot(v.timbre, 0.8, 0.92),
            ],
          },
        ];

  const recapitulatif: LigneSynthetique[] =
    v.recapitulatifDeTva === undefined
      ? []
      : [
          {
            y: 0.62,
            mots: [
              mot("Taux", 0.05, 0.12),
              mot("BaseHT", 0.3, 0.42),
              mot("Taxe", 0.5, 0.58),
              mot("TotalTTC", 0.68, 0.8),
            ],
          },
          {
            y: 0.66,
            mots: [
              mot(v.recapitulatifDeTva.taux, 0.05, 0.14),
              mot(v.recapitulatifDeTva.ht, 0.3, 0.42),
              mot(v.recapitulatifDeTva.tva, 0.5, 0.6),
              mot(v.recapitulatifDeTva.ttc, 0.68, 0.8),
            ],
          },
        ];

  const pied: LigneSynthetique[] = v.ttcAvantTva
    ? [
        { y: 0.72, mots: [mot("Total", 0.6, 0.68), mot("TTC", 0.69, 0.74), mot(v.ttc, 0.8, 0.92)] },
        { y: 0.77, mots: [mot("TVA", 0.6, 0.66), mot(v.tva, 0.8, 0.92)] },
        { y: 0.82, mots: [mot("Total", 0.6, 0.68), mot("HT", 0.69, 0.73), mot(v.ht, 0.8, 0.92)] },
      ]
    : [
        { y: 0.72, mots: [mot("Total", 0.6, 0.68), mot("HT", 0.69, 0.73), mot(v.ht, 0.8, 0.92)] },
        { y: 0.77, mots: [mot("TVA", 0.6, 0.66), mot(v.tva, 0.8, 0.92)] },
        ...ligneDeTimbre,
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
    ...recapitulatif,
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
 * LA FACTURE TUNISIENNE ORDINAIRE : le même format, plus le droit de timbre.
 *
 * Elle existe pour une raison mesurable. Le pied de ce plan boucle
 * 1 180,000 + 224,200 + 1,000 = 1 405,200 : sans le timbre, l'équation
 * « TTC = HT + TVA + droits » tombe à 1 404,200 et le contrat sort PARTIEL.
 * C'est exactement la limite n° 1 de `docs/fabrique-de-lecteurs/02-ce-qui-est-livre.md`,
 * et c'est ce plan qui dit si elle est levée.
 */
export const FACTURE_A_TIMBRE = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["DREAM", "OPTIC"],
      numero: "FA-2026-118",
      date: "04/10/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: ARTICLES_A,
      ht: "1180,000",
      tva: "224,200",
      timbre: "1,000",
      ttc: "1405,200",
      recapitulatifDeTva: { taux: "19%", ht: "1180,000", tva: "224,200", ttc: "1404,200" },
    }),
  ]);

/** Le MÊME format à timbre, un autre mois : le second exemple d'une ossature. */
export const FACTURE_A_TIMBRE_AUTRES_VALEURS = (): PageToken[] =>
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
      timbre: "1,000",
      ttc: "4689,600",
      recapitulatifDeTva: { taux: "19%", ht: "3940,000", tva: "748,600", ttc: "4688,600" },
    }),
  ]);

/**
 * LE MÊME FORMAT À TIMBRE, CHEZ UN AUTRE CLIENT — et pourquoi il a fallu l'écrire.
 *
 * `FACTURE_A_TIMBRE` et `FACTURE_A_TIMBRE_AUTRES_VALEURS` portent le MÊME
 * client, et seuls leurs chiffres diffèrent. Elles suffisent à la
 * RECONNAISSANCE, qui compte des exemples, et elles ne suffisent pas à la
 * GÉNÉRATION, qui les déduplique sur l'empreinte de signature : les clés
 * d'ancre d'une signature écartent tout jeton portant un chiffre, donc deux
 * factures qui ne diffèrent que par leurs montants ont la MÊME empreinte.
 *
 * Et le générateur a raison de les compter pour une. « À un seul exemple,
 * l'ossature porte le nom du client comme si c'était la forme du papier » —
 * deux factures du même client ne font rien tomber de plus, mesuré 0,0000 qui
 * devient 0,0960 ailleurs. Il faut un autre CLIENT, pas d'autres chiffres.
 *
 * Trouvé le 20 octobre en écrivant le banc du générateur à timbre : le format
 * livré le 19 n'était générable depuis aucun de ses propres exemples.
 */
export const FACTURE_A_TIMBRE_AUTRE_CLIENT = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["SOCIETE", "BARAKA"],
      numero: "FA-2026-302",
      date: "03/12/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: [
        ["Cartouche", "4", "150,000", "600,000"],
        ["Classeur", "9", "12,000", "108,000"],
      ],
      ht: "708,000",
      tva: "134,520",
      timbre: "1,000",
      ttc: "843,520",
      recapitulatifDeTva: { taux: "19%", ht: "708,000", tva: "134,520", ttc: "842,520" },
    }),
  ]);

/**
 * LE MÊME FORMAT, UN TIMBRE QUI N'EST PAS CELUI DU BARÈME.
 *
 * Deux dinars de timbre, là où `ref.fiscal_charges.fixed_amount` en porte un.
 * Cela arrive — deux exemplaires timbrés, ou un barème qui a changé entre la
 * date de la pièce et celle du pack lu — et c'est le cas qui SÉPARE les deux
 * états de la fabrique :
 *
 *   sans droit désigné  le moteur d'équilibre retrouve un résidu de 2,000, ne
 *                       trouve au pack aucun droit à montant fixe de cette
 *                       valeur, et BLOQUE sur `RESIDUAL_UNEXPLAINED` ;
 *   droit désigné       le résidu n'existe pas, et le montant inscrit est celui
 *                       que la pièce imprime, cité au jeton.
 */
export const FACTURE_A_TIMBRE_HORS_BAREME = (): PageToken[] =>
  planSynthetique([
    lignesDeFacture({
      client: ["DREAM", "OPTIC"],
      numero: "FA-2026-119",
      date: "05/10/2026",
      entetePrixUnitaire: "P.U.HT",
      articles: ARTICLES_A,
      ht: "1180,000",
      tva: "224,200",
      timbre: "2,000",
      ttc: "1406,200",
      recapitulatifDeTva: { taux: "19%", ht: "1180,000", tva: "224,200", ttc: "1404,200" },
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
