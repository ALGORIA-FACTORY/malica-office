import { supabase } from "@/integrations/supabase/client";

import type {
  Entity,
  IdentityRepository,
  NewOrganization,
  OrgKind,
  Organization,
  ValidationMode,
} from "../../ports/repositories";

/**
 * Seul endroit du vertical qui connaît le schéma d'accès (vues security_invoker
 * de la migration 005). L'isolation reste défendue par la base, jamais ici.
 */
export function createSupabaseIdentityRepository(): IdentityRepository {
  return {
    async listMyOrganizations() {
      const { data: session } = await supabase.auth.getUser();
      const uid = session.user?.id;
      if (!uid) return [];

      const [{ data: orgs, error: orgErr }, { data: mships, error: mErr }] = await Promise.all([
        supabase.from("organizations_v").select("*"),
        supabase.from("memberships_v").select("tenant_id, role").eq("user_id", uid),
      ]);
      if (orgErr) throw orgErr;
      if (mErr) throw mErr;

      const roles = new Map((mships ?? []).map((m) => [m.tenant_id as string, m.role as string]));
      return (orgs ?? []).map((o) => ({
        id: o.id as string,
        kind: o.kind as OrgKind,
        name: o.name as string,
        legalId: (o.legal_id as string | null) ?? null,
        jurisdiction: o.jurisdiction as string,
        currency: o.currency as string,
        validationMode: o.validation_mode as ValidationMode,
        role: roles.get(o.id as string) ?? "membre",
      }));
    },

    async listEntities(tenantId: string): Promise<Entity[]> {
      const { data, error } = await supabase
        .from("entities_v")
        .select("id, tenant_id, code, name, is_default")
        .eq("tenant_id", tenantId)
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((e) => ({
        id: e.id as string,
        tenantId: e.tenant_id as string,
        code: e.code as string,
        name: e.name as string,
        isDefault: Boolean(e.is_default),
      }));
    },

    async createOrganization(input: NewOrganization) {
      const { data, error } = await supabase.rpc("create_organization", {
        p_kind: input.kind,
        p_name: input.name,
        p_validation_mode: input.validationMode ?? "mandate",
        ...(input.legalId ? { p_legal_id: input.legalId } : {}),
        p_jurisdiction: input.jurisdiction ?? "TN",
        p_currency: input.currency ?? "TND",
      });
      if (error) throw error;
      const orgId = data as unknown as string;

      const { error: entErr } = await supabase.from("entities_v").insert({
        tenant_id: orgId,
        code: "PRINCIPAL",
        name: input.defaultEntityName?.trim() || input.name,
        is_default: true,
      });
      if (entErr) throw entErr;

      return orgId;
    },
  };
}
