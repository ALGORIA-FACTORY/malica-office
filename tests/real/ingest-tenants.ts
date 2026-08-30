/**
 * Ouvre les PME correspondant aux documents lus.
 *
 * Le nom de l'organisation vient d'une valeur relue dans le plan de tokens
 * (l'émetteur cité), jamais d'une invention. Une PME par entreprise émettrice
 * de ses ventes ; ses achats rejoignent les mêmes livres.
 *
 * Usage : bun tests/real/ingest-tenants.ts <reads.json> <session.json> <tenants.json>
 */

import { readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

interface ReadRow {
  family: string;
  extract?: Record<string, unknown>;
  error?: string;
}

/** Regroupe les variantes de lecture d'un même nom (« REAM OPTI » ⊂ « DREAM OPTIC »). */
function canonical(names: string[]): Map<string, string> {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  const map = new Map<string, string>();
  for (const n of sorted) {
    const key = n.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const host = sorted.find((c) => {
      const ck = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return ck.length >= key.length && (ck.includes(key) || key.includes(ck)) && c !== n;
    });
    map.set(n, host ? (map.get(host) ?? host) : n);
  }
  return map;
}

async function main() {
  const [readsPath, sessionPath, outPath] = process.argv.slice(2);
  if (!readsPath || !sessionPath || !outPath)
    throw new Error("usage: bun tests/real/ingest-tenants.ts <reads.json> <session.json> <tenants.json>");

  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const anon =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY requis");
  const session = JSON.parse(readFileSync(sessionPath, "utf8")) as { access_token?: string };
  if (!session.access_token) throw new Error("session sans access_token");

  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  const reads = (JSON.parse(readFileSync(readsPath, "utf8")) as ReadRow[]).filter((r) => !r.error);

  // Une PME s'identifie par l'émetteur de ses ventes : c'est elle qui facture.
  const sellers = reads
    .filter((r) => r.family === "vente")
    .map((r) => String(r.extract?.["issuer"] ?? "").trim())
    .filter(Boolean);
  const canon = canonical(sellers);
  const pmeNames = [...new Set([...canon.values()])];
  if (pmeNames.length === 0) throw new Error("aucun émetteur de vente lu : aucune PME à ouvrir");

  const { data: existing, error: exErr } = await sb.from("organizations_v").select("id, name, kind");
  if (exErr) throw new Error(exErr.message);

  const tenants: Record<string, string> = {};
  const ids: string[] = [];
  for (const name of pmeNames) {
    const found = (existing ?? []).find(
      (o) => (o.name as string).toLowerCase() === name.toLowerCase() && o.kind === "pme",
    );
    let id = found?.id as string | undefined;
    if (!id) {
      const { data, error } = await sb.rpc("create_organization", {
        p_kind: "pme",
        p_name: name,
        p_validation_mode: "mandate",
        p_jurisdiction: "TN",
        p_currency: "TND",
      });
      if (error) throw new Error(`${name} : ${error.message}`);
      id = data as unknown as string;
      console.log(`PME ouverte : ${name} → ${id}`);
    } else {
      console.log(`PME existante : ${name} → ${id}`);
    }
    ids.push(id!);
    tenants[name] = id!;
  }

  // Variantes de lecture du même émetteur → même tenant.
  for (const [raw, host] of canon) tenants[raw] = tenants[host]!;
  // Les achats appartiennent aux livres de la PME lectrice (une seule ici).
  if (ids.length === 1) tenants["*"] = ids[0]!;

  writeFileSync(outPath, JSON.stringify(tenants, null, 2));
  console.log(`\n${pmeNames.length} PME · ${Object.keys(tenants).length} clés → ${outPath}`);
}

main().catch((e) => {
  console.error("échec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
