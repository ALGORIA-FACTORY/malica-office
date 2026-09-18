/**
 * Une lecture d'essai : un plan de jetons, des citations et une extraction
 * construits à la main, pour éprouver le jugement et la proposition SANS
 * appeler de modèle. Partagé par lecture-jugee.test.ts et proposition.test.ts.
 */

type Jeton = {
  page: number;
  ordinal: number;
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
};

/** Une facture d'achat adressée au tenant, lue jeton par jeton. */
export function lecture(
  opts: {
    titre?: string;
    clientMf?: string;
    ht?: [string, string];
    tva?: string;
    ttc?: [string, string];
    numero?: string;
    /** Le solveur de la lecture s'est trompé : l'extraction porte des montants faux, les jetons imprimés restent justes. */
    solveurFaux?: boolean;
    /** La date n'a pas été lue. */
    sansDate?: boolean;
    /** La confiance globale de la désignation (0,9 par défaut). */
    confianceGlobale?: number;
  } = {},
) {
  const numero = opts.numero ?? "F-2026-0042";
  const textes: Array<[string, number]> = [
    [opts.titre ?? "FACTURE", 0.05], // 0
    ["FOURNISSEUR", 0.12], // 1
    ["SA", 0.12], // 2
    ["1234567/B/M/000", 0.15], // 3
    [numero, 0.18], // 4
    ["10/09/2026", 0.2], // 5
    [opts.clientMf ?? "1856324/A/M/000", 0.25], // 6
    [opts.ht?.[0] ?? "1", 0.7], // 7 ─┐ « 1 234,560 », coupé en deux jetons
    [opts.ht?.[1] ?? "234,560", 0.7], // 8 ─┘
    [opts.tva ?? "234,566", 0.74], // 9
    ["1,000", 0.78], // 10
    [opts.ttc?.[0] ?? "1", 0.82], // 11 ─┐ « 1 470,126 »
    [opts.ttc?.[1] ?? "470,126", 0.82], // 12 ─┘
  ];
  const tokens: Jeton[] = textes.map(([text, y], ordinal) => ({
    page: 1,
    ordinal,
    text,
    x0: 0.1 + (ordinal % 3) * 0.2,
    y0: y,
    x1: 0.25 + (ordinal % 3) * 0.2,
    y1: y + 0.02,
    confidence: 0.95,
  }));
  const cite = (field: string, ...ordinaux: number[]) =>
    ordinaux.map((ordinal) => ({ field, page: 1, ordinal, zone: "totaux" }));
  const citations = [
    ...cite("issuer", 1, 2),
    ...cite("references.matricule_fiscal", 3),
    ...cite("references.numero", 4),
    ...(opts.sansDate ? [] : cite("document_date", 5)),
    ...cite("references.matricule_fiscal_client", 6),
    ...cite("lines[0].base_ht", 7, 8),
    ...cite("totals.base_ht", 7, 8),
    ...cite("lines[0].vat_amount", 9),
    ...cite("totals.vat", 9),
    ...cite("other_charges[0].amount", 10),
    ...cite("totals.ttc", 11, 12),
  ];
  const extract = {
    contract: "extract.v1",
    issuer: "FOURNISSEUR SA",
    document_date: opts.sansDate ? null : "2026-09-10",
    currency: "TND",
    lines: [
      {
        label: "Achats",
        tax_code: "TVA19",
        base_ht: opts.solveurFaux ? "8888.888" : "1234.560",
        vat_amount: "234.566",
        ttc: opts.solveurFaux ? "9999.999" : "1469.126",
      },
    ],
    articles: [],
    other_charges: [{ code: "DROIT_TIMBRE", label: "", amount: "1.000" }],
    totals: opts.solveurFaux
      ? { base_ht: "8888.888", vat: "234.566", ttc: "9999.999" }
      : { base_ht: "1234.560", vat: "234.566", ttc: "1470.126" },
    references: {
      numero,
      matricule_fiscal: "1234567/B/M/000",
      matricule_fiscal_client: opts.clientMf ?? "1856324/A/M/000",
    },
    field_confidence: { overall: opts.confianceGlobale ?? 0.9 },
    document_kind: "facture_achat",
  };
  return { tokens, citations, extract };
}
