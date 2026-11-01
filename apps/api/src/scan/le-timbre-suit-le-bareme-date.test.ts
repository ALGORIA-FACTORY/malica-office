/**
 * Le timbre d'une pièce suit le barème DATÉ, selon la catégorie de son émetteur
 * (réglage `timbre.bareme` = `bareme_date`, défaut du pack décidé par le CEO
 * le 31 octobre 2026).
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * L'option était enregistrée, pas appliquée : tout timbre imprimé se comparait
 * au droit standard. Une facture d'achat de plus de 100 D chez une grande
 * surface, qui imprime à juste titre « 2,000 » (CDET art. 117-I-6 bis, LF 2026),
 * était bloquée (`FISCAL_CHARGE_MISMATCH`).
 *
 * L'épreuve lit le barème du pack, sans rien y écrire : le droit standard et
 * la tranche des grandes surfaces au TTC de la pièce. Le fournisseur est un
 * tiers du dossier que le cabinet classe — ou ne classe pas.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/scan/le-timbre-suit-le-bareme-date.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PropositionDePiece } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../db.ts";
import { tiers } from "../depots/tiers.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

import { lecture } from "./lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** Le jour des pièces d'essai : celui de `lecture-d-essai.ts`. */
const JOUR = "2026-09-10";

describe("le timbre suit le barème daté", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `timbre-bareme-${Date.now()}`;
  const MF_DOSSIER = matriculeDEssai();
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let u: Utilisateur;
  let org = "";
  let packId = "";
  let fournisseur = "";
  /** Le droit standard, et la tranche des grandes surfaces au TTC des pièces. */
  let standard = "";
  let grandeSurface = "";
  let n = 0;

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

  /** « 2.000 » → les deux écritures imprimées « 2,000 ». */
  const imprime = (montant: string) => montant.replace(".", ",");

  /**
   * Une facture d'achat du fournisseur d'essai (1 234,560 HT, 234,566 de TVA)
   * qui imprime le timbre `droit` : son TTC le porte.
   */
  async function proposer(droit: string) {
    n += 1;
    const ttc = (1234.56 + 234.566 + Number(droit)).toFixed(3);
    const [entier, decimales] = ttc.split(".") as [string, string];
    const l = lecture({
      clientMf: MF_DOSSIER,
      numero: `F-${marque}-${n}`,
      timbre: imprime(droit),
      ttc: [entier.slice(0, -3), `${entier.slice(-3)},${decimales}`],
    });
    l.extract.other_charges = [{ code: "DROIT_TIMBRE", label: "", amount: droit }];
    l.extract.totals = { ...l.extract.totals, ttc };
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await rpc("capture", "persisterLecture", {
      pieceId: p.id,
      packId,
      tokens: l.tokens,
      contract: "extract.v1",
      extract: l.extract,
      citations: l.citations,
      flags: [],
      articles: [],
      documentKind: "facture_achat",
      documentDate: JOUR,
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    await rpc("capture", "analyser", p.id);
    return (await rpc("office", "propositionDePiece", p.id)) as PropositionDePiece;
  }

  const classer = (categorie: string | null) =>
    sousIdentite(u.id, (db) => tiers.classer(db, fournisseur, categorie));

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'PME DU TIMBRE D''ESSAI', 'autonome',
                                           $1, 'TN', 'TND') as id`,
        [MF_DOSSIER],
      );
      return rows[0]!.id;
    });
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    const droits = await admin.query<{ standard: string; grande_surface: string }>(
      `select (select trim_scale(fixed_amount)::text from ref.fiscal_charges
                where pack_version_id = $1 and code = 'DROIT_TIMBRE'
                  and document_kind = 'facture_achat' and valid_from <= $2::date
                  and (valid_to is null or valid_to >= $2::date)) as standard,
              (select trim_scale(montant_du_droit)::text from ref.baremes_des_droits b
                join ref.categories_de_bareme c on c.code = b.categorie and not c.standard
                where b.pack_version_id = $1 and b.droit = 'DROIT_TIMBRE'
                  and b.valid_from <= $2::date and (b.valid_to is null or b.valid_to >= $2::date)
                  and b.montant_a is null) as grande_surface`,
      [packId, JOUR],
    );
    const fixe = (x: string) => Number(x).toFixed(3);
    standard = fixe(droits.rows[0]!.standard);
    grandeSurface = fixe(droits.rows[0]!.grande_surface);
    // L'épreuve n'a de sens que si les deux tarifs diffèrent, et que les pièces
    // tombent dans la tranche sans plafond.
    assert.notEqual(standard, grandeSurface);
    const premiere = lecture().extract;
    const plafond = await admin.query<{ a: string }>(
      `select max(montant_a)::text as a from ref.baremes_des_droits
        where pack_version_id = $1 and droit = 'DROIT_TIMBRE'`,
      [packId],
    );
    assert.ok(Number(premiere.totals.ttc) > Number(plafond.rows[0]!.a));
    fournisseur = await sousIdentite(u.id, (db) =>
      tiers.creer(db, {
        tenantId: org,
        nature: "fournisseur",
        code: `F-${marque.slice(-6)}`,
        raisonSociale: "Fournisseur d'essai",
        compteCollectif: "401",
        identifiantFiscal: premiere.references.matricule_fiscal,
      }),
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("non classé : le droit standard passe, sans réserve", async () => {
    const r = await proposer(standard);
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.reserves, undefined);
  });

  it("non classé : le tarif des grandes surfaces passe, avec la réserve nommée", async () => {
    const r = await proposer(grandeSurface);
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.deepEqual(r.reserves, [
      {
        code: "categorie_d_emetteur",
        droit: "DROIT_TIMBRE",
        categorie: "grandes_surfaces",
        montant: grandeSurface,
      },
    ]);
  });

  it("non classé : un droit qui n'est le tarif d'aucune catégorie reste bloqué", async () => {
    const r = await proposer((Number(grandeSurface) + Number(standard)).toFixed(3));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.raison, /DROIT_TIMBRE.*différent du barème/);
  });

  it("classé grande surface : la tranche passe sans réserve, le droit standard est bloqué", async () => {
    await classer("grandes_surfaces");
    const juste = await proposer(grandeSurface);
    assert.ok(juste.ok, juste.ok ? "" : juste.raison);
    assert.equal(juste.reserves, undefined);
    const faux = await proposer(standard);
    assert.equal(faux.ok, false);
    assert.match(faux.ok ? "" : faux.raison, new RegExp(`attendu ${grandeSurface}`));
  });

  it("classé standard : le tarif des grandes surfaces est bloqué", async () => {
    await classer("standard");
    const r = await proposer(grandeSurface);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.raison, new RegExp(`attendu ${standard}`));
  });

  it("la porte ne classe qu'à une catégorie du référentiel, et rend « non classé »", async () => {
    await assert.rejects(classer("hypermarche_invente"), /refus\.saisie\.mal_formee/);
    await classer(null);
    const vus = await sousIdentite(u.id, (db) => tiers.lister(db, org, "fournisseur"));
    assert.equal(vus.find((x) => x.id === fournisseur)?.categorieDeBareme, null);
    const categories = await sousIdentite(u.id, (db) => tiers.categoriesDeBareme(db, "ar"));
    assert.deepEqual(
      categories.map((c) => c.code),
      ["standard", "grandes_surfaces"],
    );
    assert.ok(categories.every((c) => c.libelle !== c.code));
  });

  it("une personne étrangère au dossier ne classe pas son fournisseur", async () => {
    const etranger = await creerCompte(`${marque}-etranger@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(etranger);
    await classer("grandes_surfaces");
    await assert.rejects(
      sousIdentite(etranger.id, (db) => tiers.classer(db, fournisseur, null)),
      /refus\.introuvable/,
    );
    const vus = await sousIdentite(u.id, (db) => tiers.lister(db, org, "fournisseur"));
    assert.equal(vus.find((x) => x.id === fournisseur)?.categorieDeBareme, "grandes_surfaces");
    await classer(null);
  });
});
