/**
 * Le décor des épreuves de facture « jour par jour » (recette du 11 novembre
 * 2026) : une PME, sa licence, une comptabilité et son expert, les gestes
 * passés par les VRAIES portes sous l'identité de qui les fait, et la lecture
 * de ce que chacun doit, jour après jour.
 *
 * Tout se joue dans une transaction annulée. Les prix se lisent dans la
 * grille : aucun montant n'est écrit ici.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { ADRESSE_D_ESSAI, matriculeDEssai } from "../matricule-d-essai.ts";
import { inviteeParLaComptabilite, personnesDEssai } from "../personne-d-essai.ts";

export interface Decor {
  operateur: string;
  titulaire: string;
  tenant: string;
  licence: string;
  /** Aujourd'hui, le premier du mois, le premier du mois suivant et celui d'après (AAAA-MM-JJ). */
  jour: string;
  mois: string;
  moisSuivant: string;
  moisDApres: string;
  /** Le nombre de jours du mois, et ceux qui restent aujourd'hui compris. */
  joursDuMois: number;
  joursRestants: number;
}

export interface Comptabilite {
  cabinet: string;
  expert: string;
}

/** Sous l'identité d'une personne, puis retour à l'administrateur. */
export async function enPersonne<T>(
  db: pg.PoolClient,
  qui: string,
  corps: () => Promise<T>,
): Promise<T> {
  await db.query("savepoint en_personne");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
  try {
    const r = await corps();
    await db.query("reset role");
    await db.query("release savepoint en_personne");
    return r;
  } catch (erreur) {
    await db.query("rollback to savepoint en_personne");
    await db.query("reset role");
    throw erreur;
  }
}

/**
 * Une organisation dans la juridiction de l'émetteur : celle dont le pack
 * porte la TVA des factures d'abonnement. Aucune juridiction ni devise n'est
 * écrite ici (R4) : elles se lisent dans le référentiel.
 */
