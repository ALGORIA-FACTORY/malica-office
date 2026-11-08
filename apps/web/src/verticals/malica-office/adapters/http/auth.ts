/**
 * L'authentification servie par l'API.
 *
 * Dans un navigateur, la session voyage dans un cookie `httpOnly` posé par
 * l'API : aucun jeton n'est lisible par un script de la page, donc aucun n'est
 * volable par une injection. Rien à stocker ici.
 *
 * Dans la coque, il n'y a pas de cookie qui tienne : la session est un jeton
 * porteur, et un jeton long la fait revivre au démarrage. Le transport en a
 * la garde ; cet adaptateur lui confie ce que la connexion rend, et lui
 * demande de reprendre la session avant d'aller la vérifier.
 */

import { EchecAuth, type AuthPort, type Compte } from "@malica/socle/ports/auth";
import { transport } from "@/lib/transport";
import { ErreurReseau } from "@/lib/transport/erreurs";
import { ecouterLaDeconnexion } from "@/lib/transport/etat";

async function appeler(
  chemin: string,
  options: { methode: "GET" | "POST"; corps?: unknown },
): Promise<Response> {
  try {
    return await transport().appeler(chemin, {
      method: options.methode,
      headers: options.corps ? { "Content-Type": "application/json" } : {},
      ...(options.corps ? { body: JSON.stringify(options.corps) } : {}),
    });
  } catch (erreur) {
    // Le transport ne rejette que sur un échec réseau ou une version dépassée :
    // ni l'un ni l'autre n'est un refus d'authentification.
    if (erreur instanceof ErreurReseau) {
      throw new EchecAuth("reseau", "service d'authentification injoignable");
    }
    throw erreur;
  }
}

interface SessionOuverte {
  utilisateur: Compte;
  jeton: string;
  jetonRafraichissement?: string;
}

async function retenir(reponse: Response): Promise<Compte> {
  const session = (await reponse.json()) as SessionOuverte;
  await transport().retenirLaSession(session.jeton, session.jetonRafraichissement);
  connaitre(session.utilisateur);
  return session.utilisateur;
}

/*
 * ===================================== LA SESSION, CONNUE UNE FOIS
 *
 * 8 novembre 2026, mesuré sur l'application de la coque (latence 150 ms,
 * processeur ×4) : CHAQUE changement d'écran commençait par `GET
 * /auth/session` — la garde de `_authenticated` l'appelle à chaque
 * navigation — et les données de l'écran ne partaient qu'à son retour. Un
 * aller-retour entier de plus par écran, trois de plus à l'ouverture.
 *
 * Le compte (`id`, `email`) ne change pas pendant une session : il est connu
 * à la connexion, ou au premier appel, et rendu aussitôt ensuite. Il se
 * relit en arrière-plan quand il a plus de cinq minutes, sans retenir
 * l'écran ; si la session a pris fin ailleurs (révoquée, expirée), l'événement
 * `malica:session-perdue` ramène à la connexion. Les appels de données, eux,
 * portent toujours leur jeton : un compte gardé en mémoire n'ouvre rien.
 */
const FRAICHE_MS = 5 * 60_000;
let connue: { compte: Compte; le: number } | null = null;
let enVol: Promise<Compte | null> | null = null;

function connaitre(compte: Compte | null) {
  connue = compte ? { compte, le: Date.now() } : null;
}

// Toute fin de session passe par le même signal — le bouton « Se
// déconnecter », un jeton long refusé, une relance encore en 401 (transport) :
// le compte gardé en mémoire s'oublie avec elle, sans quoi la page de
// connexion le reprendrait et renverrait à l'intérieur (relu par Codex, #309).
ecouterLaDeconnexion(() => {
  connaitre(null);
});

/** La session a pris fin ailleurs : l'écran retourne à la connexion. */
export const SESSION_PERDUE = "malica:session-perdue";

