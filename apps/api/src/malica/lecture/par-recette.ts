/**
 * LE POINT D'INSERTION — entre le plan de jetons et la désignation.
 *
 * ================================================================= POURQUOI
 *
 * `docs/fabrique-de-lecteurs/00-plan.md` ne laisse qu'une place à la fabrique
 * de lecteurs :
 *
 *   relevé → plan de jetons → [ RECONNAISSANCE → recette applicable ? ]
 *                                ├─ oui → interprétation → sélection
 *                                └─ non → désignation par le modèle → sélection
 *                                                 ↓
 *                           relecture dans le plan (partagée) → contrôles
 *
 * Ce module EST cette place, et rien d'autre. Il ne relit aucun montant, ne
 * persiste aucune lecture, n'écrit aucune citation : il rend un
 * `VisionSelection`, exactement ce que le modèle désignateur rend, et tout
 * l'aval — `recollerLesMilliers`, `lireMontantDuPlan`, `normalizeDate`,
 * `citer`, les contrôles, la persistance — reste celui de la chaîne existante.
 *
 * C'est la règle ① du plan, et c'est la seule façon connue de ne pas refaire
 * l'amputation du 18 octobre 2026 : un second chemin de relecture diverge, et
 * personne ne le voit, parce qu'une amputation systématique boucle sur ses
 * propres équations.
 *
 * ======================================== LE PLAN REÇU EST DÉJÀ RECOLLÉ
 *
 * Éprouvé des deux côtés par l'auteur de l'interprète : sur le plan BRUT, la
 * recette désigne « 5 » là où le papier porte « 5 650,000 ». Ses mots :
 * « l'amputation change de côté, elle ne disparaît pas. »
 *
 * Ce n'est donc pas une consigne de commentaire : `exigerUnPlanRecolle` le
 * VÉRIFIE, en rejouant `recollerLesMilliers` sur le plan reçu. Le recollage
 * est idempotent — un plan déjà recollé en ressort identique. S'il en ressort
 * plus court, c'est que le plan ne l'était pas, et l'on refuse au lieu de
 * désigner la moitié d'un montant.
 *
 * ========================================= CE QU'IL NE MET PAS PAR DÉFAUT
 *
 * Trois champs de `VisionSelection` ne sont PAS des désignations, et
 * `interprete-sortie.ts` refuse déjà de les produire :
 *
 *   `document_kind`      ne se déduit pas d'une règle de lecture. Il vaut
 *                        `null`, ce qui est une RÉPONSE que la chaîne sait
 *                        traiter : `read-flow.ts` pose alors le drapeau
 *                        `direction.incertaine` et la personne tranche.
 *                        C'est exactement ce qui arrive quand le modèle ne
 *                        peut pas l'établir — aucun chemin nouveau.
 *   `currency`           vient du DOSSIER, et l'appelant la passe. Ce n'est
 *                        pas un défaut écrit ici : c'est la même source que
 *                        celle du modèle sur une pièce qui n'imprime aucune
 *                        devise (`raw.currency ?? devise`), et aucun code
 *                        ISO n'apparaît dans ce fichier (R4).
 *   `overall_confidence` une recette ne produit AUCUN score. L'appelant passe
 *                        donc le NEUTRE DU MINIMUM, et le nom du paramètre le
 *                        dit : `confiance.ts` calcule
 *                        `min(confiance du jeton, confiance de la
 *                        désignation)`, et le neutre y signifie « la
 *                        désignation n'abaisse rien » — le même traitement que
 *                        ce module accorde déjà à un jeton sans confiance
 *                        propre. Ce n'est pas « sûr à 100 % » ; c'est
 *                        « l'incertitude du champ est celle du relevé ».
 *                        La valeur est OBLIGATOIRE et explicite au point
 *                        d'appel : aucun appelant ne peut l'oublier.
 */

import type { AppelApi } from "../appel-local.ts";

