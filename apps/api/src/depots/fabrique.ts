/**
 * La fabrique de lecteurs, côté dépôt — strictement ce que le BRANCHEMENT lit.
 *
 * ================================================================= POURQUOI
 *
 * `malica/lecture/par-recette.ts` est le point d'insertion entre le plan de
 * jetons et la désignation. Il ne parle à la base que par l'interface `rpc`
 * de `AppelApi` — comme tout le reste de la chaîne de lecture, qui s'exécute
 * HORS transaction parce qu'un appel de modèle dure des minutes.
 *
 * Ce dépôt est donc la frontière de ce seul usage. Il n'est PAS le dépôt
 * complet de la fabrique (tâche 8 du plan : écrire une recette, qualifier un
 * exemple, promouvoir une version, lire les dérives) : ces méthodes-là
 * s'ajouteront ici, et aucune n'est devinée d'avance.
 *
 * ========================================================== CE QU'IL NE FAIT PAS
 *
 * Il ne décide rien. Les treize réglages et les cinq bornes viennent de
 * `fabrique.reglages_de_signature` et `fabrique.bornes_de_recette`, qui LÈVENT
 * si l'une manque (R4, R10) ; l'état d'une version vient de
 * `fabrique.etat_des_recettes_v`, qui est le DERNIER fait inscrit. Aucun
 * seuil, aucun état, aucun nom de format n'est écrit dans ce fichier.
 */
import { z } from "zod";

import type { Requete } from "../db.ts";
import { lireLesBornesDeRecette, lireLesReglages } from "../fabrique/interprete-reglages.ts";
import { enregistrerTravail, etatDuTravail } from "../fabrique/travaux.ts";
import type { PageToken } from "../malica/lecture/token-plan.ts";

/**
 * Les états sous lesquels une version DÉSIGNE pour de bon.
 *
 * Ce ne sont pas des seuils — ce sont les deux états du cycle de vie
 * (`fabrique.etat_t`) où la recette s'exécute : `observation`, parce que
 * « toute recette naît en observation : elle s'exécute, on compare, on ne la
 * croit pas », et `active`. `candidate`, `evaluee`, `suspendue` et `retiree`
 * ne tournent pas, et leur place dans le cycle est tenue par la base.
 */
const ETATS_QUI_DESIGNENT = ["observation", "active"] as const;

interface LigneDeVersion {
  recette_version_id: string;
  recette_id: string;
  rang: number;
  libelle: string;
  etat: string;
  definition: unknown;
}

interface LigneDeJeton {
  recette_version_id: string;
  piece_id: string;
  page: number;
  ordinal: number;
  text: string;
  x0: string | number;
  y0: string | number;
  x1: string | number;
  y1: string | number;
}

const Execution = z.object({
  tenantId: z.string().uuid(),
  recetteVersionId: z.string().uuid(),
  pieceId: z.string().uuid(),
  issue: z.enum(["designation", "abstention", "echec"]),
  motif: z.string().max(2000).nullish(),
  champsDesignes: z.number().int().min(0).nullish(),
  dureeMs: z.number().int().min(0).nullish(),
});

