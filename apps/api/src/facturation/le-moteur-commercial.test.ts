/**
 * Le moteur commercial, de bout en bout, sous les VRAIS rôles — jamais en
 * superutilisateur pour juger (plan du 2 novembre 2026, annexe 2.8).
 *
 * Les acteurs :
 *   T   un opérateur de la tour ;
 *   CA  l'expert du cabinet A, qui a le mandat de la PME de A et la dote ;
 *   CB  l'expert du cabinet B, qui dote la PME de B ;
 *   PA  Amel, titulaire (propriétaire principal) de la PME de A ;
 *   CC  Sonia, collaboratrice de A désignée CHEF DE LA COMPTABILITÉ ;
 *   DA  Bilel, autre dirigeant de A, sans le droit ;
 *   PC  Sami, collaborateur de A, sans le droit ;
 *   P0  le titulaire d'une PME sans cabinet ;
 *   S   le relecteur de nuit, une relecture due sur la PME de A.
 *
 * Les sociétés, comptes et mandats sont posés par les vraies portes et
 * archivés à la fin ; tout ce qui touche à l'argent (émetteur, factures,
 * gestes, passes) vit dans une transaction annulée : aucun émetteur, aucune
 * facture ne survit à l'épreuve, et les autres épreuves, qui tournent en
 * parallèle, ne les voient jamais.
 *
 *   node --experimental-strip-types --test src/facturation/le-moteur-commercial.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "../circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../db.ts";
import { identite } from "../depots/identite.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { personnesDEssai } from "../personne-d-essai.ts";
import { executerRpc } from "../rpc.ts";

type Acteur = "T" | "CA" | "CB" | "PA" | "CC" | "DA" | "PC" | "P0" | "S";
const ACTEURS: readonly Acteur[] = ["T", "CA", "CB", "PA", "CC", "DA", "PC", "P0", "S"];

interface Monde {
  emetteur: string;
  periode: string;
  licenceA: string;
  licenceB: string;
  licence0: string;
  factureA: string;
  factureCabinetA: string;
  factureCabinetB: string;
  facture0: string;
  gesteVisible: string;
  note: string;
}

describe("le moteur commercial", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 3 });
  let a: SocieteDEssai;
  let b: SocieteDEssai;
  let p0: Utilisateur;
  let pme0 = "";
  let service = "";
  const ids: Partial<Record<Acteur, string>> = {};

  before(async () => {
    const marque = Date.now().toString(36);
    a = await monterUneSociete(`com-a-${marque}`);
    b = await monterUneSociete(`com-b-${marque}`);
    const compte = await creerCompte(`com-p0-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compte);
    p0 = compte;
    await sousIdentiteDuServeur(p0.id, (db) => identite.ecrireMonProfil(db, "Nadia", "Essai"));
    pme0 = await sousIdentiteDuServeur(p0.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`SOCIETE SANS CABINET ${marque}`, matriculeDEssai()],
      );
      return rows[0]!.id;
    });
    // Chaque cabinet dote sa PME : il en devient le payeur, et l'essai s'arrête ce jour-là.
    for (const s of [a, b]) {
      const acces = await sousIdentite(s.gens.expert.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "select public.acces_proposer($1, $2, 'team') as id",
          [s.cabinet, s.pme],
        );
        return rows[0]!.id;
      });
      await sousIdentite(s.gens.amel.id, (db) =>
        db.query("select public.acces_repondre($1, true)", [acces]),
      );
    }
    // Le propriétaire principal désigne Sonia chef de la comptabilité, par la porte.
    await sousIdentite(a.gens.amel.id, (db) =>
      executerRpc(db, {
        depot: "facturation",
        methode: "designerChefDeLaComptabilite",
        args: [a.pme, a.gens.sonia.id, true, "Elle tient la comptabilité de la société"],
      }),
    );
    service = (
      await admin.query<{ id: string }>(
        "select app.compte_de_service_id('relecteur_de_nuit') as id",
      )
    ).rows[0]!.id;
    Object.assign(ids, {
      CA: a.gens.expert.id,
      CB: b.gens.expert.id,
      PA: a.gens.amel.id,
      CC: a.gens.sonia.id,
      DA: a.gens.bilel.id,
      PC: a.gens.sami.id,
      P0: p0.id,
      S: service,
    });
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [pme0],
      );
      await a?.fermer();
      await b?.fermer();
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  /* --------------------------------------------------------------- l'outillage */

  /** Pose l'identité d'un acteur dans la transaction, comme `db.ts` la pose. */
  async function comme(db: pg.PoolClient, qui: Acteur) {
    await db.query("set local role authenticated");
    const claim = (k: string, v: string) =>
      db.query("select set_config($1, $2, true)", [`request.jwt.claim.${k}`, v]);
    await claim("sub", ids[qui]!);
    await claim("service", qui === "S" ? "relecteur_de_nuit" : "");
    await claim("service_tenant", qui === "S" ? a.pme : "");
    await db.query("select set_config('malica.origine', $1, true)", [qui === "S" ? "serveur" : ""]);
  }

  async function enSuperutilisateur(db: pg.PoolClient) {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.service', '', true)");
  }

  /** Une requête qui doit échouer, sans emporter la transaction. */
  async function refuse(db: pg.PoolClient, sql: string, params: unknown[], motif: RegExp) {
    await db.query("savepoint essai");
    await assert.rejects(db.query(sql, params), motif, sql);
    await db.query("rollback to savepoint essai");
  }

  async function compter(db: pg.PoolClient, sql: string, params: unknown[]) {
    return Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
  }

  /**
   * Le monde de l'argent, dans la transaction de l'épreuve : un émetteur, des
   * recharges, deux gestes de la tour, et les factures du mois émises par la
   * tour (licence de A, cabinets A et B, licence de P0).
   */
  async function monterLArgent(db: pg.PoolClient): Promise<Monde> {
    ids.T = randomUUID();
    await personnesDEssai(db, ids.T);
    await db.query("insert into app.platform_operators (user_id) values ($1)", [ids.T]);
    const emetteur = (
      await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, legal_id, adresse, jurisdiction, currency)
         values ('pme', 'ALGORIA Factory (épreuve)', '0000000X/A/M/000', 'Tunis', 'TN', 'TND')
         returning id`,
      )
    ).rows[0]!.id;
    await db.query(
      `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
       values ($1, date '2026-01-01', $2)`,
      [emetteur, ids.T],
    );
    const periode = (
      await db.query<{ p: string }>(
        "select date_trunc('month', facturation.jour_de_l_organisation($1))::date::text as p",
        [emetteur],
      )
    ).rows[0]!.p;
    const licence = async (pme: string) =>
      (
        await db.query<{ id: string }>(
          "select licence_id as id from facturation.licence_organisations where tenant_id = $1",
          [pme],
        )
      ).rows[0]!.id;
    const licenceA = await licence(a.pme);
    const licenceB = await licence(b.pme);
    const licence0 = await licence(pme0);
    // Une recharge achetée par chaque titulaire : la PME paie ses recharges, même en essai.
    for (const [l, qui] of [
      [licenceA, a.gens.amel.id],
      [licence0, p0.id],
    ] as const) {
      await db.query(
        `insert into facturation.recharges (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
         select $1, r.code, r.lectures, r.prix_ht, $2::date, ($2::date + interval '1 year')::date, 'achat', $3
           from ref.recharges r where r.effective_from <= $2::date
          order by r.effective_from desc, r.lectures limit 1`,
        [l, periode, qui],
      );
    }
    // Une note interne, écrite comme l'histoire l'a laissée : elle ne sort jamais de la tour.
    const note = (
      await db.query<{ id: string }>(
        `insert into plateforme.interventions (licence_id, acte, motif, operateur)
         values ($1, 'note', 'Note interne : client sensible au prix', $2) returning id`,
        [licenceA, ids.T],
      )
    ).rows[0]!.id;

    await comme(db, "T");
    const geste = await db.query<{ r: { id: string } }>(
      `select plateforme.remise_accorder($1, 'pourcentage', 10, 'cabinet', $2::date, 1::smallint,
                                         'Remise de bienvenue du cabinet') as r`,
      [licenceA, periode],
    );
    await db.query("select plateforme.lectures_offrir($1, 50, 'Geste après un incident')", [
      licenceA,
    ]);
    const emettre = async (sql: string, cible: string) =>
      (await db.query<{ r: { facture_id: string } }>(sql, [cible, periode])).rows[0]!.r.facture_id;
    const factureA = await emettre("select facturation.emettre($1, $2::date) as r", licenceA);
    const facture0 = await emettre("select facturation.emettre($1, $2::date) as r", licence0);
    const factureCabinetA = await emettre(
      "select facturation.emettre_cabinet($1, $2::date) as r",
      a.cabinet,
    );
    const factureCabinetB = await emettre(
      "select facturation.emettre_cabinet($1, $2::date) as r",
      b.cabinet,
    );
    await enSuperutilisateur(db);
    return {
      emetteur,
      periode,
      licenceA,
      licenceB,
      licence0,
      factureA,
      factureCabinetA,
      factureCabinetB,
      facture0,
      gesteVisible: geste.rows[0]!.r.id,
      note,
    };
  }

  async function dansLArgent(corps: (db: pg.PoolClient, m: Monde) => Promise<void>) {
    const db = await admin.connect();
    try {
      await db.query("begin");
      const m = await monterLArgent(db);
      await corps(db, m);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  /* --------------------------------------------------------------- la matrice */

  it("la matrice d'isolation : chacun ne lit que ce qui le concerne", async () => {
    await dansLArgent(async (db, m) => {
      const lic = [m.licenceA, m.licenceB, m.licence0];
      const fac = [m.factureA, m.factureCabinetA, m.factureCabinetB, m.facture0];
      const lire = async () => ({
        licences: await compter(
          db,
          "select count(*) n from facturation.licences where id = any($1)",
          [lic],
        ),
        licenceA: await compter(db, "select count(*) n from facturation.licences where id = $1", [
          m.licenceA,
        ]),
        essaisA: await compter(
          db,
          "select count(*) n from facturation.essais_v where licence_id = $1",
          [m.licenceA],
        ),
        gestesA: await compter(
          db,
          "select count(*) n from plateforme.interventions where licence_id = $1",
          [m.licenceA],
        ),
        noteA: await compter(db, "select count(*) n from plateforme.interventions where id = $1", [
          m.note,
        ]),
        duesA: await compter(
          db,
          "select count(*) n from facturation.lectures_dues where licence_id = $1",
          [m.licenceA],
        ),
        factures: await compter(
          db,
          "select count(*) n from facturation.factures where id = any($1)",
          [fac],
        ),
        factureA: await compter(db, "select count(*) n from facturation.factures where id = $1", [
          m.factureA,
        ]),
        factureCabinetA: await compter(
          db,
          "select count(*) n from facturation.factures where id = $1",
          [m.factureCabinetA],
        ),
        lignesA: await compter(
          db,
          "select count(*) n from facturation.facture_lignes where facture_id = $1",
          [m.factureA],
        ),
        compteurs: await compter(
          db,
          "select count(*) n from facturation.compteurs_documents where emetteur_organisation_id = $1",
          [m.emetteur],
        ),
        reglages: await compter(db, "select count(*) n from plateforme.reglages_commerciaux", []),
        facturesTour: await compter(
          db,
          "select count(*) n from plateforme.factures_v where facture_id = any($1)",
          [fac],
        ),
        gestesTour: await compter(
          db,
          "select count(*) n from plateforme.exceptions_v where licence_id = $1",
          [m.licenceA],
        ),
      });
      const vu = {} as Record<Acteur, Awaited<ReturnType<typeof lire>>>;
      for (const qui of ACTEURS) {
        await comme(db, qui);
        vu[qui] = await lire();
        await enSuperutilisateur(db);
      }
      const tour = vu.T;
      assert.equal(tour.licences, 3, "la tour voit toutes les licences");
      assert.equal(tour.factures, 4, "la tour voit toutes les factures");
      assert.equal(tour.noteA, 1, "la tour lit la note interne");
      assert.ok(
        tour.compteurs >= 1 &&
          tour.reglages >= 1 &&
          tour.facturesTour === 4 &&
          tour.gestesTour >= 3,
      );

      type Vue = (typeof vu)["T"];
      const attendu: Record<Exclude<Acteur, "T">, Partial<Vue>> = {
        CA: {
          licenceA: 1,
          essaisA: 1,
          noteA: 0,
          duesA: 1,
          factureA: 0,
          factureCabinetA: 1,
          factures: 1,
        },
        CB: {
          licenceA: 0,
          essaisA: 0,
          gestesA: 0,
          duesA: 0,
          factureA: 0,
          factureCabinetA: 0,
          factures: 1,
        },
        PA: {
          licenceA: 1,
          essaisA: 1,
          noteA: 0,
          duesA: 1,
          factureA: 1,
          factureCabinetA: 0,
          factures: 1,
        },
        CC: {
          licenceA: 1,
          essaisA: 1,
          noteA: 0,
          duesA: 1,
          factureA: 1,
          factureCabinetA: 0,
          factures: 1,
        },
        DA: { licences: 0, essaisA: 0, gestesA: 0, duesA: 0, factures: 0 },
        PC: { licences: 0, essaisA: 0, gestesA: 0, duesA: 0, factures: 0 },
        P0: { licenceA: 0, licences: 1, gestesA: 0, duesA: 0, factureA: 0, factures: 1 },
        S: { licences: 0, essaisA: 0, gestesA: 0, duesA: 0, factures: 0, lignesA: 0 },
      };
      for (const [qui, cases] of Object.entries(attendu) as Array<
        [Exclude<Acteur, "T">, Partial<Vue>]
      >) {
        for (const [table, n] of Object.entries(cases) as Array<[keyof Vue, number]>) {
          assert.equal(vu[qui][table], n, `${qui} / ${table}`);
        }
        // Rien de la tour, pour personne d'autre qu'elle.
        for (const t of ["compteurs", "reglages", "facturesTour", "gestesTour"] as const) {
          assert.equal(vu[qui][t], 0, `${qui} / ${t}`);
        }
      }
      // Les gestes visibles sortent vers la PME et son cabinet, la note jamais.
      assert.equal(vu.PA.gestesA, tour.gestesA - 1);
      assert.equal(vu.CA.gestesA, tour.gestesA - 1);
    });
  });

  it("personne n'écrit directement une table du commerce, pas même la tour", async () => {
    await dansLArgent(async (db, m) => {
      const ecritures: Array<[string, unknown[]]> = [
        [
          `insert into facturation.factures (numero, periode, emise_le, echeance_le, organisations, sieges_payants,
             montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise, payeur_type, payeur_personne, destinataire_nom, nature)
           values ('X', $1::date, $1::date, $1::date, 1, 0, 0, 0, 0, 0, 0, 'TND', 'titulaire', $2, 'x', 'facture')`,
          [m.periode, ids.PA],
        ],
        ["update facturation.factures set montant_ttc = 0 where id = $1", [m.factureA]],
        ["delete from facturation.factures where id = $1", [m.factureA]],
        ["delete from facturation.facture_lignes where facture_id = $1", [m.factureA]],
        [
          "update facturation.compteurs_documents set dernier_rang = 0 where emetteur_organisation_id = $1",
          [m.emetteur],
        ],
        [
          "insert into plateforme.interventions (licence_id, acte, motif, valeur) values ($1, 'lectures_offertes', 'x', 9999)",
          [m.licenceA],
        ],
        [
          "insert into facturation.lectures_dues (licence_id, periode, nature, lectures) values ($1, $2::date, 'report_forfait', 9999)",
          [m.licenceA, m.periode],
        ],
        [
          "insert into facturation.encaissements (facture_id, montant, moyen, encaisse_le) values ($1, 1, 'virement', $2::date)",
          [m.factureA, m.periode],
        ],
        ["update plateforme.reglages_commerciaux set remise_pct_max = 100", []],
        ["update facturation.licences set statut = 'active' where id = $1", [m.licenceA]],
      ];
      for (const qui of ACTEURS) {
        await comme(db, qui);
        for (const [sql, params] of ecritures)
          await refuse(db, sql, params, /permission denied|42501|refus\./);
        await enSuperutilisateur(db);
      }
    });
  });

  it("les portes de la tour refusent tout autre que la tour, le relecteur de nuit compris", async () => {
    await dansLArgent(async (db, m) => {
      const portes: Array<[string, unknown[]]> = [
        [
          "select plateforme.remise_accorder($1, 'pourcentage', 5, 'titulaire', $2::date, 1::smallint, 'x')",
          [m.licenceA, m.periode],
        ],
        [
          "select plateforme.mois_offrir($1, 'titulaire', $2::date, 1::smallint, 'x')",
          [m.licenceA, m.periode],
        ],
        ["select plateforme.lectures_offrir($1, 10, 'x')", [m.licenceA]],
        ["select plateforme.essai_prolonger($1, 5::smallint, 'x')", [m.licence0]],
        ["select plateforme.geste_annuler($1, 'x')", [m.gesteVisible]],
        ["select plateforme.avoir_emettre($1, null, 'x')", [m.factureA]],
        [
          "select plateforme.encaissement_inscrire($1, 1, 'virement', null, $2::date)",
          [m.factureA, m.periode],
        ],
        ["select plateforme.facture_decider($1, 'irrecouvrable', 'x')", [m.factureA]],
        [
          "select plateforme.commerce_regler(100, 12, 36::smallint, 12::smallint, 100000, 90::smallint, 12::smallint, 'x')",
          [],
        ],
        ["select plateforme.facturation_regler(false, 0::smallint, 1::smallint, 'x')", []],
        ["select plateforme.report_regler('aucun', 'x')", []],
        ["select plateforme.passe_ouvrir($1::date, 'reel')", [m.periode]],
        ["select plateforme.document_inscrire($1, repeat('a', 64), 'x', 'fr')", [m.factureA]],
        ["select facturation.emettre($1, $2::date)", [m.licenceA, m.periode]],
      ];
      for (const qui of ACTEURS.filter((x) => x !== "T")) {
        await comme(db, qui);
        for (const [sql, params] of portes) {
          await refuse(db, sql, params, /refus\.reserve\.plateforme|permission denied/);
        }
        // Le stock d'une licence qu'on ne consulte pas ne se lit pas, même par
        // une fonction (revue Codex de #202) — ni par son rapport reporté.
        if (qui === "CB" || qui === "P0" || qui === "S") {
          for (const f of ["lectures_dues_solde", "lectures_reportees"]) {
            await refuse(
              db,
              `select facturation.${f}($1, $2::date)`,
              [m.licenceA, m.periode],
              /refus\.geste\.non_permis/,
            );
          }
        }
        // Les fonctions internes ne s'appellent même pas.
        await refuse(
          db,
          "select * from facturation.numero_suivant($1, 2026::smallint, 'facture')",
          [m.emetteur],
          /permission denied/,
        );
        await enSuperutilisateur(db);
      }
    });
  });

  it("un mandat ne vaut lecture que dans ses dates", async () => {
    await dansLArgent(async (db, m) => {
      // Le cabinet B, mandaté par la PME sans cabinet : un mandat « actif » mais
      // échu hier, puis un mandat en cours (revue Codex de #202).
      const voit = async () => {
        await comme(db, "CB");
        const n = await compter(db, "select count(*) n from facturation.licences where id = $1", [
          m.licence0,
        ]);
        await enSuperutilisateur(db);
        return n;
      };
      const engagement = (
        await db.query<{ id: string }>(
          `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, ends_on)
           values ($1, $2, 'actif', current_date - 30, current_date - 1) returning id`,
          [pme0, b.cabinet],
        )
      ).rows[0]!.id;
      assert.equal(await voit(), 0, "un mandat échu n'ouvre rien");
      await db.query("update identity.engagements set ends_on = null where id = $1", [engagement]);
      assert.equal(await voit(), 1, "un mandat en cours ouvre la licence au cabinet");
      await db.query("update identity.engagements set starts_on = current_date + 1 where id = $1", [
        engagement,
      ]);
      assert.equal(await voit(), 0, "un mandat qui n'a pas commencé n'ouvre rien");
    });
  });

  it("le chef de la comptabilité ne se désigne que par le propriétaire principal", async () => {
    await assert.rejects(
      sousIdentite(a.gens.bilel.id, (db) =>
        db.query("select public.droit_personnel_regler($1, $2, 'commerce.lire', true, 'moi')", [
          a.pme,
          a.gens.bilel.id,
        ]),
      ),
      /refus\.reserve\.titulaire/,
    );
    // Et un droit de rôle ne s'accorde pas à une personne.
    await assert.rejects(
      sousIdentite(a.gens.amel.id, (db) =>
        db.query("select public.droit_personnel_regler($1, $2, 'piece.garder', true, 'x')", [
          a.pme,
          a.gens.sami.id,
        ]),
      ),
      /refus\.droit\.non_personnel/,
    );
    const droits = await sousIdentite(a.gens.sonia.id, async (db) => {
      const { rows } = await db.query<{ d: string[] }>("select app.droits_dans($1) as d", [a.pme]);
      return rows[0]!.d;
    });
    assert.ok(
      droits.includes("commerce.lire"),
      "le droit personnel se lit avec les droits du rôle",
    );
    // Une porte du chemin du client appartient au portier (R6) : elle écrit sous la RLS.
    const proprietaire = await admin.query<{ p: string }>(
      `select pg_get_userbyid(proowner) as p from pg_proc
        where oid = 'public.droit_personnel_regler(uuid, uuid, text, boolean, text)'::regprocedure`,
    );
    assert.equal(proprietaire.rows[0]!.p, "portier");
  });

  /* --------------------------------------------------------------- les comportements */

  it("une facture porte son numéro, l'identité figée, ses lignes rendues ; elle ne se réécrit plus", async () => {
    await dansLArgent(async (db, m) => {
      const { rows } = await db.query<{
        numero: string;
        rang: number;
        emetteur_nom: string;
        emetteur_matricule: string;
        langue: string;
        montant_ht: string;
      }>(
        "select numero, rang, emetteur_nom, emetteur_matricule, langue, montant_ht from facturation.factures where id = any($1) order by rang",
        [[m.factureA, m.facture0, m.factureCabinetA, m.factureCabinetB]],
      );
      assert.deepEqual(
        rows.map((r) => r.rang),
        [1, 2, 3, 4],
        "quatre émissions, quatre rangs consécutifs",
      );
      assert.match(rows[0]!.numero, /^ALG-FA-\d{4}-0001$/);
      assert.equal(rows[0]!.emetteur_nom, "ALGORIA Factory (épreuve)");
      assert.equal(rows[0]!.emetteur_matricule, "0000000X/A/M/000");
      // La remise de la tour est une ligne du cabinet A, reliée à son geste.
      const remise = await db.query<{ n: number }>(
        "select count(*)::int as n from facturation.facture_lignes where facture_id = $1 and nature = 'remise' and intervention_id = $2 and montant_ht < 0",
        [m.factureCabinetA, m.gesteVisible],
      );
      assert.equal(remise.rows[0]!.n, 1);
      // P0 est en essai : la facture ne porte que sa recharge.
      const lignes0 = await db.query<{ nature: string }>(
        "select nature from facturation.facture_lignes where facture_id = $1",
        [m.facture0],
      );
      assert.deepEqual(
        lignes0.rows.map((l) => l.nature),
        ["recharge"],
      );
      // Même le propriétaire des portes ne réécrit pas une facture.
      await refuse(
        db,
        "update facturation.factures set montant_ttc = 0 where id = $1",
        [m.factureA],
        /R7/,
      );
      await refuse(
        db,
        "delete from facturation.facture_lignes where facture_id = $1",
        [m.factureA],
        /R7/,
      );
      await refuse(
        db,
        "update facturation.compteurs_documents set dernier_rang = 1 where emetteur_organisation_id = $1",
        [m.emetteur],
        /compteur_fige/,
      );
      await refuse(
        db,
        "delete from facturation.compteurs_documents where emetteur_organisation_id = $1",
        [m.emetteur],
        /R7/,
      );
    });
  });

  it("deux numérotations concurrentes se suivent ; un rollback ne laisse aucun trou", async () => {
    const org = (
      await admin.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency, archived_at, archived_reason)
         values ('pme', 'Compteur d''épreuve', 'TN', 'TND', now(), 'fixture de test automatisé') returning id`,
      )
    ).rows[0]!.id;
    const prendre = (db: pg.PoolClient) =>
      db
        .query<{ rang: number }>(
          "select rang from facturation.numero_suivant($1, 2026::smallint, 'facture')",
          [org],
        )
        .then((r) => r.rows[0]!.rang);
    const un = await admin.connect();
    const deux = await admin.connect();
    try {
      await un.query("begin");
      await deux.query("begin");
      assert.equal(await prendre(un), 1);
      // La seconde attend le verrou de ligne de la première…
      let fini = false;
      const attente = prendre(deux).then((r) => {
        fini = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(fini, false, "la seconde émission attend le verrou");
      await un.query("commit");
      // … puis relit la dernière version de la ligne : jamais de doublon.
      assert.equal(await attente, 2);
      await deux.query("rollback");
      // Le rang 2 est rendu par le rollback : la suivante le reprend.
      await un.query("begin");
      assert.equal(await prendre(un), 2);
      await un.query("commit");
      // La largeur est un minimum : le 10 000e numéro garde ses cinq chiffres.
      await un.query("begin");
      await un.query(
        `insert into facturation.compteurs_documents (emetteur_organisation_id, annee, nature, prefixe, dernier_rang)
         values ($1, 2026, 'avoir', 'CPT-AV', 9999)`,
        [org],
      );
      const { rows } = await un.query<{ numero: string }>(
        "select numero from facturation.numero_suivant($1, 2026::smallint, 'avoir')",
        [org],
      );
      assert.equal(rows[0]!.numero, "CPT-AV-2026-10000");
      await un.query("rollback");
    } finally {
      un.release();
      deux.release();
    }
  });

  it("l'aperçu ne touche ni compteur ni facture ; la passe réelle se reprend sans rien émettre de plus", async () => {
    await dansLArgent(async (db, m) => {
      // Une recharge sur la licence de B : sa part de titulaire est à émettre ce mois-ci.
      await db.query(
        `insert into facturation.recharges (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
         select $1, r.code, r.lectures, r.prix_ht, $2::date, ($2::date + interval '1 year')::date, 'achat', $3
           from ref.recharges r where r.effective_from <= $2::date
          order by r.effective_from desc, r.lectures limit 1`,
        [m.licenceB, m.periode, b.gens.amel.id],
      );
      await comme(db, "T");
      const rang = () =>
        compter(
          db,
          "select coalesce(max(dernier_rang), 0) n from facturation.compteurs_documents where emetteur_organisation_id = $1",
          [m.emetteur],
        );
      const factures = () =>
        compter(
          db,
          "select count(*) n from facturation.factures where emetteur_organisation_id = $1",
          [m.emetteur],
        );
      const traiter = async (passe: string, type: string, cible: string) =>
        (
          await db.query<{
            r: {
              resultats: Array<{ resultat: string; facture_id: string | null; ttc: number | null }>;
            };
          }>("select plateforme.passe_traiter($1, $2, $3) as r", [passe, type, cible])
        ).rows[0]!.r.resultats;
      const avant = { rang: await rang(), factures: await factures() };

      const apercu = (
        await db.query<{ p: { passe_id: string } }>(
          "select plateforme.passe_ouvrir($1::date, 'apercu') as p",
          [m.periode],
        )
      ).rows[0]!.p;
      const prevu = await traiter(apercu.passe_id, "licence", m.licenceB);
      assert.deepEqual(
        prevu.map((x) => x.resultat),
        ["prevue"],
      );
      assert.ok(Number(prevu[0]!.ttc) > 0, "l'aperçu dit le montant");
      assert.deepEqual(
        await traiter(apercu.passe_id, "licence", m.licence0).then((r) => r.map((x) => x.resultat)),
        ["deja_emise"],
      );
      assert.deepEqual(
        { rang: await rang(), factures: await factures() },
        avant,
        "l'aperçu n'écrit rien, ne numérote rien",
      );

      const reelle = (
        await db.query<{ p: { passe_id: string } }>(
          "select plateforme.passe_ouvrir($1::date, 'reel') as p",
          [m.periode],
        )
      ).rows[0]!.p;
      const reprise = (
        await db.query<{ p: { passe_id: string } }>(
          "select plateforme.passe_ouvrir($1::date, 'reel') as p",
          [m.periode],
        )
      ).rows[0]!.p;
      assert.equal(
        reprise.passe_id,
        reelle.passe_id,
        "une seule passe réelle par mois : on la reprend",
      );
      const emise = await traiter(reelle.passe_id, "licence", m.licenceB);
      assert.deepEqual(
        emise.map((x) => x.resultat),
        ["emise"],
      );
      assert.equal(
        Number(emise[0]!.ttc),
        Number(prevu[0]!.ttc),
        "l'émission est ce que l'aperçu prévoyait",
      );
      assert.deepEqual(
        { rang: await rang(), factures: await factures() },
        { rang: avant.rang + 1, factures: avant.factures + 1 },
      );
      for (let i = 0; i < 2; i++) {
        const r = await traiter(reelle.passe_id, "licence", m.licenceB);
        assert.deepEqual(
          r.map((x) => [x.resultat, x.facture_id]),
          [["deja_emise", emise[0]!.facture_id]],
        );
      }
      assert.deepEqual(
        { rang: await rang(), factures: await factures() },
        { rang: avant.rang + 1, factures: avant.factures + 1 },
        "la passe rejouée n'émet rien de plus",
      );
      // Le mois en cours ne se clôt pas : ses lectures ne sont pas finies.
      assert.equal(
        await compter(
          db,
          "select count(*) n from facturation.lectures_dues where licence_id = $1 and nature <> 'offerte'",
          [m.licenceB],
        ),
        0,
      );
      await refuse(
        db,
        "select plateforme.passe_ouvrir(($1::date + interval '1 month')::date, 'apercu')",
        [m.periode],
        /refus\.passe\.mois_a_venir/,
      );
    });
  });

  it("l'avoir a sa série, ne dépasse pas sa facture, et l'annule entièrement", async () => {
    await dansLArgent(async (db, m) => {
      await comme(db, "T");
      const avoir = (
        await db.query<{ r: { numero: string } }>(
          "select plateforme.avoir_emettre($1, null, 'Erreur de recharge') as r",
          [m.facture0],
        )
      ).rows[0]!.r;
      assert.match(avoir.numero, /^ALG-AV-\d{4}-0001$/, "l'avoir a sa propre série");
      await refuse(
        db,
        "select plateforme.avoir_emettre($1, 1, 'encore')",
        [m.facture0],
        /refus\.facture\.avoir_au_dela/,
      );
      const etat = (
        await db.query<{ etat: string; reste_du: string }>(
          "select etat, reste_du from facturation.encours_v where facture_id = $1",
          [m.facture0],
        )
      ).rows[0]!;
      assert.deepEqual(
        [etat.etat, Number(etat.reste_du)],
        ["annulee", 0],
        "un avoir total annule la facture, timbre compris",
      );
      const lignes = await compter(
        db,
        "select count(*) n from facturation.facture_lignes l join facturation.factures f on f.id = l.facture_id where f.numero = $1",
        [avoir.numero],
      );
      assert.equal(lignes, 1, "l'avoir total reprend les lignes de la facture");
    });
  });

  it("les gestes sont plafonnés, motivés, et ne s'annulent plus une fois facturés", async () => {
    await dansLArgent(async (db, m) => {
      await comme(db, "T");
      const plafond = /refus\.geste\.au_dela_du_plafond/;
      await refuse(
        db,
        "select plateforme.remise_accorder($1, 'pourcentage', 21, 'titulaire', $2::date, 1::smallint, 'trop')",
        [m.licenceA, m.periode],
        plafond,
      );
      await refuse(
        db,
        "select plateforme.remise_accorder($1, 'pourcentage', 10, 'titulaire', $2::date, 13::smallint, 'trop long')",
        [m.licenceA, m.periode],
        plafond,
      );
      await refuse(
        db,
        "select plateforme.mois_offrir($1, 'titulaire', $2::date, 3::smallint, 'trop')",
        [m.licenceA, m.periode],
        plafond,
      );
      await refuse(db, "select plateforme.lectures_offrir($1, 301, 'trop')", [m.licenceA], plafond);
      await refuse(
        db,
        "select plateforme.essai_prolonger($1, 16::smallint, 'trop')",
        [m.licence0],
        plafond,
      );
      await refuse(
        db,
        "select plateforme.lectures_offrir($1, 10, '  ')",
        [m.licenceA],
        /refus\.commerce\.motif_requis/,
      );
      await refuse(
        db,
        "select plateforme.remise_accorder($1, 'pourcentage', 5, 'cabinet', $2::date, 1::smallint, 'doublon')",
        [m.licenceA, m.periode],
        /refus\.geste\.chevauchement/,
      );
      await refuse(
        db,
        "select plateforme.geste_annuler($1, 'trop tard')",
        [m.gesteVisible],
        /refus\.geste\.deja_facture/,
      );
      // Une remise rejouée par sa clé rend le geste déjà inscrit : elle ne bute
      // pas sur le chevauchement avec elle-même (revue Codex de #202).
      const r1 = (
        await db.query<{ r: { id: string } }>(
          `select plateforme.remise_accorder($1, 'montant', 1, 'titulaire', $2::date, 1::smallint,
                                             'Geste rejoué', 'cle-remise-1') as r`,
          [m.licenceA, m.periode],
        )
      ).rows[0]!.r;
      const r2 = (
        await db.query<{ r: { id: string; deja: boolean } }>(
          `select plateforme.remise_accorder($1, 'montant', 1, 'titulaire', $2::date, 1::smallint,
                                             'Geste rejoué', 'cle-remise-1') as r`,
          [m.licenceA, m.periode],
        )
      ).rows[0]!.r;
      assert.deepEqual([r2.id, r2.deja], [r1.id, true]);
      // La même clé sur un AUTRE geste reste refusée : le rejeu compare l'acte.
      await refuse(
        db,
        "select plateforme.mois_offrir($1, 'titulaire', $2::date, 1::smallint, 'Autre geste', 'cle-remise-1')",
        [m.licenceA, m.periode],
        /refus\.commerce\.cle_deja_prise/,
      );
      // La clé d'idempotence rend le même geste, sans en inscrire un second.
      const g1 = (
        await db.query<{ r: { id: string } }>(
          "select plateforme.essai_prolonger($1, 15::smallint, 'Retard de mise en route', 'cle-essai-1') as r",
          [m.licence0],
        )
      ).rows[0]!.r;
      const g2 = (
        await db.query<{ r: { id: string; deja: boolean } }>(
          "select plateforme.essai_prolonger($1, 15::smallint, 'Retard de mise en route', 'cle-essai-1') as r",
          [m.licence0],
        )
      ).rows[0]!.r;
      assert.equal(g2.id, g1.id);
      assert.equal(g2.deja, true);
      const essai = (
        await db.query<{ jours: number }>(
          "select jours_prolonges as jours from facturation.essais_v where licence_id = $1",
          [m.licence0],
        )
      ).rows[0]!;
      assert.equal(essai.jours, 15);
      // Annulée, la prolongation ne compte plus.
      await db.query("select plateforme.geste_annuler($1, 'Saisie en double')", [g1.id]);
      const apres = (
        await db.query<{ jours: number }>(
          "select jours_prolonges as jours from facturation.essais_v where licence_id = $1",
          [m.licence0],
        )
      ).rows[0]!;
      assert.equal(apres.jours, 0);
      await refuse(
        db,
        "select plateforme.geste_annuler($1, 'encore')",
        [g1.id],
        /refus\.geste\.deja_annule/,
      );
      // Les lectures offertes entrent dans le stock, une fois.
      const stock = (
        await db.query<{ solde: number; offertes: number }>(
          "select solde, offertes from facturation.lectures_dues_v where licence_id = $1",
          [m.licenceA],
        )
      ).rows[0]!;
      assert.equal(stock.offertes, 50);
      assert.ok(stock.solde >= 50);
    });
  });

  it("un encaissement ne dépasse pas le reste dû, et ne s'annule qu'une fois", async () => {
    await dansLArgent(async (db, m) => {
      await comme(db, "T");
      const reste = Number(
        (
          await db.query<{ r: string }>(
            "select reste_du::text as r from facturation.encours_v where facture_id = $1",
            [m.factureA],
          )
        ).rows[0]!.r,
      );
      await refuse(
        db,
        "select plateforme.encaissement_inscrire($1, $2::numeric + 1, 'virement', 'VIR-1', $3::date)",
        [m.factureA, reste, m.periode],
        /refus\.encaissement\.au_dela_du_reste/,
      );
      const e = (
        await db.query<{ r: { id: string } }>(
          "select plateforme.encaissement_inscrire($1, $2::numeric, 'virement', 'VIR-1', $3::date) as r",
          [m.factureA, reste, m.periode],
        )
      ).rows[0]!.r;
      assert.equal(
        (
          await db.query<{ etat: string }>(
            "select etat from facturation.encours_v where facture_id = $1",
            [m.factureA],
          )
        ).rows[0]!.etat,
        "payee",
      );
      await db.query(
        "select plateforme.encaissement_annuler($1, 'Virement rejeté par la banque')",
        [e.id],
      );
      await refuse(
        db,
        "select plateforme.encaissement_annuler($1, 'encore')",
        [e.id],
        /refus\.encaissement\.deja_annule/,
      );
      assert.notEqual(
        (
          await db.query<{ etat: string }>(
            "select etat from facturation.encours_v where facture_id = $1",
            [m.factureA],
          )
        ).rows[0]!.etat,
        "payee",
      );
    });
  });

  it("l'essai s'ouvre une fois par titulaire, et s'arrête quand un cabinet dote", async () => {
    const essais = await admin.query<{ licence: string; fin: string; dote: string | null }>(
      `select e.licence_id as licence, e.fin_effective::text as fin, e.dote_le::text as dote
         from facturation.essais_v e
         join facturation.licence_organisations lo on lo.licence_id = e.licence_id
        where lo.tenant_id = any($1)`,
      [[a.pme, pme0]],
    );
    assert.equal(essais.rows.length, 2, "un essai pour A, un pour P0 (canal direct)");
    const dotee = essais.rows.find((e) => e.dote !== null);
    assert.ok(
      dotee && dotee.fin === dotee.dote,
      "l'essai de A s'arrête le jour où le cabinet dote",
    );
    // P0 ouvre une seconde société : la licence naît, sans second essai.
    const autre = await sousIdentiteDuServeur(p0.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`SECONDE SOCIETE ${Date.now()}`, matriculeDEssai()],
      );
      return rows[0]!.id;
    });
    try {
      const n = await admin.query<{ n: number }>(
        `select count(*)::int as n from facturation.essais e
           join facturation.licence_organisations lo on lo.licence_id = e.licence_id
          where lo.tenant_id = $1`,
        [autre],
      );
      assert.equal(n.rows[0]!.n, 0, "un seul essai par titulaire");
    } finally {
      await admin.query(
        `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1`,
        [autre],
      );
    }
  });

  /* ------------------------------------------- la revue indépendante de #202 */

  /** Pose l'identité d'une personne quelconque, comme `comme` le fait pour un acteur. */
  async function sous(db: pg.PoolClient, personne: string) {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [personne]);
    await db.query("select set_config('request.jwt.claim.service', '', true)");
    await db.query("select set_config('request.jwt.claim.service_tenant', '', true)");
    await db.query("select set_config('malica.origine', '', true)");
  }

  /** Une organisation posée dans la transaction, et la personne qui y tient un rôle. */
  async function organisation(
    db: pg.PoolClient,
    kind: "pme" | "cabinet",
    personne: string,
    role: string,
  ) {
    const org = (
      await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, legal_id, adresse, jurisdiction, currency)
         values ($1, $2, $3, 'Tunis', 'TN', 'TND') returning id`,
        [kind, `EPREUVE ${randomUUID().slice(0, 8)}`, matriculeDEssai()],
      )
    ).rows[0]!.id;
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, $3)",
      [org, personne, role],
    );
    return org;
  }

  /** Une licence de toutes pièces, datée : sa société, son titulaire, son premier forfait. */
  async function licenceDatee(db: pg.PoolClient, offre: string, du: string) {
    const titulaire = randomUUID();
    await personnesDEssai(db, titulaire);
    const org = await organisation(db, "pme", titulaire, "dirigeant");
    const licence = (
      await db.query<{ id: string }>(
        `insert into facturation.licences (titulaire, offre_code, offre_depuis)
         values ($1, $2, $3::date) returning id`,
        [titulaire, offre, du],
      )
    ).rows[0]!.id;
    await db.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [licence, org],
    );
    return { licence, org, titulaire };
  }

  /** Une facture du titulaire, posée hors des portes (déclencheurs levés) : son seul rôle est d'exister. */
  async function factureFactice(db: pg.PoolClient, licence: string, periode: string) {
    await db.query("set local session_replication_role = replica");
    await db.query(
      `insert into facturation.factures
         (licence_id, offre_code, numero, periode, emise_le, echeance_le, organisations,
          sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
          payeur_type, payeur_personne, destinataire_nom, nature)
       select $1, 'solo', $2, $3::date, $3::date, $3::date, 1, 0, 1, 0, 0, 0, 1, 'TND',
              'titulaire', l.titulaire, 'Factice', 'facture'
         from facturation.licences l where l.id = $1`,
      [licence, `FACTICE-${randomUUID()}`, periode],
    );
    await db.query("set local session_replication_role = origin");
  }

  it("les plafonds se cumulent par licence sur la fenêtre glissante, gestes annulés exclus", async () => {
    await dansLArgent(async (db, m) => {
      const cumul = /refus\.geste\.cumul_depasse/;
      const mois = (n: number) => `($2::date + interval '${n} month')::date`;
      await comme(db, "T");
      // L'essai : 10 jours, puis 6 de plus dépasseraient les 15 du plafond ; 5 non.
      await db.query(
        "select plateforme.essai_prolonger($1, 10::smallint, 'Retard de mise en route')",
        [m.licence0],
      );
      await refuse(
        db,
        "select plateforme.essai_prolonger($1, 6::smallint, 'Encore')",
        [m.licence0],
        cumul,
      );
      await db.query("select plateforme.essai_prolonger($1, 5::smallint, 'Le reste')", [
        m.licence0,
      ]);
      // Les lectures : 50 déjà offertes par le monde ; 250 de plus font les 300 du plafond.
      await db.query("select plateforme.lectures_offrir($1, 250, 'Incident de lecture')", [
        m.licenceA,
      ]);
      await refuse(db, "select plateforme.lectures_offrir($1, 1, 'Encore')", [m.licenceA], cumul);
      // Les mois offerts : 2, puis 1 sur une autre période, au-delà des 2 du plafond.
      const offerts = (
        await db.query<{ r: { id: string } }>(
          `select plateforme.mois_offrir($1, 'titulaire', ${mois(1)}, 2::smallint, 'Fidélité') as r`,
          [m.licenceA, m.periode],
        )
      ).rows[0]!.r;
      await refuse(
        db,
        `select plateforme.mois_offrir($1, 'titulaire', ${mois(4)}, 1::smallint, 'Encore')`,
        [m.licenceA, m.periode],
        cumul,
      );
      // Annulé, un geste ne compte plus dans le cumul.
      await db.query("select plateforme.geste_annuler($1, 'Saisi sur la mauvaise licence')", [
        offerts.id,
      ]);
      await db.query(
        `select plateforme.mois_offrir($1, 'titulaire', ${mois(4)}, 1::smallint, 'Le bon geste')`,
        [m.licenceA, m.periode],
      );
      // Les remises : 1 mois (le monde, payé par le cabinet) + 11 font les 12 du plafond ;
      // une seconde remise de 12 mois, dos à dos, ne passe plus.
      await db.query(
        `select plateforme.remise_accorder($1, 'pourcentage', 20, 'titulaire', ${mois(1)}, 11::smallint, 'Lancement')`,
        [m.licenceA, m.periode],
      );
      await refuse(
        db,
        `select plateforme.remise_accorder($1, 'pourcentage', 20, 'titulaire', ${mois(12)}, 12::smallint, 'Dos à dos')`,
        [m.licenceA, m.periode],
        cumul,
      );
      // La fenêtre est glissante : un geste d'il y a 13 mois ne compte plus, un d'il y a 11 mois si.
      await enSuperutilisateur(db);
      await db.query(
        `insert into plateforme.interventions (licence_id, acte, motif, valeur, operateur, created_at)
         values ($1, 'lectures_offertes', 'Ancien', 300, $2, now() - interval '13 months')`,
        [m.licenceB, ids.T],
      );
      await comme(db, "T");
      await db.query("select plateforme.lectures_offrir($1, 300, 'Hors fenêtre')", [m.licenceB]);
      await refuse(db, "select plateforme.lectures_offrir($1, 1, 'Encore')", [m.licenceB], cumul);
      // La fenêtre est un réglage de la tour (R10) : sur un mois, le geste d'aujourd'hui seul compte.
      const r = (
        await db.query<{ r: { fenetre_cumul_mois: number } }>(
          `select plateforme.commerce_regler(20, 1, 12::smallint, 2::smallint, 300, 15::smallint,
                                             1::smallint, 'Fenêtre courte') as r`,
        )
      ).rows[0]!.r;
      assert.equal(r.fenetre_cumul_mois, 1);
      await refuse(db, "select plateforme.lectures_offrir($1, 1, 'Encore')", [m.licenceB], cumul);
    });
  });

  it("le stock ne crédite que les jours payés : naissance en cours de mois, fin d'essai, montée, descente", async () => {
    await dansLArgent(async (db) => {
      const ecart = async (licence: string, periode: string) =>
        Number(
          (
            await db.query<{ e: number }>("select facturation.ecart_du_mois($1, $2::date) as e", [
              licence,
              periode,
            ])
          ).rows[0]!.e,
        );
      // Le droit mensuel d'une offre, lu dans la grille : une société, aucune place en plus.
      const droit = async (offre: string, le: string) =>
        Number(
          (
            await db.query<{ d: number }>(
              "select facturation.lectures_du_forfait(ref.offre_a($1, $2::date), 1, 0) as d",
              [offre, le],
            )
          ).rows[0]!.d,
        );
      const solo = await droit("solo", "2026-11-01");
      const team = await droit("team", "2026-11-01");
      assert.ok(solo > 0 && team > solo);

      // Née le 20 novembre : 11 jours payés sur 30, pas le mois entier.
      const nee = await licenceDatee(db, "solo", "2026-11-20");
      assert.equal(await ecart(nee.licence, "2026-11-01"), Math.floor((solo * 11) / 30));
      assert.equal(await ecart(nee.licence, "2026-12-01"), solo, "un mois plein payé");

      // Essai du 20 octobre au 20 novembre (exclu) : octobre ne crédite rien, novembre 11 jours.
      const essai = await licenceDatee(db, "solo", "2026-10-20");
      await db.query(
        `insert into facturation.essais (licence_id, tenant_id, titulaire, canal, du, au, grille_le)
         values ($1, $2, $3, 'direct', date '2026-10-20', date '2026-11-20', date '2026-11-02')`,
        [essai.licence, essai.org, essai.titulaire],
      );
      assert.equal(await ecart(essai.licence, "2026-10-01"), 0);
      assert.equal(await ecart(essai.licence, "2026-11-01"), Math.floor((solo * 11) / 30));

      // Un changement d'offre le 15 : l'ancienne compte 14 jours, la nouvelle 16.
      const changer = async (licence: string, de: string, vers: string, titulaire: string) => {
        await db.query(
          `update facturation.forfait_historique set effet_au = date '2026-11-15'
            where licence_id = $1 and effet_au is null`,
          [licence],
        );
        await db.query(
          `insert into facturation.forfait_historique
             (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
           values ($1, $2, date '2026-11-15', 'direct', date '2026-11-15', $3, $4)`,
          [licence, vers, de === "solo" ? "montee" : "descente", titulaire],
        );
      };
      const montee = await licenceDatee(db, "solo", "2026-10-19");
      await changer(montee.licence, "solo", "team", montee.titulaire);
      assert.equal(
        await ecart(montee.licence, "2026-11-01"),
        Math.floor((solo * 14 + team * 16) / 30),
        "la montée ne crédite pas le mois entier au nouveau forfait",
      );
      const descente = await licenceDatee(db, "team", "2026-10-19");
      await changer(descente.licence, "team", "solo", descente.titulaire);
      assert.equal(
        await ecart(descente.licence, "2026-11-01"),
        Math.min(solo, Math.floor((team * 14 + solo * 16) / 30)),
        "la descente crédite au plus le quota du mois",
      );
    });
  });

  it("un collaborateur du cabinet, un accès suspendu ou fini n'ouvrent ni la licence ni ses factures", async () => {
    await dansLArgent(async (db, m) => {
      const X = randomUUID();
      const E = randomUUID();
      await personnesDEssai(db, X, E);
      // X : collaborateur du cabinet A. E : expert d'un cabinet C dont l'accès à P0 est suspendu.
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
        [a.cabinet, X],
      );
      const cabinetC = await organisation(db, "cabinet", E, "expert");
      // L'accès est posé tel que l'histoire l'aurait laissé (déclencheurs levés) : c'est
      // sa lecture qu'on éprouve, pas sa naissance.
      await db.query("set local session_replication_role = replica");
      const acces = (
        await db.query<{ id: string }>(
          `insert into facturation.acces
             (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
              propose_le, propose_par, repondu_le, repondu_par, effet_du)
           values ($1, $2, 'cabinet', $3, 'team', $4::date, 'suspendu', $4::date, $5, $4::date, $6,
                   $4::date)
           returning id`,
          [pme0, m.licence0, cabinetC, m.periode, E, p0.id],
        )
      ).rows[0]!.id;
      await db.query("set local session_replication_role = origin");
      const lit = async (qui: string) => {
        await sous(db, qui);
        const r = {
          licenceA: await compter(db, "select count(*) n from facturation.licences where id = $1", [
            m.licenceA,
          ]),
          licence0: await compter(db, "select count(*) n from facturation.licences where id = $1", [
            m.licence0,
          ]),
          factureCabinetA: await compter(
            db,
            "select count(*) n from facturation.factures where id = $1",
            [m.factureCabinetA],
          ),
        };
        await enSuperutilisateur(db);
        return r;
      };
      const nonPermis = /refus\.geste\.non_permis/;
      assert.deepEqual(await lit(X), { licenceA: 0, licence0: 0, factureCabinetA: 0 });
      await sous(db, X);
      await refuse(
        db,
        "select * from facturation.a_facturer($1, $2::date)",
        [m.licenceA, m.periode],
        nonPermis,
      );
      await refuse(
        db,
        "select * from facturation.a_facturer_cabinet($1, $2::date)",
        [a.cabinet, m.periode],
        nonPermis,
      );
      const document = (
        await db.query<{ d: unknown }>("select facturation.document_de_facture($1, 'fr') as d", [
          m.factureCabinetA,
        ])
      ).rows[0]!.d;
      assert.equal(document, null, "ni le PDF de la facture du cabinet");
      await enSuperutilisateur(db);
      // L'expert du cabinet A, lui, lit la facture de son cabinet et ce qu'elle facture.
      assert.equal((await lit(ids.CA!)).factureCabinetA, 1);
      // Suspendu, l'accès n'ouvre rien ; actif, il ouvre ; terminé, plus rien.
      assert.equal((await lit(E)).licence0, 0);
      await sous(db, E);
      await refuse(
        db,
        "select * from facturation.a_facturer($1, $2::date)",
        [m.licence0, m.periode],
        nonPermis,
      );
      await enSuperutilisateur(db);
      await db.query("set local session_replication_role = replica");
      await db.query("update facturation.acces set statut = 'actif' where id = $1", [acces]);
      await db.query("set local session_replication_role = origin");
      assert.equal((await lit(E)).licence0, 1);
      await db.query("set local session_replication_role = replica");
      await db.query(
        `update facturation.acces set statut = 'termine', effet_au = $2::date,
                motif_fin = 'retrait_cabinet' where id = $1`,
        [acces, m.periode],
      );
      await db.query("set local session_replication_role = origin");
      assert.equal((await lit(E)).licence0, 0);
      await sous(db, E);
      await refuse(
        db,
        "select * from facturation.a_facturer($1, $2::date)",
        [m.licence0, m.periode],
        nonPermis,
      );
      await enSuperutilisateur(db);
    });
  });

  it("le client lit le libellé d'un geste, jamais son motif ; le solde du stock, seulement s'il lit le commerce", async () => {
    await dansLArgent(async (db, m) => {
      await comme(db, "PA");
      await refuse(
        db,
        "select motif from plateforme.interventions where id = $1",
        [m.gesteVisible],
        /permission denied/,
      );
      const gestes = (await executerRpc(db, {
        depot: "facturation",
        methode: "gestesCommerciaux",
        args: ["fr"],
      })) as Array<Record<string, unknown>>;
      assert.ok(
        gestes.some((g) => g["id"] === m.gesteVisible),
        "le geste visible sort",
      );
      assert.ok(
        gestes.every((g) => !("motif" in g)),
        "son motif, jamais",
      );
      await enSuperutilisateur(db);
      // La tour lit le motif.
      await comme(db, "T");
      const tour = (
        await db.query<{ motif: string }>(
          "select motif from plateforme.exceptions_v where id = $1",
          [m.gesteVisible],
        )
      ).rows[0]!;
      assert.equal(tour.motif, "Remise de bienvenue du cabinet");
      const droitTour = (
        await db.query<{ d: number }>(
          "select lectures_droit d from facturation.consommation_v where licence_id = $1",
          [m.licenceA],
        )
      ).rows[0]!.d;
      await enSuperutilisateur(db);
      // Sami, collaborateur sans le droit : ni le solde, ni le report…
      await comme(db, "PC");
      await refuse(
        db,
        "select facturation.lectures_dues_solde($1, $2::date)",
        [m.licenceA, m.periode],
        /refus\.geste\.non_permis/,
      );
      const report = (await db.query<{ r: unknown }>("select public.mon_report($1) as r", [a.pme]))
        .rows[0]!.r;
      assert.equal(report, null);
      // … mais son quota de lectures compte toujours le stock.
      const quota = (
        await db.query<{ d: number }>("select lectures_droit d from public.mon_forfait($1)", [
          a.pme,
        ])
      ).rows[0]!.d;
      assert.equal(quota, droitTour);
      await enSuperutilisateur(db);
      // Sonia, chef de la comptabilité, lit le solde.
      await comme(db, "CC");
      const solde = Number(
        (
          await db.query<{ s: number }>(
            "select facturation.lectures_dues_solde($1, $2::date) as s",
            [m.licenceA, m.periode],
          )
        ).rows[0]!.s,
      );
      assert.ok(solde >= 50);
      await enSuperutilisateur(db);
    });
  });

  it("un essai fini le jour de sa fin ne se prolonge plus ; une prolongation facturée ne s'annule plus", async () => {
    await dansLArgent(async (db, m) => {
      const jour = (
        await db.query<{ j: string }>("select facturation.jour_de_l_organisation($1)::text as j", [
          m.emetteur,
        ])
      ).rows[0]!.j;
      // Un essai dont la fin (exclue) est aujourd'hui : il est fini.
      const fini = await licenceDatee(db, "solo", "2026-10-01");
      await db.query(
        `insert into facturation.essais (licence_id, tenant_id, titulaire, canal, du, au, grille_le)
         values ($1, $2, $3, 'direct', $4::date - 20, $4::date, date '2026-11-02')`,
        [fini.licence, fini.org, fini.titulaire, jour],
      );
      await comme(db, "T");
      await refuse(
        db,
        "select plateforme.essai_prolonger($1, 1::smallint, 'Trop tard')",
        [fini.licence],
        /refus\.essai\.termine/,
      );
      // L'essai de P0 court : prolongé d'un jour, puis le mois où tombe ce jour est facturé.
      const g = (
        await db.query<{ r: { id: string } }>(
          "select plateforme.essai_prolonger($1, 1::smallint, 'Retard de mise en route') as r",
          [m.licence0],
        )
      ).rows[0]!.r;
      await enSuperutilisateur(db);
      const moisDeLaFin = (
        await db.query<{ p: string }>(
          "select date_trunc('month', au)::date::text as p from facturation.essais where licence_id = $1",
          [m.licence0],
        )
      ).rows[0]!.p;
      await factureFactice(db, m.licence0, moisDeLaFin);
      await comme(db, "T");
      await refuse(
        db,
        "select plateforme.geste_annuler($1, 'Trop tard')",
        [g.id],
        /refus\.geste\.deja_facture/,
      );
    });
  });

  it("le jour est celui de la société, pas celui du serveur, à la frontière du mois (#194)", async () => {
    await dansLArgent(async (db, m) => {
      // La règle : 23 h 30 UTC le dernier jour du mois est déjà le 1er à Tunis.
      const j = (
        await db.query<{ j: string }>(
          "select facturation.jour_a($1, timestamptz '2026-11-30 23:30:00+00')::text as j",
          [m.emetteur],
        )
      ).rows[0]!.j;
      assert.equal(j, "2026-12-01");
      // Le serveur passe au 1er du mois prochain, 00 h 30 à Tunis — encore la veille en UTC :
      // `facturation.jour_de_l_organisation` lit l'instant que l'épreuve pose (transaction annulée).
      await db.query(`
        create or replace function facturation.jour_de_l_organisation(p_org uuid) returns date
        language sql stable security definer set search_path = '' as $$
          select facturation.jour_a(p_org, current_setting('epreuve.maintenant')::timestamptz)
        $$`);
      const poser = (instant: string) =>
        db.query("select set_config('epreuve.maintenant', $1, true)", [instant]);
      const suivant = (
        await db.query<{ p: string }>("select ($1::date + interval '1 month')::date::text as p", [
          m.periode,
        ])
      ).rows[0]!.p;
      await db.query("set local timezone = 'UTC'");
      await poser(`${suivant} 00:30:00 Africa/Tunis`);

      // Le mois qui finit se clôt : la passe du 1er à 00 h 30 le voit fini (la clôture
      // n'est ouverte qu'à la passe ; la tour l'appelle ici sans elle).
      await comme(db, "T");
      await enSuperutilisateur(db);
      await db.query("select facturation.cloturer_lectures($1, $2::date, null)", [
        m.licenceA,
        m.periode,
      ]);
      // Les lectures offertes à cet instant sont du mois qui commence.
      await comme(db, "T");
      await db.query("select plateforme.lectures_offrir($1, 10, 'Nouveau mois')", [m.licence0]);
      await enSuperutilisateur(db);
      const clos = await compter(
        db,
        `select count(*) n from facturation.lectures_dues
          where licence_id = $1 and periode = $2::date and nature <> 'offerte'`,
        [m.licenceA, m.periode],
      );
      assert.equal(clos, 1, "le mois d'avant est clos");
      const offerte = (
        await db.query<{ p: string }>(
          `select periode::text as p from facturation.lectures_dues
            where licence_id = $1 and nature = 'offerte' order by inscrit_le desc limit 1`,
          [m.licence0],
        )
      ).rows[0]!.p;
      assert.equal(offerte, suivant);

      // Une licence qui naît à cet instant naît le 1er.
      const t = randomUUID();
      await personnesDEssai(db, t);
      const pme = await organisation(db, "pme", t, "dirigeant");
      const licence = (
        await db.query<{ id: string }>("select facturation.licence_naitre($1, $2) as id", [pme, t])
      ).rows[0]!.id;
      const nee = (
        await db.query<{ d: string }>(
          "select offre_depuis::text as d from facturation.licences where id = $1",
          [licence],
        )
      ).rows[0]!.d;
      assert.equal(nee, suivant);

      // L'émetteur valable dès le 1er est celui du 1er.
      const nouvel = (
        await db.query<{ id: string }>(
          `insert into identity.organizations (kind, name, legal_id, adresse, jurisdiction, currency)
           values ('pme', 'ALGORIA Factory (nouvel émetteur)', '0000001X/A/M/000', 'Tunis', 'TN', 'TND')
           returning id`,
        )
      ).rows[0]!.id;
      await db.query(
        `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
         values ($1, $2::date, $3)`,
        [nouvel, suivant, ids.T],
      );
      const emetteur = (
        await db.query<{ o: string }>(
          "select organisation_id as o from facturation.emetteur_en_vigueur()",
        )
      ).rows[0]!.o;
      assert.equal(emetteur, nouvel);

      // Le retard se compte au jour de l'émetteur : deux jours après l'échéance, à 00 h 30.
      const echeance = (
        await db.query<{ e: string }>(
          "select echeance_le::text as e from facturation.factures where id = $1",
          [m.factureA],
        )
      ).rows[0]!.e;
      const surlendemain = (
        await db.query<{ d: string }>("select ($1::date + 2)::text as d", [echeance])
      ).rows[0]!.d;
      await poser(`${surlendemain} 00:30:00 Africa/Tunis`);
      await comme(db, "T");
      const encours = (
        await db.query<{ etat: string; jours: number }>(
          "select etat, jours_de_retard as jours from facturation.encours_v where facture_id = $1",
          [m.factureA],
        )
      ).rows[0]!;
      assert.deepEqual([encours.etat, encours.jours], ["en_retard", 2]);
      await enSuperutilisateur(db);
    });
  });

  it("Premium compte une place par société et par personne dès sa grille datée ; un abonné d'avant garde la sienne", async () => {
    await dansLArgent(async (db) => {
      const premium = async (depuis: string) => {
        const l = await licenceDatee(db, "premium", depuis);
        // Une seconde société, et cinq personnes qui travaillent dans les deux.
        const seconde = await organisation(db, "pme", l.titulaire, "dirigeant");
        await db.query(
          "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
          [l.licence, seconde],
        );
        const gens = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await personnesDEssai(db, ...gens);
        for (const p of gens) {
          for (const org of [l.org, seconde]) {
            await db.query(
              "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
              [org, p],
            );
          }
        }
        return (
          await db.query<{ sieges: number; prix: string; lectures: number }>(
            `select sieges_occupes as sieges, prix_mensuel_ht::text as prix, lectures_droit as lectures
               from facturation.droits_v where licence_id = $1`,
            [l.licence],
          )
        ).rows[0]!;
      };
      const grille = (
        await db.query<{ portee: string; prix_siege: string; lectures_siege: number }>(
          `select portee_sieges as portee, prix_siege_sup::text as prix_siege,
                  lectures_par_siege_sup as lectures_siege
             from ref.offre_a('premium', date '2026-12-01')`,
        )
      ).rows[0]!;
      assert.equal(grille.portee, "organisation");
      const avant = await premium("2026-11-01");
      const apres = await premium("2026-12-01");
      assert.equal(avant.sieges, 5, "avant : une personne, une place");
      assert.equal(apres.sieges, 10, "après : une place par société et par personne");
      assert.equal(
        Number(apres.prix) - Number(avant.prix),
        5 * Number(grille.prix_siege),
        "cinq places de plus au prix de la place",
      );
      assert.equal(apres.lectures - avant.lectures, 5 * grille.lectures_siege);
    });
  });
});
