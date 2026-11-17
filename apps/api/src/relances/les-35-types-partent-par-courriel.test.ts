/**
 * Les 35 types d'événement partent par courriel — sur la base, sans envoi.
 *
 * Pour chaque type : le moteur (`notif.emettre`) décide un courriel à remettre à
 * la personne ; la file que lit le travailleur (`notif.reserver_courriels`) le
 * rend avec son ton ; le gabarit commun le met en forme, et la requête Brevo qui
 * l'emporterait se construit. Rien ne part : le transport n'est pas appelé, et
 * toute la transaction est annulée. L'envoi réel par Brevo n'est pas éprouvé ici.
 *
 * La liste des 35 et de leur ton est l'oracle : elle dit ce qui doit exister.
 *
 * Le changement de rôle est refusé sur le serveur partagé du poste (`set role
 * malica_api`, comme dans l'épreuve du moteur) : la file est lue sous le rôle
 * propriétaire, qui peut la lire ; le droit de `malica_api` n'est pas éprouvé ici.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { corpsBrevo } from "../courriel/brevo.ts";
import { personnesDEssai } from "../personne-d-essai.ts";

import {
  courrielDeNotification,
  type LigneDeCarte,
  type Palier,
} from "./courriel-de-notification.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

const TON_ATTENDU: Record<string, string> = {
  "acces.propose": "alerte",
  "acces.accepte": "succes",
  "acces.refuse": "erreur",
  "acces.monte": "en_cours",
  "acces.arrete": "alerte",
  "acces.repris": "en_cours",
  "acces.descente_demandee": "alerte",
  "acces.descente_acceptee": "succes",
  "acces.descente_refusee": "erreur",
  "mandat.propose": "alerte",
  "mandat.accepte": "succes",
  "mandat.refuse": "erreur",
  "mandat.revoque": "erreur",
  "mandat.succede": "en_cours",
  "mandat.lettre_au_confrere": "en_cours",
  "place.donnee": "en_cours",
  "place.suggeree": "alerte",
  "piece.a_valider": "alerte",
  "piece.demande": "alerte",
  "piece.demande_tranchee": "neutre",
  "piece.retournee": "erreur",
  "piece.retournee_par_le_proprietaire": "erreur",
  "piece.supprimee_par_le_proprietaire": "erreur",
  "piece.recue_du_siege": "en_cours",
  "piece.partagee": "en_cours",
  "piece.gardee": "neutre",
  "piece.supprimee": "erreur",
  "piece.archivee": "neutre",
  "piece.remplacee": "en_cours",
  "piece.renvoyee": "en_cours",
  "piece.reponse_client": "en_cours",
  "piece.validee": "succes",
  "conseil.arbitrage": "alerte",
  "conseil.repondu": "en_cours",
  "conseil.decide": "succes",
};

// Le point de l'étiquette, dans le clair écrit en ligne (charte du 13 novembre 2026).
const COULEUR: Record<string, string> = {
  succes: "#235340",
  erreur: "#B23A1C",
  alerte: "#8A5B00",
  en_cours: "#1F6FB2",
  neutre: "#5F6673",
};

/** Les jetons que les producteurs fournissent : aucun `{{…}}` ne doit survivre. */
const DONNEES = {
  cabinet: "Cabinet d'essai",
  client: "PME d'essai",
  offre: "solo",
  email: "invite@essai.local",
  theme: "TVA",
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

describe("les 35 types d'événement partent par courriel", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("chaque type a son envoi par courriel dans fr, en et ar", async () => {
    await aBlanc(async (db) => {
      const { rows } = await db.query<{ code: string; n: string }>(
        `select g.code, count(*)::text as n
           from notif.gabarits g
          where g.canal = 'email' and g.effective_from <= current_date
          group by g.code`,
      );
      const parCode = new Map(rows.map((r) => [r.code, Number(r.n)]));
      const diffuses = await db.query<{ code: string }>(
        `select code from notif.diffusions
          where canal = 'email' and valid_from <= current_date
            and (valid_to is null or valid_to > current_date)`,
      );
      const diffusesSet = new Set(diffuses.rows.map((r) => r.code));
      for (const code of Object.keys(TON_ATTENDU)) {
        assert.ok(diffusesSet.has(code), `${code} : pas de diffusion par courriel`);
        assert.equal(parCode.get(code), 3, `${code} : gabarits email fr/en/ar incomplets`);
      }
    });
  });

  it("le moteur décide, la file rend, le gabarit met en forme, la requête se construit", async () => {
    await aBlanc(async (db) => {
      const titulaire = randomUUID();
      await personnesDEssai(db, titulaire);
      const email = `essai-${titulaire}@essai.local`;
      await db.query("update auth.users set email = $2 where id = $1", [titulaire, email]);
      const o = await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         values ('pme', 'Essai courriels 35', 'TN', 'TND') returning id`,
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

      // La file ne rend rien sans réglage de relances : on en pose un, dans la transaction.
      await db.query(
        "insert into plateforme.reglages_relances (actives, suspension_automatique, motif, decide_par) values (false, false, 'essai', $1)",
        [titulaire],
      );

      for (const code of Object.keys(TON_ATTENDU)) {
        await db.query("select notif.emettre($1, $2, $3::jsonb, $4)", [
          tenant,
          code,
          JSON.stringify(DONNEES),
          titulaire,
        ]);
      }

      const file = await (async () => {
        const { rows } = await db.query<{
          email: string;
          locale: string;
          titre: string;
          corps: string;
          action_libelle: string | null;
          action_route: string | null;
          ton: string;
          envoi_id: string;
          libelles: Record<string, string>;
          frise: Palier[] | null;
          donnees: Record<string, unknown> | null;
          sujet: string | null;
          carte: LigneDeCarte[] | null;
        }>("select * from notif.reserver_courriels(1000000, interval '10 minutes')");
        return rows.filter((r) => r.email === email);
      })();

      const codes = new Set<string>();
      const envois = await db.query<{ id: string; code: string }>(
        "select id, code from notif.envois where destinataire = $1 and canal = 'email' and decision = 'a_remettre'",
        [titulaire],
      );
      for (const e of envois.rows) codes.add(e.code);
      assert.deepEqual(
        [...codes].sort(),
        Object.keys(TON_ATTENDU).sort(),
        "un courriel décidé par type, et pour chacun",
      );
      assert.equal(file.length, Object.keys(TON_ATTENDU).length);

      for (const c of file) {
        const envoi = envois.rows.find((e) => e.id === c.envoi_id);
        assert.ok(envoi, "la file rend un envoi décidé");
        const code = envoi.code;
        assert.equal(c.ton, TON_ATTENDU[code], `${code} : ton`);
        const message = courrielDeNotification({
          locale: c.locale,
          code,
          organisation: null,
          urlPublique: "https://app.essai.local",
          titre: c.titre,
          corps: c.corps,
          action:
            c.action_libelle && c.action_route
              ? { libelle: c.action_libelle, url: `https://app.essai.local${c.action_route}` }
              : null,
          ton: c.ton,
          // Les textes du cadre viennent de la base, comme en production.
          libelles: c.libelles,
          frise: c.frise,
          donnees: c.donnees,
          sujet: c.sujet,
          carte: c.carte,
        });
        assert.ok(c.titre.trim().length > 0, `${code} : titre vide`);
        assert.ok(!/\{\{/.test(message.html + message.texte), `${code} : jeton non remplacé`);
        assert.ok(
          message.html.includes(`border-radius:999px;background:${COULEUR[c.ton]};"></span>`),
          `${code} : couleur du ton absente`,
        );
        const requete = JSON.parse(
          corpsBrevo({
            cle: "cle-factice-non-envoyee",
            expediteur: { email: "noreply@essai.local", nom: "Malica Office" },
            destinataire: c.email,
            ...message,
          }),
        ) as { to: Array<{ email: string }>; subject: string };
        assert.equal(requete.to[0]!.email, email);
        // L'objet est celui du gabarit, jetons remplis ; à défaut, le titre.
        assert.equal(requete.subject, message.sujet);
        assert.ok(
          message.sujet.trim().length > 0 && !/\{\{/.test(message.sujet),
          `${code} : objet`,
        );
      }
    });
  });
});
