import { supabase } from "@/integrations/supabase/client";

import type {
  AuditEntry,
  ClientSummary,
  Organization,
  OrgKind,
  PieceStatus,
  QueueItem,
  RejetMotif,
  SupervisionRepository,
  ValidationMode,
} from "../../ports/repositories";

const EMPTY_COUNTS: Record<PieceStatus, number> = {
  capturee: 0,
  lue: 0,
  proposee: 0,
  comptabilisee: 0,
  supervisee: 0,
  retournee: 0,
};

const PRIORITY: Record<PieceStatus, number> = {
  comptabilisee: 0,
  retournee: 1,
  proposee: 2,
  lue: 3,
  capturee: 4,
  supervisee: 5,
};

/**
 * Seul endroit du vertical qui connaît les vues de supervision (migrations
 * 005/007/008). Le mur de visibilité (R6) reste tenu par RLS : le cabinet ne
 * reçoit jamais une ligne de l'espace personnel, même sans filtre ici.
 */
export function createSupabaseSupervisionRepository(): SupervisionRepository {
  async function clientOrgs(cabinetTenantId: string) {
    const { data: engagements, error } = await supabase
      .from("engagements_v")
      .select("pme_org_id, cabinet_org_id, status")
      .eq("cabinet_org_id", cabinetTenantId);
    if (error) throw error;

    const rows = engagements ?? [];
    const ids = rows.map((r) => r.pme_org_id as string);
    if (ids.length === 0) return { rows, orgs: [] as Array<Record<string, unknown>> };

    const { data: orgs, error: oErr } = await supabase
      .from("organizations_v")
      .select("id, name, legal_id, jurisdiction, currency, validation_mode")
      .in("id", ids);
    if (oErr) throw oErr;
    return { rows, orgs: (orgs ?? []) as Array<Record<string, unknown>> };
  }

  return {
    async listMyCabinets(): Promise<Organization[]> {
      const { data: session } = await supabase.auth.getUser();
      const uid = session.user?.id;
      if (!uid) return [];

      const { data: mships, error: mErr } = await supabase
        .from("memberships_v")
        .select("tenant_id")
        .eq("user_id", uid);
      if (mErr) throw mErr;
      const ids = (mships ?? []).map((m) => m.tenant_id as string);
      if (ids.length === 0) return [];

      const { data, error } = await supabase
        .from("organizations_v")
        .select("id, kind, name, legal_id, jurisdiction, currency, validation_mode")
        .in("id", ids)
        .eq("kind", "cabinet");
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id as string,
        kind: o.kind as OrgKind,
        name: o.name as string,
        legalId: (o.legal_id as string | null) ?? null,
        jurisdiction: o.jurisdiction as string,
        currency: o.currency as string,
        validationMode: o.validation_mode as ValidationMode,
      }));
    },

    async listClients(cabinetTenantId: string): Promise<ClientSummary[]> {
      const { rows, orgs } = await clientOrgs(cabinetTenantId);
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.pme_org_id as string);
      const { data: pieces, error: pErr } = await supabase
        .from("pieces_v")
        .select("tenant_id, status")
        .in("tenant_id", ids);
      if (pErr) throw pErr;

      const counts = new Map<string, Record<PieceStatus, number>>();
      for (const p of pieces ?? []) {
        const key = p.tenant_id as string;
        const bucket = counts.get(key) ?? { ...EMPTY_COUNTS };
        const status = p.status as PieceStatus;
        bucket[status] = (bucket[status] ?? 0) + 1;
        counts.set(key, bucket);
      }

      const byId = new Map(orgs.map((o) => [o["id"] as string, o]));
      return rows
        .map((r) => {
          const org = byId.get(r.pme_org_id as string);
          return {
            tenantId: r.pme_org_id as string,
            name: (org?.["name"] as string) ?? "—",
            legalId: (org?.["legal_id"] as string | null) ?? null,
            jurisdiction: (org?.["jurisdiction"] as string) ?? "TN",
            currency: (org?.["currency"] as string) ?? "TND",
            validationMode: (org?.["validation_mode"] as ValidationMode) ?? "mandate",
            engagementStatus: r.status as string,
            counts: counts.get(r.pme_org_id as string) ?? { ...EMPTY_COUNTS },
          } satisfies ClientSummary;
        })
        .sort((a, b) => b.counts.comptabilisee - a.counts.comptabilisee);
    },

    async queue(cabinetTenantId: string, tenantId?: string): Promise<QueueItem[]> {
      const { rows, orgs } = await clientOrgs(cabinetTenantId);
      const allowed = rows.map((r) => r.pme_org_id as string);
      const targets = tenantId ? allowed.filter((id) => id === tenantId) : allowed;
      if (targets.length === 0) return [];

      const { data: pieces, error } = await supabase
        .from("pieces_v")
        .select("id, tenant_id, status, source, created_at")
        .in("tenant_id", targets)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const pieceIds = (pieces ?? []).map((p) => p.id as string);
      const ecrByPiece = new Map<string, { id: string; libelle: string; date: string }>();
      if (pieceIds.length > 0) {
        const { data: ecrs, error: eErr } = await supabase
          .from("ecritures_v")
          .select("id, piece_id, libelle, date_ecriture, status, review_outcome, reverses_id")
          .in("piece_id", pieceIds)
          .eq("status", "booked")
          .is("reverses_id", null)
          .is("review_outcome", null)
          .order("created_at", { ascending: false });
        if (eErr) throw eErr;
        for (const e of ecrs ?? []) {
          const pid = e.piece_id as string;
          if (!ecrByPiece.has(pid)) {
            ecrByPiece.set(pid, {
              id: e.id as string,
              libelle: (e.libelle as string) ?? "",
              date: e.date_ecriture as string,
            });
          }
        }
      }

      const names = new Map(orgs.map((o) => [o["id"] as string, o["name"] as string]));
      return (pieces ?? [])
        .map((p) => {
          const ecr = ecrByPiece.get(p.id as string) ?? null;
          return {
            pieceId: p.id as string,
            tenantId: p.tenant_id as string,
            clientName: names.get(p.tenant_id as string) ?? "—",
            status: p.status as PieceStatus,
            source: p.source as "photo" | "pdf",
            createdAt: p.created_at as string,
            ecritureId: ecr?.id ?? null,
            libelle: ecr?.libelle ?? null,
            dateEcriture: ecr?.date ?? null,
          } satisfies QueueItem;
        })
        .sort((a, b) => {
          const d = PRIORITY[a.status] - PRIORITY[b.status];
          if (d !== 0) return d;
          return a.createdAt < b.createdAt ? 1 : -1;
        });
    },

    async motifs(locale: string): Promise<RejetMotif[]> {
      const [{ data: motifs, error }, { data: labels, error: lErr }] = await Promise.all([
        supabase
          .from("ref_rejet_motifs_v")
          .select("id, code, severity, requires_note, sort_order, active")
          .order("sort_order", { ascending: true }),
        supabase.from("ref_labels_v").select("key, value, locale, ns").eq("ns", "rejet_motif"),
      ]);
      if (error) throw error;
      if (lErr) throw lErr;

      const wanted = new Map<string, string>();
      const fallback = new Map<string, string>();
      for (const l of labels ?? []) {
        if (l.locale === locale) wanted.set(l.key as string, l.value as string);
        if (l.locale === "fr") fallback.set(l.key as string, l.value as string);
      }

      return (motifs ?? [])
        .filter((m) => m.active !== false)
        .map((m) => ({
          id: m.id as string,
          code: m.code as string,
          label:
            wanted.get(m.code as string) ?? fallback.get(m.code as string) ?? (m.code as string),
          severity: m.severity as string,
          requiresNote: Boolean(m.requires_note),
        }));
    },

    async review(input) {
      const { data, error } = await supabase.rpc("socle_ecriture_review", {
        p_ecriture: input.ecritureId,
        p_outcome: input.outcome,
        ...(input.motifId ? { p_motif: input.motifId } : {}),
        ...(input.note ? { p_note: input.note } : {}),
      });
      if (error) throw error;
      return (data as unknown as string | null) ?? null;
    },

    async auditForPiece(pieceId: string): Promise<AuditEntry[]> {
      const { data, error } = await supabase
        .from("event_log_v")
        .select("id, action, actor, at, motif_id, payload, object_id")
        .order("at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? [])
        .filter((row) => {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          return row.object_id === pieceId || payload["piece_id"] === pieceId;
        })
        .map((row) => ({
          id: row.id as string,
          action: row.action as string,
          actor: (row.actor as string | null) ?? null,
          at: row.at as string,
          motifId: (row.motif_id as string | null) ?? null,
          payload: row.payload,
        }));
    },
  };
}
