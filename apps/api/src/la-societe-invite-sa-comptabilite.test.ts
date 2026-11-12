/**
 * La société invite sa comptabilité par e-mail (décision du dirigeant du
 * 12 novembre 2026, point 7.1, règle A5).
 *
 * Le propriétaire invite une adresse ; l'expert accepte avec SA comptabilité
 * et le mandat devient actif. L'invitation ne fait entrer personne dans la
 * société. Relancer émet un lien neuf et révoque l'ancien. Aucune épreuve
 * n'envoie de courriel : sans configuration Brevo, `courriel` vaut
 * `non_configure` et le lien se copie à l'écran.
 *
 *   node --experimental-strip-types --test src/la-societe-invite-sa-comptabilite.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import type { InvitationRecue } from "@malica/socle/ports/repositories";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE } from "./circuit-d-essai.ts";
import { courrielInvitation } from "./courriel/invitation.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

async function refus(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    return (e as Error).message;
  }
  return "accepte";
}

describe("le courriel qui invite une comptabilité", () => {
  it("parle à un comptable, jamais à un dirigeant", () => {
    const c = courrielInvitation({
      cabinet: "",
      pme: "SOCIETE ESSAI",
      lien: "https://malica.example/invitation#abc",
      expireLe: new Date("2026-12-12T00:00:00Z"),
      pour: "comptabilite",
    });
    for (const texte of [c.sujet, c.texte, c.html]) {
      assert.match(texte, /tenir sa comptabilité/);
      assert.doesNotMatch(texte, /[Dd]irigeant|Rejoindre mon espace|cabinet/);
    }
    assert.match(c.texte, /SOCIETE ESSAI/);
  });
});

describe("la société invite sa comptabilité", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `invite-compta-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let intrus: Utilisateur;
  let pme = "";
  let cabinet = "";
  let autreCabinet = "";
  let jeton = "";

  const fait = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
        [kind, nom, mf],
      );
      return rows[0]!.id;
    });

  before(async () => {
    const compte = async (qui: string) => {
      const u = await creerCompte(`${marque}-${qui}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(u, qui);
      return u;
    };
    dirigeant = await compte("dirigeant");
    expert = await compte("expert");
    intrus = await compte("intrus");
    pme = await creer(dirigeant, "pme", `SOCIETE ${marque}`, matriculeDEssai());
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    autreCabinet = await creer(intrus, "cabinet", `AUTRE ${marque}`, null);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet, autreCabinet]],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le propriétaire invite ; le lien se copie, aucun courriel ne part sans Brevo", async () => {
    const r = (await fait(dirigeant, "identite.inviterMaComptabilite", pme, expert.email)) as {
      jeton: string;
      courriel: string;
      relance: boolean;
    };
    assert.match(r.jeton, /^[0-9a-f]{64}$/);
    assert.equal(r.relance, false);
    assert.notEqual(r.courriel, "envoye");
    jeton = r.jeton;
    const suivi = (await fait(dirigeant, "identite.invitationDeMaComptabilite", pme)) as {
      email: string;
      statut: string;
    };
    assert.equal(suivi.email, expert.email);
    assert.equal(suivi.statut, "en_attente");
  });

  it("qui n'est pas propriétaire n'invite pas, et ne lit pas le suivi", async () => {
    assert.match(
      await refus(fait(intrus, "identite.inviterMaComptabilite", pme, `${marque}-x@essai.local`)),
      /refus\.reserve\.proprietaire/,
    );
    assert.equal(await fait(intrus, "identite.invitationDeMaComptabilite", pme), null);
  });

  it("relancer émet un lien neuf ; l'ancien ne vaut plus", async () => {
    const r = (await fait(dirigeant, "identite.inviterMaComptabilite", pme, expert.email)) as {
      jeton: string;
      relance: boolean;
    };
    assert.equal(r.relance, true);
    const ancien = (await fait(expert, "identite.lireInvitationParLien", jeton)) as {
      valable: boolean;
    };
    assert.equal(ancien.valable, false);
    jeton = r.jeton;
  });

  it("l'expert la lit comme l'invitation d'une société à sa comptabilité, sans y entrer", async () => {
    const lue = (await fait(expert, "identite.lireInvitationParLien", jeton)) as {
      pme: string;
      pourLaComptabilite: boolean;
      valable: boolean;
    };
    assert.equal(lue.pourLaComptabilite, true);
    assert.equal(lue.valable, true);
    const recues = (await fait(expert, "collab.invitationsPourMoi")) as InvitationRecue[];
    const i = recues.find((x) => x.cabinetTenantId === pme);
    assert.ok(i);
    assert.equal(i.kind, "pme");
    // Les portes d'adhésion ne le font pas entrer dans la société.
    assert.match(
      await refus(fait(expert, "collab.repondreAInvitation", i.id, true)),
      /refus\.invitation\.choisir_la_comptabilite/,
    );
    assert.match(
      await refus(fait(expert, "identite.accepterInvitationParLien", jeton)),
      /refus\.invitation\.choisir_la_comptabilite/,
    );
    const { rows } = await admin.query(
      `select 1 from identity.memberships where tenant_id = $1 and user_id = $2`,
      [pme, expert.id],
    );
    assert.equal(rows.length, 0);
  });

  it("une autre adresse, ou une comptabilité qui n'est pas la sienne, n'accepte pas", async () => {
    assert.match(
      await refus(
        fait(intrus, "identite.accepterInvitationDeLaSociete", {
          jeton,
          invitationId: null,
          cabinetTenantId: autreCabinet,
        }),
      ),
      /refus\.introuvable\.invitation/,
    );
    assert.match(
      await refus(
        fait(expert, "identite.accepterInvitationDeLaSociete", {
          jeton,
          invitationId: null,
          cabinetTenantId: autreCabinet,
        }),
      ),
      /refus\.reserve\.expert/,
    );
  });

  it("l'expert accepte avec sa comptabilité : le mandat est actif, la société le voit", async () => {
    const r = (await fait(expert, "identite.accepterInvitationDeLaSociete", {
      jeton,
      invitationId: null,
      cabinetTenantId: cabinet,
    })) as { pmeTenantId: string; cabinetTenantId: string };
    assert.equal(r.pmeTenantId, pme);
    const vu = (await fait(dirigeant, "identite.monCabinet", pme)) as { id: string } | null;
    assert.equal(vu?.id, cabinet);
    const suivi = (await fait(dirigeant, "identite.invitationDeMaComptabilite", pme)) as {
      statut: string;
    };
    assert.equal(suivi.statut, "acceptee");
    // Le lien ne sert qu'une fois.
    assert.match(
      await refus(
        fait(expert, "identite.accepterInvitationDeLaSociete", {
          jeton,
          invitationId: null,
          cabinetTenantId: cabinet,
        }),
      ),
      /refus\.invitation\.expiree/,
    );
    // La société garde sa licence : rien de la facturation n'a bougé.
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from facturation.licence_organisations where tenant_id = $1`,
      [pme],
    );
    assert.equal(rows[0]!.n, 1);
  });

  it("un mandat actif : on n'invite pas une seconde comptabilité", async () => {
    assert.match(
      await refus(
        fait(dirigeant, "identite.inviterMaComptabilite", pme, `${marque}-autre@essai.local`),
      ),
      /refus\.mandat\.un_seul_actif/,
    );
  });

  it("les portes de l'invitation appartiennent au portier : elles ne contournent pas la RLS de l'appelant", async () => {
    const { rows } = await admin.query<{ fn: string; proprietaire: string }>(
      `select p.proname as fn, pg_get_userbyid(p.proowner) as proprietaire
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('comptabilite_inviter', 'comptabilite_invitation_lire',
                            'comptabilite_invitation_accepter', 'comptable_interne_inviter',
                            'place_comptable_lire')`,
    );
    assert.equal(rows.length, 5);
    for (const r of rows) assert.equal(r.proprietaire, "portier", r.fn);
  });

  it("l'expert n'écrit pas un mandat sans l'invitation ouverte de la société", async () => {
    // Une société sans aucune invitation : la comptabilité de l'expert n'y a
    // pas de mandat à écrire, et la politique d'écriture le refuse.
    const sans = await creer(dirigeant, "pme", `SOCIETE SANS ${marque}`, matriculeDEssai());
    const refusee = await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(
        `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, created_by)
         values ($1, $2, 'actif', current_date, $3)`,
        [sans, cabinet, expert.id],
      ),
    ).then(
      () => "accepte",
      (e: Error) => e.message,
    );
    assert.notEqual(refusee, "accepte");
    await admin.query(
      `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé' where id = $1`,
      [sans],
    );
  });

  it("décliner une invitation de sa comptabilité réussit, expire l'invitation, et ne crée aucune appartenance", async () => {
    const societe = await creer(dirigeant, "pme", `SOCIETE DECLINE ${marque}`, matriculeDEssai());
    const offre = (await fait(
      dirigeant,
      "identite.inviterMaComptabilite",
      societe,
      expert.email,
    )) as {
      jeton: string;
    };
    const recues = (await fait(expert, "collab.invitationsPourMoi")) as InvitationRecue[];
    const inv = recues.find((i) => i.cabinetTenantId === societe);
    assert.ok(inv, "l'invitation arrive à l'expert");
    assert.ok(offre.jeton);
    const r = (await fait(expert, "collab.repondreAInvitation", inv.id, false)) as {
      rejoint: boolean;
    };
    assert.equal(r.rejoint, false);
    const { rows } = await admin.query(
      `select 1 from identity.memberships where tenant_id = $1 and user_id = $2`,
      [societe, expert.id],
    );
    assert.equal(rows.length, 0, "aucune appartenance");
    const lue = (await fait(expert, "identite.lireInvitationParLien", offre.jeton)) as {
      valable: boolean;
    };
    assert.equal(lue.valable, false, "l'invitation est expirée");
    await admin.query(
      `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé' where id = $1`,
      [societe],
    );
  });
});
