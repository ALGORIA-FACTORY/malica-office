/**
 * La tour — ce qu'un opérateur d'ALGORIA règle sans passer par le serveur.
 *
 * La grille (offres et recharges), le prestataire de paiement, l'émetteur des
 * factures, et la vue des licences. Chaque méthode relaie une fonction de la
 * base qui REFUSE à qui n'est pas opérateur de la plateforme (R3) : ce dépôt
 * ne garde rien, ne calcule rien, ne vérifie rien lui-même.
 *
 * Une exception, nommée : `reglagePaiement` dit si les SECRETS du compte
 * marchand sont posés sur ce serveur — oui ou non, jamais leur valeur. C'est
 * la seule chose que la base ne peut pas savoir, et la tour en a besoin pour
 * ne pas ouvrir ClicToPay dans le vide.
 */

import type { Requete } from "../db.ts";
import { secretsClictopayPoses } from "../paiement/prestataires.ts";

export const tour = {
  /** Vrai pour un opérateur de la plateforme : l'écran de la tour ne s'affiche qu'à lui. */
  async suisJePlateforme(db: Requete) {
    const { rows } = await db.query<{ r: boolean }>(`select app.is_platform() as r`);
    return Boolean(rows[0]?.r);
  },

  /** La grille en vigueur, au format qu'on propose. */
  async grilleEnVigueur(db: Requete) {
    const { rows } = await db.query<{ g: unknown }>(`select plateforme.grille_en_vigueur() as g`);
    return rows[0]?.g ?? null;
  },

  /** Les trous d'une grille proposée — vide, elle peut se publier. */
  async trousDeLaGrille(db: Requete, effectiveFrom: string, offres: unknown, recharges: unknown) {
    const { rows } = await db.query<{ code: string; detail: string }>(
      `select code, detail from plateforme.grille_trous($1::date, $2::jsonb, $3::jsonb)`,
      [effectiveFrom, JSON.stringify(offres), JSON.stringify(recharges)],
    );
    return rows;
  },

  /** Publier une grille à sa date. Refusée par la base si elle a un trou. */
  async publierGrille(
    db: Requete,
    effectiveFrom: string,
    offres: unknown,
    recharges: unknown,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.grille_publier($1::date, $2::jsonb, $3::jsonb, $4) as r`,
      [effectiveFrom, JSON.stringify(offres), JSON.stringify(recharges), motif],
    );
    return rows[0]?.r ?? null;
  },

  /** Les licences : des compteurs, jamais des papiers. */
  async licences(db: Requete) {
    const { rows } = await db.query(
      `select l.licence_id, l.offre_code, l.statut, l.organisations, l.sieges_occupes,
              l.lectures_droit, l.lectures_consommees, l.recharges_disponibles,
              l.recharges_gelees, l.recharge_automatique, l.prix_mensuel_ht,
              (select string_agg(o.name, ', ' order by o.name)
                 from facturation.licence_organisations lo
                 join identity.organizations o on o.id = lo.tenant_id
                where lo.licence_id = l.licence_id) as societes
         from plateforme.licences_v l
        order by l.offre_code, l.licence_id`,
    );
    return rows;
  },

  /** Le réglage du paiement en vigueur, et si les secrets du compte marchand sont posés. */
  async reglagePaiement(db: Requete) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.paiement_reglage() as r`,
    );
    return { ...(rows[0]?.r ?? {}), secrets_clictopay: secretsClictopayPoses() };
  },

  async reglerPaiement(
    db: Requete,
    prestataire: string,
    urlApi: string | null,
    urlRetour: string | null,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.paiement_regler($1, $2, $3, $4) as r`,
      [prestataire, urlApi, urlRetour, motif],
    );
    return rows[0]?.r ?? null;
  },

  /** Le réglage de l'abonnement en vigueur : le report d'un mois (0 ou 1). */
  async reglageAbonnement(db: Requete) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.abonnement_reglage() as r`,
    );
    return rows[0]?.r ?? { report_mois: 0 };
  },

  /**
   * La tour règle l'abonnement : le report d'un mois, l'année ouverte ou non,
   * et ses mois offerts. Daté et motivé ; rien ne se réécrit.
   */
  async reglerAbonnement(
    db: Requete,
    reportMois: number,
    annuelOuvert: boolean,
    annuelMoisOfferts: number,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.abonnement_regler($1::smallint, $2, $3::smallint, $4) as r`,
      [reportMois, annuelOuvert, annuelMoisOfferts, motif],
    );
    return rows[0]?.r ?? null;
  },

  /** L'émetteur des factures en vigueur, ou `null` tant qu'aucun n'est désigné. */
  async emetteur(db: Requete) {
    const { rows } = await db.query<{ r: unknown }>(`select plateforme.emetteur_en_vigueur() as r`);
    return rows[0]?.r ?? null;
  },

  async chercherOrganisations(db: Requete, texte: string) {
    const { rows } = await db.query(
      `select organisation_id, nom, matricule, juridiction, devise
         from plateforme.organisations_chercher($1)`,
      [texte],
    );
    return rows;
  },

  async designerEmetteur(db: Requete, organisationId: string, valideDes: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.emetteur_designer($1, $2::date) as r`,
      [organisationId, valideDes],
    );
    return rows[0]?.r ?? null;
  },
};
