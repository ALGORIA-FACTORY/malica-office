/**
 * Ce que le Socle applique des réglages comptables du cabinet (R10).
 *
 * ================================================================= POURQUOI
 *
 * Le 31 octobre 2026, le dirigeant a tranché onze arbitrages comptables et
 * fiscaux, livrés en défauts du pack et arrêtés par le cabinet
 * (`app.reglage_comptable` : le dossier, son cabinet, le pack). Un réglage qui
 * ne change rien au produit serait un bouchon : chaque option que le Socle
 * applique a ici son implémentation, et `ref.reglages_comptables_options.applique`
 * le dit — une épreuve confronte les deux (`reglages-comptables.test.ts`).
 * Les autres s'enregistrent, et l'écran dit qu'ils ne sont pas encore appliqués.
 *
 * Aucun seuil, compte ni droit n'est écrit ici (R4) : les codes ci-dessous
 * sont ceux des réglages et de leurs options, que le référentiel nomme.
 */
import type { Requete } from "../db.ts";

/** Les réglages du dossier, résolus au jour dit : le code et sa valeur. */
export type ReglagesResolus = ReadonlyMap<string, string | null>;

/** Les codes que le Socle lit. */
const SEUIL = "immobilisation.seuil";
const TRAITEMENT = "immobilisation.traitement";
const FODEC = "fodec.traitement";
const AVOIRS = "avoirs.traitement";
const ECRITURE_D_AVOIR = "avoirs.ecriture";

/**
 * Les options que le Socle sait appliquer, réglage par réglage. Une option
 * absente d'ici et marquée `applique` au référentiel (ou l'inverse) fait
 * échouer l'épreuve : l'écran ne peut pas dire « appliqué » à tort.
 *
 * Trois d'entre elles décrivent ce que le Socle fait déjà sans rien lire : le
 * plan des immobilisations (`ref.immo_categories`), le timbre standard d'un
 * dinar (`ref.fiscal_charges`) et l'avoir que le cabinet saisit
 * (`ref.titres_de_piece`). « actif_amorti » n'y est PAS : la réserve le dit,
 * mais l'écriture proposée reste au compte du paramétrage. « par_facture »
 * y est : le Socle lit le FODEC imprimé, il ne le calcule ni par article ni
 * par facture, et l'incorpore au coût de la même façon.
 */
export const OPTIONS_APPLIQUEES: Readonly<Record<string, readonly string[]>> = {
  [TRAITEMENT]: ["charge"],
  "comptes_immo.plan": ["selon_categorie"],
  [FODEC]: ["par_article_au_cout", "par_facture", "charge_non_recuperable"],
  "timbre.bareme": ["fixe_1d"],
  // L'avoir lié à sa facture (1er novembre 2026) : `controles.ts` le juge,
  // `proposition.ts` l'écrit (`ecritureDAvoir`). « libre » reste à faire.
  "avoirs.traitement": ["refus_saisie_cabinet", "lie_facture"],
  "avoirs.ecriture": ["selon_avoir", "extourne", "rabais"],
  // Le compte de vente par nature d'article, ou unique (`nature-de-vente.ts`).
  "ventes.compte": ["par_nature_article", "unique_cabinet"],
};

/** Les réglages à un nombre que le Socle lit. */
export const NOMBRES_APPLIQUES: readonly string[] = [SEUIL];

/**
 * Les réglages du dossier (ou du cabinet) au jour dit. La base dit qui peut
 * les lire (`refus.reglage_comptable.droits`).
 */
export async function lireLesReglagesComptables(
  db: Requete,
  dossier: string,
  pack: string,
  jour: string,
): Promise<ReglagesResolus> {
  const { rows } = await db.query<{ code: string; valeur: string | null }>(
    `select code, valeur from app.reglage_comptable($1, $2, $3::date)`,
    [dossier, pack, jour],
  );
  return new Map(rows.map((r) => [r.code, r.valeur]));
}

/**
 * Les défauts du pack au jour dit, sans dossier : le référentiel d'essai des
 * épreuves pures les relève (`releve-du-referentiel.ts`).
 */
export async function lireLesReglagesDuPack(
  db: Requete,
  pack: string,
  jour: string,
): Promise<Record<string, string>> {
  const { rows } = await db.query<{ code: string; valeur: string }>(
    `select code, valeur from app.reglages_du_pack($1, $2::date)`,
    [pack, jour],
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.valeur]));
}

