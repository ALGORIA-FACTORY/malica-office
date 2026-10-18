/**
 * Une convention fiscale en vigueur se cite ; elle ne reste pas « indéterminée ».
 *
 * ==================================================================== LE DÉFAUT
 *
 * 18 octobre 2026 : 1 357 articles du corpus PORTAIENT le droit — les 45
 * conventions fiscales (1 315 articles) et les 42 normes comptables
 * tunisiennes (42) — et tous avaient le statut `indetermine`.
 *
 * Deux règles du dépôt se heurtaient :
 *
 *   — la recherche les rend, et doit les rendre : une convention prime sur la
 *     loi interne et plafonne la retenue à la source
 *     (`20260901200000_les_conventions_entrent_dans_la_recherche.sql`) ;
 *   — la consigne 12 du système de Malica dit « Un article dont le statut
 *     n'est pas "en vigueur" ne fonde aucune réponse actuelle », et l'en-tête
 *     transmis au modèle imprime « — STATUT : indetermine ».
 *
 * Résultat mesuré : à une question sur la convention France–Tunisie — qui est
 * en vigueur depuis le 1er avril 1975 — Malica refusait de fonder sa réponse.
 * Et le contrôle `statut_non_en_vigueur` partait au journal, où personne ne le
 * lit.
 *
 * ===================================================================== LA SOURCE
 *
 * Aucun statut n'est posé de mémoire. La date d'entrée en vigueur de chacune
 * des 45 conventions vient de la liste de réserves et de notifications déposée
 * par la République tunisienne au moment du dépôt de son instrument de
 * ratification de la Convention multilatérale BEPS (OCDE, déposée le 24 juillet
 * 2023) : elle nomme, pour chaque convention couverte, la juridiction, la date
 * de signature et la date d'entrée en vigueur. Les 45 corpus du dépôt y
 * figurent tous. Ces dates vivent en base, en littéral, dans
 * `legal.corpus_vigueur`.
 *
 * Pour les normes comptables : la loi n° 96-112 du 30 décembre 1996 relative au
 * système comptable des entreprises et les arrêtés du ministre des finances
 * portant approbation des normes. Chaque norme porte déjà sa propre date sur
 * sa version (1997 à 2011) ; aucun arrêté d'abrogation n'existe.
 *
 * ================================================================ CE QU'ON TIENT
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import type { FragmentDeDroit } from "./malica/conseil/corpus.ts";
import { controler } from "./malica/conseil/controles.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

describe("le droit conventionnel et les normes comptables", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;

  /*
   * Le corpus pèse quinze mille articles : la base de test ne le porte pas, et
   * n'a pas à le porter. Les épreuves du RÉFÉRENTIEL — `legal.corpus_vigueur`,
   * écrite par la migration — tournent partout. Celles qui comptent des
   * ARTICLES se sautent proprement là où il n'y en a aucun, comme le fait déjà
   * `corpus-en-vigueur.test.ts`. Un test vert sur zéro ligne est un test qui
   * mentirait.
   */
  let corpusCharge = false;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from legal.articles where corpus like 'CONV-%'`,
    );
    corpusCharge = Number(rows[0]!.n) > 0;
  });

  after(async () => {
    await pool.end();
  });

  it("ne laisse aucun article du droit conventionnel indéterminé", async (t) => {
    if (!corpusCharge) return t.skip("aucune convention sur cette instance");
    const { rows } = await pool.query<{ corpus: string; n: string }>(
      `select corpus, count(*)::text as n
         from legal.articles
        where (corpus like 'CONV-%' or corpus = 'NCT') and statut = 'indetermine'
        group by 1 order by 1`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.corpus} (${r.n})`),
      [],
      "un article qui porte le droit et dit « indéterminé » ne fonde aucune réponse",
    );
  });

  it("aucun corpus ingéré ne porte le droit sans date ni source", async (t) => {
    if (!corpusCharge) return t.skip("aucune convention sur cette instance");
    const { rows: orphelins } = await pool.query<{ corpus: string }>(
      `select distinct a.corpus
         from legal.articles a
         left join legal.corpus_vigueur v on v.corpus = a.corpus
        where (a.corpus like 'CONV-%' or a.corpus = 'NCT')
          and v.corpus is null
        order by 1`,
    );
    assert.deepEqual(
      orphelins.map((r) => r.corpus),
      [],
      "un statut « en vigueur » sans date ni source est une affirmation nue",
    );
  });

  it("chaque corpus du droit conventionnel porte sa date d'entrée en vigueur et sa source", async () => {
    const { rows } = await pool.query<{
      corpus: string;
      en_vigueur_le: string;
      source: string;
    }>(
      `select corpus, en_vigueur_le::text as en_vigueur_le, source
         from legal.corpus_vigueur order by corpus`,
    );

    assert.ok(rows.length >= 46, "45 conventions et les normes comptables");
    const aujourdhui = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      assert.ok(
        r.en_vigueur_le <= aujourdhui,
        `${r.corpus} : une entrée en vigueur future ne rend pas l'article citable`,
      );
      assert.ok(r.source.trim().length > 20, `${r.corpus} : la source doit se lire, pas s'abréger`);
    }
  });

  it("la convention France–Tunisie est citable, et l'entrée en vigueur est la bonne", async (t) => {
    if (corpusCharge) {
      const { rows } = await pool.query<{ statut: string; n: string }>(
        `select statut, count(*)::text as n from legal.articles
          where corpus = 'CONV-FRANCE' group by 1`,
      );
      assert.deepEqual(rows, [{ statut: "en_vigueur", n: "44" }]);
    } else t.diagnostic("corpus absent : seule la date du référentiel est éprouvée ici");

    const { rows: date } = await pool.query<{ signe_le: string; en_vigueur_le: string }>(
      `select signe_le::text as signe_le, en_vigueur_le::text as en_vigueur_le
         from legal.corpus_vigueur where corpus = 'CONV-FRANCE'`,
    );
    assert.equal(date[0]!.signe_le, "1973-05-28");
    assert.equal(date[0]!.en_vigueur_le, "1975-04-01");
  });

  /*
   * Le contrôle est la moitié qui manquait : poser le statut en base ne sert à
   * rien si le verdict continue de disqualifier le fragment. On éprouve donc
   * les deux sens — il se TAIT sur un fragment en vigueur, et il parle encore
   * sur un fragment qui ne l'est pas.
   */
  const fragmentFrance = (p: Partial<FragmentDeDroit> = {}): FragmentDeDroit => ({
    corpus: "CONV-FRANCE",
    numero: "19",
    validFrom: "1975-04-01",
    validTo: null,
    ordinal: 1,
    langue: "fr",
    extrait: "Article 19 : Redevances — Les redevances provenant d'un Etat contractant…",
    statut: "en_vigueur",
    abrogePar: null,
    nature: "Convention internationale ratifiée",
    autorite: "normative",
    opposableA: "administration, contribuable, juge",
    jortReference: null,
    provenance: "verbatim",
    distance: 0.2,
    ...p,
  });

  it("le contrôle se tait sur un article conventionnel en vigueur", () => {
    const verdicts = controler({
      reponse: "La convention France–Tunisie, art. 19, plafonne la retenue sur les redevances.",
      fragments: [fragmentFrance()],
      chiffresAutorises: [],
      aujourdhui: "2026-10-18",
    });
    assert.deepEqual(
      verdicts.map((v) => v.code),
      [],
      "un article en vigueur, cité et transmis, ne doit lever aucun verdict",
    );
  });

  it("le contrôle parle encore sur un article qui ne tient plus", () => {
    const verdicts = controler({
      reponse: "La convention France–Tunisie, art. 19, s'applique.",
      fragments: [fragmentFrance({ statut: "indetermine" })],
      chiffresAutorises: [],
      aujourdhui: "2026-10-18",
    });
    assert.ok(
      verdicts.some((v) => v.code === "statut_non_en_vigueur"),
      "le garde ne doit pas avoir été désarmé en même temps que le statut posé",
    );
  });

  /*
   * ================================================= LA LECTURE NON VERBATIM
   *
   * 17 % des versions du corpus ne sont pas verbatim — 2 285 `incertain`,
   * 506 `partiel`. Mesure du 18 octobre 2026 : elles se concentrent dans les
   * lois de finances, qui ne PORTENT pas le droit (`porte_le_droit = false`) et
   * n'entrent dans la recherche que sur demande d'historique.
   *
   * Dans les 1 357 articles qui portent le droit, 1 330 sont verbatim et 27 ne
   * le sont pas : la convention Tunisie–Arabie Saoudite, ingérée depuis un PDF
   * arabe, dont CHAQUE article est `incertain`. Elle est en vigueur, elle est
   * donc citable — et chacune de ses citations lève `lecture_incertaine`, que
   * l'écran montre. C'est le bon partage : on ne cache pas la convention, on
   * dit que la lecture n'est pas sûre.
   */
  it("une citation dont la lecture n'est pas verbatim reste signalée", () => {
    const verdicts = controler({
      reponse: "La convention Tunisie–Arabie Saoudite, art. 12, s'applique.",
      fragments: [
        fragmentFrance({
          corpus: "CONV-ARABIE-SAOUDITE",
          numero: "12",
          provenance: "incertain",
        }),
      ],
      chiffresAutorises: [],
      aujourdhui: "2026-10-18",
    });
    assert.ok(verdicts.some((v) => v.code === "lecture_incertaine"));
  });

  it("les 27 versions non verbatim du droit conventionnel sont celles qu'on sait", async (t) => {
    if (!corpusCharge) return t.skip("aucune convention sur cette instance");
    const { rows } = await pool.query<{ corpus: string; n: string }>(
      `select a.corpus, count(*)::text as n
         from legal.articles a
         join legal.article_versions v on v.article_id = a.id
        where (a.corpus like 'CONV-%' or a.corpus = 'NCT')
          and v.extraction_confiance <> 'verbatim'
        group by 1 order by 1`,
    );
    assert.deepEqual(
      rows,
      [{ corpus: "CONV-ARABIE-SAOUDITE", n: "27" }],
      "une nouvelle convention lue partiellement doit être vue, pas découverte en production",
    );
  });
});
