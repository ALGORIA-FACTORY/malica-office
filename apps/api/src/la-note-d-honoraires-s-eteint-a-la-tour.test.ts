/**
 * La note d'honoraires s'éteint à la tour, sans rien supprimer (décision du
 * dirigeant, 12 novembre 2026 — recette du 11, point 7.4).
 *
 * L'interrupteur « Notes d'honoraires » est une table de la plateforme, datée,
 * motivée, en ajout seul, livrée ÉTEINTE. Éteint : l'écran lit « non » et les
 * portes qui créent, émettent, encaissent ou annulent une note refusent par
 * une clé (`refus.honoraires.notes_eteintes`). Le mandat et son forfait, eux,
 * se règlent toujours, et une note déjà émise reste lisible, numéro compris.
 *
 * Tout passe par `/rpc` tel que le serveur le résout (`executerRpc`), sous
 * `authenticated` avec le `sub` de la personne, sur une vraie base migrée,
 * dans une transaction ANNULÉE.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-note-d-honoraires-s-eteint-a-la-tour.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import { MESSAGES } from "@malica/socle/messages";
import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { refusLisible } from "./refus.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

const FONCTION = "notes_honoraires";
const REFUS = "refus.honoraires.notes_eteintes";

async function aBlanc<T>(corps: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

async function enPersonne(db: pg.PoolClient, id: string): Promise<void> {
  await db.query("reset role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
}

interface Monde {
  operateur: string;
  expert: string;
  intrus: string;
  cabinet: string;
  client: string;
  taux: string;
}

async function monter(db: pg.PoolClient): Promise<Monde> {
  const [operateur, expert, intrus] = [1, 2, 3].map(() => randomUUID()) as [string, string, string];
  await personnesDEssai(db, operateur, expert, intrus);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const org = async (kind: string, nom: string) =>
    (
      await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         select $1, $2, o.jurisdiction, o.currency
           from (select p.jurisdiction, p.currency from ref.jurisdiction_packs p
                  where p.effective_from <= current_date
                    and (p.effective_to is null or p.effective_to > current_date)
                  order by p.jurisdiction limit 1) o
         returning id`,
        [kind, nom],
      )
    ).rows[0]!.id;
  const cabinet = await org("cabinet", "Comptabilité aux notes éteintes");
  const client = await org("pme", "Cliente aux notes éteintes");
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
    [cabinet, expert],
  );
  await db.query(
    `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
     values ($1, $2, 'actif', current_date)`,
    [client, cabinet],
  );
  // Un taux du pack en vigueur du cabinet : lu, jamais écrit ici (R4).
  const { rows } = await db.query<{ code: string }>(
    `select t.code
       from identity.organizations o
       join ref.jurisdiction_packs p on p.jurisdiction = o.jurisdiction
        and p.effective_from <= current_date
        and (p.effective_to is null or p.effective_to > current_date)
       join ref.tva_rates t on t.pack_version_id = p.id
        and t.valid_from <= current_date and (t.valid_to is null or t.valid_to >= current_date)
      where o.id = $1
      order by t.rate desc limit 1`,
    [cabinet],
  );
  return { operateur, expert, intrus, cabinet, client, taux: rows[0]!.code };
}

const rpc = <T = unknown>(
  db: pg.PoolClient,
  depot: string,
  methode: string,
  args: unknown[] = [],
) => executerRpc(db, { depot, methode, args }) as Promise<T>;

/** La tour allume ou éteint, sous l'opérateur. */
async function regler(db: pg.PoolClient, m: Monde, actif: boolean): Promise<unknown> {
  await enPersonne(db, m.operateur);
  return rpc(db, "tour", "reglerFonction", [
    FONCTION,
    actif,
    actif ? "Essai : rallumage sur une base de test" : "Essai : extinction",
  ]);
}

function brouillon(m: Monde) {
  return {
    cabinetTenantId: m.cabinet,
    clientTenantId: m.client,
    periodeDu: "2026-11-01",
    periodeAu: "2026-11-30",
    tauxTvaCode: m.taux,
    lignes: [{ libelle: "Forfait mensuel", quantite: "1", prixUnitaire: "250" }],
  };
}

/** Le refus tel que la frontière de l'API le dit : la clé, rien d'autre. */
async function refuse(db: pg.PoolClient, geste: () => Promise<unknown>): Promise<string | null> {
  await db.query("savepoint geste");
  try {
    await geste();
    await db.query("release savepoint geste");
    return null;
  } catch (erreur) {
    await db.query("rollback to savepoint geste");
    return refusLisible(erreur) ?? `non dit : ${(erreur as Error).message}`;
  }
}

