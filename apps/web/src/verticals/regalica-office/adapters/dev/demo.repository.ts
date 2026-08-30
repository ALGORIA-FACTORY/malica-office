import type {
  CaptureRepository,
  Citation,
  Ecriture,
  Entity,
  Extraction,
  IdentityRepository,
  JurisdictionPack,
  NewOrganization,
  OfficeRepository,
  Organization,
  Piece,
  ReferentialRepository,
  RejetMotif,
  SupervisionRepository,
  Token,
} from "../../ports/repositories";

import { devPatrimoineEcritures } from "./patrimoine.demo";

type DevOrganization = Organization & { role: string };

const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000101";
const DEV_ENTITY_ID = "00000000-0000-4000-8000-000000000201";
const DEV_PACK_ID = "00000000-0000-4000-8000-000000000301";

const organizations: DevOrganization[] = [
  {
    id: DEV_TENANT_ID,
    kind: "pme",
    name: "PME Développement",
    legalId: null,
    jurisdiction: "TN",
    currency: "TND",
    validationMode: "autonome",
    role: "dev",
  },
];

const entities: Entity[] = [
  {
    id: DEV_ENTITY_ID,
    tenantId: DEV_TENANT_ID,
    code: "PRINCIPAL",
    name: "Établissement principal",
    isDefault: true,
  },
];

const pieces: Piece[] = [];
const fileUrls = new Map<string, string>();
const extractions = new Map<string, Extraction>();
const citations = new Map<string, Citation[]>();
const tokens = new Map<string, Token[]>();
const ecritures = new Map<string, Ecriture[]>();

function makeId(): string {
  return crypto.randomUUID();
}

function objectUrl(file: Blob): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function demoTokenPlan(pieceId: string): void {
  const plan: Token[] = [
    { page: 1, ordinal: 1, text: "REGALICA", x0: 0.08, y0: 0.08, x1: 0.28, y1: 0.11 },
    { page: 1, ordinal: 2, text: "DEVELOPMENT", x0: 0.3, y0: 0.08, x1: 0.58, y1: 0.11 },
  ];
  tokens.set(pieceId, plan);
  citations.set(pieceId, [
    {
      field: "issuer",
      page: 1,
      bbox: { x0: 0.08, y0: 0.08, x1: 0.58, y1: 0.11 },
      zone: "en-tête",
    },
    {
      field: "document_date",
      page: 1,
      bbox: { x0: 0.62, y0: 0.08, x1: 0.78, y1: 0.11 },
      zone: "en-tête",
    },
  ]);
}

export function createDevIdentityRepository(): IdentityRepository {
  return {
    async listMyOrganizations() {
      return organizations;
    },

    async listEntities(tenantId: string) {
      return entities.filter((entity) => entity.tenantId === tenantId);
    },

    async createOrganization(input: NewOrganization) {
      const id = makeId();
      organizations.unshift({
        id,
        kind: input.kind,
        name: input.name,
        legalId: input.legalId ?? null,
        jurisdiction: input.jurisdiction ?? "TN",
        currency: input.currency ?? "TND",
        validationMode: input.validationMode ?? "mandate",
        role: "dev",
      });
      entities.unshift({
        id: makeId(),
        tenantId: id,
        code: "PRINCIPAL",
        name: input.defaultEntityName?.trim() || input.name,
        isDefault: true,
      });
      return id;
    },
  };
}

export function createDevReferentialRepository(): ReferentialRepository {
  return {
    async activePack(jurisdiction: string): Promise<JurisdictionPack | null> {
      return {
        id: DEV_PACK_ID,
        jurisdiction,
        version: "DEV",
        effectiveFrom: "2026-01-01",
        ratified: false,
      };
    },
    async taxRates() {
      return [];
    },
    async accountMappings() {
      return [];
    },
    async fiscalCharges() {
      return [];
    },
    async socleParams(packId: string) {
      return {
        packVersionId: packId,
        moneyDecimals: 3,
        stockMethode: "cump" as const,
        stockQuantiteDecimals: 3,
        rapprochementToleranceJours: 5,
        rapprochementToleranceMontant: "1.000",
      };
    },
  };
}

