/**
 * D'où viennent les nombres qui décident — le seul endroit qui les lit.
 *
 * ================================================================= POURQUOI
 *
 * La signature, la distance et le classement n'ont aucun défaut en
 * TypeScript : le compilateur refuse un appel qui oublie un réglage. C'est la
 * bonne moitié de R4 ; l'autre moitié est ici — les fournir depuis le
 * référentiel, daté et surchargeable par cabinet (R10), et REFUSER quand il
 * en manque un.
 *
 * `fabrique.reglages_de_signature(tenant)` lève plutôt que de rendre douze
 * réglages sur treize. Ce module ne rattrape pas cette erreur : il la laisse
 * remonter. Un treizième réglage inventé ici serait une constante invisible,
 * et une distance calculée avec un poids inventé reconnaît un format à tort
 * sans que rien ne le dise.
 *
 * ======================================================= CE QU'IL NE FAIT PAS
 *
 * Il ne met rien en cache, et ne choisit pas de recette. Il lit, il vérifie,
 * il rend trois objets. Les quatre bornes du validateur de recette ont leur
 * propre fonction en base (`fabrique.bornes_de_recette`), et elles sont lues
 * ici aussi — par le même chemin, pour qu'il n'y ait qu'une façon d'obtenir
 * un réglage de fabrique.
 */
import type { ExigencesDeValidation } from "./recette-validateur.ts";
import type { ParametresDeClassement, ParametresDeDistance } from "./signature-distance.ts";
import type { ParametresDeSignature } from "./signature.ts";

/** Le strict nécessaire d'une connexion : ce module n'ouvre rien lui-même. */
export interface LecteurDeReglages {
  query<T>(texte: string, valeurs?: unknown[]): Promise<{ rows: T[] }>;
}

/** Les trois jeux, réunis — ils voyagent ensemble parce qu'ils décident ensemble. */
export interface ReglagesDeFabrique {
  readonly signature: ParametresDeSignature;
  readonly distance: ParametresDeDistance;
  readonly classement: ParametresDeClassement;
  /** Qui a arrêté quoi — R10, conséquence 2 : cela se dit sans lire un historique. */
  readonly arretesParLeCabinet: readonly string[];
}

function nombre(valeurs: ReadonlyMap<string, number>, cle: string, origine: string): number {
  const v = valeurs.get(cle);
  if (v === undefined) {
    throw new Error(`réglage de fabrique absent : ${cle} (${origine})`);
  }
  return v;
}

/**
 * Les treize réglages de la reconnaissance, pour une organisation.
 *
 * La fonction de base lève si un seul manque ; ce module relève en plus le
 * cas où elle rendrait une ligne de moins que ce qu'elle promet, parce qu'une
 * promesse non vérifiée est une promesse.
 */
export async function lireLesReglages(
  db: LecteurDeReglages,
  tenantId: string,
): Promise<ReglagesDeFabrique> {
  const { rows } = await db.query<{
    reglage: string;
    valeur: string;
    arrete_par_le_cabinet: boolean;
  }>(`select reglage, valeur, arrete_par_le_cabinet from fabrique.reglages_de_signature($1)`, [
    tenantId,
  ]);

  const valeurs = new Map(rows.map((r) => [r.reglage, Number(r.valeur)]));
  const origine = "fabrique.reglages_de_signature";
  const lu = (cle: string) => nombre(valeurs, cle, origine);

  return {
    signature: {
      longueurMinimaleDAncre: lu("longueur_minimale_d_ancre"),
      bandesParPage: lu("bandes_par_page"),
      partMinimaleDuSens: lu("part_minimale_du_sens"),
      recouvrementDeLigne: lu("recouvrement_de_ligne"),
      recouvrementDeColonne: lu("recouvrement_de_colonne"),
      ancresEnRelationMax: lu("ancres_en_relation_max"),
    },
    distance: {
      poids: {
        ancres: lu("poids_ancres"),
        zones: lu("poids_zones"),
        relations: lu("poids_relations"),
        tableau: lu("poids_tableau"),
        pagination: lu("poids_pagination"),
      },
    },
    classement: { distanceMax: lu("distance_max"), ecartMinimal: lu("ecart_minimal") },
    arretesParLeCabinet: rows.filter((r) => r.arrete_par_le_cabinet).map((r) => r.reglage),
  };
}

/**
 * Les cinq bornes du validateur de recette, pour une organisation.
 *
 * Le validateur les exige toutes les cinq, sans défaut : « tant qu'elles n'y
 * sont pas, il ne s'appelle pas plutôt que de s'appeler faux ».
 */
export async function lireLesBornesDeRecette(
  db: LecteurDeReglages,
  tenantId: string,
): Promise<ExigencesDeValidation> {
  const { rows } = await db.query<{ borne: string; valeur: string }>(
    `select borne, valeur from fabrique.bornes_de_recette($1)`,
    [tenantId],
  );
  const valeurs = new Map(rows.map((r) => [r.borne, Number(r.valeur)]));
  const origine = "fabrique.bornes_de_recette";
  const lu = (cle: string) => nombre(valeurs, cle, origine);

  return {
    ancre_texte_min: lu("ancre_texte_min"),
    selecteurs_max: lu("selecteurs_max"),
    champs_max: lu("champs_max"),
    jetons_max: lu("jetons_max"),
    rang_max: lu("rang_max"),
  };
}
