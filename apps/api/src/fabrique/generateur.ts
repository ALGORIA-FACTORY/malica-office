/**
 * Le GÉNÉRATEUR de recettes — un modèle propose, le dépôt dispose.
 *
 * ================================================================= POURQUOI
 *
 * La fabrique de lecteurs fonctionne : une recette désigne à la place du
 * modèle et rend exactement la même chose. Mais AUCUNE RECETTE NE NAÎT : il
 * faut les écrire à la main, et personne n'écrira à la main un lecteur par
 * format de facture tunisienne.
 *
 * Ce module fabrique une recette CANDIDATE à partir d'exemples qualifiés. Il
 * ne touche ni la base, ni le réseau : le modèle arrive par un port
 * (`AppelDeGenerateur`), et c'est l'appelant qui le branche — sur DeepSeek en
 * production (`generateur-modele.ts`), sur un adaptateur simulé dans les
 * épreuves. Aucun fournisseur payant n'est appelé par `npm test`.
 *
 * ============================================ R3 — LE MODÈLE N'ÉMET RIEN DE LIANT
 *
 * Une recette n'est pas une valeur : c'est une STRUCTURE proposée, que le
 * validateur strict contrôle et que l'évaluation juge. Côté exécution, la
 * barrière est déjà posée par le type (`ResultatDeChamp` n'a aucune branche
 * où écrire un montant). Côté GÉNÉRATION, elle est posée ici, et elle a une
 * forme précise :
 *
 *   TOUT TEXTE D'ANCRE DE LA RECETTE PROPOSÉE DOIT APPARTENIR À L'OSSATURE
 *   COMMUNE DES EXEMPLES.
 *
 * L'ossature est l'ensemble des clés d'ancre que TOUS les exemplaires
 * partagent, et `cleDAncre` refuse par construction tout jeton qui porte un
 * chiffre. Un montant, une date, un numéro de pièce ne peuvent donc pas y
 * entrer ; et le nom d'un client qui change d'une facture à l'autre en tombe.
 * Un modèle qui recopierait une valeur lue dans la recette qu'il propose se
 * fait refuser, nommément, sans qu'on ait à le lui demander gentiment.
 *
 * ================================ POURQUOI JAMAIS UN SEUL EXEMPLE — MESURÉ
 *
 * Deux agents l'ont mesuré, et c'est la contrainte principale de ce module :
 * À UN SEUL EXEMPLE, L'OSSATURE PORTE LE NOM DU CLIENT ET DEUX ARTICLES. La
 * même facture chez un autre client passe alors de 0,0000 à 0,0960 de
 * distance. Une recette tirée d'un document unique apprendrait le nom du
 * client comme s'il était la forme du papier, et ne reconnaîtrait plus jamais
 * qu'une facture : la sienne.
 *
 * Le minimum n'est donc PAS un seuil de référentiel, et il n'est pas redéclaré
 * ici : il est importé de `interprete-reconnaissance.ts`, qui le porte avec sa
 * démonstration. À un exemple, l'ossature n'est pas plus permissive — elle
 * N'EXISTE PAS.
 *
 * Et deux exemplaires du MÊME document ne font pas deux exemples : leurs
 * empreintes de signature sont égales, et l'intersection de quelque chose avec
 * lui-même ne fait rien tomber. Ils sont dédupliqués avant le comptage.
 *
 * ========================================================= CE QU'IL NE FAIT PAS
 *
 * Il ne promeut rien, n'évalue rien, n'écrit nulle part. Une recette qui sort
 * d'ici est CANDIDATE, et rien d'autre : le cycle de vie est dans
 * `cycle.ts`, et la base en tient les transitions.
 */
import { createHash } from "node:crypto";

