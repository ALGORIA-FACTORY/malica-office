/**
 * Une facture d'exemple, émise par le vrai chemin — pour l'épreuve du rendu
 * et pour les exemples que le dirigeant regarde (docs/facturation/exemples).
 *
 * Tout est FICTIF : l'émetteur, la société, la personne, les matricules et
 * les adresses sont inventés, les comptes `@essai.local`. Rien n'est écrit
 * dans le code de la facture elle-même : on pose une licence, une recharge et
 * une remise de la tour, puis `facturation.emettre` émet, numérote et rend
 * les libellés depuis la base. Un encaissement partiel et un avoir partiel
 * montrent le « déjà payé », l'avoir et le reste.
 *
 * Importé par les seules épreuves et par l'outil des exemples. Il travaille
 * dans la transaction de l'appelant, qui l'annule.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { personnesDEssai } from "../../personne-d-essai.ts";
import { langueDemandee, lireDocument, type DocumentDeFacture, type Langue } from "./document.ts";

export interface FactureDExemple {
  operateur: string;
  facture: string;
  avoir: string;
  documents: (
    langue: Langue,
    quoi: "facture" | "avoir",
    auJour?: boolean,
  ) => Promise<DocumentDeFacture>;
}

/** Sous l'identité de l'opérateur, comme la tour. */
async function enOperateur<T>(db: pg.PoolClient, operateur: string, travail: () => Promise<T>) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [operateur]);
  const resultat = await travail();
  await db.query("reset role");
  return resultat;
}

export async function emettreUneFactureDExemple(db: pg.PoolClient): Promise<FactureDExemple> {
  const operateur = randomUUID();
  const titulaire = randomUUID();
  await personnesDEssai(db, operateur, titulaire);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  await db.query(
    "insert into identity.profiles (user_id, display_name, locale) values ($1, $2, 'fr')",
    [titulaire, "Selim Ben Amor"],
  );

  const org = async (nom: string, matricule: string, adresse: string) =>
    (
      await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, legal_id, adresse, jurisdiction, currency)
         values ('pme', $1, $2, $3, 'TN', 'TND') returning id`,
        [nom, matricule, adresse],
      )
    ).rows[0]!.id;
  const emetteur = await org(
    "ALGORIA Factory (exemple fictif)",
    "0000000X/A/M/000",
    "Immeuble d'exemple, Les Berges du Lac, 1053 Tunis",
  );
  const societe = await org(
    "Société Exemple SARL",
    "9999999Z/A/M/000",
    "12 rue de l'Exemple, 2000 Le Bardo",
  );
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2)`,
    [emetteur, operateur],
  );
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [societe, titulaire],
  );

  // Le mois facturé : le mois en cours, entier, dans le jour civil de l'émetteur
  // (la grille en vigueur le couvre ; un mois plus ancien pourrait la précéder).
  const { rows: p } = await db.query<{ periode: string; achat: string }>(
    `select date_trunc('month', facturation.jour_de_l_organisation($1))::date::text as periode,
            date_trunc('month', facturation.jour_de_l_organisation($1))::date::text as achat`,
    [emetteur],
  );
  const { periode, achat } = p[0]!;
  const licence = (
    await db.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, 'team', $2::date) returning id`,
      [titulaire, periode],
    )
  ).rows[0]!.id;
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, societe],
  );
  await db.query(
    `insert into facturation.recharges (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
     select $1, r.code, r.lectures, r.prix_ht, $2::date, ($2::date + interval '1 year')::date, 'achat', $3
       from ref.recharges r where r.effective_from <= $2::date
      order by r.effective_from desc, r.lectures desc limit 1`,
    [licence, achat, titulaire],
  );

  return enOperateur(db, operateur, async () => {
    await db.query(
      `select plateforme.remise_accorder($1, 'pourcentage', 20, 'titulaire', $2::date, 1::smallint,
                                         'Exemple : remise de lancement')`,
      [licence, periode],
    );
    const { rows: e } = await db.query<{ r: { facture_id: string } }>(
      "select facturation.emettre($1, $2::date) as r",
      [licence, periode],
    );
    const facture = e[0]!.r.facture_id;
    await db.query(
      `select plateforme.encaissement_inscrire($1, 20, 'virement', 'VIR-EXEMPLE-001', $2::date)`,
      [facture, achat],
    );
    const { rows: a } = await db.query<{ r: { facture_id: string } }>(
      `select plateforme.avoir_emettre($1, 5, 'Exemple : une journée de service interrompue') as r`,
      [facture],
    );
    const avoir = a[0]!.r.facture_id;
    return {
      operateur,
      facture,
      avoir,
      documents: (langue, quoi, auJour = false) =>
        enOperateur(db, operateur, async () => {
          const d = await lireDocument(
            db,
            quoi === "facture" ? facture : avoir,
            langueDemandee(langue),
            auJour,
          );
          if (!d) throw new Error("document introuvable");
          return d;
        }),
    };
  });
}
