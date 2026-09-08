/**
 * Passe 1 de l'ingestion Kaggle : lecture citée locale.
 *
 * Aucune écriture en base ici. On rasterise déjà en amont ; ce script appelle
 * exactement le même œil (`runVisionRead`) et le même filtre
 * (`buildExtractFromTokenPlan`) que le flux de production, puis sérialise le
 * résultat. Aucun montant n'est produit ici : tout vient du plan de tokens.
 *
 * Usage : bun apps/api/tests/real/ingest-read.ts <selection.tsv> <sortie.json>
 */

import { readFileSync, writeFileSync } from "node:fs";

import { buildExtractFromTokenPlan } from "../../src/malica/lecture/read-piece.ts";
import { runVisionRead } from "../../src/malica/lecture/vision.ts";

interface TaxCode {
  code: string;
  label: string;
  rate: string;
}

function loadTaxCodes(path: string): TaxCode[] {
  return JSON.parse(readFileSync(path, "utf8")) as TaxCode[];
}

async function main() {
  const [tsvPath, outPath, taxPath] = process.argv.slice(2);
  if (!tsvPath || !outPath || !taxPath)
    throw new Error(
      "usage: bun apps/api/tests/real/ingest-read.ts <tsv> <out.json> <taxcodes.json>",
    );

  const taxCodes = loadTaxCodes(taxPath);
  console.log(`codes de taux du pack : ${taxCodes.map((t) => t.code).join(", ")}`);

  const rows = readFileSync(tsvPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string, string]);

  const results: unknown[] = [];
  let ok = 0;
  for (const [source, raster, family] of rows) {
    const started = Date.now();
    try {
      const bytes = readFileSync(raster);
      const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
      const read = await runVisionRead({ dataUrl, taxCodes });
      const built = buildExtractFromTokenPlan({
        tokens: read.tokens,
        selection: read.selection,
        decimals: 3,
      });
      const extract = built.extract as Record<string, unknown>;
      const orphans = built.citations.filter(
        (c) => !read.tokens.some((t) => t.page === c.page && t.ordinal === c.ordinal),
      ).length;
      results.push({
        source,
        raster,
        family,
        tokens: read.tokens,
        contract: built.contract,
        extract,
        citations: built.citations,
        flags: built.flags,
        valid: built.valid,
        model: read.model,
        latencyMs: read.latencyMs,
        tokensIn: read.tokensIn,
        tokensOut: read.tokensOut,
        orphans,
      });
      ok += 1;
      console.log(
        `${raster} — ${read.tokens.length} tokens, ${built.citations.length} citations, ` +
          `orphelines ${orphans}, valide=${built.valid}, émetteur="${String(extract["issuer"] ?? "")}", ` +
          `${Date.now() - started} ms`,
      );
    } catch (e) {
      console.log(`${raster} — ÉCHEC : ${e instanceof Error ? e.message : e}`);
      results.push({ source, raster, family, error: String(e) });
    }
  }
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n${ok}/${rows.length} pièces lues — ${outPath}`);
}

main().catch((e) => {
  console.error("échec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