/** Ce que le jugement d'un achat sait de la frontière charge / immobilisation. */
export interface ReglageDImmobilisation {
  /** Le seuil, dans la devise du dossier (écriture décimale). */
  seuil: string;
  /** Sous le seuil : à l'actif et amorti à 100 %, ou en charge. */
  traitement: "actif_amorti" | "charge";
  /**
   * La base de la comparaison : HT ; TTC pour un dossier non assujetti, dont
   * la TVA est un coût (INCERTAIN, à confirmer par un expert-comptable).
   */
  base: "ht" | "ttc";
  /**
   * Ce que le jugement a lu, pour qu'il se périme quand la réponse change
   * (`app.reglages_du_jugement_a_jour`) : le pack, le jour, les valeurs.
   */
  lu: { pack: string; jour: string; valeurs: Record<string, string> };
}

/**
 * Le seuil et le traitement ; nul quand le pack de la juridiction n'en porte
 * aucun — le jugement garde alors la réserve « à trancher » pour tout bien
 * reconnu, sans seuil deviné (R4). Un réglage à moitié présent, ou une valeur
 * que le Socle ne connaît pas, est une erreur nommée.
 */
export function reglageDImmobilisation(
  r: ReglagesResolus,
  lecture: { pack: string; jour: string; nonAssujetti: boolean },
): ReglageDImmobilisation | null {
  const seuil = r.get(SEUIL);
  const traitement = r.get(TRAITEMENT);
  if (seuil === undefined && traitement === undefined) return null;
  if (!seuil || (traitement !== "actif_amorti" && traitement !== "charge"))
    throw new Error("reglage.immobilisation.illisible");
  return {
    seuil,
    traitement,
    base: lecture.nonAssujetti ? "ttc" : "ht",
    lu: {
      pack: lecture.pack,
      jour: lecture.jour,
      valeurs: { [SEUIL]: seuil, [TRAITEMENT]: traitement },
    },
  };
}

/**
 * Les droits hors TVA que l'achat incorpore au COÛT (le FODEC, sauf si le
 * cabinet a choisi les taxes non récupérables) : leur montant rejoint la charge, au lieu du compte
 * du pack. Le code du droit est celui que le sujet gouverne
 * (`ref.reglages_comptables_sujets.droit_hors_tva`). Un pack sans ce réglage
 * n'incorpore rien.
 */
export async function droitsAuCout(db: Requete, r: ReglagesResolus): Promise<string[]> {
  const valeur = r.get(FODEC);
  if (valeur === undefined || valeur === "charge_non_recuperable") return [];
  if (valeur !== "par_article_au_cout" && valeur !== "par_facture")
    throw new Error("reglage.fodec.illisible");
  const { rows } = await db.query<{ droit: string }>(
    `select s.droit_hors_tva as droit
       from ref.reglages_comptables r
       join ref.reglages_comptables_sujets s on s.code = r.sujet
      where r.code = $1 and s.droit_hors_tva is not null`,
    [FODEC],
  );
  return rows.map((x) => x.droit);
}

/** Ce que le jugement et la proposition d'un avoir savent du réglage du cabinet. */
export interface ReglageDesAvoirs {
  /** Lié à sa facture et proposé, ou refusé et saisi par le cabinet. */
  traitement: "lie_facture" | "refus_saisie_cabinet";
  /** L'extourne, le rabais, ou selon l'avoir (total : extourne). */
  ecriture: "selon_avoir" | "extourne" | "rabais";
  /** Ce que le jugement a lu, pour se périmer quand la réponse change. */
  lu: { pack: string; jour: string; valeurs: Record<string, string> };
}

/**
 * Le traitement d'un avoir ; nul quand le pack n'en porte aucun — l'avoir se
 * refuse alors, comme avant le réglage. L'option « libre » n'est pas encore
 * appliquée (`OPTIONS_APPLIQUEES`) : un avoir libre se refuse aussi, et le
 * référentiel le dit à l'écran. Une valeur inconnue est une erreur nommée.
 */
export function reglageDesAvoirs(
  r: ReglagesResolus,
  lecture: { pack: string; jour: string },
): ReglageDesAvoirs | null {
  const traitement = r.get(AVOIRS);
  const ecriture = r.get(ECRITURE_D_AVOIR);
  if (traitement === undefined) return null;
  if (
    !traitement ||
    !["lie_facture", "refus_saisie_cabinet", "libre"].includes(traitement) ||
    (ecriture !== "selon_avoir" && ecriture !== "extourne" && ecriture !== "rabais")
  )
    throw new Error("reglage.avoirs.illisible");
  return {
    traitement: traitement === "lie_facture" ? "lie_facture" : "refus_saisie_cabinet",
    ecriture,
    lu: { pack: lecture.pack, jour: lecture.jour, valeurs: { [AVOIRS]: traitement } },
  };
}
