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

import { z } from "zod";

import type {
  CabinetDeLaTour,
  InterventionDeLaTour,
  PmeDeLaTour,
} from "@malica/socle/ports/repositories";

import type { Requete } from "../db.ts";
import { secretsPoses } from "../paiement/prestataires.ts";
import { versReport } from "./report-d-echeance.ts";

/**
 * L'état d'un ensemble de factures, le pire d'abord : en retard, irrécouvrable,
 * payée en partie, à échoir ; « payée » seulement si une facture l'a été ; rien
 * sans facture, ou si toutes sont annulées. Les états sont ceux de
 * `facturation.encours_v` — l'écran ne les recalcule pas. Une seule
 * définition, pour le cabinet (ses factures consolidées) et pour la PME.
 *
 * `propre` dit quelles factures portent le MONTANT dû de l'appelant : une
 * facture consolidée du cabinet dit l'état de la PME qu'elle couvre, mais sa
 * dette reste celle du cabinet — on ne l'impute à aucune PME. Le reste dû se
 * dit dans la devise des factures (`factures.devise`, celle de l'émetteur),
 * jamais dans celle du client ; plusieurs devises ne s'additionnent pas : le
 * reste dû vaut alors `null`.
 */
function etatDesFactures(propre: string): string {
  const du = `e.etat in ('a_echoir', 'en_retard', 'partielle') and (${propre})`;
  return `
  select case when bool_or(e.etat = 'en_retard') then 'en_retard'
              when bool_or(e.etat = 'irrecouvrable') then 'irrecouvrable'
              when bool_or(e.etat = 'partielle') then 'partielle'
              when bool_or(e.etat = 'a_echoir') then 'a_echoir'
              when bool_or(e.etat = 'payee') then 'payee' end as etat,
         case when count(distinct fa.devise) filter (where ${du}) <= 1
              then coalesce(sum(e.reste_du) filter (where ${du}), 0)::text end as reste_du,
         case when count(distinct fa.devise) filter (where ${du}) = 1
              then min(fa.devise) filter (where ${du}) end as devise_du,
         min(e.echeance_le) filter (where ${du})::text as echeance_le
    from facturation.encours_v e
    join facturation.factures fa on fa.id = e.facture_id`;
}

const Id = z.string().uuid();
/** Un motif se lit un an après devant un client : jamais vide. */
const Motif = z.string().trim().min(1);
const Mois = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Lectures = z.number().int().positive().max(100_000);

/** Une saisie que la porte refuserait : dite par une clé, jamais par une phrase brute. */
function saisie<T>(schema: z.ZodType<T>, valeur: unknown): T {
  const r = schema.safeParse(valeur);
  if (!r.success) throw Object.assign(new Error("refus.saisie.mal_formee"), { code: "22023" });
  return r.data;
}

