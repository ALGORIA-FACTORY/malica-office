/**
 * Regalica, servie par l'API — le second adaptateur écrit à la main.
 *
 * Le mandataire générique parle à `/rpc`, et `/rpc` s'exécute dans une
 * transaction que la base coupe après dix secondes d'inactivité. Or tout ce
 * que fait Regalica — lire une pièce, répondre, rédiger — fait parler un
 * modèle pendant des secondes ou des minutes. L'API lui réserve donc ses
 * propres routes, sous `/regalica`, et cet adaptateur les appelle.
 *
 * Comme pour la capture, une seule fabrique d'appel : `appelerRoute` reprend
 * le protocole du mandataire (session, erreurs lisibles) sans le recopier.
 */
import type { Locale } from "@regalica/socle/messages";
import type {
  Briefing,
  EtatDeLecture,
  LectureDeCarte,
  LectureDePiece,
  QuestionARegalica,
  RegalicaPort,
  ReponseAuCabinet,
  ReponseDeRegalica,
  ResultatRedaction,
} from "@regalica/socle/ports/regalica";

import { baseApi, ErreurApi } from "./rpc";

/**
 * Un appel à une route de Regalica. Le corps est un JSON, ou des octets tels
 * quels — la carte fiscale voyage ainsi, parce qu'une image de plusieurs
 * mégaoctets n'a pas sa place dans un JSON.
 */
async function appelerRoute<T>(
  chemin: string,
  init: { method?: "GET" | "POST"; corps?: unknown; octets?: Blob } = {},
): Promise<T> {
  const reponse = await fetch(`${baseApi()}/regalica${chemin}`, {
    method: init.method ?? "POST",
    credentials: "include",
    ...(init.octets
      ? { headers: init.octets.type ? { "Content-Type": init.octets.type } : {}, body: init.octets }
      : init.corps !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.corps) }
        : {}),
  });
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
    // Le message est un code que l'écran sait traduire (« lecture.illisible »),
    // ou un refus rédigé pour la personne : dans les deux cas, on le rend.
    throw new ErreurApi(corps?.erreur ?? `regalica ${chemin} : ${reponse.status}`, reponse.status);
  }
  return (await reponse.json()) as T;
}

export function creerRegalicaHttp(): RegalicaPort {
  return {
    lirePiece(pieceId: string): Promise<LectureDePiece> {
      return appelerRoute(`/lectures/${pieceId}`);
    },

    etatDeLecture(pieceId: string): Promise<EtatDeLecture> {
      return appelerRoute(`/lectures/${pieceId}`, { method: "GET" });
    },

    lireCarte(input: { jurisdiction: string; fichier: Blob }): Promise<LectureDeCarte> {
      return appelerRoute(`/carte?jurisdiction=${encodeURIComponent(input.jurisdiction)}`, {
        octets: input.fichier,
      });
    },

    demander(question: QuestionARegalica): Promise<ReponseDeRegalica> {
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
