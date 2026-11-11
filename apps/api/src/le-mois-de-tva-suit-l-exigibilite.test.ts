/**
 * Le mois de TVA d'une pièce suit l'exigibilité (réglage `mois_tva.date`,
 * choix du CEO du 31 octobre 2026, appliqué le 11 novembre 2026).
 *
 * Un service se déclare à sa réalisation (présumée à la date de la facture),
 * ou à l'encaissement s'il est antérieur ; un bien à sa livraison (la date de
 * la facture). Un achat suit la vente du fournisseur. Ce qui ne se prouve
 * pas — la nature, un encaissement partiel — garde la date de la facture et
 * porte une réserve nommée. L'option `date_facture_alerte` garde la date de
 * la facture et alerte.
 *
 * Toutes ces épreuves échouaient avant : une pièce pesait dans le mois de sa
 * facture, sans réserve, quelle que soit l'option.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-mois-de-tva-suit-l-exigibilite.test.ts
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
import { jourDEssai, lecture as lectureDEssai, moisDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** La facture d'essai est du jour d'essai ; l'encaissement d'avance, du mois précédent. */
const FACTURE = moisDEssai(0);
const AVANT = { ...moisDEssai(-1), le: `${moisDEssai(-1).du.slice(0, 8)}20` };

type Transmis = Array<{ pieceId: string; imputeeLe: string }>;
type Inscrits = Array<{ pieceId: string }>;

