/**
 * La déclaration de TVA s'arrête au cabinet (R10 ; revue Codex de #145).
 *
 * Les lignes de la déclaration sont un défaut livré, INCERTAIN. Le cabinet
 * les arrête pour un dossier ou pour lui-même — une décision qui s'ajoute,
 * datée et signée — et une ligne qu'il a arrêtée n'est plus « à confirmer ».
 * La PME lit ; elle n'arrête rien.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-declaration-de-tva-s-arrete-au-cabinet.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { tvaDesExtraits } from "@malica/socle/engines/tva/des-extraits";
import type { DeclarationTva, TaxRate } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la déclaration de TVA s'arrête au cabinet", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `decl-tva-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mfA = matriculeDEssai("A", "M");
  const mfB = matriculeDEssai("A", "M");
  let dirigeantA: Utilisateur;
  let dirigeantB: Utilisateur;
  let expert: Utilisateur;
  let pmeA = "";
  let pmeB = "";
  let cabinet = "";
  let packId = "";
  let jour = "";
  let IMMO = "";
  let AUTRE = "";
  let LIGNE_AUTRE = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const declaration = (u: Utilisateur, dossier: string) =>
    rpc(u, "referentiel.declarationTva", packId, dossier, jour, "fr") as Promise<DeclarationTva>;
  const affectation = (d: DeclarationTva, sens: string, nature: string) =>
    d.affectations.find((a) => a.sens === sens && a.nature === nature);
  const arreter = (
    u: Utilisateur,
    portee: "cabinet" | "dossier",
    porteeId: string,
    affectations:
      | DeclarationTva["affectations"]
      | Array<{ sens: string; nature: string; ligne: string | null }>,
    cabinetId = cabinet,
  ) =>
    rpc(u, "parametrage.arreterDeclarationTva", {
      cabinetId,
      portee,
      porteeId,
      packId,
      depuis: `${jour.slice(0, 7)}-01`,
      affectations: affectations.map((a) => ({ sens: a.sens, nature: a.nature, ligne: a.ligne })),
    });

  before(async () => {
    const [a, b, e] = await Promise.all([
      creerCompte(`dirigeant-a-${marque}@essai.local`, mdp),
      creerCompte(`dirigeant-b-${marque}@essai.local`, mdp),
      creerCompte(`expert-${marque}@essai.local`, mdp),
    ]);
    assert.ok(a && b && e);
    dirigeantA = a;
    dirigeantB = b;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pmeA = await creer(dirigeantA, "pme", `PME A D'ESSAI ${marque}`, mfA);
    pmeB = await creer(dirigeantB, "pme", `PME B D'ESSAI ${marque}`, mfB);
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, null);
    for (const [u, pme, mf] of [
      [dirigeantA, pmeA, mfA],
      [dirigeantB, pmeB, mfB],
    ] as const) {
      await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
      const [propose] = await sousIdentite(u.id, (db) => identite.mandatsProposes(db, pme));
      await sousIdentite(u.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    }
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
    const natures = await admin.query<{ code: string; immobilisation: boolean }>(
      `select code, immobilisation from ref.tva_natures`,
    );
    IMMO = natures.rows.find((r) => r.immobilisation)!.code;
    AUTRE = natures.rows.find((r) => !r.immobilisation)!.code;
    const d = await declaration(expert, pmeA);
    LIGNE_AUTRE = affectation(d, "deductible", AUTRE)!.ligne!;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pmeA, pmeB, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("avant toute décision : le défaut du pack, à confirmer", async () => {
    const d = await declaration(dirigeantA, pmeA);
    assert.ok(d.affectations.length > 0);
    assert.ok(d.affectations.every((a) => a.origine === "pack" && a.decideLe === null));
    assert.ok(
      d.lignes.some((l) => l.incertain),
      "le défaut se dit",
    );
  });

  it("une surcharge du cabinet pour un dossier change SA ligne, et seulement la sienne", async () => {
    await arreter(expert, "dossier", pmeA, [
      { sens: "deductible", nature: IMMO, ligne: LIGNE_AUTRE },
    ]);
    const a = await declaration(dirigeantA, pmeA);
    const b = await declaration(dirigeantB, pmeB);
    assert.equal(affectation(a, "deductible", IMMO)?.ligne, LIGNE_AUTRE);
    assert.equal(affectation(a, "deductible", IMMO)?.origine, "dossier");
    assert.notEqual(affectation(b, "deductible", IMMO)?.ligne, LIGNE_AUTRE);
    assert.equal(affectation(b, "deductible", IMMO)?.origine, "pack");

    // Le calcul suit : une immobilisation du dossier A tombe sur la ligne arrêtée.
    const extrait = lectureDEssai({ clientMf: mfA }).extract;
    const lignes = [{ ...extrait.lines[0]!, nature: IMMO, nature_attribuee: true }];
    const taux = (await rpc(dirigeantA, "referentiel.taxRates", packId, "TN")) as TaxRate[];
    const tva = tvaDesExtraits({
      period: jour.slice(0, 7),
      currency: { code: "TND", decimals: 3 },
      taux,
      declaration: a,
      rows: [{ pieceId: "x", extract: { ...extrait, lines: lignes } }],
    });
    assert.equal(tva.declaration.find((l) => l.code === LIGNE_AUTRE)?.vat, "234.566");
    assert.deepEqual(tva.par_defaut, []);
  });

  it("confirmer pour le cabinet retire « à confirmer » ; rendre au pack le remet", async () => {
    const avant = await declaration(expert, pmeB);
    assert.ok(avant.lignes.some((l) => l.incertain));
    // Confirmer : arrêter l'affectation telle qu'elle est.
    await arreter(expert, "cabinet", cabinet, avant.affectations);
    const apres = await declaration(dirigeantB, pmeB);
    assert.ok(apres.affectations.every((a) => a.origine === "cabinet" && a.decideLe));
    assert.ok(
      apres.lignes.every((l) => !l.incertain),
      "confirmée, la ligne n'est plus à confirmer",
    );
    // Le dossier A garde sa propre décision au-dessus de celle du cabinet.
    const a = await declaration(dirigeantA, pmeA);
    assert.equal(affectation(a, "deductible", IMMO)?.origine, "dossier");

    // Rendre au pack : une décision de plus, jamais un effacement.
    await arreter(
      expert,
      "cabinet",
      cabinet,
      avant.affectations.map((x) => ({ sens: x.sens, nature: x.nature, ligne: null })),
    );
    const rendue = await declaration(dirigeantB, pmeB);
    assert.ok(rendue.affectations.every((x) => x.origine === "pack"));
    assert.ok(rendue.lignes.some((l) => l.incertain));
  });

  it("la PME n'arrête rien : ni par la porte, ni par la table", async () => {
    await assert.rejects(
      arreter(
        dirigeantA,
        "dossier",
        pmeA,
        [{ sens: "deductible", nature: IMMO, ligne: LIGNE_AUTRE }],
        pmeA,
      ),
      /refus\.tva\.affectation\.droits/,
    );
    await assert.rejects(
      arreter(
        dirigeantA,
        "cabinet",
        pmeA,
        [{ sens: "deductible", nature: IMMO, ligne: LIGNE_AUTRE }],
        pmeA,
      ),
      /refus\.tva\.affectation\.droits/,
    );
    // Ni au nom du cabinet de son dossier.
    await assert.rejects(
      arreter(dirigeantA, "dossier", pmeA, [
        { sens: "deductible", nature: IMMO, ligne: LIGNE_AUTRE },
      ]),
      /refus\.tva\.affectation\.droits/,
    );
    await assert.rejects(
      sousIdentite(dirigeantA.id, (db) =>
        db.query(
          `insert into parametrage.tva_affectations
             (tenant_id, portee, portee_id, pack_version_id, sens, nature, ligne_code, valid_from)
           values ($1, 'dossier', $1, $2, 'deductible', $3, $4, current_date)`,
          [pmeA, packId, IMMO, LIGNE_AUTRE],
        ),
      ),
    );
  });

  it("le cabinet n'arrête pas un dossier qu'il ne tient pas, ni une ligne inconnue", async () => {
    await assert.rejects(
      arreter(expert, "dossier", cabinet, [
        { sens: "deductible", nature: IMMO, ligne: LIGNE_AUTRE },
      ]),
      /refus\.tva\.affectation\.droits/,
    );
    await assert.rejects(
      arreter(expert, "dossier", pmeA, [
        { sens: "deductible", nature: IMMO, ligne: "LIGNE_INCONNUE" },
      ]),
      /refus\.tva\.affectation\.saisie/,
    );
  });

  it("une décision ne se réécrit ni ne s'efface (R7)", async () => {
    await assert.rejects(
      admin.query(
        `update parametrage.tva_affectations set ligne_code = null where portee_id = $1`,
        [pmeA],
      ),
    );
    await assert.rejects(
      admin.query(`delete from parametrage.tva_affectations where portee_id = $1`, [pmeA]),
    );
  });
});
