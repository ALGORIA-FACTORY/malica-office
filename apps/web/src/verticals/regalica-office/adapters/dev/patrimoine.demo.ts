/**
 * Adaptateurs de démonstration (mode dev uniquement) pour les immobilisations,
 * les stocks et la banque. Aucune valeur ici n'est fiscale : ce sont des
 * données de démonstration, le référentiel reste au pack.
 */
import type {
  Asset,
  Ecriture,
  BankAccount,
  BankStatementLine,
  BanqueRepository,
  Cession,
  Depreciation,
  Dotation,
  ImmoCategory,
  ImmoRepository,
  AuditEntry,
  LettrageEtat,
  LettrageRow,
  StockCategory,
  StockDepreciationRow,
  StockInventaireRow,
  StockItem,
  StockMouvementRow,
  StocksRepository,
} from "../../ports/repositories";

const TENANT = "00000000-0000-4000-8000-000000000101";
const PACK = "00000000-0000-4000-8000-000000000301";

function makeId(): string {
  return `dev-${Math.random().toString(36).slice(2, 10)}`;
}

const devCategories: ImmoCategory[] = [
  {
    id: "cat-informatique",
    code: "informatique",
    label: "Matériel informatique",
    method: "degressif",
    dureeAnnees: 3,
    coefficient: "1.5000",
    accountImmo: "2282",
    accountAmort: "2882",
    accountDotation: "6811",
    legalReference: "Démonstration",
  },
  {
    id: "cat-mobilier",
    code: "mobilier",
    label: "Mobilier de bureau",
    method: "lineaire",
    dureeAnnees: 10,
    coefficient: "1.0000",
    accountImmo: "2284",
    accountAmort: "2884",
    accountDotation: "6811",
    legalReference: "Démonstration",
  },
];

const assets: Asset[] = [
  {
    id: "asset-1",
    tenantId: TENANT,
    categoryId: "cat-informatique",
    label: "Poste de travail atelier",
    miseEnService: "2026-04-01",
    valeurBrute: "4800.000",
    valeurResiduelle: "0.000",
    method: "degressif",
    dureeAnnees: 3,
    coefficient: "1.5000",
    devise: "TND",
    status: "en_service",
    pieceId: null,
    createdAt: "2026-04-02T09:00:00Z",
  },
  {
    id: "asset-2",
    tenantId: TENANT,
    categoryId: "cat-mobilier",
    label: "Comptoir d'accueil",
    miseEnService: "2026-01-15",
    valeurBrute: "3200.000",
    valeurResiduelle: "200.000",
    method: "lineaire",
    dureeAnnees: 10,
    coefficient: "1.0000",
    devise: "TND",
    status: "en_service",
    pieceId: null,
    createdAt: "2026-01-16T09:00:00Z",
  },
];

/** Écritures produites par les gestes patrimoine en mode démonstration. */
export const devPatrimoineEcritures: Ecriture[] = [];

function pushDemoEcriture(input: {
  libelle: string;
  date: string;
  devise: string;
  lines: Array<{ accountCode: string; libelle: string; debit: string; credit: string }>;
}): string {
  const id = makeId();
  devPatrimoineEcritures.unshift({
    id,
    pieceId: null,
    journal: "OD",
    dateEcriture: input.date,
    devise: input.devise,
    libelle: input.libelle,
    status: "booked",
    lines: input.lines.map((l, i) => ({
      ordinal: i + 1,
      accountCode: l.accountCode,
      libelle: l.libelle,
      debit: l.debit,
      credit: l.credit,
      taxCode: null,
    })),
  });
  return id;
}

const dotations: Dotation[] = [];
const depreciations: Depreciation[] = [];
const cessions: Cession[] = [];

