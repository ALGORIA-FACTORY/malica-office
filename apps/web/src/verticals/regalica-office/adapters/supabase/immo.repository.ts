import { supabase } from "@/integrations/supabase/client";

import type {
  Asset,
  Cession,
  Depreciation,
  Dotation,
  ImmoCategory,
  ImmoRepository,
  NewAsset,
} from "../../ports/repositories";

function dec(v: unknown, decimals = 3): string {
  if (typeof v === "string") return v;
  return Number(v ?? 0).toFixed(decimals);
}

export function createSupabaseImmoRepository(): ImmoRepository {
  return {
    async categories(packVersionId: string): Promise<ImmoCategory[]> {
      const { data, error } = await supabase
        .from("ref_immo_categories_v")
        .select(
          "id, code, label, method, duree_annees, coefficient, account_immo, account_amort, account_dotation, legal_reference",
        )
        .eq("pack_version_id", packVersionId)
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        code: r.code as string,
        label: r.label as string,
        method: r.method as ImmoCategory["method"],
        dureeAnnees: Number(r.duree_annees),
        coefficient: dec(r.coefficient, 4),
        accountImmo: r.account_immo as string,
        accountAmort: r.account_amort as string,
        accountDotation: r.account_dotation as string,
        legalReference: (r.legal_reference as string | null) ?? null,
      }));
    },

    async listAssets(tenantId: string): Promise<Asset[]> {
      const { data, error } = await supabase
        .from("immo_assets_v")
        .select(
          "id, tenant_id, category_id, label, mise_en_service, valeur_brute, valeur_residuelle, method, duree_annees, coefficient, devise, status, piece_id, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("mise_en_service", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        categoryId: r.category_id as string,
        label: r.label as string,
        miseEnService: r.mise_en_service as string,
        valeurBrute: dec(r.valeur_brute),
        valeurResiduelle: dec(r.valeur_residuelle),
        method: r.method as Asset["method"],
        dureeAnnees: Number(r.duree_annees),
        coefficient: dec(r.coefficient, 4),
        devise: r.devise as string,
        status: r.status as Asset["status"],
        pieceId: (r.piece_id as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async createAsset(input: NewAsset): Promise<string> {
      const { data, error } = await supabase
        .from("immo_assets_v")
        .insert({
          tenant_id: input.tenantId,
          entity_id: input.entityId,
          vis: input.vis ?? "partage",
          piece_id: input.pieceId ?? null,
          category_id: input.categoryId,
          label: input.label,
          mise_en_service: input.miseEnService,
          valeur_brute: input.valeurBrute,
          valeur_residuelle: input.valeurResiduelle,
          method: input.method,
          duree_annees: input.dureeAnnees,
          coefficient: input.coefficient,
          devise: input.devise,
          pack_version_id: input.packVersionId,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async dotations(tenantId: string, assetId?: string): Promise<Dotation[]> {
      let q = supabase
        .from("immo_dotations_v")
        .select("id, asset_id, exercice, months, dotation, cumul, vnc, ecriture_id, created_at")
        .eq("tenant_id", tenantId);
      if (assetId) q = q.eq("asset_id", assetId);
      const { data, error } = await q.order("exercice", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        assetId: r.asset_id as string,
        exercice: Number(r.exercice),
        months: Number(r.months),
        dotation: dec(r.dotation),
        cumul: dec(r.cumul),
        vnc: dec(r.vnc),
        ecritureId: (r.ecriture_id as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async recordDotation(input): Promise<string> {
      const { data, error } = await supabase
        .from("immo_dotations_v")
        .insert({
          tenant_id: input.tenantId,
          asset_id: input.assetId,
          exercice: input.exercice,
          months: input.months,
          dotation: input.dotation,
          cumul: input.cumul,
          vnc: input.vnc,
          pack_version_id: input.packVersionId,
          ecriture_id: input.ecritureId ?? null,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async updateAsset(input): Promise<void> {
      const { error } = await supabase
        .from("immo_assets_v")
        .update({
          label: input.label,
          mise_en_service: input.miseEnService,
          valeur_brute: input.valeurBrute,
          valeur_residuelle: input.valeurResiduelle,
          method: input.method,
          duree_annees: input.dureeAnnees,
          coefficient: input.coefficient,
          status: input.status,
        } as never)
        .eq("id", input.id);
      if (error) throw error;
    },

    async constaterDotation(input) {
      const { data, error } = await supabase.rpc("immo_dotation_constater", {
        p_asset: input.assetId,
        p_exercice: input.exercice,
        p_months: input.months,
        p_dotation: input.dotation as unknown as number,
        p_cumul: input.cumul as unknown as number,
        p_vnc: input.vnc as unknown as number,
        p_pack_version: input.packVersionId,
        ...(input.date ? { p_date: input.date } : {}),
      });
      if (error) throw error;
      const out = data as unknown as { dotation_id: string; ecriture_id: string };
      return { dotationId: out.dotation_id, ecritureId: out.ecriture_id };
    },

    async constaterDepreciation(input) {
      const { data, error } = await supabase.rpc("immo_depreciation_constater", {
        p_asset: input.assetId,
        p_at: input.at,
        p_vnc: input.vnc as unknown as number,
        p_valeur_recouvrable: input.valeurRecouvrable as unknown as number,
        p_mouvement: input.mouvement as unknown as number,
        p_cumul: input.cumul as unknown as number,
        p_pack_version: input.packVersionId,
        ...(input.note ? { p_note: input.note } : {}),
      });
      if (error) throw error;
      const out = data as unknown as { depreciation_id: string; ecriture_id: string };
      return { depreciationId: out.depreciation_id, ecritureId: out.ecriture_id };
    },

    async depreciations(tenantId: string, assetId?: string): Promise<Depreciation[]> {
      let q = supabase
        .from("immo_depreciations_v")
        .select(
          "id, asset_id, at, vnc, valeur_recouvrable, mouvement, cumul, note, ecriture_id, created_at",
        )
        .eq("tenant_id", tenantId);
      if (assetId) q = q.eq("asset_id", assetId);
      const { data, error } = await q.order("at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        assetId: r.asset_id as string,
        at: r.at as string,
        vnc: dec(r.vnc),
        valeurRecouvrable: dec(r.valeur_recouvrable),
        mouvement: dec(r.mouvement),
        cumul: dec(r.cumul),
        note: (r.note as string | null) ?? null,
        ecritureId: (r.ecriture_id as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async recordDepreciation(input): Promise<string> {
      const { data, error } = await supabase
        .from("immo_depreciations_v")
        .insert({
          tenant_id: input.tenantId,
          asset_id: input.assetId,
          at: input.at,
          vnc: input.vnc,
          valeur_recouvrable: input.valeurRecouvrable,
          mouvement: input.mouvement,
          cumul: input.cumul,
          note: input.note ?? null,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async cessions(tenantId: string): Promise<Cession[]> {
      const { data, error } = await supabase
        .from("immo_cessions_v")
        .select("id, asset_id, at, prix, vnc, resultat, created_at")
        .eq("tenant_id", tenantId)
        .order("at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        assetId: r.asset_id as string,
        at: r.at as string,
        prix: dec(r.prix),
        vnc: dec(r.vnc),
        resultat: dec(r.resultat),
        createdAt: r.created_at as string,
      }));
    },

    async recordCession(input): Promise<string> {
      const { data, error } = await supabase
        .from("immo_cessions_v")
        .insert({
          tenant_id: input.tenantId,
          asset_id: input.assetId,
          at: input.at,
          prix: input.prix,
          vnc: input.vnc,
          resultat: input.resultat,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
  };
}
