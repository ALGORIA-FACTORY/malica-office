import { METHODES_COMMERCIALES } from "@malica/socle/commerce";
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

import { appendFileSync, readFileSync } from "node:fs";

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
import { detailTechnique, introuvableLisible, REFUS_SANS_CLE, refusLisible } from "./refus.ts";
import { origineAutorisee } from "./origines.ts";
import { malica } from "./malica.ts";
import { moteurDuSecondLecteur } from "./malica/lecture/paddle.ts";
import { emettreLeGeste, gesteDe } from "./observabilite/gestes.ts";
import { codeDuRefus, consigner } from "./observabilite/journal.ts";
import { issueDuStatut, tracerLaRequete } from "./observabilite/requete.ts";
import { traceCourante } from "./observabilite/trace.ts";
import { executerRpc, origineDEssai, RpcIntrouvable } from "./rpc.ts";
import { estUneCoque, exigerIdentite, NOM_COOKIE, presenterLeClient } from "./session.ts";
import {
  deposerContenu,
  servirContenu,
  servirMiniature,
  servirUnExport,
  sonderLeStockage,
} from "./stockage.ts";

/** Le journal d'atelier, en fichier — relisible après coup, en développement seulement. */
const JOURNAL_ATELIER = new URL("../journal-atelier.log", import.meta.url);

/**
 * La version LIVRÉE, au format x.y.z. Le staging suit `main` : son image est
 * étiquetée « main », et `MALICA_VERSION` le répétait - la sonde ne disait
 * plus quel code tournait (ANO-037). L'étiquette reste quand elle est un
 * numéro ; sinon le `package.json` de la racine, copié dans l'image, le dit.
 */
const VERSION_LIVREE = ((): string => {
  const etiquette = process.env["MALICA_VERSION"];
  if (etiquette && /^v?\d+\.\d+\.\d+/.test(etiquette)) return etiquette.replace(/^v/, "");
  try {
    const racine = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof racine.version === "string") return racine.version;
  } catch {
    /* hors d'un dépôt complet : l'étiquette, ou l'atelier */
  }
  return etiquette ?? "atelier";
})();

export const app = express();
// Derrière Caddy, l'adresse et le protocole vus par Express sont ceux du
// relais : sans ceci, la limitation par adresse compterait tout le monde
// comme une seule personne, et les journaux nommeraient le relais.
app.set("trust proxy", 1);
/*
 * La trace d'abord, avant toute garde : une requête refusée à la porte (CORS,
 * coque dépassée, identité absente) est justement celle qu'on cherche ensuite.
 * Voir `observabilite/requete.ts`.
 */
