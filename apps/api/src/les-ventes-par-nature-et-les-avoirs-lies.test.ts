/**
 * Deux réglages du CEO (31 octobre 2026) qui n'étaient qu'enregistrés, et
 * qui s'appliquent (1er novembre 2026) :
 *
 *   ventes.compte      = par_nature_article : une prestation en 705, une
 *                        marchandise en 707, une facture mêlée ventilée par
 *                        nature, une nature inconnue au repli avec sa réserve ;
 *                        `unique_cabinet` : un seul compte, celui du cabinet.
 *   avoirs.traitement  = lie_facture : un avoir se lie à sa facture par le
 *                        numéro qu'il imprime, ou par le geste du cabinet, et
 *                        se propose en contre-passation de son écriture ; sans
 *                        facture comptabilisée, rien ne se propose.
 *
 * Toutes ces épreuves échouaient avant : la vente partait au 701, l'avoir était
 * refusé (« à saisir par le cabinet »).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/les-ventes-par-nature-et-les-avoirs-lies.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PropositionDePiece } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

type Ligne = [string, string, string, string | null];

describe("les ventes par nature, les avoirs liés", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `ventes-avoirs-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const archiver: string[] = [];
  let packId = "";
  let n = 0;
  /** Le compte d'un rôle au pack : les épreuves ne recopient aucun compte. */
  const compte: Record<string, string> = {};

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  /** Un cabinet, un dossier qu'il tient, son dirigeant, et un cabinet étranger. */
  const monter = async () => {
    n += 1;
    const m = `${marque}-${n}`;
    const mf = matriculeDEssai("A", "M");
    const [dirigeant, expert, etranger] = await Promise.all([
      creerCompte(`dirigeant-${m}@essai.local`, mdp),
      creerCompte(`expert-${m}@essai.local`, mdp),
      creerCompte(`etranger-${m}@essai.local`, mdp),
    ]);
    assert.ok(dirigeant && expert && etranger);
    const creer = (u: Utilisateur, kind: string, nom: string, mfOrg: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mfOrg],
        );
        return rows[0]!.id;
      });
    const nomDuDossier = `PME D'ESSAI ${m}`;
    const pme = await creer(dirigeant, "pme", nomDuDossier, mf);
    const cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${m}`, null);
    const autre = await creer(etranger, "cabinet", `AUTRE CABINET D'ESSAI ${m}`, null);
    archiver.push(pme, cabinet, autre);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));

    /** Une pièce lue, jugée, et partagée avec le cabinet. */
    const piece = async (
      sens: "facture_achat" | "facture_vente",
      opts: Parameters<typeof lectureDEssai>[0] & {
        articles?: Array<{ designation: string; total_ht?: string; tax_code?: string }>;
        factureDOrigine?: string;
      },
    ) => {
      const l = lectureDEssai({ ...opts, ...(sens === "facture_achat" ? { clientMf: mf } : {}) });
      // Une vente : le dossier émet, un client fictif reçoit.
      const client = matriculeDEssai("B", "M");
      const tokens =
        sens === "facture_vente"
          ? l.tokens.map((t) =>
              t.ordinal === 3 ? { ...t, text: mf } : t.ordinal === 6 ? { ...t, text: client } : t,
            )
          : l.tokens;
      const extract = {
        ...l.extract,
        ...(sens === "facture_vente" ? { issuer: nomDuDossier } : {}),
        document_kind: sens,
        references: {
          ...l.extract.references,
          ...(sens === "facture_vente"
            ? { matricule_fiscal: mf, matricule_fiscal_client: client }
            : {}),
          ...(opts.factureDOrigine ? { facture_d_origine: opts.factureDOrigine } : {}),
        },
        articles: (opts.articles ?? []).map((a) => ({
          designation: a.designation,
          quantity: null,
          unit_price_ht: null,
          unit_price_ttc: null,
          total_ht: a.total_ht ?? null,
          tax_code: a.tax_code ?? null,
        })),
      };
      const { id } = (await rpc(dirigeant, "capture.enregistrer", {
        tenantId: pme,
        source: "pdf",
        vis: "entite",
        idempotencyKey: `${m}-${extract.references.numero}`,
        contentType: "application/pdf",
        pageCount: 1,
      })) as { id: string };
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
                tokens,
                contract: "extract.v1",
                extract,
                citations: l.citations,
                flags: [],
                articles: extract.articles,
                documentKind: sens,
                documentDate: extract.document_date,
                mode: "pdf-text",
                confianceParChamp: { "totals.ttc": 0.95 },
              },
            ],
          },
          "serveur",
        ),
      );
      await rpc(dirigeant, "capture.analyser", id);
      await rpc(dirigeant, "collab.setPieceVis", id, "partage");
      return id;
    };
    const proposition = (id: string) =>
      rpc(expert, "office.propositionDePiece", id) as Promise<
        PropositionDePiece & { empreinte?: string }
      >;
    const lignes = (p: PropositionDePiece): Ligne[] => {
      assert.ok(p.ok, `aucune écriture : ${"raison" in p ? p.raison : ""}`);
      return p.proposition.lignes
        .map((l): Ligne => [l.account_code, l.debit, l.credit, l.tax_code])
        .sort((a, b) => a.join("|").localeCompare(b.join("|")));
    };
    const valider = async (id: string) => {
      const p = await proposition(id);
      assert.ok(p.ok && p.empreinte, `rien à valider : ${"raison" in p ? p.raison : ""}`);
      return (await rpc(expert, "office.valider", id, p.empreinte)) as string;
    };
    const arreter = (code: string, valeur: string) =>
      rpc(expert, "parametrage.arreterReglagesComptables", {
        cabinetId: cabinet,
        portee: "dossier",
        porteeId: pme,
        packId,
        depuis: "2026-01-01",
        valeurs: [{ code, valeur }],
      });
    return {
      dirigeant,
      expert,
      etranger,
      pme,
      cabinet,
      autre,
      piece,
      proposition,
      lignes,
      valider,
      arreter,
      m,
    };
  };

  /** Une ligne attendue, triée comme `lignes`. */
  const trier = (xs: Ligne[]) => [...xs].sort((a, b) => a.join("|").localeCompare(b.join("|")));

  before(async () => {
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    const { rows } = await admin.query<{ role_code: string; account_code: string }>(
      `select role_code, account_code from ref.role_bindings where pack_version_id = $1`,
      [packId],
    );
    for (const r of rows) compte[r.role_code] = r.account_code;
    const { rows: m } = await admin.query<{
      document_kind: string;
      main_account: string;
      vat_account: string;
      counterparty_account: string;
    }>(
      `select document_kind, main_account, vat_account, counterparty_account
         from ref.account_mappings where pack_version_id = $1 and tax_code = 'TVA19'`,
      [packId],
    );
    for (const x of m) {
      compte[`${x.document_kind}.base`] = x.main_account;
      compte[`${x.document_kind}.tva`] = x.vat_account;
      compte[`${x.document_kind}.tiers`] = x.counterparty_account;
    }
    const { rows: t } = await admin.query<{ document_kind: string; account_code: string }>(
      `select document_kind, account_code from ref.fiscal_charges
        where pack_version_id = $1 and code = 'DROIT_TIMBRE' and valid_to is null`,
      [packId],
    );
    for (const x of t) compte[`${x.document_kind}.timbre`] = x.account_code;
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

  /* ------------------------------------------------------------------ les ventes */

  /** L'écriture d'une vente de la lecture d'essai, la base au compte dit. */
  const vente = (bases: Array<[string, string]>): Ligne[] =>
    trier([
      [compte["facture_vente.tiers"]!, "1470.126", "0", null],
      [compte["facture_vente.tva"]!, "0", "234.566", "TVA19"],
      [compte["facture_vente.timbre"]!, "0", "1.000", null],
      ...bases.map(([c, m]): Ligne => [c, "0", m, "TVA19"]),
    ]);

  it("chaque motif nomme une nature du même pack, et une seule nature est le repli", async () => {
    const { rows } = await admin.query<{ orphelins: number; replis: number }>(
      `select (select count(*)::int from ref.motifs_de_nature_de_vente m
                where not exists (select 1 from ref.natures_de_vente n
                                   where n.pack_version_id = m.pack_version_id
                                     and n.code = m.nature)) as orphelins,
              (select count(*)::int from ref.natures_de_vente
                where pack_version_id = $1 and repli and valid_to is null) as replis`,
      [packId],
    );
    assert.deepEqual(rows[0], { orphelins: 0, replis: 1 });
  });

  it("une prestation de services va en 705, une marchandise en 707", async () => {
    const s = await monter();
    const service = await s.piece("facture_vente", {
      numero: `V-${s.m}-1`,
      articles: [{ designation: "Prestation de maintenance" }],
    });
    assert.deepEqual(
      s.lignes(await s.proposition(service)),
      vente([[compte["VENTE_ETUDES_PRESTATIONS"]!, "1234.560"]]),
    );
    const marchandise = await s.piece("facture_vente", {
      numero: `V-${s.m}-2`,
      articles: [{ designation: "Farine de blé, sac 50 kg" }],
    });
    const p = await s.proposition(marchandise);
    assert.deepEqual(s.lignes(p), vente([[compte["VENTE_MARCHANDISES"]!, "1234.560"]]));
    assert.equal(p.ok && p.reserves, undefined);
  });

  it("une facture mêlée : une ligne de base par nature, chacune avec son code de taxe", async () => {
    const s = await monter();
    const id = await s.piece("facture_vente", {
      numero: `V-${s.m}-3`,
      articles: [
        { designation: "Prestation de maintenance", total_ht: "1000.000" },
        { designation: "Cartouche d'encre noire", total_ht: "234.560" },
      ],
    });
    assert.deepEqual(
      s.lignes(await s.proposition(id)),
      vente([
        [compte["VENTE_ETUDES_PRESTATIONS"]!, "1000.000"],
        [compte["VENTE_MARCHANDISES"]!, "234.560"],
      ]),
    );
  });

  it("une nature inconnue : le compte de repli, et la réserve « nature de la vente à préciser »", async () => {
    const s = await monter();
    const id = await s.piece("facture_vente", {
      numero: `V-${s.m}-4`,
      articles: [{ designation: "Médicament vétérinaire" }],
    });
    const p = await s.proposition(id);
    assert.deepEqual(s.lignes(p), vente([[compte["VENTE_PRODUITS_FINIS"]!, "1234.560"]]));
    assert.deepEqual(p.ok && p.reserves, [
      { code: "nature_de_vente", raison: "inconnue", articles: ["Médicament vétérinaire"] },
    ]);
    // Une facture mêlée que les articles ne ventilent pas : le repli, et la raison.
    const melee = await s.piece("facture_vente", {
      numero: `V-${s.m}-5`,
      articles: [
        { designation: "Prestation de maintenance", total_ht: "1000.000" },
        { designation: "Cartouche d'encre noire" },
      ],
    });
    const q = await s.proposition(melee);
    assert.deepEqual(s.lignes(q), vente([[compte["VENTE_PRODUITS_FINIS"]!, "1234.560"]]));
    const reserve = q.ok ? q.reserves?.[0] : undefined;
    assert.equal(reserve?.code === "nature_de_vente" && reserve.raison, "non_ventilable");
  });

  it("l'option « un compte unique » : toute vente au compte du cabinet, sans réserve", async () => {
    const s = await monter();
    await s.arreter("ventes.compte", "unique_cabinet");
    const id = await s.piece("facture_vente", {
      numero: `V-${s.m}-6`,
      articles: [
        { designation: "Prestation de maintenance", total_ht: "1000.000" },
        { designation: "Cartouche d'encre noire", total_ht: "234.560" },
      ],
    });
    const p = await s.proposition(id);
    assert.deepEqual(s.lignes(p), vente([[compte["VENTE_PRODUITS_FINIS"]!, "1234.560"]]));
    assert.equal(p.ok && p.reserves, undefined);
  });

  /* ------------------------------------------------------------------ les avoirs */

  /** La facture d'achat d'essai, VALIDÉE par le cabinet : son écriture est prise en charge. */
  const factureValidee = async (s: Awaited<ReturnType<typeof monter>>, numero: string) => {
    const id = await s.piece("facture_achat", { numero });
    await s.valider(id);
    return id;
  };
  const avoir = (
    s: Awaited<ReturnType<typeof monter>>,
    numero: string,
    opts: Parameters<Awaited<ReturnType<typeof monter>>["piece"]>[1] = {},
  ) => s.piece("facture_achat", { titre: `AVOIR N° ${numero}`, numero, ...opts });

  it("un avoir total, lié par le numéro qu'il imprime : l'extourne de la facture, au millime", async () => {
    const s = await monter();
    const facture = await factureValidee(s, `F-${s.m}-1`);
    const id = await avoir(s, `AV-${s.m}-1`, { factureDOrigine: `F-${s.m}-1` });
    const p = await s.proposition(id);
    assert.deepEqual(
      s.lignes(p),
      [
        [compte["facture_achat.tiers"]!, "1470.126", "0", null],
        [compte["facture_achat.tva"]!, "0", "234.566", "TVA19"],
        [compte["facture_achat.base"]!, "0", "1234.560", "TVA19"],
        [compte["facture_achat.timbre"]!, "0", "1.000", null],
      ].sort((a, b) => a.join("|").localeCompare(b.join("|"))) as Ligne[],
    );
    assert.deepEqual(p.ok && p.avoir, {
      facture,
      origine: "numero",
      lie: false,
      traitement: "extourne",
    });
    // VALIDER inscrit l'écriture, et le lien devient un fait.
    await s.valider(id);
    const { rows } = await admin.query<{ facture_piece_id: string; origine: string }>(
      `select facture_piece_id, origine from capture.avoirs_rattaches where piece_id = $1`,
      [id],
    );
    assert.deepEqual(rows, [{ facture_piece_id: facture, origine: "numero" }]);
    // Un fait ne se réécrit pas (R7).
    await assert.rejects(
      admin.query(`update capture.avoirs_rattaches set origine = 'cabinet' where piece_id = $1`, [
        id,
      ]),
      /refus\.avoir\.lien_immuable/,
    );
  });

  it("un avoir partiel : au compte des RRR obtenus, la TVA réduite de ce qu'il imprime", async () => {
    const s = await monter();
    await factureValidee(s, `F-${s.m}-2`);
    const id = await avoir(s, `AV-${s.m}-2`, {
      factureDOrigine: `F-${s.m}-2`,
      ht: ["1", "000,000"],
      tva: "190,000",
      ttc: ["1", "191,000"],
    });
    const p = await s.proposition(id);
    assert.deepEqual(
      s.lignes(p),
      trier([
        [compte["facture_achat.tiers"]!, "1191.000", "0", null],
        [compte["facture_achat.tva"]!, "0", "190.000", "TVA19"],
        [compte["RRR_OBTENUS"]!, "0", "1000.000", "TVA19"],
        [compte["facture_achat.timbre"]!, "0", "1.000", null],
      ]),
    );
    assert.equal(p.ok && p.avoir?.traitement, "rabais");
    // Le cabinet choisit l'extourne : la base revient à son compte d'origine.
    await s.arreter("avoirs.ecriture", "extourne");
    assert.deepEqual(
      s.lignes(await s.proposition(id)),
      trier([
        [compte["facture_achat.tiers"]!, "1191.000", "0", null],
        [compte["facture_achat.tva"]!, "0", "190.000", "TVA19"],
        [compte["facture_achat.base"]!, "0", "1000.000", "TVA19"],
        [compte["facture_achat.timbre"]!, "0", "1.000", null],
      ]),
    );
  });

  /*
   * Revue de #161 : le FODEC d'un achat porté au coût (le réglage par défaut,
   * `par_article_au_cout`) prend le compte de la charge ; l'avoir qui le
   * reprend était refusé (`avoir_hors_facture`), même en extourne exacte.
   * 1 234,560 HT, FODEC 1 % = 12,346, TVA 19 % sur 1 246,906 = 236,912,
   * timbre 1,000 : TTC 1 484,818.
   */
  it("le FODEC porté au coût : l'avoir total extourne la facture, le droit sur sa ligne", async () => {
    const s = await monter();
    const montants = { fodec: "12,346", tva: "236,912", ttc: ["1", "484,818"] as [string, string] };
    const facture = await s.piece("facture_achat", { numero: `F-${s.m}-7`, ...montants });
    const f = await s.proposition(facture);
    const charge = compte["facture_achat.base"]!;
    // La facture : le FODEC au compte de la charge, une ligne à part.
    assert.deepEqual(
      s.lignes(f).filter((l) => l[0] === charge),
      [
        [charge, "12.346", "0", null],
        [charge, "1234.560", "0", null],
      ],
    );
    await s.valider(facture);
    const id = await avoir(s, `AV-${s.m}-7`, { factureDOrigine: `F-${s.m}-7`, ...montants });
    const p = await s.proposition(id);
    assert.deepEqual(
      s.lignes(p),
      trier([
        [compte["facture_achat.tiers"]!, "1484.818", "0", null],
        [compte["facture_achat.tva"]!, "0", "236.912", "TVA19"],
        [charge, "0", "1234.560", "TVA19"],
        [charge, "0", "12.346", null],
        [compte["facture_achat.timbre"]!, "0", "1.000", null],
      ]),
    );
    assert.equal(p.ok && p.avoir?.traitement, "extourne");
    assert.equal(p.ok && p.reserves, undefined);
  });

  it("un avoir qui excède sa facture ne se propose jamais", async () => {
    const s = await monter();
    await factureValidee(s, `F-${s.m}-3`);
    const id = await avoir(s, `AV-${s.m}-3`, {
      factureDOrigine: `F-${s.m}-3`,
      ht: ["2", "000,000"],
      tva: "380,000",
      ttc: ["2", "381,000"],
    });
    const p = await s.proposition(id);
    assert.equal(p.ok, false);
    assert.equal(!p.ok && p.raisonCode, "avoir_excede_la_facture");
  });

  it("sans facture : « facture d'origine à rattacher » ; le geste du cabinet, et l'avoir se propose", async () => {
    const s = await monter();
    const facture = await factureValidee(s, `F-${s.m}-4`);
    const id = await avoir(s, `AV-${s.m}-4`);
    const p = await s.proposition(id);
    assert.deepEqual(!p.ok && [p.raisonCode, p.avoir?.manque], [
      "facture_d_origine",
      "introuvable",
    ]);
    // La liste du geste : la facture comptabilisée du dossier, et elle seule.
    const liste = (await rpc(s.expert, "office.facturesARattacher", id)) as Array<{ id: string }>;
    assert.deepEqual(
      liste.map((f) => f.id),
      [facture],
    );
    // Ni le dirigeant, ni un cabinet étranger ne rattachent.
    await assert.rejects(
      rpc(s.dirigeant, "office.rattacherLaFacture", id, facture),
      /refus\.avoir\.droits/,
    );
    await assert.rejects(
      rpc(s.etranger, "office.rattacherLaFacture", id, facture),
      /refus\.avoir\.droits/,
    );
    // Ni directement dans la table : seule la porte écrit.
    await assert.rejects(
      sousIdentite(s.expert.id, (db) =>
        db.query(
          `insert into capture.avoirs_rattaches (tenant_id, piece_id, facture_piece_id, origine,
                                                 cabinet_id)
           values ($1, $2, $3, 'cabinet', $4)`,
          [s.pme, id, facture, s.cabinet],
        ),
      ),
    );
    const q = (await rpc(s.expert, "office.rattacherLaFacture", id, facture)) as PropositionDePiece;
    assert.ok(q.ok, `l'avoir rattaché ne se propose pas : ${"raison" in q ? q.raison : ""}`);
    assert.deepEqual(q.avoir, { facture, origine: "cabinet", lie: true, traitement: "extourne" });
  });

  it("une facture d'origine pas encore comptabilisée : rien ne se propose, et la raison le dit", async () => {
    const s = await monter();
    await s.piece("facture_achat", { numero: `F-${s.m}-5` });
    const id = await avoir(s, `AV-${s.m}-5`, { factureDOrigine: `F-${s.m}-5` });
    const p = await s.proposition(id);
    assert.deepEqual(!p.ok && [p.raisonCode, p.avoir?.manque], [
      "facture_d_origine",
      "non_comptabilisee",
    ]);
  });

  it("le cabinet qui refuse les avoirs : l'avoir reste à saisir, comme avant", async () => {
    const s = await monter();
    await s.arreter("avoirs.traitement", "refus_saisie_cabinet");
    await factureValidee(s, `F-${s.m}-6`);
    const id = await avoir(s, `AV-${s.m}-6`, { factureDOrigine: `F-${s.m}-6` });
    const p = await s.proposition(id);
    assert.equal(p.ok, false);
    assert.deepEqual(!p.ok && p.controlesEnDefaut, ["nature_piece"]);
  });
});
