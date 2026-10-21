/**
 * Les routes de Malica — tout ce qui fait parler un modèle.
 *
 * ============================================================== POURQUOI
 *
 * Ces gestes tournaient dans le serveur web, en fonctions serveur, parce que
 * les clés des modèles ne devaient pas atteindre le navigateur. Ils tournent
 * maintenant ici, pour trois raisons qui se renforcent : l'API est le seul
 * processus dont dépend un téléphone, le serveur web n'a plus aucun secret,
 * et le harnais d'épreuves — qui ne parle qu'à l'API — les couvre enfin.
 *
 * ============================================================ PAS DANS /rpc
 *
 * `/rpc` exécute chaque appel dans une transaction, sous l'identité, et la
 * base coupe une transaction inactive après dix secondes. Un appel de modèle
 * dure de dix secondes à quelques minutes : il n'a pas sa place dedans. Ces
 * routes s'exécutent hors transaction ; ce qu'elles lisent en base passe par
 * `creerAppelLocal`, qui ouvre une transaction courte par lecture.
 *
 * ================================================================ CE QUI SORT
 *
 * La chaîne de lecture parle en codes (« lecture.illisible ») et l'écran les
 * traduit. Le message d'une erreur est donc rendu tel quel, comme la fonction
 * serveur le faisait — c'est la seule chose utile pour la personne qui attend.
 */
