/**
 * L'API Regalica Office — les routes, sans l'écoute.
 *
 * Elle remplace PostgREST et GoTrue. Elle ne remplace pas la RLS : chaque
 * requête métier passe par `sousIdentite`, qui endosse le rôle `authenticated`
 * et pose l'identité de l'appelant. Ce sont les politiques de la base qui
 * décident, pas le code de cette API.
 *
 * Le montage est séparé du démarrage pour une raison précise : les tests de la
 * route de stockage doivent parler à la vraie application, avec ses vrais
 * intergiciels et son vrai ordre de montage. Un test qui appellerait les
 * gestionnaires à la main ne prouverait rien sur ce qui tourne en production.
 */

import cookieParser from "cookie-parser";
import cors from "cors";
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { creerCompte, emettreJeton, lireJeton, organisations, verifierCompte } from "./auth.ts";
import { sousIdentite } from "./db.ts";
import { executerRpc, RpcIntrouvable } from "./rpc.ts";
import { deposerContenu, servirContenu } from "./stockage.ts";

export const app = express();
app.use(cookieParser());
app.use(
  cors({
    // Liste explicite : un `*` avec cookies serait refusé par le navigateur, et
    // le refléter aveuglément reviendrait à n'avoir aucune restriction.
    origin: (process.env["CORS_ORIGINS"] ?? "http://localhost:8080").split(","),
    credentials: true,
  }),
);

/** L'identité de l'appelant, attachée par `exigerIdentite`. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utilisateur?: { id: string; email: string };
    }
  }
}

const NOM_COOKIE = "regalica_session";

function exigerIdentite(req: Request, res: Response, next: NextFunction): void {
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

/**
 * Les octets d'une pièce.
 *
 * Ces deux routes sont montées AVANT `express.json` : un dépôt se lit comme un
 * flux, et un intergiciel qui aurait déjà consommé le corps le rendrait vide.
 */
app.post("/pieces/:id/contenu", exigerIdentite, (req, res, next) => {
  deposerContenu(req, res).catch(next);
});

app.get("/pieces/:id/contenu", exigerIdentite, (req, res, next) => {
  servirContenu(req, res).catch(next);
});

app.use(express.json({ limit: "1mb" }));

const Identifiants = z.object({
  email: z.string().email(),
  motDePasse: z.string().min(12, "12 caractères minimum"),
  nom: z.string().trim().min(1).max(120).optional(),
});

function poserCookie(res: Response, jeton: string): void {
  res.cookie(NOM_COOKIE, jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

app.post("/auth/inscription", async (req, res, next) => {
  try {
    const saisie = Identifiants.safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: saisie.error.issues[0]?.message ?? "saisie invalide" });
      return;
    }
    const utilisateur = await creerCompte(
      saisie.data.email,
      saisie.data.motDePasse,
      saisie.data.nom,
    );
    if (!utilisateur) {
      // Même réponse que pour un mot de passe faux : dire « cette adresse
      // existe » livrerait la liste de vos clients à qui la demande.
      res.status(409).json({ erreur: "inscription impossible" });
      return;
    }
    const jeton = emettreJeton(utilisateur);
    poserCookie(res, jeton);
    res.status(201).json({ utilisateur, jeton });
  } catch (erreur) {
    next(erreur);
  }
});

app.post("/auth/connexion", async (req, res, next) => {
  try {
    const saisie = Identifiants.safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: "saisie invalide" });
      return;
    }
    const utilisateur = await verifierCompte(saisie.data.email, saisie.data.motDePasse);
    if (!utilisateur) {
      res.status(401).json({ erreur: "identifiants invalides" });
      return;
    }
    const jeton = emettreJeton(utilisateur);
    poserCookie(res, jeton);
    res.json({ utilisateur, jeton });
  } catch (erreur) {
    next(erreur);
  }
});

app.get("/auth/session", exigerIdentite, (req, res) => {
  // Sans requête en base : la session est portée par le jeton. Cette route est
  // appelée à chaque navigation, elle doit rester gratuite.
  res.json({ utilisateur: req.utilisateur });
});

app.post("/auth/deconnexion", (_req, res) => {
  res.clearCookie(NOM_COOKIE);
  res.status(204).end();
});

app.get("/moi", exigerIdentite, async (req, res, next) => {
  try {
    const utilisateur = req.utilisateur!;
    res.json({ utilisateur, organisations: await organisations(utilisateur) });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Les pièces visibles de l'appelant.
 *
 * Aucun filtre par tenant dans cette requête — c'est volontaire, et c'est la
 * démonstration : ce que rend cet appel est exactement ce que les politiques
 * RLS autorisent, ni plus ni moins.
 */
app.get("/pieces", exigerIdentite, async (req, res, next) => {
  try {
    const lignes = await sousIdentite(req.utilisateur!.id, async (db) => {
      const { rows } = await db.query(
        `select id, tenant_id, source, vis, storage_path, created_at
           from capture.pieces
          order by created_at desc
          limit 100`,
      );
      return rows;
    });
    res.json(lignes);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Le transport des dépôts. Une seule route : le contrat est celui des ports,
 * pas une API REST inventée par-dessus.
 */
const Appel = z.object({
  depot: z.string().min(1).max(64),
  methode: z.string().min(1).max(64),
  args: z.array(z.unknown()).max(8).default([]),
});

app.post("/rpc", exigerIdentite, async (req, res, next) => {
  try {
    const saisie = Appel.safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: "appel invalide" });
      return;
    }
    const resultat = await sousIdentite(req.utilisateur!.id, (db) => executerRpc(db, saisie.data));
    res.json({ resultat });
  } catch (erreur) {
    if (erreur instanceof RpcIntrouvable) {
      res.status(404).json({ erreur: erreur.message });
      return;
    }
    next(erreur);
  }
});

app.get("/sante", (_req, res) => {
  res.json({ etat: "ok" });
});

app.use((erreur: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Le détail va au journal, jamais au client : un message de Postgres révèle
  // des noms de tables et de colonnes.
  console.error("[api]", erreur);
  res.status(500).json({ erreur: "erreur interne" });
});
