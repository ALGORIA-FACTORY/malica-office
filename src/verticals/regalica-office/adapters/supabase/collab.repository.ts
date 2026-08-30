import { supabase } from "@/integrations/supabase/client";

import type {
  Assignment,
  CabinetMember,
  ClientStats,
  CollabRepository,
  Echeance,
  Notification,
  PvReunion,
  Visibility,
} from "../../ports/repositories";

/**
 * Seul endroit qui connaît les vues de collaboration (migration 013).
 * Le mur de visibilité et le périmètre du cabinet restent tenus par RLS :
 * les filtres ci-dessous ne sont qu'une commodité de lecture.
 */
export function createSupabaseCollabRepository(): CollabRepository {
  return {
    async members(cabinetTenantId: string): Promise<CabinetMember[]> {
      const { data, error } = await supabase
        .from("cabinet_members_v")
        .select("tenant_id, user_id, role, email")
        .eq("tenant_id", cabinetTenantId);
      if (error) throw error;
      return (data ?? []).map((m) => ({
        tenantId: m.tenant_id as string,
        userId: m.user_id as string,
        role: (m.role as string) ?? "—",
        email: (m.email as string) ?? "—",
      }));
    },

    async assignments(cabinetTenantId: string): Promise<Assignment[]> {
      const { data, error } = await supabase
        .from("collab_assignments_v")
        .select(
          "id, cabinet_tenant_id, client_tenant_id, collaborator_id, briefing, active, seq, created_at",
        )
        .eq("cabinet_tenant_id", cabinetTenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id as string,
        cabinetTenantId: a.cabinet_tenant_id as string,
        clientTenantId: a.client_tenant_id as string,
        collaboratorId: a.collaborator_id as string,
        briefing: (a.briefing as string | null) ?? null,
        active: Boolean(a.active),
        seq: Number(a.seq ?? 1),
        createdAt: a.created_at as string,
      }));
    },

    async assign(input): Promise<string> {
      const { data, error } = await supabase.rpc("collab_assign", {
        p_cabinet: input.cabinetTenantId,
        p_client: input.clientTenantId,
        p_user: input.collaboratorId,
        ...(input.briefing ? { p_briefing: input.briefing } : {}),
      });
      if (error) throw error;
      return data as unknown as string;
    },

    async pvList(cabinetTenantId: string): Promise<PvReunion[]> {
      const { data, error } = await supabase
        .from("collab_pv_v")
        .select(
          "id, client_tenant_id, at, titre, participants, ordre_du_jour, decisions, created_at",
        )
        .eq("cabinet_tenant_id", cabinetTenantId)
        .order("at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id as string,
        clientTenantId: (p.client_tenant_id as string | null) ?? null,
        at: p.at as string,
        titre: p.titre as string,
        participants: (p.participants as string | null) ?? null,
        ordreDuJour: (p.ordre_du_jour as string | null) ?? null,
        decisions: (p.decisions as string | null) ?? null,
        createdAt: p.created_at as string,
      }));
    },

    async addPv(input): Promise<string> {
      const { data, error } = await supabase
        .from("collab_pv_v")
        .insert({
          cabinet_tenant_id: input.cabinetTenantId,
          client_tenant_id: input.clientTenantId ?? null,
          at: input.at,
          titre: input.titre,
          participants: input.participants ?? null,
          ordre_du_jour: input.ordreDuJour ?? null,
          decisions: input.decisions ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async stats(tenantIds: string[]): Promise<ClientStats[]> {
      if (tenantIds.length === 0) return [];
      const { data, error } = await supabase
        .from("cabinet_stats_v")
        .select(
          "tenant_id, pieces, capturees, lues, proposees, comptabilisees, supervisees, retournees, heures_moyennes, derniere_piece",
        )
        .in("tenant_id", tenantIds);
      if (error) throw error;
      return (data ?? []).map((s) => ({
        tenantId: s.tenant_id as string,
        pieces: Number(s.pieces ?? 0),
        capturees: Number(s.capturees ?? 0),
        lues: Number(s.lues ?? 0),
        proposees: Number(s.proposees ?? 0),
        comptabilisees: Number(s.comptabilisees ?? 0),
        supervisees: Number(s.supervisees ?? 0),
        retournees: Number(s.retournees ?? 0),
        heuresMoyennes: Number(s.heures_moyennes ?? 0),
        dernierePiece: (s.derniere_piece as string | null) ?? null,
      }));
    },

    async notifications(tenantIds: string[]): Promise<Notification[]> {
      if (tenantIds.length === 0) return [];
      const { data, error } = await supabase
        .from("notifications_v")
        .select("id, tenant_id, kind, payload, read_at, created_at")
        .in("tenant_id", tenantIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id as string,
        tenantId: n.tenant_id as string,
        kind: n.kind as string,
        payload: n.payload,
        readAt: (n.read_at as string | null) ?? null,
        createdAt: n.created_at as string,
      }));
    },

    async markRead(id: string): Promise<void> {
      const { error } = await supabase
        .from("notifications_v")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },

    async echeances(tenantIds: string[]): Promise<Echeance[]> {
      if (tenantIds.length === 0) return [];
      const { data, error } = await supabase
        .from("echeances_v")
        .select("id, tenant_id, kind, label, period, due_date, status")
        .in("tenant_id", tenantIds)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((e) => ({
        id: e.id as string,
        tenantId: e.tenant_id as string,
        kind: e.kind as string,
        label: (e.label as string) ?? "—",
        period: (e.period as string | null) ?? null,
        dueDate: e.due_date as string,
        status: (e.status as string) ?? "a_venir",
      }));
    },

    async setPieceVis(pieceId: string, vis: Visibility): Promise<boolean> {
      const { data, error } = await supabase.rpc("capture_piece_set_vis", {
        p_piece: pieceId,
        p_vis: vis,
      });
      if (error) throw error;
      const row = (data ?? {}) as { changed?: boolean };
      return Boolean(row.changed);
    },
  };
}
