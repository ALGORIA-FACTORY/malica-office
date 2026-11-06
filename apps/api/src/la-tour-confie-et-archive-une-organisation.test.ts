/**
 * La Tour confie une société sans dirigeant, et archive une organisation
 * (recette du 4 novembre 2026 : la vraie société d'ALGORIA n'avait aucun
 * membre, le dirigeant travaillait dans un doublon d'essai).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-tour-confie-et-archive-une-organisation.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la Tour confie et archive une organisation", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `confier-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let plateforme: Utilisateur;
  let dirigeant: Utilisateur;
  let intrus: Utilisateur;
  let expert: Utilisateur;
  const crees: string[] = [];

  const fait = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const orgSansMembre = async (mf: string) => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, legal_id, jurisdiction, currency)
       values ('pme', $1, $2, 'TN', 'TND') returning id`,
      [`SOCIETE ${marque} ${crees.length}`, mf],
    );
    crees.push(rows[0]!.id);
    return rows[0]!.id;
  };

  before(async () => {
    const mdp = "MotDePasseTresLong2026!";
    plateforme = (await creerCompte(`p-${marque}@essai.local`, mdp))!;
    dirigeant = (await creerCompte(`d-${marque}@essai.local`, mdp))!;
    intrus = (await creerCompte(`i-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`e-${marque}@essai.local`, mdp))!;
    assert.ok(plateforme && dirigeant && intrus && expert);
    await admin.query(`insert into app.platform_operators (user_id, note) values ($1, $2)`, [
      plateforme.id,
      `épreuve ${marque}`,
    ]);
  });

  after(async () => {
    try {
      await admin.query(`delete from app.platform_operators where user_id = $1`, [plateforme.id]);
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [crees],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("une société sans membre reçoit son premier dirigeant, et sa licence", async () => {
    const org = await orgSansMembre(matriculeDEssai());
    const r = (await fait(plateforme, "tour.confierOrganisation", org, dirigeant.email)) as {
      dirigeant: string;
      licence: string | null;
    };
    assert.equal(r.dirigeant, dirigeant.id);
    assert.ok(r.licence, "la licence naît");
    const orgs = (await fait(dirigeant, "identite.listMyOrganizations")) as Array<{
      id: string;
      role: string;
    }>;
    assert.equal(orgs.find((o) => o.id === org)?.role, "dirigeant");
    // La Tour voit qui la dirige, et qui paie sa licence ; personne d'autre.
    const membres = (await fait(plateforme, "tour.membresDeLOrganisation", org)) as Array<{
      email: string;
      role: string;
      titulaire_licence: boolean;
    }>;
    assert.deepEqual(
      membres.map((m) => [m.email, m.role, m.titulaire_licence]),
      [[dirigeant.email, "dirigeant", true]],
    );
    await assert.rejects(
      fait(intrus, "tour.membresDeLOrganisation", org),
      /refus\.reserve\.plateforme/,
    );
    await assert.rejects(
      sousIdentiteDuServeur(intrus.id, (db) =>
        db.query(`select * from public.plateforme_organisation_membres($1)`, [org]),
      ),
      /reserve\.plateforme/,
    );
    // Une société qui a un membre ne se confie plus.
    await assert.rejects(
      fait(plateforme, "tour.confierOrganisation", org, intrus.email),
      /deja_dirigee/,
    );
  });

  it("seule la plateforme confie et archive", async () => {
    const org = await orgSansMembre(matriculeDEssai());
    // La Tour refuse d'abord, puis la base : les deux portes tiennent.
    await assert.rejects(
      fait(intrus, "tour.confierOrganisation", org, intrus.email),
      /refus\.reserve\.plateforme/,
    );
    await assert.rejects(
      fait(intrus, "tour.archiverOrganisation", org, "essai"),
      /refus\.reserve\.plateforme/,
    );
    const base = (sql: string, args: unknown[]) =>
      sousIdentiteDuServeur(intrus.id, (db) => db.query(sql, args));
    await assert.rejects(
      base(`select public.plateforme_organisation_confier($1, $2)`, [org, intrus.email]),
      /reserve\.plateforme/,
    );
    await assert.rejects(
      base(`select public.plateforme_organisation_archiver($1, $2)`, [org, "essai"]),
      /reserve\.plateforme/,
    );
  });

  it("archiver termine le mandat et libère le matricule, sans rien effacer", async () => {
    const mf = matriculeDEssai();
    const org = await orgSansMembre(mf);
    await fait(plateforme, "tour.confierOrganisation", org, dirigeant.email);
    const cabinet = await sousIdentiteDuServeur(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'mandate', null, 'TN', 'TND') as id`,
        [`CABINET ${marque}`],
      );
      return rows[0]!.id;
    });
    crees.push(cabinet);
    await sousIdentiteDuServeur(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.mandatsProposes(db, org),
    );
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );

    await assert.rejects(fait(plateforme, "tour.archiverOrganisation", org, "  "), /motif_requis/);
    await fait(plateforme, "tour.archiverOrganisation", org, "Doublon d'essai");

    const { rows } = await admin.query<{ archivee: boolean; mandat: string }>(
      `select o.archived_at is not null as archivee,
              (select e.status from identity.engagements e where e.pme_org_id = o.id
                order by e.created_at desc limit 1) as mandat
         from identity.organizations o where o.id = $1`,
      [org],
    );
    assert.deepEqual(rows[0], { archivee: true, mandat: "termine" });
    // Le matricule est libre : une autre société le porte.
    const autre = await orgSansMembre(mf);
    assert.ok(autre);
    // Un cabinet ne s'archive pas par ce geste : ses mandats le lient.
    await assert.rejects(
      fait(plateforme, "tour.archiverOrganisation", cabinet, "essai"),
      /pas_une_societe/,
    );
    // Archivée, elle ne s'archive pas deux fois.
    await assert.rejects(
      fait(plateforme, "tour.archiverOrganisation", org, "encore"),
      /introuvable\.organisation/,
    );
  });
});
