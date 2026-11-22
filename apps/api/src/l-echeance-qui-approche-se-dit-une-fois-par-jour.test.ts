/**
 * L'échéance qui approche se dit une fois, et par jour (22 novembre 2026).
 *
 * L'oracle est écrit à partir des deux décisions, pas de la fonction :
 *
 *   - une alerte par société et par JOUR d'échéance, avec le nombre de
 *     déclarations de ce jour — jamais une par déclaration ;
 *   - seulement dans le préavis (`notif.preavis`), et pour ce qui reste à faire ;
 *   - une seule fois : le tour suivant ne répète rien.
 *
 *   node --experimental-strip-types --test src/l-echeance-qui-approche-se-dit-une-fois-par-jour.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, horsRlsAuthentificationSeule, sousIdentiteDuServeur } from "./db.ts";
import { tourDesEcheances } from "./notifications/demarrer-les-echeances-qui-approchent.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("l'échéance qui approche", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `echeance-${Date.now()}`;
  const legalId = `${String(Date.now()).slice(-7)}M/A/M/000`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let pme = "";
  let preavis = 0;

  /**
   * Une échéance de la société, `dans` jours après aujourd'hui. Le jour du
   * dossier peut différer d'un jour (son fuseau) : les écarts choisis plus bas
   * tiennent dans le préavis, ou en sortent, de part et d'autre.
   */
  const echeance = async (kind: string, dans: number, status = "a_venir") => {
    await admin.query(
      `insert into schedule.echeances (tenant_id, kind, label, period, due_date, pack_version_id, status)
       select $1, $2, $2, $3,
              current_date + $4::int,
              (select p.id from ref.jurisdiction_packs p order by p.id limit 1), $5`,
      [pme, kind, `${marque}-${kind}`, dans, status],
    );
  };

  const alertes = async () =>
    (
      await admin.query<{ sujet_cle: string; nombre: number; date: string; titre: string }>(
        `select e.sujet_cle, (e.donnees ->> 'nombre')::int as nombre,
                e.donnees ->> 'due_date' as date, e.donnees ->> 'titre' as titre
           from notif.envois e
          where e.tenant_id = $1 and e.destinataire = $2 and e.code = 'echeance.approche'
            and e.canal = 'app'
          order by e.sujet_cle`,
        [pme, dirigeant.id],
      )
    ).rows;

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d);
    dirigeant = d;
    pme = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME ${marque}`, legalId],
      );
      return rows[0]!.id;
    });
    const { rows } = await admin.query<{ jours: number }>(
      `select jours from notif.preavis where code = 'echeance.approche'
        order by valid_from desc limit 1`,
    );
    preavis = rows[0]!.jours;
    assert.ok(preavis >= 3, "le préavis laisse la place à un jour de part et d'autre");
    // Deux déclarations le même jour, dans le préavis.
    await echeance("TVA", 1);
    await echeance("RAS", 1);
    // Une faite, le même jour : elle ne compte pas.
    await echeance("TFP", 1, "fait");
    // Une hors du préavis : rien encore.
    await echeance("IS", preavis + 5);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("une alerte pour le jour, avec le nombre — pas une par déclaration", async () => {
    await tourDesEcheances(horsRlsAuthentificationSeule);
    const a = await alertes();
    assert.equal(a.length, 1);
    assert.equal(a[0]!.nombre, 2);
    assert.match(a[0]!.sujet_cle, new RegExp(`^echeance:${pme}:`));
    assert.ok(a[0]!.titre, "le titre est rendu dans la langue de la personne");
    assert.ok(!/TVA|RAS/.test(a[0]!.titre), "le titre ne dit pas la composition");
  });

  it("le tour suivant ne répète rien", async () => {
    await tourDesEcheances(horsRlsAuthentificationSeule);
    assert.equal((await alertes()).length, 1);
  });

  it("une échéance qui entre dans le préavis se dit à son tour", async () => {
    await admin.query(
      `update schedule.echeances
          set due_date = current_date + $2::int - 1
        where tenant_id = $1 and kind = 'IS'`,
      [pme, preavis],
    );
    await tourDesEcheances(horsRlsAuthentificationSeule);
    const a = await alertes();
    assert.equal(a.length, 2);
    assert.deepEqual(a.map((x) => x.nombre).sort(), [1, 2]);
  });
});
