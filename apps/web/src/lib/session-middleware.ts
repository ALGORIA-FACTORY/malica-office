/**
 * L'intergiciel de session des fonctions serveur.
 *
 * Il remplace `requireSupabaseAuth`, et fait moins : il ne valide pas le jeton
 * lui-même. Ce n'est pas un raccourci, c'est le bon partage des rôles — l'API
 * est seule à connaître le secret des jetons, et le valider ici en double
 * créerait un second endroit à tenir juste.
 *
 * Il vérifie donc l'identité là où elle est décidée, par `/auth/session`, puis
 * transmet le cookie à ce qui suit. Une session absente ou expirée s'arrête ici
 * plutôt que d'aller échouer, plus loin, en plein milieu d'une lecture.
 *
 * Pourquoi ce fichier ne s'appelle pas `.server.ts` : un intergiciel est connu
 * des deux côtés — le navigateur en a besoin pour composer la chaîne d'appel, le
 * serveur pour l'exécuter. Le suffixe `.server` le ferait refuser au montage du
 * bundle client. Ce qui doit rester au serveur l'est autrement, et mieux : les
 * modules serveur sont importés DANS le rappel `.server`, que le compilateur
 * retire du bundle client avec tout ce qu'il référence.
 */

import { createMiddleware } from "@tanstack/react-start";

import type { AppelApi } from "@/lib/api.server";

export interface Compte {
  id: string;
  email: string;
}

export const exigerSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { baseApiServeur, creerAppelApi } = await import("@/lib/api.server");

  const cookie = getRequest().headers.get("cookie") ?? "";
  if (!cookie) throw new Error("session absente");

  const reponse = await fetch(`${baseApiServeur()}/auth/session`, { headers: { cookie } });
  if (!reponse.ok) throw new Error("session invalide ou expirée");
  const { utilisateur } = (await reponse.json()) as { utilisateur: Compte };

  return next({ context: { api: creerAppelApi(cookie) as AppelApi, utilisateur } });
});
