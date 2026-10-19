/**
 * Fabriquer une recette POUR DE VRAI — épreuve manuelle, et payante.
 *
 * ================================================================= POURQUOI
 *
 * Le banc automatique du générateur branche un adaptateur simulé : aucune
 * épreuve de `npm test` n'appelle un fournisseur. Ce qu'un adaptateur simulé
 * ne dit pas, c'est si le modèle SAIT écrire une recette dans un langage
 * déclaratif qu'il découvre dans sa consigne. Cela se mesure, et cela se
 * mesure ici, à la main, en sachant ce qu'on dépense.
 *
 *   MALICA_API_URL=http://localhost:3000
 *   MALICA_EMAIL=...  MALICA_MOTDEPASSE=...
 *   DEEPSEEK_API_KEY=...
 *   FABRIQUE_TENANT=<uuid de l'organisation>
 *   FABRIQUE_SIGNATURE=<la clé de signature du format>
 *   FABRIQUE_INSCRIRE=1   (sinon : on propose, on affiche, on n'écrit rien)
 *
 *   node --experimental-strip-types tests/real/fabriquer-une-recette.ts
 *
 * ============================================================ CE QU'IL ÉCRIT
 *
 * La ligne de journal de la génération part DANS TOUS LES CAS, réussite ou
 * refus : un appel refusé a coûté autant qu'un appel retenu. L'inscription de
 * la candidate, elle, n'a lieu que sur `FABRIQUE_INSCRIRE=1` — on regarde
 * d'abord ce que le modèle a proposé.
 */
import { generateurDeepSeek } from "../../src/fabrique/generateur-modele.ts";
import { proposerUneRecette } from "../../src/fabrique/generateur.ts";
import type { ExigencesDeValidation } from "../../src/fabrique/recette-validateur.ts";
import type { ParametresDeSignature } from "../../src/fabrique/signature.ts";
import type { PageToken, TokenRef } from "../../src/malica/lecture/token-plan.ts";

import { ouvrirSession } from "./api.ts";

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`${nom} requis`);
  return valeur;
}

interface ExempleLu {
  exempleId: string;
  pieceId: string;
  attendu: { champs?: Record<string, TokenRef> };
  plan: PageToken[];
}

const api = await ouvrirSession();
const tenantId = exiger("FABRIQUE_TENANT");
const signatureCle = exiger("FABRIQUE_SIGNATURE");

const contexte = await api.rpc<{
  signature: ParametresDeSignature;
  bornes: ExigencesDeValidation;
}>("fabrique", "contexteDeDesignation", [tenantId]);

const exemples = await api.rpc<ExempleLu[]>("fabrique", "exemplesDApprentissage", [
  tenantId,
  signatureCle,
]);
console.log(`${String(exemples.length)} exemple(s) d'apprentissage pour « ${signatureCle} »`);

const generation = await proposerUneRecette(
  exemples.map((e) => ({
    pieceId: e.pieceId,
    plan: e.plan,
    attendu: e.attendu.champs ?? {},
  })),
  contexte.bornes,
  contexte.signature,
  generateurDeepSeek(exiger("DEEPSEEK_API_KEY")),
);

/*
 * Le journal part en premier, et sans condition. `agents_run_log` lève s'il
 * ne trouve pas de tarif pour le couple (modèle, rôle) : on laisse remonter.
 */
const journal = generation.ok
  ? {
      modele: generation.provenance.modele,
      role: generation.provenance.role,
      latenceMs: generation.provenance.latenceMs,
      tokensIn: generation.provenance.tokensIn,
      tokensOut: generation.provenance.tokensOut,
      statut: "ok",
    }
  : generation.journal === null
    ? null
    : {
        modele: generation.journal.modele,
        role: generation.journal.role,
        latenceMs: generation.journal.latenceMs,
        tokensIn: generation.journal.tokensIn,
        tokensOut: generation.journal.tokensOut,
        statut: "refus",
      };

let runId: string | null = null;
if (journal) {
  runId = await api.rpc<string | null>("fabrique", "journaliserUneGeneration", [
    { tenantId, ...journal, erreur: generation.ok ? null : generation.refus.code },
  ]);
  console.log(`journal : ${String(runId)} — ${journal.modele} / ${journal.role}`);
}

if (!generation.ok) {
  console.error(`REFUSÉ — ${generation.refus.code}`);
  console.error(generation.refus.detail);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(generation.recette, null, 2));
  console.log(`empreinte : ${generation.empreinte}`);
  console.log(`ossature  : ${generation.provenance.ossature.join(", ")}`);

  if (process.env["FABRIQUE_INSCRIRE"] === "1") {
    const version = await api.rpc<{ versionId: string; rang: number }>(
      "fabrique",
      "inscrireUneCandidate",
      [
        {
          tenantId,
          libelle: signatureCle,
          signatureCle,
          portee: "organisation",
          definition: generation.recette,
          empreinte: generation.empreinte,
          provenance: { ...generation.provenance, agentRunId: runId },
          exemples: exemples.map((e) => e.exempleId),
          motif: "proposée par le générateur, épreuve manuelle",
        },
      ],
    );
    console.log(`candidate inscrite : ${version.versionId} (rang ${String(version.rang)})`);
  } else {
    console.log("rien inscrit — posez FABRIQUE_INSCRIRE=1 pour écrire la candidate");
  }
}
