import { D, sum, toFixedStr } from "../../domain/decimal.ts";
import { resolveTaxRate } from "../../domain/tax-rates.ts";
import type { CurrencyDef, TaxRateRow } from "../../domain/types.ts";
import type { ExtractV1 } from "../../contracts/extract.v1.ts";
import type { SensDeTva, TvaV1 } from "../../contracts/tva.v1.ts";

/**
 * Les lignes de la déclaration, telles que le référentiel les définit
 * (`ref.tva_declaration_lignes`) : le moteur les remplit, il n'en invente
 * aucune. `nature_par_defaut` reçoit une ligne d'extrait sans nature.
 */
export interface DeclarationInput {
  nature_par_defaut: string;
  /** La ligne qui reçoit chaque (sens, nature) : la seule règle de rangement (R10). */
  affectations: ReadonlyArray<{ sens: SensDeTva; nature: string; ligne: string | null }>;
  lignes: ReadonlyArray<{
    code: string;
    label: string;
    sens: SensDeTva;
    nature: string | null;
    ordinal: number;
    incertain: boolean;
  }>;
}

export interface TvaInput {
  period: string; // "YYYY-MM"
  currency: CurrencyDef;
  tax_rates: readonly TaxRateRow[];
  declaration: DeclarationInput;
  achats: ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>;
  ventes: ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>;
}

type Seau = {
  tax_code: string;
  nature: string;
  rate: string;
  base: string;
  vat: string;
  ligne: string | null;
};

/**
 * Un seau par taux ET par nature. La nature d'une ligne est la sienne, ou la
 * nature par défaut du référentiel pour un extrait d'avant la nature ; une
 * nature que le serveur n'a pas pu attribuer est comptée à part (`par_defaut`).
 */
function bucketize(
  items: ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>,
  rates: readonly TaxRateRow[],
  natureParDefaut: string,
  refused: TvaV1["refused"],
  parDefaut: TvaV1["par_defaut"],
): Seau[] {
  const map = new Map<string, Seau>();
  for (const { item_id, extract } of items) {
    for (const line of extract.lines) {
      const rate = resolveTaxRate(rates, line.tax_code, extract.document_date);
      if (!rate) {
        refused.push({
          reason: `MISSING_TAX_RATE:${line.tax_code}@${extract.document_date}`,
          item_id,
        });
        continue;
      }
      const nature = line.nature ?? natureParDefaut;
      if (line.nature_attribuee === false)
        parDefaut.push({ reason: "NATURE_NON_ATTRIBUEE", item_id, tax_code: line.tax_code });
      const cle = `${line.tax_code}\u0000${nature}`;
      const cur = map.get(cle) ?? {
        tax_code: line.tax_code,
        nature,
        rate: rate.rate,
        base: "0",
        vat: "0",
        ligne: null,
      };
      cur.base = D(cur.base).plus(line.base_ht).toString();
      cur.vat = D(cur.vat).plus(line.vat_amount).toString();
      map.set(cle, cur);
    }
  }
  return Array.from(map.values());
}

/**
 * Chaque seau sur la ligne du référentiel de son sens : celle de sa nature,
 * sinon celle qui reçoit toutes les natures. Un seau dont la nature n'a pas de
 * ligne passe sur celle de la nature par défaut, et il est COMPTÉ : la somme
 * des lignes d'un sens est toujours le total de ce sens.
 */
function remplirLaDeclaration(
  declaration: DeclarationInput,
  seaux: Record<SensDeTva, Seau[]>,
  items: Record<SensDeTva, ReadonlyArray<{ item_id: string | null; extract: ExtractV1 }>>,
  parDefaut: TvaV1["par_defaut"],
  sansLigne: TvaV1["sans_ligne"],
  dec: number,
): TvaV1["declaration"] {
  const lignes = [...declaration.lignes].sort((a, b) => a.ordinal - b.ordinal);
  // L'affectation du référentiel (dossier, cabinet, pack) : jamais devinée ici.
  const ligneDe = (sens: SensDeTva, nature: string) => {
    const code = declaration.affectations.find(
      (a) => a.sens === sens && a.nature === nature,
    )?.ligne;
    return lignes.find((l) => l.code === code && l.sens === sens);
  };
  const cumul = new Map(lignes.map((l) => [l.code, { base: D(0), vat: D(0) }]));
  for (const sens of ["collectee", "deductible"] as const) {
    for (const seau of seaux[sens]) {
      let ligne = ligneDe(sens, seau.nature);
      if (!ligne) {
        // Le référentiel n'a pas de ligne pour cette nature : chaque pièce qui
        // la porte est nommée, et sa TVA rejoint la nature par défaut.
        for (const { item_id, extract } of items[sens])
          for (const l of extract.lines)
            if (
              l.tax_code === seau.tax_code &&
              (l.nature ?? declaration.nature_par_defaut) === seau.nature
            )
              parDefaut.push({
                reason: `NATURE_SANS_LIGNE:${seau.nature}`,
                item_id,
                tax_code: l.tax_code,
              });
        ligne = ligneDe(sens, declaration.nature_par_defaut);
      }
      if (!ligne) {
        // Aucune ligne pour ce sens : le référentiel est incomplet. Le seau
        // compte dans les totaux, aucune ligne ne le porte, et il est NOMMÉ à
        // part — ce n'est pas une ligne « sans taux » (revue de #145).
        sansLigne.push({
          sens,
          tax_code: seau.tax_code,
          nature: seau.nature,
          vat: toFixedStr(D(seau.vat), dec),
        });
        continue;
      }
      seau.ligne = ligne.code;
      const c = cumul.get(ligne.code)!;
      c.base = c.base.plus(seau.base);
      c.vat = c.vat.plus(seau.vat);
    }
  }
  return lignes.map((l) => ({
    code: l.code,
    label: l.label,
    sens: l.sens,
    nature: l.nature,
    base: toFixedStr(cumul.get(l.code)!.base, dec),
    vat: toFixedStr(cumul.get(l.code)!.vat, dec),
    incertain: l.incertain,
  }));
}

export function computeTva(input: TvaInput): TvaV1 {
  const refused: TvaV1["refused"] = [];
  const parDefaut: TvaV1["par_defaut"] = [];
  const sansLigne: TvaV1["sans_ligne"] = [];
  const natureParDefaut = input.declaration.nature_par_defaut;
  const collectee = bucketize(input.ventes, input.tax_rates, natureParDefaut, refused, parDefaut);
  const deductible = bucketize(input.achats, input.tax_rates, natureParDefaut, refused, parDefaut);
  const dec = input.currency.decimals;
  const totCol = sum(collectee.map((b) => b.vat));
  const totDed = sum(deductible.map((b) => b.vat));
  const solde = totCol.minus(totDed);
  const declaration = remplirLaDeclaration(
    input.declaration,
    { collectee, deductible },
    { collectee: input.ventes, deductible: input.achats },
    parDefaut,
    sansLigne,
    dec,
  );
  const arrondi = (b: Seau) => ({
    ...b,
    base: toFixedStr(D(b.base), dec),
    vat: toFixedStr(D(b.vat), dec),
  });
  return {
    contract: "tva.v1",
    period: input.period,
    currency: input.currency.code,
    collectee: collectee.map(arrondi),
    deductible: deductible.map(arrondi),
    totals: {
      collectee: toFixedStr(totCol, dec),
      deductible: toFixedStr(totDed, dec),
      solde: toFixedStr(solde, dec),
    },
    declaration,
    par_defaut: parDefaut,
    sans_ligne: sansLigne,
    refused,
  };
}
