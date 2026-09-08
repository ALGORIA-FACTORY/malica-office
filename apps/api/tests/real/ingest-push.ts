/**
 * Passe 2 de l'ingestion Kaggle : dépôt réel en base.
 *
 * Pour chaque pièce lue en passe 1 :
 *   1. enregistrement de la pièce (clé d'idempotence = nom du document source) ;
 *   2. dépôt des octets sur `/pieces/:id/contenu` — l'ordre est imposé par le
 *      chemin, qui contient l'identifiant de la pièce ;
 *   3. `persisterLecture` (tokens, extract, citations, drapeaux) — la RPC refuse
 *      toute citation orpheline, c'est le mur R2 ;
 *   4. proposition d'écriture par le Socle (`buildProposal`) puis `office.propose`.
 *
 * Le script s'exécute avec une vraie session utilisateur : la RLS s'applique,
 * l'audit porte un auteur. Aucun montant n'est calculé ici.
 *
 * Usage : node apps/api/tests/real/ingest-push.ts <reads.json> <tenants.json>
 */

import { readFileSync } from "node:fs";

import { buildProposal } from "@malica/socle/use-cases/propose-ecriture";
import type { AccountMapping, TaxRate } from "@malica/socle/ports/repositories";

import { ouvrirSession } from "./api.ts";

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

async function main() {
  const [readsPath, tenantsPath] = process.argv.slice(2);
  if (!readsPath || !tenantsPath)
    throw new Error("usage: node apps/api/tests/real/ingest-push.ts <reads.json> <tenants.json>");

  const api = await ouvrirSession();

  const reads = (JSON.parse(readFileSync(readsPath, "utf8")) as ReadRow[]).filter((r) => !r.error);
  const tenants = JSON.parse(readFileSync(tenantsPath, "utf8")) as Record<string, string>;

  // Référentiel : pack en vigueur, taux et imputations. Rien en dur.
  // Le dépôt `referentiel` rend déjà la forme attendue par le Socle : les
  // transformations que ce script refaisait à la main vivent maintenant à un
  // seul endroit.
  const pack = await api.rpc<{ id: string } | null>("referentiel", "activePack", ["TN"]);
  if (!pack) throw new Error("aucun pack en vigueur pour la Tunisie");
  const packId = pack.id;

  const taxRates = await api.rpc<TaxRate[]>("referentiel", "taxRates", [packId, "TN"]);
  const mappings = await api.rpc<AccountMapping[]>("referentiel", "accountMappings", [packId]);

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
    const bytes = readFileSync(row.raster);

    // La ligne d'abord, les octets ensuite : le chemin contient l'identifiant.
    // Le nom du fichier source ne sert plus qu'à la clé d'idempotence — il ne
    // compose plus de chemin, donc il n'y a plus rien à assainir.
    let pieceId: string;
    try {
      const enregistree = await api.rpc<{ id: string }>("capture", "enregistrer", [
        {
          tenantId,
          source: "pdf",
          vis: "partage",
          idempotencyKey: `kaggle:factures-pfe-tns:${base}`,
          contentType: "image/jpeg",
          pageCount: 1,
        },
      ]);
      pieceId = enregistree.id;
      await api.deposer(pieceId, bytes, "image/jpeg");
    } catch (erreur) {
      skipped.push(`${base} — enregistrement : ${(erreur as Error).message}`);
      continue;
    }
    pieces += 1;

    // R7 : une lecture déjà persistée ne se réécrit pas. On ne repasse que la
    // proposition d'écriture, qui est elle-même remplaçable tant qu'elle est
    // « proposee ».
    try {
      const dossier = await api.rpc<{ extraction: unknown }>("capture", "dossier", [pieceId]);
      if (!dossier.extraction) {
        await api.rpc<void>("capture", "persisterLecture", [
          {
            pieceId,
            packId,
            tokens: row.tokens,
            contract: row.contract,
            extract: row.extract,
            citations: row.citations,
            flags: row.flags,
            // Ce script ne projette pas les articles : la passe 1 n'en produit
            // pas, et en inventer une liste vide ferait écrire une projection
            // que personne n'a lue.
            articles: [],
            documentKind: null,
            documentDate: null,
          },
        ]);
      }
    } catch (erreur) {
      skipped.push(`${base} — lecture : ${(erreur as Error).message}`);
      continue;
    }

    if (!row.valid) {
      skipped.push(`${base} — lecture partielle, aucune écriture proposée`);
      continue;
    }

    try {
      const proposal = buildProposal({
        pieceId,
        payload: row.extract,
        taxRates,
        mappings,
        currency: "TND",
      });
      try {
        await api.rpc<string>("office", "propose", [
          {
            pieceId,
            journal: proposal.journal,
            date: proposal.extract.document_date,
            libelle: `${proposal.extract.document_kind === "facture_achat" ? "Facture achat" : "Facture vente"} — ${proposal.extract.issuer}`,
            packVersionId: packId,
            lignes: proposal.lignes,
            devise: proposal.extract.currency,
          },
        ]);
        ecritures += 1;
      } catch (erreur) {
        // Deux motifs distincts, deux messages : le Socle qui refuse de
        // proposer n'est pas la base qui refuse d'écrire.
        skipped.push(`${base} — proposition : ${(erreur as Error).message}`);
      }
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
