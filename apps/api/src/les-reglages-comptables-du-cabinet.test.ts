/**
 * Les réglages comptables du cabinet (R10 ; décisions du CEO du 31 octobre 2026).
 *
 * Onze arbitrages livrés en défauts du pack, à confirmer par un
 * expert-comptable. Le cabinet les arrête pour lui ou pour un dossier — une
 * décision qui s'ajoute, datée et signée, jamais une réécriture — par UNE
 * porte (`app.reglages_comptables_arreter`) et UN résolveur
 * (`app.reglage_comptable` : le dossier, son cabinet, le pack). La règle de
 * change y passe, vers sa propre table. Et l'effet est réel : le seuil
 * d'immobilisation change la réserve du jugement, le FODEC d'achat change de
 * compte.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/les-reglages-comptables-du-cabinet.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { D } from "@malica/socle/domain/decimal";
import type { ReglagesComptables } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { controlerPiece, type ContexteControle, type PieceAControler } from "./scan/controles.ts";
import { normaliserMontants } from "./scan/normaliser-montants.ts";
import { deviseDEssai } from "./scan/devise-d-essai.ts";
import {
  BIENS_IMMOBILISABLES_D_ESSAI,
  DEVISE_D_ESSAI,
  TITRES_D_ESSAI,
} from "./scan/referentiel-d-essai.ts";
import {
  droitsAuCout,
  lireLesReglagesComptables,
  NOMBRES_APPLIQUES,
  OPTIONS_APPLIQUEES,
  reglageDImmobilisation,
} from "./scan/reglages-comptables.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** Les choix du CEO (31 octobre 2026), tels que le pack doit les livrer. */
const CHOIX_DU_CEO: Record<string, string> = {
  "immobilisation.traitement": "actif_amorti",
  "comptes_immo.plan": "nc01_2282_43662",
  "fodec.traitement": "par_article_4374_cout",
  "timbre.bareme": "bareme_date",
  "non_residents.retenue": "au_paiement",
  "prorata.methode": "affectation_puis_prorata",
  "avoirs.traitement": "lie_facture",
  "ventes.compte": "par_nature_article",
  "conservation.duree": "10ans_cloture_teif",
  "mois_tva.date": "exigibilite_calculee",
};

