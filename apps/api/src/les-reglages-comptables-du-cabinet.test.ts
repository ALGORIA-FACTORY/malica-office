/**
 * Les réglages comptables du cabinet (R10 ; décisions du CEO du 31 octobre 2026).
 *
 * Onze arbitrages livrés en défauts du pack, à confirmer par un
 * expert-comptable. Le cabinet les arrête pour lui ou pour un dossier — une
 * décision qui s'ajoute, datée et signée, jamais une réécriture — par UNE
 * porte (`app.reglages_comptables_arreter`) et UN résolveur
 * (`app.reglage_comptable` : le dossier, son cabinet, le pack). La règle de
 * change y passe, vers sa propre table. L'effet est réel : le seuil
 * d'immobilisation change le jugement de la pièce, qui se PÉRIME et se
 * rejuge quand le réglage change ; le FODEC d'achat change de compte.
 *
 * Chaque épreuve monte ses propres sociétés : aucune ne dépend d'une autre.
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
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { REGLES_DU_JUGEMENT, versionDuJugement } from "./scan/analyse.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";
import {
  droitsAuCout,
  lireLesReglagesComptables,
  NOMBRES_APPLIQUES,
  OPTIONS_APPLIQUEES,
} from "./scan/reglages-comptables.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** Les choix du CEO (31 octobre 2026), tels que le pack doit les livrer. */
const CHOIX_DU_CEO: Record<string, string> = {
  "immobilisation.seuil": "200",
  "immobilisation.traitement": "actif_amorti",
  "comptes_immo.plan": "selon_categorie",
  "fodec.traitement": "par_article_au_cout",
  "timbre.bareme": "bareme_date",
  "non_residents.retenue": "au_paiement",
  "prorata.methode": "affectation_puis_prorata",
  "avoirs.traitement": "lie_facture",
  "ventes.compte": "par_nature_article",
  "conservation.duree": "10ans_cloture_teif",
  "mois_tva.date": "exigibilite_calculee",
};

type Valeurs = Array<{ code: string; valeur: string | null }>;