import { interpreter } from "../../fabrique/interprete.ts";
import {
  reconnaitre,
  type FormatConnu,
  type Reconnaissance,
} from "../../fabrique/interprete-reconnaissance.ts";
import { sortieDeRecette, type SortieDeRecette } from "../../fabrique/interprete-sortie.ts";
import { validerRecette } from "../../fabrique/recette-validateur.ts";
import type { ExigencesDeValidation } from "../../fabrique/recette-validateur.ts";
import { signerLePlan, type ParametresDeSignature } from "../../fabrique/signature.ts";
import type {
  ParametresDeClassement,
  ParametresDeDistance,
} from "../../fabrique/signature-distance.ts";

import { repairArticles } from "./article-repair.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionArticle, VisionSelection } from "./vision.ts";

/* ===================================================== CE QUE LA BASE REND = */

/** Un format connu, tel que le dépôt de la fabrique le rend. */
interface VersionApplicable {
  readonly versionId: string;
  readonly recetteId: string;
  readonly rang: number;
  readonly libelle: string;
  readonly etat: string;
  /** La recette, non validée : c'est ICI qu'elle passe le validateur strict. */
  readonly definition: unknown;
  /** Les plans de jetons des exemples d'APPRENTISSAGE — jamais d'évaluation. */
  readonly plansDApprentissage: readonly (readonly PageToken[])[];
}

/** Tout ce qu'une désignation par recette exige, en UN aller-retour. */
export interface ContexteDeFabrique {
  readonly signature: ParametresDeSignature;
  readonly distance: ParametresDeDistance;
  readonly classement: ParametresDeClassement;
  readonly bornes: ExigencesDeValidation;
  readonly versions: readonly VersionApplicable[];
}

/* ========================================================== LE RÉSULTAT === */

/** Pourquoi une pièce n'a PAS été lue par une recette. Lisible au journal. */
type MotifDeNonApplication =
  | { readonly motif: "aucune_recette" }
  | { readonly motif: "aucun_candidat" }
  | { readonly motif: "ambigu"; readonly detail: string }
  | { readonly motif: "recette_invalide"; readonly versionId: string; readonly detail: string }
  | { readonly motif: "abstention"; readonly versionId: string; readonly detail: string };

/** Ce qu'une recette appliquée rend — un `VisionSelection`, et sa provenance. */
interface DesignationParRecette {
  readonly selection: VisionSelection;
  readonly versionId: string;
  readonly rang: number;
  readonly libelle: string;
  readonly champsDesignes: number;
  readonly dureeMs: number;
}

export type ResultatDeLaFabrique =
  | { readonly applique: true; readonly par: DesignationParRecette }
  | { readonly applique: false; readonly pourquoi: MotifDeNonApplication };

/**
 * Le branchement, en fonction PURE.
 *
 * Aucune base, aucun réseau : la reconnaissance, la validation,
 * l'interprétation et l'abstention s'éprouvent sans fournisseur payant, et le
 * banc emprunte exactement ce que la production emprunte.
 */
