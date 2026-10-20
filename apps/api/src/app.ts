/**
 * L'API Malica Office — les routes, sans l'écoute.
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

import { appendFileSync } from "node:fs";

import cookieParser from "cookie-parser";
import cors from "cors";
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import {
  creerCompte,
  demanderReinitialisation,
  emettreJeton,
  emettreJetonDeRafraichissement,
  organisations,
  rafraichir,
  reinitialiser,
  revoquerJetonDeRafraichissement,
  verifierCompte,
  type Utilisateur,
} from "./auth.ts";
import { configurationCourriel } from "./courriel/brevo.ts";
import { envoyerReinitialisation } from "./courriel/reinitialisation.ts";
import { executerSousCle, exigerPorteeDepot, ouParCleApi, PorteeInsuffisante } from "./cles-api.ts";
import { sonderLaBase, sousIdentite } from "./db.ts";
import { introuvableLisible, refusLisible } from "./refus.ts";
import { origineAutorisee } from "./origines.ts";
import { malica } from "./malica.ts";
import { executerRpc, RpcIntrouvable } from "./rpc.ts";
import { estUneCoque, exigerIdentite, NOM_COOKIE, presenterLeClient } from "./session.ts";
import { deposerContenu, servirContenu, sonderLeStockage } from "./stockage.ts";

/** Le journal d'atelier, en fichier — relisible après coup, en développement seulement. */
const JOURNAL_ATELIER = new URL("../journal-atelier.log", import.meta.url);

export const app = express();
// Derrière Caddy, l'adresse et le protocole vus par Express sont ceux du
// relais : sans ceci, la limitation par adresse compterait tout le monde
// comme une seule personne, et les journaux nommeraient le relais.
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(
  cors({
    /*
     * Liste explicite : un `*` avec cookies serait refusé par le navigateur, et
     * le refléter aveuglément reviendrait à n'avoir aucune restriction.
     *
     * S'y ajoute, EN DÉVELOPPEMENT SEULEMENT, le réseau local : sans cela, on
     * ne peut pas ouvrir l'application depuis un téléphone du même Wi-Fi sans
     * inscrire à la main une adresse IP qui change de réseau en réseau.
     *
     * La frontière est réelle et disparaît en production — voir `origines.ts`,
     * qui refuse notamment les domaines imitant une adresse privée.
     */
    origin: (origine, suite) => {
      const autorisee = origineAutorisee(
        origine,
        (process.env["CORS_ORIGINS"] ?? "http://localhost:8080").split(","),
        process.env["NODE_ENV"] === "production",
      );
      suite(null, autorisee);
    },
    credentials: true,
  }),
);
// Qui parle — « coque-android/0.3.1 », « web/abc1234 » — et un 426 pour une
// coque trop ancienne. Avant toute route : un contrat rompu se refuse à la porte.
app.use(presenterLeClient);

/**
 * Une session, ou une clé d'API du cabinet — voir `cles-api.ts`. La clé ne
 * change rien à la RLS : elle pose le cabinet en claim, et la base décide.
 */
const exigerAppelant = ouParCleApi(exigerIdentite);

/**
 * Les octets d'une pièce.
 *
 * Ces deux routes sont montées AVANT `express.json` : un dépôt se lit comme un
 * flux, et un intergiciel qui aurait déjà consommé le corps le rendrait vide.
 */
app.post("/pieces/:id/contenu", exigerAppelant, exigerPorteeDepot, (req, res, next) => {
  deposerContenu(req, res).catch(next);
});

app.get("/pieces/:id/contenu", exigerIdentite, (req, res, next) => {
  servirContenu(req, res).catch(next);
});

app.use(express.json({ limit: "1mb" }));

/*
 * Malica — tout ce qui fait parler un modèle. Hors de `/rpc`, parce que
 * ces gestes durent plus longtemps qu'une transaction ne peut rester ouverte.
 * Voir `malica.ts`.
 */
app.use("/malica", malica);

const Identifiants = z.object({
  email: z.string().email(),
  motDePasse: z.string().min(12, "12 caractères minimum"),
  nom: z.string().trim().min(1).max(120).optional(),
});

/**
 * Trente essais par minute et par adresse sur les portes d'entrée. Assez pour
 * une famille derrière une même box, trop peu pour deviner un mot de passe.
 * Réglable, parce qu'un jeu d'essai qui crée des comptes en rafale n'est pas
 * une attaque.
 */
const limiteAuth = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env["AUTH_ESSAIS_PAR_MINUTE"] ?? 30),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { erreur: "trop d'essais : réessayez dans une minute" },
});

/**
 * Le jeton de rafraîchissement, pour la coque seulement.
 *
 * Le navigateur garde son cookie de douze heures et ne reçoit rien de plus :
 * un jeton long dans une page web serait une clé de trente jours à portée du
 * premier script. La coque, elle, le range dans son coffre.
 */
