/**
 * « Demander l'avis de ma comptabilité » — le geste de la personne, sous une
 * réponse de Malica (décision du dirigeant, 11 novembre 2026, point M-6).
 *
 * La personne a lu la réponse ; elle veut que sa comptabilité la confirme, la
 * corrige ou l'écarte. Le chemin est la file de relecture qui existe déjà :
 * la dernière question du fil et sa réponse y entrent comme une réponse déjà
 * donnée (`repondue`), par le canal « avis ».
 *
 * Le serveur relit le fil lui-même : le navigateur ne dit que « ce fil », il
 * n'envoie ni la question ni la réponse. Et la demande ne se pose qu'une
 * fois : si la réponse est déjà chez la comptabilité — Malica l'y a envoyée,
 * ou le bouton a déjà servi —, la base rend la ligne qui existe (`deja`).
 *
 * Aucun appel de modèle, aucun réseau : deux lectures et une porte.
 */
import { texte as message } from "@malica/socle/conseil";
import type { AvisDemande } from "@malica/socle/ports/malica";
import type { MessageDuFil, SourceCitee } from "@malica/socle/ports/repositories";

import type { AppelApi } from "../appel-local.ts";

/** La dernière question du fil qui a reçu une réponse, et cette réponse. */
export function dernierEchange(
  fil: ReadonlyArray<Pick<MessageDuFil, "role" | "contenu" | "sources">>,
): { question: string; reponse: string; sources: MessageDuFil["sources"] } | null {
  for (let i = fil.length - 1; i > 0; i -= 1) {
    const reponse = fil[i]!;
    const question = fil[i - 1]!;
    if (reponse.role !== "assistant" || question.role !== "user") continue;
    if (!reponse.contenu.trim() || !question.contenu.trim()) continue;
    return { question: question.contenu, reponse: reponse.contenu, sources: reponse.sources };
  }
  return null;
}

/** Les articles que la réponse citait, sous la forme que la file range. */
function articlesDe(sources: MessageDuFil["sources"]): SourceCitee[] {
  const vus = new Set<string>();
  const articles: SourceCitee[] = [];
  for (const s of sources ?? []) {
    if (s.genre !== "article" || !s.article?.numero) continue;
    const cle = `${s.article.corpus}|${s.article.numero}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    articles.push({
      corpus: s.article.corpus,
      numero: s.article.numero,
      validFrom: s.article.validFrom,
      validTo: null,
      langue: null,
    });
  }
  return articles;
}

export async function demanderLAvis(
  api: AppelApi,
  input: { tenantId: string; conversationId: string; locale: string },
): Promise<AvisDemande> {
  const contexte = await api.rpc<{ cabinetId: string | null }>("conseil", "contexte", [
    input.tenantId,
  ]);
  if (!contexte.cabinetId) return { etat: "sans_comptabilite" };

  const fil = await api.rpc<MessageDuFil[]>("conversations", "ouvrir", [input.conversationId]);
  const echange = dernierEchange(fil);
  if (!echange) return { etat: "sans_reponse" };

  const pose = await api.rpc<{ id: string; deja?: boolean }>("conseil", "creer", [
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      question: echange.question,
      reponse: echange.reponse,
      sources: articlesDe(echange.sources),
      // La personne demande une confirmation : la réponse n'arrive pas comme
      // certaine, et le doute dit à la comptabilité pourquoi elle la reçoit.
      certitude: 0,
      doute: message(input.locale, "pme.conseil.douteAvisDemande"),
      canal: "avis",
      theme: null,
      langue: input.locale,
      statut: "repondue",
    },
  ]);
  return { etat: "envoye", deja: pose.deja === true };
}
