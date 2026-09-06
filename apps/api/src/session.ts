/**
 * L'identité de l'appelant, et ce qu'il dit de lui.
 *
 * Un jeton porteur d'abord, le cookie de session sinon : le navigateur parle
 * par cookie httpOnly, la coque native par en-tête `Authorization`. Les deux
 * nomment la même identité, et la base seule décide de ce qu'elle peut faire.
 *
 * Le client se présente aussi, par `X-Regalica-Client` — « coque-android/0.3.1 »
 * ou « web/abc1234 ». Ce n'est pas une identité : c'est ce qui permet de dire
 * à un téléphone trop ancien qu'il doit se mettre à jour (426), la seule façon
 * d'imposer une mise à jour quand un contrat change.
 *
 * Ce module existe à part d'`app.ts` pour que les routeurs — `/regalica` —
 * exigent l'identité sans importer l'application qui les monte.
 */
import type { NextFunction, Request, Response } from "express";

import { lireJeton } from "./auth.ts";

/** Ce que le client a dit de lui. */
export interface Client {
  /** « coque-android », « coque-ios », « web », ou ce que le client déclare. */
  nom: string;
  /** « 0.3.1 » — ce qui suit un « + » (l'empreinte du bundle) n'entre pas dans la comparaison. */
  version: string;
}

/** L'identité et le client de l'appelant, attachés par les intergiciels d'ici. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utilisateur?: { id: string; email: string };
      /**
       * Pas `client` : Node pose déjà `req.client` — l'alias historique de la
       * socket — et le lire comme le nôtre faisait exploser la route de
       * connexion pour tout navigateur qui ne se présente pas.
       */
      clientDeclare?: Client;
    }
  }
}

export const NOM_COOKIE = "regalica_session";
const EN_TETE_CLIENT = "x-regalica-client";

export function exigerIdentite(req: Request, res: Response, next: NextFunction): void {
  const entete = req.headers.authorization;
  const jeton = entete?.startsWith("Bearer ")
    ? entete.slice(7)
    : (req.cookies as Record<string, string> | undefined)?.[NOM_COOKIE];

  const utilisateur = jeton ? lireJeton(jeton) : null;
  if (!utilisateur) {
    res.status(401).json({ erreur: "authentification requise" });
    return;
  }
  req.utilisateur = utilisateur;
  next();
}

/** « coque-android/0.3.1+abc » → { nom: "coque-android", version: "0.3.1" }. Sinon `null`. */
export function lireClient(entete: string | undefined): Client | null {
  if (!entete) return null;
  const m = /^([a-z][a-z0-9-]{0,39})\/(\d+(?:\.\d+){0,3})(?:\+[\w.-]{0,80})?$/i.exec(entete.trim());
  if (!m) return null;
  return { nom: m[1]!.toLowerCase(), version: m[2]! };
}

/** Vrai si `a` est strictement antérieure à `b`, composante par composante. */
export function versionInferieure(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Une coque est-elle trop ancienne pour le contrat servi ? */
export function clientDepasse(client: Client | null, versionMinimale: string | undefined): boolean {
  if (!client || !versionMinimale || !client.nom.startsWith("coque-")) return false;
  return versionInferieure(client.version, versionMinimale);
}

/**
 * Attache le client à la requête et refuse une coque dépassée.
 *
 * `CLIENT_MIN_VERSION` ne vise que les coques : un navigateur charge toujours
 * la dernière version, il n'a rien à mettre à jour. Absente, rien n'est refusé.
 */
export function presenterLeClient(req: Request, res: Response, next: NextFunction): void {
  const client = lireClient(req.header(EN_TETE_CLIENT));
  if (client) req.clientDeclare = client;
  const minimale = process.env["CLIENT_MIN_VERSION"];
  if (clientDepasse(client, minimale)) {
    res.status(426).json({ erreur: "mise à jour requise", versionMinimale: minimale });
    return;
  }
  next();
}

/** Vrai pour la coque native, qui reçoit un jeton de rafraîchissement ; faux pour le navigateur. */
export function estUneCoque(req: Request): boolean {
  return req.clientDeclare?.nom.startsWith("coque-") === true;
}
