/**
 * Des lectures d'essai, et des lecteurs qui comptent leurs appels — pour les
 * épreuves de la relecture (`la-relecture-de-nuit.test.ts`) et de la passe de
 * nuit (`la-passe-de-nuit.test.ts`). Une seule copie : les deux épreuves
 * relisent la même facture fictive.
 *
 * Aucun modèle n'est appelé : les faux lecteurs rendent ce qu'on leur donne.
 * Leurs modèles n'ont pas de tarif, et la base refuse d'en journaliser le
 * coût — c'est juste, et c'est dit là où cela compte.
 */
import type { readPieceFlow } from "./read-flow.ts";
import type { PageToken } from "./token-plan.ts";
import type { VisionRead, VisionSelection } from "./vision.ts";

export type Lecteurs = NonNullable<Parameters<typeof readPieceFlow>[2]>;

const jeton = (ordinal: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal / 100,
  x1: 0.3,
  y1: 0.12 + ordinal / 100,
});
export const ref = (ordinal: number) => ({ page: 1, ordinal });

export const TOKENS: PageToken[] = [
  jeton(0, "ATLAS DISTRIBUTION"),
  jeton(1, "02/09/2026"),
  jeton(2, "1000.000"),
  jeton(3, "190.000"),
  jeton(4, "1190.000"),
  // Le libellé du HT, sur sa rangée, à gauche : le sudoku ne prouve pas un total HT qui ne
  // porte pas son libellé (décision du 2 novembre 2026).
  { page: 1, ordinal: 6, text: "Total HT", x0: 0.0, y0: 0.12, x1: 0.09, y1: 0.14 },
];
/** Le plan d'un autre lecteur : un jeton de plus, pour reconnaître le sien. */
export const TOKENS_DE_L_AUTRE: PageToken[] = [...TOKENS, jeton(5, "MERCI")];

export function lecture(
  readModel: string,
  selection: VisionSelection,
  tokens = TOKENS,
): VisionRead {
  const passe = { latencyMs: 1, tokensIn: null, tokensOut: null };
  return {
    tokens,
    selection,
    lecteur: readModel.includes("PP-OCR") ? "paddle" : "vision",
    paddleTente: false,
    model: readModel,
    readModel,
    selectModel: readModel,
    selectRole: "chat",
    latencyMs: 2,
    tokensIn: null,
    tokensOut: null,
    releve: passe,
    designation: passe,
  };
}

/** Une facture que le contrat accepte en entier : extract.v1. */
export function complete(readModel: string, tokens = TOKENS): VisionRead {
  return lecture(
    readModel,
    {
      issuer: ref(0),
      document_date: ref(1),
      currency: "TND",
      document_kind: "facture_achat",
      lines: [
        {
          label: "Marchandises",
          tax_code: "TVA_19",
          base_ht: ref(2),
          vat_amount: ref(3),
          ttc: ref(4),
        },
      ],
      articles: [],
      other_charges: [],
      totals: { base_ht: ref(2), vat: ref(3), ttc: ref(4) },
      references: {},
      overall_confidence: 0.9,
    } as unknown as VisionSelection,
    tokens,
  );
}

/** L'émetteur et la date non désignés : le contrat sort partiel. */
export function partielle(readModel: string, tokens = TOKENS): VisionRead {
  const c = complete(readModel, tokens);
  return lecture(readModel, { ...c.selection, issuer: null, document_date: null }, tokens);
}

/** Des lecteurs qui comptent leurs appels, et rendent ce qu'on leur donne. */
export function lecteurs(reponses: Array<() => VisionRead>): Lecteurs & { appels: number } {
  const l = {
    appels: 0,
    lire: async () => {
      const suivante = reponses[l.appels];
      l.appels += 1;
      if (!suivante) throw new Error("appel de modèle imprévu");
      return suivante();
    },
    secondLecteurDisponible: () => true,
  };
  return l;
}