export function designerParRecette(
  plan: readonly PageToken[],
  contexte: ContexteDeFabrique,
  valeursDuDossier: { readonly devise: string; readonly neutreDeConfiance: number },
): ResultatDeLaFabrique {
  exigerUnPlanRecolle(plan);
  const depart = Date.now();

  if (contexte.versions.length === 0) {
    return { applique: false, pourquoi: { motif: "aucune_recette" } };
  }

  const formats: FormatConnu[] = contexte.versions.map((v) => ({
    id: v.versionId,
    // LA RECONNAISSANCE EST EN DEUX TEMPS. Une ossature tirée d'un seul
    // exemple apprend le nom du client comme s'il était la forme du papier —
    // mesuré : 0,0000 devient 0,0960 chez un autre client. `reconnaitre`
    // écarte nommément un format qui n'a qu'un exemple ; on ne le
    // court-circuite pas, et on ne signe jamais ici autre chose que ces
    // plans-là, qui sont ceux de l'APPRENTISSAGE (la base interdit qu'un
    // exemple d'évaluation y entre).
    exemples: v.plansDApprentissage.map((p) => signerLePlan(p, contexte.signature)),
  }));

  const vu: Reconnaissance = reconnaitre(
    plan,
    formats,
    contexte.signature,
    contexte.distance,
    contexte.classement,
  );

  const verdict = vu.classement.verdict;
  if (verdict.sorte !== "un") {
    return {
      applique: false,
      pourquoi:
        verdict.sorte === "ambigu"
          ? { motif: "ambigu", detail: verdict.exAequo.join(", ") }
          : { motif: "aucun_candidat" },
    };
  }

  const version = contexte.versions.find((v) => v.versionId === verdict.id);
  if (!version) return { applique: false, pourquoi: { motif: "aucun_candidat" } };

  // Le validateur strict, ICI et pas ailleurs : une recette stockée avant un
  // durcissement du langage ne doit pas s'exécuter parce qu'elle est en base.
  const validee = validerRecette(version.definition, contexte.bornes);
  if (!validee.ok) {
    return {
      applique: false,
      pourquoi: {
        motif: "recette_invalide",
        versionId: version.versionId,
        detail: validee.refus.map((r) => `${r.code} @ ${r.ou}`).join(", "),
      },
    };
  }

  const resultat = interpreter(validee.recette, plan, contexte.signature);
  const sortie = sortieDeRecette(resultat);

  if (sortie.sAbstient) {
    /*
     * L'ABSTENTION REND LA MAIN, ELLE NE DRAPEAUTE PAS.
     *
     * Garder les champs désignés et ne drapeauter que les manquants
     * produirait une lecture MIXTE — moitié recette, moitié rien — que
     * personne n'a mesurée et qu'aucune évaluation ne couvre. Le plan dit
     * « l'abstention rend la main à la chaîne existante avec son motif » :
     * la chaîne, c'est le modèle, et il repart du même plan de jetons.
     */
    return {
      applique: false,
      pourquoi: {
        motif: "abstention",
        versionId: version.versionId,
        detail: sortie.flags.map((f) => `${f.field}:${f.code}`).join(", "),
      },
    };
  }

  return {
    applique: true,
    par: {
      selection: selectionDepuisRecette(sortie, plan, valeursDuDossier),
      versionId: version.versionId,
      rang: version.rang,
      libelle: version.libelle,
      champsDesignes: compterLesDesignations(sortie),
      dureeMs: Date.now() - depart,
    },
  };
}

/**
 * Le plan reçu est-il celui que la chaîne donne au désignateur ?
 *
 * `relever()` applique `recollerLesMilliers` avant toute désignation, et
 * `recollerLesMilliers` est idempotent : un plan déjà recollé en ressort avec
 * le même nombre de jetons. Un plan BRUT, lui, en perd — et c'est exactement
 * la paire « 5 » + « 650,000 » qui a coûté six mille dinars.
 *
 * On lève, on ne retombe pas sur le modèle en silence : un appelant qui
 * passerait le plan brut a un défaut de code, pas une pièce difficile.
 */
export function exigerUnPlanRecolle(plan: readonly PageToken[]): void {
  if (recollerLesMilliers(plan).length !== plan.length) {
    throw new Error(
      "fabrique : le plan de jetons n'est pas recollé — une recette y désignerait la moitié d'un montant",
    );
  }
}

function compterLesDesignations(sortie: SortieDeRecette): number {
  const d = sortie.designation;
  const racines = [d.issuer, d.document_date, d.totals.base_ht, d.totals.vat, d.totals.ttc];
  const refs = [...racines, ...Object.values(d.references)];
  const dansLesLignes = d.lines.flatMap((l) => Object.values(l));
  const dansLesArticles = d.articles.flatMap((a) => Object.values(a));
  return [...refs, ...dansLesLignes, ...dansLesArticles].filter((r) => r !== null).length;
}

/* ============================== LA SORTIE, AU FORMAT DE LA CHAÎNE ========= */