export async function uneOrganisation(
  db: pg.PoolClient,
  kind: string,
  nom: string,
): Promise<string> {
  // Un matricule et une adresse d'essai : la facture les porte, et la base refuse de payer sans
  // eux (20261231310000).
  const { rows } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency, legal_id, adresse)
     select $1, $2, p.jurisdiction, p.currency, $3, $4
       from ref.jurisdiction_packs p
      where exists (select 1 from ref.tva_rates r where r.pack_version_id = p.id and r.code = 'TVA19')
      order by p.effective_from desc
      limit 1
     returning id`,
    [kind, nom, matriculeDEssai(), ADRESSE_D_ESSAI],
  );
  return rows[0]!.id;
}

/** Une PME dont la licence est née le premier du mois, à l'offre `offre`, et un émetteur. */
export async function decor(
  db: pg.PoolClient,
  offre: string,
  /** Le jour où la licence naît sur cette offre ; le premier du mois en cours par défaut. */
  depuis?: string,
): Promise<Decor> {
  const [operateur, titulaire] = [randomUUID(), randomUUID()];
  await personnesDEssai(db, operateur, titulaire);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const emetteur = await uneOrganisation(db, "pme", "Emetteur d'essai");
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2) on conflict (valide_des) do nothing`,
    [emetteur, operateur],
  );
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
    titulaire,
    "Samia Ben Salah",
  ]);
  const tenant = await uneOrganisation(db, "pme", "Atelier d'essai");
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  // Le jour de la plateforme, pas celui du serveur. La facturation immédiate et le robot datent leurs
  // factures au jour de la plateforme (son fuseau, lu au référentiel de l'émetteur) ; le reste du
  // moteur lit `current_date`, celui de la session. Entre 23 h et minuit UTC, les deux ne sont pas le
  // même jour (CI de main, nuit du 14 au 15 novembre 2026, fuseau de Tunis). La transaction d'essai
  // prend donc le fuseau de la plateforme — ce que fait le robot dans sa propre transaction — et
  // `current_date` y est partout le jour de la plateforme.
  await db.query("select set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true)");
  const { rows: d } = await db.query<{
    jour: string;
    mois: string;
    suivant: string;
    apres: string;
    jdm: number;
    restants: number;
  }>(
    `select current_date::text as jour,
            date_trunc('month', current_date)::date::text as mois,
            (date_trunc('month', current_date) + interval '1 month')::date::text as suivant,
            (date_trunc('month', current_date) + interval '2 months')::date::text as apres,
            ((date_trunc('month', current_date) + interval '1 month')::date
               - date_trunc('month', current_date)::date)::int as jdm,
            ((date_trunc('month', current_date) + interval '1 month')::date - current_date)::int
              as restants`,
  );
  const licence = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, $3, $4::date)`,
    [licence, titulaire, offre, depuis ?? d[0]!.mois],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );
  return {
    operateur,
    titulaire,
    tenant,
    licence,
    jour: d[0]!.jour,
    mois: d[0]!.mois,
    moisSuivant: d[0]!.suivant,
    moisDApres: d[0]!.apres,
    joursDuMois: d[0]!.jdm,
    joursRestants: d[0]!.restants,
  };
}

/**
 * Une comptabilité, son expert, et son mandat actif sur la PME depuis le premier du mois.
 * Par défaut, elle a invité son client dans Malica ; `invitee: false` décrit une société
 * venue seule, sur l'abonnement de laquelle la comptabilité n'a aucun droit.
 */
export async function uneComptabilite(
  db: pg.PoolClient,
  d: Decor,
  { invitee = true }: { invitee?: boolean } = {},
): Promise<Comptabilite> {
  const expert = randomUUID();
  await personnesDEssai(db, expert);
  const cabinet = await uneOrganisation(db, "cabinet", "Comptabilité d'essai");
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
    [cabinet, expert],
  );
  await db.query(
    `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
     values ($1, $2, 'actif', $3::date)`,
    [d.tenant, cabinet, d.mois],
  );
  // La comptabilité a invité son client : elle peut lui attribuer un abonnement.
  if (invitee) await inviteeParLaComptabilite(db, d.tenant, expert);
  return { cabinet, expert };
}

/** La comptabilité paie `offre` depuis le premier du mois (un accès déjà actif). */
export async function couvreDepuisLeDebutDuMois(
  db: pg.PoolClient,
  d: Decor,
  c: Comptabilite,
  offre: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into facturation.acces
       (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
        propose_le, propose_par, repondu_le, repondu_par, effet_du)
     values ($1, $2, 'cabinet', $3, $4, $5::date, 'actif', $5::date, $6, $5::date, $7, $5::date)
     returning id`,
    [d.tenant, d.licence, c.cabinet, offre, d.mois, c.expert, d.titulaire],
  );
  return rows[0]!.id;
}

export interface Acompte {
  paiement_id: string;
  montant_ht: string;
  montant_ttc: string;
  etat: string;
}

/** Le titulaire change d'offre aujourd'hui, par la porte, et lit ce qu'il a à régler. */
export async function changerDOffre(
  db: pg.PoolClient,
  d: Decor,
  offre: string,
): Promise<Acompte | null> {
  return enPersonne(db, d.titulaire, async () => {
    await db.query("select public.forfait_changer($1, $2)", [offre, d.tenant]);
    return aRegler(db, d);
  });
}

/** Ce que la porte `paiement_montee_preparer` rend au titulaire (à appeler sous son identité). */
async function aRegler(db: pg.PoolClient, d: Decor): Promise<Acompte | null> {
  const { rows } = await db.query<{ p: Acompte | null }>(
    "select public.paiement_montee_preparer($1) as p",
    [d.tenant],
  );
  return rows[0]!.p;
}

/** La montée encore à régler, relue par le titulaire. */
export const monteeARegler = (db: pg.PoolClient, d: Decor) =>
  enPersonne(db, d.titulaire, () => aRegler(db, d));

