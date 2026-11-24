/**
 * Le décor des épreuves de la facturation d'avance (périmètre « PME » ouvert) : un émetteur,
 * un opérateur, une PME et sa licence née à une date donnée, le robot du jour, les gestes du
 * titulaire (devis, demande, paiement confirmé). Partagé par les épreuves de la recette Flouci
 * du 24 novembre 2026 — la montée chiffrée, les CGV, le reçu de paiement — pour qu'aucune ne
 * recopie l'autre.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";

import { personnesDEssai } from "../personne-d-essai.ts";

import { uneOrganisation } from "./decor-de-facture.ts";

import type { BilanDuJour } from "./demarrer-la-facturation.ts";

export const ADMIN = process.env["DATABASE_URL_ADMIN"];
export const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

/** Exécute `corps` dans une transaction qu'on annule toujours. */
export async function aBlanc<T>(corps: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    /*
     * Un instantané fixe : les autres fichiers de la suite tournent en même
     * temps et créent des PME (chacune naît avec sa licence). En lecture
     * validée, une licence née entre deux passages du robot était facturée
     * au troisième, et « aucun numéro tiré » tombait sans que ce fichier y
     * soit pour rien (CI de #269, 8 novembre 2026). Ce fichier juge SES
     * licences ; il ne voit plus que le monde tel qu'il était à son début.
     */
    await db.query("begin isolation level repeatable read");
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

export async function enPersonne(db: pg.PoolClient, id: string): Promise<void> {
  await db.query("reset role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
}

/** Le robot de l'API, le jour `jour`. */
export async function passer(db: pg.PoolClient, jour: string): Promise<BilanDuJour> {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  await db.query("set local role malica_api");
  const { rows } = await db.query<{ r: BilanDuJour }>(
    "select fabrique.facturation_du_jour($1::date) as r",
    [jour],
  );
  await db.query("reset role");
  return rows[0]!.r;
}

export interface Socle {
  operateur: string;
  intrus: string;
}

export async function socle(db: pg.PoolClient): Promise<Socle> {
  const [operateur, intrus] = [randomUUID(), randomUUID()];
  await personnesDEssai(db, operateur, intrus);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const emetteur = await uneOrganisation(db, "pme", "Emetteur d'essai");
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2) on conflict (valide_des) do nothing`,
    [emetteur, operateur],
  );
  return { operateur, intrus };
}

/** La tour ouvre (ou coupe) un périmètre, sous l'opérateur. */
export async function regler(
  db: pg.PoolClient,
  s: Socle,
  perimetre: "cabinets" | "pme",
  actif: boolean,
  rattrapage = 1,
) {
  await enPersonne(db, s.operateur);
  await db.query("select plateforme.facturation_auto_regler($1, $2, $3, $4)", [
    perimetre,
    actif,
    rattrapage,
    "Staging : essai de la facturation anniversaire",
  ]);
  await db.query("reset role");
}

export interface Pme {
  titulaire: string;
  tenant: string;
  licence: string;
}

/** Une PME, son dirigeant titulaire, sa licence née le `depuis`, et `places` collaborateurs. */
export async function unePme(
  db: pg.PoolClient,
  depuis: string,
  offre = "solo",
  places = 0,
): Promise<Pme> {
  const titulaire = randomUUID();
  await personnesDEssai(db, titulaire);
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
    titulaire,
    "Selim Ben Amor",
  ]);
  const tenant = await uneOrganisation(db, "pme", "PME anniversaire");
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  const licence = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, $3, $4::date)`,
    [licence, titulaire, offre, depuis],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );
  for (let i = 0; i < places; i++) await unePlace(db, tenant);
  return { titulaire, tenant, licence };
}

/** Une place de plus : un collaborateur entre dans la PME. */
async function unePlace(db: pg.PoolClient, tenant: string) {
  const qui = randomUUID();
  await personnesDEssai(db, qui);
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
    [tenant, qui],
  );
}

/** Le titulaire change d'offre, à la date `le`. */
export async function changer(db: pg.PoolClient, p: Pme, offre: string, le: string) {
  await enPersonne(db, p.titulaire);
  await db.query("select public.forfait_changer($1, $2, $3::date)", [offre, p.tenant, le]);
  await db.query("reset role");
}

export interface Facture {
  id: string;
  numero: string;
  nature: string;
  periode: string;
  emise_le: string;
  couvre_du: string;
  couvre_au: string;
  montant_ht: string;
  timbre: string;
  inclut_la_base: boolean;
  libelle: string;
}

