import { supabase } from "@/integrations/supabase/client";

import type {
  AccountMapping,
  FiscalCharge,
  JurisdictionPack,
  ReferentialRepository,
  SocleParams,
  TaxRate,
} from "../../ports/repositories";

/** Les numériques arrivent en nombre JSON : refixés en chaîne décimale. */
function decStr(v: unknown, decimals: number): string {
  if (typeof v === "string") return v;
  return Number(v ?? 0).toFixed(decimals);
}

export function createSupabaseReferentialRepository(): ReferentialRepository {
  return {
    async activePack(jurisdiction: string): Promise<JurisdictionPack | null> {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("ref_packs_v")
        .select("id, jurisdiction, version, effective_from, ratified")
        .eq("jurisdiction", jurisdiction)
        .lte("effective_from", today)
        .order("effective_from", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      return {
        id: row.id as string,
        jurisdiction: row.jurisdiction as string,
        version: row.version as string,
        effectiveFrom: row.effective_from as string,
        ratified: Boolean(row.ratified),
      };
    },

    async taxRates(packId: string, jurisdiction: string): Promise<TaxRate[]> {
      const { data, error } = await supabase
        .from("ref_tva_rates_v")
        .select("code, label, rate, valid_from, valid_to")
        .eq("pack_version_id", packId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        code: r.code as string,
        label: (r.label as string) ?? (r.code as string),
        rate: decStr(r.rate, 4),
        validFrom: r.valid_from as string,
        validTo: (r.valid_to as string | null) ?? null,
        jurisdiction,
      }));
    },

    async accountMappings(packId: string): Promise<AccountMapping[]> {
      const { data, error } = await supabase
        .from("ref_account_mappings_v")
        .select("document_kind, tax_code, main_account, vat_account, counterparty_account")
        .eq("pack_version_id", packId);
      if (error) throw error;
      return (data ?? []).map((m) => ({
        documentKind: m.document_kind as AccountMapping["documentKind"],
        taxCode: (m.tax_code as string | null) ?? null,
        mainAccount: m.main_account as string,
        vatAccount: m.vat_account as string,
        counterpartyAccount: m.counterparty_account as string,
      }));
    },

    async fiscalCharges(packId: string): Promise<FiscalCharge[]> {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("ref_fiscal_charges_v")
        .select("code, label, document_kind, account_code, fixed_amount, legal_reference, valid_from, valid_to")
        .eq("pack_version_id", packId)
        .lte("valid_from", today);
      if (error) throw error;
      return (data ?? [])
        .filter((r) => !r.valid_to || (r.valid_to as string) >= today)
        .map((r) => ({
          code: r.code as string,
          label: r.label as string,
          documentKind: r.document_kind as FiscalCharge["documentKind"],
          accountCode: r.account_code as string,
          fixedAmount: r.fixed_amount === null || r.fixed_amount === undefined ? null : decStr(r.fixed_amount, 3),
          legalReference: (r.legal_reference as string | null) ?? null,
        }));
    },

    async socleParams(packId: string): Promise<SocleParams> {
      const { data, error } = await supabase
        .from("ref_socle_params_v")
        .select("code, value_text, value_num")
        .eq("pack_version_id", packId);
      if (error) throw error;
      const byCode = new Map<string, { text: string | null; num: unknown }>();
      for (const r of data ?? []) {
        byCode.set(r.code as string, {
          text: (r.value_text as string | null) ?? null,
          num: r.value_num,
        });
      }
      const num = (code: string): number => {
        const v = byCode.get(code)?.num;
        if (v === null || v === undefined) {
          throw new Error(`Paramètre du Socle absent du pack : ${code}`);
        }
        return Number(v);
      };
      const text = (code: string): string => {
        const v = byCode.get(code)?.text;
        if (!v) throw new Error(`Paramètre du Socle absent du pack : ${code}`);
        return v;
      };
      const decimals = num("money.decimals");
      const methode = text("stock.methode");
      if (methode !== "cump" && methode !== "fifo") {
        throw new Error(`Méthode de stock inconnue au pack : ${methode}`);
      }
      return {
        packVersionId: packId,
        moneyDecimals: decimals,
        stockMethode: methode,
        stockQuantiteDecimals: num("stock.quantite_decimals"),
        rapprochementToleranceJours: num("rapprochement.tolerance_jours"),
        rapprochementToleranceMontant: num("rapprochement.tolerance_montant").toFixed(decimals),
      };
    },
  };
}