async function jetonPourLaCoque(
  req: Request,
  utilisateur: Utilisateur,
): Promise<{ jetonRafraichissement?: string }> {
  if (!estUneCoque(req)) return {};
  const appareil = req.clientDeclare
    ? `${req.clientDeclare.nom}/${req.clientDeclare.version}`
    : null;
  return { jetonRafraichissement: await emettreJetonDeRafraichissement(utilisateur, appareil) };
}

function poserCookie(res: Response, jeton: string): void {
  res.cookie(NOM_COOKIE, jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

app.post("/auth/inscription", limiteAuth, async (req, res, next) => {
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
    res.status(201).json({ utilisateur, jeton, ...(await jetonPourLaCoque(req, utilisateur)) });
  } catch (erreur) {
    next(erreur);
  }
});

app.post("/auth/connexion", limiteAuth, async (req, res, next) => {
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
    res.json({ utilisateur, jeton, ...(await jetonPourLaCoque(req, utilisateur)) });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Rafraîchir : un jeton long contre un jeton d'accès neuf — et un jeton long
 * neuf, l'ancien étant révoqué. Un jeton inconnu, expiré ou déjà tourné
 * reçoit le même 401, sans dire lequel.
 */
app.post("/auth/rafraichir", limiteAuth, async (req, res, next) => {
  try {
    const saisie = z
      .object({ jetonRafraichissement: z.string().min(16).max(200) })
      .safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: "saisie invalide" });
      return;
    }
    const appareil = req.clientDeclare
      ? `${req.clientDeclare.nom}/${req.clientDeclare.version}`
      : null;
    const tourne = await rafraichir(saisie.data.jetonRafraichissement, appareil);
    if (!tourne) {
      res.status(401).json({ erreur: "jeton de rafraîchissement invalide" });
      return;
    }
    const jeton = emettreJeton(tourne.utilisateur);
    poserCookie(res, jeton);
    res.json({
      utilisateur: tourne.utilisateur,
      jeton,
      jetonRafraichissement: tourne.jetonRafraichissement,
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Le mot de passe oublié. La demande répond toujours 202, que l'adresse existe
 * ou non : le dire livrerait la liste des comptes. Le lien part par courriel,
 * jamais dans la réponse.
 */
app.post("/auth/mot-de-passe-oublie", limiteAuth, async (req, res, next) => {
  try {
    const saisie = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: "saisie invalide" });
      return;
    }
    const demande = await demanderReinitialisation(saisie.data.email);
    if (demande) {
      let config: ReturnType<typeof configurationCourriel> = null;
      try {
        config = configurationCourriel(process.env);
      } catch (e) {
        console.error(`[reinitialisation] ${(e as Error).message}`);
      }
      await envoyerReinitialisation(demande, config);
    }
    res.status(202).json({ demande: "reçue" });
  } catch (erreur) {
    next(erreur);
  }
});

/** Le nouveau mot de passe, contre le secret du lien. Ouvre la session dans le même geste. */
app.post("/auth/reinitialiser", limiteAuth, async (req, res, next) => {
  try {
    const saisie = z
      .object({
        secret: z.string().min(16).max(200),
        motDePasse: z.string().min(12, "12 caractères minimum"),
      })
      .safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: saisie.error.issues[0]?.message ?? "saisie invalide" });
      return;
    }
    const utilisateur = await reinitialiser(saisie.data.secret, saisie.data.motDePasse);
    if (!utilisateur) {
      res.status(410).json({ erreur: "lien expiré ou déjà utilisé" });
      return;
    }
    const jeton = emettreJeton(utilisateur);
    poserCookie(res, jeton);
    res.json({ utilisateur, jeton, ...(await jetonPourLaCoque(req, utilisateur)) });
  } catch (erreur) {
    next(erreur);
  }
});

app.get("/auth/session", exigerIdentite, (req, res) => {
  // Sans requête en base : la session est portée par le jeton. Cette route est
  // appelée à chaque navigation, elle doit rester gratuite.
  res.json({ utilisateur: req.utilisateur });
});

/**
 * Se déconnecter : le cookie tombe, et le jeton long, si la coque le rend,
 * est révoqué en base — c'est ce qui fait qu'une déconnexion sur un téléphone
 * perdu compte pour quelque chose.
 */
