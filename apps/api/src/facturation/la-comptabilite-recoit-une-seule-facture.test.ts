/**
 * La comptabilité reçoit UNE facture par mois, qui dit chaque abonnement et chaque passage
 * (décision du dirigeant, 24 novembre 2026 — 20261231300000).
 *
 *   - la comptabilité n'a rien à payer pour activer ou monter un client : tout se retrouve sur
 *     sa facture du mois, une ligne par société et par offre, le passage nommé, avec ses dates ;
 *   - aucun trou ni doublon : chaque jour que la comptabilité doit est sur exactement une ligne,
 *     au montant que la règle des parts donne, et aucun jour qu'elle ne doit pas ;
 *   - la facture du mois part à ses experts (application et courriel), pas à ses collaborateurs ;
 *   - la facture d'une PME entièrement réglée se dit réglée, y compris au renvoi.
 *
 * Sur une vraie base migrée, dans des transactions ANNULÉES. Les jours sont fixés (novembre et
 * décembre 2026) : les lignes d'un mois ne dépendent pas du jour où l'épreuve se joue.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-comptabilite-recoit-une-seule-facture.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import type pg from "pg";

import { personnesDEssai } from "../personne-d-essai.ts";
import { ADMIN, aBlanc, pool } from "./decor-d-avance.ts";
import {
  type Comptabilite,
  type Decor,
  decor,
  jourParJour,
  millimes,
  factureDuCabinet,
  uneComptabilite,
} from "./decor-de-facture.ts";

interface Ligne {
  licence_id: string;
  organisation: string;
  offre_code: string;
  offre_avant: string | null;
  du: string;
  au_exclu: string;
  jours: number;
  jours_du_mois: number;
  montant_ht: string;
}

async function lignesDuMois(db: pg.PoolClient, cabinet: string, mois: string): Promise<Ligne[]> {
  const { rows } = await db.query<Ligne>(
    `select licence_id, organisation, offre_code, offre_avant, du::text, au_exclu::text, jours,
            jours_du_mois, montant_ht::text
       from facturation.lignes_a_facturer_cabinet($1, $2::date)
      order by du`,
    [cabinet, mois],
  );
  return rows;
}

/** Un accès de la comptabilité sur [du, au[ (`au` nul : toujours actif). */
async function acces(
  db: pg.PoolClient,
  d: Decor,
  c: Comptabilite,
  offre: string,
  du: string,
  au: string | null,
): Promise<void> {
  await db.query(
    `insert into facturation.acces
       (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
        propose_le, propose_par, repondu_le, repondu_par, effet_du, effet_au, motif_fin)
     values ($1, $2, 'cabinet', $3, $4, (ref.offre_a($4, $5::date)).effective_from,
             case when $6::date is null then 'actif' else 'termine' end,
             $5::date, $7, $5::date, $8, $5::date, $6::date,
             case when $6::date is null then null else 'changement_offre' end)`,
    [d.tenant, d.licence, c.cabinet, offre, du, au, c.expert, d.titulaire],
  );
}

/** Les jours de [du, au[, un par un. */
function joursDe(du: string, au: string): string[] {
  const jours: string[] = [];
  for (let j = new Date(`${du}T00:00:00Z`); j < new Date(`${au}T00:00:00Z`);) {
    jours.push(j.toISOString().slice(0, 10));
    j.setUTCDate(j.getUTCDate() + 1);
  }
  return jours;
}

/** Novembre : Solo du 1er au 10, Team à partir du 11 ; la comptabilité arrête le 16 décembre. */
async function unPassage(db: pg.PoolClient): Promise<{ d: Decor; c: Comptabilite }> {
  const d = await decor(db, "solo", "2026-11-01");
  const c = await uneComptabilite(db, d);
  await acces(db, d, c, "solo", "2026-11-01", "2026-11-11");
  await acces(db, d, c, "team", "2026-11-11", "2026-12-16");
  // Le forfait suit la montée, décidée par l'expert (comme `acces_changer_offre`).
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [c.expert]);
  await db.query("select facturation.forfait_poser($1, 'team', date '2026-11-11')", [d.licence]);
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  return { d, c };
}

