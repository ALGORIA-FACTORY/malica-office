/**
 * Le contrat RPC de l'abonnement : le forfait, les places, les sociétés.
 *
 * Cinq méthodes, `facturation.*`, qui ne font que relayer des vues et des
 * fonctions de la base (R3). L'épreuve prouve trois choses, par exécution et
 * par le chemin de production (`sousIdentite` -> `executerRpc`, rôle
 * `authenticated`, RLS en vigueur) :
 *
 *   - chaque méthode rend ce que la base porte POUR L'APPELANT, et rien d'une
 *     autre licence : deux clients, deux titulaires, et aucun ne voit l'autre
 *     (le défaut de la livraison : des vues qui rendaient tous les clients) ;
 *   - un appelant sans droit est refusé, et le refus vient de la base ;
 *   - inviter sur une licence sans place est refusé par la base, pas par un
 *     compte fait ici. Depuis la grille du 19 octobre, Team et Premium n'ont
 *     plus de plafond de sièges : la licence sans place est un Solo.
 *
 * Les deux clients sont validés (commités) : `sousIdentite` ouvre sa propre
 * connexion. Ils s'archivent à la fin, ils ne se suppriment pas (R7).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && ADMIN);

interface Client {
  titulaire: string;
  collaborateurs: string[];
  tenant: string;
  licence: string;
}

describe("le contrat RPC de l'abonnement", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const marque = `abo-${Date.now()}`;
  let a: Client; // Team, 2 sièges occupés sur 10, 2 lectures
  let b: Client; // Team, 10 sièges occupés (sans plafond), 1 lecture
  let s: Client; // Solo : aucune place à offrir
  const etranger = randomUUID(); // un compte sans aucun rattachement
  const operateur = randomUUID(); // la plateforme : lit tout, détient rien

  const rpc = (qui: string, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(qui, (db) => executerRpc(db, { depot, methode, args }));

  /** Un client : organisation, titulaire, collaborateurs, lectures déjà comptées. */
  async function abonner(
    nom: string,
    sieges: number,
    lectures: number,
    offre: "team" | "solo" = "team",
  ): Promise<Client> {
    const titulaire = randomUUID();
    const licence = randomUUID();
    const org = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`${nom} ${marque}`],
    );
    const tenant = org.rows[0]!.id;
    await admin.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, titulaire],
    );
    await admin.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
      titulaire,
      `Dirigeant ${nom}`,
    ]);
    await admin.query(
      `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
       values ($1, $2, $3, current_date)`,
      [licence, titulaire, offre],
    );
    await admin.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [licence, tenant],
    );
    const collaborateurs: string[] = [];
    for (let i = 0; i < sieges; i++) {
      const c = randomUUID();
      collaborateurs.push(c);
      await admin.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
        [tenant, c],
      );
      await admin.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
        c,
        `Collaborateur ${i} ${nom}`,
      ]);
    }
    for (let i = 0; i < lectures; i++) {
      const piece = await admin.query<{ id: string }>(
        `insert into capture.pieces
           (tenant_id, vis, source, storage_path, idempotency_key, created_by)
         values ($1, 'entite'::app.vis_t, 'photo', $2, $2, $3) returning id`,
        [tenant, `${marque}-${nom}-${i}`, titulaire],
      );
      await admin.query(
        `insert into facturation.lectures
           (tenant_id, licence_id, piece_id, periode, consommee_par)
         values ($1, $2, $3, date_trunc('month', current_date)::date, $4)`,
        [tenant, licence, piece.rows[0]!.id, titulaire],
      );
    }
    return { titulaire, collaborateurs, tenant, licence };
  }

  before(async () => {
    a = await abonner("Alpha", 2, 2);
    b = await abonner("Bravo", 10, 1);
    s = await abonner("Solo", 0, 0, "solo");
    await admin.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  });

  after(async () => {
    // R7 : un tenant d'essai s'archive, il ne se supprime pas.
    await admin.query(
      `update identity.organizations
          set archived_at = now(), archived_reason = 'fixture de test automatisé'
        where id = any($1::uuid[])`,
      [[a.tenant, b.tenant, s.tenant]],
    );
    await admin.end();
    await fermerLePool();
  });

  // ---------------------------------------------------------------- monForfait

  it("monForfait rend la ligne de consommation_v de SA licence, et pas celle de l'autre", async () => {
    const attendu = await admin.query(
      `select offre_code as offre, statut, lectures_droit, lectures_consommees,
              lectures_restantes, organisations, sieges_occupes, sieges_inclus, sieges_max,
              prix_mensuel_ht
         from facturation.consommation_v where licence_id = $1`,
      [a.licence],
    );
    assert.equal(attendu.rows.length, 1);

    const vuParA = await rpc(a.titulaire, "facturation", "monForfait");
    assert.deepEqual(vuParA, attendu.rows[0]);

    const vuParB = (await rpc(b.titulaire, "facturation", "monForfait")) as {
      lectures_consommees: number;
      sieges_occupes: number;
    };
    assert.equal(vuParB.lectures_consommees, 1, "B voit SA consommation");
    assert.equal(vuParB.sieges_occupes, 10);
    assert.notDeepEqual(vuParB, vuParA, "deux licences, deux lignes");
  });

  it("monForfait ne rend rien à qui n'est rattaché à aucune licence, plateforme comprise", async () => {
    assert.equal(await rpc(etranger, "facturation", "monForfait"), null);
    // La plateforme lit toutes les licences : sans la borne « titulaire », elle
    // recevrait la ligne d'un client au hasard.
    assert.equal(await rpc(operateur, "facturation", "monForfait"), null);
  });

  it("monForfait rend à un collaborateur le nom de l'offre et le compteur de lectures, ni le prix, ni les places", async () => {
    const duTitulaire = (await rpc(a.titulaire, "facturation", "monForfait")) as Record<
      string,
      unknown
    >;
    const duCollaborateur = (await rpc(
      a.collaborateurs[0]!,
      "facturation",
      "monForfait",
    )) as Record<string, unknown>;

    // Ce qui limite son travail : les lectures de la licence, et le nom de l'offre.
    for (const champ of ["offre", "lectures_droit", "lectures_consommees", "lectures_restantes"]) {
      assert.equal(duCollaborateur[champ], duTitulaire[champ], champ);
    }
    // Ce que son employeur paie : rien de cela ne sort.
    for (const champ of [
      "statut",
      "organisations",
      "sieges_occupes",
      "sieges_inclus",
      "sieges_max",
      "prix_mensuel_ht",
    ]) {
      assert.equal(duCollaborateur[champ], null, `${champ} ne doit pas sortir`);
    }
    // Et il ne voit pas le compteur de l'AUTRE client.
    const deB = (await rpc(b.titulaire, "facturation", "monForfait")) as {
      lectures_consommees: number;
    };
    assert.notEqual(duCollaborateur["lectures_consommees"], deB.lectures_consommees);
  });

  // ------------------------------------------------------------------- sieges

  it("sieges rend les membres de SA licence, et aucun membre d'un autre client", async () => {
    const lignes = (await rpc(a.titulaire, "facturation", "sieges")) as Array<{
      user_id: string;
      nom: string | null;
      role: string;
      tenant_id: string;
      organisation: string;
    }>;
    assert.deepEqual(
      lignes.map((l) => l.user_id).sort(),
      [a.titulaire, ...a.collaborateurs].sort(),
    );
    assert.ok(lignes.every((l) => l.tenant_id === a.tenant));
    assert.ok(lignes.every((l) => l.organisation === `Alpha ${marque}`));
    assert.equal(lignes.find((l) => l.user_id === a.titulaire)?.role, "dirigeant");
    assert.equal(lignes.find((l) => l.user_id === a.titulaire)?.nom, "Dirigeant Alpha");

    const deB = (await rpc(b.titulaire, "facturation", "sieges")) as Array<{ tenant_id: string }>;
    assert.equal(deB.length, 11);
    assert.ok(deB.every((l) => l.tenant_id === b.tenant));
  });

  it("sieges est vide pour qui n'a pas de licence : étranger, collaborateur, plateforme", async () => {
    assert.deepEqual(await rpc(etranger, "facturation", "sieges"), []);
    assert.deepEqual(await rpc(a.collaborateurs[0]!, "facturation", "sieges"), []);
    assert.deepEqual(await rpc(operateur, "facturation", "sieges"), []);
  });

  // ------------------------------------------------------------ organisations

  it("organisations rend SES sociétés et ce que chacune consomme", async () => {
    assert.deepEqual(await rpc(a.titulaire, "facturation", "organisations"), [
      { tenant_id: a.tenant, nom: `Alpha ${marque}`, lectures_consommees: 2 },
    ]);
    assert.deepEqual(await rpc(b.titulaire, "facturation", "organisations"), [
      { tenant_id: b.tenant, nom: `Bravo ${marque}`, lectures_consommees: 1 },
    ]);
    assert.deepEqual(await rpc(etranger, "facturation", "organisations"), []);
    assert.deepEqual(await rpc(operateur, "facturation", "organisations"), []);
  });

  // ------------------------------------------------------------- inviterSiege

  it("inviterSiege sur une licence qui a une place libre inscrit l'invitation", async () => {
    const email = `invite-${marque}@essai.local`;
    const r = (await rpc(a.titulaire, "facturation", "inviterSiege", email, a.tenant)) as {
      id: string;
      email: string;
      role: string;
      deja: boolean;
    };
    assert.equal(r.role, "collaborateur");
    assert.equal(r.deja, false);

    const ligne = await admin.query(
      "select tenant_id, role from identity.invitations where id = $1",
      [r.id],
    );
    assert.deepEqual(ligne.rows, [{ tenant_id: a.tenant, role: "collaborateur" }]);
  });

  it("inviterSiege sur une licence SANS PLACE est refusé par la base, rien n'est inscrit", async () => {
    const avant = await admin.query<{ n: string }>(
      "select count(*) as n from identity.invitations where tenant_id = $1",
      [s.tenant],
    );
    await assert.rejects(
      rpc(s.titulaire, "facturation", "inviterSiege", `premier-${marque}@essai.local`, s.tenant),
      (e: { code?: string }) => e.code === "23514",
    );
    const apres = await admin.query<{ n: string }>(
      "select count(*) as n from identity.invitations where tenant_id = $1",
      [s.tenant],
    );
    assert.equal(apres.rows[0]!.n, avant.rows[0]!.n);
  });

  it("inviterSiege est refusé à qui n'est pas le dirigeant de l'organisation", async () => {
    const email = `refuse-${marque}@essai.local`;
    for (const qui of [a.collaborateurs[0]!, etranger, b.titulaire, operateur]) {
      await assert.rejects(
        rpc(qui, "facturation", "inviterSiege", email, a.tenant),
        (e: { code?: string }) => e.code === "42501",
        `l'appelant ${qui} ne devait pas pouvoir inviter chez Alpha`,
      );
    }
  });

  // ------------------------------------------------------------- libererPlace

  it("libererPlace est refusé à qui n'est pas le dirigeant, dont celui d'un autre client", async () => {
    const cible = a.collaborateurs[0]!;
    for (const qui of [a.collaborateurs[1]!, etranger, b.titulaire]) {
      await assert.rejects(
        rpc(qui, "facturation", "libererPlace", a.tenant, cible),
        (e: { code?: string }) => e.code === "42501",
      );
    }
    const reste = await admin.query(
      "select 1 from identity.memberships where tenant_id = $1 and user_id = $2",
      [a.tenant, cible],
    );
    assert.equal(reste.rows.length, 1, "la place n'a pas été reprise");
  });

  it("libererPlace refuse tant qu'il reste des pièces personnelles, et dit COMBIEN sans rien montrer", async () => {
    const partant = a.collaborateurs[1]!;
    await admin.query(
      `insert into capture.pieces
         (tenant_id, vis, source, storage_path, idempotency_key, created_by)
       values ($1, 'personnel'::app.vis_t, 'photo', $2, $2, $3)`,
      [a.tenant, `${marque}-perso`, partant],
    );
    assert.deepEqual(await rpc(a.titulaire, "facturation", "libererPlace", a.tenant, partant), {
      libere: false,
      motif: "pieces_personnelles_a_trancher",
      pieces: 1,
    });
    const reste = await admin.query(
      "select 1 from identity.memberships where tenant_id = $1 and user_id = $2",
      [a.tenant, partant],
    );
    assert.equal(reste.rows.length, 1, "la place n'est pas reprise");
    // Le dirigeant ne voit toujours pas la pièce : il connaît le nombre, pas le contenu.
    const vues = await sousIdentite(a.titulaire, async (db) => {
      const { rows } = await db.query(
        "select 1 from pieces_v where tenant_id = $1 and created_by = $2",
        [a.tenant, partant],
      );
      return rows.length;
    });
    assert.equal(vues, 0);
  });

  it("libererPlace libère la place quand rien n'est à trancher", async () => {
    const partant = a.collaborateurs[0]!;
    assert.deepEqual(await rpc(a.titulaire, "facturation", "libererPlace", a.tenant, partant), {
      libere: true,
      pieces: 0,
    });
    const reste = await admin.query(
      "select 1 from identity.memberships where tenant_id = $1 and user_id = $2",
      [a.tenant, partant],
    );
    assert.equal(reste.rows.length, 0);

    // Et la base le dit : une place de moins d'occupée.
    const forfait = (await rpc(a.titulaire, "facturation", "monForfait")) as {
      sieges_occupes: number;
    };
    assert.equal(forfait.sieges_occupes, 1);
  });
});
