/**
 * Le repli de « Parler à Malica » : DeepSeek, par l'ancienne conversation
 * (`askMalica`), quand Claude ne peut pas répondre — son budget commun (#274)
 * ou le plafond propre de l'assistant atteint, sa clé absente, une panne avant
 * le premier mot.
 *
 * ============================================================ CE QUI EST RANGÉ
 *
 * DeepSeek ne cite pas en flux : sa réponse entière passe la garde des
 * chiffres (`garde.ts`) contre ce qu'il avait sous les yeux — le dossier, le
 * paramétrage, les passages du droit. La garde est appliquée AVANT que
 * `askMalica` range l'échange (`garder`) : le fil garde la version contrôlée,
 * celle que l'écran a montrée, jamais la réponse brute. Une phrase chiffrée
 * retirée à l'écran ne revient pas quand le fil est rouvert.
 */

import type { AppelApi } from "../appel-local.ts";
import { askMalica, type CeQueLeModeleAvaitSousLesYeux } from "../conseil/ask.ts";
import type { DependancesDeLAssistant } from "./agent.ts";
import type { SourceConnue } from "./garde.ts";

/** Ce que DeepSeek avait sous les yeux, en sources que la garde sait relire. */
function sourcesDuRepli(vus: CeQueLeModeleAvaitSousLesYeux): SourceConnue[] {
  const sources: SourceConnue[] = [
    {
      cle: "malica:dossier",
      genre: "liste",
      titre: "Dossier",
      objetId: null,
      texte: JSON.stringify(vus.dossier),
    },
  ];
  if (vus.parametrage.trim()) {
    sources.push({
      cle: "malica:parametrage",
      genre: "parametre",
      titre: "Paramétrage fiscal",
      objetId: null,
      texte: vus.parametrage,
    });
  }
  for (const f of vus.fragments) {
    sources.push({
      cle: `malica:article:${f.corpus}:${f.numero}:${f.ordinal}`,
      genre: "article",
      titre: `${f.corpus} ${f.numero}`,
      objetId: null,
      texte: `${f.corpus} ${f.numero}\n${f.extrait}`,
    });
  }
  for (const s of vus.sources) {
    sources.push({
      cle: `malica:article:${s.corpus}:${s.numero}`,
      genre: "article",
      titre: `${s.corpus} ${s.numero}`,
      objetId: null,
      texte: `${s.corpus} ${s.numero}`,
    });
  }
  return sources;
}

/**
 * Le repli branché sur `askMalica`. `demander` est injectable : l'épreuve le
 * remplace sans réseau.
 */
export function repliParDeepSeek(
  appel: AppelApi,
  dossier: { tenantId: string; locale: string },
  demander: typeof askMalica = askMalica,
): DependancesDeLAssistant["repli"] {
  return async ({ question, conversationId, garder }) => {
    const r = await demander(appel, {
      tenantId: dossier.tenantId,
      question,
      locale: dossier.locale,
      mode: "chat",
      conversationId,
      garder: (reponse, vus) => garder(reponse, sourcesDuRepli(vus)),
    });
    return {
      answer: r.answer,
      model: r.model,
      conversationId: r.conversationId,
      messageId: r.messageId,
      titre: r.titre,
      retenue: r.retenue,
    };
  };
}
