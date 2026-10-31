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

/**
 * Les options que le Socle sait appliquer, réglage par réglage. Une option
 * absente d'ici et marquée `applique` au référentiel (ou l'inverse) fait
 * échouer l'épreuve : l'écran ne peut pas dire « appliqué » à tort.
 *
 * Trois d'entre elles décrivent ce que le Socle fait déjà sans rien lire : le
 * plan des immobilisations (`ref.immo_categories`, 2282, TVA en 43662), le
 * timbre standard d'un dinar (`ref.fiscal_charges`) et l'avoir que le cabinet
 * saisit (`ref.titres_de_piece`).
 */
export const OPTIONS_APPLIQUEES: Readonly<Record<string, readonly string[]>> = {
  [TRAITEMENT]: ["actif_amorti", "charge"],
  "comptes_immo.plan": ["nc01_2282_43662"],
  [FODEC]: ["par_article_4374_cout", "achat_6652"],
  "timbre.bareme": ["fixe_1d"],
  "avoirs.traitement": ["refus_saisie_cabinet"],
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
    `select distinct on (s.code) s.code,
            coalesce(s.value_text, trim_scale(s.value_num)::text) as valeur
       from ref.socle_params s
       join ref.reglages_comptables r on r.code = s.code and r.porte = 'reglages_comptables'
      where s.pack_version_id = $1 and s.valid_from <= $2::date
        and (s.valid_to is null or s.valid_to >= $2::date)
      order by s.code collate "C", s.valid_from desc`,
    [pack, jour],
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.valeur]));
}

/** Ce que le jugement d'un achat sait de la frontière charge / immobilisation. */
export interface ReglageDImmobilisation {
  /** Le seuil, HORS TAXE, dans la devise du dossier (écriture décimale). */
  seuil: string;
  /** Sous le seuil : à l'actif et amorti à 100 %, ou en charge. */
  traitement: "actif_amorti" | "charge";
}

/**
 * Le seuil et le traitement ; nul quand le pack de la juridiction n'en porte
 * aucun — le jugement garde alors la réserve « à trancher » pour tout bien
 * reconnu, sans seuil deviné (R4). Un réglage à moitié présent, ou une valeur
 * que le Socle ne connaît pas, est une erreur nommée.
 */
export function reglageDImmobilisation(r: ReglagesResolus): ReglageDImmobilisation | null {
  const seuil = r.get(SEUIL);
  const traitement = r.get(TRAITEMENT);
  if (seuil === undefined && traitement === undefined) return null;
  if (!seuil || (traitement !== "actif_amorti" && traitement !== "charge"))
    throw new Error("reglage.immobilisation.illisible");
  return { seuil, traitement };
}

/**
 * Les droits hors TVA que l'achat incorpore au COÛT (le FODEC, sauf si le
 * cabinet a choisi 6652) : leur montant rejoint la charge, au lieu du compte
 * du pack. Le code du droit est celui que le sujet gouverne
 * (`ref.reglages_comptables_sujets.droit_hors_tva`). Un pack sans ce réglage
 * n'incorpore rien.
 */
export async function droitsAuCout(db: Requete, r: ReglagesResolus): Promise<string[]> {
  const valeur = r.get(FODEC);
  if (valeur === undefined || valeur === "achat_6652") return [];
  if (valeur !== "par_article_4374_cout" && valeur !== "par_facture")
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
