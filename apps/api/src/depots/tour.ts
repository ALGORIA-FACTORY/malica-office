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
import { versReport } from "./report-d-echeance.ts";

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

  async designerEmetteur(db: Requete, organisationId: string, valideDes: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.emetteur_designer($1, $2::date, $3) as r`,
      [organisationId, valideDes, motif],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * Le calendrier d'une juridiction : les jours de repos et la règle de
   * report, les jours fériés, et les reports qu'ALGORIA a publiés pour tous.
   */
  async calendrier(db: Requete, juridiction: string) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select plateforme.calendrier_lire($1) as r`,
      [juridiction],
    );
    const r = rows[0]?.r ?? {};
    const regle = r["regle"] as
      { joursRepos: number[]; reportJourOuvrable: boolean; source: string } | null | undefined;
    return {
      regle: regle
        ? {
            joursRepos: (regle.joursRepos ?? []).map(Number),
            reportJourOuvrable: Boolean(regle.reportJourOuvrable),
            source: String(regle.source),
          }
        : null,
      joursFeries: ((r["joursFeries"] as Array<Record<string, unknown>> | undefined) ?? []).map(
        (f) => ({
          id: String(f["id"]),
          mois: f["mois"] == null ? null : Number(f["mois"]),
          jour: f["jour"] == null ? null : Number(f["jour"]),
          le: (f["le"] as string | null) ?? null,
          libelle: String(f["libelle"]),
          source: String(f["source"]),
        }),
      ),
      reports: ((r["reports"] as Array<Record<string, unknown>> | undefined) ?? []).map((x) =>
        versReport({ ...x, origine: "report_algoria" }),
      ),
      obligations: ((r["obligations"] as Array<Record<string, unknown>> | undefined) ?? [])
        .map((o) => ({
          code: String(o["code"]),
          libelle: String(o["libelle"]),
          periodicite: String(o["periodicite"]),
        }))
        .sort((a, b) => a.libelle.localeCompare(b.libelle)),
    };
  },

  /** Un jour férié : fixe (mois et jour) ou daté (`le`). Sourcé, toujours. */
  async poserJourFerie(
    db: Requete,
    input: {
      juridiction: string;
      mois: number | null;
      jour: number | null;
      le: string | null;
      libelle: string;
      source: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select plateforme.jour_ferie_poser($1, $2::smallint, $3::smallint, $4::date, $5, $6) as r`,
      [input.juridiction, input.mois, input.jour, input.le, input.libelle, input.source],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("jour_ferie.non_pose");
    return { id };
  },

  async retirerJourFerie(db: Requete, id: string, motif: string): Promise<{ id: string }> {
    await db.query(`select plateforme.jour_ferie_retirer($1, $2) as r`, [id, motif]);
    return { id };
  },

  /** Un report qui vaut pour toute la juridiction : un communiqué, une prorogation. */
  async publierReport(
    db: Requete,
    input: {
      juridiction: string;
      code: string;
      periode: string;
      nouvelleDate: string;
      motif: string;
      source: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select plateforme.report_publier($1, $2, $3, $4::date, $5, $6) as r`,
      [input.juridiction, input.code, input.periode, input.nouvelleDate, input.motif, input.source],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("report.non_publie");
    return { id };
  },

  async retirerReportPublie(db: Requete, id: string, motif: string): Promise<{ id: string }> {
    await db.query(`select plateforme.report_retirer($1, $2) as r`, [id, motif]);
    return { id };
  },
};
