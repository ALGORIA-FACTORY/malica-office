/**
 * Moteur de rapprochement bancaire — appariement déterministe.
 * L'IA peut suggérer un ordre de lecture ; l'appariement retenu et l'écart
 * sortent d'ici. Tolérances passées en paramètres (pack), jamais en dur.
 */
import { D, toFixedStr } from "../../domain/decimal.ts";
import type {
  BankLine,
  BookLine,
  RapprochementPaire,
  RapprochementV1,
} from "../../contracts/rapprochement.v1.ts";

export interface RapprochementParams {
  currency: string;
  decimals: number;
  toleranceJours: number;
  toleranceMontant: string;
}

function days(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function normalizeRef(ref: string | null): string {
  return (ref ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Score = 60 pour un montant exact (40 dans la tolérance), + 20 pour la date
 * (dégressif dans la tolérance), + 20 pour une référence identique.
 * Appariement glouton par score décroissant, une ligne au plus par côté.
 */
export function computeRapprochement(
  params: RapprochementParams,
  bank: readonly BankLine[],
  book: readonly BookLine[],
): RapprochementV1 {
  const tolMontant = D(params.toleranceMontant);
  const candidates: RapprochementPaire[] = [];

  for (const b of bank) {
    for (const k of book) {
      const ecart = D(b.montant).minus(k.montant);
      const ecartAbs = ecart.abs();
      if (ecartAbs.gt(tolMontant)) continue;

      const ecartJours = days(b.at, k.at);
      if (Math.abs(ecartJours) > params.toleranceJours) continue;

      const refExacte =
        normalizeRef(b.reference).length > 0 &&
        normalizeRef(b.reference) === normalizeRef(k.reference);

      let score = ecartAbs.isZero() ? 60 : 40;
      score += Math.max(
        0,
        20 - Math.round((Math.abs(ecartJours) / Math.max(1, params.toleranceJours)) * 20),
      );
      if (refExacte) score += 20;

      candidates.push({
        bank_id: b.id,
        book_id: k.id,
        score: Math.min(100, score),
        ecart_montant: toFixedStr(ecart, params.decimals),
        ecart_jours: ecartJours,
        reference_exacte: refExacte,
      });
    }
  }

  candidates.sort(
    (x, y) => y.score - x.score || (x.bank_id < y.bank_id ? -1 : x.bank_id > y.bank_id ? 1 : 0),
  );

  const usedBank = new Set<string>();
  const usedBook = new Set<string>();
  const paires: RapprochementPaire[] = [];
  for (const c of candidates) {
    if (usedBank.has(c.bank_id) || usedBook.has(c.book_id)) continue;
    usedBank.add(c.bank_id);
    usedBook.add(c.book_id);
    paires.push(c);
  }

  const totalBank = bank.reduce((acc, l) => acc.plus(l.montant), D(0));
  const totalBook = book.reduce((acc, l) => acc.plus(l.montant), D(0));

  return {
    contract: "rapprochement.v1",
    currency: params.currency,
    tolerance_jours: params.toleranceJours,
    tolerance_montant: toFixedStr(tolMontant, params.decimals),
    paires,
    bank_orphelines: bank.filter((l) => !usedBank.has(l.id)).map((l) => l.id),
    book_orphelines: book.filter((l) => !usedBook.has(l.id)).map((l) => l.id),
    totals: {
      bank: toFixedStr(totalBank, params.decimals),
      book: toFixedStr(totalBook, params.decimals),
      ecart: toFixedStr(totalBank.minus(totalBook), params.decimals),
    },
  };
}
