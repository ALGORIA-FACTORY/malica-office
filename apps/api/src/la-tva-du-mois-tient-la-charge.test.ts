/**
 * La TVA du mois tient la charge (revue de #145, 30 octobre 2026).
 *
 * La porte des extraits de TVA, appelée PAR LIGNE avant le `distinct on`,
 * coûtait 4,5 s pour 200 pièces quand la même sélection sans elle en coûtait
 * 0,54 ; « Vos charges » interrogeait l'écriture de chaque pièce pour chaque
 * article (3,6 s). Cette épreuve dépose 200 pièces lues (une immobilisation et
 * une fourniture chacune), en force 40, et borne chaque lecture du mois par
 * rapport à la même sélection nue — une borne large, pour ne pas dépendre de
 * la machine, mais qui échoue à l'ancien coût.
 *
 * 12 novembre 2026 : sur une base où d'autres dossiers avaient travaillé, la
 * même lecture montait de 1,5 à 3,7 s — la porte parcourait tous les articles
 * de la base, et chaque pièce forcée toutes les prises en charge. Une base
 * neuve ne le voit pas. L'épreuve lit donc le mois une seconde fois, après
 * avoir déposé des articles qu'il ne lit pas, et borne ce qu'ils lui coûtent.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-tva-du-mois-tient-la-charge.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la TVA du mois tient la charge", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `tva-charge-${Date.now()}`;
  // Une famille d'essai, reconnue par un mot que rien d'autre n'emploie.
  const FAMILLE = `IMMO_ESSAI_${Date.now()}`;
  const MOT = `immoessai${Date.now()}`;
  const mfDossier = matriculeDEssai("A", "M");
  const mdp = "MotDePasseTresLong2026!";
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let packId = "";
  let jour = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const pmeFait = (methode: string, ...args: unknown[]) => rpc(dirigeant, methode, ...args);
  const cabinetFait = (methode: string, ...args: unknown[]) => rpc(expert, methode, ...args);

  let n = 0;
  /** Une pièce lue (TVA19 : HT 1 234,560, TVA 234,566, timbre 1,000), ni jugée ni transmise. */
  const lue = async (extrait?: (e: Record<string, unknown>) => Record<string, unknown>) => {
    n += 1;
    const { id } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    const l = lectureDEssai({ clientMf: mfDossier, numero: `IMMO-${marque}-${n}` });
    const extract = extrait ? extrait(l.extract) : l.extract;
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract,
              citations: l.citations,
              flags: [],
              articles: (extract["articles"] as unknown[] | undefined) ?? [],
              documentKind: "facture_achat",
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    return id;
  };
  /** La même, jugée et transmise : elle compte dans le mois. */
  const transmise = async (extrait?: (e: Record<string, unknown>) => Record<string, unknown>) => {
    const id = await lue(extrait);
    await pmeFait("capture.analyser", id);
    await pmeFait("collab.setPieceVis", id, "partage");
    return id;
  };

  const L = (compte: string, debit: string, credit: string, taxe: string | null = null) => ({
    account_code: compte,
    libelle: compte,
    debit,
    credit,
    tax_code: taxe,
  });
  const force = (pieceId: string, lignes: unknown[]) =>
    cabinetFait("office.forcer", {
      pieceId,
      journal: "ACH",
      date: jour,
      libelle: "Facture saisie par le cabinet",
      lignes,
      typeDeDocument: null,
    }) as Promise<string>;

  /** Une écriture proposée sur la pièce, à ce jour. */
  const proposer = (db: Parameters<typeof office.propose>[0], pieceId: string, lignes: unknown[]) =>
    office.propose(db, {
      pieceId,
      journal: "ACH",
      date: jour,
      libelle: "Facture d'essai",
      packVersionId: packId,
      devise: "TND",
      lignes,
    });
  /**
   * Une pièce lue qui compte dans le mois sans être prise en charge : une
   * écriture lui est proposée (statut « proposée »), ni validée ni forcée.
   */
  const proposee = async (extrait?: (e: Record<string, unknown>) => Record<string, unknown>) => {
    const id = await transmise(extrait);
    await sousIdentite(expert.id, (db) =>
      proposer(db, id, [
        L("601", "1234.560", "0"),
        L("4366", "234.566", "0", "TVA19"),
        L("401", "0", "1469.126"),
      ]),
    );
    return id;
  };

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, mdp);
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME D'ESSAI ${marque}`, mfDossier);
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mfDossier));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
    // Une famille d'articles dont le compte est une immobilisation (2282) :
    // la lecture la reconnaît par le référentiel, jamais par un mot du code.
    await admin.query(
      `insert into ref.charge_familles
         (pack_version_id, code, label, ordinal, is_fallback, valid_from, main_account)
       values ($1, $2, 'Famille d''essai', 999, false, date '2020-01-01', '2282')`,
      [packId, FAMILLE],
    );
    await admin.query(
      `insert into ref.charge_famille_rules
         (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
       values ($1, $2, 'designation_pattern', $3, 1, date '2020-01-01')`,
      [packId, FAMILLE, MOT],
    );
  });

  after(async () => {
    try {
      await admin.query(`delete from ref.charge_famille_rules where famille_code = $1`, [FAMILLE]);
      await admin.query(`delete from ref.charge_familles where code = $1`, [FAMILLE]);
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });
  it("200 pièces : la TVA du mois et « Vos charges » restent dans la borne de la sélection nue", async () => {
    const ids: string[] = [];
    for (let k = 0; k < 20; k++) {
      ids.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, () =>
            proposee((e) => ({
              ...e,
              articles: [
                { designation: `${MOT} a`, quantity: "1", total_ht: "1000.000", tax_code: "TVA19" },
                { designation: "Ramettes", quantity: "1", total_ht: "234.560", tax_code: "TVA19" },
              ],
            })),
          ),
        )),
      );
    }
    // Quarante prises en charge par le cabinet : leurs comptes décident.
    for (const id of ids.slice(0, 40))
      await force(id, [
        L("2282", "1000.000", "0"),
        L("601", "234.560", "0"),
        L("4366", "234.566", "0", "TVA19"),
        L("401", "0", "1469.126"),
      ]);
    const duree = async (f: () => Promise<unknown>) => {
      const t0 = performance.now();
      const r = await f();
      return { ms: performance.now() - t0, n: Array.isArray(r) ? r.length : -1 };
    };
    const meilleure = async (f: () => Promise<unknown>) => {
      // Trois passes, la meilleure : le premier appel paie les caches.
      const passes = [await duree(f), await duree(f), await duree(f)];
      return passes.reduce((a, b) => (b.ms < a.ms ? b : a));
    };
    const nue = await meilleure(() =>
      sousIdentite(
        dirigeant.id,
        async (db) =>
          (
            await db.query(
              `select distinct on (x.piece_id) x.piece_id, x.payload
               from extractions_v x join pieces_qui_comptent_v p on p.id = x.piece_id
              where p.tenant_id = $1 and p.transmise_le is not null and x.contract = 'extract.v1'
              order by x.piece_id, x.created_at desc`,
              [pme],
            )
          ).rows,
      ),
    );
    const transmis = await meilleure(() =>
      pmeFait("office.extraitsTransmis", pme, "2000-01-01", "2100-12-31"),
    );
    const inscrits = await meilleure(() =>
      cabinetFait("office.bookedExtracts", pme, "2000-01-01", "2100-12-31"),
    );
    const charges = await meilleure(() => pmeFait("charges.articles", pme, "2000-01", "2100-12"));
    // « Vos charges » sans la règle des immobilisations : la requête d'avant.
    const chargesNues = await meilleure(() =>
      sousIdentite(
        dirigeant.id,
        async (db) =>
          (
            await db.query(
              `select a.id from piece_articles_v a
               join pieces_qui_comptent_v q on q.id = a.piece_id
              where a.tenant_id = $1 and q.source = 'lecture' and q.document_kind <> 'facture_vente'
             union all
             select q.id from pieces_qui_comptent_v q
              cross join lateral app.charges_prises_en_charge(q.id) l
              where q.tenant_id = $1 and q.source = 'cabinet' and q.document_kind <> 'facture_vente'`,
              [pme],
            )
          ).rows,
      ),
    );
    console.log(`# temps : ${JSON.stringify({ nue, transmis, inscrits, chargesNues, charges })}`);
    assert.equal(transmis.n, 200);
    assert.equal(inscrits.n, 40);
    // Des bornes LARGES : elles échouent à l'ancien coût (8 fois et plus la
    // sélection nue), pas au bruit d'une machine chargée.
    const borne = 4 * nue.ms + 500;
    for (const [nom, mesure] of Object.entries({ transmis, inscrits }))
      assert.ok(mesure.ms <= borne, `${nom} : ${mesure.ms.toFixed(0)} ms > ${borne.toFixed(0)} ms`);
    const borneDesCharges = 2 * chargesNues.ms + 500;
    assert.ok(
      charges.ms <= borneDesCharges,
      `charges : ${charges.ms.toFixed(0)} ms > ${borneDesCharges.toFixed(0)} ms`,
    );

    // Des articles que le mois ne lit pas : 3 200, sur 80 pièces lues, ni
    // jugées ni transmises. La porte qui parcourait tous les articles de la
    // base payait chacun (mesuré le 12 novembre 2026 : × 1,8 côté PME, × 3
    // côté cabinet) ; celle qui ne lit que ses pièces ne les voit pas.
    const ignores = Array.from({ length: 40 }, (_, k) => ({
      designation: `Ramettes ${k}`,
      quantity: "1",
      total_ht: "1.000",
      tax_code: "TVA19",
    }));
    for (let k = 0; k < 8; k++)
      await Promise.all(
        Array.from({ length: 10 }, () => lue((e) => ({ ...e, articles: ignores }))),
      );
    const transmisApres = await meilleure(() =>
      pmeFait("office.extraitsTransmis", pme, "2000-01-01", "2100-12-31"),
    );
    const inscritsApres = await meilleure(() =>
      cabinetFait("office.bookedExtracts", pme, "2000-01-01", "2100-12-31"),
    );
    console.log(`# temps apres : ${JSON.stringify({ transmisApres, inscritsApres })}`);
    assert.equal(transmisApres.n, 200);
    assert.equal(inscritsApres.n, 40);
    for (const [nom, avant, apres] of [
      ["transmis", transmis, transmisApres],
      ["inscrits", inscrits, inscritsApres],
    ] as const) {
      const borneApres = 1.5 * avant.ms + 300;
      assert.ok(
        apres.ms <= borneApres,
        `${nom} lit des articles qu'il ne demande pas : ${apres.ms.toFixed(0)} ms > ${borneApres.toFixed(0)} ms`,
      );
    }
  });

  it("les versions d'une pièce sont estimées à quelques lignes, pas mille", async () => {
    // Estimée à 1 000 lignes (le défaut d'une fonction qui rend un ensemble),
    // `app.versions_de_la_piece` faisait parcourir toutes les prises en charge
    // de la base à chaque pièce forcée. Un `create or replace` sans `rows` la
    // ramène à ce défaut : le temps ne le verrait que sur une base chargée.
    const { rows } = await admin.query<{ prorows: number }>(
      `select prorows from pg_proc where oid = 'app.versions_de_la_piece(uuid)'::regprocedure`,
    );
    assert.ok(rows[0]!.prorows <= 10, `versions_de_la_piece estimée à ${rows[0]!.prorows} lignes`);
  });
});