import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import { EXEMPLES_MINIMUM_POUR_UNE_OSSATURE } from "./interprete-reconnaissance.ts";
import { formeDuJeton } from "./interprete-texte.ts";
import { interpreter } from "./interprete.ts";
import {
  CHAMPS_DE_PIECE,
  CHAMPS_D_ARTICLE,
  CHAMPS_DE_LIGNE,
  CHOIX,
  CONTRAINTES,
  DIRECTIONS,
  ETENDUES,
  FORMES,
  MOTIFS,
  PAGES,
  SOURCES,
  VERSION_DU_LANGAGE,
  type Recette,
} from "./recette.ts";
import { validerRecette, type ExigencesDeValidation, type Refus } from "./recette-validateur.ts";
import { cleDAncre } from "./signature-ecriture.ts";
import { ossatureCommune } from "./signature-distance.ts";
import { serecouvrent } from "./signature-relations.ts";
import { signerLePlan, type ParametresDeSignature } from "./signature.ts";

/* ================================================== CE QU'ON LUI DONNE === */

/**
 * La version du générateur, inscrite dans la provenance de chaque recette.
 *
 * Elle n'est pas la version du LANGAGE : deux générateurs différents peuvent
 * produire du `recette/1`, et le jour où l'un d'eux s'avère mauvais il faut
 * pouvoir retrouver ce qu'il a produit sans relire chaque recette. « Une
 * recette qu'on ne peut pas rattacher à ce qui l'a produite n'est pas
 * auditable. »
 */
export const VERSION_DU_GENERATEUR = "generateur/1";

/**
 * Ce qu'un exemple qualifié APPORTE : un plan de jetons, et les désignations
 * attendues. Jamais de valeur — `attendu` ne porte que des `page`/`ordinal`.
 */
export interface ExempleDApprentissage {
  readonly pieceId: string;
  readonly plan: readonly PageToken[];
  /** Les champs du contrat de désignation, vers la référence attendue. */
  readonly attendu: Readonly<Record<string, TokenRef>>;
}

/** Ce que le modèle reçoit. Du texte et des noms de clés : aucune valeur lue. */
export interface InviteDeGeneration {
  readonly consigne: string;
  readonly observation: string;
}

/** Ce que le modèle rend, avec de quoi le journaliser (R8). */
export interface ReponseDeGenerateur {
  /** La recette proposée, telle quelle. Elle n'est pas crue : elle est jugée. */
  readonly recetteProposee: unknown;
  /** Le couple (modèle, rôle) sous lequel l'appel se tarife. */
  readonly modele: string;
  readonly role: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly latenceMs: number;
}

/** Le port du modèle. L'adaptateur payant est branché par l'appelant. */
export type AppelDeGenerateur = (invite: InviteDeGeneration) => Promise<ReponseDeGenerateur>;

/* =================================================== CE QU'IL REND ======= */

/**
 * Les motifs de refus propres à la GÉNÉRATION.
 *
 * Ce n'est pas un second vocabulaire de validation : une recette qui atteint
 * le validateur se fait refuser par LUI, avec ses codes, et ils remontent
 * tels quels dans `refusDuValidateur`. Les codes ci-dessous nomment ce que le
 * validateur ne peut pas voir, parce qu'il ne connaît ni les exemples ni
 * l'ossature.
 */
type MotifDeRefusDeGeneration =
  /** Moins de deux exemples DISTINCTS : l'ossature n'existe pas. */
  | "EXEMPLES_INSUFFISANTS"
  /** Les exemples ne partagent aucune ancre : il n'y a pas de forme commune. */
  | "AUCUNE_OSSATURE"
  /** Aucun exemple ne dit ce qu'il attend : il n'y a rien à apprendre. */
  | "AUCUNE_DESIGNATION_ATTENDUE"
  /** Le modèle n'a pas rendu un objet JSON. */
  | "REPONSE_ILLISIBLE"
  /** Un texte d'ancre hors du vocabulaire commun : une valeur a glissé. */
  | "ANCRE_HORS_VOCABULAIRE"
  /** Le validateur strict a refusé — ses refus sont rendus tels quels. */
  | "RECETTE_INVALIDE"
  /** La recette ne redonne pas, sur ses propres exemples, ce qui est attendu. */
  | "NE_REPRODUIT_PAS_SES_EXEMPLES";

interface RefusDeGeneration {
  readonly code: MotifDeRefusDeGeneration;
  readonly detail: string;
  /** Les refus du validateur strict, quand c'est lui qui a parlé. */
  readonly refusDuValidateur?: readonly Refus[];
}

