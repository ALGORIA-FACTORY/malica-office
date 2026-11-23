/**
 * Une adresse se prouve avant d'ouvrir une invitation (audit de sécurité du
 * 23 novembre 2026, B4).
 *
 * Le scénario exécuté par l'auditeur : une société invite sa comptabilité à une
 * adresse ; quelqu'un crée un compte avec CETTE adresse avant son propriétaire,
 * se crée une comptabilité, et accepte l'invitation depuis ses invitations —
 * sans jamais avoir reçu le courriel. Il devenait la comptabilité de la société.
 *
 * Ce qui tient désormais : une adresse seulement déclarée ne voit ni n'accepte
 * aucune invitation, ni depuis sa liste ni par un lien. Elle se prouve par le
 * lien de confirmation, et par lui seul : le contre-audit a montré qu'un lien
 * d'invitation n'est pas une preuve — l'usurpateur s'invitait lui-même depuis
 * une société à lui, recevait le jeton à l'écran, et se « prouvait » l'adresse.
 *
 *   node --experimental-strip-types --test src/une-adresse-se-prouve-avant-l-invitation.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import type { InvitationRecue } from "@malica/socle/ports/repositories";

import {
  adresseConfirmee,
  confirmerAdresse,
  creerCompte,
  demanderConfirmationAdresse,
  type Utilisateur,
} from "./auth.ts";
import { BASE_CONFIGUREE } from "./circuit-d-essai.ts";
import { compteDEssai } from "./compte-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { organisationDEssai } from "./organisation-d-essai.ts";
import { executerRpc } from "./rpc.ts";

async function refus(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    return (e as Error).message;
  }
  return "accepte";
}

const MDP = "MotDePasseTresLong2026!";

describe("une adresse se prouve avant d'ouvrir une invitation", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `adresse-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const adresseInvitee = `${marque}-comptable@essai.local`;
  let dirigeant: Utilisateur;
  let usurpateur: Utilisateur;
  let pme = "";
  let cabinetUsurpe = "";
  let jeton = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  const fait = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await organisationDEssai(db, `$1, $2, 'mandate', $3, 'TN', 'TND'`, [
        kind,
        nom,
        mf,
      ]);
      return rows[0]!.id;
    });

  before(async () => {
    const d = await compteDEssai(`${marque}-dirigeant@essai.local`, MDP);
    assert.ok(d);
    dirigeant = d;
    pme = await creer(dirigeant, "pme", `SOCIETE ${marque}`, matriculeDEssai());
    const r = (await fait(dirigeant, "identite.inviterMaComptabilite", pme, adresseInvitee)) as {
      jeton: string;
    };
    jeton = r.jeton;

    // L'usurpateur s'inscrit avec l'adresse invitée : elle n'est que déclarée.
    const u = await creerCompte(adresseInvitee, MDP);
    assert.ok(u);
    usurpateur = u;
    cabinetUsurpe = await creer(usurpateur, "cabinet", `COMPTA ${marque}`, null);

    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));
  });

  after(async () => {
    try {
      await arret?.();
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinetUsurpe]],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("un compte neuf n'a qu'une adresse déclarée", async () => {
    assert.equal(await adresseConfirmee(usurpateur.id), false);
  });

  it("déclarée, l'adresse ne voit aucune invitation et n'en accepte aucune sans le lien", async () => {
    const recues = (await fait(usurpateur, "collab.invitationsPourMoi")) as InvitationRecue[];
    assert.deepEqual(recues, [], "aucune invitation ne se montre");
    const { rows } = await admin.query<{ id: string }>(
      `select id from identity.invitations where tenant_id = $1 and accepted_at is null`,
      [pme],
    );
    const id = rows[0]!.id;
    assert.match(
      await refus(
        fait(usurpateur, "identite.accepterInvitationDeLaSociete", {
          jeton: null,
          invitationId: id,
          cabinetTenantId: cabinetUsurpe,
        }),
      ),
      /refus\.introuvable\.invitation/,
    );
    assert.match(
      await refus(fait(usurpateur, "collab.repondreAInvitation", id, true)),
      /introuvable|invitation/,
    );
    const mandat = await admin.query(
      `select 1 from identity.engagements where pme_org_id = $1 and cabinet_org_id = $2`,
      [pme, cabinetUsurpe],
    );
    assert.equal(mandat.rows.length, 0, "l'usurpateur n'est la comptabilité de personne");
  });

  it("même avec le lien, une adresse déclarée n'accepte pas : le lien n'est pas une preuve", async () => {
    assert.match(
      await refus(
        fait(usurpateur, "identite.accepterInvitationDeLaSociete", {
          jeton,
          invitationId: null,
          cabinetTenantId: cabinetUsurpe,
        }),
      ),
      /refus\.introuvable\.invitation/,
    );
    assert.equal(await adresseConfirmee(usurpateur.id), false);
  });

  it("s'inviter soi-même depuis une société à soi ne prouve pas l'adresse d'autrui (contre-audit)", async () => {
    // L'usurpateur ouvre SA société et invite l'adresse qu'il a usurpée : il
    // reçoit le jeton à l'écran.
    const sienne = await creer(usurpateur, "pme", `SIENNE ${marque}`, matriculeDEssai());
    const r = (await fait(
      usurpateur,
      "identite.inviterMaComptabilite",
      sienne,
      adresseInvitee,
    )) as {
      jeton: string;
    };
    assert.match(
      await refus(
        fait(usurpateur, "identite.accepterInvitationDeLaSociete", {
          jeton: r.jeton,
          invitationId: null,
          cabinetTenantId: cabinetUsurpe,
        }),
      ),
      /refus\.introuvable\.invitation/,
    );
    assert.equal(await adresseConfirmee(usurpateur.id), false, "rien n'est prouvé");
    const recues = (await fait(usurpateur, "collab.invitationsPourMoi")) as InvitationRecue[];
    assert.deepEqual(recues, [], "l'invitation de la victime reste cachée");
    await admin.query(
      `update identity.organizations
          set archived_at = now(), archived_reason = 'fixture de test automatisé'
        where id = $1`,
      [sienne],
    );
  });

  it("confirmée par son lien, la vraie personne accepte l'invitation", async () => {
    const demande = await demanderConfirmationAdresse(usurpateur.id);
    assert.ok(demande);
    assert.equal(await confirmerAdresse(demande.secret), true);
    const r = (await fait(usurpateur, "identite.accepterInvitationDeLaSociete", {
      jeton,
      invitationId: null,
      cabinetTenantId: cabinetUsurpe,
    })) as { pmeTenantId: string };
    assert.equal(r.pmeTenantId, pme);
  });

  it("le lien de confirmation prouve l'adresse, une seule fois", async () => {
    const neuf = await creerCompte(`${marque}-neuf@essai.local`, MDP);
    assert.ok(neuf);
    const demande = await demanderConfirmationAdresse(neuf.id);
    assert.ok(demande, "un lien part pour une adresse déclarée");
    assert.equal(demande.email, `${marque}-neuf@essai.local`);
    assert.equal(await confirmerAdresse("inconnu-inconnu-inconnu"), false);
    assert.equal(await confirmerAdresse(demande.secret), true);
    assert.equal(await adresseConfirmee(neuf.id), true);
    assert.equal(await confirmerAdresse(demande.secret), false, "le lien ne sert qu'une fois");
    assert.equal(await demanderConfirmationAdresse(neuf.id), null, "plus rien à confirmer");
    const empreintes = await admin.query<{ empreinte: string }>(
      `select empreinte from auth.confirmations_adresse where user_id = $1`,
      [neuf.id],
    );
    assert.ok(
      empreintes.rows.every((r) => r.empreinte !== demande.secret),
      "seule l'empreinte du secret est gardée",
    );
  });

  it("par HTTP : l'adresse se lit, se confirme par le lien, et un lien inconnu répond 410", async () => {
    const r = await fetch(`${base}/auth/adresse/confirmer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "x".repeat(32) }),
    });
    assert.equal(r.status, 410);
  });

  it("dix mots de passe faux pour un même compte : le onzième essai est refusé, quelle que soit l'adresse IP", async () => {
    const email = `${marque}-cible@essai.local`;
    await compteDEssai(email, MDP);
    const essai = (mdp: string) =>
      fetch(`${base}/auth/connexion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, motDePasse: mdp }),
      });
    const statuts: number[] = [];
    for (let i = 0; i < 10; i += 1) statuts.push((await essai(`Faux-mot-de-passe-${i}!`)).status);
    assert.ok(
      statuts.every((s) => s === 401),
      `dix refus ordinaires : ${statuts.join(",")}`,
    );
    assert.equal((await essai("Faux-mot-de-passe-11!")).status, 429);
    assert.equal((await essai(MDP)).status, 429, "le compte est tenu un quart d'heure");
  });
});
