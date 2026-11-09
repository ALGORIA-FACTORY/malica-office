/**
 * Malica, servie par l'API — le second adaptateur écrit à la main.
 *
 * Le mandataire générique parle à `/rpc`, et `/rpc` s'exécute dans une
 * transaction que la base coupe après dix secondes d'inactivité. Or tout ce
 * que fait Malica — lire une pièce, répondre, rédiger — fait parler un
 * modèle pendant des secondes ou des minutes. L'API lui réserve donc ses
 * propres routes, sous `/malica`, et cet adaptateur les appelle.
 *
 * Comme pour la capture, une seule fabrique d'appel : `appelerRoute` reprend
 * le protocole du mandataire (session, erreurs lisibles) sans le recopier.
 */
import type { Locale } from "@malica/socle/messages";
import type {
  Briefing,
  EtatDeLecture,
  LectureDeCarte,
  LectureDePiece,
  QuestionAMalica,
  MalicaPort,
  ReponseAuCabinet,
  ReponseDeMalica,
  ResultatRedaction,
} from "@malica/socle/ports/malica";
import type { SuiviDeTrace } from "@malica/socle/ports/repositories";
import {
  decouperLeFlux,
  type EvenementDeLAssistant,
  type FinDeLaReponse,
  type QuestionALAssistant,
} from "@malica/socle/ports/assistant";

import { entetesDuSuivi, suiviDesArguments } from "@/lib/parcours/traces";
import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";

/**
 * Un appel à une route de Malica. Le corps est un JSON, ou des octets tels
 * quels — la carte fiscale voyage ainsi, parce qu'une image de plusieurs
 * mégaoctets n'a pas sa place dans un JSON.
 */
async function appelerRoute<T>(
  chemin: string,
  init: {
    method?: "GET" | "POST";
    corps?: unknown;
    octets?: Blob;
    /** La lecture d'une pièce : elle porte la trace née à sa capture, si l'appareil la connaît. */
    suivi?: SuiviDeTrace | null;
  } = {},
): Promise<T> {
  const reponse = await transport().appeler(`/malica${chemin}`, {
    method: init.method ?? "POST",
    ...(init.octets
      ? { headers: init.octets.type ? { "Content-Type": init.octets.type } : {}, body: init.octets }
      : init.corps !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.corps) }
        : { headers: entetesDuSuivi(init.suivi) }),
  });
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
    // Le message est un code que l'écran sait traduire (« lecture.illisible »),
    // ou un refus rédigé pour la personne : dans les deux cas, on le rend.
    throw new ErreurApi(corps?.erreur ?? `malica ${chemin} : ${reponse.status}`, reponse.status);
  }
  return (await reponse.json()) as T;
}

export function creerMalicaHttp(): MalicaPort {
  return {
    lirePiece(pieceId: string): Promise<LectureDePiece> {
      return appelerRoute(`/lectures/${pieceId}`, { suivi: suiviDesArguments([pieceId]) });
    },

    etatDeLecture(pieceId: string): Promise<EtatDeLecture> {
      return appelerRoute(`/lectures/${pieceId}`, {
        method: "GET",
        suivi: suiviDesArguments([pieceId]),
      });
    },

    async demanderLaLecture(
      pieceId: string,
      suivi?: SuiviDeTrace | null,
    ): Promise<{ travailId: string; deja: boolean }> {
      const { travailId, deja } = await appelerRoute<{
        enCours: boolean;
        travailId: string;
        deja: boolean;
      }>(`/lectures/${pieceId}?attendre=0`, { suivi: suivi ?? suiviDesArguments([pieceId]) });
      return { travailId, deja };
    },

    lireCarte(input: { jurisdiction: string; fichier: Blob }): Promise<LectureDeCarte> {
      return appelerRoute(`/carte?jurisdiction=${encodeURIComponent(input.jurisdiction)}`, {
        octets: input.fichier,
      });
    },

    /*
     * « Parler à Malica », en flux. La réponse est un `text/event-stream` :
     * on lit le corps morceau par morceau, et chaque événement complet part à
     * l'écran aussitôt — c'est ce qui affiche le premier mot avant la fin.
     */
    async converser(
      question: QuestionALAssistant,
      surEvenement: (ev: EvenementDeLAssistant) => void,
      signal?: AbortSignal,
    ): Promise<FinDeLaReponse> {
      const reponse = await transport().appeler("/malica/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(question),
        ...(signal ? { signal } : {}),
      });
      if (!reponse.ok || !reponse.body) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        throw new ErreurApi(
          corps?.erreur ?? `malica /assistant : ${reponse.status}`,
          reponse.status,
        );
      }
      const lecteur = reponse.body.getReader();
      const decodeur = new TextDecoder();
      let tampon = "";
      let fin: FinDeLaReponse | null = null;
      let erreur: string | null = null;
      for (;;) {
        const { value, done } = await lecteur.read();
        if (value) tampon += decodeur.decode(value, { stream: true });
        const lu = decouperLeFlux(done ? `${tampon}\n\n` : tampon);
        tampon = lu.reste;
        for (const ev of lu.evenements) {
          if (ev.type === "fin") fin = ev.fin;
          if (ev.type === "erreur") erreur = ev.erreur;
          surEvenement(ev);
        }
        if (done) break;
      }
      if (fin) return fin;
      throw new ErreurApi(erreur ?? "assistant.indisponible", 502);
    },

    demander(question: QuestionAMalica): Promise<ReponseDeMalica> {
      return appelerRoute("/demander", { corps: question });
    },

    repondreAuCabinet(input: {
      tenantId: string;
      question: string;
      locale: Locale;
    }): Promise<ReponseAuCabinet> {
      return appelerRoute("/conseil", { corps: input });
    },

    redigerLePv(input: { pvId: string; locale: Locale }): Promise<ResultatRedaction> {
      return appelerRoute("/pv", { corps: input });
    },

    redigerLeBriefing(input: {
      cabinetId: string;
      clientId: string;
      collaborateur: string;
      langue: string;
    }): Promise<Briefing> {
      return appelerRoute("/briefing", { corps: input });
    },
  };
}