/**
 * Une personne règle un paiement chez un prestataire qui fait entrer l'argent : CGV
 * acceptées, lien créé, « payé » avec le montant encaissé. La seule façon de payer des épreuves.
 */
export async function payerEnLigne(
  db: pg.PoolClient,
  qui: string,
  paiement: string,
  reference = "REF-1",
): Promise<void> {
  await enPersonne(db, qui, async () => {
    await db.query(
      `with cgv as (select public.paiement_cgv_accepter($1::uuid, (plateforme.cgv_en_vigueur()).id))
       select public.paiement_inscrire($1::uuid, 'lien_cree', 'clictopay', $2,
                'https://test.clictopay.com/pay/' || $2, '{}', 'visa') from cgv`,
      [paiement, reference],
    );
    await db.query(
      `select public.paiement_inscrire($1::uuid, 'paye', 'clictopay', $2, null,
                jsonb_build_object('unites_encaissees',
                  (select trunc(v.montant_ttc * power(10::numeric, d.exposant))::bigint::text
                     from facturation.paiements_en_ligne_v v
                     join ref.devises d on d.code = v.devise
                    where v.paiement_id = $1::uuid)))`,
      [paiement, reference],
    );
  });
}

/** Le titulaire règle son acompte. */
export const regler = (db: pg.PoolClient, d: Decor, paiement: string) =>
  payerEnLigne(db, d.titulaire, paiement);

export interface PartsDuJour {
  jour: string;
  offre: string;
  comptabilite: number;
  pme: number;
}

/** Ce que la comptabilité et la PME doivent, par mois (HT), chaque jour de [du, au[. */
export async function jourParJour(
  db: pg.PoolClient,
  licence: string,
  du: string,
  au: string,
): Promise<PartsDuJour[]> {
  const { rows } = await db.query<{ jour: string; offre: string; cab: string; pme: string }>(
    `select j::date::text as jour, pv.offre_code as offre,
            pv.part_cabinet_ht::text as cab, pv.part_pme_ht::text as pme
       from generate_series($2::date, $3::date - 1, interval '1 day') j
       join facturation.periodes_v pv
         on pv.licence_id = $1 and pv.du <= j::date
        and (pv.au_exclu is null or pv.au_exclu > j::date)
      order by 1`,
    [licence, du, au],
  );
  return rows.map((r) => ({
    jour: r.jour,
    offre: r.offre,
    comptabilite: Number(r.cab),
    pme: Number(r.pme),
  }));
}

/** Les mêmes jours, réduits à leurs paliers : `[premier jour, offre, comptabilité, PME]`. */
export function paliers(jours: PartsDuJour[]): Array<[string, string, number, number]> {
  const p: Array<[string, string, number, number]> = [];
  for (const j of jours) {
    const dernier = p.at(-1);
    if (
      !dernier ||
      dernier[1] !== j.offre ||
      dernier[2] !== j.comptabilite ||
      dernier[3] !== j.pme
    ) {
      p.push([j.jour, j.offre, j.comptabilite, j.pme]);
    }
  }
  return p;
}

/** Ce que la facture du mois de la comptabilité porte pour cette licence (HT). */
export async function factureDeLaComptabilite(
  db: pg.PoolClient,
  cabinet: string,
  licence: string,
  mois: string,
): Promise<number> {
  const { rows } = await db.query<{ ht: string | null }>(
    `select sum(l.montant_ht)::text as ht
       from facturation.lignes_a_facturer_cabinet($1, $2::date) l where l.licence_id = $3`,
    [cabinet, mois, licence],
  );
  return Number(rows[0]!.ht ?? 0);
}

/** Ce que la facture du mois de la PME porte (HT), périmètre « PME » coupé. */
export async function factureDeLaPme(
  db: pg.PoolClient,
  licence: string,
  mois: string,
): Promise<number> {
  const { rows } = await db.query<{ ht: string | null }>(
    `select sum(l.montant_ht)::text as ht
       from facturation.lignes_a_facturer($1, $2::date) l where l.payeur_type = 'titulaire'`,
    [licence, mois],
  );
  return Number(rows[0]!.ht ?? 0);
}

