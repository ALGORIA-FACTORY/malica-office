/**
 * Le geste de Malica : lire le dossier, répondre, se faire journaliser.
 * Aucun chiffre n'est inventé : la consigne système l'interdit et le dossier
 * transmis ne contient que des valeurs déjà produites par le Socle.
 *
 * ============================================================== L'ARBITRAGE
 *
 * Quand la question relève du conseil — appliquer ou interpréter une règle —
 * la réponse ne part pas toujours seule. Le modèle le dit lui-même, dans un
 * objet structuré, avec sa certitude et ses sources ; ce module compare cette
 * certitude au seuil du cabinet mandaté. Au-dessus, la réponse part et le
 * cabinet est en copie. En dessous, le client lit « votre comptable relit ma
 * réponse », et la réponse attend dans la file d'arbitrage du cabinet.
 *
 * Sans cabinet mandaté, elle répond avec ses citations et dit qu'aucun expert
 * ne l'a relue. Sans source dans le corpus, sa certitude vaut zéro, quoi
 * qu'elle en pense — un avis sans article n'est pas un avis.
 */

import type { AppelApi } from "../appel-local.ts";
import { texte } from "@malica/socle/conseil";
import type { ContexteConseil } from "@malica/socle/ports/repositories";

import {
  callDeepSeek,
  DeepSeekError,
  type DeepSeekMessage,
  type DeepSeekRole,
} from "./deepseek.ts";
import { loadMalicaContext, type MalicaContext } from "./context.ts";
import {
  consigneDeForme,
  doitEtreRelue,
  lireReponseDeConseil,
  partAuCabinet,
  type ReponseDeConseil,
} from "./conseil.ts";
import {
  chercherDansLeDroit,
  enTexte,
  parametresEnTexte,
  parametresPour,
  type FragmentDeDroit,
  type ParametreFiscal,
} from "./corpus.ts";
import { controler } from "./controles.ts";
import type { ReponseAuCabinet, ReponseDeMalica, Verdict } from "@malica/socle/ports/malica";

/**
 * Tous les nombres que le dossier porte.
 *
 * On balaie le dossier tel qu'il a été transmis, sans savoir ce que chaque
 * nombre signifie : la question n'est pas « ce montant est-il un débit ou un
 * solde », mais « ce chiffre était-il sous ses yeux ». Un contrôle qui
 * prétendrait comprendre la structure se tromperait au premier champ ajouté.
 *
 * Généreux à dessein : mieux vaut laisser passer un chiffre réellement présent
 * que crier sur une valeur légitime. Le contrôle vise l'invention, pas
 * l'approximation.
 */
function chiffresDuDossier(dossier: MalicaContext): string[] {
  const vus = new Set<string>();
  for (const m of JSON.stringify(dossier).matchAll(/-?\d+(?:\.\d+)?/g)) {
    const valeur = m[0].replace(/^-/, "");
    vus.add(valeur);
    // « 64.600 » et « 64.6 » sont le même montant écrit à deux précisions.
    if (valeur.includes(".")) vus.add(valeur.replace(/0+$/, "").replace(/\.$/, ""));
  }
  return [...vus];
}

/** Un taux du paramétrage s'écrit aussi bien « 0.19 » que « 19 % ». */
function chiffresDuParametrage(parametres: readonly ParametreFiscal[]): string[] {
  return parametres.flatMap((p) => {
    const brut = p.valeur.replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(brut)) return [brut];
    const n = Number(brut);
    return p.forme === "taux" && n > 0 && n < 1
      ? [brut, String(Math.round(n * 1000) / 10)]
      : [brut];
  });
}

const LANGUES: Record<string, string> = {
  fr: "français",
  en: "English",
  ar: "العربية",
};

/**
 * La doctrine de Malica.
 *
 * ===================================================== CE QUI TIENT ICI, ET
 * ===================================================== CE QUI TIENT AILLEURS
 *
 * Une consigne ne peut demander que ce qu'un modèle peut faire SEUL, avec ce
 * qu'on lui a mis sous les yeux. Tout le reste appartient à l'un des deux
 * autres exécutants, et l'écrire ici serait du théâtre :
 *
 *   la RECHERCHE  — « cherche l'exonération, le tableau annexé, la convention »
 *                   est une instruction de requête. Dire à un modèle de
 *                   chercher ce qu'il ne peut pas interroger ne cherche rien.
 *   les CONTRÔLES — « vérifie que chaque affirmation a son texte », « vérifie
 *                   que l'exercice n'est pas prescrit » se vérifient de
 *                   l'extérieur, mécaniquement. Un modèle qui se relit dans le
 *                   même appel se relit avec le raisonnement qui a produit
 *                   l'erreur.
 *
 * Ce qui reste ici est ce qu'aucune requête et aucun contrôle ne peuvent
 * faire : peser un texte, choisir entre deux règles, dire un doute, et parler
 * à quelqu'un.
 *
 * Éprouvé : les règles qui PRENNENT sont courtes et portent un contre-exemple.
 * « le titre est "TVA française", pas "TVA française hors compétence" » a
 * corrigé du premier coup ce que trois lignes d'explication n'obtenaient pas.
 */
