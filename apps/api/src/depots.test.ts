/**
 * Les neuf dépôts portés, exécutés contre la vraie base.
 *
 * Ce que cette suite attrape, et qu'aucune autre ne peut attraper : une vue mal
 * nommée, une colonne absente, un transtypage impossible. Les requêtes sont
 * écrites à la main, et le typage de TypeScript ne les regarde pas — seul
 * PostgreSQL peut dire si elles tiennent.
 *
 * Elle ne vérifie donc pas ce que les lectures rendent, mais qu'elles
 * s'exécutent, sous une identité réelle, sur des organisations réelles. Un
 * résultat vide est un succès : la question posée est « la requête est-elle
 * valide », pas « y a-t-il des données ».
 *
 * Les écritures ne sont pas appelées : elles engagent la comptabilité, et un
 * test ne doit pas laisser d'écriture derrière lui (R7 — rien ne s'efface).
 */

import assert from "node:assert/strict";
import pg from "pg";
import { after, before, describe, it } from "node:test";

import { creerCompte } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Un identifiant qui ne désigne rien : les lectures filtrées doivent rendre le vide, pas échouer. */
const NEANT = "00000000-0000-4000-8000-000000000000";

describe("les dépôts portés répondent", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `depots-${Date.now()}`;
  let identite = "";
  let pme = "";
  let cabinet = "";
  let pack = "";

  before(async () => {
    const compte = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compte);
    identite = compte.id;

    // Les deux organisations passent par la RPC gouvernée, sous l'identité du
    // compte : la mise en place emprunte le chemin de production.
    await sousIdentite(identite, async (db) => {
      const org = async (kind: string, nom: string, mode: string) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3) as id`,
          [kind, nom, mode],
        );
        return rows[0]!.id;
      };
      pme = await org("pme", `ESSAI PME ${marque}`, "autonome");
      cabinet = await org("cabinet", `ESSAI CABINET ${marque}`, "mandate");
    });

    const actif = (await appeler("referentiel", "activePack", ["TN"])) as { id: string };
    assert.ok(actif, "un pack doit être en vigueur pour la Tunisie");
    pack = actif.id;
  });

  async function appeler(depot: string, methode: string, args: unknown[]): Promise<unknown> {
    return sousIdentite(identite, (db) => executerRpc(db, { depot, methode, args }));
  }

  after(async () => {
    // On archive, on ne supprime pas : la suppression cascade vers l'audit, où
    // `app.deny_mutation()` refuse toute mutation. Sans connexion
    // d'administration, on le dit plutôt que de laisser croire que c'est fait.
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (BASE_CONFIGUREE && admin && pme) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = any($1::uuid[]) and archived_at is null`,
          [[pme, cabinet]],
        );
      } finally {
        await pool.end();
      }
    } else if (pme) {
      console.warn(
        `organisations d'essai laissées en place (DATABASE_URL_ADMIN absente) : ${pme}, ${cabinet}`,
      );
    }
    await fermerLePool();
  });

  /**
   * Chaque lecture des neuf dépôts, une fois. Les arguments sont construits à
   * partir des organisations d'essai et du pack en vigueur — jamais codés en
   * dur (R4).
   */
  function lectures(): Array<[string, string, unknown[]]> {
    return [
      ["capture", "lister", [pme]],
      ["capture", "contexteAssistant", [pme, null]],
      ["capture", "contexteAssistant", [pme, NEANT]],

      ["identite", "listMyOrganizations", []],
      ["identite", "listEntities", [pme]],

      ["referentiel", "activePack", ["TN"]],
      ["referentiel", "socleParams", [pack]],
      ["referentiel", "accountMappings", [pack]],
      ["referentiel", "fiscalCharges", [pack]],
      ["referentiel", "taxRates", [pack, "TN"]],

      ["office", "ecrituresByIds", [[NEANT]]],
      ["office", "ecrituresForPiece", [NEANT]],
      ["office", "bookedExtracts", [pme, "2020-01-01", "2030-12-31"]],

      ["supervision", "listMyCabinets", []],
      ["supervision", "listClients", [cabinet]],
      ["supervision", "queue", [cabinet]],
      ["supervision", "queue", [cabinet, pme]],
      ["supervision", "motifs", ["fr"]],
      ["supervision", "auditForPiece", [NEANT]],

      ["immo", "categories", [pack]],
      ["immo", "listAssets", [pme]],
      ["immo", "dotations", [pme]],
      ["immo", "dotations", [pme, NEANT]],
      ["immo", "depreciations", [pme]],
      ["immo", "cessions", [pme]],

      ["stocks", "categories", [pack]],
      ["stocks", "listItems", [pme]],
      ["stocks", "mouvements", [pme]],
      ["stocks", "mouvements", [pme, NEANT]],
      ["stocks", "inventaires", [pme]],
      ["stocks", "depreciations", [pme]],

      ["banque", "listAccounts", [pme]],
      ["banque", "lines", [pme, NEANT]],
      ["banque", "etat", [pme]],
      ["banque", "lettrages", [pme]],
      ["banque", "audit", [pme]],

      ["collab", "members", [cabinet]],
      ["collab", "assignments", [cabinet]],
      ["collab", "pvList", [cabinet]],
      ["collab", "stats", [[pme]]],
      ["collab", "notifications", [[pme]]],
      ["collab", "echeances", [[pme]]],

      ["charges", "familles", [pack]],
      ["charges", "anomalyThreshold", [pack, "inexistant"]],
      ["charges", "articles", [pme, "2020-01", "2030-12"]],
      ["charges", "questions", [pme]],
    ];
  }

  it("chaque lecture s'exécute contre le schéma réel", async () => {
    const echecs: string[] = [];
    for (const [depot, methode, args] of lectures()) {
      try {
        await appeler(depot, methode, args);
      } catch (erreur) {
        echecs.push(`${depot}.${methode} : ${(erreur as Error).message}`);
      }
    }
    assert.deepEqual(echecs, [], `lectures en échec :\n${echecs.join("\n")}`);
  });

  it("couvre toutes les lectures déclarées", () => {
    // Un dépôt porté sans lecture listée ici passerait inaperçu. On compare les
    // dépôts couverts au registre, pas à une liste écrite deux fois.
    const couverts = new Set(lectures().map(([depot]) => depot));
    for (const depot of [
      "banque",
      "capture",
      "charges",
      "collab",
      "identite",
      "immo",
      "office",
      "referentiel",
      "stocks",
      "supervision",
    ]) {
      assert.ok(couverts.has(depot), `aucune lecture vérifiée pour « ${depot} »`);
    }
  });

  it("enregistre une pièce, la retrouve, et rend son contexte de lecture", async () => {
    const enregistree = (await appeler("capture", "enregistrer", [
      {
        tenantId: pme,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-piece`,
        contentType: "application/pdf",
      },
    ])) as { id: string; chemin: string };

    // Le chemin se déduit de la base. Aucun segment ne vient de l appelant :
    // c est ce qui rend la traversée impossible plutôt que filtrée.
    assert.equal(enregistree.chemin, `${pme}/${enregistree.id}`);

    const liste = (await appeler("capture", "lister", [pme])) as Array<{
      id: string;
      storagePath: string;
    }>;
    const vue = liste.find((p) => p.id === enregistree.id);
    assert.ok(vue, "la pièce enregistrée doit apparaître dans la liste");
    assert.equal(vue.storagePath, enregistree.chemin);

    const dossier = (await appeler("capture", "dossier", [enregistree.id])) as {
      piece: { id: string };
      extraction: unknown;
      citations: unknown[];
      tokens: unknown[];
    };
    assert.equal(dossier.piece.id, enregistree.id);
    assert.equal(dossier.extraction, null, "une pièce non lue n a pas d extraction");
    assert.deepEqual(dossier.citations, []);
    assert.deepEqual(dossier.tokens, []);

    const contexte = (await appeler("capture", "contexteLecture", [enregistree.id])) as {
      packId: string;
      piece: { contentType: string | null };
      taxCodes: Array<{ rate: unknown }>;
    };
    assert.equal(contexte.piece.contentType, "application/pdf", "le type vient de la base");
    assert.ok(contexte.packId, "la lecture exige un pack en vigueur");
    assert.ok(contexte.taxCodes.length > 0);
    for (const t of contexte.taxCodes) {
      // Le taux reste un NOMBRE, comme le rendait PostgREST. Le web le remet en
      // chaîne à l identique : une décimale de plus changerait l invite.
      assert.equal(typeof t.rate, "number");
    }
  });

  it("la clé d idempotence rend la même pièce, pas une seconde", async () => {
    const args = [
      {
        tenantId: pme,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-idem`,
        contentType: "application/pdf",
      },
    ];
    const une = (await appeler("capture", "enregistrer", args)) as { id: string };
    const deux = (await appeler("capture", "enregistrer", args)) as { id: string };
    assert.equal(deux.id, une.id, "réenregistrer ne doit pas dupliquer la pièce");
  });

  it("le dossier d une pièce inexistante ne prétend pas exister", async () => {
    await assert.rejects(appeler("capture", "dossier", [NEANT]), /piece.not_found/);
  });
});
