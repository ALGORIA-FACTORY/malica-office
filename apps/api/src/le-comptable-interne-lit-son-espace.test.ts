/**
 * Le comptable interne ouvre l'espace de la comptabilité sur SA société
 * (recette du 12 novembre 2026, point 7 : même espace que la comptabilité
 * externe, sur la seule société qu'il tient).
 *
 * Une société tenue en interne n'a pas de mandat : l'espace se lit sur la
 * société elle-même (comptabilité = client = société). Ce qui suit est lu par
 * les vraies portes, sous l'identité de chacun (R6) :
 *  - l'espace s'ouvre, sur sa seule société ;
 *  - la liste des clients, la file et les comptages ne portent que cette société ;
 *  - le plan, les réglages et la conseil se lisent ;
 *  - les collaborateurs listés sont ceux de sa comptabilité (le rôle comptable) ;
 *  - une autre société lui est fermée ;
 *  - le dirigeant n'entre pas dans l'espace de comptabilité.
 *
 *   npm test -- src/le-comptable-interne-lit-son-espace.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { lireLaPieceDEssai } from "./lecture-d-essai.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const MOT_DE_PASSE = "MotDePasseTresLong2026!";

describe("le comptable interne ouvre l'espace de sa société", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `espace-interne-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let comptable: Utilisateur;
  let second: Utilisateur;
  let pme = "";
  let autre = "";
  let tiers = "";

  const fait = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  let n = 0;
  const deposer = async (u: Utilisateur, tenantId: string) => {
    n += 1;
    const p = (await fait(u, "capture.enregistrer", {
      tenantId,
      source: "photo",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(u.id, (db) => lireLaPieceDEssai(db, p.id));
    return p.id;
  };

  before(async () => {
    const compte = async (qui: string, prenom: string) => {
      const u = await creerCompte(`${marque}-${qui}@essai.local`, MOT_DE_PASSE);
      assert.ok(u, qui);
      await sousIdentiteDuServeur(u.id, (db) => identite.ecrireMonProfil(db, prenom, "Essai"));
      return u;
    };
    dirigeant = await compte("dirigeant", "Hela");
    comptable = await compte("comptable", "Nour");
    second = await compte("second", "Omar");

    const creer = (u: Utilisateur, nom: string) =>
      sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
          [nom, matriculeDEssai()],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, `SOCIETE ${marque}`);
    autre = await creer(second, `AUTRE ${marque}`);
    tiers = await creer(second, `TIERS ${marque}`);

    // Deux sociétés affectées par leur propriétaire, une non affectée.
    for (const societe of [pme, autre]) {
      const proprietaire = societe === pme ? dirigeant : second;
      await fait(proprietaire, "facturation.inviterComptableInterne", comptable.email, societe);
      const recues = (await fait(comptable, "collab.invitationsPourMoi")) as Array<{
        id: string;
        cabinetTenantId: string;
      }>;
      const inv = recues.find((i) => i.cabinetTenantId === societe);
      assert.ok(inv, "l'invitation arrive au comptable");
      await fait(comptable, "collab.repondreAInvitation", inv.id, true);
    }
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, autre, tiers]],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("l'espace de comptabilité s'ouvre pour lui, sur les sociétés qui lui sont affectées", async () => {
    const mes = (await fait(comptable, "supervision.listMyCabinets")) as Array<{
      id: string;
      kind: string;
    }>;
    assert.deepEqual(
      mes.map((o) => [o.id, o.kind]).sort(),
      [
        [autre, "pme"],
        [pme, "pme"],
      ].sort(),
    );
    assert.ok(!mes.some((o) => o.id === tiers), "une société non affectée n'est pas listée");
    const du_dirigeant = (await fait(dirigeant, "supervision.listMyCabinets")) as unknown[];
    assert.equal(du_dirigeant.length, 0, "le dirigeant n'entre pas dans l'espace de comptabilité");
  });

  it("la liste des clients ne porte que la société lue, et chaque société affectée se lit seule", async () => {
    const clients = (await fait(comptable, "supervision.listClients", pme)) as Array<{
      tenantId: string;
    }>;
    assert.deepEqual(
      clients.map((c) => c.tenantId),
      [pme],
    );
    const lesAutres = (await fait(comptable, "supervision.listClients", autre)) as Array<{
      tenantId: string;
    }>;
    assert.deepEqual(
      lesAutres.map((c) => c.tenantId),
      [autre],
    );
  });

  it("une société non affectée lui est refusée, dans la liste comme dans les lectures", async () => {
    const clients = (await fait(comptable, "supervision.listClients", tiers)) as unknown[];
    assert.equal(clients.length, 0, "aucun client d'une société non affectée");
    const file = (await fait(comptable, "supervision.queue", tiers)) as unknown[];
    assert.equal(file.length, 0, "aucune file d'une société non affectée");
    const plan = await fait(comptable, "parametrage.reglagesCabinet", tiers).catch(
      (e: Error) => e.message,
    );
    assert.notEqual(typeof plan, "object", "les réglages d'une société non affectée sont fermés");
  });

  it("la file et les comptages lisent les pièces transmises de sa société", async () => {
    const id = await deposer(dirigeant, pme);
    await fait(dirigeant, "collab.envoyer", id);
    const file = (await fait(comptable, "supervision.queue", pme)) as Array<{ pieceId: string }>;
    assert.ok(
      file.some((r) => r.pieceId === id),
      "la pièce transmise arrive dans la file du comptable interne",
    );
    const fileAutre = (await fait(comptable, "supervision.queue", autre)) as unknown[];
    assert.equal(fileAutre.length, 0, "la file d'une autre société lui est fermée");
  });

  it("le plan, les réglages et le conseil se lisent sur sa société", async () => {
    const plan = (await fait(comptable, "parametrage.plan", pme, null)) as unknown[];
    assert.ok(plan.length > 0, "le plan comptable de sa société");
    const reglages = await fait(comptable, "parametrage.reglagesCabinet", pme);
    assert.ok(reglages, "les réglages comptables de sa société");
    const conseil = await fait(comptable, "conseil.statistiques", pme);
    assert.ok(conseil, "le conseil de sa société");
  });

  it("ses collaborateurs sont ceux de sa comptabilité : le rôle comptable, pas les autres", async () => {
    const membres = (await fait(comptable, "collab.members", pme)) as Array<{
      userId: string;
      role: string;
    }>;
    assert.deepEqual(
      membres.map((m) => m.role),
      ["comptable"],
    );
    assert.equal(membres[0]!.userId, comptable.id);
  });

  it("le dirigeant voit toujours tous les membres de sa société", async () => {
    const membres = (await fait(dirigeant, "collab.members", pme)) as Array<{ role: string }>;
    assert.ok(membres.some((m) => m.role === "dirigeant"));
    assert.ok(membres.some((m) => m.role === "comptable"));
  });

  it("un non-propriétaire ne retire pas l'affectation ; le propriétaire la retire, l'historique reste", async () => {
    await assert.rejects(
      () => fait(comptable, "collab.retirerComptableInterne", autre, comptable.id),
      /refus\.reserve\.proprietaire/,
    );
    await fait(second, "collab.retirerComptableInterne", autre, comptable.id);

    const mes = (await fait(comptable, "supervision.listMyCabinets")) as Array<{ id: string }>;
    assert.deepEqual(
      mes.map((o) => o.id),
      [pme],
      "la société retirée ne s'ouvre plus",
    );
    const clients = (await fait(comptable, "supervision.listClients", autre)) as unknown[];
    assert.equal(clients.length, 0, "une affectation retirée ferme la société");
    const file = (await fait(comptable, "supervision.queue", autre)) as unknown[];
    assert.equal(file.length, 0);

    const { rows } = await admin.query<{ evenement: string }>(
      `select evenement from identity.affectations_comptable
        where tenant_id = $1 and personne = $2 order by le, id`,
      [autre, comptable.id],
    );
    assert.deepEqual(
      rows.map((r) => r.evenement),
      ["affectee", "retiree"],
      "l'historique garde l'affectation et son retrait",
    );
    await assert.rejects(
      () =>
        admin.query(
          `update identity.affectations_comptable set evenement = 'affectee' where tenant_id = $1`,
          [autre],
        ),
      /refus\.journal\.immuable/,
      "le journal ne se réécrit pas (R7)",
    );
  });
});
