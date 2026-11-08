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

type Lot = { tenantId: string; pieces: PieceLue[] };

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
});
