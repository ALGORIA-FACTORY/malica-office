/**
 * La bibliothèque d'un propriétaire de nombreuses sociétés s'ouvre vite
 * (recette du 7 novembre 2026 : « le chargement est trop lent »).
 *
 * Trois preuves, contre la vraie base et sous l'identité de chacun :
 *
 *   1. L'appel groupé rend, société par société, EXACTEMENT ce que rend
 *      l'appel d'une société — mêmes pièces, même ordre, mêmes champs.
 *   2. La base filtre toujours : une société où l'appelant n'est pas membre
 *      revient vide, jamais en erreur, et rien d'elle ne fuit.
 *   3. Le budget : 150 sociétés et 10 000 pièces se lisent en un appel, sous
 *      une seconde et demie sur la machine de la CI (la cible produit est
 *      « moins d'une seconde » à l'écran, cache de l'appareil compris).
 *
 *   node --experimental-strip-types --test src/la-bibliotheque-de-cent-societes-s-ouvre-vite.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PieceLue } from "@malica/socle/ports/repositories";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

const SOCIETES = 150;
const PIECES = 10_000;
const BUDGET_MS = 1500;
/** Les pièces qui ont vécu : lues, envoyées, vues, précisées, prises en charge. */
const AVEC_HISTOIRE = 800;
const BUDGET_HISTOIRE_MS = 1500;
/** Une cloche qui n'a pas été lue depuis longtemps (846 sur le serveur d'essai). */
const NOTIFICATIONS = 1500;
const BUDGET_CLOCHE_MS = 500;

type Lot = { tenantId: string; pieces: PieceLue[] };

/**
 * Recopie `vecue` et ses lignes (lecture, vues, circuit, précisions, écriture,
 * prise en charge) sur `AVEC_HISTOIRE` pièces. Déclencheurs coupés pour cette
 * seule connexion : ce banc pose des faits déjà passés par la vraie porte.
 */
async function recopierLaPieceVecue(s: SocieteDEssai, vecue: string, societes: string[]) {
  const c = await s.admin.connect();
  const cible = `($2::uuid[])[1 + (g % array_length($2::uuid[], 1))]`;
  const piece = `md5('banc-histoire-' || g)::uuid`;
  const ecriture = `md5('banc-ecriture-' || g)::uuid`;
  const recopier = async (table: string, ou: string, champs: string) => {
    const avecId = await c.query(
      `select 1 from information_schema.columns
        where table_schema || '.' || table_name = $1 and column_name = 'id'`,
      [table],
    );
    const id = avecId.rowCount ? `'id', gen_random_uuid(),` : "";
    await c.query(
      `insert into ${table}
       select (jsonb_populate_record(null::${table},
                 to_jsonb(x) || jsonb_build_object(${id} ${champs}))).*
         from ${table} x, generate_series(1, $3::int) g
        where ${ou}`,
      [vecue, societes, AVEC_HISTOIRE],
    );
  };
  try {
    await c.query("set session_replication_role = replica");
    await c.query(
      `insert into capture.pieces
       select (jsonb_populate_record(null::capture.pieces,
                 to_jsonb(p) || jsonb_build_object(
                   'id', ${piece}, 'tenant_id', ${cible},
                   'idempotency_key', 'banc-histoire-' || g,
                   'storage_path', 'banc-histoire/' || g, 'sha256', null,
                   'created_at', now() - make_interval(hours => g)))).*
         from capture.pieces p, generate_series(1, $3::int) g
        where p.id = $1`,
      [vecue, societes, AVEC_HISTOIRE],
    );
    const parPiece = `'piece_id', ${piece}, 'tenant_id', ${cible}`;
    for (const t of ["capture.extractions", "capture.circuit", "capture.precisions"]) {
      await recopier(t, "x.piece_id = $1", parPiece);
    }
    await recopier(
      "capture.vues",
      "x.piece_id = $1",
      `${parPiece}, 'cabinet_org_id',
       case when x.cabinet_org_id = x.tenant_id then ${cible} else x.cabinet_org_id end`,
    );
    await c.query(
      `insert into socle.ecritures
       select (jsonb_populate_record(null::socle.ecritures,
                 to_jsonb(x) || jsonb_build_object(
                   'id', ${ecriture}, 'piece_id', ${piece}, 'tenant_id', ${cible}))).*
         from socle.ecritures x, generate_series(1, $3::int) g
        where x.piece_id = $1`,
      [vecue, societes, AVEC_HISTOIRE],
    );
    await c.query(
      `insert into socle.prises_en_charge
       select (jsonb_populate_record(null::socle.prises_en_charge,
                 to_jsonb(x) || jsonb_build_object(
                   'ecriture_id', ${ecriture}, 'client_tenant_id', ${cible}))).*
         from socle.prises_en_charge x
         join socle.ecritures e on e.id = x.ecriture_id,
              generate_series(1, $3::int) g
        where e.piece_id = $1`,
      [vecue, societes, AVEC_HISTOIRE],
    );
  } finally {
    await c.query("set session_replication_role = origin").catch(() => undefined);
    c.release();
  }
}