import { raw, Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { sousIdentite } from "./db.ts";
import { creerAppelLocal, PieceIntrouvable } from "./malica/appel-local.ts";
import { redigerLeBriefing } from "./malica/briefing.ts";
import { askMalica, repondreAuCabinet } from "./malica/conseil/ask.ts";
import { coureurDeLectures } from "./malica/lecture/coureur.ts";
import { registre } from "./malica/lecture/lectures-en-cours.ts";
import { lireCarteFiscale } from "./malica/lecture/lire-carte.ts";
import { LectureRefusee, readPieceFlow } from "./malica/lecture/read-flow.ts";
import { redigerLePv } from "./malica/pv/rediger.ts";
import { introuvableLisible, refusLisible } from "./refus.ts";
import { RpcIntrouvable } from "./rpc.ts";
import { exigerIdentite } from "./session.ts";

export const malica = Router();
malica.use(exigerIdentite);

/** Une saisie que la route refuse avant tout travail — un refus, pas une panne. */
class SaisieInvalide extends Error {}

/** Les noms que pdf.js donne à un fichier qu'il ne peut pas ouvrir. */
const PDF_ILLISIBLE = new Set(["InvalidPDFException", "PasswordException"]);

const Uuid = z.string().uuid();
const Locale = z.enum(["fr", "en", "ar"]).default("fr");

/** L'API vue de l'intérieur, sous l'identité de la requête. */
function api(req: Request) {
  return creerAppelLocal(req.utilisateur!.id);
}

/**
 * La pièce est-elle visible de l'appelant ? Sinon : introuvable.
 *
 * Campagne du 21 octobre 2026 (ANO-003, critique) : le registre des lectures
 * en cours est indexé par la pièce, et la route rendait la lecture qui
 * tournait à quiconque connaissait son identifiant — une autre organisation
 * recevait verdict, drapeaux et modèle. Rejoindre est légitime entre membres
 * qui voient la pièce (deux onglets, un collègue) ; la RLS de `pieces_v` dit
 * qui la voit, et ce contrôle passe AVANT le registre.
 */
async function pieceVisible(req: Request, pieceId: string): Promise<boolean> {
  return sousIdentite(req.utilisateur!.id, async (db) => {
    const { rows } = await db.query("select 1 from pieces_v where id = $1", [pieceId]);
    return rows.length > 0;
  });
}

async function exigerPieceVisible(req: Request, pieceId: string): Promise<void> {
  if (!(await pieceVisible(req, pieceId))) {
    throw new PieceIntrouvable(`pièce introuvable : ${pieceId}`);
  }
}

/**
 * Exécute un geste et répond. Les refus rédigés et les introuvables gardent
 * leur statut ; tout le reste rend son message, parce que la chaîne de
 * lecture parle en codes que l'écran sait traduire.
 */
function repondre(res: Response, next: NextFunction, travail: () => Promise<unknown>): void {
  travail()
    .then((resultat) => {
      res.json(resultat);
    })
    .catch((erreur: unknown) => {
      if (erreur instanceof z.ZodError) {
        res.status(400).json({ erreur: "appel invalide" });
        return;
      }
      if (erreur instanceof SaisieInvalide) {
        res.status(400).json({ erreur: erreur.message });
        return;
      }
      if (erreur instanceof PieceIntrouvable || erreur instanceof RpcIntrouvable) {
        res.status(404).json({ erreur: erreur.message });
        return;
      }
      // Un refus de lecture est une décision de la base, pas une panne : 4xx,
      // avec son motif tel quel. La file hors ligne relance sur 5xx et
      // abandonne sur 4xx — un refus déguisé en panne se rejouerait sans fin.
      if (erreur instanceof LectureRefusee) {
        res.status(403).json({ erreur: erreur.motif, motif: erreur.motif });
        return;
      }
      const absent = introuvableLisible(erreur);
      if (absent) {
        res.status(404).json({ erreur: absent });
        return;
      }
      // Un fichier déposé qui n'est pas un PDF lisible est une faute du
      // fichier, pas une panne : pdf.js le nomme (ANO-036, PDF tronqué).
      if (erreur instanceof Error && PDF_ILLISIBLE.has(erreur.name)) {
        res.status(422).json({ erreur: "le fichier déposé n'est pas un PDF lisible" });
        return;
      }
      const refus = refusLisible(erreur);
      if (refus) {
        res.status(400).json({ erreur: refus });
        return;
      }
      if (erreur instanceof Error) {
        console.error(`[malica] ${erreur.message}`);
        res.status(500).json({ erreur: erreur.message });
        return;
      }
      next(erreur);
    });
}

/* ------------------------------------------------------------ la lecture */

/**
 * Lire une pièce — ou rejoindre la lecture qui tourne déjà pour elle.
 *
 * `?attendre=0` lance sans attendre : c'est ce que demande la file hors
 * ligne du téléphone, qui n'a pas à tenir une requête ouverte pendant des
 * minutes. Sans ce paramètre, la réponse est le résultat, comme avant.
 *
 * ===================================== L'ACCUSÉ PART APRÈS L'ÉCRITURE, PAS AVANT
 *
 * Cette route répondait `{enCours:true}` sur une promesse en MÉMOIRE DU
 * PROCESSUS. Le téléphone tenait donc un accusé de prise en charge que rien
 * ne portait : le processus meurt, la lecture meurt, et le refus d'une
 * lecture d'arrière-plan s'est déjà perdu de cette façon.
 *
 * Le travail s'enregistre maintenant D'ABORD, dans `fabrique.travaux`, et
 * l'accusé ne part qu'après ce retour. C'est la règle qui justifie toute la
 * file durable, et c'est l'ordre des deux instructions qui la tient.
 */
malica.post("/lectures/:pieceId", (req, res, next) => {
  repondre(res, next, async () => {
    const pieceId = Uuid.parse(req.params["pieceId"]);
    const depart = Date.now();

    if (req.query["attendre"] === "0") {
      // D'ABORD la trace durable. Si elle échoue, l'appelant le sait : on ne
      // répond pas « en cours » sur rien.
      const travail = await api(req).rpc<{ travailId: string; deja: boolean }>(
        "fabrique",
        "enregistrerLecture",
        [pieceId],
      );
      /*
       * ENSUITE le coureur, et c'est lui qui PREND le travail en base.
       *
       * La prise est un fait inscrit : si ce processus meurt pendant la
       * lecture, le travail redevient prenable tout seul passé son âge
       * d'abandon — sans balayeur, et sans que personne ait à redemander.
       *
       * Il tourne sous l'identité de l'appelant, parce que `travail_prendre`
       * et `lecture_consommer` répondent à la RLS et qu'aucun chemin
       * utilisateur n'emprunte un rôle privilégié (R6). La conséquence est
       * nommée : une reprise après redémarrage attend le prochain appel d'un
       * membre de cette organisation. Un démon qui balaierait toutes les
       * organisations exige une identité de service, qui n'existe pas — c'est
       * dit au rapport, ce n'est pas supposé.
       */
      coureurDeLectures(req.utilisateur!.id, pieceId);
      return { enCours: true, travailId: travail.travailId, deja: travail.deja };
    }

    await exigerPieceVisible(req, pieceId);
    const lecture = registre<Awaited<ReturnType<typeof readPieceFlow>>>().lireOuRejoindre(
      pieceId,
      () => readPieceFlow(api(req), pieceId),
    );
    const resultat = await lecture;
    // La durée réelle d'une lecture, mesurée côté serveur : c'est elle qui
    // dit si la personne attend dix secondes ou quatre minutes. Atelier
    // seulement — en service, cette mesure appartient à la télémétrie.
    if (process.env["NODE_ENV"] !== "production") {
      console.info(
        `[lecture] ${pieceId} terminée en ${Math.round((Date.now() - depart) / 1000)} s (${resultat.model})`,
      );
    }
    return resultat;
  });
});

/**
 * Une lecture est-elle en cours pour cette pièce ? L'écran le demande quand
 * il revient — après un verrouillage, un rechargement, une coupure — pour
 * attendre le résultat au lieu d'annoncer une panne ou de relancer.
 */
malica.get("/lectures/:pieceId", (req, res, next) => {
  repondre(res, next, async () => {
    const pieceId = Uuid.parse(req.params["pieceId"]);
    // Une pièce qu'on ne voit pas n'a, pour soi, aucune lecture en cours : la
    // même réponse que pour une pièce qui n'existe pas, et rien n'apprend
    // qu'elle existe ailleurs (ANO-003).
    if (!(await pieceVisible(req, pieceId))) return { enCours: false, depuisMs: null };
    const l = registre().etat(pieceId);
    return { enCours: l !== null, depuisMs: l ? Date.now() - l.depuis : null };
  });
});

/* ---------------------------------------------------- la carte fiscale */

const TAILLE_MAX_CARTE = "12mb";

/**
 * L'œil lit la carte d'identification fiscale. Les octets arrivent tels
 * quels dans le corps — une image ou un PDF de plusieurs mégaoctets n'a pas
 * sa place dans un JSON, et `/rpc` s'arrête à un.
 *
 * Lire n'établit rien : la lecture propose ce qu'elle a vu, c'est l'expert
 * qui arrête la fiche (R10), par `identite.etablirFiche`.
 */
malica.post("/carte", raw({ type: () => true, limit: TAILLE_MAX_CARTE }), (req, res, next) => {
  repondre(res, next, async () => {
    const jurisdiction = z.string().min(2).max(8).parse(req.query["jurisdiction"]);
    const octets = req.body as Buffer;
    if (!Buffer.isBuffer(octets) || octets.length === 0) throw new SaisieInvalide("carte.vide");
    const mime = req.headers["content-type"]?.split(";")[0]?.trim() || "image/jpeg";

    // Les régimes viennent de la base AVANT la lecture : le désignateur
    // choisit dans une liste, il n'invente pas un intitulé.
    const regimes = await api(req).rpc<
      Array<{ axe: "imposition" | "tva"; code: string; libelle: string }>
    >("identite", "regimesDisponibles", [jurisdiction]);

    return lireCarteFiscale({
      dataUrl: `data:${mime};base64,${octets.toString("base64")}`,
      mime,
      bytes: new Uint8Array(octets),
      regimes,
    });
  });
});

/* ------------------------------------------------------------- Malica */

const Question = z.object({
  tenantId: Uuid,
  pieceId: Uuid.nullish(),
  question: z.string().trim().min(2).max(4000),
  locale: Locale,
  mode: z.enum(["reasoner", "chat"]).default("reasoner"),
  conversationId: Uuid.nullish(),
});

malica.post("/demander", (req, res, next) => {
  repondre(res, next, async () => {
    const q = Question.parse(req.body);
    return askMalica(api(req), {
      tenantId: q.tenantId,
      pieceId: q.pieceId ?? null,
      question: q.question,
      locale: q.locale,
      mode: q.mode,
      conversationId: q.conversationId ?? null,
    });
  });
});

const QuestionDuCabinet = z.object({
  tenantId: Uuid,
  question: z.string().trim().min(3).max(4000),
  locale: Locale,
});

/** La question libre de l'expert au corpus — même moteur, sans dossier ni arbitrage. */
malica.post("/conseil", (req, res, next) => {
  repondre(res, next, async () => {
    const q = QuestionDuCabinet.parse(req.body);
    return repondreAuCabinet(api(req), q);
  });
});

/* ------------------------------------------------------------ rédaction */

malica.post("/pv", (req, res, next) => {
  repondre(res, next, async () => {
    const saisie = z.object({ pvId: Uuid, locale: Locale }).parse(req.body);
    return redigerLePv(api(req), saisie);
  });
});

const Briefing = z.object({
  cabinetId: Uuid,
  clientId: Uuid,
  /** L'adresse de la personne qui reçoit le dossier. */
  collaborateur: z.string().trim().min(1).max(200),
  langue: z.string().min(2).max(8),
});

malica.post("/briefing", (req, res, next) => {
  repondre(res, next, async () => {
    const saisie = Briefing.parse(req.body);
    return redigerLeBriefing(api(req), saisie);
  });
});