export const tour = {
  /**
   * Les clients de la plateforme : tous les cabinets, toutes les PME — avec ou
   * sans cabinet. Des compteurs et des états, jamais un papier : la
   * bibliothèque se lit en nombres (`plateforme.bibliotheques_compter`).
   *
   * Chaque lecture passe par la RLS de l'appelant, et chacune porte en plus
   * `(select app.is_platform())` : la base, et pas seulement la garde de
   * `executerRpc`, rend zéro ligne à qui n'est pas opérateur.
   */
  async clients(db: Requete): Promise<{ cabinets: CabinetDeLaTour[]; pme: PmeDeLaTour[] }> {
    const [cabinets, pme] = await Promise.all([
      db.query<CabinetDeLaTour>(
        `select o.id, o.name as nom, o.legal_id as matricule, o.jurisdiction as juridiction,
                o.currency as devise, f.etat, f.reste_du, f.devise_du, f.echeance_le
           from identity.organizations o
           cross join lateral (${etatDesFactures("true")}
            where fa.payeur_type = 'cabinet' and fa.payeur_tenant_id = o.id) f
          where o.kind = 'cabinet' and o.archived_at is null and (select app.is_platform())
          order by o.name, o.id`,
      ),
      db.query<PmeDeLaTour>(
        `with bibliotheques as (select * from plateforme.bibliotheques_compter())
         select o.id, o.name as nom, o.legal_id as matricule, o.currency as devise,
                c.id as cabinet_id, c.name as cabinet_nom,
                coalesce(a.statut = 'actif', false) as paye_par_cabinet,
                l.licence_id, l.offre_code,
                -- Une licence née avant la grille de son offre n'a pas de libellé
                -- daté : celui de la dernière grille, jamais le code brut.
                coalesce(l.offre_libelle,
                         (select r.libelle from ref.offres r where r.code = l.offre_code
                           order by r.effective_from desc limit 1)) as offre_libelle,
                l.statut,
                l.lectures_consommees, l.lectures_droit,
                coalesce(b.documents, 0)::int as documents,
                coalesce(b.transmis_mois_courant, 0)::int as transmis_mois,
                b.dernier_depot_le::text as dernier_depot_le,
                f.etat, f.reste_du, f.devise_du, f.echeance_le
           from identity.organizations o
           left join identity.engagements m on m.pme_org_id = o.id and m.status = 'actif'
           left join facturation.acces a
             on a.tenant_id = o.id and a.canal = 'cabinet' and a.statut <> 'termine'
           left join identity.organizations c on c.id = coalesce(m.cabinet_org_id, a.cabinet_tenant_id)
           left join facturation.licence_organisations lo on lo.tenant_id = o.id
           left join plateforme.licences_v l on l.licence_id = lo.licence_id
           left join bibliotheques b on b.tenant_id = o.id
           cross join lateral (${etatDesFactures("fa.licence_id is not null")}
            where lo.licence_id is not null
              and (fa.licence_id = lo.licence_id
                   or fa.id in (select fl.facture_id from facturation.facture_lignes fl
                                 where fl.licence_id = lo.licence_id))) f
          where o.kind = 'pme' and o.archived_at is null and (select app.is_platform())
          order by o.name, o.id`,
      ),
    ]);
    return { cabinets: cabinets.rows, pme: pme.rows };
  },

  /** Les derniers gestes de la tour sur une licence : qui, quand, pourquoi. */
  async interventions(db: Requete, licenceId: string): Promise<InterventionDeLaTour[]> {
    const { rows } = await db.query<InterventionDeLaTour>(
      `select i.id, i.acte, i.motif, i.valeur::text as valeur, i.effet_du::text as effet_du,
              i.effet_au::text as effet_au, i.created_at::text as le
         from plateforme.interventions i
        where i.licence_id = $1 and (select app.is_platform())
        order by i.created_at desc, i.id
        limit 20`,
      [saisie(Id, licenceId)],
    );
    return rows;
  },

  /** Suspendre une licence : l'œil s'arrête, la capture continue. Motivé. */
  async suspendre(db: Requete, licenceId: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(`select plateforme.suspendre($1, $2) as r`, [
      saisie(Id, licenceId),
      saisie(Motif, motif),
    ]);
    return rows[0]?.r ?? null;
  },

  /** Reprendre une licence suspendue ; la base dit combien de pièces attendent. */
  async reprendre(db: Requete, licenceId: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(`select plateforme.reprendre($1, $2) as r`, [
      saisie(Id, licenceId),
      saisie(Motif, motif),
    ]);
    return rows[0]?.r ?? null;
  },

  /**
   * Des lectures en plus, pour UN mois (« AAAA-MM ») : la fenêtre se borne au
   * mois choisi. `accorder_lectures` laissée sans fin ajouterait le supplément
   * chaque mois, sans limite (`facturation.droits_reels_v`).
   */
  async accorderLectures(
    db: Requete,
    licenceId: string,
    nombre: number,
    mois: string,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.accorder_lectures($1, $2, $3, d.du, (d.du + interval '1 month - 1 day')::date) as r
         from (select to_date($4, 'YYYY-MM') as du) d`,
      [saisie(Id, licenceId), saisie(Lectures, nombre), saisie(Motif, motif), saisie(Mois, mois)],
    );
    return rows[0]?.r ?? null;
  },

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

  /**
   * Le réglage du paiement en vigueur, et si les secrets de son adaptateur sont
   * posés (`null` : ce prestataire n'en a pas).
   */
  async reglagePaiement(db: Requete) {
    const { rows } = await db.query<{ r: Record<string, unknown>; adaptateur: string | null }>(
      `select r, p.adaptateur
         from public.paiement_reglage() r
         join facturation.prestataires_paiement p on p.code = r ->> 'prestataire'`,
    );
    return { ...(rows[0]?.r ?? {}), secrets_poses: secretsPoses(rows[0]?.adaptateur ?? null) };
  },

  /** Les prestataires parmi lesquels la tour choisit, nommés dans la langue de l'opérateur. */
  async prestatairesDePaiement(db: Requete, locale: string) {
    const { rows } = await db.query(
      `select p.code, p.ouvre_le_paiement, p.exige_url_api,
              coalesce(demandee.value, francais.value, p.code) as libelle
         from facturation.prestataires_paiement p
         left join ref_labels_v demandee
           on demandee.ns = 'prestataire_paiement' and demandee.key = p.code
          and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'prestataire_paiement' and francais.key = p.code
          and francais.locale = 'fr'
        order by p.rang`,
      [locale],
    );
    return rows;
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

  /** Le plafond de dépense IA par organisation et par mois (dollars), en vigueur. */
  async reglageIa(db: Requete) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select (select to_jsonb(r) - 'decide_par' from plateforme.reglages_ia r
                order by r.decide_le desc, r.id desc limit 1) as r`,
    );
    return rows[0]?.r ?? null;
  },

  /** La tour règle le plafond IA : daté et motivé ; rien ne se réécrit (ANO-029). */
  async reglerIa(db: Requete, plafondUsd: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.ia_regler($1::numeric, $2) as r`,
      [plafondUsd, motif],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * La chaîne de désignation : ses maillons (modèle, plafond, dépense de la
   * période, épuisé ou non), les modèles tarifés qu'on peut y mettre, et les
   * dernières bascules (`plateforme.designation_etat`).
   */
  async designation(db: Requete) {
    const { rows } = await db.query<{ r: unknown }>(`select plateforme.designation_etat() as r`);
    return rows[0]?.r ?? null;
  },

  /** La tour règle un rang de la chaîne : modèle, période, plafond. Daté, motivé, en ajout seul. */
  async reglerDesignation(
    db: Requete,
    rang: number,
    modele: string,
    role: string,
    periode: string,
    plafondUsd: string,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.designation_regler($1::smallint, $2, $3, $4, $5::numeric, $6) as r`,
      [rang, modele, role, periode, plafondUsd, motif],
    );
    return rows[0]?.r ?? null;
  },

  /** Les relances d'impayé : la dernière décision de la tour, ou `null` (fermées). */
  async reglageRelances(db: Requete) {
    const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
      `select (select to_jsonb(r) - 'decide_par' - 'rang' from plateforme.reglages_relances r
                order by r.decide_le desc, r.rang desc limit 1) as r`,
    );
    return rows[0]?.r ?? null;
  },

  /** La tour ouvre ou ferme les relances, et la suspension automatique : daté et motivé. */
  async reglerRelances(
    db: Requete,
    actives: boolean,
    suspensionAutomatique: boolean,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.relances_regler($1, $2, $3) as r`,
      [actives, suspensionAutomatique, motif],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * L'émission automatique : pour chaque périmètre (cabinets, PME), la décision
   * en vigueur, qui l'a prise, le dernier passage.
   */
  async reglageFacturationAuto(db: Requete) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.facturation_auto_etat() as r`,
    );
    return rows[0]?.r ?? null;
  },

  /** La tour ouvre ou coupe un périmètre de l'émission : daté, motivé, en ajout seul. */
  async reglerFacturationAuto(
    db: Requete,
    perimetre: string,
    actif: boolean,
    rattrapageMois: number,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.facturation_auto_regler($1, $2, $3, $4) as r`,
      [perimetre, actif, rattrapageMois, motif],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * La passe de nuit : le réglage en vigueur, et l'état du relecteur de nuit
   * avec son libellé dans la langue demandée (le français à défaut).
   */
  async reglageRelectureNuit(db: Requete, locale: string) {
    const { rows } = await db.query<{ reglage: unknown; compte: unknown }>(
      `select (select to_jsonb(r) - 'decide_par' from plateforme.reglages_relecture_nuit r
                order by r.decide_le desc, r.id desc limit 1) as reglage,
              (select jsonb_build_object('code', v.code, 'actif', v.actif, 'motif', v.motif,
                                         'decide_le', v.decide_le,
                                         'libelle', coalesce(l.value, f.value, v.code))
                 from identity.comptes_de_service_v v
                 left join ref_labels_v l on l.ns = 'compte_de_service' and l.key = v.code
                                         and l.locale = $1
                 left join ref_labels_v f on f.ns = 'compte_de_service' and f.key = v.code
                                         and f.locale = 'fr'
                order by v.code limit 1) as compte`,
      [locale],
    );
    return { reglage: rows[0]?.reglage ?? null, compte: rows[0]?.compte ?? null };
  },

  /** La tour règle la passe de nuit : daté, motivé, en ajout seul. */
  async reglerRelectureNuit(
    db: Requete,
    r: {
      actif: boolean;
      fenetreDebut: string;
      fenetreFin: string;
      plafondUsd24hPlateforme: string;
      plafondUsd24hDossier: string;
      relecturesMax24hDossier: number;
      partMaxPlafondMensuel: string;
      alerteRetardNuits: number;
    },
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.relecture_nuit_regler($1, $2::time, $3::time, $4::numeric, $5::numeric,
                                                $6, $7::numeric, $8, $9) as r`,
      [
        r.actif,
        r.fenetreDebut,
        r.fenetreFin,
        r.plafondUsd24hPlateforme,
        r.plafondUsd24hDossier,
        r.relecturesMax24hDossier,
        r.partMaxPlafondMensuel,
        r.alerteRetardNuits,
        motif,
      ],
    );
    return rows[0]?.r ?? null;
  },

  /** La tour active ou révoque un compte de service, sans déploiement : motivé, en ajout seul. */
  async reglerCompteDeService(db: Requete, code: string, actif: boolean, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select identity.compte_de_service_regler($1, $2, $3) as r`,
      [code, actif, motif],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * Ce que la passe de nuit a fait, par dossier et par jour local du dossier
   * (`plateforme.relectures_de_nuit_v`), et les derniers passages avec leur
   * raison d'arrêt. Les bornes ne sont qu'une borne d'affichage.
   */
  async relecturesDeNuit(db: Requete) {
    const [lignes, passages] = await Promise.all([
      db.query(
        `select jour, tenant_id, dossier, retenues, ecartees, abstentions, pannes, epuisees,
                en_attente, plus_ancienne_nuits, en_retard, cout_usd::text as cout_usd, sans_cout
           from plateforme.relectures_de_nuit_v
          order by jour desc nulls first, dossier
          limit 200`,
      ),
      db.query(
        `select id, ouvert_le, raison, ferme_le, compteurs
           from plateforme.passages_de_nuit_v
          order by ouvert_le desc
          limit 20`,
      ),
    ]);
    return { lignes: lignes.rows, passages: passages.rows };
  },

  /** L'émetteur des factures en vigueur, ou `null` tant qu'aucun n'est désigné. */
  async emetteur(db: Requete) {
    const { rows } = await db.query<{ r: unknown }>(`select plateforme.emetteur_en_vigueur() as r`);
    return rows[0]?.r ?? null;
  },

  /**
   * Qui appartient à une organisation, et qui est titulaire de sa licence
   * (4 novembre 2026) : en lecture, pour la plateforme seule. Sans cela, la
   * Tour refusait de confier une société « déjà dirigée » sans dire par qui.
   */
  async membresDeLOrganisation(db: Requete, organisationId: string) {
    const { rows } = await db.query(
      `select user_id, email, nom, role, depuis::text, titulaire_licence
         from public.plateforme_organisation_membres($1)`,
      [organisationId],
    );
    return rows;
  },

  /**
   * Confier une société SANS AUCUN membre à son premier dirigeant, un compte
   * existant (4 novembre 2026) : sa licence naît à son nom. Une société qui a
   * déjà des membres ne se confie pas — ses dirigeants invitent.
   */
  async confierOrganisation(db: Requete, organisationId: string, email: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select public.plateforme_organisation_confier($1, $2) as r`,
      [organisationId, email],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * Archiver une organisation, motif à l'appui : rien ne s'efface (R7), son
   * mandat et l'accès de son cabinet se terminent, son matricule redevient
   * libre. L'émetteur des factures en vigueur ne s'archive pas.
   */
  async archiverOrganisation(db: Requete, organisationId: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select public.plateforme_organisation_archiver($1, $2) as r`,
      [organisationId, motif],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * Qui a l'accès total à toutes les organisations (décision du 5 novembre
   * 2026) : depuis quand, pourquoi, et qui l'a donné.
   */
  async accesTotal(db: Requete) {
    const { rows } = await db.query(
      // `depuis` reste un instant : il part en ISO 8601, que tout navigateur lit.
      `select user_id, email, nom, depuis, motif, par_email, operateur
         from plateforme.acces_total_en_vigueur()`,
    );
    return rows;
  },

  /** Accorder l'accès total à un opérateur (soi compris), motif à l'appui : journalisé. */
  async accorderAccesTotal(db: Requete, email: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.acces_total_accorder($1, $2) as r`,
      [email, motif],
    );
    return rows[0]?.r ?? null;
  },

  /** Retirer l'accès total, motif à l'appui : journalisé, en ajout seul. */
  async retirerAccesTotal(db: Requete, personne: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.acces_total_retirer($1, $2) as r`,
      [personne, motif],
    );
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