describe("la comptabilité reçoit une seule facture", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le passage d'offre se lit : une ligne par offre, avec ses dates", async () => {
    await aBlanc(async (db) => {
      const { c } = await unPassage(db);
      const novembre = await lignesDuMois(db, c.cabinet, "2026-11-01");
      assert.deepEqual(
        novembre.map((l) => [l.offre_code, l.offre_avant, l.du, l.au_exclu, l.jours]),
        [
          ["solo", null, "2026-11-01", "2026-11-11", 10],
          ["team", "solo", "2026-11-11", "2026-12-01", 20],
        ],
      );
      const decembre = await lignesDuMois(db, c.cabinet, "2026-12-01");
      assert.deepEqual(
        decembre.map((l) => [l.offre_code, l.offre_avant, l.du, l.au_exclu, l.jours]),
        [["team", null, "2026-12-01", "2026-12-16", 15]],
        "après le 16 décembre, la comptabilité ne doit plus rien",
      );
    });
  });

  it("aucun trou, aucun doublon : chaque jour dû est sur une ligne, au montant des parts", async () => {
    await aBlanc(async (db) => {
      const { d, c } = await unPassage(db);
      for (const [mois, suivant] of [
        ["2026-11-01", "2026-12-01"],
        ["2026-12-01", "2027-01-01"],
        ["2027-01-01", "2027-02-01"],
      ] as const) {
        const parts = await jourParJour(db, d.licence, mois, suivant);
        const dus = parts.filter((j) => j.comptabilite > 0).map((j) => j.jour);
        const lignes = await lignesDuMois(db, c.cabinet, mois);
        const couverts = lignes.flatMap((l) => joursDe(l.du, l.au_exclu));
        assert.deepEqual(couverts, dus, `${mois} : les jours des lignes sont les jours dus`);
        assert.equal(new Set(couverts).size, couverts.length, `${mois} : aucun jour deux fois`);
        const jdm = joursDe(mois, suivant).length;
        for (const l of lignes) {
          const attendu = parts
            .filter((j) => j.jour >= l.du && j.jour < l.au_exclu)
            .reduce((s, j) => s + j.comptabilite / jdm, 0);
          assert.equal(Number(l.montant_ht), millimes(attendu), `${mois} ${l.offre_code}`);
        }
        // Et la PME doit le reste : chaque jour, la comptabilité ou la PME, jamais rien.
        for (const j of parts)
          assert.ok(j.comptabilite + j.pme > 0, `${j.jour} n'est dû par personne`);
      }
    });
  });

  it("la facture du mois nomme le passage, part aux experts et pas aux collaborateurs", async () => {
    await aBlanc(async (db) => {
      const { d, c } = await unPassage(db);
      const collaborateur = randomUUID();
      await personnesDEssai(db, collaborateur);
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
        [c.cabinet, collaborateur],
      );
      // D8 : le relevé du mois, puis son virement inscrit en tour ; la facture naît, réglée.
      const facture = await factureDuCabinet(db, c.cabinet, "2026-11-01", d.operateur);
      assert.equal(facture.abonnements, 1, "un abonnement facturé");
      const { rows: lignes } = await db.query<{ libelle: string; montant_ht: string }>(
        `select libelle, montant_ht::text from facturation.facture_lignes
          where facture_id = $1 order by ordinal`,
        [facture.facture_id],
      );
      assert.equal(lignes.length, 2);
      assert.match(
        lignes[0]!.libelle,
        /^Abonnement Solo — .+ — du 01\/11\/2026 au 10\/11\/2026 \(10\/30 jours\)$/,
      );
      assert.match(
        lignes[1]!.libelle,
        /^Passage Solo → Team — .+ — du 11\/11\/2026 au 30\/11\/2026 \(20\/30 jours\)$/,
      );
      const { rows: f } = await db.query<{ ht: string; organisations: number }>(
        "select montant_ht::text as ht, organisations from facturation.factures where id = $1",
        [facture.facture_id],
      );
      assert.equal(
        Number(f[0]!.ht),
        millimes(lignes.reduce((s, l) => s + Number(l.montant_ht), 0)),
        "le total est la somme des lignes",
      );
      assert.equal(f[0]!.organisations, 1);

      const { rows: envois } = await db.query<{
        destinataire: string;
        code: string;
        canal: string;
      }>(
        `select destinataire::text, code, canal from notif.envois
          where sujet_cle = $1 order by canal`,
        [`facture:${facture.facture_id}`],
      );
      assert.deepEqual(
        envois.map((x) => [x.destinataire, x.code, x.canal]),
        [
          [c.expert, "facture.reglee.cabinet", "app"],
          [c.expert, "facture.reglee.cabinet", "email"],
        ],
        "l'expert seul, en application et par courriel",
      );
    });
  });

  it("la facture d'une PME entièrement réglée se dit réglée, même au renvoi", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo", "2026-11-01");
      const { rows: e } = await db.query<{ r: { facture_id: string } }>(
        "select facturation.emission_de_la_licence($1, date '2026-11-01') as r",
        [d.licence],
      );
      const facture = e[0]!.r.facture_id;
      await db.query(
        `insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
         select id, montant_ttc, 'carte', 'essai', date '2026-11-05', $2
           from facturation.factures where id = $1`,
        [facture, d.operateur],
      );
      // Le renvoi : la même fonction, la fenêtre nulle pour ne pas buter sur le premier envoi.
      await db.query("select facturation.avertir_de_la_facture($1, interval '0')", [facture]);
      const { rows } = await db.query<{ code: string }>(
        `select code from notif.envois where sujet_cle = $1 and canal = 'email' order by code`,
        [`facture:${facture}`],
      );
      assert.deepEqual(
        rows.map((r) => r.code),
        ["facture.emise.pme", "facture.reglee.pme"],
        "émise à régler, renvoyée réglée",
      );
    });
  });
});
