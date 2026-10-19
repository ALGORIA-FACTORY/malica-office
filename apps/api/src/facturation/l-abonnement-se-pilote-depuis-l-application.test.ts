/**
 * L'abonnement se pilote depuis l'application : le contrat RPC qui le permet.
 *
 * Par le chemin de production (`sousIdentite` -> `executerRpc`, rôle
 * `authenticated`, RLS en vigueur) : le propriétaire principal voit la grille,
 * change d'offre, achète une recharge, règle l'automatique, invite un
 * propriétaire et transmet la licence ; un propriétaire, lui, est refusé par
 * la base. Et chacun écrit son prénom et son nom.
 *
 * Les clients sont validés (commités) : `sousIdentite` ouvre sa propre
 * connexion. Ils s'archivent à la fin, ils ne se suppriment pas (R7).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && ADMIN);

describe("l'abonnement se pilote depuis l'application", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const marque = `pilote-${Date.now()}`;
  const principal = randomUUID();
  const proprietaire = randomUUID();
  let tenant = "";

  const rpc = (qui: string, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(qui, (db) => executerRpc(db, { depot, methode, args }));

  before(async () => {
    const org = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`Pilote ${marque}`],
    );
    tenant = org.rows[0]!.id;
    await admin.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, principal],
    );
    await admin.query("select facturation.licence_naitre($1, $2, 'solo', current_date)", [
      tenant,
      principal,
    ]);
  });

  after(async () => {
    await admin.query(
      `update identity.organizations
          set archived_at = now(), archived_reason = 'fixture de test automatisé'
        where id = $1`,
      [tenant],
    );
    await admin.end();
    await fermerLePool();
  });

  it("le principal voit la grille, son offre courante, et ce qui l'empêcherait d'ailleurs", async () => {
    const offres = (await rpc(principal, "facturation", "mesOffres", tenant)) as Array<{
      code: string;
      courant: boolean;
      empechement: string | null;
    }>;
    assert.deepEqual(
      offres.map((o) => o.code),
      ["basic", "solo", "team", "premium"],
    );
    assert.equal(offres.find((o) => o.courant)?.code, "solo");
    assert.equal(offres.find((o) => o.code === "solo")?.empechement, "deja_courant");
  });

  it("le principal achète une recharge, règle l'automatique, et les relit", async () => {
    const paliers = (await rpc(principal, "facturation", "paliersDeRecharge")) as Array<{
      code: string;
      prix_ht: string;
    }>;
    assert.equal(paliers.length, 4);
    const premier = paliers.sort((a, b) => Number(a.prix_ht) - Number(b.prix_ht))[0]!;

    const r = (await rpc(principal, "facturation", "acheterRecharge", premier.code, tenant)) as {
      recharge_code: string;
      utilisable: boolean;
    };
    assert.equal(r.recharge_code, premier.code);
    assert.equal(r.utilisable, true);
    const miennes = (await rpc(principal, "facturation", "mesRecharges")) as unknown[];
    assert.equal(miennes.length, 1);

    await rpc(
      principal,
      "facturation",
      "reglerRechargeAutomatique",
      true,
      premier.code,
      "15",
      tenant,
    );
    const auto = (await rpc(principal, "facturation", "maRechargeAutomatique")) as {
      active: boolean;
      recharge_code: string;
    };
    assert.equal(auto.active, true);
    assert.equal(auto.recharge_code, premier.code);
  });

  it("le principal passe en Team, invite un propriétaire, et lui transmet la licence", async () => {
    await rpc(principal, "facturation", "changerForfait", "team", tenant);
    const f = (await rpc(principal, "facturation", "monForfait")) as { offre: string };
    assert.equal(f.offre, "team");

    const inv = (await rpc(
      principal,
      "facturation",
      "inviterProprietaire",
      `associe-${marque}@essai.local`,
      tenant,
    )) as { role: string };
    assert.equal(inv.role, "dirigeant");

    // L'invitation acceptée, le propriétaire est là ; on l'inscrit directement.
    await admin.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, proprietaire],
    );
    for (const [methode, args] of [
      ["changerForfait", ["premium", tenant]],
      ["acheterRecharge", ["recharge_5", tenant]],
      ["inviterSiege", [`x-${marque}@essai.local`, tenant]],
      ["transmettreLicence", [tenant, proprietaire]],
    ] as const) {
      await assert.rejects(
        rpc(proprietaire, "facturation", methode, ...args),
        (e: { code?: string; message?: string }) =>
          e.code === "42501" || /pas_de_licence/.test(e.message ?? ""),
        `${methode} : un propriétaire ne touche pas l'abonnement`,
      );
    }

    await rpc(principal, "facturation", "transmettreLicence", tenant, proprietaire);
    const apres = (await rpc(proprietaire, "facturation", "monForfait")) as { offre: string };
    assert.equal(apres.offre, "team", "le nouveau principal voit le forfait entier");
  });

  it("chacun écrit son prénom et son nom ; la base compose le nom affiché", async () => {
    assert.equal(await rpc(principal, "identite", "monProfil"), null);
    const p = (await rpc(principal, "identite", "ecrireMonProfil", " Wissem ", "Barouni")) as {
      prenom: string;
      display_name: string;
    };
    assert.equal(p.prenom, "Wissem");
    assert.equal(p.display_name, "Wissem Barouni");
    const relu = (await rpc(principal, "identite", "monProfil")) as { nom: string };
    assert.equal(relu.nom, "Barouni");
    const efface = (await rpc(principal, "identite", "ecrireMonProfil", "Wissem", "")) as {
      nom: string | null;
    };
    assert.equal(efface.nom, null);
  });
});