app.post("/auth/deconnexion", async (req, res, next) => {
  try {
    const secret = (req.body as { jetonRafraichissement?: unknown } | undefined)
      ?.jetonRafraichissement;
    if (typeof secret === "string" && secret.length > 0) {
      await revoquerJetonDeRafraichissement(secret);
    }
    res.clearCookie(NOM_COOKIE);
    res.status(204).end();
  } catch (erreur) {
    next(erreur);
  }
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

app.post("/rpc", exigerAppelant, async (req, res, next) => {
  try {
    const saisie = Appel.safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: "appel invalide" });
      return;
    }
    /*
     * Le paiement en ligne se fait sur le web et la PWA, jamais dans
     * l'application installée depuis un store (décision du 20 octobre 2026).
     * L'écran le dit déjà ; le serveur le tient, pour une coque qui
     * l'oublierait.
     */
    if (
      saisie.data.depot === "facturation" &&
      saisie.data.methode === "payerEnLigne" &&
      estUneCoque(req)
    ) {
      res.status(403).json({ erreur: "le paiement se fait depuis le navigateur" });
      return;
    }
    const resultat = req.cleApi
      ? await executerSousCle(req.cleApi, saisie.data)
      : await sousIdentite(req.utilisateur!.id, (db) => executerRpc(db, saisie.data));
    res.json({ resultat });
  } catch (erreur) {
    if (erreur instanceof PorteeInsuffisante) {
      // La clé existe mais ne couvre pas ce geste. On le dit, sans dire ce
      // qu'elle couvre par ailleurs.
      res.status(403).json({ erreur: erreur.message });
      return;
    }
    if (erreur instanceof RpcIntrouvable) {
      res.status(404).json({ erreur: erreur.message });
      return;
    }
    const absent = introuvableLisible(erreur);
    if (absent) {
      res.status(404).json({ erreur: absent });
      return;
    }
    // Une règle métier qui refuse a écrit son message pour l'''appelant : le
    // masquer derrière « erreur interne » lui retirerait la seule chose utile.
    const refus = refusLisible(erreur);
    if (refus) {
      res.status(400).json({ erreur: refus });
      return;
    }
    next(erreur);
  }
});

app.get("/sante", (_req, res) => {
  res.json({ etat: "ok" });
});

/**
 * La sonde profonde — ce que la surveillance interroge toutes les deux minutes.
 *
 * `/sante` dit que le processus répond ; celle-ci dit que la base répond sous
 * le rôle de l'API et que le stockage écrit puis relit. Un disque plein ou une
 * base injoignable se voient ici, avant la première pièce d'un client. Elle
 * ne révèle rien d'autre que « ok » ou « hs », et la version servie.
 */
app.get("/sante/profonde", async (_req, res) => {
  const verdict = {
    etat: "ok",
    version: process.env["MALICA_VERSION"] ?? "atelier",
    base: "ok",
    stockage: "ok",
  };
  await sonderLaBase().catch(() => {
    verdict.base = "hs";
  });
  await sonderLeStockage().catch(() => {
    verdict.stockage = "hs";
  });
  const sain = verdict.base === "ok" && verdict.stockage === "ok";
  verdict.etat = sain ? "ok" : "degrade";
  res.status(sain ? 200 : 503).json(verdict);
});

/**
 * Le journal d'atelier — ce que l'appareil de l'utilisateur a vraiment vu.
 *
 * ============================================================== POURQUOI
 *
 * Un défaut n'existait que sur un téléphone : « Cannot transfer object of
 * unsupported type ». Trois corrections à l'aveugle, trois échecs — parce que
 * le poste de développement, lui, n'a jamais reproduit la panne. Une page de
 * diagnostic a montré que le navigateur savait tout faire : le message venait
 * donc d'ailleurs, et son TEXTE seul ne le disait pas.
 *
 * Ce qui manquait est la TRACE : le fichier et la ligne. Cette route la reçoit
 * de l'appareil et l'écrit dans le journal du serveur, là où on peut la lire.
 *
 * ========================================================= CE QU'ELLE N'EST PAS
 *
 * Ni de la télémétrie, ni un service de suivi d'erreurs. Elle n'existe qu'en
 * développement — `NODE_ENV` en décide — et rien ne sort de la machine :
 * l'appareil parle au poste de l'atelier, sur le réseau local.
 */
if (process.env["NODE_ENV"] !== "production") {
  app.post("/journal-atelier", (req, res) => {
    const c = req.body as {
      message?: unknown;
      pile?: unknown;
      ou?: unknown;
      appareil?: unknown;
    };
    const ligne = (v: unknown, max = 4000) => String(v ?? "").slice(0, max);
    const texte = [
      "",
      "──────────── journal d'atelier ────────────",
      `  où       : ${ligne(c.ou, 200)}`,
      `  appareil : ${ligne(c.appareil, 300)}`,
      `  message  : ${ligne(c.message, 500)}`,
      "  pile     :",
      ligne(c.pile)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
      "───────────────────────────────────────────",
      "",
    ].join("\n");
    console.error(texte);
    // Aussi dans un fichier : la console d'un terminal ne se relit pas après coup.
    appendFileSync(JOURNAL_ATELIER, `${new Date().toISOString()}${texte}`);
    res.status(204).end();
  });
}

app.use((erreur: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Le détail va au journal, jamais au client : un message de Postgres révèle
  // des noms de tables et de colonnes.
  console.error("[api]", erreur);
  res.status(500).json({ erreur: "erreur interne" });
});
