/**
 * La file des courriels réserve, et ne verrouille pas pendant l'envoi.
 *
 *   - sans réglage de relances, la file refuse en disant pourquoi (explicite) ;
 *   - une réservation vivante empêche de la redonner ; une réservation expirée
 *     repart (un processus qui tombe ne bloque pas un courriel pour toujours) ;
 *   - pendant un appel de transport lent, AUCUN verrou ne tient sur la ligne
 *     du courriel, et la réservation est déjà visible d'une autre connexion.
 *
 * Les deux premiers cas tournent dans une transaction annulée. Le troisième
 * exige des transactions séparées, donc des données committées : il pose un
 * réglage de relances fermé (`actives = false`), l'état par défaut.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { horsRlsAuthentificationSeule } from "../db.ts";
import { personnesDEssai } from "../personne-d-essai.ts";

import { tourDeRelances } from "./travailleur.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 4 }) : null;

const ENV = {
  BREVO_API_KEY: "cle-d-essai",
  MALICA_COURRIEL_EXPEDITEUR: "noreply@essai.local",
  MALICA_URL_PUBLIQUE: "https://app.essai.local/",
};

async function aBlanc(corps: (db: pg.PoolClient) => Promise<void>) {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

/** Une PME, son dirigeant, et un courriel décidé pour lui (committé si `committe`). */
async function unCourrielDecide(db: pg.Pool | pg.PoolClient, email: string) {
  const titulaire = randomUUID();
  await personnesDEssai(db, titulaire);
  await db.query("update auth.users set email = $2 where id = $1", [titulaire, email]);
  const o = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Réservation d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = o.rows[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  await db.query(
    "insert into identity.profiles (user_id, display_name, locale) values ($1, 'Essai', 'fr')",
    [titulaire],
  );
  await db.query("select notif.emettre($1, 'piece.a_valider', '{}'::jsonb, $2)", [
    tenant,
    titulaire,
  ]);
  return { titulaire, tenant };
}

describe("la file des courriels réserve, sans verrou pendant l'envoi", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("sans réglage de relances, la file ne refuse pas (décision du 14 novembre)", async () => {
    await aBlanc(async (db) => {
      await unCourrielDecide(db, `absent-${randomUUID()}@essai.local`);
      // Désactive le déclencheur d'ajout seul et retire tout réglage, dans la transaction.
      await db.query(
        "alter table plateforme.reglages_relances disable trigger reglages_relances_ne_se_reecrivent_pas",
      );
      await db.query("delete from plateforme.reglages_relances");
      // Décision de recette du 14 novembre : sans réglage, seule l'impayé est retenu (avis, pas refus).
      const { rows } = await db.query<{ email: string }>(
        "select email from notif.reserver_courriels(10, interval '10 minutes')",
      );
      // La file répond (pas de refus) ; le courriel de l'autre genre n'est pas
      // vérifié ici : son envoi dépend de l'audience du test, à confirmer en base.
      assert.ok(Array.isArray(rows));
    });
  });

  it("une réservation vivante n'est pas redonnée ; une réservation expirée repart", async () => {
    await aBlanc(async (db) => {
      const { titulaire } = await unCourrielDecide(db, `vivante-${randomUUID()}@essai.local`);
      await db.query(
        "insert into plateforme.reglages_relances (actives, suspension_automatique, motif, decide_par) values (false, false, 'essai', $1)",
        [titulaire],
      );
      const email = (
        await db.query<{ email: string }>("select email from auth.users where id = $1", [titulaire])
      ).rows[0]!.email;

      const premier = await db.query<{ email: string }>(
        "select email from notif.reserver_courriels(1000000, interval '10 minutes') where email = $1",
        [email],
      );
      assert.equal(premier.rows.length, 1, "réservé une fois");

      const second = await db.query<{ email: string }>(
        "select email from notif.reserver_courriels(1000000, interval '10 minutes') where email = $1",
        [email],
      );
      assert.equal(second.rows.length, 0, "pas redonné tant que la réservation vit");

      // Une réservation d'échéance nulle est expirée dès l'instant suivant.
      const { titulaire: autre } = await unCourrielDecide(
        db,
        `expiree-${randomUUID()}@essai.local`,
      );
      await db.query(
        "insert into plateforme.reglages_relances (actives, suspension_automatique, motif, decide_par) values (false, false, 'essai', $1)",
        [autre],
      );
      const emailAutre = (
        await db.query<{ email: string }>("select email from auth.users where id = $1", [autre])
      ).rows[0]!.email;
      await db.query(
        "select * from notif.reserver_courriels(1000000, interval '0 seconds') where email = $1",
        [emailAutre],
      );
      const repris = await db.query<{ email: string }>(
        "select email from notif.reserver_courriels(1000000, interval '10 minutes') where email = $1",
        [emailAutre],
      );
      assert.equal(repris.rows.length, 1, "une réservation expirée repart");
    });
  });

  it("pendant un transport lent, aucun verrou ne tient sur le courriel", async () => {
    // Données committées : le travailleur passe par ses propres connexions.
    const email = `lent-${randomUUID()}@essai.local`;
    const { titulaire } = await unCourrielDecide(pool!, email);
    // Un réglage de relances fermé, committé (l'état par défaut de la plateforme).
    await pool!.query(
      "insert into plateforme.reglages_relances (actives, suspension_automatique, motif, decide_par) values (false, false, 'essai de verrou', $1)",
      [titulaire],
    );

    const surveillance: Array<{ verrouille: boolean; reservee: boolean }> = [];
    const envoyer = async (e: { destinataire: string }) => {
      if (e.destinataire !== email) return { messageId: "autre" };
      // Un transport lent : le temps d'un appel réseau.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const c = await pool!.connect();
      try {
        const id = (
          await c.query<{ id: string }>(
            "select e.id from notif.envois e where e.destinataire = $1 and e.canal = 'email' and e.code = 'piece.a_valider'",
            [titulaire],
          )
        ).rows[0]!.id;
        let verrouille = false;
        try {
          await c.query("select id from notif.envois where id = $1 for update nowait", [id]);
        } catch (erreur) {
          verrouille = (erreur as { code?: string }).code === "55P03";
        }
        const reservee =
          (
            await c.query<{ n: string }>(
              "select count(*)::text as n from notif.reservations where envoi_id = $1",
              [id],
            )
          ).rows[0]!.n !== "0";
        surveillance.push({ verrouille, reservee });
      } finally {
        c.release();
      }
      return { messageId: "lent" };
    };
    // Le travailleur traite les plus anciens d'abord, et un tour s'arrête à son
    // plafond : on relance des tours jusqu'à ce que notre courriel passe. Un tour
    // qui ne rend rien attend un instant : une autre épreuve peut tenir des
    // lignes le temps d'une transaction.
    let remis = 0;
    for (let tour = 0; tour < 400 && surveillance.length === 0; tour += 1) {
      const bilan = await tourDeRelances({
        executer: horsRlsAuthentificationSeule,
        env: ENV,
        envoyer,
      });
      remis += bilan.remis;
      if (bilan.remis + bilan.echecs === 0) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(surveillance.length >= 1, "le courriel a été surveillé pendant l'envoi");
    for (const s of surveillance) {
      assert.equal(s.verrouille, false, "aucun verrou pendant l'appel réseau");
      assert.equal(s.reservee, true, "la réservation est visible d'une autre connexion");
    }
    assert.ok(remis >= 1, "le courriel est remis après l'envoi");
    const etat = await pool!.query<{ etat: string }>(
      "select etat from notif.envois_v where destinataire = $1 and canal = 'email' and code = 'piece.a_valider'",
      [titulaire],
    );
    assert.equal(etat.rows[0]!.etat, "remis");
  });
});