/** Ce qu'on garde d'une génération pour pouvoir la rattacher plus tard (⑤). */
interface ProvenanceDeGeneration {
  readonly generateur: string;
  readonly langage: string;
  /** La version de la FORME des signatures : deux formes ne se comparent pas. */
  readonly signature: number;
  readonly modele: string;
  readonly role: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly latenceMs: number;
  /** Les pièces d'apprentissage retenues, et l'ossature qu'elles donnent. */
  readonly pieces: readonly string[];
  readonly ossature: readonly string[];
  /** Le vocabulaire qui a borné les ancres — voir `vocabulaireCommun`. */
  readonly vocabulaire: readonly string[];
}

export type Generation =
  | {
      readonly ok: true;
      readonly recette: Recette;
      /** L'empreinte que `fabrique.recette_versions` exige — 64 hexadécimaux. */
      readonly empreinte: string;
      readonly provenance: ProvenanceDeGeneration;
    }
  | { readonly ok: false; readonly refus: RefusDeGeneration; readonly journal: Journal | null };

/** De quoi écrire la ligne d'`agents.agent_runs`, même quand on a refusé. */
interface Journal {
  readonly modele: string;
  readonly role: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly latenceMs: number;
}

/* ========================================== CE QUE LE MODÈLE A LE DROIT DE VOIR */

/** Une observation d'un champ attendu, sur un exemple. Rien n'y est lu. */
interface ObservationDUnChamp {
  readonly exemple: number;
  readonly page: "premiere" | "derniere" | "intermediaire";
  readonly forme: string | null;
  /** Les ancres de l'ossature posées sur la même ligne imprimée, en amont. */
  readonly ancresAvant: readonly string[];
  /** … et en aval, le long de l'axe de lecture. */
  readonly ancresApres: readonly string[];
  /** Les ancres de l'ossature dans la même colonne imprimée. */
  readonly ancresDeLaColonne: readonly string[];
  /** Combien de jetons la désignation attendue couvre — 1, ou une plage. */
  readonly jetons: number;
}

const ordreDeLecture = (a: PageToken, b: PageToken) => a.page - b.page || a.ordinal - b.ordinal;

/**
 * Le VOCABULAIRE COMMUN : les mots sans chiffre que TOUS les exemplaires
 * portent. C'est lui qui borne les textes d'ancre, et pas l'ossature.
 *
 * ============================================= POURQUOI PAS L'OSSATURE, JUSTEMENT
 *
 * L'ossature est calculée pour une DISTANCE, et elle écarte les clés plus
 * courtes que `longueurMinimaleDAncre` : dans une mesure de ressemblance, un
 * mot de deux lettres n'apporte rien et ajoute du bruit. Pour ANCRER, c'est
 * l'inverse — « HT » et « TTC » sont exactement ce qui sépare trois lignes de
 * pied qui portent toutes le mot « Total », et une facture arabe met le sens
 * d'un champ dans « ر.ض ». Borner les ancres par l'ossature rendrait donc
 * impossible la recette la plus ordinaire du produit.
 *
 * La longueur minimale d'une ancre n'est pas perdue pour autant : elle est
 * jugée par le validateur strict, sous `ancre_texte_min`, qui vient du
 * référentiel et que le cabinet surcharge sans déploiement (R10). C'est le
 * bon endroit — une mention arabe de trois caractères peut porter le sens là
 * où trois caractères latins sont souvent du bruit, et cela se tranche par
 * cabinet, pas en TypeScript.
 *
 * Ce que le vocabulaire garantit reste entier : `cleDAncre` rend `null` dès
 * qu'un texte porte un chiffre, donc aucun montant, aucune date, aucun numéro
 * n'y entre ; et l'intersection fait tomber ce qui varie d'un exemplaire à
 * l'autre, donc le nom d'un client qui change.
 */
