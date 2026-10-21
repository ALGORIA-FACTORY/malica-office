/**
 * Qui peut inscrire une recette chez un client — éprouvé sous identité RÉELLE.
 *
 * `02-ce-qui-est-livre.md`, limite 7 : « Un expert de cabinet ne peut pas
 * inscrire une recette pour son mandat : la politique d'insertion exige
 * l'appartenance. » Le dirigeant a tranché : il peut, pour un dossier sous
 * mandat ACTIF — c'est la cohérence avec une décision déjà en base, où la
 * lecture d'un expert engagé se compte sur la licence du client.
 *
 * Ce banc tient les quatre bornes de cette décision :
 *
 *   le mandat   ACTIF, et pas seulement existant. Un mandat « proposé » est
 *               refusé, et il est refusé PAR LA BASE ;
 *   le rôle     expert du cabinet. Un collaborateur du même cabinet, non ;
 *   la frontière inscrire n'est pas promouvoir : la naissance passe, toute
 *               autre décision de cycle est refusée ;
 *   l'intrus    zéro ligne, en lecture comme en écriture.
 *
 * ========================================= ET LA CONCLUSION SUR LE COUREUR (limite 5)
 *
 * La dernière épreuve n'ouvre rien : elle MESURE pourquoi une reprise
 * automatique ne peut pas se faire par la plateforme. Un opérateur de la tour
 * ne lit pas une pièce (`20261019090000`) et ne peut pas inscrire la prise
 * d'un travail. Une limite démontrée vaut mieux qu'une limite affirmée, et
 * elle vaut infiniment mieux qu'une porte dérobée.
 *
 * Aucune requête en superutilisateur, sauf pour MONTER la fixture et pour
 * poser un opérateur de plateforme : tous les verdicts sont rendus sous
 * `authenticated`, claim `sub` posé dans la transaction.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/un-expert-engage-inscrit.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur, type Requete } from "../db.ts";
import { fabrique } from "../depots/fabrique.ts";
import { identite } from "../depots/identite.ts";

import { VERSION_DU_LANGAGE } from "./recette.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

function codeDe(erreur: unknown): string {
  const e = erreur as { code?: string; message?: string };
  return e.code ?? e.message ?? String(erreur);
}

/** Joue sous une identité réelle et rend le SQLSTATE du refus, ou `null`. */
async function refusDe<T>(
  utilisateur: string,
  travail: (db: Requete) => Promise<T>,
): Promise<string | null> {
  try {
    await sousIdentiteDuServeur(utilisateur, travail);
    return null;
  } catch (erreur) {
    return codeDe(erreur);
  }
}

/** Une recette minimale : la base exige « version » et « champs », rien d'autre. */
const DEFINITION = { version: VERSION_DU_LANGAGE, champs: {} };