function systemPrompt(locale: string): string {
  const langue = LANGUES[locale] ?? LANGUES["fr"];
  return [
    "Tu es Malica, l'assistante fiscale et comptable d'un cabinet d'expertise comptable tunisien.",
    "Tu raisonnes comme un expert-comptable membre de l'OECT qui exerce en fiscalité depuis vingt ans : tu connais la loi, tu connais la position de l'administration, et tu ne confonds jamais les deux.",
    `Tu réponds exclusivement en ${langue}.`,
    "",
    "CE QUE TU REÇOIS — et rien d'autre n'existe",
    "Le dossier du client et ses écritures. Le paramétrage daté : taux, seuils, montants, délais. Les textes retrouvés, chacun avec son autorité, son statut, ses dates et sa publication.",
    "Tu ne réponds JAMAIS de mémoire. Un texte, un article, un chiffre qui ne t'a pas été transmis n'existe pas pour toi — même si tu crois le connaître, même si tu es sûre. C'est la règle qui commande toutes les autres.",
    "",
    "LES CHIFFRES",
    "1. Tu ne calcules jamais : aucune addition, aucune conversion, aucun arrondi, aucun cumul. Les montants du dossier ont été produits par le Socle ; tu les restitues.",
    "2. Un taux, un seuil, un montant ou un délai réglementaire vient du PARAMÉTRAGE, jamais du texte de loi. Un article porte souvent plusieurs chiffres, et en choisir un serait l'interpréter. Le paramétrage, lui, dit lequel s'applique, depuis quand, et sur quel article il se fonde.",
    "3. Une valeur qui n'est pas marquée « confirmé » n'est pas un chiffre : tu dis qu'elle n'est pas établie, et tu ne l'emploies pas.",
    "4. Un chiffre absent se dit absent, avec le geste qui le produirait. Tu n'estimes jamais, tu n'arrondis jamais « à peu près ».",
    "5. L'enjeu chiffré d'un risque — un rappel, une pénalité — ne se calcule pas non plus. Si le montant t'est fourni, donne-le ; sinon nomme les éléments qui le composent et dis que le cabinet doit le chiffrer. Un dirigeant a besoin de l'ordre de grandeur, pas d'un nombre inventé.",
    "",
    "LE DROIT",
    "6. Tu lis le droit dans les textes transmis, et nulle part ailleurs. S'ils ne répondent pas, tu dis que tu n'as pas le texte — tu n'énonces pas une règle de mémoire.",
    "7. Toute règle citée porte son article ET depuis quand elle vaut : « l'article 7 du code de la TVA, depuis la loi de finances 2018 ». Sans les deux, l'affirmation ne se vérifie pas.",
    "8. La hiérarchie commande l'ordre de lecture : convention internationale ratifiée, puis loi et loi de finances et décret-loi, puis décret, puis arrêté, puis doctrine administrative. Le texte supérieur l'emporte.",
    "9. À rang égal, deux règles tranchent : le postérieur l'emporte sur l'antérieur, et le spécial déroge au général — mais seulement dans son champ.",
    "10. Une convention ne crée JAMAIS l'impôt. Elle répartit le droit d'imposer et plafonne les taux. Si le droit interne n'impose pas, la convention ne rend rien imposable ; s'il impose au-delà du plafond conventionnel, c'est le plafond qui vaut — à condition que le bénéficiaire justifie de sa résidence fiscale. Sans certificat de résidence, le taux de droit commun s'applique. Dès qu'un paiement franchit la frontière, « quelle convention ? » précède « quel taux ? ».",
    "11. Une note commune de la DGELF n'oblige QUE l'administration : le client peut s'en prévaloir, elle ne peut pas lui être opposée comme une loi, et le juge n'est pas tenu de la suivre. Quand tu t'appuies dessus, tu le dis dans la phrase même.",
    "12. Un article dont le statut n'est pas « en vigueur » ne fonde aucune réponse actuelle. Tu dis son état, tu nommes ce qui l'a remplacé, et tu ne le cites que pour le passé.",
    "13. Le droit applicable est celui du FAIT GÉNÉRATEUR, pas celui d'aujourd'hui. Une question sur un exercice clos se traite avec le droit de cet exercice-là.",
    "14. Un texte dont la lecture est marquée « partiel » ou « incertain » se rend en SENS, jamais entre guillemets. Écris « selon la loi de finances 1988, le taux était alors de 17 % », jamais « l'article dispose : “…” ».",
    "15. L'arabe et le français font foi tous les deux. Quand le texte français dont tu disposes a expiré et qu'une édition arabe plus récente dit la même chose, appuie-toi sur elle et écris-le. Quand les deux versions divergent, signale-le au lieu de choisir.",
    "16. Le corpus est TUNISIEN, et lui seul. Sur une question de droit étranger tu refuses, même si des articles tunisiens proches te sont transmis : même matière, pas même droit.",
    "",
    "AVANT DE CONCLURE",
    "17. Ne conclus jamais sur un seul article. Une exonération, un tableau annexé, un seuil, un régime d'incitation, une mesure transitoire ou une convention peut défaire ce que tu viens de lire. Si le texte qui pourrait te contredire ne t'a pas été transmis, dis-le — ne conclus pas comme s'il n'existait pas.",
    "18. Le taux dépend de l'OPÉRATION, jamais de l'entreprise. « Quel taux pour ma société ? » n'a pas de réponse : « quel taux pour ce que vous vendez » en a une.",
    "19. Une charge non comptabilisée n'est jamais déductible, quelle que soit la règle fiscale. Le traitement comptable se pose avant le retraitement fiscal.",
    "20. Avant de répondre, vérifie que tu sais : la nature de l'opération, la qualité des parties, la date du fait générateur. S'il t'en manque un ET qu'il change la réponse, pose UNE question — la plus discriminante — APRÈS avoir donné ce que tu sais déjà. Jamais un questionnaire, jamais avant d'avoir aidé.",
    "20 bis. Le régime du client — réel ou forfaitaire, assujetti ou non à la TVA, son secteur, sa clôture d'exercice — t'est donné dans sa fiche. Tu t'en sers sans le lui redemander. Quand la fiche est absente ou qu'un champ y manque, tu ne SUPPOSES pas : un dossier sans régime connu n'est pas un dossier au régime réel. Tu dis que le régime n'est pas renseigné et que la réponse en dépend.",
    "",
    "LE DOUTE — trois sorties, et une seule est un refus",
    "21. Texte clair, en vigueur, applicable : tu conclus. Réponse ferme, fondement cité.",
    "22. Pas de texte mais une position de l'administration : tu conclus avec réserve, en disant ce que cette position vaut.",
    "23. Textes contradictoires, ou silence : tu n'inventes pas de conclusion. Tu exposes ce que tu as, tu le classes par autorité, tu formules la question précise à poser et tu dis qui doit trancher. Ce n'est pas « je ne sais pas » : c'est le travail fait jusqu'où il peut aller.",
    "",
    "LA FORME",
    "24. La réponse d'abord, en UNE phrase, dans les mots du client. Le fondement après. La nuance en dernier. « Vos achats sont à 19 %, et c'est correct » précède « c'est le taux normal, fixé par l'article 7 ».",
    "25. Aucune mécanique interne ne sort. Ni bornes d'édition, ni identifiants d'écriture, ni le mot « référentiel », ni le nom des sections qu'on te transmet. Un comptable dit « depuis la loi de finances 2018 », pas « en vigueur du 01/01/2023 au 01/01/2024 ».",
    "26. Le dossier est à lui ; le droit n'est à personne. Ne dis jamais « les textes de votre dossier » — dis « les textes que j'ai sous les yeux ».",
    "27. Tu ne renvoies JAMAIS le client chercher ce qui te manque. « Consultez vos sources officielles », « transmettez-moi la loi de finances » : il paie précisément pour ne pas avoir à le faire. Le trou est le nôtre. Tu dis ce que tu sais, tu dis en une phrase ce qui manque, et tu t'arrêtes là.",
    "",
    "LE FIL",
    "28. Une conversation change parfois de sujet. Quand la question ne prolonge pas la précédente, réponds à la nouvelle sans y mêler l'ancienne : les chiffres et les articles du sujet précédent ne valent plus. Ne propose pas d'ouvrir un autre fil — prends acte, et réponds.",
    "29. Quand elle la prolonge, au contraire, appuie-toi sur ce qui est déjà établi plutôt que de le redemander.",
    "",
    "Style : sobre, dense, orienté action. Trois phrases quand trois suffisent. Pas d'emoji, pas de flatterie, pas de préambule.",
  ].join("\n");
}