function vocabulaireCommun(plans: ReadonlyArray<readonly PageToken[]>): string[] {
  if (plans.length === 0) return [];
  const motsDe = (plan: readonly PageToken[]) => {
    const vus = new Set<string>();
    for (const t of plan) {
      const cle = cleDAncre(t.text);
      if (cle !== null) vus.add(cle);
    }
    return vus;
  };
  const [premier, ...suite] = plans as [readonly PageToken[], ...Array<readonly PageToken[]>];
  let garde = motsDe(premier);
  for (const autre of suite) {
    const siens = motsDe(autre);
    garde = new Set([...garde].filter((cle) => siens.has(cle)));
  }
  return [...garde].sort();
}

/** Le jeton visé par une référence, ou `null` si le plan ne le porte pas. */
function jetonVise(plan: readonly PageToken[], ref: TokenRef): PageToken | null {
  return plan.find((t) => t.page === ref.page && t.ordinal === ref.ordinal) ?? null;
}

/**
 * Observe un champ attendu sans jamais lire sa valeur.
 *
 * Ce qui sort d'ici est de la STRUCTURE : une classe de forme, des clés
 * d'ancre prises dans l'ossature, un rang de page, un nombre de jetons. Le
 * texte du jeton visé n'y figure pas — ni le sien, ni celui de ses voisins
 * hors ossature.
 */
function observer(
  exemple: ExempleDApprentissage,
  rang: number,
  ref: TokenRef,
  vocabulaire: ReadonlySet<string>,
  parametres: ParametresDeSignature,
  droiteAGauche: boolean,
  chiffres: "latins" | "arabes" | "les_deux",
): ObservationDUnChamp | null {
  const cible = jetonVise(exemple.plan, ref);
  if (!cible) return null;

  const pages = [...new Set(exemple.plan.map((t) => t.page))].sort((a, b) => a - b);
  const rangDeLaPage = pages.indexOf(cible.page);
  const page =
    rangDeLaPage === 0
      ? "premiere"
      : rangDeLaPage === pages.length - 1
        ? "derniere"
        : "intermediaire";

  const deLaPage = exemple.plan.filter((t) => t.page === cible.page);
  const estDuVocabulaire = (t: PageToken) => {
    const cle = cleDAncre(t.text);
    return cle !== null && vocabulaire.has(cle) ? cle : null;
  };

  const avant: string[] = [];
  const apres: string[] = [];
  const colonne: string[] = [];
  for (const t of [...deLaPage].sort(ordreDeLecture)) {
    const cle = estDuVocabulaire(t);
    if (cle === null) continue;
    if (serecouvrent(t.y0, t.y1, cible.y0, cible.y1, parametres.recouvrementDeLigne)) {
      const amont = droiteAGauche ? t.x0 > cible.x1 : t.x1 < cible.x0;
      const aval = droiteAGauche ? t.x1 < cible.x0 : t.x0 > cible.x1;
      if (amont) avant.push(cle);
      else if (aval) apres.push(cle);
    } else if (serecouvrent(t.x0, t.x1, cible.x0, cible.x1, parametres.recouvrementDeColonne)) {
      colonne.push(cle);
    }
  }

  return {
    exemple: rang,
    page,
    forme: formeDuJeton(cible.text, chiffres),
    ancresAvant: avant,
    ancresApres: apres,
    ancresDeLaColonne: colonne,
    jetons: ref.ordinalEnd === undefined ? 1 : ref.ordinalEnd - ref.ordinal + 1,
  };
}

/**
 * La consigne — le langage, et les règles qu'une proposition doit respecter.
 *
 * Les listes d'opérateurs ne sont PAS retapées : elles sont dérivées des
 * constantes de `recette.ts`. Un opérateur ajouté là-bas arrive ici tout
 * seul, et un opérateur retiré disparaît de l'invite au lieu d'y survivre.
 */
