import { supabase } from "@/integrations/supabase/client";

import { throwIf } from "./errors";
import type {
  Ecriture,
  EcritureLine,
  OfficeRepository,
  ProposedEcriture,
} from "../../ports/repositories";

/** Les numériques arrivent en nombre JSON : on les refixe en chaîne décimale. */
function dec(v: unknown, decimals = 3): string {
  if (typeof v === "string") return v;
  return Number(v ?? 0).toFixed(decimals);
}

export function createSupabaseOfficeRepository(): OfficeRepository {
  return {
    async propose(input: ProposedEcriture): Promise<string> {
      const { data, error } = await supabase.rpc("socle_ecriture_propose", {
        p_piece: input.pieceId,
        p_journal: input.journal,
        p_date: input.date,
        p_libelle: input.libelle,
        p_pack_version: input.packVersionId,
        p_lignes: input.lignes as unknown as never,
        p_devise: input.devise,
      });
      throwIf(error, "Proposition d'écriture");
      return data as unknown as string;
    },

    async book(ecritureId: string): Promise<void> {
      const { error } = await supabase.rpc("socle_ecriture_book", { p_ecriture: ecritureId });
      throwIf(error, "Comptabilisation");
    },

    async ecrituresByIds(ids: string[]): Promise<Ecriture[]> {
      if (ids.length === 0) return [];
      const { data: ecrs, error } = await supabase
        .from("ecritures_v")
        .select("id, piece_id, journal, date_ecriture, devise, libelle, status")
        .in("id", ids)
        .order("date_ecriture", { ascending: false });
      if (error) throw error;

      const { data: lignes, error: lErr } = await supabase
        .from("ecriture_lignes_v")
        .select("ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code")
        .in("ecriture_id", ids)
        .order("ordinal", { ascending: true });
      if (lErr) throw lErr;

      const byEcr = new Map<string, EcritureLine[]>();
      for (const l of lignes ?? []) {
        const key = l.ecriture_id as string;
        const arr = byEcr.get(key) ?? [];
        arr.push({
          ordinal: Number(l.ordinal),
          accountCode: l.account_code as string,
          libelle: (l.libelle as string) ?? "",
          debit: dec(l.debit),
          credit: dec(l.credit),
          taxCode: (l.tax_code as string | null) ?? null,
        });
        byEcr.set(key, arr);
      }

      return (ecrs ?? []).map((e) => ({
        id: e.id as string,
        pieceId: (e.piece_id as string | null) ?? null,
        journal: e.journal as string,
        dateEcriture: e.date_ecriture as string,
        devise: e.devise as string,
        libelle: e.libelle as string,
        status: e.status as string,
        lines: byEcr.get(e.id as string) ?? [],
      }));
    },

    async ecrituresForPiece(pieceId: string): Promise<Ecriture[]> {
      const { data: ecrs, error } = await supabase
        .from("ecritures_v")
        .select("id, piece_id, journal, date_ecriture, devise, libelle, status")
        .eq("piece_id", pieceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (ecrs ?? []).map((e) => e.id as string);
      if (ids.length === 0) return [];

      const { data: lignes, error: lErr } = await supabase
        .from("ecriture_lignes_v")
        .select("ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code")
        .in("ecriture_id", ids)
        .order("ordinal", { ascending: true });
      if (lErr) throw lErr;

      const byEcr = new Map<string, EcritureLine[]>();
      for (const l of lignes ?? []) {
        const key = l.ecriture_id as string;
        const arr = byEcr.get(key) ?? [];
        arr.push({
          ordinal: Number(l.ordinal),
          accountCode: l.account_code as string,
          libelle: (l.libelle as string) ?? "",
          debit: dec(l.debit),
          credit: dec(l.credit),
          taxCode: (l.tax_code as string | null) ?? null,
        });
        byEcr.set(key, arr);
      }

      return (ecrs ?? []).map((e) => ({
        id: e.id as string,
        pieceId: (e.piece_id as string | null) ?? null,
        journal: e.journal as string,
        dateEcriture: e.date_ecriture as string,
        devise: e.devise as string,
        libelle: (e.libelle as string) ?? "",
        status: e.status as string,
        lines: byEcr.get(e.id as string) ?? [],
      }));
    },

    async bookedExtracts(tenantId: string, from: string, to: string) {
      const { data: ecrs, error } = await supabase
        .from("ecritures_v")
        .select("piece_id, date_ecriture, status")
        .eq("tenant_id", tenantId)
        .eq("status", "booked")
        .gte("date_ecriture", from)
        .lte("date_ecriture", to);
      if (error) throw error;
      const pieceIds = Array.from(
        new Set((ecrs ?? []).map((e) => e.piece_id as string | null).filter((v): v is string => !!v)),
      );
      if (pieceIds.length === 0) return [];

      const { data: exs, error: exErr } = await supabase
        .from("extractions_v")
        .select("piece_id, payload, created_at, contract")
        .in("piece_id", pieceIds)
        .eq("contract", "extract.v1")
        .order("created_at", { ascending: false });
      if (exErr) throw exErr;

      const seen = new Set<string>();
      const out: Array<{ pieceId: string; extract: unknown }> = [];
      for (const e of exs ?? []) {
        const pid = e.piece_id as string;
        if (seen.has(pid)) continue;
        seen.add(pid);
        out.push({ pieceId: pid, extract: e.payload });
      }
      return out;
    },
  };
}
