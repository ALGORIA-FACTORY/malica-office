import type {
  AnomalyThresholdRow,
  ChargeFamille,
  ChargeQuestionRow,
  ChargesRepository,
  PieceArticle,
} from "../../ports/repositories";

/** Adaptateur de démonstration : mêmes contrats, données locales, aucun réseau. */
const familles: ChargeFamille[] = [
  { code: "MARCHANDISES", label: "Marchandises", ordinal: 10, isFallback: false },
  { code: "FOURNITURES", label: "Fournitures et consommables", ordinal: 20, isFallback: false },
  { code: "TRANSPORT", label: "Transport et déplacements", ordinal: 40, isFallback: false },
  { code: "NON_CLASSE", label: "Non classée", ordinal: 999, isFallback: true },
];

function period(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - offset);
  return d.toISOString().slice(0, 7);
}

const articles: PieceArticle[] = [
  ["MARCHANDISES", "Verres organiques 1.5", "20", "18.000", period(0)],
  ["FOURNITURES", "Solution de nettoyage", "12", "9.500", period(0)],
  ["TRANSPORT", "Livraison express Tunis", "3", "45.000", period(0)],
  ["MARCHANDISES", "Verres organiques 1.5", "18", "18.000", period(1)],
  ["FOURNITURES", "Solution de nettoyage", "4", "9.500", period(1)],
  ["TRANSPORT", "Livraison Tunis", "1", "45.000", period(1)],
  ["MARCHANDISES", "Verres organiques 1.5", "19", "18.000", period(2)],
  ["FOURNITURES", "Solution de nettoyage", "4", "9.500", period(2)],
  ["TRANSPORT", "Livraison Tunis", "1", "45.000", period(2)],
].map(([famille, designation, qty, pu, per], i) => ({
  pieceId: `demo-piece-${i}`,
  ordinal: i + 1,
  designation: designation as string,
  quantity: qty as string,
  unitPriceHt: pu as string,
  unitPriceTtc: (Number(pu) * 1.19).toFixed(3),
  totalHt: (Number(qty) * Number(pu)).toFixed(3),
  familleCode: famille as string,
  familleSource: "designation_pattern",
  period: per as string,
  documentDate: `${per}-15`,
  citationField: `articles[${i}].designation`,
  citationQuantity: `articles[${i}].quantity`,
  citationUnitPriceHt: `articles[${i}].unit_price_ht`,
  citationUnitPriceTtc: `articles[${i}].unit_price_ttc`,
  citationTotalHt: `articles[${i}].total_ht`,
}));

const questions: ChargeQuestionRow[] = [];

export function createDevChargesRepository(): ChargesRepository {
  return {
    async familles(): Promise<ChargeFamille[]> {
      return familles;
    },
    async anomalyThreshold(_pack: string, code: string): Promise<AnomalyThresholdRow | null> {
      return { code, minPeriods: 2, deviationRatio: "0.5", minAmount: "50" };
    },
    async articles(_tenantId, fromPeriod, toPeriod): Promise<PieceArticle[]> {
      return articles.filter((a) => a.period >= fromPeriod && a.period <= toPeriod);
    },
    async questions(): Promise<ChargeQuestionRow[]> {
      return [...questions];
    },
    async answer(input): Promise<string> {
      const id = `demo-q-${questions.length + 1}`;
      questions.unshift({
        id,
        period: input.period,
        familleCode: input.familleCode,
        observed: input.observed,
        baseline: input.baseline,
        deviationRatio: input.deviationRatio,
        thresholdCode: input.thresholdCode,
        answer: input.answer,
        answeredAt: new Date().toISOString(),
      });
      return id;
    },
  };
}
