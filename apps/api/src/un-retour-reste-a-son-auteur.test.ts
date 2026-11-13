/**
 * Un retour, une notification, un mandat : chacun reste à la comptabilité qui
 * l'a écrit (recette du 13 novembre 2026, A5).
 *
 * Une société change de comptabilité. Trois choses fuyaient de l'ancienne vers
 * la nouvelle :
 *   1. la cloche — `collab.notifications` n'avait pas de destinataire, et toute
 *      comptabilité mandatée lisait toutes les notifications de la société ;
 *   2. la pièce « retournée, en attente de la réponse du client », que l'ancienne
 *      avait retournée, rangée dans la file de la nouvelle ;
 *   3. le nom de la comptabilité qui signe le retour, lu sur le mandat ACTIF et
 *      non sur l'auteur du verdict.
 *
 * Tout est joué sous l'identité de chacun (rôle membre d'`authenticated`, jamais
 * superutilisateur), par les portes.
 *
 *   node --experimental-strip-types --test src/un-retour-reste-a-son-auteur.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { capture } from "./depots/capture.ts";
import { collab } from "./depots/collab.ts";
import { identite } from "./depots/identite.ts";
import { supervision } from "./depots/supervision.ts";

describe("un retour reste à son auteur", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let confrere: Utilisateur;
  let nouvelle = "";
  let nomDeLaNouvelle = "";
  /** Retournée par l'ancienne avant le changement : le client n'a pas encore répondu. */
  let retournee = "";
  /** Transmise à l'ancienne, jamais retournée : elle passe à la nouvelle. */
  let enAttente = "";

  const chezLeComptable = async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    await s.fait("sami", "collab.envoyer", id);
    await s.fait("amel", "collab.envoyer", id);
    return id;
  };
  const parLaNouvelle = <T>(travail: Parameters<typeof sousIdentiteDuServeur<T>>[1]) =>
    sousIdentiteDuServeur(confrere.id, travail);

  before(async () => {
    const marque = `retour-${Date.now()}`;
    s = await monterUneSociete(marque);
    retournee = await chezLeComptable();
    enAttente = await chezLeComptable();
    await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      supervision.retourner(db, { pieceId: retournee, motifId: s.motifs["montant_incoherent"]! }),
    );

    await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.revoquerMandat(db, s.pme, "Je change de comptabilité"),
    );
    const c = await creerCompte(`${marque}-confrere@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    confrere = c;
    nomDeLaNouvelle = `CONFRERE ${marque}`;
    nouvelle = await parLaNouvelle(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'autonome', null, 'TN', 'TND') as id`,
        [nomDeLaNouvelle],
      );
      return rows[0]!.id;
    });
    const legalId = (
      await s.admin.query<{ legal_id: string }>(
        `select legal_id from identity.organizations where id = $1`,
        [s.pme],
      )
    ).rows[0]!.legal_id;
    await parLaNouvelle((db) => identite.proposerMandat(db, nouvelle, legalId));
    const [propose] = await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.mandatsProposes(db, s.pme),
    );
    await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );
  });

  after(async () => {
    try {
      if (nouvelle)
        await s.admin.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = $1 and archived_at is null`,
          [nouvelle],
        );
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("la nouvelle ne lit pas les notifications écrites pour l'ancienne", async () => {
    const lues = await parLaNouvelle((db) => collab.notifications(db, [s.pme]));
    assert.equal(
      lues.filter((n) => n.kind === "piece.retournee").length,
      0,
      "le retour de l'ancienne n'est pas dans la cloche de la nouvelle",
    );
    // La sienne, adressée à elle, se lit.
    const siennes = lues.filter(
      (n) =>
        n.kind === "mandat.accepte" &&
        (n.payload as { cabinet?: string })?.cabinet === nomDeLaNouvelle,
    );
    assert.equal(siennes.length, 1, "l'acceptation de son mandat");
  });

  it("l'ancienne ne lit plus la cloche de la société", async () => {
    const lues = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      collab.notifications(db, [s.pme]),
    );
    assert.deepEqual(lues, []);
  });

  it("la société lit toujours tout : les deux comptabilités, dans l'ordre", async () => {
    const lues = await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      collab.notifications(db, [s.pme]),
    );
    assert.ok(lues.some((n) => n.kind === "piece.retournee"));
    assert.equal(lues.filter((n) => n.kind === "mandat.accepte").length, 2);
  });

  it("la pièce retournée par l'ancienne n'est ni dans la file ni dans les comptes de la nouvelle", async () => {
    const clients = await parLaNouvelle((db) => supervision.listClients(db, nouvelle));
    const client = clients.find((c) => c.tenantId === s.pme);
    assert.equal(client?.engagementStatus, "actif");
    assert.equal(client?.parStatut["retournee"], 0, "aucun retour de l'ancienne aux compteurs");
    assert.equal(client?.counts["retournee"], 0);
    const file = await parLaNouvelle((db) => supervision.queue(db, nouvelle));
    assert.deepEqual(
      file.filter((f) => f.pieceId === retournee),
      [],
    );
    // La pièce qui n'avait jamais été retournée passe, elle, à la nouvelle.
    assert.equal(file.filter((f) => f.pieceId === enAttente).length, 1);
  });

  it("le retour se signe du cabinet qui l'a fait, même quand un autre est mandaté", async () => {
    const r = await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      capture.retourDeLaPiece(db, retournee, "fr"),
    );
    assert.ok(r, "la société lit son retour");
    assert.equal(r.chez, "cabinet");
    assert.equal(r.qui, s.nomDuCabinet);
    assert.notEqual(r.qui, nomDeLaNouvelle);
  });

  it("un retour que la nouvelle fait se signe d'elle", async () => {
    await parLaNouvelle((db) =>
      supervision.retourner(db, { pieceId: enAttente, motifId: s.motifs["montant_incoherent"]! }),
    );
    const r = await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      capture.retourDeLaPiece(db, enAttente, "fr"),
    );
    assert.equal(r?.qui, nomDeLaNouvelle);
    const file = await parLaNouvelle((db) => supervision.queue(db, nouvelle));
    assert.equal(file.filter((f) => f.pieceId === enAttente && f.statut === "retournee").length, 1);
  });
});