describe("la note d'honoraires s'éteint à la tour", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("est livrée éteinte, datée et motivée, sans auteur", async () => {
    await aBlanc(async (db) => {
      const { rows } = await db.query<{ actif: boolean; motif: string; decide_par: string | null }>(
        `select actif, motif, decide_par from plateforme.reglages_fonctions
          where fonction = $1 order by decide_le, rang limit 1`,
        [FONCTION],
      );
      assert.equal(rows[0]?.actif, false);
      assert.ok((rows[0]?.motif ?? "").length > 0);
      assert.equal(rows[0]?.decide_par, null);
    });
  });

  it("éteinte : l'écran lit « non », et le serveur refuse de créer par une clé dite en trois langues", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      await regler(db, m, false);
      await enPersonne(db, m.expert);
      assert.equal(await rpc(db, "honoraires", "notesOuvertes"), false);
      assert.equal(
        await refuse(db, () => rpc(db, "honoraires", "creerBrouillon", [brouillon(m)])),
        REFUS,
      );
      const { rows } = await db.query("select 1 from factures_honoraires_v where tenant_id = $1", [
        m.cabinet,
      ]);
      assert.equal(rows.length, 0, "aucune note n'a été créée");
      for (const dico of Object.values(MESSAGES)) {
        assert.ok((dico as Record<string, string>)[REFUS], "le refus a son message");
      }
      assert.equal(
        (MESSAGES.fr as Record<string, string>)[REFUS],
        "Les notes d’honoraires arrivent dans une prochaine version.",
      );
    });
  });

  it("éteinte : le mandat et son forfait se règlent toujours", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      await regler(db, m, false);
      await enPersonne(db, m.expert);
      const mandat = await rpc<{ id: string }>(db, "honoraires", "definirMandat", [
        {
          cabinetTenantId: m.cabinet,
          clientTenantId: m.client,
          mode: "forfait",
          frequence: "mensuelle",
          jourFacturation: 1,
          forfait: "250",
          tauxHoraire: null,
          delaiPaiementJours: 30,
          couverture: ["Tenue comptable"],
        },
      ]);
      assert.ok(mandat.id);
      const mandats = await rpc<Array<{ id: string }>>(db, "honoraires", "mandats", [m.cabinet]);
      assert.ok(mandats.some((x) => x.id === mandat.id));
    });
  });

  it("seul un opérateur règle l'interrupteur, avec un motif, pour une fonction qui existe", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      await enPersonne(db, m.intrus);
      assert.equal(
        await refuse(db, () => rpc(db, "tour", "reglerFonction", [FONCTION, true, "Je veux"])),
        "refus.reserve.plateforme",
      );
      assert.equal(
        await refuse(db, () => rpc(db, "tour", "fonctions")),
        "refus.reserve.plateforme",
      );
      // La porte de la base tient seule, même sans la garde de l'API.
      assert.equal(
        await refuse(db, () =>
          db.query("select plateforme.fonction_regler($1, true, 'Je veux')", [FONCTION]),
        ),
        "refus.reserve.plateforme",
      );
      await enPersonne(db, m.operateur);
      assert.equal(
        await refuse(db, () => rpc(db, "tour", "reglerFonction", [FONCTION, true, "  "])),
        "refus.saisie.incomplete",
      );
      assert.equal(
        await refuse(db, () => rpc(db, "tour", "reglerFonction", ["inconnue", true, "Motif"])),
        "refus.fonction.inconnue",
      );
    });
  });

  it("allumée puis éteinte : la note émise reste, avec son numéro, et plus rien ne s'y écrit", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      const allumee = (await regler(db, m, true)) as { actif: boolean; motif: string };
      assert.equal(allumee.actif, true);

      await enPersonne(db, m.expert);
      assert.equal(await rpc(db, "honoraires", "notesOuvertes"), true);
      const { id } = await rpc<{ id: string }>(db, "honoraires", "creerBrouillon", [brouillon(m)]);
      const emise = await rpc<{ numero: string }>(db, "honoraires", "emettre", [id]);
      assert.match(emise.numero, /^H-\d{4}-\d{4}$/);
      const second = await rpc<{ id: string }>(db, "honoraires", "creerBrouillon", [brouillon(m)]);

      await regler(db, m, false);
      const etat = await rpc<Record<string, { actif: boolean; motif: string }>>(
        db,
        "tour",
        "fonctions",
      );
      assert.equal(etat[FONCTION]?.actif, false);
      assert.equal(etat[FONCTION]?.motif, "Essai : extinction");

      await enPersonne(db, m.expert);
      assert.equal(await rpc(db, "honoraires", "notesOuvertes"), false);
      // Rien n'est supprimé : la note se lit toujours, numéro compris.
      const lue = await rpc<{ numero: string; statut: string }>(db, "honoraires", "facture", [id]);
      assert.equal(lue.numero, emise.numero);
      assert.equal(lue.statut, "emise");
      const gestes: Array<[string, unknown[]]> = [
        ["creerBrouillon", [brouillon(m)]],
        ["modifierBrouillon", [{ ...brouillon(m), id: second.id }]],
        ["supprimerBrouillon", [second.id]],
        ["emettre", [second.id]],
        [
          "encaisser",
          [
            {
              factureId: id,
              montant: "10",
              encaisseLe: "2026-11-12",
              moyen: "virement",
              reference: null,
            },
          ],
        ],
        ["avoir", [id]],
      ];
      for (const [methode, args] of gestes) {
        assert.equal(await refuse(db, () => rpc(db, "honoraires", methode, args)), REFUS, methode);
      }

      // En ajout seul : trois décisions (la livrée, l'allumage, l'extinction), aucune réécrite.
      await db.query("reset role");
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from plateforme.reglages_fonctions where fonction = $1",
        [FONCTION],
      );
      assert.ok(rows[0]!.n >= 3);
      assert.equal(
        (await refuse(db, () =>
          db.query("update plateforme.reglages_fonctions set actif = true where fonction = $1", [
            FONCTION,
          ]),
        )) !== null,
        true,
        "une décision ne se réécrit pas",
      );
    });
  });
});
