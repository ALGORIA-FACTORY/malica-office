/**
 * La TVA déductible sur IMMOBILISATIONS se déclare à part (3 novembre 2026).
 *
 * #140 marquait l'immobilisation d'une écriture forcée, mais le contrat
 * extract.v1 retirait la marque : la TVA du mois ne pouvait pas la montrer.
 * Une facture mêlée la perdait (`bool_and`), une lecture validée n'en avait
 * aucune, et la TVA du CABINET lisait la lecture d'une pièce forcée — elle ne
 * recoupait pas son propre journal.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-tva-des-immobilisations-se-declare-a-part.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import type { TvaV1 } from "@malica/socle/contracts/tva.v1";
import { tvaDesExtraits } from "@malica/socle/engines/tva/des-extraits";
import type { DeclarationTva, TaxRate } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la TVA des immobilisations se déclare à part", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `immo-tva-${Date.now()}`;
  // Une famille d'essai, reconnue par un mot que rien d'autre n'emploie.
  const FAMILLE = `IMMO_ESSAI_${Date.now()}`;
  const MOT = `immoessai${Date.now()}`;
  const mfDossier = matriculeDEssai("A", "M");
  const mdp = "MotDePasseTresLong2026!";
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let packId = "";
  let jour = "";
  let IMMO = "";
  let AUTRE = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const pmeFait = (methode: string, ...args: unknown[]) => rpc(dirigeant, methode, ...args);
  const cabinetFait = (methode: string, ...args: unknown[]) => rpc(expert, methode, ...args);

  let n = 0;
  /** Une pièce lue (TVA19 : HT 1 234,560, TVA 234,566, timbre 1,000), jugée, transmise. */
  const transmise = async (extrait?: (e: Record<string, unknown>) => Record<string, unknown>) => {
    n += 1;
    const { id } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    const l = lectureDEssai({ clientMf: mfDossier, numero: `IMMO-${marque}-${n}` });
    const extract = extrait ? extrait(l.extract) : l.extract;
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
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
              articles: (extract["articles"] as unknown[] | undefined) ?? [],
              documentKind: "facture_achat",
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", id);
    await pmeFait("collab.setPieceVis", id, "partage");
    return id;
  };

  const L = (compte: string, debit: string, credit: string, taxe: string | null = null) => ({
    account_code: compte,
    libelle: compte,
    debit,
    credit,
    tax_code: taxe,
  });
  /** Forcer l'écriture d'une pièce ; une vente établit son sens au passage. */
  const force = (pieceId: string, lignes: unknown[], typeDeDocument?: string) =>
    cabinetFait("office.forcer", {
      pieceId,
      journal: typeDeDocument === "facture_vente" ? "VEN" : "ACH",
      date: jour,
      libelle: "Facture saisie par le cabinet",
      lignes,
      typeDeDocument: typeDeDocument ?? null,
    }) as Promise<string>;

  /** Une écriture proposée sur la pièce, à ce jour. */
  const proposer = (db: Parameters<typeof office.propose>[0], pieceId: string, lignes: unknown[]) =>
    office.propose(db, {
      pieceId,
      journal: "ACH",
      date: jour,
      libelle: "Facture d'essai",
      packVersionId: packId,
      devise: "TND",
      lignes,
    });
  /**
   * Une pièce lue qui compte dans le mois sans être prise en charge : une
   * écriture lui est proposée (statut « proposée »), ni validée ni forcée.
   */
  const proposee = async (extrait?: (e: Record<string, unknown>) => Record<string, unknown>) => {
    const id = await transmise(extrait);
    await sousIdentite(expert.id, (db) =>
      proposer(db, id, [
        L("601", "1234.560", "0"),
        L("4366", "234.566", "0", "TVA19"),
        L("401", "0", "1469.126"),
      ]),
    );
    return id;
  };

  /** Les lignes de TVA d'une pièce telles que la TVA du mois les reçoit (contrat validé). */
  const lignesDeLaTva = async (id: string, depot: "extraitsTransmis" | "bookedExtracts") => {
    const tous = (await (depot === "extraitsTransmis" ? pmeFait : cabinetFait)(
      `office.${depot}`,
      pme,
      "2000-01-01",
      "2100-12-31",
    )) as Array<{ pieceId: string; extract: unknown }>;
    const lu = ExtractV1.safeParse(tous.find((e) => e.pieceId === id)?.extract);
    assert.ok(lu.success, JSON.stringify(lu.error?.issues));
    return lu.data.lines.map((l) => [
      l.tax_code,
      l.base_ht,
      l.vat_amount,
      l.nature,
      l.nature_attribuee,
    ]);
  };

  /** La TVA du dossier, par le SEUL calcul de l'application. */
  const tvaDuCabinet = async (): Promise<TvaV1> => {
    const rows = (await cabinetFait(
      "office.bookedExtracts",
      pme,
      "2000-01-01",
      "2100-12-31",
    )) as Array<{
      pieceId: string;
      extract: unknown;
    }>;
    const taux = (await cabinetFait("referentiel.taxRates", packId, "TN")) as TaxRate[];
    const declaration = (await cabinetFait(
      "referentiel.declarationTva",
      packId,
      jour,
      "fr",
    )) as DeclarationTva;
    return tvaDesExtraits({
      period: jour.slice(0, 7),
      currency: { code: "TND", decimals: 3 },
      taux,
      declaration,
      rows,
    });
  };
  const ligneDe = (tva: TvaV1, nature: string) =>
    tva.declaration.find((l) => l.sens === "deductible" && l.nature === nature);

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, mdp);
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME D'ESSAI ${marque}`, mfDossier);
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mfDossier));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
    // Les natures viennent du référentiel : l'épreuve n'en écrit aucune.
    const natures = await admin.query<{ code: string; immobilisation: boolean }>(
      `select code, immobilisation from ref.tva_natures`,
    );
    IMMO = natures.rows.find((r) => r.immobilisation)!.code;
    AUTRE = natures.rows.find((r) => !r.immobilisation)!.code;
    // Une famille d'articles dont le compte est une immobilisation (2282) :
    // la lecture la reconnaît par le référentiel, jamais par un mot du code.
    await admin.query(
      `insert into ref.charge_familles
         (pack_version_id, code, label, ordinal, is_fallback, valid_from, main_account)
       values ($1, $2, 'Famille d''essai', 999, false, date '2020-01-01', '2282')`,
      [packId, FAMILLE],
    );
    await admin.query(
      `insert into ref.charge_famille_rules
         (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
       values ($1, $2, 'designation_pattern', $3, 1, date '2020-01-01')`,
      [packId, FAMILLE, MOT],
    );
  });

  after(async () => {
    try {
      await admin.query(`delete from ref.charge_famille_rules where famille_code = $1`, [FAMILLE]);
      await admin.query(`delete from ref.charge_familles where code = $1`, [FAMILLE]);
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  let forceeImmo = "";
  let forceeMelee = "";
  let valideeImmo = "";

  it("un achat d'immobilisation forcé par le cabinet va sur la ligne des immobilisations", async () => {
    forceeImmo = await transmise();
    await force(forceeImmo, [
      L("2282", "1000.000", "0"),
      L("4366", "190.000", "0", "TVA19"),
      L("401", "0", "1190.000"),
    ]);
    for (const depot of ["extraitsTransmis", "bookedExtracts"] as const)
      assert.deepEqual(
        await lignesDeLaTva(forceeImmo, depot),
        [["TVA19", "1000.000", "190.000", IMMO, true]],
        depot,
      );
  });

  it("une facture mêlée forcée (immobilisation et charge au même taux) se partage par nature", async () => {
    forceeMelee = await transmise();
    await force(forceeMelee, [
      L("2282", "1000.000", "0"),
      L("601", "200.000", "0"),
      L("4366", "228.000", "0", "TVA19"),
      L("401", "0", "1428.000"),
    ]);
    assert.deepEqual(await lignesDeLaTva(forceeMelee, "bookedExtracts"), [
      ["TVA19", "1000.000", "190.000", IMMO, true],
      ["TVA19", "200.000", "38.000", AUTRE, true],
    ]);
  });

  it("une lecture VALIDÉE dont la proposition porte une immobilisation : la lecture, rangée en immobilisation", async () => {
    valideeImmo = await transmise();
    // Le cabinet inscrit la proposition telle quelle, sans la changer : la
    // pièce est prise en charge « Validée » (app.ecriture_prise_en_charge).
    await sousIdentite(expert.id, async (db) => {
      // R2 : le cabinet établit le type lu avant toute inscription.
      await db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [valideeImmo]);
      await office.book(
        db,
        await proposer(db, valideeImmo, [
          L("2282", "1234.560", "0"),
          L("4366", "234.566", "0", "TVA19"),
          L("401", "0", "1469.126"),
        ]),
      );
    });
    const fiche = (await cabinetFait("capture.dossier", valideeImmo)) as {
      suivi: { prise: string | null } | null;
    };
    assert.equal(fiche.suivi?.prise, "validee");
    // Les montants restent ceux de la LECTURE (#140) ; la nature, celle des comptes validés.
    assert.deepEqual(await lignesDeLaTva(valideeImmo, "extraitsTransmis"), [
      ["TVA19", "1234.560", "234.566", IMMO, true],
    ]);
  });

  it("une lecture mêlée se partage par ses articles chiffrés, rangés au plan", async () => {
    const id = await proposee((e) => ({
      ...e,
      articles: [
        { designation: `${MOT} poste`, quantity: "1", total_ht: "1000.000", tax_code: "TVA19" },
        {
          designation: "Ramettes de papier",
          quantity: "10",
          total_ht: "234.560",
          tax_code: "TVA19",
        },
      ],
    }));
    // « Vos charges » : le papier, pas le poste — une immobilisation n'est
    // jamais une charge du mois, lue comme forcée.
    const articles = (await pmeFait("charges.articles", pme, "2000-01", "2100-12")) as Array<{
      pieceId: string;
      designation: string;
    }>;
    assert.deepEqual(
      articles.filter((a) => a.pieceId === id).map((a) => a.designation),
      ["Ramettes de papier"],
    );
    assert.deepEqual(await lignesDeLaTva(id, "extraitsTransmis"), [
      ["TVA19", "1000.000", "190.000", IMMO, true],
      ["TVA19", "234.560", "44.566", AUTRE, true],
    ]);
  });

  it("une immobilisation lue sans montant : la pièce reste en biens et services, signalée et comptée", async () => {
    const id = await proposee((e) => ({
      ...e,
      articles: [
        { designation: `${MOT} serveur`, quantity: "1", tax_code: "TVA19" },
        {
          designation: "Ramettes de papier",
          quantity: "10",
          total_ht: "234.560",
          tax_code: "TVA19",
        },
      ],
    }));
    const [ligne] = await lignesDeLaTva(id, "extraitsTransmis");
    const defaut = (
      await admin.query<{ code: string }>(`select code from ref.tva_natures where par_defaut`)
    ).rows[0]!.code;
    assert.deepEqual(ligne, ["TVA19", "1234.560", "234.566", defaut, false]);
  });

  it("une pièce ordinaire, sans article d'immobilisation : biens et services, attribuée", async () => {
    const id = await proposee();
    assert.deepEqual(await lignesDeLaTva(id, "extraitsTransmis"), [
      ["TVA19", "1234.560", "234.566", AUTRE, true],
    ]);
  });

  it("la TVA du cabinet est celle du journal du jour, et ses lignes la partagent par nature", async () => {
    assert.ok(forceeImmo && forceeMelee && valideeImmo, "les trois pièces inscrites plus haut");
    const journal = (await cabinetFait("journalDuJour.lire", cabinet, pme, jour, "fr")) as {
      journaux: Array<{ ecritures: Array<{ lignes: Array<{ compte: string; debit: string }> }> }>;
    };
    // La TVA déductible au journal : les débits des comptes de TVA déductible
    // du pack (préfixe du rôle, lu au référentiel).
    const prefixe = (
      await admin.query<{ c: string }>(
        `select account_code as c from ref.role_bindings
          where pack_version_id = $1 and role_code = 'TVA_DEDUCTIBLE'`,
        [packId],
      )
    ).rows[0]!.c;
    const millimes = (v: string) => Math.round(Number(v) * 1000);
    const auJournal = journal.journaux
      .flatMap((j) => j.ecritures)
      .flatMap((e) => e.lignes)
      .filter((l) => l.compte.startsWith(prefixe))
      .reduce((s, l) => s + millimes(l.debit), 0);
    const tva = await tvaDuCabinet();
    assert.equal(millimes(tva.totals.deductible), auJournal, "la TVA du dossier = son journal");
    assert.equal(auJournal, millimes("652.566"));
    assert.equal(ligneDe(tva, IMMO)?.vat, "614.566", "190 + 190 + 234,566");
    assert.equal(ligneDe(tva, AUTRE)?.vat, "38.000");
    assert.deepEqual(tva.refused, []);
    assert.deepEqual(tva.par_defaut, []);
  });

  it("le référentiel dit ses lignes en trois langues, datées, et marquées à confirmer", async () => {
    for (const locale of ["fr", "en", "ar"]) {
      const d = (await pmeFait(
        "referentiel.declarationTva",
        packId,
        jour,
        locale,
      )) as DeclarationTva;
      assert.ok(
        d.lignes.some((l) => l.sens === "deductible" && l.nature === IMMO),
        locale,
      );
      assert.ok(
        d.lignes.every((l) => l.label.length > 0 && l.incertain),
        locale,
      );
    }
    const ar = (await pmeFait("referentiel.declarationTva", packId, jour, "ar")) as DeclarationTva;
    assert.match(ar.lignes[0]!.label, /[؀-ۿ]/);
    // Chaque langue rend SA traduction, jamais le français par repli.
    const { rows: libelles } = await admin.query<{ key: string; locale: string; value: string }>(
      `select key, locale, value from ref.labels where ns = 'tva_declaration_ligne'`,
    );
    for (const locale of ["en", "ar"]) {
      const d = (await pmeFait(
        "referentiel.declarationTva",
        packId,
        jour,
        locale,
      )) as DeclarationTva;
      for (const l of d.lignes) {
        const attendu = libelles.find((x) => x.key === l.code && x.locale === locale)?.value;
        const fr = libelles.find((x) => x.key === l.code && x.locale === "fr")?.value;
        assert.ok(attendu, `${l.code} a une traduction ${locale}`);
        assert.equal(l.label, attendu, `${l.code} en ${locale}`);
        assert.notEqual(l.label, fr, `${l.code} en ${locale} n'est pas le français`);
      }
    }
  });

  /*
   * Revue indépendante de #145 (30 octobre 2026). Placées APRÈS l'épreuve du
   * journal : leurs écritures ne changent pas ses sommes attendues.
   */
  const deuxLignes = (e: Record<string, unknown>) => ({
    ...e,
    lines: [
      {
        label: "a",
        tax_code: "TVA19",
        base_ht: "1000.000",
        vat_amount: "190.000",
        ttc: "1190.000",
      },
      { label: "b", tax_code: "TVA19", base_ht: "234.560", vat_amount: "44.566", ttc: "279.126" },
    ],
  });
  /** Le cabinet inscrit telle quelle une écriture : la pièce est « Validée ». */
  const valideeAvec = async (id: string, lignes: unknown[]) =>
    sousIdentite(expert.id, async (db) => {
      await db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [id]);
      await office.book(db, await proposer(db, id, lignes));
    });

  it("P2-1 : validée tout immobilisation, deux lignes lues au même taux : les deux en immobilisation", async () => {
    const id = await transmise(deuxLignes);
    await valideeAvec(id, [
      L("2282", "1234.560", "0"),
      L("4366", "234.566", "0", "TVA19"),
      L("401", "0", "1469.126"),
    ]);
    assert.deepEqual(await lignesDeLaTva(id, "extraitsTransmis"), [
      ["TVA19", "1000.000", "190.000", IMMO, true],
      ["TVA19", "234.560", "44.566", IMMO, true],
    ]);
  });

  it("P2-1 : lue tout immobilisation par ses articles, deux lignes au même taux", async () => {
    const id = await proposee((e) => ({
      ...deuxLignes(e),
      articles: [
        { designation: `${MOT} a`, quantity: "1", total_ht: "1000.000", tax_code: "TVA19" },
        { designation: `${MOT} b`, quantity: "1", total_ht: "234.560", tax_code: "TVA19" },
      ],
    }));
    assert.deepEqual(await lignesDeLaTva(id, "extraitsTransmis"), [
      ["TVA19", "1000.000", "190.000", IMMO, true],
      ["TVA19", "234.560", "44.566", IMMO, true],
    ]);
  });

  it("P2-1 : une part partielle se répartit ligne à ligne, sans perdre un millime", async () => {
    // 617,280 d'immobilisation sur 1 234,560 : la moitié de chaque ligne.
    const id = await proposee((e) => ({
      ...deuxLignes(e),
      articles: [
        { designation: `${MOT} a`, quantity: "1", total_ht: "617.280", tax_code: "TVA19" },
        {
          designation: "Ramettes de papier",
          quantity: "1",
          total_ht: "617.280",
          tax_code: "TVA19",
        },
      ],
    }));
    const lignes = await lignesDeLaTva(id, "extraitsTransmis");
    assert.deepEqual(lignes, [
      ["TVA19", "500.000", "95.000", IMMO, true],
      ["TVA19", "500.000", "95.000", AUTRE, true],
      ["TVA19", "117.280", "22.283", IMMO, true],
      ["TVA19", "117.280", "22.283", AUTRE, true],
    ]);
    const millimes = (i: number) => lignes.reduce((s, l) => s + Math.round(Number(l[i]) * 1000), 0);
    assert.equal(millimes(1), 1234560, "aucun millime de base perdu");
    assert.equal(millimes(2), 234566, "aucun millime de TVA perdu");
  });

  it("P2-2 : un avoir lu sur une immobilisation se range en immobilisation", async () => {
    const id = await transmise((e) => ({
      ...e,
      lines: [
        {
          label: "a",
          tax_code: "TVA19",
          base_ht: "-1000.000",
          vat_amount: "-190.000",
          ttc: "-1190.000",
        },
      ],
      other_charges: [],
      totals: { base_ht: "-1000.000", vat: "-190.000", ttc: "-1190.000" },
      articles: [
        { designation: `${MOT} avoir`, quantity: "1", total_ht: "-1000.000", tax_code: "TVA19" },
      ],
    }));
    await sousIdentite(expert.id, (db) =>
      proposer(db, id, [
        L("401", "1190.000", "0"),
        L("2282", "0", "1000.000"),
        L("4366", "0", "190.000", "TVA19"),
      ]),
    );
    assert.deepEqual(await lignesDeLaTva(id, "extraitsTransmis"), [
      ["TVA19", "-1000.000", "-190.000", IMMO, true],
    ]);
  });

  it("P2-2 : un avoir forcé par le cabinet sur une immobilisation : ses comptes décident", async () => {
    const id = await transmise((e) => ({
      ...e,
      lines: [
        {
          label: "a",
          tax_code: "TVA19",
          base_ht: "-1000.000",
          vat_amount: "-190.000",
          ttc: "-1190.000",
        },
      ],
      other_charges: [],
      totals: { base_ht: "-1000.000", vat: "-190.000", ttc: "-1190.000" },
    }));
    await force(id, [
      L("401", "1190.000", "0"),
      L("2282", "0", "1000.000"),
      L("4366", "0", "190.000", "TVA19"),
    ]);
    // Un avoir ne se lit pas comme une facture (#140) : la lecture reste,
    // rangée par les comptes de l'écriture forcée.
    assert.deepEqual(await lignesDeLaTva(id, "bookedExtracts"), [
      ["TVA19", "-1000.000", "-190.000", IMMO, true],
    ]);
  });

  it("P2-3 : validée en charge (601) quand la famille de l'article est une immobilisation : l'écriture décide", async () => {
    const id = await transmise((e) => ({
      ...e,
      articles: [
        { designation: `${MOT} logiciel`, quantity: "1", total_ht: "1234.560", tax_code: "TVA19" },
      ],
    }));
    await valideeAvec(id, [
      L("601", "1234.560", "0"),
      L("4366", "234.566", "0", "TVA19"),
      L("401", "0", "1469.126"),
    ]);
    const articles = (await pmeFait("charges.articles", pme, "2000-01", "2100-12")) as Array<{
      pieceId: string;
      designation: string;
    }>;
    assert.deepEqual(
      articles.filter((a) => a.pieceId === id).map((a) => a.designation),
      [`${MOT} logiciel`],
      "le journal la porte en charge : « Vos charges » aussi",
    );
    assert.deepEqual(await lignesDeLaTva(id, "extraitsTransmis"), [
      ["TVA19", "1234.560", "234.566", AUTRE, true],
    ]);
  });

  it("une vente forcée au cabinet : sur la ligne collectée, jamais en immobilisation", async () => {
    const id = await transmise();
    await force(
      id,
      [
        L("411", "1191.000", "0"),
        L("707", "0", "1000.000"),
        L("4367", "0", "190.000", "TVA19"),
        L("4371", "0", "1.000"),
      ],
      "facture_vente",
    );
    assert.deepEqual(await lignesDeLaTva(id, "bookedExtracts"), [
      ["TVA19", "1000.000", "190.000", AUTRE, true],
    ]);
    const tva = await tvaDuCabinet();
    const collectee = tva.declaration.find((l) => l.sens === "collectee");
    assert.equal(collectee?.vat, "190.000");
    assert.equal(tva.totals.collectee, "190.000");
  });

  it("une porte réservée : les familles d'immobilisation d'un dossier étranger sont refusées", async () => {
    const intrus = (await creerCompte(`intrus-${marque}@essai.local`, mdp))!;
    await assert.rejects(
      sousIdentite(intrus.id, (db) =>
        db.query(`select app.familles_immobilisees($1, $2, 'facture_achat', $3::date)`, [
          pme,
          packId,
          jour,
        ]),
      ),
      /hors de portée/,
    );
    // Et la porte des extraits ne rend rien d'une pièce qu'il ne lit pas.
    const { rows } = await admin.query<{ piece_id: string }>(
      `select p.id as piece_id from capture.pieces p where p.tenant_id = $1 limit 1`,
      [pme],
    );
    const lu = await sousIdentite(
      intrus.id,
      async (db) =>
        (
          await db.query<{ payload: unknown }>(
            `select payload from app.extraits_de_la_tva(jsonb_build_array(jsonb_build_object(
             'piece_id', $1::text, 'payload', '{"lines":[]}'::jsonb)))`,
            [rows[0]!.piece_id],
          )
        ).rows,
    );
    assert.deepEqual(lu, [{ payload: null }]);
  });
});
