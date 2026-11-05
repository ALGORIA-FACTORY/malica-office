/**
 * L'accès total (décision du dirigeant, 5 novembre 2026) : un opérateur agit
 * dans toute organisation comme son rôle le plus haut, sans y prendre de
 * place, sans paraître aux clients, sans ouvrir les espaces privés des autres.
 *
 * La société d'essai (deux propriétaires, deux sièges, un cabinet engagé) et
 * ses pièces sont posées par les vraies portes, comme ailleurs. Ce qui touche
 * à l'accès total se joue ensuite dans UNE transaction annulée à la fin de
 * chaque épreuve : la décision se journalise sous l'émetteur des factures en
 * vigueur, que les épreuves de la facturation veulent absent — l'en poser un
 * pour de bon les ferait mentir. Chaque appel y endosse `authenticated` sous
 * l'identité de son auteur et passe par `executerRpc`, comme le navigateur.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/l-acces-total-ouvre-tout-sans-prendre-de-place.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";
import { executerRpc } from "./rpc.ts";

describe("l'accès total ouvre tout, sans prendre de place", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `acces-total-${Date.now()}`;
  let s: SocieteDEssai;
  /** Le titulaire de l'accès, l'opérateur qui l'accorde, un client, un compte sans rôle. */
  let wb: Utilisateur;
  let op: Utilisateur;
  let intrus: Utilisateur;
  let simple: Utilisateur;
  /** Une pièce de la société, une pièce de « Mon espace » de Sami, une envoyée au propriétaire. */
  let commune: string;
  let privee: string;
  let envoyee: string;

  before(async () => {
    s = await monterUneSociete(marque);
    const mdp = "MotDePasseTresLong2026!";
    wb = (await creerCompte(`wb-${marque}@essai.local`, mdp))!;
    op = (await creerCompte(`op-${marque}@essai.local`, mdp))!;
    intrus = (await creerCompte(`i-${marque}@essai.local`, mdp))!;
    simple = (await creerCompte(`s-${marque}@essai.local`, mdp))!;
    assert.ok(wb && op && intrus && simple);
    await s.admin.query(
      `insert into app.platform_operators (user_id, note)
       select unnest($1::uuid[]), $2`,
      [[wb.id, op.id], `épreuve ${marque}`],
    );
    commune = await s.deposer("sami", "entite");
    privee = await s.deposer("sami", "personnel");
    envoyee = await s.deposer("sami", "entite");
    await s.lire("sami", envoyee);
    await s.fait("sami", "collab.envoyer", envoyee);
  });

  after(async () => {
    try {
      await s?.admin.query(`delete from app.platform_operators where user_id = any($1::uuid[])`, [
        [wb?.id, op?.id].filter(Boolean),
      ]);
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  /** Une épreuve entière dans une transaction, annulée à la fin. */
  const aBlanc = async (corps: (db: pg.PoolClient) => Promise<void>) => {
    const db = await s.admin.connect();
    try {
      await db.query("begin");
      // L'émetteur en vigueur : sans lui, l'accès total ne se journalise pas.
      const { rows } = await db.query(
        "select 1 from facturation.emetteurs where valide_des <= current_date",
      );
      if (rows.length === 0) {
        const { rows: o } = await db.query<{ id: string }>(
          `insert into identity.organizations (kind, name, jurisdiction, currency)
           values ('pme', 'Emetteur d''essai', 'TN', 'TND') returning id`,
        );
        await db.query(
          `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
           values ($1, date '2026-01-01', $2)`,
          [o[0]!.id, op.id],
        );
      }
      await corps(db);
    } finally {
      await db.query("rollback");
      db.release();
    }
  };

  /** `qui` sous `authenticated`, marqué serveur comme `sousIdentiteDuServeur`. */
  const en = async (db: pg.PoolClient, qui: Utilisateur) => {
    await db.query("reset role");
    await db.query("set local role authenticated");
    await db.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('malica.origine', 'serveur', true)",
      [qui.id],
    );
  };
  const rpc = async (db: pg.PoolClient, qui: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    await en(db, qui);
    return executerRpc(db, { depot, methode: nom, args });
  };
  const sql = async <T extends pg.QueryResultRow>(
    db: pg.PoolClient,
    qui: Utilisateur,
    texte: string,
    args: unknown[] = [],
  ) => {
    await en(db, qui);
    return (await db.query<T>(texte, args)).rows;
  };
  /** Un refus attendu, sans perdre la transaction. */
  const refuse = async (db: pg.PoolClient, appel: () => Promise<unknown>, attendu: RegExp) => {
    await db.query("savepoint refus");
    await assert.rejects(appel(), attendu);
    await db.query("rollback to savepoint refus");
  };

  const accorder = (db: pg.PoolClient) =>
    rpc(db, op, "tour.accorderAccesTotal", wb.email, "Décision du dirigeant, 5 novembre 2026");
  const sesOrganisations = async (db: pg.PoolClient, qui: Utilisateur) =>
    new Map(
      ((await rpc(db, qui, "identite.listMyOrganizations")) as Array<{ id: string; role: string }>)
        .filter((o) => o.id === s.pme || o.id === s.cabinet)
        .map((o) => [o.id, o.role]),
    );
  const voit = async (db: pg.PoolClient, qui: Utilisateur, piece: string) =>
    (await sql(db, qui, "select 1 from capture.pieces where id = $1", [piece])).length > 0;

  /** Ce que comptent les places, les sièges et la facturation de la société et du cabinet. */
  const comptes = async (db: pg.PoolClient) => {
    await db.query("reset role");
    const { rows } = await db.query<{ licence: string }>(
      "select facturation.licence_de($1) as licence",
      [s.pme],
    );
    const licence = rows[0]!.licence;
    const { rows: places } = await db.query(
      `select facturation.places_occupees($1) as occupees,
              facturation.places_engagees($1) as engagees,
              (select coalesce(jsonb_agg(to_jsonb(p) order by p::text), '[]')
                 from facturation.places_v p where p.licence_id = $1) as places_v,
              (select count(*)::int from identity.memberships m
                where m.tenant_id = any($2::uuid[])) as adhesions`,
      [licence, [s.pme, s.cabinet]],
    );
    const facture = await sql(
      db,
      op,
      `select coalesce(jsonb_agg(to_jsonb(f) order by f::text), '[]') as lignes
         from facturation.a_facturer($1, date_trunc('month', current_date)::date) f`,
      [licence],
    );
    const cabinet = await sql(
      db,
      op,
      `select coalesce(jsonb_agg(to_jsonb(f) order by f::text), '[]') as lignes
         from facturation.a_facturer_cabinet($1, date_trunc('month', current_date)::date) f`,
      [s.cabinet],
    );
    const sieges = await rpc(db, s.gens.amel, "facturation.sieges", s.pme);
    return { places: places[0], facture: facture[0], cabinet: cabinet[0], sieges };
  };

  it("sans accès total, l'opérateur ne voit rien d'une société ni d'un cabinet étrangers", async () => {
    await aBlanc(async (db) => {
      assert.deepEqual(await sesOrganisations(db, wb), new Map());
      assert.equal(await voit(db, wb, commune), false);
      const acces = (await rpc(db, wb, "acces.monAcces", s.pme)) as { role: string | null };
      assert.equal(acces.role, null);
      await refuse(
        db,
        () =>
          rpc(db, wb, "identite.definirOrganisation", {
            tenantId: s.pme,
            name: "Renommée",
            legalId: null,
            jurisdiction: "TN",
          }),
        /introuvable\.organisation/,
      );
      await refuse(
        db,
        () => rpc(db, wb, "parametrage.definirFuseauDuCabinet", s.cabinet, "Africa/Tunis"),
        /introuvable\.cabinet/,
      );
      const [r] = await sql<{ oui: boolean }>(db, wb, "select app.a_l_acces_total() as oui");
      assert.equal(r!.oui, false);
    });
  });

  it("seule la plateforme accorde, à un opérateur, motif à l'appui", async () => {
    await aBlanc(async (db) => {
      // La Tour refuse d'abord, puis la base.
      await refuse(
        db,
        () => rpc(db, intrus, "tour.accorderAccesTotal", intrus.email, "essai"),
        /opérateurs/,
      );
      await refuse(
        db,
        () =>
          sql(db, intrus, "select plateforme.acces_total_accorder($1, 'essai')", [intrus.email]),
        /reserve\.plateforme/,
      );
      await refuse(
        db,
        () => rpc(db, op, "tour.accorderAccesTotal", simple.email, "essai"),
        /acces_total\.pas_operateur/,
      );
      await refuse(
        db,
        () => rpc(db, op, "tour.accorderAccesTotal", wb.email, "  "),
        /acces_total\.motif_requis/,
      );
      await refuse(
        db,
        () => rpc(db, op, "tour.accorderAccesTotal", `inconnu-${marque}@essai.local`, "essai"),
        /introuvable\.compte/,
      );
      await refuse(
        db,
        () => rpc(db, op, "tour.retirerAccesTotal", wb.id, "essai"),
        /acces_total\.non_accorde/,
      );

      const r = (await accorder(db)) as { decision: string; personne: string };
      assert.equal(r.personne, wb.id);
      await refuse(db, () => accorder(db), /acces_total\.deja_accorde/);
      // La décision est au journal, sous son auteur réel.
      await db.query("reset role");
      const { rows: journal } = await db.query(
        `select actor, action, payload->>'personne' as personne from audit.event_log
          where object_table = 'acces_total' and object_id = $1`,
        [r.decision],
      );
      assert.deepEqual(journal, [{ actor: op.id, action: "acces_total.accorde", personne: wb.id }]);
      // La Tour voit qui l'a, et un client ne le lit pas.
      const liste = (await rpc(db, op, "tour.accesTotal")) as Array<{
        email: string;
        par_email: string;
        operateur: boolean;
      }>;
      assert.deepEqual(
        liste.filter((a) => a.email === wb.email).map((a) => [a.par_email, a.operateur]),
        [[op.email, true]],
      );
      assert.deepEqual(
        await sql(db, s.gens.amel, "select * from plateforme.acces_total where user_id = $1", [
          wb.id,
        ]),
        [],
      );
    });
  });

  it("un opérateur s'accorde l'accès total à lui-même : motivé, journalisé à son nom", async () => {
    await aBlanc(async (db) => {
      await refuse(
        db,
        () => rpc(db, wb, "tour.accorderAccesTotal", wb.email, " "),
        /acces_total\.motif_requis/,
      );
      const r = (await rpc(
        db,
        wb,
        "tour.accorderAccesTotal",
        wb.email,
        "Décision du dirigeant",
      )) as { decision: string };
      await db.query("reset role");
      const { rows } = await db.query(
        `select actor, action, payload->>'personne' as personne, payload->>'motif' as motif
           from audit.event_log where object_table = 'acces_total' and object_id = $1`,
        [r.decision],
      );
      assert.deepEqual(rows, [
        {
          actor: wb.id,
          action: "acces_total.accorde",
          personne: wb.id,
          motif: "Décision du dirigeant",
        },
      ]);
      assert.equal((await sesOrganisations(db, wb)).size, 2);
    });
  });

  it("avec l'accès total : il liste et ouvre tout, agit en dirigeant et en expert, journalisé à son nom", async () => {
    await aBlanc(async (db) => {
      await accorder(db);

      assert.deepEqual(
        await sesOrganisations(db, wb),
        new Map([
          [s.pme, "dirigeant"],
          [s.cabinet, "expert"],
        ]),
      );
      const cabinets = (await rpc(db, wb, "supervision.listMyCabinets")) as Array<{ id: string }>;
      assert.ok(cabinets.some((c) => c.id === s.cabinet));
      const clients = (await rpc(db, wb, "supervision.listClients", s.cabinet)) as Array<{
        tenantId?: string;
        pme_org_id?: string;
        id?: string;
      }>;
      assert.ok(clients.length > 0, "les dossiers du cabinet se listent");
      const acces = (await rpc(db, wb, "acces.monAcces", s.pme)) as {
        role: string;
        droits: string[];
      };
      assert.equal(acces.role, "dirigeant");
      assert.ok(acces.droits.includes("societe.tout_voir"));
      assert.equal(await voit(db, wb, commune), true);

      // Un geste d'expert, dans le cabinet.
      await rpc(db, wb, "parametrage.definirFuseauDuCabinet", s.cabinet, "Africa/Tunis");
      // Un geste du dirigeant, dans la société : mettre fin au mandat.
      await rpc(db, wb, "identite.revoquerMandat", s.pme, "Épreuve de l'accès total");

      await db.query("reset role");
      const { rows } = await db.query(
        `select 1 from audit.event_log
          where actor = $1 and tenant_id = $2 and action = 'cabinet.reglages'`,
        [wb.id, s.cabinet],
      );
      assert.equal(rows.length, 1, "le geste d'expert est au journal, à son nom");
      const { rows: mandat } = await db.query<{ status: string }>(
        `select status from identity.engagements where pme_org_id = $1 and cabinet_org_id = $2`,
        [s.pme, s.cabinet],
      );
      assert.deepEqual(mandat, [{ status: "termine" }], "le geste du dirigeant a porté");
    });
  });

  it("il ne prend ni place ni siège, ne paraît dans aucune équipe, et ne pèse sur aucune facture", async () => {
    await aBlanc(async (db) => {
      const avant = await comptes(db);
      await accorder(db);
      // Il ouvre, lit, règle : rien de cela ne se compte.
      await rpc(db, wb, "identite.listMyOrganizations");
      await rpc(db, wb, "parametrage.definirFuseauDuCabinet", s.cabinet, "Africa/Tunis");
      assert.equal(await voit(db, wb, commune), true);
      assert.deepEqual(await comptes(db), avant, "places, sièges et factures inchangés");

      // Absent des listes que voient les clients.
      const sieges = (await rpc(db, s.gens.amel, "facturation.sieges", s.pme)) as Array<{
        user_id: string;
      }>;
      assert.ok(!sieges.some((m) => m.user_id === wb.id), "les sièges de la société");
      const equipe = (await rpc(db, s.gens.expert, "collab.members", s.cabinet)) as Array<{
        userId: string;
      }>;
      assert.ok(!equipe.some((m) => m.userId === wb.id), "l'équipe du cabinet");
      assert.deepEqual(
        await sql(db, s.gens.amel, "select 1 from memberships_v where user_id = $1", [wb.id]),
        [],
        "les adhésions que lit la société",
      );
      assert.deepEqual(
        await sql(db, s.gens.amel, "select 1 from identity.profiles where user_id = $1", [wb.id]),
        [],
        "son profil",
      );
      const quiDirige = (await rpc(db, op, "tour.membresDeLOrganisation", s.pme)) as Array<{
        user_id: string;
      }>;
      assert.ok(!quiDirige.some((m) => m.user_id === wb.id), "« qui dirige », dans la Tour");
      await db.query("reset role");
      const { rows: receveurs } = await db.query(
        "select 1 from app.receveurs_du_circuit($1) r where r = $2",
        [s.pme, wb.id],
      );
      assert.deepEqual(receveurs, [], "il ne reçoit pas le circuit de la société");

      // Lui voit l'équipe du cabinet, et les prénoms des membres de la société.
      const vueDeLui = (await rpc(db, wb, "collab.members", s.cabinet)) as Array<{
        userId: string;
      }>;
      assert.ok(vueDeLui.some((m) => m.userId === s.gens.expert.id));
      assert.equal(
        (await sql(db, wb, "select 1 from identity.profiles where user_id = $1", [s.gens.sami.id]))
          .length,
        1,
      );

      // Ouvrir la pièce envoyée au propriétaire n'écrit pas de « Vue ».
      await rpc(db, wb, "supervision.voir", envoyee);
      await db.query("reset role");
      const { rows: vues } = await db.query("select 1 from capture.vues where piece_id = $1", [
        envoyee,
      ]);
      assert.deepEqual(vues, [], "le siège ne croit pas que son propriétaire l'a vue");
    });
  });

  it("« Mon espace privé » d'un autre reste fermé", async () => {
    await aBlanc(async (db) => {
      await accorder(db);
      assert.equal(await voit(db, wb, commune), true, "la pièce de la société s'ouvre");
      assert.equal(await voit(db, wb, privee), false, "la pièce privée de Sami, non");
      assert.equal(await voit(db, s.gens.sami, privee), true, "Sami la voit toujours");
    });
  });

  it("retirer l'accès, ou retirer l'opérateur, referme tout", async () => {
    await aBlanc(async (db) => {
      await accorder(db);
      assert.equal((await sesOrganisations(db, wb)).size, 2);

      // Plus opérateur : l'accès accordé ne s'exerce plus, et la Tour le dit.
      await db.query("reset role");
      await db.query("savepoint operateur");
      await db.query("delete from app.platform_operators where user_id = $1", [wb.id]);
      assert.deepEqual(await sesOrganisations(db, wb), new Map());
      const liste = (await rpc(db, op, "tour.accesTotal")) as Array<{
        email: string;
        operateur: boolean;
      }>;
      assert.equal(liste.find((a) => a.email === wb.email)?.operateur, false);
      await db.query("rollback to savepoint operateur");
      assert.equal((await sesOrganisations(db, wb)).size, 2);

      await refuse(
        db,
        () => rpc(db, op, "tour.retirerAccesTotal", wb.id, ""),
        /acces_total\.motif_requis/,
      );
      const r = (await rpc(db, op, "tour.retirerAccesTotal", wb.id, "Fin de l'épreuve")) as {
        decision: string;
        actif: boolean;
      };
      assert.equal(r.actif, false);
      assert.deepEqual(await sesOrganisations(db, wb), new Map());
      assert.equal(await voit(db, wb, commune), false);
      await refuse(
        db,
        () => rpc(db, wb, "parametrage.definirFuseauDuCabinet", s.cabinet, "Africa/Tunis"),
        /introuvable\.cabinet/,
      );
      await db.query("reset role");
      const { rows } = await db.query(
        `select actor, action from audit.event_log
          where object_table = 'acces_total' and object_id = $1`,
        [r.decision],
      );
      assert.deepEqual(rows, [{ actor: op.id, action: "acces_total.retire" }]);
      // La décision ne se réécrit pas (R7).
      await refuse(
        db,
        () =>
          db.query("update plateforme.acces_total set actif = true where user_id = $1", [wb.id]),
        /./,
      );
    });
  });

  /*
   * Revue Codex de #231 : le retrait d'une transaction ouverte AVANT un accord
   * concurrent, inscrit après lui sous le verrou, porte un `le` antérieur
   * (`now()` est figé au début de la transaction). Rangées par `le`, les
   * décisions gardaient l'accord. Deux connexions qui valident ne se jouent
   * pas ici — l'accord exige un émetteur validé, que la facturation veut
   * absent — alors l'épreuve pose l'état exact que laisse le chevauchement :
   * l'accord daté APRÈS le retrait, inscrit AVANT lui. Le chevauchement réel,
   * à deux connexions, a été rejoué sur une base jetable (voir la PR).
   */
  it("un retrait inscrit après un accord l'emporte, même daté d'avant", async () => {
    await aBlanc(async (db) => {
      await db.query("reset role");
      await db.query(
        `insert into plateforme.acces_total (user_id, actif, motif, par, le)
         values ($1, true, 'accord concurrent', $2, now() + interval '1 minute')`,
        [wb.id, op.id],
      );
      const r = (await rpc(db, op, "tour.retirerAccesTotal", wb.id, "Retrait concurrent")) as {
        actif: boolean;
      };
      assert.equal(r.actif, false);
      await db.query("reset role");
      const { rows } = await db.query<{ actif: boolean; plus_tot: boolean }>(
        `select actif, le < max(le) over () as plus_tot from plateforme.acces_total
          where user_id = $1 order by rang`,
        [wb.id],
      );
      assert.deepEqual(
        rows,
        [
          { actif: true, plus_tot: false },
          { actif: false, plus_tot: true },
        ],
        "le chevauchement : le retrait, inscrit en dernier, est daté d'avant l'accord",
      );

      const [v] = await sql<{ oui: boolean }>(db, wb, "select app.a_l_acces_total() as oui");
      assert.equal(v!.oui, false, "le retrait vaut");
      assert.deepEqual(await sesOrganisations(db, wb), new Map());
      const liste = (await rpc(db, op, "tour.accesTotal")) as Array<{ email: string }>;
      assert.ok(!liste.some((a) => a.email === wb.email), "la Tour ne le liste plus");
      // Les portes lisent le même ordre : un nouvel accord passe, un second
      // retrait est refusé.
      await refuse(
        db,
        () => rpc(db, op, "tour.retirerAccesTotal", wb.id, "encore"),
        /acces_total\.non_accorde/,
      );
      await accorder(db);
      assert.equal((await sesOrganisations(db, wb)).size, 2);
    });
  });
});
