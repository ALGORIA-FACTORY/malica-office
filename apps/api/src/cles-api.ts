/**
 * Les clés d'API du cabinet — ce qu'une intégration présente à la place d'une
 * session.
 *
 * ============================================================== POURQUOI
 *
 * Un outil tiers n'a pas de mot de passe et ne se connecte pas dans un
 * navigateur. Il porte une clé, `rgo_live_…`, dans l'en-tête `Authorization`.
 * Ce fichier la reconnaît, la résout en base, et décide d'une seule chose : ce
 * que la clé peut FAIRE — ses portées, méthode par méthode.
 *
 * Ce qu'elle peut VOIR ne se décide pas ici. `sousCleDuCabinet` pose le cabinet
 * de la clé en claim, `app.member_orgs()` rend exactement ce cabinet, et les
 * politiques RLS font le reste. Une clé ne franchit jamais la frontière du
 * tenant, parce que ce n'est pas elle qui la trace.
 *
 * ================================================== CE QUE LA CLÉ N'EST PAS
 *
 * Pas un utilisateur : elle ne crée ni ne révoque de clé, ne règle rien, ne
 * supervise rien. Toute méthode absente de `METHODES_PAR_PORTEE` lui est
 * fermée, quelle que soit sa portée — fail-closed, comme la RLS.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
  horsRlsAuthentificationSeule,
  sousCleDuCabinet,
  sousIdentite,
  type Requete,
} from "./db.ts";
import { executerRpc, type AppelRpc } from "./rpc.ts";

/** Toute clé commence ainsi ; c'est à ce préfixe que l'API la reconnaît. */
export const PREFIXE_CLE = "rgo_live_";

/** La portée qui ouvre le dépôt des octets d'une pièce. */
const PORTEE_DEPOT = "pieces.deposer";

/**
 * Ce que chaque portée ouvre, au nom près.
 *
 * `capture.enregistrer` ouvre la ligne de la pièce ; les octets passent par
 * `/pieces/:id/contenu`, gardée par `exigerPorteeDepot` avec la même portée.
 */
const METHODES_PAR_PORTEE: Record<string, ReadonlySet<string>> = {
  "ecritures.lire": new Set(["office.periodeLignes", "office.ecrituresByIds"]),
  [PORTEE_DEPOT]: new Set(["capture.enregistrer"]),
};

/** Le refus quand la clé existe mais ne couvre pas le geste. Rien de plus n'est dit. */
const REFUS_PORTEE = "cette clé ne couvre pas cette opération";

/** Le refus quand la clé n'existe pas, est révoquée, ou son cabinet archivé : indistincts. */
const REFUS_CLE = "clé d'API inconnue ou révoquée";

export interface CleApiResolue {
  id: string;
  tenantId: string;
  portees: string[];
  /** La personne qui a créé la clé : l'acteur que l'audit nommera. */
  auNomDe: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Posée par `ouParCleApi` quand l'appelant est une clé, jamais en même temps qu'une session. */
      cleApi?: CleApiResolue;
    }
  }
}

export class PorteeInsuffisante extends Error {}

function methodeCouverte(portees: string[], depot: string, methode: string): boolean {
  const nom = `${depot}.${methode}`;
  return portees.some((portee) => METHODES_PAR_PORTEE[portee]?.has(nom) ?? false);
}

/**
 * Résout une clé en cabinet et portées, ou `null`.
 *
 * Avant toute identité, par construction : c'est la clé qui EST l'identité.
 * La fonction en base est `security definer` ; elle compare une empreinte et
 * note le dernier usage. La clé en clair ne quitte pas cette fonction.
 */
export async function resoudreCle(cle: string): Promise<CleApiResolue | null> {
  if (!cle.startsWith(PREFIXE_CLE)) return null;
  return horsRlsAuthentificationSeule(async (db) => {
    await db.query("set local role authenticated");
    const { rows } = await db.query<{
      r: { id: string; tenantId: string; portees: string[]; auNomDe: string } | null;
    }>(`select public.api_key_resoudre($1) as r`, [cle]);
    const r = rows[0]?.r;
    if (!r) return null;
    return { id: r.id, tenantId: r.tenantId, portees: r.portees, auNomDe: r.auNomDe };
  });
}

/**
 * Un intergiciel qui accepte une clé d'API à la place d'une session.
 *
 * Un `Bearer rgo_live_…` est une clé ; tout autre en-tête ou cookie suit le
 * chemin de session qu'on lui passe. Les deux ne se cumulent pas : une requête
 * porte une clé ou une personne.
 */
export function ouParCleApi(sinonSession: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const entete = req.headers.authorization;
    if (!entete?.startsWith(`Bearer ${PREFIXE_CLE}`)) {
      sinonSession(req, res, next);
      return;
    }
    resoudreCle(entete.slice("Bearer ".length).trim())
      .then((cle) => {
        if (!cle) {
          res.status(401).json({ erreur: REFUS_CLE });
          return;
        }
        req.cleApi = cle;
        next();
      })
      .catch(next);
  };
}

/** Sur la route des octets : une clé sans la portée de dépôt s'arrête ici ; une session passe. */
export function exigerPorteeDepot(req: Request, res: Response, next: NextFunction): void {
  if (req.cleApi && !req.cleApi.portees.includes(PORTEE_DEPOT)) {
    res.status(403).json({ erreur: REFUS_PORTEE });
    return;
  }
  next();
}

/** Un appel RPC sous une clé : la portée d'abord, la base ensuite. */
export async function executerSousCle(cle: CleApiResolue, appel: AppelRpc): Promise<unknown> {
  if (!methodeCouverte(cle.portees, appel.depot, appel.methode)) {
    throw new PorteeInsuffisante(REFUS_PORTEE);
  }
  return sousCleDuCabinet(cle, (db) => executerRpc(db, appel));
}

/**
 * Le travail sous l'appelant, quel qu'il soit — pour les routes qui servent
 * les deux, comme le dépôt des octets d'une pièce.
 */
export function sousLAppelant<T>(req: Request, travail: (db: Requete) => Promise<T>): Promise<T> {
  if (req.cleApi) return sousCleDuCabinet(req.cleApi, travail);
  return sousIdentite(req.utilisateur!.id, travail);
}