export const fabrique = {
  /**
   * Tout ce qu'une désignation par recette exige, en UN aller-retour.
   *
   * Un aller-retour, parce que ceci s'exécute au milieu d'une lecture : trois
   * appels seraient trois transactions, et la chaîne en ouvre déjà une par
   * RPC.
   *
   * ======================================= POURQUOI DES PLANS, ET PAS DES SIGNATURES
   *
   * La reconnaissance compare des SIGNATURES, et rien en base n'en stocke :
   * `signerLePlan` est pur et bon marché, et la signature a une version de
   * FORME qui rend incomparables deux signatures calculées par deux versions.
   * Les recalculer depuis les plans de jetons déjà persistés, c'est la
   * garantie qu'elles sont toutes de la même forme — une colonne de
   * signatures figées, elle, vieillirait en silence.
   *
   * Les plans rendus sont ceux des exemples d'APPRENTISSAGE, et seulement
   * eux : la jointure passe par `fabrique.recette_version_exemples`, dont la
   * clé étrangère refuse par construction un exemple d'évaluation. La
   * frontière n'est donc pas tenue par cette requête — elle est tenue par la
   * base, et cette requête ne peut pas la contourner.
   */
  async contexteDeDesignation(db: Requete, tenantId: string) {
    const [reglages, bornes] = await Promise.all([
      lireLesReglages(db, tenantId),
      lireLesBornesDeRecette(db, tenantId),
    ]);

    const { rows: versions } = await db.query<LigneDeVersion>(
      `select e.recette_version_id, e.recette_id, e.rang, e.libelle, e.etat::text as etat,
              v.definition
         from fabrique.etat_des_recettes_v e
         join fabrique.recette_versions v on v.id = e.recette_version_id
        where e.tenant_id = $1 and e.etat::text = any($2)
        order by e.recette_id, e.rang desc`,
      [tenantId, [...ETATS_QUI_DESIGNENT]],
    );
    if (versions.length === 0) {
      return { ...reglages, bornes, versions: [] };
    }

    const ids = versions.map((v) => v.recette_version_id);
    const { rows: jetons } = await db.query<LigneDeJeton>(
      `select rve.recette_version_id, e.piece_id,
              t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1
         from fabrique.recette_version_exemples rve
         join fabrique.exemples e on e.id = rve.exemple_id
         join token_plan_v t on t.piece_id = e.piece_id
        where rve.recette_version_id = any($1)
        order by rve.recette_version_id, e.piece_id, t.page, t.ordinal`,
      [ids],
    );

    const parVersion = new Map<string, Map<string, PageToken[]>>();
    for (const j of jetons) {
      let pieces = parVersion.get(j.recette_version_id);
      if (!pieces) {
        pieces = new Map<string, PageToken[]>();
        parVersion.set(j.recette_version_id, pieces);
      }
      const plan = pieces.get(j.piece_id) ?? [];
      plan.push({
        page: Number(j.page),
        ordinal: Number(j.ordinal),
        text: j.text,
        x0: Number(j.x0),
        y0: Number(j.y0),
        x1: Number(j.x1),
        y1: Number(j.y1),
      });
      pieces.set(j.piece_id, plan);
    }

    return {
      ...reglages,
      bornes,
      versions: versions.map((v) => ({
        versionId: v.recette_version_id,
        recetteId: v.recette_id,
        rang: Number(v.rang),
        libelle: v.libelle,
        etat: v.etat,
        definition: v.definition,
        plansDApprentissage: [...(parVersion.get(v.recette_version_id)?.values() ?? [])],
      })),
    };
  },

  /**
   * Inscrire ce qu'une exécution de recette a donné.
   *
   * C'est la seule réponse à « cette pièce a-t-elle été lue par une recette
   * ou par le modèle ? laquelle, dans quelle version, et si abstention pour
   * quel motif ? ». La table est en ajout seul (R7) et le `check` de la base
   * exige un motif dès que l'issue n'est pas une désignation — on ne le
   * redouble pas ici.
   */
  async inscrireExecution(db: Requete, saisie: unknown): Promise<void> {
    const e = Execution.parse(saisie);
    await db.query(
      `insert into fabrique.executions
         (tenant_id, recette_version_id, piece_id, issue, motif, champs_designes, duree_ms)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        e.tenantId,
        e.recetteVersionId,
        e.pieceId,
        e.issue,
        e.motif ?? null,
        e.champsDesignes ?? null,
        e.dureeMs ?? null,
      ],
    );
  },

  /**
   * Enregistrer le travail de lecture d'une pièce — DURABLEMENT.
   *
   * L'accusé que la route renvoie au téléphone part APRÈS ce retour, jamais
   * avant : aujourd'hui elle répond `{enCours:true}` sur une promesse en
   * mémoire, et un refus s'est déjà perdu de cette façon.
   *
   * L'organisation n'est pas un argument : elle se LIT sur la pièce, sous la
   * RLS. Un appelant qui la passerait pourrait nommer celle d'un autre, et
   * `pieces_v` est précisément ce qui refuse une pièce qu'on ne voit pas.
   *
   * La clé d'idempotence est la pièce elle-même : une pièce ne se lit qu'une
   * fois (R7), et la file hors ligne du téléphone rejoue.
   */
  async enregistrerLecture(
    db: Requete,
    pieceId: string,
  ): Promise<{ travailId: string; deja: boolean }> {
    const { rows } = await db.query<{ tenant_id: string }>(
      `select tenant_id from pieces_v where id = $1`,
      [pieceId],
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) throw new Error("piece.not_found");

    return enregistrerTravail(db, {
      tenantId,
      pieceId,
      nature: "lecture_piece",
      cleIdempotence: `lecture_piece:${pieceId}`,
    });
  },

  /**
   * Où en est le travail qu'on a accusé — ce que l'écran lit au lieu de se
   * taire.
   *
   * C'est l'autre moitié de l'accusé : répondre « en cours » n'a de sens que
   * si l'on peut ensuite demander ce qu'il est devenu. L'état est DÉRIVÉ du
   * dernier fait inscrit (`fabrique.etat_des_travaux_v`), rien n'est stocké,
   * et la vue est `security_invoker` — c'est la RLS qui répond `null`.
   */
  async etatDeLaLecture(db: Requete, travailId: string) {
    return etatDuTravail(db, travailId);
  },
};
