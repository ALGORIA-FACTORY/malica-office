import type {
  Assignment,
  CabinetMember,
  ClientStats,
  CollabRepository,
  Echeance,
  Notification,
  PvReunion,
} from "../../ports/repositories";

const TENANT = "00000000-0000-4000-8000-000000000101";
const CABINET = "00000000-0000-4000-8000-000000000102";

const members: CabinetMember[] = [
  { tenantId: CABINET, userId: "u-1", role: "expert", email: "expert@cabinet.tn" },
  { tenantId: CABINET, userId: "u-2", role: "collaborateur", email: "amine@cabinet.tn" },
  { tenantId: CABINET, userId: "u-3", role: "collaborateur", email: "salma@cabinet.tn" },
];

const assignments: Assignment[] = [
  {
    id: "a-1",
    cabinetTenantId: CABINET,
    clientTenantId: TENANT,
    collaboratorId: "u-2",
    briefing: "Dossier mensuel, TVA au 28. Vigilance sur les notes de restaurant.",
    active: true,
    seq: 1,
    createdAt: new Date(Date.now() - 86_400_000 * 12).toISOString(),
  },
];

const pv: PvReunion[] = [
  {
    id: "pv-1",
    clientTenantId: TENANT,
    at: new Date(Date.now() - 86_400_000 * 5).toISOString().slice(0, 10),
    titre: "Point mensuel — clôture novembre",
    participants: "Dirigeant PME, expert-comptable, collaborateur",
    ordreDuJour: "TVA novembre, échéances CNSS, préparation liasse.",
    decisions: "Dépôt TVA le 28. Relance des pièces manquantes fournisseurs.",
    createdAt: new Date(Date.now() - 86_400_000 * 5).toISOString(),
  },
];

const notifications: Notification[] = [
  {
    id: "n-1",
    tenantId: TENANT,
    kind: "piece.retournee",
    payload: { piece_id: "p-1", note: "Mention légale manquante" },
    readAt: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: "n-2",
    tenantId: TENANT,
    kind: "piece.validee",
    payload: { piece_id: "p-2" },
    readAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

const echeances: Echeance[] = [
  {
    id: "e-1",
    tenantId: TENANT,
    kind: "tva",
    label: "Déclaration TVA",
    period: new Date().toISOString().slice(0, 7),
    dueDate: new Date(Date.now() + 86_400_000 * 6).toISOString().slice(0, 10),
    status: "a_venir",
  },
  {
    id: "e-2",
    tenantId: TENANT,
    kind: "cnss",
    label: "Déclaration CNSS trimestrielle",
    period: null,
    dueDate: new Date(Date.now() + 86_400_000 * 21).toISOString().slice(0, 10),
    status: "a_venir",
  },
];

export function createDevCollabRepository(): CollabRepository {
  return {
    async members() {
      return members;
    },
    async assignments() {
      return [...assignments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async assign(input) {
      for (const a of assignments) {
        if (a.clientTenantId === input.clientTenantId) a.active = false;
      }
      const id = `a-${assignments.length + 1}`;
      assignments.push({
        id,
        cabinetTenantId: input.cabinetTenantId,
        clientTenantId: input.clientTenantId,
        collaboratorId: input.collaboratorId,
        briefing: input.briefing ?? null,
        active: true,
        seq: assignments.length + 1,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async pvList() {
      return [...pv];
    },
    async addPv(input) {
      const id = `pv-${pv.length + 1}`;
      pv.unshift({
        id,
        clientTenantId: input.clientTenantId ?? null,
        at: input.at,
        titre: input.titre,
        participants: input.participants ?? null,
        ordreDuJour: input.ordreDuJour ?? null,
        decisions: input.decisions ?? null,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async stats(tenantIds) {
      return tenantIds.map((tenantId): ClientStats => ({
        tenantId,
        pieces: 24,
        capturees: 2,
        lues: 3,
        proposees: 4,
        comptabilisees: 9,
        supervisees: 5,
        retournees: 1,
        heuresMoyennes: 18.4,
        dernierePiece: new Date().toISOString(),
      }));
    },
    async notifications() {
      return [...notifications];
    },
    async markRead(id) {
      const found = notifications.find((n) => n.id === id);
      if (found) found.readAt = new Date().toISOString();
    },
    async echeances() {
      return [...echeances];
    },
    async setPieceVis() {
      return true;
    },
  };
}
