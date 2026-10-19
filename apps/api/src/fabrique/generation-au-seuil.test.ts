/**
 * Ce qui met la fabrique EN MARCHE — éprouvé, pas relu.
 *
 * `02-ce-qui-est-livre.md`, limite 6 : « Rien ne déclenche une génération en
 * production. » Ce banc est la preuve que ce n'est plus vrai, et il porte les
 * quatre garanties que la limite réclamait :
 *
 *   le seuil    la génération se propose AU seuil et PAS AVANT, et le seuil
 *               vient du référentiel — datable, surchargeable par cabinet,
 *               et son absence REFUSE au lieu de deviner (R4, R10) ;
 *   une fois    deux propositions pour le même format ne font qu'un travail.
 *               Ce n'est pas un `if` applicatif : c'est l'index unique de la
 *               file, et le perdant reçoit zéro ligne ;
 *   l'argent    une génération exécutée laisse une ligne dans
 *               `agents.agent_runs`, avec son couple (modèle, rôle) et son
 *               coût. Vérifié EN BASE, pas par le fait qu'on a appelé ;
 *   la nature   un exécuteur de générations ne prend pas une lecture, et
 *               réciproquement. Sans ce filtre, la file ferait lire une
 *               génération.
 *
 * Tout passe par `sousIdentite` — rôle `authenticated`, claim `sub` posé dans
 * la transaction — et par le DÉPÔT, jamais par les fonctions nues : ce que
 * personne n'appelle n'est pas éprouvé.
 *
 * Aucun fournisseur payant : le générateur reçoit un adaptateur SIMULÉ.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/generation-au-seuil.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite, type Requete } from "../db.ts";
import { fabrique } from "../depots/fabrique.ts";
import { MODELE_GENERATION, ROLE_GENERATION } from "../malica/modeles.ts";

import { type AppelDeGenerateur } from "./generateur.ts";
import { VERSION_DU_LANGAGE } from "./recette.ts";
import {
  FACTURE_A,
  FACTURE_A_AUTRE_CLIENT,
  FACTURE_A_AUTRES_VALEURS,
} from "./signature-plans-synthetiques.ts";
import { executerUneGeneration } from "./travail-de-generation.ts";
import { executerUnTravail } from "./travaux-execution.ts";
import {
  enregistrerTravail,
  inscrireIssue,
  prendreUnTravail,
  proposerUneGeneration,
} from "./travaux.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Le total HT, désigné par le libellé qui sépare les trois lignes du pied. */
const RECETTE_HT: unknown = {
  version: VERSION_DU_LANGAGE,
  sens_de_lecture: "ltr",
  chiffres: "latins",
  ancres: {
    ht: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "HT" } },
      prendre: { genre: "unique" },
    },
  },
  champs: {
    "totals.base_ht": {
      designation: {
        depuis: { genre: "voisin", de: "ht", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "premier" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
};

/** Combien de fois le modèle a été appelé — un appel payant se compte. */
let appels = 0;

const modeleSimule: AppelDeGenerateur = () => {
  appels += 1;
  return Promise.resolve({
    recetteProposee: RECETTE_HT,
    modele: MODELE_GENERATION,
    role: ROLE_GENERATION,
    tokensIn: 2400,
    tokensOut: 620,
    latenceMs: 18000,
  });
};

/** Le jeton qui porte ce texte, dans ce plan. */
function ou(plan: readonly PageToken[], texte: string): TokenRef {
  const t = plan.find((x) => x.text === texte);
  assert.ok(t, `le plan synthétique ne porte pas « ${texte} »`);
  return { page: t.page, ordinal: t.ordinal };
}

describe(
  "la génération se déclenche au seuil, et une seule fois",
  { skip: !BASE_CONFIGUREE },
  () => {
    const marque = `gen-${Date.now()}`;
    const signatureCle = `facture-seuil-${marque}`;
    let a: Utilisateur;
    let b: Utilisateur;
    let orgA = "";
    let orgB = "";
    let admin: pg.Pool;
    const pieces = new Map<string, string>();
    const plans = new Map<string, PageToken[]>();

    async function deposer(
      db: Requete,
      org: string,
      nom: string,
      plan: PageToken[],
    ): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
       values ($1, 'pdf', 'partage', $2, $3) returning id`,
        [org, `essai/${marque}-${nom}.pdf`, `${marque}-${nom}`],
      );
      const pieceId = rows[0]!.id;
      for (const t of plan) {
        await db.query(
          `insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text, x0, y0, x1, y1)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [org, pieceId, t.page, t.ordinal, t.text, t.x0, t.y0, t.x1, t.y1],
        );
      }
      pieces.set(nom, pieceId);
      plans.set(nom, plan);
      return pieceId;
    }

    /** Qualifie un exemple d'APPRENTISSAGE par le vrai chemin : le dépôt. */
    async function qualifier(nom: string, total: string): Promise<string | null> {
      return sousIdentite(a.id, async (db) => {
        const fait = await fabrique.qualifierUnExemple(db, {
          tenantId: orgA,
          pieceId: pieces.get(nom),
          signatureCle,
          provenance: "validation_humaine",
          qualification: "designation_champ",
          usage: "apprentissage",
          attendu: { "totals.base_ht": ou(plans.get(nom)!, total) },
        });
        return fait.generationProposee;
      });
    }

    /** Les travaux de génération de ce format, vus par A. */
    async function travauxDeGeneration(): Promise<string[]> {
      return sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select id from fabrique.travaux
          where tenant_id = $1 and nature = 'generation_recette' and signature_cle = $2`,
          [orgA, signatureCle],
        );
        return rows.map((r) => r.id);
      });
    }

    before(async () => {
      const ca = await creerCompte(`gena-${marque}@essai.local`, "MotDePasseTresLong2026!");
      const cb = await creerCompte(`genb-${marque}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(ca && cb, "les deux comptes doivent être créés");
      a = ca;
      b = cb;

      await sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{ org: string }>(
          `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
          ["pme", `ESSAI ${marque} A`, "autonome", "TN", "TND"],
        );
        orgA = rows[0]!.org;
        await deposer(db, orgA, "a", FACTURE_A());
        await deposer(db, orgA, "autre_client", FACTURE_A_AUTRE_CLIENT());
        await deposer(db, orgA, "autres_valeurs", FACTURE_A_AUTRES_VALEURS());
        /*
         * Le cabinet arrête sa borne d'ancre, au-dessus du défaut livré (R10) :
         * trois lignes du pied portent « Total », et ce qui les sépare — « HT »,
         * « TTC » — fait deux caractères. C'est la limite 4 de la livraison, et
         * c'est exactement l'usage prévu du paramétrage.
         */
        await db.query(
          `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, 'fabrique.seuil.recette.ancre_texte_min', 2,
                 'les libellés de pied font deux caractères : HT, TTC')
         on conflict (tenant_id, code) do nothing`,
          [orgA],
        );
      });

      await sousIdentite(b.id, async (db) => {
        const { rows } = await db.query<{ org: string }>(
          `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
          ["pme", `ESSAI ${marque} B`, "autonome", "TN", "TND"],
        );
        orgB = rows[0]!.org;
      });

      const url = process.env["DATABASE_URL_ADMIN"];
      assert.ok(url, "DATABASE_URL_ADMIN absente : l'absence d'une borne n'est pas éprouvée");
      admin = new pg.Pool({ connectionString: url });
    });

    after(async () => {
      // On archive, on ne supprime pas : R7 tient `audit.event_log`.
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

    /* ------------------------------------------------- 1. LE SEUIL, ET PAS AVANT */

    it("le seuil livré est dans le référentiel, et son absence refuse", async () => {
      const bornes = await sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{
          borne: string;
          valeur: string;
          arrete_par_le_cabinet: boolean;
        }>(`select * from fabrique.bornes_de_generation($1)`, [orgA]);
        return rows;
      });
      assert.deepEqual(
        bornes.map((b) => b.borne),
        ["pieces_min"],
        "la borne de génération ne sort pas du référentiel",
      );
      assert.equal(
        Number(bornes[0]!.valeur),
        3,
        "le défaut livré n'est plus trois : documentez-le",
      );
      assert.equal(bornes[0]!.arrete_par_le_cabinet, false);

      // Aucun repli implicite (R4) : une borne absente LÈVE.
      const client = await admin.connect();
      try {
        await client.query("begin");
        await client.query(
          `delete from ref.socle_params where code = 'fabrique.seuil.generation.pieces_min'`,
        );
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [a.id]);
        let message = "";
        try {
          await client.query(`select fabrique.generation_proposer($1, $2)`, [orgA, signatureCle]);
        } catch (erreur) {
          message = (erreur as { message?: string }).message ?? "";
        }
        assert.match(message, /pieces_min/, "une borne absente se devine au lieu de refuser");
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    });

    it("deux exemples ne déclenchent rien : le seuil livré en demande trois", async () => {
      assert.equal(await qualifier("a", "1180,000"), null, "un exemple a déclenché une génération");
      assert.equal(await qualifier("autre_client", "708,000"), null);
      assert.deepEqual(await travauxDeGeneration(), [], "la génération part sous le seuil");
    });

    it("au troisième exemple, la génération entre dans la file", async () => {
      const travail = await qualifier("autres_valeurs", "3940,000");
      assert.ok(travail, "le seuil est atteint et rien n'est en file : la fabrique reste inerte");
      assert.deepEqual(await travauxDeGeneration(), [travail]);

      const etat = await sousIdentite(a.id, async (db) => fabrique.etatDeLaLecture(db, travail));
      assert.equal(etat?.etat, "a_faire", "le travail de génération n'est pas prenable");
      assert.equal(etat?.nature, "generation_recette");
    });

    /* ------------------------------------------------------- 2. JAMAIS DEUX FOIS */

    it("deux propositions pour le même format ne font qu'un travail", async () => {
      const encore = await sousIdentite(a.id, async (db) =>
        proposerUneGeneration(db, orgA, signatureCle),
      );
      assert.equal(encore, null, "une seconde proposition a mis une seconde génération en file");
      assert.equal(
        (await travauxDeGeneration()).length,
        1,
        "deux travaux pour un format : la génération se paierait deux fois",
      );
    });

    /* ------------------------------------------------------------------ 3. R6 */

    it("une organisation ne propose pas une génération chez une autre", async () => {
      const vu = await sousIdentite(b.id, async (db) =>
        proposerUneGeneration(db, orgA, signatureCle),
      );
      assert.equal(vu, null, "B a proposé une génération chez A");
      const chezB = await sousIdentite(b.id, async (db) => {
        const { rows } = await db.query(`select id from fabrique.travaux`);
        return rows.length;
      });
      assert.equal(chezB, 0, "B voit les travaux de A");
    });

    /* ------------------------------------- 4. LA NATURE DÉCIDE CE QU'ON PREND */

    it("un exécuteur de lectures ne prend pas une génération", async () => {
      const pris = await sousIdentite(a.id, async (db) =>
        prendreUnTravail(db, orgA, ["lecture_piece"]),
      );
      assert.equal(pris, null, "une génération a été prise par un exécuteur de lectures");
    });

    /* ------------------------ 5. L'EXÉCUTION : LE JOURNAL, PUIS LA CANDIDATE */

    it("la file exécute la génération, la journalise en base, et inscrit une candidate", async () => {
      const avecBase = <T>(travail: (db: Requete) => Promise<T>): Promise<T> =>
        sousIdentite(a.id, travail);

      const avant = appels;
      const fait = await executerUnTravail(avecBase, orgA, ["generation_recette"], async (t) => {
        assert.equal(t.nature, "generation_recette");
        assert.equal(t.signatureCle, signatureCle, "le travail ne porte pas le format visé");
        await executerUneGeneration(
          avecBase,
          { tenantId: orgA, signatureCle: t.signatureCle! },
          modeleSimule,
        );
      });
      assert.equal(fait?.issue, "termine", `la génération a échoué : ${fait?.motif ?? ""}`);
      assert.equal(appels - avant, 1, "le modèle a été appelé plus d'une fois pour une génération");

      /*
       * LA PREUVE EN BASE, et c'est elle qui compte : « un couple absent fait
       * refuser l'écriture du journal en silence », et ce défaut a coûté dix
       * jours de mesures à ce dépôt. On ne se contente pas d'avoir appelé.
       */
      const journal = await sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{
          agent: string;
          model: string;
          cost: string;
          tokens_in: number;
          status: string;
        }>(
          `select agent, model, cost, tokens_in, status from public.agent_runs_v
          where tenant_id = $1 and agent = 'fabrique.generateur'
          order by created_at desc limit 1`,
          [orgA],
        );
        return rows[0] ?? null;
      });
      assert.ok(journal, "la génération n'a laissé aucune ligne : la dépense disparaît en silence");
      assert.equal(journal.model, MODELE_GENERATION);
      assert.equal(journal.status, "ok");
      assert.equal(journal.tokens_in, 2400);
      assert.ok(Number(journal.cost) > 0, "la génération a coûté zéro : le tarif n'a pas été lu");

      /* Et la candidate est là, née du générateur, dans l'état « candidate ». */
      const recettes = await sousIdentite(a.id, async (db) => fabrique.recettes(db, orgA));
      const sienne = recettes.filter((r) => r.signatureCle === signatureCle);
      assert.equal(sienne.length, 1, "la génération n'a pas inscrit de candidate");
      assert.equal(
        sienne[0]!.etat,
        "candidate",
        "une génération promeut : elle ne doit que proposer",
      );
      assert.equal(sienne[0]!.exemples, 3, "la candidate ne porte pas ses trois exemples");
    });

    it("une génération refusée se journalise quand même, et ferme le travail", async () => {
      /*
       * Un appel refusé a coûté autant qu'un appel retenu. Le refus choisi est
       * le plus net : le modèle rend autre chose qu'un objet.
       */
      const piece = pieces.get("a")!;
      const travail = await sousIdentite(a.id, async (db) =>
        db
          .query<{ id: string }>(
            `insert into fabrique.travaux
             (tenant_id, piece_id, nature, cle_idempotence, signature_cle)
           values ($1, $2, 'generation_recette', $3, $4) returning id`,
            // Le MEME format : il porte ses trois exemples, donc le modele est
            // bel et bien appele, et c'est sa reponse qu'on refuse.
            [orgA, piece, `${marque}-refus`, signatureCle],
          )
          .then((r) => r.rows[0]!.id),
      );

      const avecBase = <T>(t: (db: Requete) => Promise<T>): Promise<T> => sousIdentite(a.id, t);
      const avant = await compterLesLignes(orgA);
      const fait = await executerUnTravail(avecBase, orgA, ["generation_recette"], async (t) => {
        await executerUneGeneration(
          avecBase,
          { tenantId: orgA, signatureCle: t.signatureCle! },
          () =>
            Promise.resolve({
              recetteProposee: "ceci n'est pas une recette",
              modele: MODELE_GENERATION,
              role: ROLE_GENERATION,
              tokensIn: 2400,
              tokensOut: 12,
              latenceMs: 900,
            }),
        );
      });
      assert.equal(fait?.travailId, travail);
      assert.equal(
        fait?.issue,
        "refus_metier",
        `un refus du générateur se rejouerait sans fin — motif : ${fait?.motif ?? ""}`,
      );
      assert.match(fait?.motif ?? "", /REPONSE_ILLISIBLE/, "le motif ne nomme pas le refus");
      assert.equal(
        await compterLesLignes(orgA),
        avant + 1,
        "un appel refusé ne se journalise pas : la dépense disparaît",
      );

      const etat = await sousIdentite(a.id, async (db) => fabrique.etatDeLaLecture(db, travail));
      assert.equal(etat?.etat, "refuse");
    });

    it("un travail de lecture reste pris par un exécuteur de lectures", async () => {
      // Le filtre de nature n'a pas fermé la porte d'origine.
      const piece = pieces.get("autre_client")!;
      const { travailId } = await sousIdentite(a.id, async (db) =>
        enregistrerTravail(db, {
          tenantId: orgA,
          pieceId: piece,
          nature: "lecture_piece",
          cleIdempotence: `${marque}-lecture`,
        }),
      );
      const pris = await sousIdentite(a.id, async (db) =>
        prendreUnTravail(db, orgA, ["lecture_piece"]),
      );
      assert.equal(pris?.travailId, travailId);
      assert.equal(pris?.signatureCle, null, "une lecture porte un format : elle vise une pièce");
      await sousIdentite(a.id, async (db) =>
        inscrireIssue(db, {
          tenantId: orgA,
          travailId,
          tentative: pris!.tentative,
          nature: "erreur_technique",
          motif: "fermé par l'épreuve : aucune lecture n'est jouée ici",
        }),
      );
    });

    /* ----------------------------------------------------- 6. R10, LE DÉFAUT SE CHANGE */

    it("le cabinet change le seuil sans déploiement", async () => {
      const cle = `facture-deux-${marque}`;
      await sousIdentite(a.id, async (db) => {
        await db.query(
          `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, 'fabrique.seuil.generation.pieces_min', 2, 'ce cabinet propose plus tôt')
         on conflict (tenant_id, code) do update set value_num = excluded.value_num`,
          [orgA],
        );
      });

      const arrete = await sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{ valeur: string; arrete_par_le_cabinet: boolean }>(
          `select valeur, arrete_par_le_cabinet from fabrique.bornes_de_generation($1)`,
          [orgA],
        );
        return rows[0]!;
      });
      assert.equal(Number(arrete.valeur), 2);
      assert.equal(arrete.arrete_par_le_cabinet, true, "qui a décidé ce seuil n'est pas lisible");

      // Deux exemples d'un autre format, et cette fois la proposition part.
      for (const [nom, total] of [
        ["a", "1180,000"],
        ["autre_client", "708,000"],
      ] as const) {
        await sousIdentite(a.id, async (db) => {
          await fabrique.qualifierUnExemple(db, {
            tenantId: orgA,
            pieceId: pieces.get(nom),
            signatureCle: cle,
            provenance: "validation_humaine",
            qualification: "designation_champ",
            usage: "apprentissage",
            attendu: { "totals.base_ht": ou(plans.get(nom)!, total) },
          });
        });
      }
      const mis = await sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select id from fabrique.travaux
          where tenant_id = $1 and nature = 'generation_recette' and signature_cle = $2`,
          [orgA, cle],
        );
        return rows.map((r) => r.id);
      });
      assert.equal(mis.length, 1, "le seuil arrêté par le cabinet n'est pas celui qui décide");
    });

    /** Les lignes de journal du générateur, pour cette organisation. */
    async function compterLesLignes(org: string): Promise<number> {
      return sousIdentite(a.id, async (db) => {
        const { rows } = await db.query<{ n: string }>(
          `select count(*) as n from public.agent_runs_v
          where tenant_id = $1 and agent = 'fabrique.generateur'`,
          [org],
        );
        return Number(rows[0]!.n);
      });
    }
  },
);
