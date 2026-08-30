/**
 * Passe 2 de l'ingestion Kaggle : dépôt réel en base.
 *
 * Pour chaque pièce lue en passe 1 :
 *   1. dépôt du fichier dans le bucket `pieces` ;
 *   2. `capture_piece_register` (clé d'idempotence = nom du document source) ;
 *   3. `capture_read_persist` (tokens, extract, citations, drapeaux) — la RPC
 *      refuse toute citation orpheline, c'est le mur R2 ;
 *   4. proposition d'écriture par le Socle (`buildProposal`) puis
 *      `socle_ecriture_propose`.
 *
 * Le script s'exécute avec une vraie session utilisateur : la RLS s'applique,
 * l'audit porte un auteur. Aucun montant n'est calculé ici.
 *
 * Usage : bun tests/real/ingest-push.ts <reads.json> <tenants.json> <session.json>
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { buildProposal } from "@/verticals/regalica-office/use-cases/propose-ecriture";
import type { AccountMapping, TaxRate } from "@/verticals/regalica-office/ports/repositories";

interface ReadRow {
  source: string;
  raster: string;
  family: string;
  tokens?: unknown[];
  contract?: string;
  extract?: Record<string, unknown>;
  citations?: unknown[];
  flags?: unknown[];
  valid?: boolean;
  error?: string;
}

function decStr(v: unknown, decimals: number): string {
  return typeof v === "string" ? v : Number(v ?? 0).toFixed(decimals);
}

async function main() {
  const [readsPath, tenantsPath, sessionPath] = process.argv.slice(2);
  if (!readsPath || !tenantsPath || !sessionPath)
    throw new Error("usage: bun tests/real/ingest-push.ts <reads.json> <tenants.json> <session.json>");

  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const anon =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY requis");

  const session = JSON.parse(readFileSync(sessionPath, "utf8")) as {
    access_token?: string;
    currentSession?: { access_token: string };
  };
  const token = session.access_token ?? session.currentSession?.access_token;
  if (!token) throw new Error("session sans access_token");

  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const reads = (JSON.parse(readFileSync(readsPath, "utf8")) as ReadRow[]).filter((r) => !r.error);
  const tenants = JSON.parse(readFileSync(tenantsPath, "utf8")) as Record<string, string>;

  // Référentiel : pack en vigueur, taux et imputations. Rien en dur.
  const today = new Date().toISOString().slice(0, 10);
  const { data: packs, error: pErr } = await sb
    .from("ref_packs_v")
    .select("id")
    .eq("jurisdiction", "TN")
    .lte("effective_from", today)
    .order("effective_from", { ascending: false })
    .limit(1);
  if (pErr) throw new Error(`pack : ${pErr.message}`);
  const packId = packs?.[0]?.id as string;

  const { data: rateRows, error: rErr } = await sb
    .from("ref_tva_rates_v")
    .select("code, label, rate, valid_from, valid_to")
    .eq("pack_version_id", packId);
  if (rErr) throw new Error(`taux : ${rErr.message}`);
  const taxRates: TaxRate[] = (rateRows ?? []).map((r) => ({
    code: r.code as string,
    label: (r.label as string) ?? (r.code as string),
    rate: decStr(r.rate, 4),
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
    jurisdiction: "TN",
  }));

  const { data: mapRows, error: mErr } = await sb
    .from("ref_account_mappings_v")
    .select("document_kind, tax_code, main_account, vat_account, counterparty_account")
    .eq("pack_version_id", packId);
  if (mErr) throw new Error(`imputations : ${mErr.message}`);
  const mappings: AccountMapping[] = (mapRows ?? []).map((m) => ({
    documentKind: m.document_kind as AccountMapping["documentKind"],
    taxCode: (m.tax_code as string | null) ?? null,
    mainAccount: m.main_account as string,
    vatAccount: m.vat_account as string,
    counterpartyAccount: m.counterparty_account as string,
  }));

  let pieces = 0;
  let ecritures = 0;
  const skipped: string[] = [];

  for (const row of reads) {
    const issuer = String(row.extract?.["issuer"] ?? "").trim();
    const tenantId = tenants[issuer] ?? tenants["*"];
    if (!tenantId) {
      skipped.push(`${row.source} — aucun tenant pour « ${issuer} »`);
      continue;
    }
    const base = row.source.split("/").pop() ?? row.source;
    const objectName = `${tenantId}/${base.replace(/[^A-Za-z0-9._-]/g, "_")}.jpg`;
    const bytes = readFileSync(row.raster);

    // Dépôt sans écrasement : le bucket est append-only côté politique.
    const up = await sb.storage.from("pieces").upload(objectName, bytes, {
      contentType: "image/jpeg",
      upsert: false,
    });
    const already = up.error && /exists|Duplicate|row-level security/i.test(up.error.message);
    if (up.error && !already) {
      skipped.push(`${base} — dépôt : ${up.error.message}`);
      continue;
    }

    const { data: pieceId, error: regErr } = await sb.rpc("capture_piece_register", {
      p_tenant: tenantId,
      p_source: "pdf",
      p_storage_path: objectName,
      p_idempotency_key: `kaggle:factures-pfe-tns:${base}`,
      p_vis: "partage",
      p_page_count: 1,
    });
    if (regErr || !pieceId) {
      skipped.push(`${base} — enregistrement : ${regErr?.message}`);
      continue;
    }
    pieces += 1;

    // R7 : une lecture déjà persistée ne se réécrit pas. On ne repasse que la
    // proposition d'écriture, qui est elle-même remplaçable tant qu'elle est
    // « proposee ».
    const { data: seen, error: seenErr } = await sb
      .from("extractions_v")
      .select("id")
      .eq("piece_id", pieceId as string)
      .limit(1);
    if (seenErr) {
      skipped.push(`${base} — état de lecture : ${seenErr.message}`);
      continue;
    }
    const persistErr = (seen ?? []).length > 0
      ? null
      : (await sb.rpc("capture_read_persist", {
      p_piece: pieceId as string,
      p_tokens: row.tokens as never,
      p_contract: row.contract as string,
      p_extract: row.extract as never,
      p_citations: row.citations as never,
      p_flags: row.flags as never,
        })).error;
    if (persistErr) {
      skipped.push(`${base} — lecture : ${persistErr.message}`);
      continue;
    }

    if (!row.valid) {
      skipped.push(`${base} — lecture partielle, aucune écriture proposée`);
      continue;
    }

    try {
      const proposal = buildProposal({
        pieceId: pieceId as string,
        payload: row.extract,
        taxRates,
        mappings,
        currency: "TND",
      });
      const { error: propErr } = await sb.rpc("socle_ecriture_propose", {
        p_piece: pieceId as string,
        p_journal: proposal.journal,
        p_date: proposal.extract.document_date,
        p_libelle: `${proposal.extract.document_kind === "facture_achat" ? "Facture achat" : "Facture vente"} — ${proposal.extract.issuer}`,
        p_pack_version: packId,
        p_lignes: proposal.lignes as never,
        p_devise: proposal.extract.currency,
      });
      if (propErr) skipped.push(`${base} — proposition : ${propErr.message}`);
      else ecritures += 1;
    } catch (e) {
      skipped.push(`${base} — Socle : ${e instanceof Error ? e.message : e}`);
    }
    console.log(`${base} → pièce ${String(pieceId).slice(0, 8)} · ${issuer}`);
  }

  console.log(`\npièces déposées : ${pieces}`);
  console.log(`écritures proposées : ${ecritures}`);
  if (skipped.length) {
    console.log(`\nécartées (${skipped.length}) :`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
}

main().catch((e) => {
  console.error("échec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
