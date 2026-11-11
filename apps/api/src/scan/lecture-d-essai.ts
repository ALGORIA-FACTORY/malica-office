/**
 * Une lecture d'essai : un plan de jetons, des citations et une extraction
 * construits à la main, pour éprouver le jugement et la proposition SANS
 * appeler de modèle. Partagé par lecture-jugee.test.ts et proposition.test.ts.
 */

/**
 * Le jour imprimé sur la facture d'essai : dix jours avant celui où l'épreuve
 * tourne, en UTC. Relatif, et non figé : du 10 septembre au 9 novembre 2026,
 * la date « 2026-09-10 » a tenu sous le seuil `piece.ecart_date_jours` du pack
 * (60 jours) ; le 10 novembre, l'écart avec la réception l'a dépassé et le
 * contrôle `coherence_dates` a mis en réserve toute la suite. Dix jours
 * gardent la pièce avant sa réception, quel que soit le fuseau du dossier, et
 * loin du seuil.
 */
export const JOUR_D_ESSAI = jourDEssai(0);

/**
 * Un jour relatif au jour d'essai : `jourDEssai(-1)` est la veille.
 *
 * Le jour d'essai ne tombe jamais sur un bord de mois : ramené entre le 2 et le
 * 27, il a toujours sa veille et son lendemain dans le même mois. Deux épreuves
 * l'ont appris : le 11 novembre 2026, dix jours avant tombait le 1er, la pièce
 * « reçue la veille » l'était en octobre et la réserve devenait une anomalie ; et
 * du 11 au 30 novembre, la fin du mois de la facture (le 30) était dans le futur,
 * donc un règlement daté de ce jour était refusé (`paiement.date_future`).
 */
export function jourDEssai(decalageEnJours: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 10);
  d.setUTCDate(Math.min(Math.max(d.getUTCDate(), 2), 27));
  d.setUTCDate(d.getUTCDate() + decalageEnJours);
  return d.toISOString().slice(0, 10);
}

/**
 * Le mois civil qui contient le jour d'essai, décalé de `decalageEnMois`
 * (−1 : le mois précédent), comme bornes `du`/`au` incluses.
 */
export function moisDEssai(decalageEnMois = 0): { du: string; au: string } {
  const [a, m] = JOUR_D_ESSAI.split("-").map(Number) as [number, number, number];
  const premier = new Date(Date.UTC(a, m - 1 + decalageEnMois, 1));
  const dernier = new Date(Date.UTC(a, m + decalageEnMois, 0));
  return { du: premier.toISOString().slice(0, 10), au: dernier.toISOString().slice(0, 10) };
}

/** Le jour d'essai tel qu'il s'imprime sur la pièce : « JJ/MM/AAAA ». */
function jourDEssaiImprime(): string {
  const [a, m, j] = JOUR_D_ESSAI.split("-");
  return `${j}/${m}/${a}`;
}

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
    /** Le droit de timbre tel qu'imprimé (« 1,000 » par défaut). */
    timbre?: string;
    numero?: string;
    /** Le solveur de la lecture s'est trompé : l'extraction porte des montants faux, les jetons imprimés restent justes. */
    solveurFaux?: boolean;
    /** La date n'a pas été lue. */
    sansDate?: boolean;
    /** La confiance globale de la désignation (0,9 par défaut). */
    confianceGlobale?: number;
    /**
     * Les jetons que la citation de la LIGNE couvre, quand ce ne sont pas ceux
     * du HT du pied — deux colonnes d'une même ligne, par exemple.
     */
    ligne?: string[];
    /** Les lignes suivantes d'une facture à plusieurs taux : les jetons de la base de chacune. */
    autresLignes?: string[][];
    /**
     * Des jetons imprimés sur la même ligne, juste AVANT ceux que la citation
     * de la ligne couvre, et qu'elle ne cite pas — « (base », par exemple.
     */
    avantLaLigne?: string[];
    /** Le FODEC tel qu'imprimé (« 12,346 »), en dernier jeton : le second droit de la pièce. */
    fodec?: string;
  } = {},
) {
  const numero = opts.numero ?? "F-2026-0042";
  const textes: Array<[string, number]> = [
    [opts.titre ?? "FACTURE", 0.05], // 0
    ["FOURNISSEUR", 0.12], // 1
    ["SA", 0.12], // 2
    ["1234567B/B/M/000", 0.15], // 3
    [numero, 0.18], // 4
    [jourDEssaiImprime(), 0.2], // 5
    [opts.clientMf ?? "1856324K/A/M/000", 0.25], // 6
    [opts.ht?.[0] ?? "1", 0.7], // 7 ─┐ « 1 234,560 », coupé en deux jetons
    [opts.ht?.[1] ?? "234,560", 0.7], // 8 ─┘
    [opts.tva ?? "234,566", 0.74], // 9
    [opts.timbre ?? "1,000", 0.78], // 10
    [opts.ttc?.[0] ?? "1", 0.82], // 11 ─┐ « 1 470,126 »
    [opts.ttc?.[1] ?? "470,126", 0.82], // 12 ─┘
    ...(opts.avantLaLigne ?? []).map((t): [string, number] => [t, 0.5]), // 13… avant la ligne, non cités
    ...(opts.ligne ?? []).map((t): [string, number] => [t, 0.5]), // puis la ligne, si elle est à part
    ...(opts.autresLignes ?? []).flat().map((t): [string, number] => [t, 0.55]), // puis les suivantes
    ...(opts.fodec ? [[opts.fodec, 0.8] as [string, number]] : []), // puis le FODEC
  ];
  const avant = (opts.avantLaLigne ?? []).length;
  const ordinauxDeLaLigne = (opts.ligne ?? []).map((_, i) => 13 + avant + i);
  let suivant = 13 + avant + ordinauxDeLaLigne.length;
  const ordinauxDesAutres = (opts.autresLignes ?? []).map((l) => l.map(() => suivant++));
  const ordinalDuFodec = suivant;
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
    ...(ordinauxDeLaLigne.length > 0
      ? cite("lines[0].base_ht", ...ordinauxDeLaLigne)
      : cite("lines[0].base_ht", 7, 8)),
    ...ordinauxDesAutres.flatMap((o, i) => cite(`lines[${i + 1}].base_ht`, ...o)),
    ...cite("totals.base_ht", 7, 8),
    ...cite("lines[0].vat_amount", 9),
    ...cite("totals.vat", 9),
    ...cite("other_charges[0].amount", 10),
    ...cite("totals.ttc", 11, 12),
    ...(opts.fodec ? cite("other_charges[1].amount", ordinalDuFodec) : []),
  ];
  const extract = {
    contract: "extract.v1",
    issuer: "FOURNISSEUR SA",
    document_date: opts.sansDate ? null : JOUR_D_ESSAI,
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
    other_charges: [
      { code: "DROIT_TIMBRE", label: "", amount: "1.000" },
      ...(opts.fodec ? [{ code: "FODEC", label: "", amount: opts.fodec.replace(",", ".") }] : []),
    ],
    totals: opts.solveurFaux
      ? { base_ht: "8888.888", vat: "234.566", ttc: "9999.999" }
      : { base_ht: "1234.560", vat: "234.566", ttc: "1470.126" },
    references: {
      numero,
      matricule_fiscal: "1234567B/B/M/000",
      matricule_fiscal_client: opts.clientMf ?? "1856324K/A/M/000",
    },
    field_confidence: { overall: opts.confianceGlobale ?? 0.9 },
    document_kind: "facture_achat",
  };
  return { tokens, citations, extract };
}