describe("la bibliothèque de cent sociétés s'ouvre vite", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let autre: SocieteDEssai;
  const societes: string[] = [];

  before(async () => {
    const marque = `cent-${Date.now()}`;
    s = await monterUneSociete(marque);
    autre = await monterUneSociete(`${marque}-voisin`);

    // Quelques pièces réelles, déposées et lues par la vraie porte.
    const lue = await s.deposer("amel", "entite");
    await s.lire("amel", lue);
    await s.deposer("amel", "personnel");
    await s.deposer("bilel", "entite");
    await autre.deposer("amel", "entite");

    // Les autres sociétés du même propriétaire, par la vraie porte aussi.
    societes.push(s.pme);
    for (let i = 1; i < SOCIETES; i++) {
      const id = await sousIdentiteDuServeur(s.gens.amel.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
          [`SOCIETE ${marque} ${i}`],
        );
        return rows[0]!.id;
      });
      societes.push(id);
    }

    /*
     * Dix mille pièces réparties sur les 150 sociétés, recopiées d'une pièce
     * déposée par la porte : seuls l'identifiant, la société, la clé
     * d'idempotence, le chemin et la date changent. Privées, comme une pièce
     * qui attend encore « Pour qui ? » — la liste les rend aussi.
     */
    const modele = await s.deposer("amel", "personnel");
    await s.admin.query(
      `insert into capture.pieces
       select (jsonb_populate_record(null::capture.pieces,
                 to_jsonb(p) || jsonb_build_object(
                   'id', gen_random_uuid(),
                   'tenant_id', ($2::uuid[])[1 + (g % array_length($2::uuid[], 1))],
                   'idempotency_key', 'banc-' || g,
                   'storage_path', 'banc/' || g,
                   'sha256', null,
                   'created_at', now() - make_interval(mins => g)))).*
         from capture.pieces p, generate_series(1, $3::int) g
        where p.id = $1`,
      [modele, societes, PIECES],
    );

    /*
     * ET DES PIÈCES QUI ONT VÉCU (recette du 8 novembre 2026). Les 10 000
     * ci-dessus n'ont aucune histoire : elles passent par le chemin court. En
     * vrai, une pièce est lue, envoyée, vue, précisée, prise en charge — 761
     * pièces réelles coûtaient 14 s. Une pièce qui a fait tout le chemin, par
     * la vraie porte, recopiée avec toutes ses lignes.
     */
    const vecue = await s.deposer("sami", "entite");
    await s.lire("sami", vecue);
    await s.fait("sami", "collab.envoyer", vecue);
    await s.fait("amel", "supervision.voir", vecue);
    await s.fait("sami", "capture.preciser", vecue, "document_date", "2026-10-01");
    await s.fait("amel", "collab.envoyer", vecue);
    await s.fait("expert", "supervision.voir", vecue);
    await s.priseEnCharge(vecue);
    await recopierLaPieceVecue(s, vecue, societes.slice(0, 60));
    await s.admin.query(
      `insert into collab.notifications (tenant_id, kind, payload)
       select ($1::uuid[])[1 + (g % array_length($1::uuid[], 1))], 'piece.retournee',
              jsonb_build_object('piece_id', md5('banc-histoire-' || (1 + g % $2::int))::uuid)
         from generate_series(1, $3::int) g`,
      [societes.slice(0, 60), AVEC_HISTOIRE, NOTIFICATIONS],
    );

    /*
     * Les statistiques d'un serveur qui tourne (9 novembre 2026). Les milliers
     * de lignes ci-dessus arrivent d'un coup : sans statistiques, le
     * planificateur les croit vides et choisit des boucles imbriquées. Mesuré
     * sur une base neuve : 7,1 s sans, 0,34 s avec ; en CI, 8 s, 13,5 s puis
     * le délai de 30 s, selon que l'autovacuum était passé ou non. Un serveur
     * a ses statistiques (l'autovacuum les tient) : c'est ce plan-là que le
     * budget garde.
     */
    // Toute la base : les 150 sociétés et leurs droits comptent autant que
    // les pièces (3,3 s en n'analysant que les tables des pièces).
    await s.admin.query("analyze");
  });

  after(async () => {
    try {
      await s?.admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [societes.slice(1)],
      );
      await autre?.fermer();
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("rend, société par société, ce que rend l'appel d'une société", async () => {
    const seule = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as PieceLue[];
    const lots = (await s.fait("amel", "capture.listAvecLectureDesSocietes", [
      s.pme,
      societes[1],
    ])) as Lot[];
    assert.deepEqual(
      lots.map((l) => l.tenantId),
      [s.pme, societes[1]],
      "une entrée par société, dans l'ordre demandé",
    );
    assert.deepEqual(lots[0]!.pieces, seule);
    const deLaSeconde = (await s.fait(
      "amel",
      "capture.listAvecLecture",
      societes[1],
    )) as PieceLue[];
    assert.deepEqual(lots[1]!.pieces, deLaSeconde);
  });

  it("une société étrangère revient vide, sans erreur et sans fuite", async () => {
    const lots = (await s.fait("amel", "capture.listAvecLectureDesSocietes", [
      s.pme,
      autre.pme,
    ])) as Lot[];
    assert.equal(lots[1]!.tenantId, autre.pme);
    assert.deepEqual(lots[1]!.pieces, [], "la RLS ne laisse rien passer");
    // Le siège ne voit, dans sa société, que ce que l'appel d'une société lui rend.
    const seule = (await s.fait("sami", "capture.listAvecLecture", s.pme)) as PieceLue[];
    const [lot] = (await s.fait("sami", "capture.listAvecLectureDesSocietes", [s.pme])) as Lot[];
    assert.deepEqual(lot!.pieces, seule);
  });

  it("une société écrite en majuscules rend les mêmes pièces", async () => {
    const seule = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as PieceLue[];
    const enCapitales = (await s.fait(
      "amel",
      "capture.listAvecLecture",
      s.pme.toUpperCase(),
    )) as PieceLue[];
    assert.deepEqual(enCapitales, seule);
    const [lot] = (await s.fait("amel", "capture.listAvecLectureDesSocietes", [
      s.pme.toUpperCase(),
    ])) as Lot[];
    assert.deepEqual(lot!.pieces, seule);
  });

  it("refuse ce qui n'est pas une liste bornée de sociétés", async () => {
    await assert.rejects(s.fait("amel", "capture.listAvecLectureDesSocietes", "pas-une-liste"));
    await assert.rejects(s.fait("amel", "capture.listAvecLectureDesSocietes", ["pas-un-uuid"]));
  });

  it(`${SOCIETES} sociétés et ${PIECES} pièces : un appel, sous ${BUDGET_MS} ms`, async () => {
    // Un premier passage chauffe le plan, comme un serveur qui tourne.
    await s.fait("amel", "capture.listAvecLectureDesSocietes", societes);
    const mesures: number[] = [];
    let lots: Lot[] = [];
    for (let i = 0; i < 3; i++) {
      const debut = performance.now();
      lots = (await s.fait("amel", "capture.listAvecLectureDesSocietes", societes)) as Lot[];
      mesures.push(performance.now() - debut);
    }
    const total = lots.reduce((n, l) => n + l.pieces.length, 0);
    const mediane = mesures.sort((a, b) => a - b)[1]!;
    console.log(
      `  ${SOCIETES} sociétés, ${total} pièces : ${Math.round(mediane)} ms (médiane de 3)`,
    );
    assert.equal(lots.length, SOCIETES);
    assert.ok(total >= PIECES, `${total} pièces rendues`);
    assert.ok(mediane < BUDGET_MS, `${Math.round(mediane)} ms, budget ${BUDGET_MS} ms`);
  });

  it(`${AVEC_HISTOIRE} pièces qui ont vécu : un appel, sous ${BUDGET_HISTOIRE_MS} ms`, async () => {
    const dossiers = societes.slice(0, 60);
    await s.fait("amel", "capture.listAvecLectureDesSocietes", dossiers);
    const debut = performance.now();
    const lots = (await s.fait("amel", "capture.listAvecLectureDesSocietes", dossiers)) as Lot[];
    const duree = performance.now() - debut;
    const vecues = lots.flatMap((l) => l.pieces).filter((p) => p.suivi?.priseLe);
    console.log(`  ${vecues.length} pièces prises en charge : ${Math.round(duree)} ms`);
    assert.ok(vecues.length >= AVEC_HISTOIRE, `${vecues.length} pièces qui ont vécu`);
    assert.ok(duree < BUDGET_HISTOIRE_MS, `${Math.round(duree)} ms, budget ${BUDGET_HISTOIRE_MS}`);
  });

  it(`une cloche de ${NOTIFICATIONS} notifications : un appel, sous ${BUDGET_CLOCHE_MS} ms`, async () => {
    const dossiers = societes.slice(0, 60);
    await s.fait("amel", "collab.notifications", dossiers);
    const debut = performance.now();
    const lues = (await s.fait("amel", "collab.notifications", dossiers)) as unknown[];
    const duree = performance.now() - debut;
    console.log(`  ${lues.length} notifications : ${Math.round(duree)} ms`);
    assert.ok(lues.length >= NOTIFICATIONS, `${lues.length} notifications`);
    assert.ok(duree < BUDGET_CLOCHE_MS, `${Math.round(duree)} ms, budget ${BUDGET_CLOCHE_MS}`);
  });
});