describe("les réglages comptables du cabinet", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reglages-compta-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mfA = matriculeDEssai("A", "M");
  const mfB = matriculeDEssai("A", "M");
  let dirigeantA: Utilisateur;
  let dirigeantB: Utilisateur;
  let expert: Utilisateur;
  let autreExpert: Utilisateur;
  let pmeA = "";
  let pmeB = "";
  let cabinet = "";
  let autreCabinet = "";
  let packId = "";
  let jour = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const lire = (u: Utilisateur, org: string) =>
    rpc(u, "parametrage.reglagesComptables", org, packId, jour, "fr").then(
      (r) => r as ReglagesComptables,
    );
  const valeur = (r: ReglagesComptables, code: string) =>
    r.sujets.flatMap((s) => s.reglages).find((x) => x.code === code);
  const arreter = (
    u: Utilisateur,
    portee: "cabinet" | "dossier",
    porteeId: string,
    valeurs: Array<{ code: string; valeur: string | null }>,
    cabinetId = cabinet,
  ) =>
    rpc(u, "parametrage.arreterReglagesComptables", {
      cabinetId,
      portee,
      porteeId,
      packId,
      depuis: jour,
      valeurs,
    });

  before(async () => {
    const [a, b, e, x] = await Promise.all([
      creerCompte(`dirigeant-a-${marque}@essai.local`, mdp),
      creerCompte(`dirigeant-b-${marque}@essai.local`, mdp),
      creerCompte(`expert-${marque}@essai.local`, mdp),
      creerCompte(`autre-expert-${marque}@essai.local`, mdp),
    ]);
    assert.ok(a && b && e && x);
    dirigeantA = a;
    dirigeantB = b;
    expert = e;
    autreExpert = x;
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
    autreCabinet = await creer(autreExpert, "cabinet", `AUTRE CABINET D'ESSAI ${marque}`, null);
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
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pmeA, pmeB, cabinet, autreCabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le pack livre les onze sujets, aux choix du CEO, tous à confirmer", async () => {
    const r = await lire(expert, cabinet);
    assert.equal(r.sujets.length, 11);
    for (const [code, attendu] of Object.entries(CHOIX_DU_CEO)) {
      const v = valeur(r, code);
      assert.equal(v?.valeur, attendu, code);
      assert.equal(v?.origine, "pack", code);
      assert.equal(v?.decideLe, null, code);
      assert.match(v?.reference ?? "", /CEO.*expert-comptable/, code);
    }
    // Le seuil : un nombre, sans liste ; la règle de change, par sa table.
    assert.equal(valeur(r, "immobilisation.seuil")?.options, null);
    assert.ok(D(valeur(r, "immobilisation.seuil")!.valeur!).gt(0));
    assert.equal(valeur(r, "change.source")?.origine, "pack");
    assert.ok((valeur(r, "change.source")?.options ?? []).length > 0);
    // Chaque sujet dit son texte, sa pratique, son risque et ses sources.
    for (const s of r.sujets) {
      assert.ok(s.texte && s.pratique && s.risque, s.code);
      assert.ok(s.sources.length > 0, s.code);
      assert.ok(
        s.sources.every((x) => x.url.startsWith("https://")),
        s.code,
      );
    }
    assert.match(r.sujets.find((s) => s.code === "immobilisation")!.incertain ?? "", /INCERTAIN/);
  });

  it("ce qui n'est pas appliqué se dit ; ce qui l'est a son implémentation", async () => {
    const r = await lire(expert, cabinet);
    assert.equal(valeur(r, "prorata.methode")?.appliquee, false);
    assert.equal(valeur(r, "non_residents.retenue")?.appliquee, false);
    assert.equal(valeur(r, "mois_tva.date")?.appliquee, false);
    assert.equal(valeur(r, "avoirs.traitement")?.appliquee, false);
    assert.equal(valeur(r, "immobilisation.seuil")?.appliquee, true);
    assert.equal(valeur(r, "fodec.traitement")?.appliquee, true);
    assert.equal(valeur(r, "change.date_retenue")?.appliquee, true);

    // L'épreuve qui lie le référentiel au code : une option « appliquée »
    // en base l'est dans `reglages-comptables.ts`, et réciproquement.
    const { rows } = await admin.query<{ reglage: string; code: string }>(
      `select reglage, code from ref.reglages_comptables_options where applique
        order by reglage, code`,
    );
    const enBase = rows.map((o) => `${o.reglage}:${o.code}`).sort();
    const enCode = Object.entries(OPTIONS_APPLIQUEES)
      .flatMap(([r, os]) => os.map((o) => `${r}:${o}`))
      .sort();
    assert.deepEqual(enBase, enCode);
    const { rows: nombres } = await admin.query<{ code: string }>(
      `select code from ref.reglages_comptables
        where nature = 'nombre' and porte = 'reglages_comptables' and applique order by code`,
    );
    assert.deepEqual(
      nombres.map((n) => n.code),
      [...NOMBRES_APPLIQUES].sort(),
    );
  });

  it("les comptes, le barème et les catégories viennent des tables existantes", async () => {
    const r = await lire(expert, cabinet);
    const timbre = r.sujets.find((s) => s.code === "timbre")!;
    const { rows: droits } = await admin.query<{ document_kind: string; account_code: string }>(
      `select distinct on (document_kind) document_kind, account_code from ref.fiscal_charges
        where pack_version_id = $1 and code = 'DROIT_TIMBRE' and valid_from <= $2::date
        order by document_kind, valid_from desc`,
      [packId, jour],
    );
    assert.deepEqual(
      timbre.droits.map((d) => [d.sens, d.compte]).sort(),
      droits.map((d) => [d.document_kind, d.account_code]).sort(),
    );
    assert.ok(timbre.bareme.length > 0 && timbre.bareme.every((b) => b.uniteIncertaine));
    assert.deepEqual(r.sujets.find((s) => s.code === "fodec")!.bareme, []);
    const immo = r.sujets.find((s) => s.code === "comptes_immo")!;
    assert.ok(immo.categories.length > 0);
    // Un plafond du décret est comparé au taux linéaire de chaque catégorie.
    for (const c of immo.categories.filter((x) => x.tauxMaximal))
      assert.equal(c.depasse, D(c.tauxLineaire).gt(D(c.tauxMaximal!)), c.code);
  });

  it("la chaîne : pack, puis cabinet, puis dossier ; une valeur nulle rend la main", async () => {
    const seuilDuPack = valeur(await lire(expert, cabinet), "immobilisation.seuil")!.valeur!;
    const auCabinet = D(seuilDuPack).plus(100).toFixed();
    const auDossier = D(seuilDuPack).plus(300).toFixed();

    await arreter(expert, "cabinet", cabinet, [
      { code: "immobilisation.seuil", valeur: auCabinet },
    ]);
    for (const org of [cabinet, pmeA, pmeB]) {
      const v = valeur(await lire(expert, org), "immobilisation.seuil")!;
      assert.deepEqual([v.valeur, v.origine], [auCabinet, "cabinet"], org);
      assert.ok(v.decideLe);
    }

    await arreter(expert, "dossier", pmeA, [{ code: "immobilisation.seuil", valeur: auDossier }]);
    const duDossier = valeur(await lire(dirigeantA, pmeA), "immobilisation.seuil")!;
    assert.deepEqual([duDossier.valeur, duDossier.origine], [auDossier, "dossier"]);
    assert.equal(valeur(await lire(dirigeantB, pmeB), "immobilisation.seuil")!.valeur, auCabinet);

    // Nulle pour le dossier : la décision du cabinet reprend.
    await arreter(expert, "dossier", pmeA, [{ code: "immobilisation.seuil", valeur: null }]);
    const rendu = valeur(await lire(dirigeantA, pmeA), "immobilisation.seuil")!;
    assert.deepEqual([rendu.valeur, rendu.origine], [auCabinet, "cabinet"]);
    // Nulle pour le cabinet : le défaut du pack, à confirmer.
    await arreter(expert, "cabinet", cabinet, [{ code: "immobilisation.seuil", valeur: null }]);
    const pack = valeur(await lire(expert, pmeA), "immobilisation.seuil")!;
    assert.deepEqual([pack.valeur, pack.origine, pack.decideLe], [seuilDuPack, "pack", null]);
  });

  it("confirmer sans changer est une décision : le défaut n'est plus « à confirmer »", async () => {
    const avant = valeur(await lire(expert, cabinet), "prorata.methode")!;
    assert.equal(avant.origine, "pack");
    await arreter(expert, "cabinet", cabinet, [{ code: "prorata.methode", valeur: avant.valeur }]);
    const apres = valeur(await lire(expert, pmeB), "prorata.methode")!;
    assert.deepEqual([apres.valeur, apres.origine], [avant.valeur, "cabinet"]);
    assert.ok(apres.decideLe);
  });

  it("la règle de change passe par la même porte, vers sa propre table", async () => {
    const source = valeur(await lire(expert, cabinet), "change.source")!.valeur!;
    const n = await arreter(expert, "cabinet", cabinet, [
      { code: "change.source", valeur: source },
    ]);
    assert.deepEqual(n, { decisions: 1 });
    const v = valeur(await lire(expert, cabinet), "change.source")!;
    assert.deepEqual([v.valeur, v.origine], [source, "cabinet"]);
    // Vue d'un dossier du cabinet, par le résolveur de la règle de change lui-même.
    const regle = (await rpc(expert, "referentiel.regleDeChange", packId, pmeA, jour, "fr")) as {
      valeurs: Array<{ code: string; origine: string }>;
    };
    assert.equal(regle.valeurs.find((x) => x.code === "change.source")?.origine, "cabinet");
    const { rows } = await admin.query<{ generique: number; change: number }>(
      `select (select count(*)::int from parametrage.reglages_comptables
                where tenant_id = $1 and code like 'change.%') as generique,
              (select count(*)::int from parametrage.regles_de_change
                where tenant_id = $1 and code = 'change.source') as change`,
      [cabinet],
    );
    assert.deepEqual(rows[0], { generique: 0, change: 1 });
  });

  it("une PME, un cabinet étranger : refusés ; une valeur inconnue : refusée", async () => {
    await assert.rejects(
      arreter(
        dirigeantA,
        "dossier",
        pmeA,
        [{ code: "prorata.methode", valeur: "prorata_global" }],
        pmeA,
      ),
      /refus\.reglage_comptable\.droits/,
    );
    await assert.rejects(
      arreter(dirigeantA, "dossier", pmeA, [{ code: "prorata.methode", valeur: "prorata_global" }]),
      /refus\.reglage_comptable\.droits/,
    );
    await assert.rejects(
      arreter(
        autreExpert,
        "dossier",
        pmeA,
        [{ code: "prorata.methode", valeur: "prorata_global" }],
        autreCabinet,
      ),
      /refus\.reglage_comptable\.droits/,
    );
    await assert.rejects(
      arreter(autreExpert, "cabinet", cabinet, [
        { code: "prorata.methode", valeur: "prorata_global" },
      ]),
      /refus\.reglage_comptable\.droits/,
    );
    // Un cabinet étranger ne lit pas non plus les réglages d'un dossier qu'il ne tient pas.
    await assert.rejects(lire(autreExpert, pmeA), /refus\.reglage_comptable\.droits/);
    for (const valeurs of [
      [{ code: "prorata.methode", valeur: "option_inconnue" }],
      [{ code: "reglage.inconnu", valeur: "x" }],
      [{ code: "immobilisation.seuil", valeur: "deux cents" }],
      [
        { code: "prorata.methode", valeur: "prorata_global" },
        { code: "prorata.methode", valeur: "affectation_puis_prorata" },
      ],
    ])
      await assert.rejects(
        arreter(expert, "cabinet", cabinet, valeurs),
        /refus\.reglage_comptable\.saisie/,
      );
  });

  it("une décision ne s'écrit que par la porte, et ne se réécrit ni ne s'efface (R7)", async () => {
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        db.query(
          `insert into parametrage.reglages_comptables
             (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from)
           values ($1, 'cabinet', $1, $2, 'prorata.methode', 'prorata_global', current_date)`,
          [cabinet, packId],
        ),
      ),
    );
    await assert.rejects(
      admin.query(`update parametrage.reglages_comptables set valeur = null where tenant_id = $1`, [
        cabinet,
      ]),
    );
    await assert.rejects(
      admin.query(`delete from parametrage.reglages_comptables where tenant_id = $1`, [cabinet]),
    );
  });

  it("le seuil arrêté pour un dossier change la réserve de son jugement", async () => {
    const reglageDe = async (org: string) =>
      reglageDImmobilisation(
        await sousIdentite(dirigeantA.id, (db) => lireLesReglagesComptables(db, org, packId, jour)),
      );
    const avant = await reglageDe(pmeA);
    assert.ok(avant);
    // Un mobilier de bureau un millime au-dessus du seuil du pack.
    const prix = D(avant.seuil).plus("0.001").toFixed();
    const P = { ...deviseDEssai(3), toleranceMineure: 1 };
    const piece: PieceAControler = {
      documentKind: "facture_achat",
      titre: "FACTURE",
      emetteur: { nom: "FOURNISSEUR D'ESSAI", identifiantFiscal: mfB },
      destinataire: { nom: "PME A D'ESSAI", identifiantFiscal: mfA },
      numero: "F-ESSAI-1",
      date: jour,
      // Les montants de la pièce ne comptent ici que par leur devise : celle du dossier.
      montants: normaliserMontants(
        {
          bases: [{ ht: "1 234,560", taux: "0.19" }],
          tva: "234,566",
          autres: [],
          ttc: "1 469,126",
        },
        P,
      ),
      confianceParChamp: {},
      reception: { doublonDe: null, recueLe: jour },
      articles: [
        { designation: "Mobilier de bureau", quantite: "1", prixUnitaireHt: prix, totalHt: prix },
      ],
    };
    const ctx = (immobilisation: ContexteControle["immobilisation"]): ContexteControle => ({
      tenant: { nom: "PME A D'ESSAI", identifiantFiscal: mfA },
      typesDocument: [{ code: "facture_achat", porteEcriture: true }],
      titres: TITRES_D_ESSAI,
      biensImmobilisables: BIENS_IMMOBILISABLES_D_ESSAI,
      immobilisation,
      mentionsObligatoires: [],
      seuilConfianceReserve: 0.7,
      seuilConfianceBloquant: 0.4,
      ecartDateJours: 60,
      doublonProbable: null,
      deviseDuDossier: DEVISE_D_ESSAI,
      change: null,
    });
    const codes = (r: ContexteControle["immobilisation"]) =>
      controlerPiece(piece, ctx(r))
        .filter((c) => c.code.startsWith("immobilisation_"))
        .map((c) => c.code);
    assert.deepEqual(codes(avant), ["immobilisation_a_trancher"]);

    // Le cabinet relève le seuil pour CE dossier, et le passe en charge.
    await arreter(expert, "dossier", pmeA, [
      { code: "immobilisation.seuil", valeur: D(avant.seuil).plus(1).toFixed() },
      { code: "immobilisation.traitement", valeur: "charge" },
    ]);
    const apres = await reglageDe(pmeA);
    assert.deepEqual(codes(apres), []);
    // À l'actif : le même bien devient de faible valeur, amorti à 100 %.
    await arreter(expert, "dossier", pmeA, [
      { code: "immobilisation.traitement", valeur: "actif_amorti" },
    ]);
    assert.deepEqual(codes(await reglageDe(pmeA)), ["immobilisation_faible_valeur"]);
    // L'autre dossier garde le seuil du pack.
    assert.deepEqual(
      codes(
        reglageDImmobilisation(
          await sousIdentite(dirigeantB.id, (db) =>
            lireLesReglagesComptables(db, pmeB, packId, jour),
          ),
        ),
      ),
      ["immobilisation_a_trancher"],
    );
  });

  it("le FODEC d'achat va au coût par défaut, en 6652 si le cabinet le choisit", async () => {
    const auCout = (u: Utilisateur, org: string) =>
      sousIdentite(u.id, async (db) =>
        droitsAuCout(db, await lireLesReglagesComptables(db, org, packId, jour)),
      );
    const { rows } = await admin.query<{ droit: string }>(
      `select droit_hors_tva as droit from ref.reglages_comptables_sujets where code = 'fodec'`,
    );
    assert.deepEqual(await auCout(dirigeantB, pmeB), [rows[0]!.droit]);
    await arreter(expert, "dossier", pmeB, [{ code: "fodec.traitement", valeur: "achat_6652" }]);
    assert.deepEqual(await auCout(dirigeantB, pmeB), []);
  });
});