/** Le prix mensuel HT d'une offre aujourd'hui, lu dans la grille. */
export async function prix(db: pg.PoolClient, offre: string): Promise<number> {
  const { rows } = await db.query<{ p: string }>(
    "select (ref.offre_a($1, current_date)).prix_mensuel_ht::text as p",
    [offre],
  );
  return Number(rows[0]!.p);
}

/** Au millime, comme la base. */
export const millimes = (n: number) => Math.round(n * 1000) / 1000;

/** La tour ouvre le périmètre « PME », sous l'opérateur. */
export async function ouvrirLePerimetrePme(db: pg.PoolClient, d: Decor): Promise<void> {
  await enPersonne(db, d.operateur, async () => {
    await db.query("select plateforme.facturation_auto_regler('pme', true, 1, $1)", [
      "Essai : la recette du 11 novembre dans les deux régimes",
    ]);
  });
}

/**
 * Le robot de l'API passe, le jour `jour` : sous le vrai rôle de l'API quand
 * l'administrateur de la base peut le prendre (la CI), sinon sous
 * l'administrateur lui-même (un poste dont le serveur partagé ne le permet pas).
 */
export async function passer(db: pg.PoolClient, jour: string): Promise<void> {
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  await db.query("savepoint robot");
  try {
    await db.query("set local role malica_api");
  } catch {
    await db.query("rollback to savepoint robot");
  }
  await db.query("select fabrique.facturation_du_jour($1::date)", [jour]);
  await db.query("reset role");
  await db.query("release savepoint robot");
}

/**
 * Le titulaire paie ce qui est dû (D7, 25 novembre 2026) : la base ne facture plus avant
 * l'encaissement, elle pose une demande à payer. Chaque demande due encore ouverte d'une
 * licence née dans CETTE transaction se paie par un prestataire qui fait entrer l'argent ;
 * ses factures naissent alors, réglées. Rend les paiements réglés.
 */
export async function payerLesDus(db: pg.PoolClient): Promise<string[]> {
  await db.query("reset role");
  const { rows } = await db.query<{ paiement: string; titulaire: string }>(
    `select d.paiement_id as paiement, l.titulaire
       from facturation.licences l
       cross join lateral facturation.demande_due_ouverte(l.id) d
      where l.created_at = now()
      order by l.id`,
  );
  for (const r of rows) await payerEnLigne(db, r.titulaire, r.paiement);
  await db.query("set constraints all immediate");
  await db.query("set constraints all deferred");
  return rows.map((r) => r.paiement);
}

/** Le robot passe le `jour`, et la PME paie le jour même ce qu'il a rendu dû (D7). */
export async function passerEtPayer(db: pg.PoolClient, jour: string): Promise<void> {
  await passer(db, jour);
  await payerLesDus(db);
}

export interface FactureDAvance {
  nature: string;
  couvre_du: string;
  couvre_au: string;
  montant_ht: number;
  part_mensuelle_ht: number;
}

/** Les factures d'avance du titulaire, lues en administrateur. */
export async function facturesDAvance(
  db: pg.PoolClient,
  licence: string,
): Promise<FactureDAvance[]> {
  const { rows } = await db.query<{
    nature: string;
    couvre_du: string;
    couvre_au: string;
    ht: string;
    part: string;
  }>(
    `select f.nature, f.couvre_du::text, f.couvre_au::text, f.montant_ht::text as ht,
            f.part_mensuelle_ht::text as part
       from facturation.factures f
      where f.licence_id = $1 and f.payeur_type = 'titulaire' and f.avoir_de is null
        and f.ancre is not null
      order by f.couvre_du, f.nature`,
    [licence],
  );
  return rows.map((r) => ({
    nature: r.nature,
    couvre_du: r.couvre_du,
    couvre_au: r.couvre_au,
    montant_ht: Number(r.ht),
    part_mensuelle_ht: Number(r.part),
  }));
}
