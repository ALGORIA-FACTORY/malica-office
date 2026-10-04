/**
 * La recherche ne rend jamais un texte abrogé.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 4 octobre 2026, première question réelle posée depuis un téléphone : « le
 * taux de TVA en Tunisie en 2026 ». La recherche a rendu l'article 7 du Code
 * de la TVA dans sa version « du 2024-01-01 au 2025-01-01 » — périmée depuis
 * vingt-et-un mois — alors que la version en vigueur depuis le 1er janvier
 * 2026 était en base. Malica l'a vu, l'a dit dans son doute, et a refusé de
 * citer une source : certitude zéro, réponse retenue.
 *
 * La cause : `distinct on (article_id, langue_faisant_foi)` rendait UNE
 * VERSION PAR LANGUE. Les versions 2025 et 2026 n'ayant été ingérées qu'en
 * arabe, la dernière version française s'arrêtait en 2024 — et une question
 * posée en français la faisait gagner.
 *
 * ===================================================================== LA RÈGLE
 *
 * L'arabe fait foi. La recherche rend, par article, la version en vigueur à la
 * date demandée — toutes langues confondues — et jamais une autre. Un conseil
 * fiscal fondé sur un article abrogé est pire qu'un silence.
 *
 * ============================================================== CE TEST N'A PAS
 *
 * Besoin d'un modèle. Le vecteur est arbitraire : le classement par distance
 * n'a alors aucun sens, et c'est sans importance — ce qu'on éprouve ici, c'est
 * le FILTRE, pas le rang. Le test tourne donc en intégration continue comme
 * sur le poste, et il se saute proprement là où le corpus n'est pas chargé.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { corpus } from "./depots/corpus.ts";
import { fermerLePool, horsRlsAuthentificationSeule } from "./db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** 1024, comme la colonne. Une valeur constante : on ne cherche pas un sens. */
const VECTEUR_QUELCONQUE = Array.from({ length: 1024 }, () => 0.01);

let corpusCharge = false;

async function sousAuthenticated<T>(
  travail: (db: Parameters<typeof corpus.rechercher>[0]) => Promise<T>,
): Promise<T> {
  return horsRlsAuthentificationSeule(async (db) => {
    await db.query("set local role authenticated");
    return travail(db);
  });
}

describe("la recherche dans le droit", { skip: !BASE_CONFIGUREE }, () => {
  before(async () => {
    corpusCharge = await sousAuthenticated(async (db) => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*) n from legal.chunks where embedding is not null",
      );
      return Number(rows[0]?.n ?? 0) > 0;
    });
  });

  after(async () => {
    await fermerLePool();
  });

  it("ne rend aucune version périmée, quelle que soit sa langue", async (t) => {
    if (!corpusCharge) return t.skip("aucun fragment vectorisé sur cette instance");

    const trouves = await sousAuthenticated((db) =>
      corpus.rechercher(db, { vecteur: VECTEUR_QUELCONQUE, nb: 20, jour: null, doctrine: true }),
    );

    const aujourdhui = new Date().toISOString().slice(0, 10);
    const perimes = trouves
      .filter((f) => f.validTo !== null && f.validTo <= aujourdhui)
      .map((f) => `${f.corpus} art. ${f.numero} — clos le ${f.validTo}`);

    assert.deepEqual(perimes, [], "la recherche a rendu du droit abrogé");
  });

  it("ne rend aucune version future", async (t) => {
    if (!corpusCharge) return t.skip("aucun fragment vectorisé sur cette instance");

    const trouves = await sousAuthenticated((db) =>
      corpus.rechercher(db, { vecteur: VECTEUR_QUELCONQUE, nb: 20, jour: null, doctrine: true }),
    );

    const aujourdhui = new Date().toISOString().slice(0, 10);
    const pasEncore = trouves
      .filter((f) => f.validFrom !== null && f.validFrom > aujourdhui)
      .map((f) => `${f.corpus} art. ${f.numero} — ouvre le ${f.validFrom}`);

    assert.deepEqual(pasEncore, []);
  });

  it("rend un seul état par article : pas deux langues du même texte", async (t) => {
    if (!corpusCharge) return t.skip("aucun fragment vectorisé sur cette instance");

    const trouves = await sousAuthenticated((db) =>
      corpus.rechercher(db, { vecteur: VECTEUR_QUELCONQUE, nb: 20, jour: null, doctrine: true }),
    );

    const vus = new Map<string, number>();
    for (const f of trouves) {
      const cle = `${f.corpus}|${f.numero}`;
      vus.set(cle, (vus.get(cle) ?? 0) + 1);
    }
    const doubles = [...vus.entries()].filter(([, n]) => n > 1).map(([cle]) => cle);

    assert.deepEqual(doubles, []);
  });

  it("à une date passée, rend l'état du droit de CETTE date", async (t) => {
    if (!corpusCharge) return t.skip("aucun fragment vectorisé sur cette instance");

    const jour = "2023-06-15";
    const trouves = await sousAuthenticated((db) =>
      corpus.rechercher(db, {
        vecteur: VECTEUR_QUELCONQUE,
        nb: 20,
        jour,
        doctrine: true,
        historique: true,
      }),
    );

    const hors = trouves
      .filter(
        (f) =>
          (f.validFrom !== null && f.validFrom > jour) || (f.validTo !== null && f.validTo <= jour),
      )
      .map((f) => `${f.corpus} art. ${f.numero} — ${f.validFrom} → ${f.validTo ?? "ouvert"}`);

    assert.deepEqual(hors, [], `du droit hors de la date demandée (${jour})`);
  });

  it("le texte consolidé précède la doctrine administrative", async (t) => {
    if (!corpusCharge) return t.skip("aucun fragment vectorisé sur cette instance");

    const trouves = await sousAuthenticated((db) =>
      corpus.rechercher(db, { vecteur: VECTEUR_QUELCONQUE, nb: 20, jour: null, doctrine: true }),
    );

    /*
     * Le 4 octobre 2026, « le taux de TVA en 2026 » a rendu ONZE notes
     * communes avant l'article 7 du Code de la TVA — qui arrivait douzième et
     * tombait donc hors du filet de six. Malica a répondu, honnêtement, qu'elle
     * n'avait pas la grille des taux : elle ne l'avait pas reçue.
     *
     * Une note commune dit ce que l'administration pense du texte ; le code dit
     * le texte. Quand les deux répondent, c'est le texte qui passe devant.
     */
    const estDoctrine = (corpusDuFragment: string) => corpusDuFragment.startsWith("NC-");

    /*
     * On n'exige pas que les deux natures soient présentes — avec un vecteur
     * arbitraire, elles ne le sont pas toujours. On exige que l'ordre soit
     * MONOTONE : une fois la doctrine commencée, plus aucun texte consolidé ne
     * revient derrière. C'est vrai quelle que soit la composition du résultat.
     */
    const fautifs: string[] = [];
    let doctrineVue = false;
    for (const f of trouves) {
      if (estDoctrine(f.corpus)) doctrineVue = true;
      else if (doctrineVue) fautifs.push(`${f.corpus} art. ${f.numero}`);
    }

    assert.deepEqual(fautifs, [], "du texte consolidé est relégué derrière de la doctrine");
  });
});