/** Le compte, lu au réseau : la seule lecture qui coûte un aller-retour. */
async function lireLaSession(): Promise<Compte | null> {
  // La coque, au démarrage, n'a pas encore de jeton d'accès : elle le
  // réobtient contre le jeton long, en un aller-retour, et c'est déjà la
  // réponse. Sans jeton long, il n'y a pas de session — inutile de demander.
  const t = transport();
  if (!t.porteUnJeton() && (await t.jetonLong())) {
    return t.reprendreLaSession();
  }
  const reponse = await appeler("/auth/session", { methode: "GET" });
  if (reponse.status === 401) return null;
  if (!reponse.ok) throw new EchecAuth("reseau", "session illisible");
  const { utilisateur } = (await reponse.json()) as { utilisateur: Compte };
  return utilisateur;
}

export function creerAuthHttp(): AuthPort {
  return {
    async session(): Promise<Compte | null> {
      if (connue) {
        if (Date.now() - connue.le > FRAICHE_MS && !enVol) {
          const avant = connue.compte.id;
          enVol = lireLaSession()
            .then((compte) => {
              // Une déconnexion pendant la relecture a déjà tout oublié.
              if (connue?.compte.id !== avant) return compte;
              connaitre(compte);
              if (!compte && typeof window !== "undefined") {
                window.dispatchEvent(new Event(SESSION_PERDUE));
              }
              return compte;
            })
            // Hors ligne : on garde ce qu'on sait, on relira plus tard.
            .catch(() => connue?.compte ?? null)
            .finally(() => {
              enVol = null;
            });
        }
        return connue.compte;
      }
      // Plusieurs écrans qui demandent en même temps n'attendent qu'une réponse.
      enVol ??= lireLaSession()
        .then((compte) => {
          connaitre(compte);
          return compte;
        })
        .finally(() => {
          enVol = null;
        });
      return enVol;
    },

    async inscription(email: string, motDePasse: string, nom?: string): Promise<Compte> {
      const reponse = await appeler("/auth/inscription", {
        methode: "POST",
        corps: { email, motDePasse, ...(nom ? { nom } : {}) },
      });
      if (reponse.status === 409) throw new EchecAuth("adresse_prise", "inscription impossible");
      if (reponse.status === 400) throw new EchecAuth("saisie", "saisie invalide");
      if (!reponse.ok) throw new EchecAuth("reseau", "inscription impossible");
      return retenir(reponse);
    },

    async connexion(email: string, motDePasse: string): Promise<Compte> {
      const reponse = await appeler("/auth/connexion", {
        methode: "POST",
        corps: { email, motDePasse },
      });
      if (reponse.status === 401) throw new EchecAuth("identifiants", "identifiants invalides");
      if (reponse.status === 400) throw new EchecAuth("saisie", "saisie invalide");
      if (!reponse.ok) throw new EchecAuth("reseau", "connexion impossible");
      return retenir(reponse);
    },

    async deconnexion(): Promise<void> {
      // Le jeton long part avec la demande : l'API le révoque, et une
      // déconnexion sur un téléphone perdu compte alors pour quelque chose.
      const jetonRafraichissement = await transport().jetonLong();
      await appeler("/auth/deconnexion", {
        methode: "POST",
        ...(jetonRafraichissement ? { corps: { jetonRafraichissement } } : {}),
      });
      await transport().oublierLaSession();
      connaitre(null);
    },

    async motDePasseOublie(email: string): Promise<void> {
      const reponse = await appeler("/auth/mot-de-passe-oublie", {
        methode: "POST",
        corps: { email },
      });
      if (reponse.status === 400) throw new EchecAuth("saisie", "saisie invalide");
      if (!reponse.ok) throw new EchecAuth("reseau", "demande impossible");
    },

    async reinitialiser(secret: string, motDePasse: string): Promise<Compte> {
      const reponse = await appeler("/auth/reinitialiser", {
        methode: "POST",
        corps: { secret, motDePasse },
      });
      if (reponse.status === 410) throw new EchecAuth("lien_expire", "lien expiré");
      if (reponse.status === 400) throw new EchecAuth("saisie", "saisie invalide");
      if (!reponse.ok) throw new EchecAuth("reseau", "réinitialisation impossible");
      return retenir(reponse);
    },
  };
}