/**
 * L'appel, en sortie structurée.
 *
 * Le mode JSON du fournisseur garantit un objet ; s'il le refuse pour ce
 * modèle — un 400, pas une panne —, on rappelle sans le mode : la consigne
 * demande l'objet de toute façon, et la lecture sait retomber sur du texte.
 */
async function appelerEnJson(input: {
  apiKey: string;
  role: DeepSeekRole;
  messages: DeepSeekMessage[];
}): Promise<Awaited<ReturnType<typeof callDeepSeek>>> {
  try {
    return await callDeepSeek({ ...input, format: "json" });
  } catch (err) {
    if (err instanceof DeepSeekError && err.status === 400) {
      return callDeepSeek(input);
    }
    throw err;
  }
}

/** Ce que le fil garde, tel que l'API le rend. */
interface MessageDuFil {
  role: "user" | "assistant";
  contenu: string;
}

/**
 * Combien de tours du fil entrent dans l'invite.
 *
 * Un fil peut courir sur cent messages ; les envoyer tous coûterait cher et
 * noierait la question du jour. Seize tours couvrent une conversation de
 * travail, et la règle 11 dit à Malica quoi faire de ce qui précède.
 */
const TOURS_TRANSMIS = 16;

/**
 * Le titre du fil, écrit par Malica après le premier échange.
 *
 * Un appel séparé, en mode conversation — le moins cher — et court : on ne
 * demande qu'une ligne. S'il échoue, le fil reste sans titre plutôt que d'en
 * porter un faux ; la liste montre alors le début de la question.
 *
 * ============================================================ CE QUI EST RÉGLÉ
 *
 * Éprouvée sur huit échanges de natures différentes — un chiffre, du droit, un
 * refus, un suivi. Trois défauts sont sortis de la première version, et chaque
 * ligne ci-dessous en corrige un :
 *
 *   « TVA française hors compétence »   le titre nommait le VERDICT. Qui
 *                                      parcourt sa liste cherche un sujet, pas
 *                                      un jugement porté dessus.
 *   « Portée des notes administratives »  le terme exact — note commune — était
 *                                      remplacé par un mot plus vague, et le
 *                                      fil devenait introuvable.
 *   huit mots au lieu de six           la limite n'était pas tenue faute d'être
 *                                      dite deux fois.
 */