describe("les réglages comptables du cabinet", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reglages-compta-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const archiver: string[] = [];
  let packId = "";
  let n = 0;

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  /** Un cabinet, deux dossiers qu'il tient, leurs dirigeants : à chaque épreuve les siens. */
  const monter = async () => {
    n += 1;
    const m = `${marque}-${n}`;
    const mfA = matriculeDEssai("A", "M");
    const mfB = matriculeDEssai("A", "M");
    const [dirigeantA, dirigeantB, expert] = await Promise.all([
      creerCompte(`dirigeant-a-${m}@essai.local`, mdp),
      creerCompte(`dirigeant-b-${m}@essai.local`, mdp),
      creerCompte(`expert-${m}@essai.local`, mdp),
    ]);
    assert.ok(dirigeantA && dirigeantB && expert);
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    const pmeA = await creer(dirigeantA, "pme", `PME A D'ESSAI ${m}`, mfA);
    const pmeB = await creer(dirigeantB, "pme", `PME B D'ESSAI ${m}`, mfB);
    const cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${m}`, null);
    archiver.push(pmeA, pmeB, cabinet);
    for (const [u, pme, mf] of [
      [dirigeantA, pmeA, mfA],
      [dirigeantB, pmeB, mfB],
    ] as const) {
      await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
      const [propose] = await sousIdentite(u.id, (db) => identite.mandatsProposes(db, pme));
      await sousIdentite(u.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    }
    const jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
    const lire = (u: Utilisateur, dossier: string | null, au = jour) =>
      rpc(u, "parametrage.reglagesComptables", cabinet, dossier, packId, au, "fr").then(
        (r) => r as ReglagesComptables,
      );
    const arreter = (
      u: Utilisateur,
      portee: "cabinet" | "dossier",
      porteeId: string,
      valeurs: Valeurs,
      options: { cabinetId?: string; depuis?: string } = {},
    ) =>
      rpc(u, "parametrage.arreterReglagesComptables", {
        cabinetId: options.cabinetId ?? cabinet,
        portee,
        porteeId,
        packId,
        depuis: options.depuis ?? jour,
        valeurs,
      });
    return { dirigeantA, dirigeantB, expert, pmeA, pmeB, mfA, cabinet, jour, lire, arreter, m };
  };

  const valeur = (r: ReglagesComptables, code: string) =>
    r.sujets.flatMap((s) => s.reglages).find((x) => x.code === code);

  before(async () => {
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [archiver],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le pack livre les onze sujets du CEO, tous à confirmer, et celui de la lecture", async () => {
    const s = await monter();
    const r = await s.lire(s.expert, null);
    assert.equal(r.sujets.length, 12);
    // La lecture prouvée (15 novembre 2026) : un réglage de Malica, pas une règle
    // fiscale. Le sudoku désigne (décision du dirigeant, 1er novembre 2026) ; la
    // relecture de nuit est coupée, à 12 heures.
    assert.deepEqual(
      ["lecture.sudoku", "lecture.relecture_nuit", "lecture.relecture_delai_heures"].map((code) => [
        valeur(r, code)?.valeur,
        valeur(r, code)?.origine,
      ]),
      [
        ["designe", "pack"],
        ["coupee", "pack"],
        ["12", "pack"],
      ],
    );
    for (const [code, attendu] of Object.entries(CHOIX_DU_CEO)) {
      const v = valeur(r, code);
      assert.deepEqual([v?.valeur, v?.origine, v?.decideLe], [attendu, "pack", null], code);
      assert.match(v?.reference ?? "", /CEO.*expert-comptable/, code);
    }
    // Le seuil : un nombre sans liste, celui du pack, tel que `ref.socle_params` le porte.
    const { rows } = await admin.query<{ v: string }>(
      `select trim_scale(value_num)::text as v from ref.socle_params
        where pack_version_id = $1 and code = 'immobilisation.seuil'`,
      [packId],
    );
    assert.equal(valeur(r, "immobilisation.seuil")?.valeur, rows[0]!.v);
    assert.equal(valeur(r, "immobilisation.seuil")?.options, null);
    assert.equal(valeur(r, "change.source")?.origine, "pack");
    for (const x of r.sujets) {
      assert.ok(x.texte && x.pratique && x.risque, x.code);
      assert.ok(x.sources.length > 0 && x.sources.every((y) => y.url.startsWith("https://")));
    }
    assert.match(r.sujets.find((x) => x.code === "immobilisation")!.incertain ?? "", /TTC/);
    // Aucun code d'option ne porte un numéro de compte. Les sources de cours
    // `ESSAI_<horodatage>` sont celles qu'un autre fichier d'essai crée, le temps
    // de son passage, sur la même base (une-facture-en-devise-se-convertit) :
    // elles ne sont pas des options du pack.
    for (const o of r.sujets.flatMap((x) => x.reglages).flatMap((x) => x.options ?? []))
      if (!o.code.startsWith("ESSAI_")) assert.doesNotMatch(o.code, /\d{3,}/, o.code);
    // La date d'effet proposée : le début de l'exercice (le 1er janvier sans clôture).
    assert.equal(r.debutExercice, `${s.jour.slice(0, 4)}-01-01`);
  });

  it("ce qui n'est pas appliqué se dit, jusque sur l'option ; ce qui l'est a son implémentation", async () => {
    const s = await monter();
    const r = await s.lire(s.expert, null);
    for (const code of [
      "prorata.methode",
      "non_residents.retenue",
      "lecture.relecture_nuit",
      "lecture.relecture_delai_heures",
    ])
      assert.equal(valeur(r, code)?.appliquee, false, code);
    // Le mode du sudoku s'applique (`modeDuSudoku`) : observe ou désigne.
    assert.deepEqual(
      valeur(r, "lecture.sudoku")!.options!.map((o) => [o.code, o.appliquee]),
      [
        ["observe", true],
        ["designe", true],
      ],
    );
    assert.match(r.sujets.find((x) => x.code === "lecture")!.incertain ?? "", /Non appliqués/);
    // Appliqués depuis le 1er novembre 2026 : le compte de vente par nature,
    // l'avoir lié à sa facture — mais pas l'avoir « libre », qui le dit ; et
    // depuis le 11 novembre 2026, le mois de TVA par l'exigibilité.
    for (const code of ["ventes.compte", "avoirs.traitement", "avoirs.ecriture", "mois_tva.date"])
      assert.equal(valeur(r, code)?.appliquee, true, code);
    // Ce que le mois de TVA n'applique pas encore se dit, au point à confirmer.
    assert.match(r.sujets.find((x) => x.code === "mois_tva")!.incertain ?? "", /Non appliqués/);
    assert.deepEqual(
      valeur(r, "avoirs.traitement")!.options!.map((o) => [o.code, o.appliquee]),
      [
        ["lie_facture", true],
        ["libre", false],
        ["refus_saisie_cabinet", true],
      ],
    );
    // L'inscription à l'actif n'est pas proposée : le défaut le dit.
    assert.equal(valeur(r, "immobilisation.traitement")?.appliquee, false);
    const options = valeur(r, "immobilisation.traitement")!.options!;
    assert.deepEqual(
      options.map((o) => [o.code, o.appliquee]),
      [
        ["actif_amorti", false],
        ["charge", true],
      ],
    );
    assert.equal(valeur(r, "fodec.traitement")?.appliquee, true);
    // Le barème daté du timbre est appliqué (`bareme-du-timbre.ts`), comme le droit fixe.
    assert.deepEqual(
      valeur(r, "timbre.bareme")!.options!.map((o) => [o.code, o.appliquee]),
      [
        ["bareme_date", true],
        ["fixe_1d", true],
      ],
    );
    const { rows } = await admin.query<{ reglage: string; code: string }>(
      `select reglage, code from ref.reglages_comptables_options where applique`,
    );
    assert.deepEqual(
      rows.map((o) => `${o.reglage}:${o.code}`).sort(),
      Object.entries(OPTIONS_APPLIQUEES)
        .flatMap(([g, os]) => os.map((o) => `${g}:${o}`))
        .sort(),
    );
    const { rows: nombres } = await admin.query<{ code: string }>(
      `select code from ref.reglages_comptables
        where nature = 'nombre' and porte = 'reglages_comptables' and applique`,
    );
    assert.deepEqual(nombres.map((x) => x.code).sort(), [...NOMBRES_APPLIQUES].sort());
  });

  it("les comptes, le barème et les catégories viennent des tables existantes", async () => {
    const s = await monter();
    const r = await s.lire(s.expert, null);
    const timbre = r.sujets.find((x) => x.code === "timbre")!;
    const { rows } = await admin.query<{ document_kind: string; account_code: string }>(
      `select distinct on (document_kind) document_kind, account_code from ref.fiscal_charges
        where pack_version_id = $1 and code = 'DROIT_TIMBRE' and valid_from <= $2::date
        order by document_kind, valid_from desc`,
      [packId, s.jour],
    );
    assert.deepEqual(
      timbre.droits.map((d) => [d.sens, d.compte]).sort(),
      rows.map((d) => [d.document_kind, d.account_code]).sort(),
    );
    assert.ok(timbre.bareme.length > 0 && timbre.bareme.every((b) => b.uniteIncertaine));
    assert.deepEqual(r.sujets.find((x) => x.code === "fodec")!.bareme, []);
    // Les ventes montrent les natures du pack, leur compte et leur repli.
    const { rows: natures } = await admin.query<{ code: string; compte: string; repli: boolean }>(
      `select n.code, b.account_code as compte, n.repli
         from ref.natures_de_vente n
         join ref.role_bindings b on b.pack_version_id = n.pack_version_id and b.role_code = n.role_code
        where n.pack_version_id = $1 and n.valid_to is null order by n.rang`,
      [packId],
    );
    assert.deepEqual(
      r.sujets
        .find((x) => x.code === "ventes")!
        .naturesDeVente.map((x) => ({ code: x.code, compte: x.compte, repli: x.repli })),
      natures,
    );
    assert.ok(natures.length > 0);
    assert.deepEqual(timbre.naturesDeVente, []);
    const immo = r.sujets.find((x) => x.code === "comptes_immo")!;
    assert.ok(immo.categories.length > 0);
    for (const c of immo.categories.filter((x) => x.tauxMaximal))
      assert.equal(c.depasse, D(c.tauxLineaire).gt(D(c.tauxMaximal!)), c.code);
  });

  it("la chaîne : pack, puis cabinet, puis dossier ; une valeur nulle rend la main", async () => {
    const s = await monter();
    const seuilDuPack = valeur(await s.lire(s.expert, null), "immobilisation.seuil")!.valeur!;
    const auCabinet = D(seuilDuPack).plus(100).toFixed();
    const auDossier = D(seuilDuPack).plus(300).toFixed();
    const seuilDe = async (u: Utilisateur, dossier: string | null) => {
      const v = valeur(await s.lire(u, dossier), "immobilisation.seuil")!;
      return [v.valeur, v.origine, v.valeurDuCabinet, v.origineDuCabinet];
    };

    await s.arreter(s.expert, "cabinet", s.cabinet, [
      { code: "immobilisation.seuil", valeur: auCabinet },
    ]);
    assert.deepEqual(await seuilDe(s.expert, null), [auCabinet, "cabinet", auCabinet, "cabinet"]);
    assert.deepEqual(await seuilDe(s.expert, s.pmeA), [auCabinet, "cabinet", auCabinet, "cabinet"]);

    await s.arreter(s.expert, "dossier", s.pmeA, [
      { code: "immobilisation.seuil", valeur: auDossier },
    ]);
    // Le dossier a le sien ; la valeur du cabinet, elle, ne change pas.
    assert.deepEqual(await seuilDe(s.expert, s.pmeA), [auDossier, "dossier", auCabinet, "cabinet"]);
    assert.deepEqual(await seuilDe(s.expert, s.pmeB), [auCabinet, "cabinet", auCabinet, "cabinet"]);

    await s.arreter(s.expert, "dossier", s.pmeA, [{ code: "immobilisation.seuil", valeur: null }]);
    assert.deepEqual(await seuilDe(s.expert, s.pmeA), [auCabinet, "cabinet", auCabinet, "cabinet"]);
    await s.arreter(s.expert, "cabinet", s.cabinet, [
      { code: "immobilisation.seuil", valeur: null },
    ]);
    assert.deepEqual(await seuilDe(s.expert, s.pmeA), [seuilDuPack, "pack", seuilDuPack, "pack"]);
  });

  it("une décision vaut depuis SA date d'effet : celle du jour ne touche pas une pièce d'avant", async () => {
    const s = await monter();
    const avant = `${s.jour.slice(0, 4)}-01-15` < s.jour ? `${s.jour.slice(0, 4)}-01-15` : s.jour;
    const seuilAu = async (jourDeLaPiece: string) =>
      (
        await sousIdentite(s.dirigeantA.id, (db) =>
          lireLesReglagesComptables(db, s.pmeA, packId, jourDeLaPiece),
        )
      ).get("immobilisation.seuil");
    const duPack = await seuilAu(avant);
    const nouveau = D(duPack!).plus(50).toFixed();
    // Décidé aujourd'hui, pour aujourd'hui : la pièce d'avant garde le pack.
    await s.arreter(s.expert, "dossier", s.pmeA, [
      { code: "immobilisation.seuil", valeur: nouveau },
    ]);
    if (avant < s.jour) assert.equal(await seuilAu(avant), duPack);
    assert.equal(await seuilAu(s.jour), nouveau);
    // Décidé aujourd'hui, depuis le début de l'exercice : elle le suit.
    const debut = (await s.lire(s.expert, s.pmeA)).debutExercice;
    await s.arreter(
      s.expert,
      "dossier",
      s.pmeA,
      [{ code: "immobilisation.seuil", valeur: nouveau }],
      {
        depuis: debut,
      },
    );
    assert.equal(await seuilAu(avant), nouveau);
  });

  it("confirmer sans changer est une décision : le défaut n'est plus « à confirmer »", async () => {
    const s = await monter();
    const avant = valeur(await s.lire(s.expert, null), "prorata.methode")!;
    assert.equal(avant.origine, "pack");
    await s.arreter(s.expert, "cabinet", s.cabinet, [
      { code: "prorata.methode", valeur: avant.valeur },
    ]);
    const apres = valeur(await s.lire(s.expert, s.pmeB), "prorata.methode")!;
    assert.deepEqual([apres.valeur, apres.origine], [avant.valeur, "cabinet"]);
    assert.ok(apres.decideLe);
  });

  it("la règle de change passe par la même porte, vers sa propre table", async () => {
    const s = await monter();
    const source = valeur(await s.lire(s.expert, null), "change.source")!.valeur!;
    assert.deepEqual(
      await s.arreter(s.expert, "cabinet", s.cabinet, [{ code: "change.source", valeur: source }]),
      { decisions: 1 },
    );
    const v = valeur(await s.lire(s.expert, null), "change.source")!;
    assert.deepEqual([v.valeur, v.origine], [source, "cabinet"]);
    const regle = (await rpc(
      s.expert,
      "referentiel.regleDeChange",
      packId,
      s.pmeA,
      s.jour,
      "fr",
    )) as {
      valeurs: Array<{ code: string; origine: string }>;
    };
    assert.equal(regle.valeurs.find((x) => x.code === "change.source")?.origine, "cabinet");
    const { rows } = await admin.query<{ generique: number; change: number }>(
      `select (select count(*)::int from parametrage.reglages_comptables
                where tenant_id = $1 and code like 'change.%') as generique,
              (select count(*)::int from parametrage.regles_de_change
                where tenant_id = $1 and code = 'change.source') as change`,
      [s.cabinet],
    );
    assert.deepEqual(rows[0], { generique: 0, change: 1 });
  });

  it("une PME, un cabinet étranger : refusés ; une valeur inconnue ou absurde : refusée", async () => {
    const s = await monter();
    const e = await monter();
    const prorata = [{ code: "prorata.methode", valeur: "prorata_global" }];
    await assert.rejects(
      s.arreter(s.dirigeantA, "dossier", s.pmeA, prorata, { cabinetId: s.pmeA }),
      /refus\.reglage_comptable\.droits/,
    );
    await assert.rejects(s.arreter(s.dirigeantA, "dossier", s.pmeA, prorata), /droits/);
    await assert.rejects(
      s.arreter(e.expert, "dossier", s.pmeA, prorata, { cabinetId: e.cabinet }),
      /refus\.reglage_comptable\.droits/,
    );
    await assert.rejects(s.arreter(e.expert, "cabinet", s.cabinet, prorata), /droits/);
    await assert.rejects(s.lire(e.expert, s.pmeA), /refus\.reglage_comptable\.droits/);
    for (const valeurs of [
      [{ code: "prorata.methode", valeur: "option_inconnue" }],
      [{ code: "reglage.inconnu", valeur: "x" }],
      ...["deux cents", "0", "0.000", "-5", "1e3", "0.0000001", "9999999999999"].map((v) => [
        { code: "immobilisation.seuil", valeur: v },
      ]),
      [
        { code: "prorata.methode", valeur: "prorata_global" },
        { code: "prorata.methode", valeur: "affectation_puis_prorata" },
      ],
    ])
      await assert.rejects(
        s.arreter(s.expert, "cabinet", s.cabinet, valeurs),
        /refus\.reglage_comptable\.saisie/,
        JSON.stringify(valeurs),
      );
  });

  it("un collaborateur non affecté ne lit ni le résolveur ni les décisions d'un dossier", async () => {
    const s = await monter();
    const collaborateur = (await creerCompte(`collab-${s.m}@essai.local`, mdp))!;
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [s.cabinet, collaborateur.id],
    );
    await s.arreter(s.expert, "dossier", s.pmeA, [
      { code: "prorata.methode", valeur: "prorata_global" },
      { code: "change.recul_jours", valeur: "3" },
    ]);
    const lignes = (u: Utilisateur, table: string) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from parametrage.${table} where portee_id = $1`,
          [s.pmeA],
        );
        return rows[0]!.n;
      });
    for (const table of ["reglages_comptables", "regles_de_change"]) {
      assert.equal(await lignes(s.expert, table), 1, table);
      assert.equal(await lignes(s.dirigeantA, table), 1, table);
      assert.equal(await lignes(collaborateur, table), 0, table);
      assert.equal(await lignes(s.dirigeantB, table), 0, table);
    }
    await assert.rejects(s.lire(collaborateur, s.pmeA), /refus\.reglage_comptable\.droits/);
  });

  it("un ancien cabinet ne lit plus, et ses décisions ne suivent pas le dossier", async () => {
    const s = await monter();
    await s.arreter(s.expert, "dossier", s.pmeB, [
      { code: "prorata.methode", valeur: "prorata_global" },
      { code: "change.recul_jours", valeur: "3" },
    ]);
    await sousIdentite(s.dirigeantB.id, (db) =>
      identite.revoquerMandat(db, s.pmeB, "Je change de comptable"),
    );
    await assert.rejects(s.lire(s.expert, s.pmeB), /refus\.reglage_comptable\.droits/);
    for (const table of ["reglages_comptables", "regles_de_change"]) {
      const { rows } = await sousIdentite(s.expert.id, (db) =>
        db.query<{ n: number }>(
          `select count(*)::int as n from parametrage.${table} where portee_id = $1`,
          [s.pmeB],
        ),
      );
      assert.equal(rows[0]!.n, 0, table);
    }
    // Le dossier lui-même relit le pack : la décision de l'ancien cabinet ne le suit pas.
    const r = await sousIdentite(s.dirigeantB.id, (db) =>
      lireLesReglagesComptables(db, s.pmeB, packId, s.jour),
    );
    assert.equal(r.get("prorata.methode"), CHOIX_DU_CEO["prorata.methode"]);
  });

  it("une décision ne s'écrit que par la porte, et ne se réécrit ni ne s'efface (R7)", async () => {
    const s = await monter();
    await s.arreter(s.expert, "cabinet", s.cabinet, [
      { code: "prorata.methode", valeur: "prorata_global" },
    ]);
    await assert.rejects(
      sousIdentite(s.expert.id, (db) =>
        db.query(
          `insert into parametrage.reglages_comptables
             (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from)
           values ($1, 'cabinet', $1, $2, 'prorata.methode', 'prorata_global', current_date)`,
          [s.cabinet, packId],
        ),
      ),
    );
    await assert.rejects(
      admin.query(`update parametrage.reglages_comptables set valeur = null where tenant_id = $1`, [
        s.cabinet,
      ]),
    );
    await assert.rejects(
      admin.query(`delete from parametrage.reglages_comptables where tenant_id = $1`, [s.cabinet]),
    );
  });

  /** Un achat lu du dossier A, aux articles donnés, jugé et partagé au cabinet. */
  const achatLu = async (
    s: Awaited<ReturnType<typeof monter>>,
    datePiece: string,
    articles: Array<{
      designation: string;
      quantity: string;
      unit_price_ht: string;
      total_ht: string;
    }>,
  ) => {
    n += 1;
    const { id } = (await rpc(s.dirigeantA, "capture.enregistrer", {
      tenantId: s.pmeA,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${s.m}-piece-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    const l = lectureDEssai({ clientMf: s.mfA, numero: `IMMO-${s.m}-${n}` });
    const extract = {
      ...l.extract,
      document_date: datePiece,
      articles: articles.map((a) => ({ ...a, unit_price_ttc: null, tax_code: null })),
    };
    await sousIdentiteDuServeur(s.dirigeantA.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract,
              citations: l.citations,
              flags: [],
              articles: extract.articles,
              documentKind: "facture_achat",
              documentDate: datePiece,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await rpc(s.dirigeantA, "capture.analyser", id);
    await rpc(s.dirigeantA, "collab.setPieceVis", id, "partage");
    return id;
  };

  /** Le dernier jugement d'une pièce : ses contrôles, et s'il est à jour des réglages. */
  const derniere = async (id: string) =>
    (
      await admin.query<{
        controles: Array<{ code: string; statut: string; preuves: Record<string, unknown> }>;
        a_jour: boolean;
      }>(
        `select a.controles, app.reglages_du_jugement_a_jour(a.tenant_id, a.controles) as a_jour
           from capture.analyses a where a.piece_id = $1 order by a.created_at desc limit 1`,
        [id],
      )
    ).rows[0]!;
  const immo = (j: Awaited<ReturnType<typeof derniere>>) =>
    j.controles
      .filter((c) => c.code.startsWith("immobilisation_"))
      .map((c) => [c.code, c.statut, c.preuves["traitement"]]);

  it("le seuil du dossier juge la pièce ; changé, il périme le jugement, qui se rejuge", async () => {
    const s = await monter();
    // Une pièce d'un mois déjà passé de l'exercice (la date du jour sinon).
    const mois = Number(s.jour.slice(5, 7));
    const datePiece =
      mois > 1 ? `${s.jour.slice(0, 4)}-${String(mois - 1).padStart(2, "0")}-15` : s.jour;
    const id = await achatLu(s, datePiece, [
      {
        designation: "Mobilier de bureau",
        quantity: "1",
        unit_price_ht: "150.000",
        total_ht: "150.000",
      },
    ]);
    // Le pack : 150 HT sous le seuil, à l'actif — une réserve, à jour.
    const avant = await derniere(id);
    assert.deepEqual(immo(avant), [["immobilisation_faible_valeur", "reserve", "actif_amorti"]]);
    assert.equal(avant.a_jour, true);

    // Le cabinet passe le dossier en charge, depuis le début de l'exercice.
    const debut = (await s.lire(s.expert, s.pmeA)).debutExercice;
    assert.ok(debut <= datePiece);
    await s.arreter(
      s.expert,
      "dossier",
      s.pmeA,
      [{ code: "immobilisation.traitement", valeur: "charge" }],
      { depuis: debut },
    );
    // Le jugement est périmé : il ne se garde pas en silence.
    assert.equal((await derniere(id)).a_jour, false);
    // L'ouverture le rejuge, aux réglages du jour.
    await rpc(s.expert, "office.propositionDePiece", id);
    const apres = await derniere(id);
    assert.deepEqual(immo(apres), [["immobilisation_faible_valeur", "conforme", "charge"]]);
    assert.equal(apres.a_jour, true);
  });

  it("un bien d'équipement au-dessus du seuil ne part jamais en charge sans la réserve (cas 071)", async () => {
    // Recette, cas 071 du jeu synthétique : un photocopieur de 10 200 TND
    // partait en charge (605) sans réserve. Le Socle ne tranche pas
    // l'immobilisation (`actif_amorti` n'est pas appliqué) : il le dit.
    const s = await monter();
    for (const designation of ["Photocopieur multifonction A3", "Copieur multifonction A3"]) {
      const id = await achatLu(s, s.jour, [
        { designation, quantity: "2", unit_price_ht: "617.280", total_ht: "1234.560" },
      ]);
      const p = (await rpc(s.expert, "office.propositionDePiece", id)) as {
        ok: boolean;
        proposition?: { lignes: Array<{ account_code: string }> };
      };
      assert.equal(p.ok, true, designation);
      assert.deepEqual(
        immo(await derniere(id)).map(([code, statut]) => [code, statut]),
        [["immobilisation_a_trancher", "reserve"]],
        `${designation} → ${p.proposition?.lignes.map((l) => l.account_code).join(" ")}`,
      );
    }
  });

  it("un copieur jugé avant que le référentiel le reconnaisse se rejuge à l'ouverture", async () => {
    // Revue de #173 : le motif « copieur » (20261114090000) n'a pas changé les
    // règles du jugement ; une pièce jugée avant gardait, à l'ouverture, sa
    // proposition en charge sans réserve. Le jugement d'avant se simule : le
    // dernier, recopié sans le contrôle d'immobilisation, sous la version
    // que portent les pièces jugées avant le motif.
    const s = await monter();
    const id = await achatLu(s, s.jour, [
      {
        designation: "Copieur multifonction A3",
        quantity: "2",
        unit_price_ht: "617.280",
        total_ht: "1234.560",
      },
    ]);
    const jugeeAvantLeMotif = async (regles: string) => {
      // Sans la réserve d'immobilisation, la seule de la pièce : le verdict
      // d'alors, motivé par les contrôles conformes.
      await admin.query(
        `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                       normalisation, controles, verdict, motifs,
                                       doublon_numero, doublon_mf, doublon_lu, regles)
         select a.tenant_id, a.piece_id, a.extraction_id, a.pack_version_id, a.normalisation,
                k.controles, 'à comptabiliser',
                (select jsonb_agg(jsonb_build_object('code', c -> 'code', 'statut', c -> 'statut',
                                                     'motif', c -> 'motif'))
                   from jsonb_array_elements(k.controles) c where c ->> 'statut' = 'conforme'),
                a.doublon_numero, a.doublon_mf, a.doublon_lu, $2
           from (select * from capture.analyses where piece_id = $1
                  order by created_at desc limit 1) a
          cross join lateral (
                select jsonb_agg(c) as controles from jsonb_array_elements(a.controles) c
                 where c ->> 'code' not like 'immobilisation\\_%') k`,
        [id, regles],
      );
      assert.deepEqual(
        (await derniere(id)).controles.filter((c) => c.statut !== "conforme"),
        [],
        "le jugement d'avant le motif ne porte aucune réserve",
      );
      assert.deepEqual(immo(await derniere(id)), []);
    };
    const ouverte = async () => {
      await rpc(s.expert, "office.propositionDePiece", id);
      return immo(await derniere(id)).map(([code, statut]) => [code, statut]);
    };
    // Sous le marqueur que portent les pièces jugées avant le motif.
    await jugeeAvantLeMotif(REGLES_DU_JUGEMENT);
    assert.deepEqual(await ouverte(), [["immobilisation_a_trancher", "reserve"]]);

    // Sous la version d'un référentiel SANS le motif : le même code, un mot
    // de moins. Elle se lit dans une transaction annulée — aucune autre
    // épreuve ne voit le référentiel amputé.
    const client = await admin.connect();
    let sansLeMotif = "";
    let duJour = "";
    try {
      await client.query("begin");
      const { rowCount } = await client.query(
        `delete from ref.biens_immobilisables where motif like '%copieu(r|rs|se|ses)%'
            and motif not like '%photocopieu%'`,
      );
      assert.ok(rowCount && rowCount > 0, "le motif « copieur » est au référentiel");
      sansLeMotif = await versionDuJugement(client);
      await client.query("rollback");
      duJour = await versionDuJugement(client);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
    assert.notEqual(sansLeMotif, duJour, "le motif entre dans la version du jugement");
    assert.ok(duJour.startsWith(`${REGLES_DU_JUGEMENT}+`));
    await jugeeAvantLeMotif(sansLeMotif);
    assert.deepEqual(await ouverte(), [["immobilisation_a_trancher", "reserve"]]);
    // Rejugée, la pièce est à jour : la seconde ouverture ne recalcule rien.
    const { rows: avant } = await admin.query<{ n: number }>(
      `select count(*)::int as n from capture.analyses where piece_id = $1`,
      [id],
    );
    await ouverte();
    const { rows: apres } = await admin.query<{ n: number; regles: string }>(
      `select (select count(*)::int from capture.analyses where piece_id = $1) as n,
              (select regles from capture.analyses where piece_id = $1
                order by created_at desc limit 1) as regles`,
      [id],
    );
    assert.deepEqual(apres[0], { n: avant[0]!.n, regles: duJour });
  });

  it("le FODEC d'achat va au coût par défaut, au compte non récupérable si le cabinet le choisit", async () => {
    const s = await monter();
    const auCout = () =>
      sousIdentite(s.dirigeantB.id, async (db) =>
        droitsAuCout(db, await lireLesReglagesComptables(db, s.pmeB, packId, s.jour)),
      );
    const { rows } = await admin.query<{ droit: string }>(
      `select droit_hors_tva as droit from ref.reglages_comptables_sujets where code = 'fodec'`,
    );
    assert.deepEqual(await auCout(), [rows[0]!.droit]);
    await s.arreter(s.expert, "dossier", s.pmeB, [
      { code: "fodec.traitement", valeur: "charge_non_recuperable" },
    ]);
    assert.deepEqual(await auCout(), []);
  });
});