app.use(tracerLaRequete);
app.use(cookieParser());
app.use(
  cors({
    // Le navigateur ne laisse lire au script que les en-têtes exposés : la
    // trace rendue en est un, pour qu'un écran puisse la citer au support.
    exposedHeaders: ["x-malica-trace"],
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

/** Sa miniature, pour les listes — voir `miniature.ts`. Même garde, même RLS. */
app.get("/pieces/:id/miniature", exigerIdentite, (req, res, next) => {
  servirMiniature(req, res).catch(next);
});

/** Un export numéroté du journal du jour, gardé — voir `stockage.ts`. Même garde, même RLS. */
app.get("/exports/:id/contenu", exigerIdentite, (req, res, next) => {
  servirUnExport(req, res).catch(next);
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

/** Un nom de dépôt ou de méthode tel qu'il se trace : un identifiant, jamais un texte libre. */
const NOM_D_APPEL = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/**
 * L'étape `rpc` : le dépôt et la méthode, l'issue, la clé du refus, la durée,
 * et les lignes d'audit que l'appel a écrites — référencées, pas recopiées.
 * Elle s'écrit à la sortie, que l'appel réussisse, soit refusé ou tombe : le
 * journal a sa propre connexion, une transaction annulée n'emporte pas la trace.
 *
 * Un appel que `observabilite.gestes` dit sensible y ajoute son étape MÉTIER
 * (`observabilite/gestes.ts`) : le geste, l'objet, la pièce, l'audit.
 */
function noterLAppel(
  res: Response,
  appel: { depot: string; methode: string; args: unknown[] },
): void {
  const trace = traceCourante();
  if (!trace) return;
  const debut = new Date();
  res.once("close", () => {
    const issue = res.writableFinished ? issueDuStatut(res.statusCode) : "ignore";
    const refus: unknown = res.locals["refus"];
    // La clé du refus, sans les valeurs qui la suivent ; jamais un texte brut.
    const codeRefus = typeof refus === "string" ? codeDuRefus(refus) : null;
    const dureeMs = Date.now() - debut.getTime();
    consigner(
      "rpc",
      issue,
      {
        debut,
        dureeMs,
        // Une transaction qui n'a pas abouti n'a rien audité.
        audits: issue === "ok" ? trace.audits : [],
        detail: {
          depot: NOM_D_APPEL.test(appel.depot) ? appel.depot : null,
          methode: NOM_D_APPEL.test(appel.methode) ? appel.methode : null,
          statut: res.statusCode,
          code_refus: codeRefus,
          // Ce que l'écran ne voit plus (un refus sans clé, une panne) : le
          // SQLSTATE et le nom de l'erreur, jamais son message.
          ...((res.locals["panne"] as ReturnType<typeof detailTechnique> | undefined) ?? {}),
        },
      },
      trace,
    );
    void gesteDe(appel.depot, appel.methode).then((geste) => {
      if (geste) emettreLeGeste(geste, appel, trace, { issue, codeRefus, debut, dureeMs });
    });
  });
}

app.post("/rpc", exigerAppelant, async (req, res, next) => {
  try {
    const saisie = Appel.safeParse(req.body);
    if (!saisie.success) {
      res.status(400).json({ erreur: "refus.saisie.mal_formee" });
      return;
    }
    noterLAppel(res, saisie.data);
    /*
     * Rien ne se vend dans l'application installée depuis un store : le
     * paiement, les prix, les offres et l'acceptation d'un abonnement se font
     * sur le web et la PWA (décisions des 20 et 22 octobre 2026). L'écran de
     * la coque n'en porte rien ; le serveur le tient, pour une coque qui
     * l'oublierait. Le refus ne dit pas où payer : il n'invite à rien.
     */
    if (
      saisie.data.depot === "facturation" &&
      METHODES_COMMERCIALES.has(saisie.data.methode) &&
      estUneCoque(req)
    ) {
      res.status(403).json({ erreur: "indisponible dans l'application" });
      return;
    }
    // La base doit savoir qu'une coque appelle : elle n'y offre que les places
    // incluses dans l'abonnement (`facturation.place_offrir`).
    const coque = estUneCoque(req);
    const resultat = req.cleApi
      ? await executerSousCle(req.cleApi, saisie.data)
      : await sousIdentite(req.utilisateur!.id, async (db) => {
          if (coque) await db.query("select set_config('malica.client_coque', 'oui', true)");
          return executerRpc(
            db,
            saisie.data,
            origineDEssai(saisie.data.depot, saisie.data.methode),
          );
        });
    res.json({ resultat });
  } catch (erreur) {
    if (erreur instanceof PorteeInsuffisante) {
      // La clé existe mais ne couvre pas ce geste. On le dit, sans dire ce
      // qu'elle couvre par ailleurs.
      res.status(403).json({ erreur: erreur.message });
      return;
    }
    // Une clé fixe : le nom reçu ne revient jamais (audit du 6 novembre 2026, S6).
    if (erreur instanceof RpcIntrouvable) {
      res.locals["refus"] = erreur.message;
      res.status(404).json({ erreur: erreur.message });
      return;
    }
    const absent = introuvableLisible(erreur);
    if (absent) {
      res.locals["refus"] = absent;
      res.status(404).json({ erreur: absent });
      return;
    }
    // Une règle métier qui refuse a levé sa clé pour l'appelant : le masquer
    // derrière « erreur interne » lui retirerait la seule chose utile.
    const refus = refusLisible(erreur);
    if (refus) {
      res.locals["refus"] = refus;
      if (refus === REFUS_SANS_CLE) {
        // Une phrase levée sans clé ne part pas à l'écran (R12) : le détail
        // reste au serveur, et l'étape `rpc` en garde le code.
        res.locals["panne"] = detailTechnique(erreur);
        console.error("[api] refus sans clé", erreur);
      }
      res.status(400).json({ erreur: refus });
      return;
    }
    res.locals["panne"] = detailTechnique(erreur);
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
    version: VERSION_LIVREE,
    base: "ok",
    stockage: "ok",
    // Le moteur du second lecteur : dit, jamais exigé (il peut être éteint).
    ocr: await moteurDuSecondLecteur(),
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
  /*
   * Un corps trop lourd ou illisible est une faute de la requête, pas une
   * panne (campagne du 21 octobre 2026, ANO-036 : un corps de 2 Mo sortait
   * en 500). `express.json` nomme ces cas par `type` ; on les dit en 413/400,
   * sans un mot du moteur.
   */
  const type = (erreur as { type?: string } | null)?.type;
  if (type === "entity.too.large") {
    res.status(413).json({ erreur: "la requête est trop volumineuse (1 Mo au plus)" });
    return;
  }
  if (type === "entity.parse.failed" || type === "encoding.unsupported") {
    res.status(400).json({ erreur: "le corps de la requête n'est pas un JSON lisible" });
    return;
  }
  // Le détail va au journal, jamais au client : un message de Postgres révèle
  // des noms de tables et de colonnes.
  console.error("[api]", erreur);
  res.status(500).json({ erreur: "erreur interne" });
});