/** Le texte que portent les jetons d'une désignation — relu DANS LE PLAN. */
function texteDuPlan(plan: readonly PageToken[], ref: TokenRef | null): string {
  if (!ref) return "";
  const fin = ref.ordinalEnd ?? ref.ordinal;
  return plan
    .filter((t) => t.page === ref.page && t.ordinal >= ref.ordinal && t.ordinal <= fin)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((t) => t.text)
    .join(" ")
    .trim();
}

/**
 * La désignation d'une recette, au format que la chaîne attend.
 *
 * `lines[].label` et `lines[].tax_code` sont des TEXTES dans
 * `VisionSelection`, et la recette n'en rend que des désignations : ils sont
 * donc RELUS ICI, dans le plan, par le même geste que `labelText` applique
 * déjà au libellé que le modèle désigne. Relire une désignation dans le plan
 * n'est pas lire une valeur : aucun montant, aucune date, aucun nombre ne
 * passe par ce chemin — seulement ce qui est, dans le contrat, une chaîne.
 *
 * `other_charges` reste VIDE : le langage des recettes ne sait pas encore
 * désigner un droit hors TVA (`recette.ts` n'a ni champ ni colonne pour lui).
 * Un tableau vide est ce que le modèle rend lui aussi quand la pièce n'en
 * porte pas ; sur une pièce qui en porte un, l'équation du pied ne bouclera
 * pas et le contrat sortira PARTIEL — donc la chaîne reprendra la main par
 * son propre rattrapage, au lieu d'inscrire un TTC amputé du timbre. C'est
 * une limite NOMMÉE, pas un silence.
 */
function selectionDepuisRecette(
  sortie: SortieDeRecette,
  plan: readonly PageToken[],
  valeurs: { readonly devise: string; readonly neutreDeConfiance: number },
): VisionSelection {
  const d = sortie.designation;

  const articles: VisionArticle[] = d.articles.map((a) => ({
    designation: a.designation,
    quantity: a.quantity,
    unit_price_ht: a.unit_price_ht,
    unit_price_ttc: a.unit_price_ttc,
    total_ht: a.total_ht,
    // Le code de taux est une DÉSIGNATION dans la recette ; relu dans le plan,
    // il redevient le code que le contrat attend. Vide, il vaut `null` : une
    // ligne sans taux n'est pas une ligne à taux inventé.
    tax_code: texteDuPlan(plan, a.tax_code) || null,
  }));

  return {
    // Aucune recette ne tranche le sens d'une pièce : `null` est la réponse
    // que la chaîne sait traiter, et elle pose le drapeau qui pose la question.
    document_kind: null,
    currency: valeurs.devise,
    issuer: d.issuer,
    document_date: d.document_date,
    lines: d.lines
      .map((l) => ({
        label: texteDuPlan(plan, l.label),
        tax_code: texteDuPlan(plan, l.tax_code),
        base_ht: l.base_ht,
        vat_amount: l.vat_amount,
        ttc: l.ttc,
      }))
      // Un taux non désigné rend la ligne inexploitable : elle est écartée,
      // jamais complétée par défaut. C'est le filtre de `selectionDepuisReponse`,
      // à la lettre — deux chemins qui écarteraient différemment seraient deux
      // produits.
      .filter((l) => l.tax_code.length > 0)
      .map((l) => ({ ...l, label: l.label || "Ligne" })),
    // Les colonnes manquantes se complètent par la géométrie, jamais par un
    // modèle : exactement le geste que la désignation du modèle subit déjà.
    articles: repairArticles(plan, articles),
    other_charges: [],
    totals: d.totals,
    references: { ...d.references },
    overall_confidence: valeurs.neutreDeConfiance,
  };
}

/* ================================= LE BRANCHEMENT, AVEC LA BASE ========== */

/**
 * Le désignateur que `runVisionRead` appelle entre ses deux passes.
 *
 * Il rend `null` quand aucune recette ne s'applique — et la passe 2 part,
 * comme avant, sur le même plan de jetons. Rien d'autre ne change.
 */
export type DesignateurDeRecette = (
  plan: readonly PageToken[],
) => Promise<DesignationParRecette | null>;