async function nommerLeFil(
  apiKey: string,
  question: string,
  reponse: string,
  locale: string,
): Promise<string | null> {
  const langue = LANGUES[locale] ?? LANGUES["fr"];
  try {
    const r = await callDeepSeek({
      apiKey,
      role: "chat",
      messages: [
        {
          role: "system",
          content: [
            `Tu nommes une conversation comptable. Tu réponds en ${langue}.`,
            "Un groupe nominal de trois à six mots — SIX AU MAXIMUM — qui dit LE SUJET : « Déductibilité du véhicule de service », « Crédit de TVA d'août ».",
            "Tu nommes le SUJET, jamais la réponse ni le verdict. Pour une question sur la TVA française à laquelle tu ne peux pas répondre, le titre est « TVA française », pas « TVA française hors compétence ».",
            "Tu gardes le terme exact employé — « note commune », « acompte provisionnel », « droit de timbre » — sans le remplacer par un mot plus général.",
            "Tu ne précises pas la Tunisie : tout ce dossier l'est, et le dire à chaque titre gaspille deux mots sur six.",
            "Pas de guillemets, pas de point final, pas de phrase, pas de verbe conjugué. Le titre seul, rien d'autre.",
          ].join("\n"),
        },
        { role: "user", content: `Question : ${question}\n\nRéponse : ${reponse.slice(0, 600)}` },
      ],
    });
    const titre = r.answer.trim().replace(/^["'«»\s]+|["'«»\s.]+$/g, "");
    return titre.length > 0 ? titre.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/**
 * Les contrôles, et le journal qu'ils laissent.
 *
 * Ils tournent APRÈS que la réponse est rangée, et ne la retiennent pas :
 * ce sont des requêtes en base, quelques millisecondes, et leur verdict va
 * au journal — pas à l'écran du client. Leur échec est silencieux, et c'est
 * délibéré : un contrôle qui ferait échouer une réponse juste ferait plus de
 * mal qu'il n'en évite. Il mesure, il n'arbitre pas.
 */
async function controlerLaReponse(
  api: AppelApi,
  input: {
    reponse: string;
    fragments: readonly FragmentDeDroit[];
    chiffresAutorises: readonly string[];
  },
): Promise<Verdict[]> {
  const editions =
    input.fragments.length > 0
      ? await api.rpc<Array<{ corpus: string; numero: string; validFrom: string; langue: string }>>(
          "corpus",
          "editionsPlusRecentes",
          [
            input.fragments.map((f) => ({
              corpus: f.corpus,
              numero: f.numero,
              validFrom: f.validFrom,
            })),
          ],
        )
      : [];
  return controler({
    reponse: input.reponse,
    fragments: input.fragments,
    chiffresAutorises: input.chiffresAutorises,
    aujourdhui: new Date().toISOString().slice(0, 10),
    editionsPlusRecentes: editions,
  });
}

export async function askMalica(
  api: AppelApi,
  input: {
    tenantId: string;
    pieceId?: string | null;
    question: string;
    locale: string;
    /**
     * Le fil où ranger l'échange. `null` en ouvre un neuf.
     *
     * L'historique n'arrive PLUS du navigateur : il se relit en base à partir
     * de cet identifiant. Un fil envoyé par le client serait un fil qu'il peut
     * écrire — on pourrait faire dire à Malica qu'elle a déjà validé ce
     * qu'elle n'a jamais vu, puis s'en prévaloir.
     */
    conversationId?: string | null;
    /** Le raisonneur pour l'analyse, la conversation pour le fil rapide. */
    mode?: DeepSeekRole;
  },
): Promise<ReponseDeMalica> {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY absente : Malica ne peut pas répondre");

  // Le fil d'abord : sans lui, on ne saurait pas quoi relire ni où ranger.
  const conversationId =
    input.conversationId ??
    (await api.rpc<{ id: string }>("conversations", "ouvrirNouvelle", [input.tenantId])).id;

  const passe = await api.rpc<MessageDuFil[]>("conversations", "ouvrir", [conversationId]);

  const dossier = await loadMalicaContext(api, input.tenantId, input.pieceId ?? null);
  const role: DeepSeekRole = input.mode ?? "reasoner";

  /*
   * Le droit entre dans la réponse.
   *
   * La recherche peut échouer — l'encodeur est un service extérieur. On ne
   * laisse PAS cet échec empêcher la réponse : une question sur le dossier
   * (« quel est mon crédit de TVA ? ») n'a besoin d'aucun texte de loi, et la
   * faire échouer parce qu'un encodeur ne répond pas serait absurde.
   *
   * Mais on ne le tait pas non plus. Sans section DROIT, la règle 6 impose à
   * Malica de dire qu'elle n'a pas le texte sous les yeux — ce qui est vrai,
   * et se distingue de « le corpus ne dit rien ».
   */
  let droit = "";
  let fragments: FragmentDeDroit[] = [];
  /*
   * LA RECHERCHE N'ÉCHOUE PLUS EN SILENCE.
   *
   * Ce `catch` remettait `droit` à vide et passait à la suite. Le produit se
   * comportait alors exactement comme si le corpus était muet — Malica
   * répondait de mémoire, sans source, donc à certitude zéro, donc retenue —
   * et PERSONNE ne l'apprenait : ni journal, ni message, ni trace.
   *
   * Encodeur injoignable, clé refusée, délai dépassé : ce sont des pannes, et
   * une panne se dit. On la note côté serveur avec sa cause, et l'on garde le
   * motif pour que la réponse puisse l'avouer au lieu de faire semblant.
   */
  let corpusMuet: string | null = null;
  try {
    fragments = await chercherDansLeDroit(api, input.question);
    droit = enTexte(fragments);
    if (fragments.length === 0) corpusMuet = "aucun texte ne répond à cette question";
  } catch (erreur) {
    droit = "";
    corpusMuet = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(`[conseil] recherche dans le droit indisponible : ${corpusMuet}`);
  }

  /*
   * Le paramétrage — le chiffre avec son fondement.
   *
   * Il vient APRÈS la recherche, et pas avant : les paramètres se choisissent
   * d'après les articles remontés. Un taux et l'article qui le fixe arrivent
   * ainsi ensemble, et ne peuvent pas se contredire.
   *
   * Son échec n'empêche pas la réponse — mais alors Malica n'a aucun chiffre
   * réglementaire, et la règle 5 lui interdit d'en produire un. Elle refusera,
   * ce qui est correct.
   */
  let parametres: ParametreFiscal[] = [];
  let parametrage = "";
  try {
    parametres = await parametresPour(api, {
      jurisdiction: dossier.organisation.jurisdiction,
      question: input.question,
      fragments,
    });
    parametrage = parametresEnTexte(parametres);
  } catch {
    parametrage = "";
  }

  const messages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt(input.locale) },
    {
      role: "system",
      content: `DOSSIER (seule source de vérité chiffrée) :\n${JSON.stringify(dossier)}`,
    },
    ...(parametrage
      ? [
          {
            role: "system" as const,
            content:
              "PARAMÉTRAGE (seule source des taux, seuils, montants et délais — " +
              `chaque valeur est datée et cite le texte qui la fonde) :\n${parametrage}`,
          },
        ]
      : []),
    ...(droit
      ? [
          {
            role: "system" as const,
            content:
              "DROIT (seule source de vérité juridique — les textes rapportés du corpus " +
              `tunisien pour cette question) :\n${droit}`,
          },
        ]
      : [
          /*
           * Le silence se dit. Sans cette phrase, le modèle ne sait pas s'il
           * n'a rien reçu parce que rien ne répond, ou parce que la recherche
           * est tombée — et il comble, de mémoire. C'est exactement ce qu'il a
           * fait le 4 octobre 2026.
           */
          {
            role: "system" as const,
            content:
              "DROIT : AUCUN TEXTE ne t'a été transmis pour cette question " +
              `(${corpusMuet ?? "raison inconnue"}). Dis-le à la personne, en une ` +
              "phrase, et n'énonce aucune règle de mémoire. « sources » vide, " +
              "« certitude » 0.",
          },
        ]),
    { role: "system", content: consigneDeForme() },
    ...passe
      .slice(-TOURS_TRANSMIS)
      .map((m) => ({ role: m.role, content: m.contenu }) as DeepSeekMessage),
    { role: "user", content: input.question },
  ];

  let result: Awaited<ReturnType<typeof callDeepSeek>> | null = null;
  let failure: DeepSeekError | Error | null = null;
  try {
    result = await appelerEnJson({ apiKey, role, messages });
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
  }

  // Le journal est écrit MÊME en cas d'échec, et avant de relancer l'erreur :
  // un appel qui a coûté un jeton doit laisser une trace, réussi ou non.
  //
  // Son propre échec ne remonte pas. L'ancien code ignorait l'erreur de la RPC
  // en ne déstructurant que `data` ; la conserver telle quelle n'est pas de la
  // négligence reconduite mais la seule issue correcte : laisser le journal
  // masquer l'erreur qu'il journalise donnerait à l'appelant « API injoignable »
  // là où le vrai motif est « DeepSeek a refusé ».
  const runId = await api
    .rpc<string | null>("capture", "journaliserAgent", [
      {
        tenantId: input.tenantId,
        agent: "malica.conseil",
        model: result?.model ?? (role === "reasoner" ? "deepseek-reasoner" : "deepseek-chat"),
        role,
        status: result ? "ok" : "error",
        latencyMs: result?.latencyMs ?? 0,
        tokensIn: result?.tokensIn ?? null,
        tokensOut: result?.tokensOut ?? null,
        pieceId: input.pieceId ?? null,
        erreur: failure ? failure.message.slice(0, 500) : null,
      },
    ])
    .catch(() => null);

  if (!result) throw failure ?? new Error("Malica indisponible");

  /*
   * Ce que la réponse est, relu.
   *
   * Le modèle a rendu un objet : la réponse, si c'est du conseil, sa
   * certitude, ses sources, son doute. Les sources sont relues dans les
   * fragments transmis — une source qui n'y figure pas tombe.
   */
  const lu: ReponseDeConseil = lireReponseDeConseil(result.answer, fragments);

  /*
   * L'arbitrage.
   *
   * Seulement pour une question de conseil posée par le CLIENT — le cabinet
   * qui interroge le dossier de son client n'a pas à s'arbitrer lui-même. Le
   * contexte vient d'une fonction gardée : le seuil du cabinet n'est pas
   * lisible par le client, et c'est la base qui le lit pour lui.
   */
  let contexte: ContexteConseil | null = null;
  if (lu.conseil) {
    contexte = await api
      .rpc<ContexteConseil>("conseil", "contexte", [input.tenantId])
      .catch(() => null);
  }
  const arbitrable = Boolean(lu.conseil && contexte?.appelantMembre);
  const cabinet = arbitrable && contexte?.cabinetId ? contexte : null;
  /*
   * Ce n'est plus la certitude qui décide — voir `doitEtreRelue` et son test.
   * Le seuil du cabinet reste lu et affiché ; il informe, il ne retient plus.
   */
  const retenue = doitEtreRelue(lu, contexte);

  const reponseRendue = retenue
    ? texte(input.locale, "pme.conseil.relecture")
    : arbitrable && !cabinet
      ? `${lu.reponse}\n\n${texte(input.locale, "pme.conseil.sansCabinet")}`
      : lu.reponse;

  // Le fil garde l'échange. La question et la réponse partent ensemble : une
  // question rangée seule laisserait un fil qui interroge sans jamais répondre.
  await api.rpc<void>("conversations", "ajouter", [
    {
      conversationId,
      question: input.question,
      reponse: reponseRendue,
      raisonnement: result.reasoning,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: result.latencyMs,
    },
  ]);

  /*
   * La remise au cabinet — seulement si la réponse est retenue.
   *
   * Une réponse retenue qui ne pourrait pas être rangée dans la file serait
   * perdue : le client attend son comptable, et le comptable ne saurait rien.
   * Cet échec-là remonte, et c'est pourquoi il n'est pas avalé.
   *
   * Le reste ne part PAS. La conversation appartient à la personne qui l'a
   * tenue, même sous mandat : le cabinet la consulte si elle la lui partage.
   * Voir `partAuCabinet`, et le défaut qu'elle corrige.
   */
  if (cabinet && partAuCabinet(retenue)) {
    await api.rpc<{ id: string; cabinetId: string }>("conseil", "creer", [
      {
        tenantId: input.tenantId,
        conversationId,
        question: input.question,
        reponse: lu.reponse,
        sources: lu.sources,
        certitude: lu.certitude,
        doute: lu.doute,
        canal: "conversation",
        theme: lu.theme,
        langue: input.locale,
        statut: "en_attente",
      },
    ]);
  }

  let controles: Verdict[] = [];
  let messageId: string | null = null;
  try {
    controles = await controlerLaReponse(api, {
      reponse: lu.reponse,
      fragments,
      // Tout ce que le dossier porte comme valeur : c'est là, et seulement là,
      // qu'un chiffre de la réponse peut avoir sa source.
      chiffresAutorises: [...chiffresDuDossier(dossier), ...chiffresDuParametrage(parametres)],
    });

    const dernier = await api.rpc<{ id: string } | null>("conversations", "dernierMessage", [
      conversationId,
    ]);
    messageId = dernier?.id ?? null;

    if (controles.length > 0) {
      await api.rpc<void>("conversations", "journaliserControles", [
        {
          tenantId: input.tenantId,
          messageId,
          verdicts: controles.map((v) => ({ code: v.code, suite: v.suite, detail: v.detail })),
        },
      ]);
    }
  } catch {
    // Un contrôle qui ne peut pas tourner ne casse pas la réponse. Il laisse
    // simplement le message sans ligne — donc sans vert non plus.
  }

  // Le titre ne se pose qu'une fois, au premier échange. Son échec ne fait pas
  // échouer la réponse : un fil sans titre reste un fil, et la liste montre
  // alors le début de la question.
  let titre: string | null = null;
  if (passe.length === 0) {
    titre = await nommerLeFil(apiKey, input.question, lu.reponse, input.locale);
    if (titre) {
      await api.rpc<void>("conversations", "renommer", [{ conversationId, titre }]).catch(() => {
        titre = null;
      });
    }
  }

  return {
    answer: reponseRendue,
    reasoning: result.reasoning,
    model: result.model,
    latencyMs: result.latencyMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    runId: runId ?? null,
    conversationId,
    messageId,
    controles,
    titre,
    retenue,
    conseil: lu.conseil
      ? {
          conseil: true,
          theme: lu.theme,
          certitude: lu.certitude,
          sources: lu.sources,
          doute: lu.doute,
        }
      : null,
  };
}

/**
 * La réponse citée à une question libre de l'expert — même moteur, sans
 * dossier et sans arbitrage.
 *
 * L'expert n'a pas de client sous les yeux : la doctrine s'applique, mais la
 * fiche n'existe pas, et Malica ne doit pas demander le régime d'un client
 * qui n'est pas là. Elle expose la règle, ses conditions et ses exceptions.
 */
export async function repondreAuCabinet(
  api: AppelApi,
  input: { tenantId: string; question: string; locale: string },
): Promise<ReponseAuCabinet> {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY absente : Malica ne peut pas répondre");

  const organisations = await api.rpc<Array<{ id: string; jurisdiction: string }>>(
    "identite",
    "listMyOrganizations",
    [],
  );
  const cabinet = organisations.find((o) => o.id === input.tenantId);
  if (!cabinet) throw new Error("cabinet introuvable ou non autorisé");

  // Ici, l'échec de la recherche REMONTE : sans dossier, une réponse sans
  // droit n'aurait rien à dire, et « je n'ai pas pu chercher » vaut mieux
  // qu'un refus déguisé en silence du corpus.
  const fragments = await chercherDansLeDroit(api, input.question, { nb: 8 });
  let parametres: ParametreFiscal[] = [];
  try {
    parametres = await parametresPour(api, {
      jurisdiction: cabinet.jurisdiction,
      question: input.question,
      fragments,
    });
  } catch {
    parametres = [];
  }
  const droit = enTexte(fragments);
  const parametrage = parametresEnTexte(parametres);

  const messages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt(input.locale) },
    {
      role: "system",
      content:
        "CADRE : tu réponds ici à l'expert-comptable du cabinet lui-même, sur une question de droit générale. " +
        "Il n'y a pas de dossier client ni de fiche : tu ne demandes pas le régime d'un client, tu ne restitues aucun chiffre de dossier. " +
        "Tu exposes la règle, ses conditions, ses exceptions, et ce qui dépendrait du cas.",
    },
    ...(parametrage
      ? [
          {
            role: "system" as const,
            content:
              "PARAMÉTRAGE (seule source des taux, seuils, montants et délais — " +
              `chaque valeur est datée et cite le texte qui la fonde) :\n${parametrage}`,
          },
        ]
      : []),
    ...(droit
      ? [
          {
            role: "system" as const,
            content:
              "DROIT (seule source de vérité juridique — les textes rapportés du corpus " +
              `tunisien pour cette question) :\n${droit}`,
          },
        ]
      : []),
    { role: "system", content: consigneDeForme() },
    { role: "user", content: input.question },
  ];

  let result: Awaited<ReturnType<typeof callDeepSeek>> | null = null;
  let failure: Error | null = null;
  try {
    result = await appelerEnJson({ apiKey, role: "reasoner", messages });
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
  }

  await api
    .rpc<string | null>("capture", "journaliserAgent", [
      {
        tenantId: input.tenantId,
        agent: "malica.corpus",
        model: result?.model ?? "deepseek-reasoner",
        role: "reasoner",
        status: result ? "ok" : "error",
        latencyMs: result?.latencyMs ?? 0,
        tokensIn: result?.tokensIn ?? null,
        tokensOut: result?.tokensOut ?? null,
        pieceId: null,
        erreur: failure ? failure.message.slice(0, 500) : null,
      },
    ])
    .catch(() => null);

  if (!result) throw failure ?? new Error("Malica indisponible");

  const lu = lireReponseDeConseil(result.answer, fragments);

  let signale: string[] = [];
  try {
    const verdicts = await controlerLaReponse(api, {
      reponse: lu.reponse,
      fragments,
      chiffresAutorises: chiffresDuParametrage(parametres),
    });
    signale = verdicts.filter((v) => v.suite === "signaler").map((v) => v.detail);
  } catch {
    signale = [];
  }

  const noms = await api
    .rpc<Record<string, string>>("conseil", "nomsDesCorpus", [lu.sources.map((s) => s.corpus)])
    .catch(() => ({}) as Record<string, string>);

  return {
    reponse: lu.reponse,
    // Sans conseil reconnu — une question hors droit — la certitude n'a pas de sens.
    certitude: lu.conseil ? lu.certitude : 0,
    theme: lu.theme,
    sources: lu.sources.map((s) => {
      const f = fragments.find((x) => x.corpus === s.corpus && x.numero === s.numero);
      return {
        ...s,
        nom: noms[s.corpus] ?? null,
        nature: f?.nature ?? null,
        statut: f?.statut ?? null,
      };
    }),
    doute: lu.doute,
    signale,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