function consigne(): string {
  return [
    "Tu proposes une RECETTE DE LECTURE : une description déclarative qui DÉSIGNE",
    "des jetons sur une facture, et n'en lit jamais la valeur. Tu rends un seul",
    "objet JSON, sans commentaire et sans texte autour.",
    "",
    `La clé « version » vaut exactement « ${VERSION_DU_LANGAGE} ».`,
    "Les clés de premier niveau sont : version, sens_de_lecture, chiffres, zones,",
    "ancres, tableaux, champs, references. Aucune autre clé n'est acceptée, à",
    "aucun niveau.",
    "",
    `Motifs d'ancre : ${MOTIFS.join(", ")}. Formes : ${FORMES.join(", ")}.`,
    `Sources d'un sélecteur : ${SOURCES.join(", ")}. Directions : ${DIRECTIONS.join(", ")}.`,
    `Contraintes : ${CONTRAINTES.join(", ")}. Choix : ${CHOIX.join(", ")}.`,
    `Étendues : ${ETENDUES.join(", ")}. Pages : ${PAGES.join(", ")}.`,
    `Champs désignables : ${CHAMPS_DE_PIECE.join(", ")}.`,
    `Colonnes de lignes : ${CHAMPS_DE_LIGNE.join(", ")}.`,
    `Colonnes d'articles : ${CHAMPS_D_ARTICLE.join(", ")}.`,
    "",
    "CINQ RÈGLES, ET AUCUNE NE SE NÉGOCIE :",
    "1. Tout texte que tu écris dans un motif doit figurer MOT POUR MOT dans la",
    "   liste « vocabulaire » ci-dessous. C'est le seul vocabulaire autorisé, et",
    "   il ne contient aucune valeur : ni montant, ni date, ni numéro, ni nom de",
    "   client. Un texte hors de cette liste fait refuser ta proposition.",
    "2. Un sélecteur ne contient jamais un sélecteur : il NOMME une ancre",
    "   déclarée dans « ancres ».",
    "3. Une ancre déclarée et jamais utilisée fait refuser ta proposition.",
    "4. Un champ calé uniquement sur une zone ou un numéro de page est refusé :",
    "   une photo prise de biais déplace toute coordonnée.",
    "5. « avant » et « après » sont LOGIQUES, le long de l'axe de lecture. En",
    "   écriture de droite à gauche, « avant » est à droite.",
  ].join("\n");
}

/* ================================================== LE GÉNÉRATEUR ======== */

/** Les textes de motif d'une recette proposée, tous emplacements confondus. */
function textesDeMotif(valeur: unknown, chemin: string, sortie: Array<[string, string]>): void {
  if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => textesDeMotif(v, `${chemin}[${String(i)}]`, sortie));
    return;
  }
  if (typeof valeur !== "object" || valeur === null) return;
  const o = valeur as Record<string, unknown>;
  for (const [cle, v] of Object.entries(o)) {
    const ou = chemin === "" ? cle : `${chemin}.${cle}`;
    if (cle === "texte" && typeof v === "string") sortie.push([ou, v]);
    else textesDeMotif(v, ou, sortie);
  }
}

/**
 * Propose une recette à partir d'exemples qualifiés.
 *
 * Quatre portes, dans cet ordre, et aucune ne se saute :
 *
 *   ① assez d'exemples DISTINCTS, et une ossature non vide ;
 *   ② tout texte d'ancre appartient à l'ossature — la barrière R3 ;
 *   ③ le validateur strict, appelé et non recopié ;
 *   ④ la recette redonne, sur ses propres exemples, ce qui y est attendu.
 */
