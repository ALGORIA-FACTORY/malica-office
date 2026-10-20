/**
 * Comment la pièce a été payée.
 *
 * ================================================================= POURQUOI
 *
 * Demandé le 10 octobre 2026 : « Malica génère le reçu de dépense ou de
 * revenu et le moyen de paiement. Concernant le moyen de paiement il doit
 * être choisi entre la liste suivante dans un écran qui suit la lecture :
 * espèce, chèque, carte bancaire, traite, chèque de banque, virement ou
 * autre. À l'exception d'espèces les autres on doit prendre une photo. »
 *
 * Le référentiel a été posé le 11 octobre et personne ne le lisait : huit
 * moyens, leur compte de trésorerie, vingt-quatre libellés traduits. Pendant
 * ce temps la même nomenclature vivait en dur dans deux écrans du cabinet,
 * trois fois plus pauvre.
 *
 * Ces épreuves tiennent la lecture du référentiel et l'inscription d'un
 * paiement, avant qu'aucun écran ne s'y adosse.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le paiement d'une pièce", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `paiement-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let packId = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  async function piece(cle: string) {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    return p.id;
  }

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      ),
    );
    await fermerLePool();
  });

  const moyens = (locale = "fr", au = "2026-10-11") =>
    rpc("referentiel", "moyensDePaiement", packId, locale, au) as Promise<
      Array<{
        code: string;
        libelle: string;
        tresorerieAccount: string | null;
        exigeJustificatif: boolean;
      }>
    >;

  it("les huit moyens demandés sont lisibles par la PME, dans l'ordre", async () => {
    assert.deepEqual(
      (await moyens()).map((m) => m.code),
      [
        "especes",
        "cheque",
        "cheque_banque",
        "carte_bancaire",
        "virement",
        "traite",
        "autre",
        "non_paye",
      ],
    );
  });

  it("et leurs libellés sont traduits, pas le français de la table", async () => {
    /*
     * `ref.labels` portait six namespaces et UN SEUL était joint par du code.
     * Un écran en anglais affichait « Chèque de banque » partout où une table
     * de référentiel portait un libellé.
     */
    const fr = await moyens("fr");
    const en = await moyens("en");
    assert.equal(fr.find((m) => m.code === "cheque_banque")!.libelle, "Chèque de banque");
    assert.equal(en.find((m) => m.code === "cheque_banque")!.libelle, "Bank cheque");
  });

  it("une locale sans traduction retombe sur le français, elle ne disparaît pas", async () => {
    const xx = await moyens("xx");
    assert.equal(xx.length, 8, "aucun moyen ne doit manquer faute de traduction");
    assert.equal(xx.find((m) => m.code === "especes")!.libelle, "Espèces");
  });

  it("un paiement s'inscrit, avec son moyen et sa date", async () => {
    const id = await piece("regle");
    await rpc("capture", "enregistrerPaiement", {
      pieceId: id,
      packId,
      moyenCode: "cheque",
      montantMineur: 613_493,
      devise: "TND",
      payeLe: "2026-10-09",
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", id)) as Array<{
      moyenCode: string;
      montantMineur: number | null;
      payeLe: string | null;
    }>;
    assert.equal(liste.length, 1);
    assert.equal(liste[0]!.moyenCode, "cheque");
    assert.equal(liste[0]!.montantMineur, 613_493);
    assert.match(liste[0]!.payeLe!, /^2026-10-09/);
  });

  it("un acompte puis un solde font DEUX paiements, pas un remplacement", async () => {
    /*
     * C'est la raison d'être de la table. Une colonne sur la pièce aurait dit
     * « payée par chèque » là où il y a eu des espèces le 3 et un chèque le
     * 28 — et le second geste aurait effacé le premier.
     */
    const id = await piece("acompte");
    await rpc("capture", "enregistrerPaiement", {
      pieceId: id,
      packId,
      moyenCode: "especes",
      montantMineur: 100_000,
      devise: "TND",
      payeLe: "2026-10-03",
    });
    await rpc("capture", "enregistrerPaiement", {
      pieceId: id,
      packId,
      moyenCode: "cheque",
      montantMineur: 513_493,
      devise: "TND",
      payeLe: "2026-10-28",
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", id)) as Array<{
      moyenCode: string;
      montantMineur: number | null;
    }>;
    assert.deepEqual(
      liste.map((p) => p.moyenCode),
      ["especes", "cheque"],
      "du plus ancien au plus récent",
    );
    assert.equal(
      liste.reduce((n, p) => n + (p.montantMineur ?? 0), 0),
      613_493,
    );
  });

  it("« pas encore payé » s'inscrit sans date ni montant", async () => {
    // Sans lui, une facture à trente jours n'a aucune réponse possible, et la
    // personne coche n'importe quoi pour avancer.
    const id = await piece("a-payer");
    await rpc("capture", "enregistrerPaiement", {
      pieceId: id,
      packId,
      moyenCode: "non_paye",
      devise: "TND",
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", id)) as Array<{
      moyenCode: string;
      payeLe: string | null;
      montantMineur: number | null;
    }>;
    assert.equal(liste[0]!.moyenCode, "non_paye");
    assert.equal(liste[0]!.payeLe, null);
    assert.equal(liste[0]!.montantMineur, null);
  });

  it("un moyen inventé est refusé : le compte de trésorerie n'existerait pas", async () => {
    const id = await piece("invente");
    await assert.rejects(
      () =>
        rpc("capture", "enregistrerPaiement", {
          pieceId: id,
          packId,
          moyenCode: "bitcoin",
          montantMineur: 1000,
          devise: "TND",
          payeLe: "2026-10-09",
        }),
      /n'existe pas au paramétrage/,
      "sinon l'écriture s'appuierait sur un compte qui n'existe pas, et rien ne le dirait avant la balance",
    );
  });

  it("une date sans montant est refusée par la base, et réciproquement", async () => {
    const id = await piece("moitie");
    await assert.rejects(
      () =>
        rpc("capture", "enregistrerPaiement", {
          pieceId: id,
          packId,
          moyenCode: "cheque",
          devise: "TND",
          payeLe: "2026-10-09",
        }),
      /paiements_date_et_montant_ensemble/,
      "un paiement à moitié saisi est un paiement qu'on ne peut pas lire",
    );
  });

  it("le justificatif est une PIÈCE, rattachée, pas un fichier à part", async () => {
    /*
     * Même capture, même archive, même chiffrement. Son type porte
     * `porte_ecriture = false` : un document transmis au cabinet et
     * comptabilisable une seconde fois est la façon la plus simple de
     * compter une charge deux fois.
     */
    const facture = await piece("avec-preuve");
    const talon = await piece("talon");
    await rpc("capture", "enregistrerPaiement", {
      pieceId: facture,
      packId,
      moyenCode: "cheque",
      montantMineur: 613_493,
      devise: "TND",
      payeLe: "2026-10-09",
      justificatifPieceId: talon,
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", facture)) as Array<{
      justificatifPieceId: string | null;
    }>;
    assert.equal(liste[0]!.justificatifPieceId, talon);
  });

  it("et l'absence de justificatif NE BLOQUE PAS", async () => {
    /*
     * Un dirigeant qui n'a pas son talon sous la main doit pouvoir avancer.
     * Un écran qui refuse se contourne en cochant « espèces », et
     * l'information est perdue au lieu d'être gagnée.
     */
    const id = await piece("sans-preuve");
    await rpc("capture", "enregistrerPaiement", {
      pieceId: id,
      packId,
      moyenCode: "cheque",
      montantMineur: 613_493,
      devise: "TND",
      payeLe: "2026-10-09",
    });
    const liste = (await rpc("capture", "paiementsDUnePiece", id)) as Array<{
      justificatifPieceId: string | null;
    }>;
    assert.equal(liste.length, 1);
    assert.equal(liste[0]!.justificatifPieceId, null);
  });
});
