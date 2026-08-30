import { supabase } from "@/integrations/supabase/client";

import type {
  NewStockItem,
  StockCategory,
  StockDepreciationRow,
  StockInventaireRow,
  StockItem,
  StockMouvementRow,
  StocksRepository,
} from "../../ports/repositories";

function dec(v: unknown, decimals = 3): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  return Number(v).toFixed(decimals);
}

function num(v: unknown, decimals = 3): string {
  return dec(v, decimals) ?? Number(0).toFixed(decimals);
}

export function createSupabaseStocksRepository(): StocksRepository {
  return {
    async categories(packVersionId: string): Promise<StockCategory[]> {
      const { data, error } = await supabase
        .from("ref_stock_categories_v")
        .select(
          "id, code, label, account_stock, account_variation, account_provision, account_provision_dotation, account_provision_reprise, legal_reference",
        )
        .eq("pack_version_id", packVersionId)
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        code: r.code as string,
        label: r.label as string,
        accountStock: r.account_stock as string,
        accountVariation: r.account_variation as string,
        accountProvision: r.account_provision as string,
        accountProvisionDotation: r.account_provision_dotation as string,
        accountProvisionReprise: r.account_provision_reprise as string,
        legalReference: (r.legal_reference as string | null) ?? null,
      }));
    },

    async listItems(tenantId: string): Promise<StockItem[]> {
      const { data, error } = await supabase
        .from("stocks_items_v")
        .select(
          "id, tenant_id, category_id, reference, designation, unite, methode, account_stock, account_variation, devise, active",
        )
        .eq("tenant_id", tenantId)
        .order("reference", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        categoryId: (r.category_id as string | null) ?? null,
        reference: r.reference as string,
        designation: r.designation as string,
        unite: r.unite as string,
        methode: r.methode as StockItem["methode"],
        accountStock: r.account_stock as string,
        accountVariation: r.account_variation as string,
        devise: r.devise as string,
        active: Boolean(r.active),
      }));
    },

    async createItem(input: NewStockItem): Promise<string> {
      const { data, error } = await supabase
        .from("stocks_items_v")
        .insert({
          tenant_id: input.tenantId,
          entity_id: input.entityId,
          category_id: input.categoryId,
          reference: input.reference,
          designation: input.designation,
          unite: input.unite,
          methode: input.methode,
          account_stock: input.accountStock,
          account_variation: input.accountVariation,
          devise: input.devise,
          pack_version_id: input.packVersionId,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async updateItem(input): Promise<void> {
      const { error } = await supabase
        .from("stocks_items_v")
        .update({
          designation: input.designation,
          unite: input.unite,
          methode: input.methode,
          active: input.active,
        } as never)
        .eq("id", input.id);
      if (error) throw error;
    },

    async mouvements(tenantId: string, itemId?: string): Promise<StockMouvementRow[]> {
      let q = supabase
        .from("stocks_mouvements_v")
        .select("id, item_id, sens, at, quantite, cout_unitaire, reference, piece_id")
        .eq("tenant_id", tenantId);
      if (itemId) q = q.eq("item_id", itemId);
      const { data, error } = await q.order("at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        itemId: r.item_id as string,
        sens: r.sens as StockMouvementRow["sens"],
        at: r.at as string,
        quantite: num(r.quantite),
        coutUnitaire: dec(r.cout_unitaire),
        reference: (r.reference as string | null) ?? null,
        pieceId: (r.piece_id as string | null) ?? null,
      }));
    },

    async addMouvement(input): Promise<string> {
      const { data, error } = await supabase
        .from("stocks_mouvements_v")
        .insert({
          tenant_id: input.tenantId,
          item_id: input.itemId,
          sens: input.sens,
          at: input.at,
          quantite: input.quantite,
          cout_unitaire: input.coutUnitaire ?? null,
          reference: input.reference ?? null,
          piece_id: input.pieceId ?? null,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async inventaires(tenantId: string, itemId?: string): Promise<StockInventaireRow[]> {
      let q = supabase
        .from("stocks_inventaires_v")
        .select("id, item_id, period, initial, final, variation, ecriture_id, created_at")
        .eq("tenant_id", tenantId);
      if (itemId) q = q.eq("item_id", itemId);
      const { data, error } = await q.order("period", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        itemId: (r.item_id as string | null) ?? null,
        period: r.period as string,
        initial: num(r.initial),
        final: num(r.final),
        variation: num(r.variation),
        ecritureId: (r.ecriture_id as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async constaterInventaire(input) {
      const { data, error } = await supabase.rpc("stocks_inventaire_constater", {
        p_item: input.itemId,
        p_period: input.period,
        p_initial: input.initial as unknown as number,
        p_final: input.final as unknown as number,
        p_variation: input.variation as unknown as number,
        p_pack_version: input.packVersionId,
        p_date: input.date,
      });
      if (error) throw error;
      const out = data as unknown as { inventaire_id: string; ecriture_id: string };
      return { inventaireId: out.inventaire_id, ecritureId: out.ecriture_id };
    },

    async depreciations(tenantId: string, itemId?: string): Promise<StockDepreciationRow[]> {
      let q = supabase
        .from("stocks_depreciations_v")
        .select(
          "id, item_id, at, valeur_stock, valeur_nette, mouvement, cumul, note, ecriture_id, created_at",
        )
        .eq("tenant_id", tenantId);
      if (itemId) q = q.eq("item_id", itemId);
      const { data, error } = await q.order("at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        itemId: r.item_id as string,
        at: r.at as string,
        valeurStock: num(r.valeur_stock),
        valeurNette: num(r.valeur_nette),
        mouvement: num(r.mouvement),
        cumul: num(r.cumul),
        note: (r.note as string | null) ?? null,
        ecritureId: (r.ecriture_id as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async constaterDepreciation(input) {
      const { data, error } = await supabase.rpc("stocks_depreciation_constater", {
        p_item: input.itemId,
        p_at: input.at,
        p_valeur_stock: input.valeurStock as unknown as number,
        p_valeur_nette: input.valeurNette as unknown as number,
        p_mouvement: input.mouvement as unknown as number,
        p_cumul: input.cumul as unknown as number,
        p_pack_version: input.packVersionId,
        ...(input.note ? { p_note: input.note } : {}),
      });
      if (error) throw error;
      const out = data as unknown as { depreciation_id: string; ecriture_id: string };
      return { depreciationId: out.depreciation_id, ecritureId: out.ecriture_id };
    },

    async recordInventaire(input): Promise<string> {
      const { data, error } = await supabase
        .from("stocks_inventaires_v")
        .insert({
          tenant_id: input.tenantId,
          item_id: input.itemId,
          period: input.period,
          initial: input.initial as unknown as number,
          final: input.final as unknown as number,
          variation: input.variation as unknown as number,
          pack_version_id: input.packVersionId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
  };
}