export function createDevImmoRepository(): ImmoRepository {
  return {
    async categories() {
      return devCategories;
    },
    async listAssets(tenantId) {
      return assets.filter((a) => a.tenantId === tenantId || tenantId === TENANT);
    },
    async createAsset(input) {
      const id = makeId();
      assets.unshift({
        id,
        tenantId: input.tenantId,
        categoryId: input.categoryId,
        label: input.label,
        miseEnService: input.miseEnService,
        valeurBrute: input.valeurBrute,
        valeurResiduelle: input.valeurResiduelle,
        method: input.method,
        dureeAnnees: input.dureeAnnees,
        coefficient: input.coefficient,
        devise: input.devise,
        status: "en_service",
        pieceId: input.pieceId ?? null,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async dotations(_tenantId, assetId) {
      return dotations.filter((d) => !assetId || d.assetId === assetId);
    },
    async recordDotation(input) {
      const id = makeId();
      dotations.push({
        id,
        assetId: input.assetId,
        exercice: input.exercice,
        months: input.months,
        dotation: input.dotation,
        cumul: input.cumul,
        vnc: input.vnc,
        ecritureId: input.ecritureId ?? null,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async updateAsset(input) {
      const a = assets.find((row) => row.id === input.id);
      if (!a) throw new Error("asset.not_found");
      Object.assign(a, {
        label: input.label,
        miseEnService: input.miseEnService,
        valeurBrute: input.valeurBrute,
        valeurResiduelle: input.valeurResiduelle,
        method: input.method,
        dureeAnnees: input.dureeAnnees,
        coefficient: input.coefficient,
        status: input.status,
      });
    },

    async constaterDotation(input) {
      const asset = assets.find((a) => a.id === input.assetId);
      const cat = devCategories.find((c) => c.id === asset?.categoryId);
      if (!asset || !cat) throw new Error("asset.not_found");
      const ecritureId = pushDemoEcriture({
        libelle: `Dotation aux amortissements ${input.exercice} — ${asset.label}`,
        date: input.date ?? `${input.exercice}-12-31`,
        devise: asset.devise,
        lines: [
          {
            accountCode: cat.accountDotation,
            libelle: `Dotation — ${asset.label}`,
            debit: input.dotation,
            credit: "0.000",
          },
          {
            accountCode: cat.accountAmort,
            libelle: `Amortissements — ${asset.label}`,
            debit: "0.000",
            credit: input.dotation,
          },
        ],
      });
      const id = makeId();
      dotations.push({
        id,
        assetId: input.assetId,
        exercice: input.exercice,
        months: input.months,
        dotation: input.dotation,
        cumul: input.cumul,
        vnc: input.vnc,
        ecritureId,
        createdAt: new Date().toISOString(),
      });
      return { dotationId: id, ecritureId };
    },

    async constaterDepreciation(input) {
      const asset = assets.find((a) => a.id === input.assetId);
      const cat = devCategories.find((c) => c.id === asset?.categoryId);
      if (!asset || !cat) throw new Error("asset.not_found");
      const perte = Number(input.mouvement) > 0;
      const abs = Math.abs(Number(input.mouvement)).toFixed(3);
      const accountDeprec = `29${cat.accountImmo.slice(1)}`;
      const ecritureId = pushDemoEcriture({
        libelle: `${perte ? "Dépréciation" : "Reprise de dépréciation"} — ${asset.label}`,
        date: input.at,
        devise: asset.devise,
        lines: perte
          ? [
              {
                accountCode: "6817",
                libelle: `Dotation dépréciation — ${asset.label}`,
                debit: abs,
                credit: "0.000",
              },
              {
                accountCode: accountDeprec,
                libelle: `Dépréciation — ${asset.label}`,
                debit: "0.000",
                credit: abs,
              },
            ]
          : [
              {
                accountCode: accountDeprec,
                libelle: `Dépréciation — ${asset.label}`,
                debit: abs,
                credit: "0.000",
              },
              {
                accountCode: "7817",
                libelle: `Reprise dépréciation — ${asset.label}`,
                debit: "0.000",
                credit: abs,
              },
            ],
      });
      const id = makeId();
      depreciations.push({
        id,
        assetId: input.assetId,
        at: input.at,
        vnc: input.vnc,
        valeurRecouvrable: input.valeurRecouvrable,
        mouvement: input.mouvement,
        cumul: input.cumul,
        note: input.note ?? null,
        ecritureId,
        createdAt: new Date().toISOString(),
      });
      return { depreciationId: id, ecritureId };
    },

    async depreciations(_tenantId, assetId) {
      return depreciations.filter((d) => !assetId || d.assetId === assetId);
    },
    async recordDepreciation(input) {
      const id = makeId();
      depreciations.push({
        id,
        assetId: input.assetId,
        at: input.at,
        vnc: input.vnc,
        valeurRecouvrable: input.valeurRecouvrable,
        mouvement: input.mouvement,
        cumul: input.cumul,
        note: input.note ?? null,
        ecritureId: null,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async cessions() {
      return cessions;
    },
    async recordCession(input) {
      const id = makeId();
      cessions.unshift({
        id,
        assetId: input.assetId,
        at: input.at,
        prix: input.prix,
        vnc: input.vnc,
        resultat: input.resultat,
        createdAt: new Date().toISOString(),
      });
      const asset = assets.find((a) => a.id === input.assetId);
      if (asset) asset.status = "cede";
      return id;
    },
  };
}

const items: StockItem[] = [
  {
    id: "item-1",
    tenantId: TENANT,
    categoryId: "stock-cat-1",
    reference: "CAF-001",
    designation: "Café en grains 1 kg",
    unite: "kg",
    methode: "cump",
    accountStock: "3211",
    accountVariation: "6031",
    devise: "TND",
    active: true,
  },
  {
    id: "item-2",
    tenantId: TENANT,
    categoryId: "stock-cat-2",
    reference: "EMB-014",
    designation: "Emballage carton",
    unite: "u",
    methode: "cump",
    accountStock: "3212",
    accountVariation: "6032",
    devise: "TND",
    active: true,
  },
];

const mouvements: StockMouvementRow[] = [
  {
    id: "mv-1",
    itemId: "item-1",
    sens: "entree",
    at: "2026-02-03",
    quantite: "40.000",
    coutUnitaire: "18.500",
    reference: "BL-2026-014",
    pieceId: null,
  },
  {
    id: "mv-2",
    itemId: "item-1",
    sens: "entree",
    at: "2026-02-17",
    quantite: "25.000",
    coutUnitaire: "19.200",
    reference: "BL-2026-031",
    pieceId: null,
  },
  {
    id: "mv-3",
    itemId: "item-1",
    sens: "sortie",
    at: "2026-02-25",
    quantite: "30.000",
    coutUnitaire: null,
    reference: "BS-2026-008",
    pieceId: null,
  },
];

const stockCategories: StockCategory[] = [
  {
    id: "stock-cat-1",
    code: "marchandises",
    label: "Marchandises",
    accountStock: "37",
    accountVariation: "6037",
    accountProvision: "397",
    accountProvisionDotation: "6817",
    accountProvisionReprise: "7817",
    legalReference: "NCT 4 — Stocks",
  },
  {
    id: "stock-cat-2",
    code: "matieres_premieres",
    label: "Matieres premieres",
    accountStock: "31",
    accountVariation: "6031",
    accountProvision: "391",
    accountProvisionDotation: "6817",
    accountProvisionReprise: "7817",
    legalReference: "NCT 4 — Stocks",
  },
];

const inventaires: StockInventaireRow[] = [];
const stockDepreciations: StockDepreciationRow[] = [];

export function createDevStocksRepository(): StocksRepository {
  return {
    async categories() {
      return stockCategories;
    },
    async listItems() {
      return items;
    },
    async createItem(input) {
      const id = makeId();
      items.push({
        id,
        tenantId: input.tenantId,
        categoryId: input.categoryId,
        reference: input.reference,
        designation: input.designation,
        unite: input.unite,
        methode: input.methode,
        accountStock: input.accountStock,
        accountVariation: input.accountVariation,
        devise: input.devise,
        active: true,
      });
      return id;
    },
    async updateItem(input) {
      const item = items.find((i) => i.id === input.id);
      if (!item) return;
      item.designation = input.designation;
      item.unite = input.unite;
      item.methode = input.methode;
      item.active = input.active;
    },
    async mouvements(_tenantId, itemId) {
      return mouvements.filter((m) => !itemId || m.itemId === itemId);
    },
    async addMouvement(input) {
      const doublon = mouvements.some(
        (m) =>
          m.itemId === input.itemId &&
          m.at === input.at &&
          m.sens === input.sens &&
          m.quantite === input.quantite &&
          (m.reference ?? "") === (input.reference ?? ""),
      );
      if (doublon) throw new Error("stocks_mouvements_uniq");
      const id = makeId();
      mouvements.push({
        id,
        itemId: input.itemId,
        sens: input.sens,
        at: input.at,
        quantite: input.quantite,
        coutUnitaire: input.coutUnitaire ?? null,
        reference: input.reference ?? null,
        pieceId: input.pieceId ?? null,
      });
      return id;
    },
    async inventaires(_tenantId, itemId) {
      return inventaires.filter((i) => !itemId || i.itemId === itemId);
    },
    async constaterInventaire(input) {
      if (inventaires.some((i) => i.itemId === input.itemId && i.period === input.period)) {
        throw new Error("stocks_inventaires_uniq");
      }
      const id = makeId();
      const ecritureId = makeId();
      inventaires.push({
        id,
        itemId: input.itemId,
        period: input.period,
        initial: input.initial,
        final: input.final,
        variation: input.variation,
        ecritureId,
        createdAt: new Date().toISOString(),
      });
      return { inventaireId: id, ecritureId };
    },
    async depreciations(_tenantId, itemId) {
      return stockDepreciations.filter((d) => !itemId || d.itemId === itemId);
    },
    async constaterDepreciation(input) {
      if (stockDepreciations.some((d) => d.itemId === input.itemId && d.at === input.at)) {
        throw new Error("stocks_depreciations_uniq");
      }
      const id = makeId();
      const ecritureId = makeId();
      stockDepreciations.push({
        id,
        itemId: input.itemId,
        at: input.at,
        valeurStock: input.valeurStock,
        valeurNette: input.valeurNette,
        mouvement: input.mouvement,
        cumul: input.cumul,
        note: input.note ?? null,
        ecritureId,
        createdAt: new Date().toISOString(),
      });
      return { depreciationId: id, ecritureId };
    },
    async recordInventaire() {
      return makeId();
    },
  };
}

const comptes: BankAccount[] = [
  {
    id: "bank-1",
    tenantId: TENANT,
    label: "Compte courant BIAT",
    iban: "TN59 1000 6035 0000 1234 5678",
    devise: "TND",
    accountCode: "5321",
    active: true,
  },
];

const lignes: BankStatementLine[] = [
  {
    id: "bl-1",
    compteId: "bank-1",
    at: "2026-02-03",
    label: "VIR STEG FACTURE FEV",
    montant: "-236.000",
    reference: "F2026-014",
    status: "ouverte",
  },
  {
    id: "bl-2",
    compteId: "bank-1",
    at: "2026-02-10",
    label: "REMISE CHEQUE NOUR",
    montant: "1180.000",
    reference: null,
    status: "ouverte",
  },
  {
    id: "bl-3",
    compteId: "bank-1",
    at: "2026-02-28",
    label: "FRAIS DE TENUE DE COMPTE",
    montant: "-12.500",
    reference: null,
    status: "ouverte",
  },
];

const lettrages: LettrageRow[] = [];
const etats: LettrageEtat[] = [];
const banqueAudit: AuditEntry[] = [];

export function createDevBanqueRepository(): BanqueRepository {
  return {
    async listAccounts() {
      return comptes;
    },
    async createAccount(input) {
      const id = makeId();
      comptes.push({
        id,
        tenantId: input.tenantId,
        label: input.label,
        iban: input.iban ?? null,
        devise: input.devise,
        accountCode: input.accountCode,
        active: true,
      });
      return id;
    },
    async lines(_tenantId, compteId) {
      return lignes.filter((l) => l.compteId === compteId);
    },
    async importLines(input) {
      let added = 0;
      for (const l of input.lines) {
        if (lignes.some((x) => x.id === `imp-${l.idempotencyKey}`)) continue;
        lignes.push({
          id: `imp-${l.idempotencyKey}`,
          compteId: input.compteId,
          at: l.at,
          label: l.label,
          montant: l.montant,
          reference: l.reference,
          status: "ouverte",
        });
        added += 1;
      }
      return added;
    },
    async bookLines() {
      return [
        {
          id: "ec-1",
          pieceId: "pc-1",
          at: "2026-02-03",
          journal: "BQ",
          label: "STEG février",
          montant: "-236.000",
          reference: "F2026-014",
          lettree: etats.some((e) => e.ecritureId === "ec-1" && e.active),
        },
        {
          id: "ec-2",
          pieceId: null,
          at: "2026-02-11",
          journal: "BQ",
          label: "Nour Distribution",
          montant: "1180.000",
          reference: null,
          lettree: etats.some((e) => e.ecritureId === "ec-2" && e.active),
        },
      ];
    },
    async etat() {
      return etats;
    },
    async lettrages() {
      return lettrages;
    },
    async lettrer(input) {
      if (etats.some((e) => e.ligneId === input.ligneId && e.active)) {
        throw new Error("ligne deja lettree");
      }
      if (etats.some((e) => e.ecritureId === input.ecritureId && e.active)) {
        throw new Error("ecriture deja lettree a une autre ligne");
      }
      const id = makeId();
      const seq =
        lettrages.filter((l) => l.ligneId === input.ligneId && l.ecritureId === input.ecritureId)
          .length + 1;
      lettrages.unshift({
        id,
        ligneId: input.ligneId,
        ecritureId: input.ecritureId,
        action: "lettre",
        seq,
        score: input.score,
        ecartMontant: input.ecartMontant,
        ecartJours: input.ecartJours,
        referenceExacte: input.referenceExacte,
        motifId: null,
        note: null,
        createdAt: new Date().toISOString(),
      });
      const existing = etats.find((e) => e.ligneId === input.ligneId);
      const etat: LettrageEtat = {
        ligneId: input.ligneId,
        ecritureId: input.ecritureId,
        active: true,
        score: input.score,
        ecartMontant: input.ecartMontant,
        ecartJours: input.ecartJours,
        referenceExacte: input.referenceExacte,
        updatedAt: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, etat);
      else etats.push(etat);
      const ligne = lignes.find((l) => l.id === input.ligneId);
      if (ligne) ligne.status = "rapprochee";
      banqueAudit.unshift({
        id: makeId(),
        action: "banque.lettre",
        actor: null,
        at: new Date().toISOString(),
        motifId: null,
        payload: { ligne_id: input.ligneId, ecriture_id: input.ecritureId, score: input.score },
      });
      return id;
    },
    async delettrer(input) {
      const etat = etats.find((e) => e.ligneId === input.ligneId && e.active);
      if (!etat) throw new Error("aucun lettrage actif sur cette ligne");
      const id = makeId();
      const seq =
        lettrages.filter((l) => l.ligneId === input.ligneId && l.ecritureId === etat.ecritureId)
          .length + 1;
      lettrages.unshift({
        id,
        ligneId: input.ligneId,
        ecritureId: etat.ecritureId,
        action: "delettre",
        seq,
        score: 0,
        ecartMontant: "0.000",
        ecartJours: 0,
        referenceExacte: false,
        motifId: input.motifId,
        note: input.note ?? null,
        createdAt: new Date().toISOString(),
      });
      etat.active = false;
      etat.updatedAt = new Date().toISOString();
      const ligne = lignes.find((l) => l.id === input.ligneId);
      if (ligne) ligne.status = "ouverte";
      banqueAudit.unshift({
        id: makeId(),
        action: "banque.delettre",
        actor: null,
        at: new Date().toISOString(),
        motifId: input.motifId,
        payload: {
          ligne_id: input.ligneId,
          ecriture_id: etat.ecritureId,
          note: input.note ?? null,
        },
      });
      return id;
    },
    async audit() {
      return banqueAudit;
    },
    async setLineStatus(ligneId, status) {
      const ligne = lignes.find((l) => l.id === ligneId);
      if (ligne) ligne.status = status;
    },
  };
}

export const DEV_PATRIMOINE_PACK = PACK;
