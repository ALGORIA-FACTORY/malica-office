/**
 * L'identité de l'appelant, lue sur chaque requête.
 *
 * Un jeton porteur d'abord, le cookie de session sinon : le navigateur parle
 * par cookie httpOnly, la coque native par en-tête `Authorization`. Les deux
 * nomment la même identité, et la base seule décide de ce qu'elle peut faire.
 *
 * Ce module existe à part d'`app.ts` pour que les routeurs — `/regalica` —
 * exigent l'identité sans importer l'application qui les monte.
 */
import type { NextFunction, Request, Response } from "express";

import { lireJeton } from "./auth.ts";

/** L'identité de l'appelant, attachée par `exigerIdentite`. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utilisateur?: { id: string; email: string };
    }
  }
}

export const NOM_COOKIE = "regalica_session";

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
