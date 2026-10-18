/**
 * Les réglages de la reconnaissance viennent du référentiel — éprouvé en base.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/interprete-reglages.test.ts
 *
 * ================================================================= POURQUOI
 *
 * R4 a deux moitiés, et une seule était tenue. La signature et sa distance
 * n'ont aucun défaut en TypeScript — le compilateur refuse un appel qui
 * oublie un réglage —, mais PERSONNE ne les fournissait : le premier appelant
 * réel les aurait écrits dans son propre fichier, et treize nombres seraient
 * devenus des constantes.
 *
 * Trois garanties, et la troisième est celle qui compte :
 *
 *   R10 — le défaut est LIVRÉ, et la surcharge du cabinet l'emporte ;
 *   R10, conséquence 2 — on sait QUI a décidé, sans lire un historique ;
 *   R4, corollaire — une absence REFUSE, elle ne se complète pas.
 *
 * Tout passe par `sousIdentite`, donc par le rôle `authenticated` : une
 * preuve obtenue en superutilisateur ne prouve rien (règle ④ du plan).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";

import { lireLesBornesDeRecette, lireLesReglages } from "./interprete-reglages.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("les réglages de la fabrique", { skip: BASE_CONFIGUREE ? false : "sans base" }, () => {
  const marque = Date.now().toString(36);
  let utilisateur: Utilisateur;
  let tenant: string;

  before(async () => {
    const compte = await creerCompte(`reglages-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compte, "le compte doit etre cree");
    utilisateur = compte;
    tenant = await sousIdentite(utilisateur.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as org`,
        ["pme", `REGLAGES ${marque}`, "autonome", "TN", "TND"],
      );
      return rows[0]!.org;
    });
  });

  after(async () => {
    // On archive, on ne supprime pas : R7. Une suppression d'organisation
    // cascade dans `audit.event_log`, echoue, et laisse tout derriere elle.
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (BASE_CONFIGUREE && admin && tenant) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatise'
            where id = $1 and archived_at is null`,
          [tenant],
        );
      } finally {
        await pool.end();
      }
    }
    await fermerLePool();
  });

  it("les treize sortent ENSEMBLE, et remplissent les trois jeux", async () => {
    const reglages = await sousIdentite(utilisateur.id, (db) => lireLesReglages(db, tenant));

    assert.deepEqual(reglages.signature, {
      longueurMinimaleDAncre: 2,
      bandesParPage: 3,
      partMinimaleDuSens: 0.6,
      recouvrementDeLigne: 0.5,
      recouvrementDeColonne: 0.5,
      ancresEnRelationMax: 40,
    });
    assert.deepEqual(reglages.distance.poids, {
      ancres: 3,
      zones: 1,
      relations: 2,
      tableau: 3,
      pagination: 1,
    });
    assert.deepEqual(reglages.classement, { distanceMax: 0.08, ecartMinimal: 0.05 });
    assert.deepEqual(
      reglages.arretesParLeCabinet,
      [],
      "un cabinet neuf a déjà arrêté quelque chose",
    );
  });

  it("les cinq bornes du validateur sortent par le même chemin", async () => {
    const bornes = await sousIdentite(utilisateur.id, (db) => lireLesBornesDeRecette(db, tenant));
    assert.deepEqual(bornes, {
      ancre_texte_min: 3,
      selecteurs_max: 200,
      champs_max: 50,
      jetons_max: 12,
      rang_max: 50,
    });
  });

  it("ce que le cabinet arrête l'emporte, et se DIT", async () => {
    /*
     * R10, conséquence 2 : « on doit pouvoir répondre à "qui a décidé ce
     * compte" sans lire un historique ». Ici, c'est « qui a décidé ce
     * seuil » — et la réponse voyage avec la valeur.
     */
    const reglages = await sousIdentite(utilisateur.id, async (db) => {
      await db.query(
        `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif)
         values ($1, 'fabrique.seuil.signature.distance_max', 0.12, 'corpus du cabinet')`,
        [tenant],
      );
      return lireLesReglages(db, tenant);
    });
    assert.equal(reglages.classement.distanceMax, 0.12);
    assert.deepEqual(reglages.arretesParLeCabinet, ["distance_max"]);
    assert.equal(
      reglages.classement.ecartMinimal,
      0.05,
      "la surcharge a débordé sur l'autre seuil",
    );
  });

  it("et un cabinet ne peut PAS réécrire le défaut livré", async () => {
    /*
     * Constaté en écrivant le cas suivant, et gardé : une surcharge se pose
     * dans `parametrage.fabrique_seuils`, jamais dans `ref.socle_params`. Le
     * référentiel livré n'est pas réinscriptible par un client — sinon un
     * cabinet changerait le défaut de tous les autres.
     */
    const refus = await sousIdentite(utilisateur.id, async (db) => {
      try {
        await db.query(
          `update ref.socle_params set value_num = 1
            where code = 'fabrique.seuil.signature.poids_relations'`,
        );
        return null;
      } catch (erreur) {
        return erreur instanceof Error ? erreur.message : String(erreur);
      }
    });
    assert.ok(refus, "un cabinet a réécrit le référentiel livré");
  });

  it("douze réglages sur treize REFUSENT, au lieu de laisser inventer le treizième", async () => {
    /*
     * La faute qu'on empêche : un poids inventé déplace une distance sans que
     * rien ne le dise, et un format reconnu à tort rend un résultat plausible
     * et faux.
     *
     * Le lecteur est éprouvé contre une base FEINTE qui en rend douze : c'est
     * la seule façon de voir la faute, puisqu'un `authenticated` ne peut pas
     * retirer une ligne du référentiel — et c'est tant mieux (cas ci-dessus).
     * La barrière en base, elle, est éprouvée par sa jumelle
     * `fabrique.bornes_de_recette` dans `socle-de-donnees.test.ts`.
     */
    const treize = await sousIdentite(utilisateur.id, async (db) => {
      const { rows } = await db.query<{ reglage: string; valeur: string }>(
        `select reglage, valeur, arrete_par_le_cabinet from fabrique.reglages_de_signature($1)`,
        [tenant],
      );
      return rows;
    });
    assert.equal(treize.length, 13, "la base n'en livre pas treize : le banc ne prouve rien");

    const amputee = {
      query: <T>(): Promise<{ rows: T[] }> =>
        Promise.resolve({
          rows: treize.filter((r) => r.reglage !== "poids_relations") as unknown as T[],
        }),
    };
    await assert.rejects(
      () => lireLesReglages(amputee, tenant),
      /poids_relations/,
      "douze réglages sur treize ont suffi : le treizième sera inventé",
    );
  });
});
