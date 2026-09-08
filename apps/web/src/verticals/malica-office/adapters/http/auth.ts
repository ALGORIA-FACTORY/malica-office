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
  return session.utilisateur;
}

export function creerAuthHttp(): AuthPort {
  return {
    async session(): Promise<Compte | null> {
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
    },
  };
}
