/**
 * Épreuve réelle du lecteur cité sur des documents arabes.
 *
 * Jeu : humansintheloop/arabic-documents-ocr-dataset (Kaggle), annotations
 * Supervisely avec transcriptions humaines. On mesure le rappel du plan de
 * tokens contre la vérité terrain — aucune valeur du modèle n'est acceptée
 * telle quelle, chaque token est relu par le filtre.
 *
 * Usage : bun apps/api/tests/real/arabic-ocr.ts <image> <annotation.json>
 */

import { readFileSync } from "node:fs";

import { buildExtractFromTokenPlan } from "../../src/malica/lecture/read-piece.ts";
import { runVisionRead } from "../../src/malica/lecture/vision.ts";

interface GtTag {
  name: string;
  value: string | null;
}
interface GtObject {
  classTitle: string;
  tags: GtTag[];
  points: { exterior: number[][] };
}

function normalizeArabic(s: string): string {
  return s
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .trim();
}

async function main() {
  const [imagePath, annPath] = process.argv.slice(2);
  if (!imagePath || !annPath)
    throw new Error("usage: bun apps/api/tests/real/arabic-ocr.ts <image> <ann.json>");

  const bytes = readFileSync(imagePath);
  const mime = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

  const ann = JSON.parse(readFileSync(annPath, "utf8")) as {
    size: { width: number; height: number };
    objects: GtObject[];
  };
  const gt = ann.objects
    .flatMap((o) =>
      o.tags
        .filter((t) => t.name === "Transcription" && typeof t.value === "string" && t.value.trim())
        .map((t) => ({
          text: t.value as string,
          points: o.points.exterior,
          classTitle: o.classTitle,
        })),
    )
    .filter((g) => g.points.length >= 2);

  console.log(`document ${imagePath}`);
  console.log(`vérité terrain : ${gt.length} zones transcrites`);

  const started = Date.now();
  const read = await runVisionRead({
    dataUrl,
    // Codes de taux tunisiens en vigueur — fournis par le pack, jamais devinés.
    taxCodes: [
      { code: "TVA_19", label: "TVA 19 %", rate: "0.19" },
      { code: "TVA_13", label: "TVA 13 %", rate: "0.13" },
      { code: "TVA_7", label: "TVA 7 %", rate: "0.07" },
      { code: "TVA_0", label: "Exonéré", rate: "0" },
    ],
  });
  console.log(
    `plan de tokens : ${read.tokens.length} tokens — ${read.model}, ${read.latencyMs} ms, ` +
      `in ${read.tokensIn ?? "?"} / out ${read.tokensOut ?? "?"}`,
  );

  // Rappel : chaque transcription humaine est-elle retrouvée dans le plan ?
  const planText = normalizeArabic(read.tokens.map((t) => t.text).join(" "));
  let found = 0;
  const missing: string[] = [];
  for (const g of gt) {
    const needle = normalizeArabic(g.text);
    if (needle.length === 0) continue;
    if (planText.includes(needle)) found += 1;
    else missing.push(g.text);
  }
  const recall = gt.length ? (found / gt.length) * 100 : 0;
  console.log(`rappel des zones transcrites : ${found}/${gt.length} (${recall.toFixed(1)} %)`);
  if (missing.length)
    console.log(`non retrouvées (${missing.length}) : ${missing.slice(0, 10).join(" | ")}`);

  // Localisation : le token retrouvé tombe-t-il dans la boîte de la vérité terrain ?
  const { width: W, height: H } = ann.size;
  let inBox = 0;
  let checked = 0;
  for (const g of gt.slice(0, 40)) {
    const needle = normalizeArabic(g.text);
    const tok = read.tokens.find(
      (t) => needle.includes(normalizeArabic(t.text)) && t.text.trim().length > 1,
    );
    if (!tok) continue;
    checked += 1;
    const xs = g.points.map((p) => p[0]!);
    const ys = g.points.map((p) => p[1]!);
    const gx0 = Math.min(...xs) / W - 0.05;
    const gx1 = Math.max(...xs) / W + 0.05;
    const gy0 = Math.min(...ys) / H - 0.05;
    const gy1 = Math.max(...ys) / H + 0.05;
    const cx = (tok.x0 + tok.x1) / 2;
    const cy = (tok.y0 + tok.y1) / 2;
    if (cx >= gx0 && cx <= gx1 && cy >= gy0 && cy <= gy1) inBox += 1;
  }
  console.log(`boîtes cohérentes : ${inBox}/${checked}`);

  // Le filtre : aucune valeur hors plan de tokens.
  const built = buildExtractFromTokenPlan({
    tokens: read.tokens,
    selection: read.selection,
    decimals: 3,
  });
  console.log(
    `contrat ${built.contract} — valide=${built.valid}, citations=${built.citations.length}, drapeaux=${built.flags.length}`,
  );
  for (const f of built.flags.slice(0, 12))
    console.log(`  drapeau ${f.field} : ${f.code}${f.detail ? ` (${f.detail})` : ""}`);
  const tokenTexts = new Set(read.tokens.map((t) => t.text));
  const orphans = built.citations.filter((c) => !read.tokens.some((t) => t.page === c.page));
  console.log(
    `citations orphelines : ${orphans.length} (attendu 0) — tokens distincts ${tokenTexts.size}`,
  );
  console.log(`durée totale ${Date.now() - started} ms`);
}

main().catch((e) => {
  console.error("échec :", e instanceof Error ? e.message : e);
  process.exit(1);
});
