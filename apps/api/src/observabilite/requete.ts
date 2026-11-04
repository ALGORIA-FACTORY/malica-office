/**
 * L'entrée HTTP d'une trace.
 *
 * Chaque requête reçoit sa trace : celle que le client annonce dans
 * `x-malica-trace` si l'identifiant est bien formé (le téléphone la tire dès
 * la capture et la répète à chaque renvoi), une neuve sinon. Elle est rendue
 * dans la réponse, sous le même en-tête : le client qui n'en avait pas
 * l'apprend, et un support peut la demander à l'écran.
 *
 * La requête elle-même devient l'étape `http` : sa route (le gabarit, jamais
 * l'adresse réelle — elle porterait des identifiants), son statut, sa durée.
 * Un renvoi de la même requête (`x-malica-cle` identique) ne compte qu'une
 * fois.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { lireClient, type Client } from "../session.ts";
import { consigner, type Issue } from "./journal.ts";
import { nouvelleTrace, sousLaTrace, type Origine } from "./trace.ts";

const EN_TETE_TRACE = "x-malica-trace";
const EN_TETE_CLE = "x-malica-cle";
const CLE_BIEN_FORMEE = /^[\w.:-]{1,100}$/;

/** Le client déclaré dit d'où vient l'opération ; sans déclaration, c'est un appel d'API. */
function origineDe(client: Client | null): Origine {
  if (client?.nom === "coque-android") return "android";
  if (client?.nom === "pwa") return "pwa";
  if (client?.nom === "web") return "web";
  return "api";
}

/** 2xx et 3xx : servie ; 4xx : refusée ; 5xx : en panne. */
export function issueDuStatut(statut: number): Issue {
  if (statut >= 500) return "erreur";
  return statut >= 400 ? "refus" : "ok";
}

/** Les sondes de santé et les pré-vols CORS ne sont pas des opérations : on ne les trace pas. */
function aTracer(req: Request): boolean {
  return req.method !== "OPTIONS" && req.path !== "/sante" && !req.path.startsWith("/sante/");
}

export function tracerLaRequete(req: Request, res: Response, next: NextFunction): void {
  if (!aTracer(req)) {
    next();
    return;
  }
  const client = lireClient(req.header("x-malica-client"));
  const cle = req.header(EN_TETE_CLE);
  const trace = nouvelleTrace(origineDe(client), {
    id: req.header(EN_TETE_TRACE) ?? null,
    version: client ? `${client.nom}/${client.version}` : null,
    cleDeRequete: cle && CLE_BIEN_FORMEE.test(cle) ? cle : randomUUID(),
  });
  res.setHeader(EN_TETE_TRACE, trace.id);

  const debut = new Date();
  res.once("close", () => {
    // L'appelant n'est connu qu'après les gardes : on le lit à la sortie.
    trace.acteur ??= req.utilisateur?.id ?? req.cleApi?.auNomDe ?? null;
    trace.tenant ??= req.cleApi?.tenantId ?? null;
    consigner(
      "http",
      res.writableFinished ? issueDuStatut(res.statusCode) : "ignore",
      {
        debut,
        dureeMs: Date.now() - debut.getTime(),
        detail: {
          methode: req.method,
          route: req.route ? `${req.baseUrl}${String(req.route.path)}` : null,
          statut: res.statusCode,
        },
      },
      trace,
    );
  });
  sousLaTrace(trace, () => next());
}
