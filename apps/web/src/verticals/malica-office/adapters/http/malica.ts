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

import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";

/**
 * Un appel à une route de Malica. Le corps est un JSON, ou des octets tels
 * quels — la carte fiscale voyage ainsi, parce qu'une image de plusieurs
 * mégaoctets n'a pas sa place dans un JSON.
 */
async function appelerRoute<T>(
  chemin: string,
  init: { method?: "GET" | "POST"; corps?: unknown; octets?: Blob } = {},
): Promise<T> {
  const reponse = await transport().appeler(`/malica${chemin}`, {
    method: init.method ?? "POST",
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
    throw new ErreurApi(corps?.erreur ?? `malica ${chemin} : ${reponse.status}`, reponse.status);
  }
  return (await reponse.json()) as T;
}

export function creerMalicaHttp(): MalicaPort {
  return {
    lirePiece(pieceId: string): Promise<LectureDePiece> {
      return appelerRoute(`/lectures/${pieceId}`);
    },

    etatDeLecture(pieceId: string): Promise<EtatDeLecture> {
      return appelerRoute(`/lectures/${pieceId}`, { method: "GET" });
    },

    async demanderLaLecture(pieceId: string): Promise<{ travailId: string; deja: boolean }> {
      const { travailId, deja } = await appelerRoute<{
        enCours: boolean;
        travailId: string;
        deja: boolean;
      }>(`/lectures/${pieceId}?attendre=0`);
      return { travailId, deja };
    },

    lireCarte(input: { jurisdiction: string; fichier: Blob }): Promise<LectureDeCarte> {
      return appelerRoute(`/carte?jurisdiction=${encodeURIComponent(input.jurisdiction)}`, {
        octets: input.fichier,
      });
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