export function createDevCaptureRepository(): CaptureRepository {
  return {
    async register(input) {
      const id = makeId();
      const piece: Piece = {
        id,
        tenantId: input.tenantId,
        entityId: input.entityId,
        status: "capturee",
        source: input.source,
        vis: input.vis,
        storagePath: `dev/${id}/${input.fileName}`,
        createdAt: new Date().toISOString(),
      };
      pieces.unshift(piece);
      const url = objectUrl(input.file);
      if (url) fileUrls.set(id, url);
      return id;
    },

    async list(tenantId) {
      return pieces.filter((piece) => piece.tenantId === tenantId);
    },

    async dossier(pieceId) {
      const piece = pieces.find((row) => row.id === pieceId);
      if (!piece) throw new Error("piece.not_found");
      return {
        piece,
        fileUrl: fileUrls.get(pieceId) ?? null,
        extraction: extractions.get(pieceId) ?? null,
        citations: citations.get(pieceId) ?? [],
        tokens: tokens.get(pieceId) ?? [],
      };
    },

    async read(pieceId) {
      const piece = pieces.find((row) => row.id === pieceId);
      if (!piece) throw new Error("piece.not_found");
      piece.status = "lue";
      demoTokenPlan(pieceId);
      extractions.set(pieceId, {
        id: makeId(),
        contract: "extract.v1",
        payload: {
          issuer: "Regalica Development",
          document_date: new Date().toISOString().slice(0, 10),
          document_kind: "facture_achat",
          currency: "TND",
          lines: [],
          totals: {},
        },
        flags: [{ field: "totals", code: "dev_no_binding_amount" }],
        createdAt: new Date().toISOString(),
      });
      return { contract: "extract.v1", citations: 2, valid: false };
    },
  };
}

export function createDevOfficeRepository(): OfficeRepository {
  return {
    async propose() {
      throw new Error("dev_backend_required");
    },
    async book() {
      throw new Error("dev_backend_required");
    },
    async ecrituresForPiece(pieceId) {
      return ecritures.get(pieceId) ?? [];
    },
    async ecrituresByIds(ids) {
      const all = [...devPatrimoineEcritures, ...[...ecritures.values()].flat()];
      return all.filter((e) => ids.includes(e.id));
    },
    async bookedExtracts() {
      return [];
    },
  };
}
// ------------------------------------------------------- supervision (démo)
const DEV_CABINET_ID = "00000000-0000-4000-8000-000000000102";
const DEV_CLIENT_ID = "00000000-0000-4000-8000-000000000103";

organizations.push({
  id: DEV_CABINET_ID,
  kind: "cabinet",
  name: "Cabinet Développement",
  legalId: null,
  jurisdiction: "TN",
  currency: "TND",
  validationMode: "mandate",
  role: "expert",
});

const devMotifs: RejetMotif[] = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    code: "piece_illisible",
    label: "Pièce illisible",
    severity: "bloquant",
    requiresNote: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    code: "montant_incoherent",
    label: "Montant incohérent",
    severity: "bloquant",
    requiresNote: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    code: "imputation_a_revoir",
    label: "Imputation à revoir",
    severity: "avertissement",
    requiresNote: true,
  },
];

export function createDevSupervisionRepository(): SupervisionRepository {
  return {
    async listMyCabinets() {
      return organizations.filter((org) => org.kind === "cabinet");
    },

    async listClients() {
      const counts = {
        capturee: 0,
        lue: 0,
        proposee: 0,
        comptabilisee: 0,
        supervisee: 0,
        retournee: 0,
      };
      for (const piece of pieces) counts[piece.status] += 1;
      return [
        {
          tenantId: DEV_TENANT_ID,
          name: "PME Développement",
          legalId: null,
          jurisdiction: "TN",
          currency: "TND",
          validationMode: "autonome" as const,
          engagementStatus: "actif",
          counts,
        },
        {
          tenantId: DEV_CLIENT_ID,
          name: "Atelier Medina",
          legalId: "1234567/A/M/000",
          jurisdiction: "TN",
          currency: "TND",
          validationMode: "mandate" as const,
          engagementStatus: "actif",
          counts: {
            capturee: 0,
            lue: 0,
            proposee: 0,
            comptabilisee: 0,
            supervisee: 0,
            retournee: 0,
          },
        },
      ];
    },

    async queue(_cabinetTenantId: string, tenantId?: string) {
      return pieces
        .filter((piece) => !tenantId || piece.tenantId === tenantId)
        .map((piece) => ({
          pieceId: piece.id,
          tenantId: piece.tenantId,
          clientName: "PME Développement",
          status: piece.status,
          source: piece.source,
          createdAt: piece.createdAt,
          ecritureId: (ecritures.get(piece.id) ?? [])[0]?.id ?? null,
          libelle: (ecritures.get(piece.id) ?? [])[0]?.libelle ?? null,
          dateEcriture: (ecritures.get(piece.id) ?? [])[0]?.dateEcriture ?? null,
        }));
    },

    async motifs() {
      return devMotifs;
    },

    async review() {
      throw new Error("dev_backend_required");
    },

    async auditForPiece() {
      return [];
    },
  };
}
