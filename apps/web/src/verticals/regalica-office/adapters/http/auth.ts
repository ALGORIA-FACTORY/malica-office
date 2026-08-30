/**
 * L'authentification servie par l'API.
 *
 * La session voyage dans un cookie `httpOnly` posé par l'API : aucun jeton
 * n'est lisible par un script de la page, donc aucun n'est volable par une
 * injection. C'est aussi pourquoi il n'y a rien à stocker ici — pas de
 * `localStorage`, pas de rafraîchissement à orchestrer.
 */

import { EchecAuth, type AuthPort, type Compte } from "../../ports/auth";
import { baseApi } from "./rpc";

async function appeler(
  chemin: string,
  options: { methode: "GET" | "POST"; corps?: unknown },
): Promise<Response> {
  try {
    return await fetch(`${baseApi()}${chemin}`, {
      method: options.methode,
      headers: options.corps ? { "Content-Type": "application/json" } : {},
      credentials: "include",
      ...(options.corps ? { body: JSON.stringify(options.corps) } : {}),
    });
  } catch {
    // `fetch` ne rejette que sur un échec réseau : l'API est injoignable, ce
    // qui n'est pas la même chose qu'un refus d'authentification.
    throw new EchecAuth("reseau", "service d'authentification injoignable");
  }
}

export function creerAuthHttp(): AuthPort {
  return {
    async session(): Promise<Compte | null> {
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
      const { utilisateur } = (await reponse.json()) as { utilisateur: Compte };
      return utilisateur;
    },

    async connexion(email: string, motDePasse: string): Promise<Compte> {
      const reponse = await appeler("/auth/connexion", {
        methode: "POST",
        corps: { email, motDePasse },
      });
      if (reponse.status === 401) throw new EchecAuth("identifiants", "identifiants invalides");
      if (reponse.status === 400) throw new EchecAuth("saisie", "saisie invalide");
      if (!reponse.ok) throw new EchecAuth("reseau", "connexion impossible");
      const { utilisateur } = (await reponse.json()) as { utilisateur: Compte };
      return utilisateur;
    },

    async deconnexion(): Promise<void> {
      await appeler("/auth/deconnexion", { methode: "POST" });
    },
  };
}
