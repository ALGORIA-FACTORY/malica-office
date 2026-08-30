/**
 * Le dossier que Regalica a le droit de lire — et rien de plus.
 *
 * Tout vient de la base à travers les vues `security_invoker` : le mur de
 * visibilité (R6) est celui de la RLS, jamais un filtre écrit ici. Aucune
 * valeur n'est recalculée : on transmet ce que le Socle a déjà produit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export interface RegalicaContext {
  organisation: { name: string; kind: string; jurisdiction: string; currency: string; validationMode: string };
  pack: { version: string; effectiveFrom: string } | null;
  pieces: Record<string, number>;
  ecritures: Array<{
    id: string;
    date: string;
    journal: string;
    libelle: string;
    status: string;
    lignes: Array<{ compte: string; libelle: string; debit: string; credit: string; taxCode: string | null }>;
  }>;
  echeances: Array<{ label: string; dueDate: string; status: string }>;
  motifs: Array<{ code: string; severity: string; requiresNote: boolean }>;
  piece: {
    id: string;
    status: string;
    source: string;
    contract: string | null;
    extract: unknown;
    flags: unknown;
    citations: Array<{ field: string; page: number; zone: string | null }>;
  } | null;
}

export async function loadRegalicaContext(
  supabase: Client,
  tenantId: string,
  pieceId?: string | null,
): Promise<RegalicaContext> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: org, error: orgErr } = await supabase
    .from("organizations_v")
    .select("name, kind, jurisdiction, currency, validation_mode")
    .eq("id", tenantId)
    .maybeSingle();
  if (orgErr) throw new Error(orgErr.message);
  if (!org) throw new Error("organisation introuvable ou non autorisée");

  const [{ data: packs }, { data: pieces }, { data: ecritures }, { data: echeances }, { data: motifs }] =
    await Promise.all([
      supabase
        .from("ref_packs_v")
        .select("id, version, effective_from")
        .eq("jurisdiction", (org.jurisdiction as string) ?? "TN")
        .lte("effective_from", today)
        .order("effective_from", { ascending: false })
        .limit(1),
      supabase.from("pieces_v").select("id, status").eq("tenant_id", tenantId).limit(500),
      supabase
        .from("ecritures_v")
        .select("id, date_ecriture, journal, libelle, status")
        .eq("tenant_id", tenantId)
        .order("date_ecriture", { ascending: false })
        .limit(25),
      supabase
        .from("echeances_v")
        .select("label, due_date, status")
        .eq("tenant_id", tenantId)
        .order("due_date", { ascending: true })
        .limit(20),
      supabase
        .from("ref_rejet_motifs_v")
        .select("code, severity, requires_note")
        .eq("active", true)
        .limit(40),
    ]);

  const counts: Record<string, number> = {};
  for (const p of pieces ?? []) {
    const key = (p.status as string) ?? "inconnu";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const ecritureIds = (ecritures ?? []).map((e) => e.id as string);
  const { data: lignes } = ecritureIds.length
    ? await supabase
        .from("ecriture_lignes_v")
        .select("ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code")
        .in("ecriture_id", ecritureIds)
        .order("ordinal", { ascending: true })
    : { data: [] as never[] };

  const byEcriture = new Map<string, RegalicaContext["ecritures"][number]["lignes"]>();
  for (const l of lignes ?? []) {
    const key = l.ecriture_id as string;
    const list = byEcriture.get(key) ?? [];
    list.push({
      compte: l.account_code as string,
      libelle: (l.libelle as string) ?? "",
      debit: String(l.debit),
      credit: String(l.credit),
      taxCode: (l.tax_code as string | null) ?? null,
    });
    byEcriture.set(key, list);
  }

  let piece: RegalicaContext["piece"] = null;
  if (pieceId) {
    const { data: p } = await supabase
      .from("pieces_v")
      .select("id, status, source")
      .eq("id", pieceId)
      .maybeSingle();
    if (p) {
      const [{ data: extraction }, { data: citations }] = await Promise.all([
        supabase
          .from("extractions_v")
          .select("contract, payload, flags")
          .eq("piece_id", pieceId)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.from("citations_v").select("field, page, zone").eq("piece_id", pieceId).limit(80),
      ]);
      piece = {
        id: p.id as string,
        status: p.status as string,
        source: p.source as string,
        contract: (extraction?.[0]?.contract as string | undefined) ?? null,
        extract: extraction?.[0]?.payload ?? null,
        flags: extraction?.[0]?.flags ?? null,
        citations: (citations ?? []).map((c) => ({
          field: c.field as string,
          page: Number(c.page),
          zone: (c.zone as string | null) ?? null,
        })),
      };
    }
  }

  return {
    organisation: {
      name: org.name as string,
      kind: org.kind as string,
      jurisdiction: org.jurisdiction as string,
      currency: org.currency as string,
      validationMode: org.validation_mode as string,
    },
    pack: packs?.[0]
      ? { version: packs[0].version as string, effectiveFrom: packs[0].effective_from as string }
      : null,
    pieces: counts,
    ecritures: (ecritures ?? []).map((e) => ({
      id: e.id as string,
      date: e.date_ecriture as string,
      journal: e.journal as string,
      libelle: e.libelle as string,
      status: e.status as string,
      lignes: byEcriture.get(e.id as string) ?? [],
    })),
    echeances: (echeances ?? []).map((e) => ({
      label: e.label as string,
      dueDate: e.due_date as string,
      status: e.status as string,
    })),
    motifs: (motifs ?? []).map((m) => ({
      code: m.code as string,
      severity: m.severity as string,
      requiresNote: Boolean(m.requires_note),
    })),
    piece,
  };
}
