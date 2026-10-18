/**
 * La file durable des travaux de lecture, éprouvée — pas relue.
 *
 * Tout passe par `sousIdentite`, donc par le rôle `authenticated` avec le
 * claim `sub` posé dans la transaction. C'est la quatrième règle du plan
 * (`docs/fabrique-de-lecteurs/00-plan.md`) : une preuve obtenue en
 * superutilisateur ne prouve rien.
 *
 * ================================================= CE QUE CES ÉPREUVES TIENNENT
 *
 *   l'accusé    un travail enregistré l'est DURABLEMENT, et deux fois la même
 *               clé ne font qu'un travail ;
 *   la prise    elle est un FAIT NOUVEAU, jamais un `update` — et sa réussite
 *               se lit sur la ligne rendue, pas sur un nombre de lignes ;
 *   la course   deux preneurs, un seul travail : l'unicité de la tentative
 *               tranche, et le perdant le sait ;
 *   la reprise  un travail pris puis abandonné redevient prenable TOUT SEUL,
 *               sans balayeur ni intervention ;
 *   les bornes  tentatives, abandon et repli viennent du référentiel, se
 *               surchargent par cabinet, et leur absence REFUSE ;
 *   l'échec     refus métier, panne fournisseur et erreur technique ne
 *               déclenchent pas la même suite ;
 *   l'argent    `lecture_consommer` reste la seule porte, et deux passages
 *               ne comptent qu'une lecture.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/travaux.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite, type Requete } from "../db.ts";

import {
  executerUnTravail,
  PanneFournisseur,
  qualifierEchec,
  RefusMetier,
} from "./travaux-execution.ts";
import {
  bornesDeTravail,
  enregistrerTravail,
  etatDuTravail,
  inscrireIssue,
  prendreUnTravail,
} from "./travaux.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

function codeDe(erreur: unknown): string {
  const e = erreur as { code?: string; message?: string };
  return e.code ?? e.message ?? String(erreur);
}

async function refusDe(
  utilisateur: string,
  sql: string,
  args: unknown[] = [],
): Promise<{ code: string | null; message: string }> {
  try {
    await sousIdentite(utilisateur, async (db) => db.query(sql, args));
    return { code: null, message: "" };
  } catch (erreur) {
    return {
      code: codeDe(erreur),
      message: (erreur as { message?: string }).message ?? String(erreur),
    };
  }
}

describe("la file durable des travaux de lecture", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `trv-${Date.now()}`;
  let a: Utilisateur;
  let b: Utilisateur;
  let orgA = "";
  let orgB = "";
  let pieceA = "";
  let pieceB = "";
  let admin: pg.Pool;

  /** Une organisation et sa première pièce, par le vrai chemin, sous l'identité. */
  async function monter(u: Utilisateur, suffixe: string): Promise<[string, string]> {
    return sousIdentite(u.id, async (db: Requete) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `ESSAI ${marque} ${suffixe}`, "autonome", "TN", "TND"],
      );
      const org = rows[0]!.org;
      const piece = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3) returning id`,
        [org, `essai/${marque}-${suffixe}.pdf`, `${marque}-${suffixe}`],
      );
      return [org, piece.rows[0]!.id];
    });
  }

  /** Une pièce de plus chez A — chaque épreuve a la sienne. */
  async function pieceDeplus(suffixe: string): Promise<string> {
    return sousIdentite(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3) returning id`,
        [orgA, `essai/${marque}-${suffixe}.pdf`, `${marque}-${suffixe}`],
      );
      return rows[0]!.id;
    });
  }

  /** Le cabinet ARRÊTE une borne, au-dessus du défaut du pack (R10). */
  async function arreter(borne: string, valeur: number): Promise<void> {
    await sousIdentite(a.id, async (db) => {
      await db.query(
        `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, $2, $3, 'épreuve automatisée')
         on conflict (tenant_id, code) do update set value_num = excluded.value_num`,
        [orgA, `fabrique.seuil.travail.${borne}`, valeur],
      );
    });
  }

  /**
   * Ferme tout ce qui traîne, par le vrai chemin.
   *
   * Les épreuves partagent une organisation, donc une file. Sans cela, chaque
   * épreuve prendrait le travail de la précédente — et le dirait de la
   * mauvaise façon : « la prise ne marche pas » là où la file marche très
   * bien. On vide en PRENANT puis en fermant, parce qu'il n'existe aucun
   * autre chemin : la table est en ajout seul, et un `delete` y toucherait
   * zéro ligne en silence.
   */
  async function vider(): Promise<void> {
    for (;;) {
      const pris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
      if (!pris) return;
      await sousIdentite(a.id, async (db) =>
        inscrireIssue(db, {
          tenantId: orgA,
          travailId: pris.travailId,
          tentative: pris.tentative,
          nature: "erreur_technique",
          motif: "fermé par l'épreuve suivante",
        }),
      );
    }
  }

  async function nouveau(piece: string, cle: string): Promise<string> {
    const r = await sousIdentite(a.id, async (db) =>
      enregistrerTravail(db, {
        tenantId: orgA,
        pieceId: piece,
        nature: "lecture_piece",
        cleIdempotence: `${marque}-${cle}`,
      }),
    );
    return r.travailId;
  }

  before(async () => {
    const ca = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const cb = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(ca && cb, "les deux comptes doivent être créés");
    a = ca;
    b = cb;
    [orgA, pieceA] = await monter(a, "A");
    [orgB, pieceB] = await monter(b, "B");
    const url = process.env["DATABASE_URL_ADMIN"];
    assert.ok(url, "DATABASE_URL_ADMIN absente : R7 et la facturation ne sont pas éprouvés");
    admin = new pg.Pool({ connectionString: url });
  });

  after(async () => {
    if (BASE_CONFIGUREE && admin && orgA) {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1) and archived_at is null`,
        [[orgA, orgB]],
      );
      await admin.end();
    }
    await fermerLePool();
  });

  /* ------------------------------------------ 1. L'ACCUSÉ VIENT APRÈS L'ÉCRITURE */

  it("un travail enregistré deux fois sous la même clé n'en fait qu'un", async () => {
    const un = await sousIdentite(a.id, async (db) =>
      enregistrerTravail(db, {
        tenantId: orgA,
        pieceId: pieceA,
        nature: "lecture_piece",
        cleIdempotence: `${marque}-idem`,
      }),
    );
    const deux = await sousIdentite(a.id, async (db) =>
      enregistrerTravail(db, {
        tenantId: orgA,
        pieceId: pieceA,
        nature: "lecture_piece",
        cleIdempotence: `${marque}-idem`,
      }),
    );
    assert.equal(un.deja, false, "le premier enregistrement se dit déjà connu");
    assert.equal(deux.deja, true, "le second enregistrement crée un second travail");
    assert.equal(deux.travailId, un.travailId);

    // Et il est DURABLE : une autre transaction, plus tard, le lit.
    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, un.travailId));
    assert.equal(etat?.etat, "a_faire", "le travail n'est pas en base après son accusé");
    assert.equal(etat?.tentatives, 0);
  });

  /* ------------------------------------------------------------------- 2. R6 */

  it("une organisation ne voit ni les travaux ni l'état d'une autre", async () => {
    const travailA = await nouveau(pieceA, "r6");
    const vues = await sousIdentite(b.id, async (db) => {
      const t = await db.query(`select id from fabrique.travaux`);
      const e = await db.query(`select travail_id from fabrique.etat_des_travaux_v`);
      const f = await db.query(`select id from fabrique.travail_faits`);
      return [t.rows.length, e.rows.length, f.rows.length];
    });
    assert.deepEqual(vues, [0, 0, 0], "B lit les travaux de A");

    const sien = await sousIdentite(a.id, async (db) => etatDuTravail(db, travailA));
    assert.ok(sien, "A ne lit plus son propre travail");
  });

  it("une organisation n'enregistre pas un travail chez une autre", async () => {
    const refus = await refusDe(
      b.id,
      `insert into fabrique.travaux (tenant_id, piece_id, nature, cle_idempotence)
       values ($1, $2, 'lecture_piece', $3)`,
      [orgA, pieceA, `${marque}-intrus`],
    );
    assert.equal(refus.code, "42501", "B enregistre un travail dans le tenant de A");
  });

  it("un travail ne se rattache pas à la pièce d'une autre organisation", async () => {
    // La clé étrangère ne consulte aucune politique : sans garde, B
    // apprendrait l'existence de la pièce de A.
    const refus = await refusDe(
      b.id,
      `insert into fabrique.travaux (tenant_id, piece_id, nature, cle_idempotence)
       values ($1, $2, 'lecture_piece', $3)`,
      [orgB, pieceA, `${marque}-piece-intrus`],
    );
    assert.equal(refus.code, "42501", "B rattache un travail à la pièce de A");
  });

  it("un preneur ne prend pas le travail d'une autre organisation", async () => {
    const travail = await nouveau(pieceA, "pas-a-b");
    // La fonction de prise est `security invoker` : B lui passe le tenant de
    // A, et c'est la RLS de la VUE qui répond — zéro candidat. Rien n'est
    // pris, et rien n'est inscrit.
    const pris = await sousIdentite(b.id, async (db) => prendreUnTravail(db, orgA));
    assert.equal(pris, null, "B prend un travail de A");
    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "a_faire", "le travail de A a bougé sous l'identité de B");

    // Et s'il forçait l'inscription directement, la politique d'écriture le
    // refuse : le tenant de A n'est pas dans ses organisations.
    const refus = await refusDe(
      b.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
       values ($1, $2, 1, 'pris')`,
      [orgA, travail],
    );
    assert.equal(refus.code, "42501", "B inscrit une prise dans le tenant de A");
  });

  /* ------------------------------------------------------------------- 3. R7 */

  it("un travail et ses faits ne se réécrivent pas", async () => {
    await arreter("abandon_s", 900);
    await vider();
    const travail = await nouveau(await pieceDeplus("r7"), "r7");
    await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));

    const mutations: [string, string][] = [
      ["fabrique.travaux", `update fabrique.travaux set priorite = 9`],
      ["fabrique.travail_faits", `update fabrique.travail_faits set motif = 'reecrit'`],
    ];
    for (const [table, mutation] of mutations) {
      const touchees = await sousIdentite(a.id, async (db) => {
        const u = await db.query(mutation);
        const d = await db.query(mutation.replace(/^update (\S+) set .*/, "delete from $1"));
        return (u.rowCount ?? 0) + (d.rowCount ?? 0);
      });
      assert.equal(touchees, 0, `${table} laisse « authenticated » réécrire un fait`);
    }

    // Le refus d'`authenticated` est MUET — zéro ligne, aucune erreur. Le
    // déclencheur, lui, garde l'autre chemin : le propriétaire des tables.
    for (const [table, mutation] of mutations) {
      let code: string | null = null;
      try {
        await admin.query(mutation);
      } catch (erreur) {
        code = codeDe(erreur);
      }
      assert.equal(code, "23001", `${table} accepte un update du propriétaire : R7 ne tient pas`);
    }

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "en_cours", "l'état a bougé malgré le refus muet");
  });

  /* ------------------------------- 4. LA PRISE EST UN FAIT, PAS UN `UPDATE` */

  it("prendre un travail inscrit un fait, et la ligne rendue EST la preuve", async () => {
    await arreter("abandon_s", 900);
    await vider();
    const piece = await pieceDeplus("prise");
    const travail = await nouveau(piece, "prise");

    const pris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.ok(pris, "aucun travail pris alors qu'un travail est à faire");
    assert.equal(pris.travailId, travail);
    assert.equal(pris.tentative, 1);
    assert.equal(pris.pieceId, piece);

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "en_cours");
    assert.equal(etat?.tentatives, 1);
    assert.equal(etat?.prenable, false);

    const rien = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.equal(rien, null, "un travail en cours se reprend immédiatement");
  });

  it("deux preneurs, un seul travail : l'unicité de la tentative tranche", async () => {
    await arreter("abandon_s", 900);
    await vider();
    const piece = await pieceDeplus("course");
    const travail = await nouveau(piece, "course");

    const [un, deux] = await Promise.all([
      sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA)),
      sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA)),
    ]);
    const gagnants = [un, deux].filter((p) => p?.travailId === travail);
    assert.equal(gagnants.length, 1, "deux preneurs ont pris le même travail");

    const faits = await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from fabrique.travail_faits
          where travail_id = $1 and nature = 'pris'`,
        [travail],
      );
      return Number(rows[0]!.n);
    });
    assert.equal(faits, 1, "deux prises inscrites pour un seul travail");

    /*
     * ET LA GARANTIE EST NOMMÉE. Ce qui tranche au moment exact de la course
     * n'est ni un verrou ni un `update` : c'est un index unique PARTIEL sur
     * (travail_id, tentative) limité aux prises. Les deux preneurs voient le
     * même état, calculent la même tentative, l'inscrivent tous les deux, et
     * l'index en refuse un — avec `23505`, une erreur, pas un zéro muet.
     *
     * On le vérifie au catalogue plutôt que par une seconde insertion :
     * séquentiellement, c'est le garde d'état qui parle le premier (le
     * travail est « en cours », donc non prenable), et cette épreuve-là est
     * juste en dessous. Un index absent rendrait la course gagnable par les
     * deux sans que rien ne le dise.
     */
    const index = await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query<{ def: string }>(
        `select indexdef as def from pg_indexes
          where schemaname = 'fabrique' and indexname = 'fabrique_travail_faits_prise_ux'`,
      );
      return rows[0]?.def ?? "";
    });
    assert.match(index, /unique/i, "l'exclusion mutuelle des preneurs n'est pas un index unique");
    assert.match(index, /travail_id, tentative/, "l'index ne porte pas sur la tentative");
    assert.match(index, /WHERE \(nature = 'pris'/, "l'index ne se limite pas aux prises");

    // Séquentiellement, le garde d'état parle avant l'index : le travail est
    // en cours, personne ne le reprend.
    const refus = await refusDe(
      a.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
       values ($1, $2, 1, 'pris')`,
      [orgA, travail],
    );
    assert.equal(refus.code, "23514", "la deuxième prise de la tentative 1 passe");
    assert.match(refus.message, /en_cours/, "le refus ne dit pas pourquoi");
  });

  it("une pièce ne subit pas deux exécutions à la fois", async () => {
    await arreter("abandon_s", 900);
    await vider();
    const piece = await pieceDeplus("une-seule");
    await nouveau(piece, "une-seule-1");
    const second = await nouveau(piece, "une-seule-2");

    await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));

    const refus = await refusDe(
      a.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
       values ($1, $2, 1, 'pris')`,
      [orgA, second],
    );
    assert.match(
      refus.message,
      /execution/i,
      "un second travail se prend sur une pièce déjà en cours",
    );
  });

  /* --------------------------------------------- 5. L'INTERRUPTION SE REPREND */

  it("un travail pris puis abandonné redevient prenable sans intervention", async () => {
    // Le cabinet arrête un abandon immédiat : le processus est mort, et
    // personne ne vient le dire. C'est R10 — un défaut livré, surchargé.
    await arreter("abandon_s", 0);
    await vider();
    const piece = await pieceDeplus("reprise");
    const travail = await nouveau(piece, "reprise");

    const premier = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.equal(premier?.tentative, 1);

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(
      etat?.etat,
      "abandonne",
      "un travail pris et muet reste « en cours » pour toujours",
    );
    assert.equal(etat?.prenable, true);

    const second = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.equal(second?.travailId, travail);
    assert.equal(second?.tentative, 2, "la reprise n'ouvre pas une tentative nouvelle");

    // Et la première tentative est TOUJOURS là : rien n'a été effacé.
    const faits = await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query<{ tentative: number }>(
        `select tentative from fabrique.travail_faits
          where travail_id = $1 and nature = 'pris' order by tentative`,
        [travail],
      );
      return rows.map((r) => r.tentative);
    });
    assert.deepEqual(faits, [1, 2]);
  });

  it("les tentatives sont bornées, et la borne vient du référentiel", async () => {
    await arreter("abandon_s", 0);
    await arreter("tentatives_max", 2);
    await vider();
    const piece = await pieceDeplus("bornes");
    const travail = await nouveau(piece, "bornes");

    await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "epuise");
    assert.equal(etat?.prenable, false);

    const rien = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.equal(rien, null, "un travail épuisé se reprend sans fin");

    const refus = await refusDe(
      a.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
       values ($1, $2, 3, 'pris')`,
      [orgA, travail],
    );
    assert.match(refus.message, /epuise|2\/2/i, "la borne ne nomme pas ce qu'elle refuse");

    await arreter("tentatives_max", 3);
  });

  it("les bornes viennent du référentiel, se surchargent, et leur absence refuse", async () => {
    await arreter("repli_s", 7);
    const bornes = await sousIdentite(a.id, async (db) => bornesDeTravail(db, orgA));
    assert.deepEqual(
      Object.keys(bornes).sort(),
      ["abandon_s", "repli_s", "tentatives_max"],
      "les trois bornes du travail ne sortent pas ensemble",
    );
    assert.equal(bornes["repli_s"]?.valeur, 7);
    assert.equal(bornes["repli_s"]?.arreteParLeCabinet, true);
    assert.equal(bornes["tentatives_max"]?.arreteParLeCabinet, true);

    // Aucun repli implicite (R4) : une borne absente du référentiel lève.
    const client = await admin.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from ref.socle_params where code = 'fabrique.seuil.travail.abandon_s'`,
      );
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [a.id]);
      let message = "";
      try {
        await client.query(`select * from fabrique.bornes_de_travail($1)`, [orgA]);
      } catch (erreur) {
        message = (erreur as { message?: string }).message ?? "";
      }
      assert.match(message, /abandon_s/, "une borne absente se devine au lieu de refuser");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  /* ------------------------------------------- 6. LES TROIS NATURES D'ÉCHEC */

  it("un refus métier ferme le travail : ce n'est pas une panne", async () => {
    await arreter("abandon_s", 0);
    await vider();
    const piece = await pieceDeplus("refus");
    const travail = await nouveau(piece, "refus");
    const pris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.ok(pris);

    await sousIdentite(a.id, async (db) =>
      inscrireIssue(db, {
        tenantId: orgA,
        travailId: travail,
        tentative: pris.tentative,
        nature: "refus_metier",
        motif: "plafond_atteint",
      }),
    );

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "refuse");
    assert.equal(
      etat?.prenable,
      false,
      "un refus métier se rejoue : le plafond serait retesté sans fin",
    );
    assert.equal(etat?.dernierMotif, "plafond_atteint");
  });

  it("une panne fournisseur se réessaie, après le délai de repli du référentiel", async () => {
    await arreter("repli_s", 0);
    await arreter("abandon_s", 900);
    await vider();
    const piece = await pieceDeplus("panne");
    const travail = await nouveau(piece, "panne");
    const pris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.ok(pris);
    await sousIdentite(a.id, async (db) =>
      inscrireIssue(db, {
        tenantId: orgA,
        travailId: travail,
        tentative: pris.tentative,
        nature: "panne_fournisseur",
        motif: "le modèle n'a pas répondu",
      }),
    );

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "en_panne");
    assert.equal(etat?.prenable, true);

    const repris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.equal(repris?.travailId, travail);
    assert.equal(repris?.tentative, 2);
  });

  it("une erreur technique ne se réessaie pas en boucle", async () => {
    await arreter("repli_s", 0);
    await arreter("abandon_s", 900);
    await vider();
    const piece = await pieceDeplus("technique");
    const travail = await nouveau(piece, "technique");
    const pris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.ok(pris);
    await sousIdentite(a.id, async (db) =>
      inscrireIssue(db, {
        tenantId: orgA,
        travailId: travail,
        tentative: pris.tentative,
        nature: "erreur_technique",
        motif: "TypeError: read of undefined",
      }),
    );

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "en_erreur");
    assert.equal(etat?.prenable, false, "un défaut de notre code se rejoue en boucle");
  });

  it("un échec sans motif est refusé, et une issue sans prise aussi", async () => {
    const piece = await pieceDeplus("motif");
    const travail = await nouveau(piece, "motif");

    const sansMotif = await refusDe(
      a.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
       values ($1, $2, 1, 'panne_fournisseur')`,
      [orgA, travail],
    );
    assert.equal(sansMotif.code, "23514", "un échec sans motif est une tâche oubliée déguisée");

    const sansPrise = await refusDe(
      a.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature, motif)
       values ($1, $2, 1, 'panne_fournisseur', 'sans prise')`,
      [orgA, travail],
    );
    assert.match(sansPrise.message, /prise/i, "une issue s'inscrit sans que rien n'ait été pris");
  });

  it("une tentative utile ne s'efface pas : après « terminé », rien ne se rejoue", async () => {
    await arreter("abandon_s", 900);
    await arreter("repli_s", 0);
    await vider();
    const piece = await pieceDeplus("garde");
    const travail = await nouveau(piece, "garde");
    const pris = await sousIdentite(a.id, async (db) => prendreUnTravail(db, orgA));
    assert.ok(pris);
    await sousIdentite(a.id, async (db) =>
      inscrireIssue(db, {
        tenantId: orgA,
        travailId: travail,
        tentative: pris.tentative,
        nature: "termine",
      }),
    );

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "termine");
    assert.equal(etat?.prenable, false);

    const refus = await refusDe(
      a.id,
      `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
       values ($1, $2, 2, 'pris')`,
      [orgA, travail],
    );
    assert.match(
      refus.message,
      /termine|prenable/i,
      "un secours part après coup et peut écraser une extraction exploitable",
    );
  });

  /* -------------------------------------- 7. LE COUREUR, ET SA QUALIFICATION */

  it("le coureur prend, exécute, inscrit — et qualifie l'échec sans le confondre", async () => {
    await arreter("abandon_s", 900);
    await arreter("repli_s", 0);
    await vider();
    const piece = await pieceDeplus("coureur");
    const travail = await nouveau(piece, "coureur");

    const avecBase = <T>(travailDb: (db: Requete) => Promise<T>): Promise<T> =>
      sousIdentite(a.id, travailDb);

    const panne = await executerUnTravail(avecBase, orgA, async () => {
      throw new PanneFournisseur("le modèle n'a pas répondu");
    });
    assert.deepEqual(
      [panne?.travailId, panne?.issue],
      [travail, "panne_fournisseur"],
      "le coureur confond une panne avec autre chose",
    );

    const refus = await executerUnTravail(avecBase, orgA, async () => {
      throw new RefusMetier("piece_personnelle");
    });
    assert.deepEqual([refus?.travailId, refus?.issue], [travail, "refus_metier"]);

    const etat = await sousIdentite(a.id, async (db) => etatDuTravail(db, travail));
    assert.equal(etat?.etat, "refuse");

    const rien = await executerUnTravail(avecBase, orgA, async () => undefined);
    assert.equal(rien, null, "le coureur invente un travail là où il n'y en a pas");
  });

  it("une erreur quelconque est technique : on ne la rejoue pas par optimisme", () => {
    assert.equal(qualifierEchec(new TypeError("x is not a function")), "erreur_technique");
    assert.equal(qualifierEchec(new PanneFournisseur("504")), "panne_fournisseur");
    assert.equal(qualifierEchec(new RefusMetier("plafond_atteint")), "refus_metier");
    // Le refus de la chaîne de lecture est un refus métier, reconnu à son nom
    // pour ne pas tirer la chaîne payante dans la file.
    const lecture = new Error("plafond_atteint");
    lecture.name = "LectureRefusee";
    assert.equal(qualifierEchec(lecture), "refus_metier");
  });

  /* ------------------------------------ 8. L'ARGENT NE SE COMPTE QU'UNE FOIS */

  it("deux exécutions de la même pièce ne comptent qu'une lecture", async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, 'basic', date '2026-10-17') returning id`,
      [a.id],
    );
    await admin.query(
      `insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)`,
      [rows[0]!.id, orgA],
    );

    const piece = await pieceDeplus("argent");
    const comptees = async (): Promise<number> => {
      const r = await admin.query<{ n: string }>(
        `select count(*) as n from facturation.lectures where piece_id = $1`,
        [piece],
      );
      return Number(r.rows[0]!.n);
    };
    const consommer = async (): Promise<string> =>
      sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{ v: { motif: string; autorisee: boolean } }>(
          `select public.lecture_consommer($1) as v`,
          [piece],
        );
        return rows[0]!.v.motif;
      });

    assert.equal(await comptees(), 0);
    // La porte rend le verdict d'APRÈS son écriture : « relecture_gratuite »
    // dès le premier passage, parce que la pièce est désormais comptée.
    assert.equal(await consommer(), "relecture_gratuite");
    assert.equal(await comptees(), 1);
    assert.equal(await consommer(), "relecture_gratuite");
    assert.equal(await comptees(), 1, "un rejeu facture la pièce deux fois");
  });

  it("la file n'écrit jamais dans facturation.lectures", async () => {
    // `lecture_consommer` est la seule porte : la file ne la contourne pas,
    // et elle n'en a même pas le droit.
    const refus = await refusDe(
      a.id,
      `insert into facturation.lectures (tenant_id, licence_id, piece_id, periode)
       values ($1, gen_random_uuid(), $2, date '2026-10-18')`,
      [orgA, pieceB],
    );
    assert.equal(refus.code, "42501", "« authenticated » écrit encore dans facturation.lectures");
  });
});