/** Les factures du titulaire d'une licence, lues en administrateur. */
export async function facturesDuTitulaire(db: pg.PoolClient, licence: string): Promise<Facture[]> {
  await db.query("reset role");
  const { rows } = await db.query<Facture>(
    `select f.id, f.numero, f.nature, f.periode::text, f.emise_le::text, f.couvre_du::text,
            f.couvre_au::text, f.montant_ht::text, f.timbre::text, f.inclut_la_base,
            (select string_agg(l.libelle, ' | ' order by l.ordinal)
               from facturation.facture_lignes l where l.facture_id = f.id) as libelle
       from facturation.factures f
      where f.licence_id = $1 and f.payeur_type = 'titulaire' and f.avoir_de is null
      order by f.couvre_du, f.nature`,
    [licence],
  );
  return rows;
}

/** Le prix mensuel HT d'une offre, lu dans la grille (avec `places` en plus). */
export async function prix(
  db: pg.PoolClient,
  offre: string,
  le: string,
  places = 0,
): Promise<number> {
  const { rows } = await db.query<{ p: string }>(
    `select (o.prix_mensuel_ht + o.prix_siege_sup * greatest(0, $3::int - o.sieges_inclus))::text as p
       from ref.offre_a($1, $2::date) o`,
    [offre, le, places],
  );
  return Number(rows[0]!.p);
}

/** Le jour de la plateforme, dans le fuseau de la transaction, décalé de `d` jours. */
export async function jourDe(db: pg.PoolClient, d = 0): Promise<string> {
  await db.query("select set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true)");
  const { rows } = await db.query<{ j: string }>("select (current_date + $1::int)::text as j", [d]);
  return rows[0]!.j;
}

export interface Devis {
  rien_a_regler: boolean;
  a_regler_ttc: number | null;
  au: string | null;
}
export interface Demande {
  change: boolean;
  paiement: { paiement_id: string; montant_ttc: string } | null;
  descente?: { offre: string; le: string } | { annulee: true; offre: string };
}

export async function devis(db: pg.PoolClient, p: Pme, offre: string): Promise<Devis> {
  await enPersonne(db, p.titulaire);
  const { rows } = await db.query<{ d: Devis }>("select public.montee_devis($1, $2) as d", [
    offre,
    p.tenant,
  ]);
  await db.query("reset role");
  return rows[0]!.d;
}

export async function demander(db: pg.PoolClient, p: Pme, offre: string): Promise<Demande> {
  await enPersonne(db, p.titulaire);
  const { rows } = await db.query<{ r: Demande }>("select public.forfait_demander($1, $2) as r", [
    offre,
    p.tenant,
  ]);
  await db.query("reset role");
  return rows[0]!.r;
}

export async function offreEnCours(db: pg.PoolClient, p: Pme): Promise<string> {
  const { rows } = await db.query<{ o: string }>(
    "select offre_code as o from facturation.forfait_courant_v where licence_id = $1",
    [p.licence],
  );
  return rows[0]!.o;
}

/** Le prestataire confirme le paiement (un prestataire qui fait entrer l'argent). */
export async function payer(db: pg.PoolClient, p: Pme, id: string) {
  await enPersonne(db, p.titulaire);
  await db.query(
    "with cgv as (select public.paiement_cgv_accepter($1, (plateforme.cgv_en_vigueur()).id)) select public.paiement_inscrire($1, 'lien_cree', 'clictopay', 'REF-1', 'https://test.clictopay.com/pay/REF-1', '{}', 'visa') from cgv",
    [id],
  );
  await db.query(
    "select public.paiement_inscrire($1, 'paye', 'clictopay', 'REF-1', null, jsonb_build_object('unites_encaissees', (select trunc(v.montant_ttc * power(10::numeric, d.exposant))::bigint::text from facturation.paiements_en_ligne_v v join ref.devises d on d.code = v.devise where v.paiement_id = $1)))",
    [id],
  );
  await db.query("reset role");
  await db.query("set constraints all immediate");
  await db.query("set constraints all deferred");
}

export async function resteDu(db: pg.PoolClient, facture: string): Promise<number> {
  const { rows } = await db.query<{ r: string }>(
    "select reste_du::text as r from facturation.encours_v where facture_id = $1",
    [facture],
  );
  return Number(rows[0]!.r);
}