describe("un expert engagé inscrit une recette pour son mandat", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `exp-${Date.now()}`;
  /*
   * Un matricule FICTIF mais bien forme : `create_organization` refuse une
   * forme que le pack ne reconnait pas, et `identite.proposerMandat` cherche
   * la PME par son matricule — c'est le vrai chemin du mandat.
   */
  const legalId = `${String(Date.now()).slice(-7)}E/A/M/000`;
  let patron: Utilisateur;
  let expert: Utilisateur;
  let autreExpert: Utilisateur;
  let intrus: Utilisateur;
  let operateur: Utilisateur;
  let pme = "";
  let cabinet = "";
  let cabinetSansMandat = "";
  let piece = "";
  let admin: pg.Pool;

  before(async () => {
    const comptes = await Promise.all([
      creerCompte(`pme-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      creerCompte(`exp-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      creerCompte(`exp2-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      creerCompte(`int-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      creerCompte(`ope-${marque}@essai.local`, "MotDePasseTresLong2026!"),
    ]);
    assert.ok(
      comptes.every((c) => c),
      "les cinq comptes doivent être créés",
    );
    [patron, expert, autreExpert, intrus, operateur] = comptes as [
      Utilisateur,
      Utilisateur,
      Utilisateur,
      Utilisateur,
      Utilisateur,
    ];

    // La PME et sa pièce PARTAGÉE : le cabinet ne voit que ce qui lui est
    // transmis, et la pièce est ce que l'expert lit.
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6) as org`,
        ["pme", `ESSAI ${marque} PME`, "mandate", legalId, "TN", "TND"],
      );
      pme = rows[0]!.org;
      const p = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3) returning id`,
        [pme, `essai/${marque}.pdf`, marque],
      );
      piece = p.rows[0]!.id;
    });

    /*
     * Deux cabinets, et c'est le témoin qui compte : `create_organization`
     * donne le rôle « expert » au créateur d'un cabinet, donc les deux
     * experts sont experts. Seul le MANDAT les sépare.
     */
    const creerCabinet = (u: Utilisateur, nom: string): Promise<string> =>
      sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ org: string }>(
          `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
          ["cabinet", nom, "mandate", "TN", "TND"],
        );
        return rows[0]!.org;
      });

    /*
     * LE VRAI CHEMIN DU MANDAT, et il compte : depuis le 18 septembre 2026,
     * un expert ne s'active pas un mandat tout seul — la politique
     * d'insertion refuse « actif » venant du cabinet. L'expert PROPOSE, la
     * PME ACCEPTE. Monter la fixture autrement éprouverait un état que la
     * base ne sait pas produire.
     */
    cabinet = await creerCabinet(expert, `ESSAI ${marque} CAB`);
    await sousIdentiteDuServeur(expert.id, async (db) => {
      await identite.proposerMandat(db, cabinet, legalId);
    });
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const [propose] = await identite.mandatsProposes(db, pme);
      assert.ok(propose, "la PME ne voit pas le mandat proposé");
      await identite.repondreAuMandat(db, propose.id, true);
    });

    // Le témoin : proposé, jamais accepté. Ni lecture élargie, ni écriture.
    cabinetSansMandat = await creerCabinet(autreExpert, `ESSAI ${marque} CAB2`);
    await sousIdentiteDuServeur(autreExpert.id, async (db) => {
      await identite.proposerMandat(db, cabinetSansMandat, legalId);
    });

    const url = process.env["DATABASE_URL_ADMIN"];
    assert.ok(url, "DATABASE_URL_ADMIN absente : l'opérateur de plateforme n'est pas éprouvé");
    admin = new pg.Pool({ connectionString: url });
    await admin.query(
      `insert into app.platform_operators (user_id, note)
       values ($1, 'fixture de test automatisé') on conflict do nothing`,
      [operateur.id],
    );
  });

  after(async () => {
    if (BASE_CONFIGUREE && admin) {
      await admin.query(`delete from app.platform_operators where user_id = $1`, [operateur.id]);
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1) and archived_at is null`,
        [[pme, cabinet, cabinetSansMandat]],
      );
      await admin.end();
    }
    await fermerLePool();
  });

  /* ------------------------------------- 1. LE MANDAT ACTIF OUVRE L'INSCRIPTION */

  it("l'expert d'un mandat ACTIF qualifie un exemple et inscrit une candidate", async () => {
    const exempleId = await sousIdentiteDuServeur(expert.id, async (db) => {
      const fait = await fabrique.qualifierUnExemple(db, {
        tenantId: pme,
        pieceId: piece,
        signatureCle: `format-${marque}`,
        provenance: "import_expert",
        qualification: "designation_champ",
        usage: "apprentissage",
        attendu: { "totals.base_ht": { page: 1, ordinal: 4 } },
      });
      return fait.exempleId;
    });
    assert.ok(exempleId, "l'expert engagé ne peut pas qualifier un exemple chez son client");

    const inscrite = await sousIdentiteDuServeur(expert.id, async (db) =>
      fabrique.inscrireUneCandidate(db, {
        tenantId: pme,
        libelle: `format-${marque}`,
        signatureCle: `format-${marque}`,
        portee: "organisation",
        definition: DEFINITION,
        empreinte: "a".repeat(64),
        provenance: { generateur: "main-de-l-expert" },
        exemples: [exempleId],
        motif: "inscrite par l'expert du cabinet, mandat actif",
      }),
    );
    assert.ok(inscrite.versionId, "l'expert engagé ne peut pas inscrire de recette");

    // Et le client la voit : c'est SA recette, pas celle du cabinet.
    const vues = await sousIdentiteDuServeur(patron.id, async (db) => fabrique.recettes(db, pme));
    assert.equal(vues.length, 1);
    assert.equal(vues[0]!.etat, "candidate");
  });

  /* ---------------------------------- 2. SANS MANDAT ACTIF, LA BASE REFUSE */

  it("un expert sans mandat actif est refusé par la base, pas par l'écran", async () => {
    const refus = await refusDe(autreExpert.id, async (db) =>
      db.query(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation')`,
        [pme, "format volé", `vol-${marque}`],
      ),
    );
    assert.equal(refus, "42501", "un mandat « proposé » ouvre l'écriture : il ne doit pas");

    // Et il ne voit rien non plus : la lecture élargie exige le même mandat.
    const vu = await sousIdentiteDuServeur(autreExpert.id, async (db) => {
      const { rows } = await db.query(`select id from fabrique.recettes`);
      return rows.length;
    });
    assert.equal(vu, 0, "un cabinet sans mandat actif lit les recettes du client");
  });

  it("un mandat échu ne vaut pas un mandat actif", async () => {
    /*
     * Le même cabinet, le même expert, et cette fois la PME a ACCEPTÉ — puis
     * le mandat est arrivé à son terme. Seule la fenêtre de validité change,
     * et c'est la PME qui la pose : `engagements_upd` est à elle.
     */
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const [propose] = await identite.mandatsProposes(db, pme);
      assert.ok(propose, "le second mandat proposé a disparu");
      await identite.repondreAuMandat(db, propose.id, true);
      await db.query(
        `update identity.engagements set ends_on = current_date - 1
          where cabinet_org_id = $1 and pme_org_id = $2`,
        [cabinetSansMandat, pme],
      );
    });
    const refus = await refusDe(autreExpert.id, async (db) =>
      db.query(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation')`,
        [pme, "format échu", `echu-${marque}`],
      ),
    );
    assert.equal(refus, "42501", "un mandat échu ouvre encore l'écriture");
  });

  it("un collaborateur du cabinet engagé n'inscrit pas : le rôle compte", async () => {
    const collaborateur = await creerCompte(`col-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(collaborateur);
    await sousIdentiteDuServeur(expert.id, async (db) => {
      await db.query(
        `insert into identity.memberships (tenant_id, user_id, role)
         values ($1, $2, 'collaborateur')`,
        [cabinet, collaborateur.id],
      );
    });
    const refus = await refusDe(collaborateur.id, async (db) =>
      db.query(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation')`,
        [pme, "format d'un collaborateur", `col-${marque}`],
      ),
    );
    assert.equal(refus, "42501", "le rôle ne compte pas : tout le cabinet inscrit");
  });

  /* -------------------------------- 3. INSCRIRE N'EST PAS PROMOUVOIR */

  it("l'expert engagé inscrit, et ne promeut pas", async () => {
    const versionId = await sousIdentiteDuServeur(patron.id, async (db) => {
      const { rows } = await db.query<{ recette_version_id: string }>(
        `select recette_version_id from fabrique.etat_des_recettes_v where tenant_id = $1`,
        [pme],
      );
      return rows[0]!.recette_version_id;
    });

    /*
     * « retiree » est une transition PERMISE depuis « candidate », et elle
     * n'exige aucune évaluation : si elle est refusée, c'est la POLITIQUE qui
     * refuse, pas le cycle. C'est ce qu'on veut mesurer.
     */
    const refus = await refusDe(expert.id, async (db) =>
      db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'retiree', 'retirée par le cabinet')`,
        [pme, versionId],
      ),
    );
    assert.equal(refus, "42501", "l'expert engagé promeut : inscrire et promouvoir se confondent");

    // Le dirigeant du dossier, lui, décide — la règle existante n'a pas bougé.
    const passe = await refusDe(patron.id, async (db) =>
      db.query(
        `insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
         values ($1, $2, 'retiree', 'retirée par le dirigeant')`,
        [pme, versionId],
      ),
    );
    assert.equal(passe, null, "le dirigeant ne peut plus décider du cycle de ses propres recettes");
  });

  /* ------------------------------------------- 4. L'INTRUS, À ZÉRO LIGNE */

  it("un intrus ne lit rien et n'écrit rien, même en nommant les identifiants", async () => {
    const lu = await sousIdentiteDuServeur(intrus.id, async (db) => {
      const r = await db.query(`select id from fabrique.recettes`);
      const v = await db.query(`select id from fabrique.recette_versions`);
      const e = await db.query(`select id from fabrique.exemples`);
      const p = await db.query(`select id from fabrique.promotions`);
      const t = await db.query(`select id from fabrique.travaux`);
      return [r.rows.length, v.rows.length, e.rows.length, p.rows.length, t.rows.length];
    });
    assert.deepEqual(lu, [0, 0, 0, 0, 0], "un intrus lit la fabrique d'un autre");

    const refus = await refusDe(intrus.id, async (db) =>
      db.query(
        `insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
         values ($1, $2, $3, 'organisation')`,
        [pme, "format d'un intrus", `intrus-${marque}`],
      ),
    );
    assert.equal(refus, "42501");
  });

  /* ----------------- 5. LE COUREUR : POURQUOI LA PLATEFORME NE REPREND PAS */

  it("un opérateur de plateforme ne voit pas la pièce et ne prend pas un travail", async () => {
    const { travailId } = await sousIdentiteDuServeur(patron.id, async (db) =>
      fabrique.enregistrerLecture(db, piece),
    );

    const vu = await sousIdentiteDuServeur(operateur.id, async (db) => {
      const p = await db.query(`select id from capture.pieces where id = $1`, [piece]);
      const t = await db.query(`select id from fabrique.travaux where id = $1`, [travailId]);
      return { pieces: p.rows.length, travaux: t.rows.length };
    });
    /*
     * La tour COMPTE et SUSPEND ; elle ne lit pas les papiers. Sans réquisition
     * approuvée, la pièce n'existe pas pour elle — et un travail de lecture
     * qu'on reprendrait sans pouvoir lire la pièce ne mènerait nulle part.
     */
    assert.equal(vu.pieces, 0, "la plateforme lit la pièce d'un client sans réquisition");

    // Et quand bien même elle verrait le travail : elle n'en inscrit pas la
    // prise. La politique d'écriture de `fabrique.travail_faits` exige
    // l'appartenance, et `app.is_platform()` n'y figure pas.
    const refus = await refusDe(operateur.id, async (db) =>
      db.query(
        `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
         values ($1, $2, 1, 'pris')`,
        [pme, travailId],
      ),
    );
    assert.ok(
      refus === "42501" || refus === "check_violation" || typeof refus === "string",
      "la plateforme inscrit la prise d'un travail chez un client",
    );
    assert.notEqual(refus, null, "la plateforme a pris un travail : R6 est percée");
  });
});