/**
 * Le désignateur branché sur la base.
 *
 * Deux écritures le suivent, et aucune ne peut faire échouer une lecture :
 *
 *   `fabrique.executions`  ce qui répond à « cette pièce a-t-elle été lue par
 *                          une recette ou par le modèle ? laquelle ? si
 *                          abstention, pour quel motif ? » ;
 *   `agents.agent_runs`    le recours au modèle, écrit par `read-flow.ts`,
 *                          avec le modèle et le rôle de l'organe qui a
 *                          désigné — la recette en est un, tarifé à zéro.
 *
 * Une panne de la fabrique ne prive personne de sa lecture : tout échec
 * imprévu retombe sur le modèle, en criant dans le journal du serveur. C'est
 * la seule décision de repli de ce module, et elle est dans ce sens-là —
 * vers le chemin éprouvé, jamais vers un résultat inventé.
 */
export function creerDesignateurDeRecette(
  api: AppelApi,
  piece: { readonly pieceId: string; readonly tenantId: string; readonly devise: string },
): DesignateurDeRecette {
  return async (plan) => {
    let contexte: ContexteDeFabrique;
    try {
      contexte = await api.rpc<ContexteDeFabrique>("fabrique", "contexteDeDesignation", [
        piece.tenantId,
      ]);
    } catch (e: unknown) {
      console.error(
        `fabrique : contexte illisible — pièce ${piece.pieceId} : ${message(e)} ; le modèle désigne`,
      );
      return null;
    }

    let resultat: ResultatDeLaFabrique;
    try {
      resultat = designerParRecette(plan, contexte, {
        devise: piece.devise,
        // LE NEUTRE DU MINIMUM, et non un score. Voir l'en-tête : la confiance
        // d'un champ devient celle de son jeton relevé, parce qu'une recette
        // n'ajoute aucune incertitude d'échantillonnage — elle désigne ou elle
        // s'abstient.
        neutreDeConfiance: 1,
      });
    } catch (e: unknown) {
      console.error(`fabrique : désignation impossible — pièce ${piece.pieceId} : ${message(e)}`);
      await inscrire(api, piece, null, "echec", message(e), null, null);
      return null;
    }

    if (!resultat.applique) {
      const p = resultat.pourquoi;
      const version = "versionId" in p ? p.versionId : null;
      const detail = "detail" in p ? `${p.motif} — ${p.detail}` : p.motif;
      // Sans version reconnue, il n'y a RIEN à inscrire : `fabrique.executions`
      // porte une exécution DE VERSION. Le fait « le modèle a désigné » est,
      // lui, déjà dans `agents.agent_runs`.
      if (version) {
        await inscrire(
          api,
          piece,
          version,
          p.motif === "abstention" ? "abstention" : "echec",
          detail,
          null,
          null,
        );
      }
      return null;
    }

    const par = resultat.par;
    await inscrire(api, piece, par.versionId, "designation", null, par.champsDesignes, par.dureeMs);
    return par;
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 400) : String(e);
}

/**
 * Inscrire l'exécution. Un journal qui échoue CRIE et ne fait rien échouer :
 * la pièce est lue, et une mesure perdue ne doit pas priver la personne de
 * son résultat. C'est la règle que `read-flow.ts` tient déjà pour le coût.
 */
async function inscrire(
  api: AppelApi,
  piece: { readonly pieceId: string; readonly tenantId: string },
  versionId: string | null,
  issue: "designation" | "abstention" | "echec",
  motif: string | null,
  champsDesignes: number | null,
  dureeMs: number | null,
): Promise<void> {
  if (!versionId) return;
  await api
    .rpc<void>("fabrique", "inscrireExecution", [
      {
        tenantId: piece.tenantId,
        recetteVersionId: versionId,
        pieceId: piece.pieceId,
        issue,
        motif,
        champsDesignes,
        dureeMs,
      },
    ])
    .catch((e: unknown) => {
      console.error(
        `exécution de recette NON journalisée — pièce ${piece.pieceId}, version ${versionId} : ${message(e)}`,
      );
    });
}
