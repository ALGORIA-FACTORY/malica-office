/**
 * Un paiement se corrige — par une écriture nouvelle, jamais par une rature.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. Sur une facture de 1 969,610, la table des paiements porte
 * DEUX lignes : `especes` à 08:51:59, puis `cheque` à 08:52:55 — toutes deux
 * au TTC plein. Le dirigeant voulait changer d'avis ; le produit n'offrait
 * qu'« ajouter », et a compté deux fois.
 *
 * La conséquence dépasse l'écran : le reçu somme les paiements. Celui qu'on
 * aurait remis au fournisseur attestait 3 939,220 pour une facture de
 * 1 969,610 — un document faux, remis à un tiers.
 *
 * ======================================== POURQUOI ON N'EFFACE PAS
 *
 * `capture.paiements` refuse l'UPDATE et le DELETE (R7). Ce n'est pas une
 * gêne : un paiement est un fait déclaré, daté, qui a pu partir au cabinet.
 * On en inscrit donc un autre, qui l'éteint, avec son motif.
 *
 * Et la chaîne reste PLATE : on annule un paiement, jamais une annulation.
 * C'est ce qui permet à la vue de dire l'état en une passe.
 *
 *   node --experimental-strip-types --test src/scan/un-paiement-se-corrige.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Paiement = {
  id: string;
  moyenCode: string;
  montantMineur: number | null;
  eteint: boolean;
};

describe("un paiement se corrige sans se réécrire", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `corr-paiement-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let pack = "";
  let piece = "";
  let motifMoyen = "";

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

  const paiements = () => rpc("capture", "paiementsDUnePiece", piece) as Promise<Paiement[]>;
  /** Ce qui est payé aujourd'hui : les lignes vivantes, et elles seules. */
  const payeAujourdHui = async () =>
    (await paiements()).filter((p) => !p.eteint).reduce((s, p) => s + (p.montantMineur ?? 0), 0);

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '1876543W/A/M/000', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    ({ pack, motifMoyen } = await admin(async (p) => {
      const { rows: packs } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      const { rows: motifs } = await p.query<{ id: string }>(
        `select id from ref.paiement_motifs_annulation where code = 'moyen_errone'`,
      );
      return { pack: packs[0]!.id, motifMoyen: motifs[0]!.id };
    }));
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "personnel",
      idempotencyKey: `${marque}-facture`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    piece = p.id;
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

  const inscrire = (moyenCode: string, montantMineur: number | null) =>
    rpc("capture", "enregistrerPaiement", {
      pieceId: piece,
      packId: pack,
      moyenCode,
      montantMineur,
      devise: "TND",
      payeLe: montantMineur === null ? null : "2026-10-11",
      justificatifPieceId: null,
    }) as Promise<string>;

  it("le défaut du 13 octobre : changer d'avis doublait le montant", async () => {
    await inscrire("especes", 1_969_610);
    const cheque = await inscrire("cheque", 1_969_610);

    // Sans correction, voilà ce que le reçu aurait attesté.
    assert.equal(await payeAujourdHui(), 3_939_220);

    // La correction : on éteint le premier, on garde le second.
    const premier = (await paiements()).find((p) => p.moyenCode === "especes")!;
    await rpc("capture", "annulerPaiement", premier.id, motifMoyen);

    assert.equal(await payeAujourdHui(), 1_969_610);
    const apres = await paiements();
    assert.equal(apres.find((p) => p.id === cheque)!.eteint, false);
    assert.equal(apres.find((p) => p.id === premier.id)!.eteint, true);
  });

  it("l'histoire reste lisible : rien n'a disparu", async () => {
    // Trois lignes : les espèces, le chèque, et l'annulation des espèces.
    // On ne cache pas le fait éteint — c'est tout le point de R7.
    const toutes = await paiements();
    assert.equal(toutes.length, 3);
    assert.equal(toutes.filter((p) => p.eteint).length, 2);
  });

  it("un paiement déjà annulé ne s'annule pas une seconde fois", async () => {
    // Sans ce refus, deux taps rapides soustrairaient deux fois.
    const premier = (await paiements()).find((p) => p.moyenCode === "especes" && p.eteint)!;
    await assert.rejects(
      () => rpc("capture", "annulerPaiement", premier.id, motifMoyen),
      /deja annule/,
    );
  });

  it("une annulation ne s'annule pas : la chaîne reste plate", async () => {
    const annulation = (await paiements()).find(
      (p) => p.eteint && p.moyenCode === "especes" && p.id !== undefined,
    )!;
    // On vise la LIGNE d'annulation, c'est-à-dire la plus récente des éteintes.
    const toutes = await paiements();
    const laDerniere = toutes[toutes.length - 1]!;
    assert.ok(laDerniere.eteint, "la dernière ligne est bien l'annulation");
    assert.ok(annulation);
    await assert.rejects(
      () => rpc("capture", "annulerPaiement", laDerniere.id, motifMoyen),
      /deja une annulation/,
    );
  });

  it("un motif inconnu est refusé — on ne corrige pas sans dire pourquoi", async () => {
    const vivant = (await paiements()).find((p) => !p.eteint)!;
    await assert.rejects(
      () => rpc("capture", "annulerPaiement", vivant.id, "00000000-0000-0000-0000-000000000000"),
      /motif/,
    );
  });

  it("un acompte puis un solde se somment, et aucun des deux n'est éteint", async () => {
    /*
     * Le fractionnement que la table permettait depuis toujours et que
     * personne ne pouvait saisir : l'écran inscrivait toujours le TTC plein.
     * Deux versements sur une facture de 613,493.
     */
    const autre = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "personnel",
      idempotencyKey: `${marque}-acompte`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    const ancienne = piece;
    piece = autre.id;
    await inscrire("especes", 100_000);
    await inscrire("virement", 513_493);
    assert.equal(await payeAujourdHui(), 613_493);
    assert.equal((await paiements()).filter((p) => p.eteint).length, 0);
    piece = ancienne;
  });
});
