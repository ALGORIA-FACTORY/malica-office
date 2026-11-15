/**
 * Un refus n'est pas une archive (recette du 13 novembre 2026, A6).
 *
 * `mandat_repondre(false)` pose le mandat à « terminé », comme une révocation.
 * Une société qui a REFUSÉ n'a jamais été tenue par cette comptabilité : elle ne
 * doit paraître ni dans « Changer de dossier » ni dans le sélecteur des
 * immobilisations. Seule une archive — du travail pris en charge, en lecture
 * seule — survit à la fin du mandat. Éprouvé sous l'identité de l'expert, par
 * la lecture que ces écrans font (`listClients`), jamais en superutilisateur.
 *
 *   node --experimental-strip-types --test src/un-refus-n-est-pas-une-archive.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

describe("un refus n'est pas une archive", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let proprietaire: Utilisateur;
  let refusante = "";
  let acceptante = "";

  const clientsDeLExpert = () =>
    sousIdentiteDuServeur(s.gens.expert.id, (db) => supervision.listClients(db, s.cabinet));

  before(async () => {
    const marque = `refus-${Date.now()}`;
    s = await monterUneSociete(marque);
    const c = await creerCompte(`${marque}-autre@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    proprietaire = c;
    const creer = (nom: string) =>
      sousIdentiteDuServeur(proprietaire.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
          [nom, matriculeDEssai()],
        );
        return rows[0]!.id;
      });
    refusante = await creer(`REFUSANTE ${marque}`);
    acceptante = await creer(`ACCEPTANTE ${marque}`);
    for (const pme of [refusante, acceptante]) {
      const legalId = (
        await s.admin.query<{ legal_id: string }>(
          `select legal_id from identity.organizations where id = $1`,
          [pme],
        )
      ).rows[0]!.legal_id;
      await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        identite.proposerMandat(db, s.cabinet, legalId),
      );
      const [propose] = await sousIdentiteDuServeur(proprietaire.id, (db) =>
        identite.mandatsProposes(db, pme),
      );
      await sousIdentiteDuServeur(proprietaire.id, (db) =>
        identite.repondreAuMandat(db, propose!.id, pme === acceptante),
      );
    }
  });

  after(async () => {
    try {
      await s.admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[refusante, acceptante]],
      );
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("la société qui a refusé ne paraît pas aux clients de la comptabilité", async () => {
    const clients = await clientsDeLExpert();
    assert.equal(
      clients.find((c) => c.tenantId === refusante),
      undefined,
    );
    assert.equal(clients.find((c) => c.tenantId === acceptante)?.engagementStatus, "actif");
    assert.equal(clients.find((c) => c.tenantId === s.pme)?.engagementStatus, "actif");
  });

  it("la fin d'un mandat sans rien pris en charge ne laisse pas d'archive non plus", async () => {
    await sousIdentiteDuServeur(proprietaire.id, (db) =>
      identite.revoquerMandat(db, acceptante, "Je change de comptabilité"),
    );
    const clients = await clientsDeLExpert();
    assert.equal(
      clients.find((c) => c.tenantId === acceptante),
      undefined,
    );
  });

  it("une comptabilité qui a travaillé garde la société, en archive", async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    await s.fait("sami", "collab.envoyer", id);
    await s.fait("amel", "collab.envoyer", id);
    await s.priseEnCharge(id);
    await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.revoquerMandat(db, s.pme, "Je change de comptabilité"),
    );
    const client = (await clientsDeLExpert()).find((c) => c.tenantId === s.pme);
    assert.equal(client?.engagementStatus, "termine");
    assert.equal(client?.archive, true);
  });
});