export async function proposerUneRecette(
  exemples: readonly ExempleDApprentissage[],
  exigences: ExigencesDeValidation,
  parametres: ParametresDeSignature,
  appeler: AppelDeGenerateur,
): Promise<Generation> {
  const refuser = (
    code: MotifDeRefusDeGeneration,
    detail: string,
    journal: Journal | null = null,
    refusDuValidateur?: readonly Refus[],
  ): Generation => ({
    ok: false,
    refus: { code, detail, ...(refusDuValidateur ? { refusDuValidateur } : {}) },
    journal,
  });

  /* ① Les exemples. Deux exemplaires du MÊME document ne font pas deux
     exemples : l'intersection de quelque chose avec lui-même ne fait rien
     tomber, et c'est tout ce qu'on demande à l'ossature. */
  const signes = exemples.map((e) => ({ exemple: e, signature: signerLePlan(e.plan, parametres) }));
  const vues = new Set<string>();
  const distincts = signes.filter((s) => {
    if (vues.has(s.signature.empreinte)) return false;
    vues.add(s.signature.empreinte);
    return true;
  });

  if (distincts.length < EXEMPLES_MINIMUM_POUR_UNE_OSSATURE) {
    return refuser(
      "EXEMPLES_INSUFFISANTS",
      `${String(distincts.length)} exemple(s) distinct(s) sur ${String(exemples.length)} fourni(s) : ` +
        `il en faut ${String(EXEMPLES_MINIMUM_POUR_UNE_OSSATURE)} pour qu'une ancre variable tombe. ` +
        "À un seul exemple, l'ossature porte le nom du client comme si c'était la forme du papier.",
    );
  }

  /* L'ossature, qui servira à RECONNAÎTRE : sans elle, aucune pièce ne sera
     jamais rapprochée de ce format, et la recette ne tournerait jamais. */
  const ossature = ossatureCommune(distincts.map((s) => s.signature));
  if (ossature.length === 0) {
    return refuser(
      "AUCUNE_OSSATURE",
      "les exemples ne partagent aucune ancre : il n'y a pas de forme commune à décrire",
    );
  }

  /* Le vocabulaire, qui bornera les ANCRES. Il est plus large que l'ossature,
     et la raison est écrite sur `vocabulaireCommun`. */
  const mots = vocabulaireCommun(distincts.map((s) => s.exemple.plan));
  const vocabulaire = new Set(mots);

  /* Ce qu'il y a à apprendre. Sans attente, il n'y a pas d'apprentissage —
     et une recette qui ne désigne rien passerait les trois portes suivantes. */
  const attendus = distincts.flatMap((s) => Object.keys(s.exemple.attendu));
  if (attendus.length === 0) {
    return refuser(
      "AUCUNE_DESIGNATION_ATTENDUE",
      "aucun exemple ne porte de désignation attendue : il n'y a rien à apprendre",
    );
  }
  const horsContrat = [...new Set(attendus)].filter((c) => !CHAMPS_DE_PIECE.includes(c as never));
  if (horsContrat.length > 0) {
    return refuser(
      "AUCUNE_DESIGNATION_ATTENDUE",
      "champ attendu hors du contrat de désignation : " +
        horsContrat.join(", ") +
        " ; champs admis : " +
        CHAMPS_DE_PIECE.join(", "),
    );
  }

  /* L'observation : de la structure, et rien d'autre.

     Le sens et le système de chiffres sont OBSERVÉS, pas décidés : ils
     entrent dans l'invite comme un relevé, et c'est le modèle qui écrit ceux
     de la recette. Une page « mixte » — le cas ordinaire d'une facture
     tunisienne — est observée le long de l'axe latin, puisque le langage n'a
     que deux sens et qu'un sélecteur peut déclarer le sien ; ce n'est pas un
     repli silencieux, c'est écrit ici et le modèle reste libre de l'inverser. */
  const sens = distincts[0]!.signature.sens;
  const sensDeLecture = sens === "rtl" ? "rtl" : "ltr";
  const chiffres = sens === "ltr" ? "latins" : "les_deux";
  const champs: Record<string, ObservationDUnChamp[]> = {};
  distincts.forEach((s, rang) => {
    for (const [champ, ref] of Object.entries(s.exemple.attendu)) {
      const vu = observer(
        s.exemple,
        rang + 1,
        ref,
        vocabulaire,
        parametres,
        sensDeLecture === "rtl",
        chiffres,
      );
      if (vu) (champs[champ] ??= []).push(vu);
    }
  });

  const invite: InviteDeGeneration = {
    consigne: consigne(),
    observation: JSON.stringify(
      { sens_de_lecture: sensDeLecture, chiffres, vocabulaire: mots, champs },
      null,
      1,
    ),
  };

  const reponse = await appeler(invite);
  const journal: Journal = {
    modele: reponse.modele,
    role: reponse.role,
    tokensIn: reponse.tokensIn,
    tokensOut: reponse.tokensOut,
    latenceMs: reponse.latenceMs,
  };

  const propose = reponse.recetteProposee;
  if (typeof propose !== "object" || propose === null || Array.isArray(propose)) {
    return refuser("REPONSE_ILLISIBLE", "le modèle n'a pas rendu un objet JSON", journal);
  }

  /* ② LA BARRIÈRE R3, POSÉE CÔTÉ GÉNÉRATION.

     `cleDAncre` rend `null` dès qu'un texte porte un chiffre : un montant, une
     date ou un numéro de pièce tombe donc ici avant même d'être comparé à
     l'ossature. Et un nom qui varie d'un exemplaire à l'autre n'est pas dans
     l'ossature, par construction. */
  const textes: Array<[string, string]> = [];
  textesDeMotif(propose, "", textes);
  const intrus = textes.filter(([, texte]) => {
    const cle = cleDAncre(texte);
    return cle === null || !vocabulaire.has(cle);
  });
  if (intrus.length > 0) {
    return refuser(
      "ANCRE_HORS_VOCABULAIRE",
      "texte(s) d'ancre hors du vocabulaire commun aux exemples — une valeur lue a " +
        "glissé dans la recette : " +
        intrus.map(([ou, texte]) => `${ou} = « ${texte} »`).join(" ; "),
      journal,
    );
  }

  /* ③ Le validateur strict. Appelé, jamais contourné, jamais recopié. */
  const validee = validerRecette(propose, exigences);
  if (!validee.ok) {
    return refuser(
      "RECETTE_INVALIDE",
      validee.refus.map((r) => `${r.code} (${r.ou}) : ${r.detail}`).join(" ; "),
      journal,
      validee.refus,
    );
  }

  /* ④ Elle redonne ses propres exemples. Une recette qui échoue ici n'a rien
     appris : la faire évaluer coûterait une évaluation pour rien. */
  const ecarts: string[] = [];
  for (const s of distincts) {
    const obtenu = interpreter(validee.recette, s.exemple.plan, parametres);
    for (const [champ, ref] of Object.entries(s.exemple.attendu)) {
      const resultat = obtenu.champs[champ];
      if (!resultat || !("designe" in resultat)) {
        ecarts.push(`${s.exemple.pieceId} / ${champ} : rien de désigné`);
        continue;
      }
      if (!memeReference(resultat.designe, ref)) {
        ecarts.push(
          `${s.exemple.pieceId} / ${champ} : désigné ${reference(resultat.designe)}, ` +
            `attendu ${reference(ref)}`,
        );
      }
    }
  }
  if (ecarts.length > 0) {
    return refuser("NE_REPRODUIT_PAS_SES_EXEMPLES", ecarts.join(" ; "), journal);
  }

  const canonique = JSON.stringify(validee.recette);
  return {
    ok: true,
    recette: validee.recette,
    empreinte: createHash("sha256").update(canonique).digest("hex"),
    provenance: {
      generateur: VERSION_DU_GENERATEUR,
      langage: VERSION_DU_LANGAGE,
      signature: distincts[0]!.signature.version,
      modele: journal.modele,
      role: journal.role,
      tokensIn: journal.tokensIn,
      tokensOut: journal.tokensOut,
      latenceMs: journal.latenceMs,
      pieces: distincts.map((s) => s.exemple.pieceId),
      ossature,
      vocabulaire: mots,
    },
  };
}

/* ======================================== CE QUE DEUX DÉSIGNATIONS PARTAGENT */

/** Deux références désignent-elles exactement la même chose ? */
export function memeReference(a: TokenRef, b: TokenRef): boolean {
  return (
    a.page === b.page &&
    a.ordinal === b.ordinal &&
    (a.ordinalEnd ?? a.ordinal) === (b.ordinalEnd ?? b.ordinal)
  );
}

/** Une référence, écrite pour un humain qui lit un écart. */
function reference(r: TokenRef): string {
  return r.ordinalEnd === undefined
    ? `p${String(r.page)}:${String(r.ordinal)}`
    : `p${String(r.page)}:${String(r.ordinal)}-${String(r.ordinalEnd)}`;
}
