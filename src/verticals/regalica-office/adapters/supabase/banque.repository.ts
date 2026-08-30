import { supabase } from "@/integrations/supabase/client";

import type {
  AuditEntry,
  BankAccount,
  BankStatementLine,
  BanqueRepository,
  LettrageEtat,
  LettrageRow,
} from "../../ports/repositories";

function dec(v: unknown, decimals = 3): string {
  if (typeof v === "string") return v;
  return Number(v ?? 0).toFixed(decimals);
}

export function createSupabaseBanqueRepository(): BanqueRepository {
  return {
    async listAccounts(tenantId: string): Promise<BankAccount[]> {
      const { data, error } = await supabase
        .from("banque_comptes_v")
        .select("id, tenant_id, label, iban, devise, account_code, active")
        .eq("tenant_id", tenantId)
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        label: r.label as string,
        iban: (r.iban as string | null) ?? null,
        devise: r.devise as string,
        accountCode: r.account_code as string,
        active: Boolean(r.active),
      }));
    },

    async createAccount(input): Promise<string> {
      const { data, error } = await supabase
        .from("banque_comptes_v")
        .insert({
          tenant_id: input.tenantId,
          entity_id: input.entityId,
          label: input.label,
          iban: input.iban ?? null,
          devise: input.devise,
          account_code: input.accountCode,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async lines(tenantId: string, compteId: string): Promise<BankStatementLine[]> {
      const { data, error } = await supabase
        .from("banque_lignes_v")
        .select("id, compte_id, at, label, montant, reference, status")
        .eq("tenant_id", tenantId)
        .eq("compte_id", compteId)
        .order("at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        compteId: r.compte_id as string,
        at: r.at as string,
        label: r.label as string,
        montant: dec(r.montant),
        reference: (r.reference as string | null) ?? null,
        status: r.status as BankStatementLine["status"],
      }));
    },

    async importLines(input): Promise<number> {
      if (input.lines.length === 0) return 0;
      const { data, error } = await supabase
        .from("banque_lignes_v")
        .upsert(
          input.lines.map((l) => ({
            tenant_id: input.tenantId,
            compte_id: input.compteId,
            at: l.at,
            label: l.label,
            montant: l.montant,
            reference: l.reference,
            import_batch: input.batchId,
            idempotency_key: l.idempotencyKey,
          })) as never,
          { onConflict: "tenant_id,idempotency_key", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;
      return (data ?? []).length;
    },

    async bookLines(input) {
      const { data, error } = await supabase.rpc("banque_book_lignes", {
        p_tenant: input.tenantId,
        p_prefix: input.accountCode,
        p_from: input.from,
        p_to: input.to,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.ecriture_id as string,
        pieceId: (r.piece_id as string | null) ?? null,
        at: r.date_ecriture as string,
        journal: (r.journal as string | null) ?? "",
        label: (r.libelle as string | null) ?? "",
        // Débit d'un compte de trésorerie = encaissement ; crédit = décaissement.
        montant: dec(r.montant),
        reference: (r.reference as string | null) ?? null,
        lettree: Boolean(r.lettree),
      }));
    },

    async etat(tenantId): Promise<LettrageEtat[]> {
      const { data, error } = await supabase
        .from("banque_lettrage_etat_v")
        .select("ligne_id, ecriture_id, active, score, ecart_montant, ecart_jours, reference_exacte, updated_at")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ligneId: r.ligne_id as string,
        ecritureId: r.ecriture_id as string,
        active: Boolean(r.active),
        score: Number(r.score),
        ecartMontant: dec(r.ecart_montant),
        ecartJours: Number(r.ecart_jours),
        referenceExacte: Boolean(r.reference_exacte),
        updatedAt: r.updated_at as string,
      }));
    },

    async lettrages(tenantId): Promise<LettrageRow[]> {
      const { data, error } = await supabase
        .from("banque_lettrages_v")
        .select(
          "id, ligne_id, ecriture_id, action, seq, score, ecart_montant, ecart_jours, reference_exacte, motif_id, note, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        ligneId: r.ligne_id as string,
        ecritureId: r.ecriture_id as string,
        action: r.action as LettrageRow["action"],
        seq: Number(r.seq),
        score: Number(r.score),
        ecartMontant: dec(r.ecart_montant),
        ecartJours: Number(r.ecart_jours),
        referenceExacte: Boolean(r.reference_exacte),
        motifId: (r.motif_id as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async lettrer(input): Promise<string> {
      const { data, error } = await supabase.rpc("banque_lettrer", {
        p_ligne: input.ligneId,
        p_ecriture: input.ecritureId,
        p_score: input.score,
        // numeric : on transmet la chaîne décimale telle quelle (aucun float).
        p_ecart_montant: input.ecartMontant as unknown as number,
        p_ecart_jours: input.ecartJours,
        p_reference_exacte: input.referenceExacte,
        p_pack_version: input.packVersionId,
      });
      if (error) throw error;
      return String((data as { lettrage_id?: string } | null)?.lettrage_id ?? "");
    },

    async delettrer(input): Promise<string> {
      const args: { p_ligne: string; p_motif: string; p_note?: string } = {
        p_ligne: input.ligneId,
        p_motif: input.motifId,
      };
      if (input.note) args.p_note = input.note;
      const { data, error } = await supabase.rpc("banque_delettrer", args);
      if (error) throw error;
      return String((data as { lettrage_id?: string } | null)?.lettrage_id ?? "");
    },

    async audit(tenantId): Promise<AuditEntry[]> {
      const { data, error } = await supabase
        .from("event_log_v")
        .select("id, action, actor, at, motif_id, payload")
        .eq("tenant_id", tenantId)
        .eq("object_schema", "banque")
        .order("at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        action: r.action as string,
        actor: (r.actor as string | null) ?? null,
        at: r.at as string,
        motifId: (r.motif_id as string | null) ?? null,
        payload: r.payload,
      }));
    },

    async setLineStatus(ligneId, status): Promise<void> {
      const { error } = await supabase.from("banque_lignes_v").update({ status }).eq("id", ligneId);
      if (error) throw error;
    },
  };
}
