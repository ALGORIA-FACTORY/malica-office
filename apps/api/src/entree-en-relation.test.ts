/**
 * L'entrée en relation : le cabinet ouvre le dossier d'une PME qui n'existe pas
 * encore, invite son contact par un lien, et le contact arrive dans un espace
 * vide — le sien, et seulement le sien.
 *
 * Tout passe par le dispatcher RPC (`executerRpc`) sous l'identité de chacun,
 * exactement comme une requête de l'application : ce que prouve ce test, c'est
 * ce que l'API sert, pas ce qu'une requête taillée pour lui laisserait voir.
 *
 *   node --experimental-strip-types --test src/entree-en-relation.test.ts
 */

import assert from "node:assert/strict";
import pg from "pg";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);
const MDP = "MotDePasseTresLong2026!";

describe("l'entrée en relation", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `essai-${Date.now()}`;
  // Le matricule d'ALGORIA FACTORY, rendu unique pour que le test se rejoue.
  const mf = `1856324/A/M/000-${marque}`;
  const adresse = "Immeuble Le Cristal, Rue du Lac Turkana, Les Berges du Lac 1 — 1053 Tunis";
  const emailContact = `contact-${marque}@essai.local`;

  let expert: Utilisateur;
  let contact: Utilisateur;
  let intrus: Utilisateur;
  let autre: Utilisateur;
  let cabinet = "";
  let dossier = "";
  let autrePme = "";
  let piecEtrangere = "";
  let jeton = "";
  /** Tous les jetons émis : aucun ne doit apparaître dans l'audit. */
  const jetonsEmis: string[] = [];

  type Invitation = { id: string; jeton: string; email: string; expiresAt: string };
  const inviter = async (email = emailContact) => {
    const r = (await rpc(expert, "identite", "inviterContact", dossier, email)) as Invitation;
    jetonsEmis.push(r.jeton);
    return r;
  };
  const etats = async () =>
    Object.fromEntries(
      (
        (await rpc(expert, "identite", "invitationsDuDossier", dossier)) as {
          id: string;
          statut: string;
        }[]
      ).map((i) => [i.id, i.statut]),
    );
  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  before(async () => {
    const [e, c, i, a] = await Promise.all([
      creerCompte(`expert-${marque}@essai.local`, MDP),
      creerCompte(emailContact, MDP),
      creerCompte(`intrus-${marque}@essai.local`, MDP),
      creerCompte(`autre-${marque}@essai.local`, MDP),
    ]);
    assert.ok(e && c && i && a, "les comptes doivent être créés");
    [expert, contact, intrus, autre] = [e, c, i, a];

    cabinet = (await rpc(expert, "identite", "createOrganization", {
      kind: "cabinet",
      name: `Cabinet d'Expertises CADG ${marque}`,
      validationMode: "mandate",
      legalId: null,
      jurisdiction: "TN",
    })) as string;

    // Un autre tenant, avec une pièce : celle que le contact ne doit pas lire.
    autrePme = (await rpc(autre, "identite", "createOrganization", {
      kind: "pme",
      name: `AUTRE PME ${marque}`,
      validationMode: "autonome",
      legalId: null,
      jurisdiction: "TN",
    })) as string;
    piecEtrangere = await sousIdentite(autre.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key)
         values ($1, 'pdf', 'partage', $2, $3) returning id`,
        [autrePme, `essai/${marque}.pdf`, marque],
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    const admin = process.env["DATABASE_URL_ADMIN"];
    const orgs = [cabinet, dossier, autrePme].filter(Boolean);
    if (admin && orgs.length) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = any($1::uuid[]) and archived_at is null`,
          [orgs],
        );
      } finally {
        await pool.end();
      }
    }
    await fermerLePool();
  });

  it("le cabinet ouvre le dossier d'une PME qui n'existe pas encore", async () => {
    const r = (await rpc(expert, "identite", "ouvrirDossier", {
      cabinetTenantId: cabinet,
      name: "ALGORIA FACTORY SARL",
      legalId: mf,
      adresse,
    })) as { id: string; name: string; legalId: string; adresse: string };
    dossier = r.id;
    assert.equal(r.name, "ALGORIA FACTORY SARL");
    assert.equal(r.legalId, mf);
    assert.equal(r.adresse, adresse);

    // Le cabinet le voit parmi ses clients ; personne n'en est encore membre.
    const clients = (await rpc(expert, "supervision", "listClients", cabinet)) as {
      tenantId: string;
      engagementStatus: string;
    }[];
    assert.deepEqual(
      clients.map((c) => [c.tenantId, c.engagementStatus]),
      [[dossier, "actif"]],
      "le dossier ouvert figure parmi les clients du cabinet, mandat actif",
    );
    const membres = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query(`select 1 from identity.memberships where tenant_id = $1`, [
        dossier,
      ]);
      return rows.length;
    });
    assert.equal(membres, 0, "le cabinet ne devient pas membre du dossier");
  });

  it("un matricule qui a déjà un dossier n'en ouvre pas un second", async () => {
    await assert.rejects(
      rpc(expert, "identite", "ouvrirDossier", {
        cabinetTenantId: cabinet,
        name: "ALGORIA FACTORY SARL (bis)",
        legalId: mf,
        adresse: null,
      }),
      /déjà un dossier/,
    );
  });

  it("seul un expert du cabinet ouvre un dossier en son nom", async () => {
    await assert.rejects(
      rpc(intrus, "identite", "ouvrirDossier", {
        cabinetTenantId: cabinet,
        name: `INTRUSION ${marque}`,
        legalId: `MF-INTRUS-${marque}`,
        adresse: null,
      }),
      /Seul un expert du cabinet/,
    );
  });

  it("l'invitation rend un jeton une seule fois, et la base n'en garde que l'empreinte", async () => {
    const r = (await rpc(expert, "identite", "inviterContact", dossier, emailContact)) as {
      jeton: string;
      email: string;
      expiresAt: string;
      courriel: string;
      lien: string | null;
    };
    jeton = r.jeton;
    jetonsEmis.push(r.jeton);
    // Les tests n'envoient pas de courriel (garde-base-de-test) : la réponse le dit,
    // et le lien reste à transmettre par le cabinet.
    assert.equal(r.courriel, "non_configure");
    assert.equal(r.lien, null);
    assert.match(jeton, /^[0-9a-f]{64}$/);
    assert.equal(r.email, emailContact);
    const enClair = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query(`select 1 from identity.invitations where token_hash = $1`, [
        jeton,
      ]);
      return rows.length;
    });
    assert.equal(enClair, 0, "le jeton n'est pas stocké en clair");
  });

  it("Brevo configuré : le courriel part par le vrai dispatcher, aux noms du dossier et du cabinet", async () => {
    // Un second dossier, pour ne pas toucher au lien du premier. fetch est
    // intercepté : rien ne sort du poste.
    const second = (await rpc(expert, "identite", "ouvrirDossier", {
      cabinetTenantId: cabinet,
      name: `SECOND DOSSIER ${marque}`,
      legalId: `MF-SECOND-${marque}`,
      adresse: null,
    })) as { id: string };
    const avant = { ...process.env };
    const fetchReel = globalThis.fetch;
    let envoye: { to: { email: string }[]; subject: string; htmlContent: string } | undefined;
    Object.assign(process.env, {
      BREVO_API_KEY: "cle-de-test",
      MALICA_COURRIEL_EXPEDITEUR: "w.barouni@algoria-factory.com",
      MALICA_URL_PUBLIQUE: "http://localhost:8080",
    });
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      envoye = JSON.parse(String(init?.body));
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    try {
      const r = (await rpc(expert, "identite", "inviterContact", second.id, emailContact)) as {
        jeton: string;
        courriel: string;
        lien: string;
      };
      assert.equal(r.courriel, "envoye");
      assert.equal(r.lien, `http://localhost:8080/invitation#${r.jeton}`);
      assert.deepEqual(envoye!.to, [{ email: emailContact }]);
      assert.match(envoye!.subject, /Cabinet d'Expertises CADG/);
      assert.ok(envoye!.htmlContent.includes(`SECOND DOSSIER ${marque}`));
      assert.ok(envoye!.htmlContent.includes(r.lien));
    } finally {
      globalThis.fetch = fetchReel;
      for (const k of ["BREVO_API_KEY", "MALICA_COURRIEL_EXPEDITEUR", "MALICA_URL_PUBLIQUE"]) {
        if (avant[k] === undefined) delete process.env[k];
        else process.env[k] = avant[k];
      }
      const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
      await pool
        .query(
          `update identity.organizations set archived_at = now(),
                  archived_reason = 'fixture de test automatisé' where id = $1`,
          [second.id],
        )
        .catch(() => undefined);
      await pool.end();
    }
  });

  it("le jeton est tiré au hasard : deux invitations, deux jetons sans rapport", async () => {
    const a = await inviter();
    const b = await inviter();
    assert.notEqual(a.jeton, b.jeton);
    assert.match(a.jeton, /^[0-9a-f]{64}$/);
    // Ni l'identifiant de la ligne, ni un horodatage : rien de lisible dedans.
    assert.ok(!a.jeton.includes(a.id.replaceAll("-", "")));
  });

  it("l'état se lit, et une nouvelle invitation révoque la précédente", async () => {
    const a = await inviter();
    const b = await inviter();
    const e = await etats();
    assert.equal(e[a.id], "revoquee");
    assert.equal(e[b.id], "en_attente");
    await assert.rejects(
      rpc(contact, "identite", "accepterInvitationParLien", a.jeton),
      /n'est plus valable/,
    );
  });

  it("le cabinet révoque avant usage : le lien ne sert plus, par aucun chemin", async () => {
    const c = await inviter();
    assert.equal(
      ((await rpc(contact, "identite", "lireInvitationParLien", c.jeton)) as { statut: string })
        .statut,
      "en_attente",
    );
    await rpc(expert, "identite", "revoquerInvitation", c.id);
    assert.equal((await etats())[c.id], "revoquee");
    assert.equal(
      ((await rpc(contact, "identite", "lireInvitationParLien", c.jeton)) as { statut: string })
        .statut,
      "revoquee",
    );
    // Ni par le lien…
    await assert.rejects(
      rpc(contact, "identite", "accepterInvitationParLien", c.jeton),
      /n'est plus valable/,
    );
    // …ni par l'adresse, le chemin de l'écran /office.
    const pourMoi = (await rpc(contact, "collab", "invitationsPourMoi")) as { id: string }[];
    assert.ok(!pourMoi.some((i) => i.id === c.id), "une invitation révoquée n'est plus proposée");
    await assert.rejects(
      rpc(contact, "collab", "repondreAInvitation", c.id, true),
      /n'est plus valable/,
    );
    // Et révoquer ce qui l'est déjà, ou le faire sans mandat, est refusé.
    await assert.rejects(rpc(expert, "identite", "revoquerInvitation", c.id), /en attente/);
    const d = await inviter();
    await assert.rejects(
      rpc(intrus, "identite", "revoquerInvitation", d.id),
      /introuvable ou non autorisee/,
    );
  });

  it("expiré, le lien ne sert plus", async () => {
    const e = await inviter();
    await admin((p) =>
      p.query(
        `update identity.invitations set expires_at = now() - interval '1 second' where id = $1`,
        [e.id],
      ),
    );
    assert.equal((await etats())[e.id], "expiree");
    await assert.rejects(
      rpc(contact, "identite", "accepterInvitationParLien", e.jeton),
      /n'est plus valable/,
    );
  });

  it("il vaut sept jours", async () => {
    const f = await inviter();
    // Mesuré entre les deux dates que pose la base : l'horloge du test n'entre pas en jeu.
    const lue = (
      (await rpc(expert, "identite", "invitationsDuDossier", dossier)) as {
        id: string;
        createdAt: string;
        expiresAt: string;
      }[]
    ).find((i) => i.id === f.id)!;
    const jours =
      (new Date(lue.expiresAt).getTime() - new Date(lue.createdAt).getTime()) / 86_400_000;
    assert.equal(jours, 7);
    // Le lien qui servira à la suite du parcours.
    jeton = f.jeton;
  });

  it("un cabinet sans mandat sur le dossier n'y invite personne", async () => {
    await assert.rejects(
      rpc(intrus, "identite", "inviterContact", dossier, `x-${marque}@essai.local`),
      /Seul un expert du cabinet mandaté/,
    );
  });

  it("une autre adresse que celle invitée ne peut pas accepter", async () => {
    await assert.rejects(
      rpc(intrus, "identite", "accepterInvitationParLien", jeton),
      /introuvable ou non autorisee/,
    );
  });

  it("le contact lit ce qu'il rejoint, puis accepte", async () => {
    const lue = (await rpc(contact, "identite", "lireInvitationParLien", jeton)) as {
      pme: string;
      cabinet: string;
      email: string;
      valable: boolean;
    };
    assert.equal(lue.pme, "ALGORIA FACTORY SARL");
    assert.equal(lue.cabinet, `Cabinet d'Expertises CADG ${marque}`);
    assert.equal(lue.valable, true);

    const r = (await rpc(contact, "identite", "accepterInvitationParLien", jeton)) as {
      tenantId: string;
      role: string;
    };
    assert.equal(r.tenantId, dossier);
    assert.equal(r.role, "dirigeant");
  });

  it("le contact arrive dans un espace vide : le sien, sans une pièce", async () => {
    const orgs = (await rpc(contact, "identite", "listMyOrganizations")) as { id: string }[];
    assert.deepEqual(
      orgs.map((o) => o.id),
      [dossier],
    );
    const pieces = (await rpc(contact, "capture", "lister", dossier)) as unknown[];
    assert.deepEqual(pieces, []);
  });

  it("un lien déjà servi ne sert plus", async () => {
    await assert.rejects(
      rpc(contact, "identite", "accepterInvitationParLien", jeton),
      /n'est plus valable/,
    );
  });

  it("un dossier qui a son dirigeant ne reçoit plus d'invitation du cabinet", async () => {
    await assert.rejects(
      rpc(expert, "identite", "inviterContact", dossier, `second-${marque}@essai.local`),
      /déjà son dirigeant/,
    );
  });

  it("le jeton ne fuit pas : ni l'audit, ni aucune ligne de la base ne le portent en clair", async () => {
    const fuites = await admin(async (p) => {
      const { rows } = await p.query<{ n: number }>(
        `select count(*)::int as n from audit.event_log
          where tenant_id = $1 and payload::text like any($2)`,
        [dossier, jetonsEmis.map((j) => `%${j}%`)],
      );
      const { rows: inv } = await p.query<{ n: number }>(
        `select count(*)::int as n from identity.invitations where token_hash = any($1)`,
        [jetonsEmis],
      );
      return rows[0]!.n + inv[0]!.n;
    });
    assert.ok(jetonsEmis.length >= 8, `jetons émis : ${jetonsEmis.length}`);
    assert.equal(fuites, 0);
  });

  it("accepter n'ouvre que le tenant de l'invitation", async () => {
    const tenants = await sousIdentite(contact.id, async (db) => {
      const { rows } = await db.query<{ t: string }>(`select app.member_orgs() as t`);
      return rows.map((r) => r.t);
    });
    assert.deepEqual(tenants, [dossier], "membre du seul dossier");
    // Ni les pièces du cabinet qui l'a invité, ni celles d'un autre tenant.
    for (const t of [cabinet, autrePme]) {
      assert.deepEqual((await rpc(contact, "capture", "lister", t)) as unknown[], [], t);
    }
  });

  it("isolation : la pièce d'un autre tenant, lue par le contact, revient VIDE, pas en erreur", async () => {
    const parLaListe = (await rpc(contact, "capture", "lister", autrePme)) as unknown[];
    assert.deepEqual(parLaListe, []);
    const parLaVue = await sousIdentite(contact.id, async (db) => {
      const { rows } = await db.query(`select id from pieces_v where id = $1`, [piecEtrangere]);
      return rows;
    });
    assert.deepEqual(parLaVue, []);
  });
});