describe("le mois de TVA suit l'exigibilité", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `mois-tva-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const archiver: string[] = [];
  let packId = "";
  let n = 0;

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  /** Un cabinet, un dossier qu'il tient, son dirigeant. */
  const monter = async () => {
    n += 1;
    const m = `${marque}-${n}`;
    const mf = matriculeDEssai("A", "M");
    const [dirigeant, expert] = await Promise.all([
      creerCompte(`dirigeant-${m}@essai.local`, mdp),
      creerCompte(`expert-${m}@essai.local`, mdp),
    ]);
    assert.ok(dirigeant && expert);
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
    archiver.push(pme, cabinet);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));

    /** Une pièce lue (TTC 1 470,126), jugée, transmise au cabinet. */
    const piece = async (sens: "facture_achat" | "facture_vente", designation: string) => {
      const l = lectureDEssai({
        numero: `F-${m}-${designation.length}-${Math.random().toString(36).slice(2, 8)}`,
        ...(sens === "facture_achat" ? { clientMf: mf } : {}),
      });
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
        },
        articles: [
          {
            designation,
            quantity: null,
            unit_price_ht: null,
            unit_price_ttc: null,
            total_ht: null,
            tax_code: null,
          },
        ],
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
    /** Un règlement, daté ; sans montant, ce qui reste dû. */
    const regler = (pieceId: string, montantMineur: number | null, payeLe = AVANT.le) =>
      rpc(dirigeant, "capture.enregistrerPaiement", {
        pieceId,
        packId,
        moyenCode: "especes",
        montantMineur,
        devise: "TND",
        payeLe,
      });
    const transmis = async (f: { du: string; au: string }) =>
      (await rpc(dirigeant, "office.extraitsTransmis", pme, f.du, f.au)) as Transmis;
    const inscrits = async (f: { du: string; au: string }) =>
      (await rpc(expert, "office.bookedExtracts", pme, f.du, f.au)) as Inscrits;
    const proposition = (id: string) =>
      rpc(expert, "office.propositionDePiece", id) as Promise<
        PropositionDePiece & { empreinte?: string }
      >;
    /** Les réserves du mois de TVA d'une proposition : [raison, articles]. */
    const reservesDuMois = async (id: string) => {
      const p = await proposition(id);
      assert.ok(p.ok, `aucune écriture : ${"raison" in p ? p.raison : ""}`);
      return (p.reserves ?? [])
        .filter((r) => r.code === "mois_de_tva")
        .map((r) => [r.raison, r.articles]);
    };
    const valider = async (id: string) => {
      const p = await proposition(id);
      assert.ok(p.ok && p.empreinte, `rien à valider : ${"raison" in p ? p.raison : ""}`);
      await rpc(expert, "office.valider", id, p.empreinte);
    };
    const arreter = (valeur: string, depuis = "2026-01-01") =>
      rpc(expert, "parametrage.arreterReglagesComptables", {
        cabinetId: cabinet,
        portee: "dossier",
        porteeId: pme,
        packId,
        depuis,
        valeurs: [{ code: "mois_tva.date", valeur }],
      });
    return { pme, piece, regler, transmis, inscrits, reservesDuMois, valider, arreter };
  };

  const dans = (lus: Array<{ pieceId: string }>, id: string) => lus.some((x) => x.pieceId === id);

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

  it("chaque nature du pack dit son exigibilité ; services et biens ne se confondent pas", async () => {
    const { rows } = await admin.query<{ code: string; exigibilite: string }>(
      `select code, exigibilite from ref.natures_de_vente
        where pack_version_id = $1 and valid_to is null order by rang`,
      [packId],
    );
    assert.ok(rows.length > 0);
    assert.deepEqual(
      new Set(rows.map((r) => r.exigibilite)),
      new Set(["livraison", "encaissement"]),
    );
  });

  it("une prestation encaissée avant le mois de sa facture se déclare au mois de l'encaissement, des deux côtés", async () => {
    const s = await monter();
    const id = await s.piece("facture_vente", "Prestation de maintenance");
    await s.regler(id, null);
    // Encaissée en entier dans un seul mois : aucune réserve.
    assert.deepEqual(await s.reservesDuMois(id), []);
    await s.valider(id);
    const avant = await s.transmis(AVANT);
    assert.deepEqual(
      avant.filter((x) => x.pieceId === id).map((x) => x.imputeeLe),
      [AVANT.le],
    );
    assert.ok(!dans(await s.transmis(FACTURE), id));
    assert.ok(dans(await s.inscrits(AVANT), id));
    assert.ok(!dans(await s.inscrits(FACTURE), id));
  });

  it("une marchandise encaissée d'avance reste au mois de sa facture", async () => {
    const s = await monter();
    const id = await s.piece("facture_vente", "Ramettes de papier");
    await s.regler(id, null);
    assert.deepEqual(await s.reservesDuMois(id), []);
    await s.valider(id);
    assert.ok(dans(await s.transmis(FACTURE), id));
    assert.ok(!dans(await s.transmis(AVANT), id));
    assert.ok(dans(await s.inscrits(FACTURE), id));
  });

  it("un service acheté et payé d'avance : la déduction suit l'exigibilité chez le fournisseur", async () => {
    const s = await monter();
    const id = await s.piece("facture_achat", "Honoraires de conseil");
    await s.regler(id, null);
    await s.valider(id);
    assert.ok(dans(await s.transmis(AVANT), id));
    assert.ok(!dans(await s.transmis(FACTURE), id));
    assert.ok(dans(await s.inscrits(AVANT), id));
  });

  it("un service payé après sa facture reste au mois de la facture (la réalisation), sans réserve", async () => {
    const s = await monter();
    const id = await s.piece("facture_vente", "Prestation de maintenance");
    assert.deepEqual(await s.reservesDuMois(id), []);
    await s.valider(id);
    // Le lendemain de la facture, jamais la fin de son mois : elle peut être à
    // venir, et un paiement futur est refusé (`paiement.date_future`).
    await s.regler(id, null, jourDEssai(1));
    assert.ok(dans(await s.transmis(FACTURE), id));
  });

  it("une nature indécidable, un encaissement partiel : la date de la facture, et la réserve qui le dit", async () => {
    const s = await monter();
    const inconnue = await s.piece("facture_achat", "Article XQZ");
    await s.regler(inconnue, null);
    assert.deepEqual(await s.reservesDuMois(inconnue), [["nature_indecidable", ["Article XQZ"]]]);
    await s.valider(inconnue);
    assert.ok(dans(await s.transmis(FACTURE), inconnue));

    const partiel = await s.piece("facture_vente", "Prestation de maintenance");
    await s.regler(partiel, 100_000);
    assert.deepEqual(await s.reservesDuMois(partiel), [["encaissement_partiel", []]]);
    await s.valider(partiel);
    assert.ok(dans(await s.transmis(FACTURE), partiel));
    assert.ok(!dans(await s.transmis(AVANT), partiel));
  });

  it("l'option « date de facture » garde le mois de la facture, et alerte quand l'encaissement le précède", async () => {
    const s = await monter();
    await s.arreter("date_facture_alerte");
    // Sans encaissement antérieur, rien à dire.
    const sansAvance = await s.piece("facture_vente", "Prestation de maintenance");
    assert.deepEqual(await s.reservesDuMois(sansAvance), []);
    const id = await s.piece("facture_vente", "Prestation de maintenance");
    await s.regler(id, null);
    assert.deepEqual(await s.reservesDuMois(id), [["exigibilite_anterieure", []]]);
    await s.valider(id);
    assert.ok(dans(await s.transmis(FACTURE), id));
    assert.ok(!dans(await s.transmis(AVANT), id));
  });

  // Revue de #163 (P1) : l'option se lisait à la FIN de la fenêtre demandée.
  // Changée le 1er septembre, entre l'encaissement (août) et la facture
  // (septembre), elle rangeait la pièce dans les deux mois — ou dans aucun.
  for (const [avant, depuis] of [
    ["exigibilite_calculee", "date_facture_alerte"],
    ["date_facture_alerte", "exigibilite_calculee"],
  ] as const)
    it(`l'option changée entre l'encaissement et la facture (${avant} → ${depuis}) : un seul mois, celui de l'option au jour de la facture`, async () => {
      const s = await monter();
      await s.arreter(avant);
      await s.arreter(depuis, FACTURE.du);
      const id = await s.piece("facture_vente", "Prestation de maintenance");
      await s.regler(id, null);
      await s.valider(id);
      const attendu = depuis === "exigibilite_calculee" ? AVANT : FACTURE;
      for (const lire of [s.transmis, s.inscrits])
        assert.deepEqual(
          [dans(await lire(AVANT), id), dans(await lire(FACTURE), id)],
          [attendu === AVANT, attendu === FACTURE],
        );
    });

  it("l'historique du réglage ne se lit pas hors du dossier, pas même ses dates", async () => {
    const s = await monter();
    await s.arreter("date_facture_alerte");
    const etranger = await creerCompte(`etranger-${marque}@essai.local`, mdp);
    assert.ok(etranger);
    await assert.rejects(
      sousIdentite(etranger.id, (db) =>
        db.query(`select * from app.historique_du_mois_de_tva($1, 'mois_tva.date')`, [s.pme]),
      ),
      /refus\.reglage_comptable\.droits/,
    );
  });
});
