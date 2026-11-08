/**
 * La page Clients unique de la comptabilité (8 novembre 2026).
 *
 * Les décisions du dirigeant d'ALGORIA, rejouées sur une vraie base :
 *  - un dossier ouvert par la comptabilité ne coûte rien avant l'arrivée du
 *    dirigeant (A2), et l'offre choisie démarre d'elle-même à son arrivée ;
 *  - la comptabilité qui paie monte l'offre seule (le dirigeant est prévenu),
 *    une descente attend son accord ;
 *  - quand elle arrête de payer, l'abonnement revient au dirigeant, prévenu ;
 *  - elle donne les places quand elle paie, elle les suggère sinon ;
 *  - les sociétés d'un même dirigeant se regroupent sous sa licence, dans la
 *    limite de ce que son offre inclut.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { facturation } from "../depots/facturation.ts";
import { identite } from "../depots/identite.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la page Clients unique de la comptabilité", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `clients-${Date.now()}`;
  const mf1 = matriculeDEssai();
  const mf2 = matriculeDEssai();
  let expert: Utilisateur;
  let dirigeant: Utilisateur;
  let cabinet = "";
  let pme = "";
  let pme2 = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const commeExpert = <T>(f: Parameters<typeof sousIdentite<T>>[1]) => sousIdentite(expert.id, f);
  const commeDirigeant = <T>(f: Parameters<typeof sousIdentite<T>>[1]) =>
    sousIdentite(dirigeant.id, f);

  const forfait = async (tenant: string) =>
    (
      await admin.query<{ offre_code: string }>(
        `select f.offre_code from facturation.forfait_courant_v f
           join facturation.licence_organisations lo on lo.licence_id = f.licence_id
          where lo.tenant_id = $1`,
        [tenant],
      )
    ).rows[0]?.offre_code;

  const etat = async (tenant: string) =>
    (await commeExpert((db) => identite.etatDesClients(db, cabinet))).find(
      (c) => c.tenantId === tenant,
    )!;

  const ouvrir = (nom: string, mf: string) =>
    commeExpert(async (db) => {
      const { rows } = await db.query<{ r: { id: string } }>(
        `select public.cabinet_ouvrir_dossier($1, $2, $3, null) as r`,
        [cabinet, nom, mf],
      );
      return rows[0]!.r.id;
    });

  const inviterEtRejoindre = async (tenant: string) => {
    const jeton = await commeExpert(async (db) => {
      const { rows } = await db.query<{ r: { jeton: string } }>(
        `select public.dossier_inviter_contact($1, $2) as r`,
        [tenant, dirigeant.email],
      );
      return rows[0]!.r.jeton;
    });
    await commeDirigeant((db) =>
      db.query(`select public.invitation_par_lien_accepter($1)`, [jeton]),
    );
  };

  before(async () => {
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e && d);
    expert = e;
    dirigeant = d;
    cabinet = await commeExpert(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`COMPTA ${marque}`],
      );
      return rows[0]!.id;
    });
    pme = await ouvrir(`Épicerie ${marque}`, mf1);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, pme2, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("A2 : un dossier ouvert sans dirigeant porte une offre proposée, rien n'est facturé", async () => {
    const { id } = await commeExpert((db) =>
      facturation.proposerAbonnement(db, cabinet, pme, "solo"),
    );
    const e = await etat(pme);
    assert.equal(e.dirigeantPresent, false);
    assert.equal(e.accesStatut, "propose");
    assert.equal(e.accesOffre, "solo");
    assert.equal(e.licenceId, null);
    const r = await commeExpert((db) => facturation.changerOffreAbonnement(db, id, "team"));
    assert.equal(r.effet, "proposition");
    const apres = await etat(pme);
    assert.equal(apres.accesOffre, "team");
    assert.equal(apres.accesStatut, "propose");
  });

  it("la comptabilité retire sa proposition avant l'arrivée, puis en refait une", async () => {
    const e = await etat(pme);
    const r = await commeExpert((db) => facturation.arreterAbonnement(db, e.accesId!));
    assert.equal(r.effet, "retiree");
    assert.equal((await etat(pme)).accesId, null);
    await commeExpert((db) => facturation.proposerAbonnement(db, cabinet, pme, "team"));
  });

  it("le dirigeant rejoint par son invitation : l'offre de la comptabilité démarre d'elle-même", async () => {
    await inviterEtRejoindre(pme);
    const e = await etat(pme);
    assert.equal(e.dirigeantPresent, true);
    assert.equal(e.accesStatut, "actif");
    assert.equal(await forfait(pme), "team");
    assert.ok(e.licenceId);
  });

  it("une montée s'applique sur-le-champ et le dirigeant est prévenu", async () => {
    const e = await etat(pme);
    const r = await commeExpert((db) =>
      facturation.changerOffreAbonnement(db, e.accesId!, "premium"),
    );
    assert.equal(r.effet, "immediat");
    assert.equal(await forfait(pme), "premium");
    const notes = await admin.query(
      `select 1 from collab.notifications where tenant_id = $1 and kind = 'acces.monte'`,
      [pme],
    );
    assert.equal(notes.rowCount, 1);
  });

  it("les sociétés d'un même dirigeant se regroupent sous sa licence", async () => {
    pme2 = await ouvrir(`Librairie ${marque}`, mf2);
    await commeExpert((db) => facturation.proposerAbonnement(db, cabinet, pme2, "premium"));
    // Cette fois par l'invitation reçue dans l'application, pas par le lien.
    await commeExpert((db) =>
      db.query(`select public.dossier_inviter_contact($1, $2)`, [pme2, dirigeant.email]),
    );
    const { rows } = await admin.query<{ id: string }>(
      `select id from identity.invitations where tenant_id = $1 and accepted_at is null
          and revoked_at is null order by created_at desc limit 1`,
      [pme2],
    );
    await commeDirigeant((db) =>
      db.query(`select public.invitation_repondre($1, true)`, [rows[0]!.id]),
    );
    const a = await etat(pme);
    const b = await etat(pme2);
    assert.equal(b.licenceId, a.licenceId);
    assert.equal(b.organisations, 2);
  });

  it("une société couverte par la licence partagée ne reçoit pas un second abonnement", async () => {
    await assert.rejects(
      commeExpert((db) => facturation.proposerAbonnement(db, cabinet, pme2, "solo")),
      /refus\.abonnement\.couvert_par_la_licence$/,
    );
    // Sa proposition d'avant l'arrivée s'est retirée : pas de double facture.
    const b = await etat(pme2);
    assert.equal(b.accesId, null);
  });

  it("une proposition tranchée ne reste pas à traiter", async () => {
    const { rows } = await admin.query(
      `select 1 from collab.notifications
        where tenant_id = $1 and kind = 'acces.propose' and read_at is null`,
      [pme],
    );
    assert.equal(rows.length, 0);
  });

  it("une descente qui ne tient pas dans ce qui est utilisé est refusée", async () => {
    const e = await etat(pme);
    await assert.rejects(
      commeExpert((db) => facturation.changerOffreAbonnement(db, e.accesId!, "solo")),
      /refus\.forfait\.empeche/,
    );
  });

  it("une descente attend l'accord du dirigeant", async () => {
    // Libère la deuxième société de la licence pour que la descente tienne.
    await admin.query(
      `update identity.organizations set archived_at = now(), archived_reason = 'test'
        where id = $1`,
      [pme2],
    );
    await admin.query(`delete from facturation.licence_organisations where tenant_id = $1`, [pme2]);
    const e = await etat(pme);
    const r = await commeExpert((db) => facturation.changerOffreAbonnement(db, e.accesId!, "team"));
    assert.equal(r.effet, "accord_attendu");
    assert.equal(await forfait(pme), "premium");
    assert.equal((await etat(pme)).descenteOffre, "team");
    const d = await commeDirigeant((db) => facturation.descentePourMoi(db, pme));
    assert.equal(d?.offre_code, "team");
    await assert.rejects(
      commeExpert((db) => facturation.repondreDescente(db, d!.descente_id, true)),
      /refus\.reserve\.dirigeant$/,
    );
    await commeDirigeant((db) => facturation.repondreDescente(db, d!.descente_id, true));
    assert.equal(await forfait(pme), "team");
    const apres = await etat(pme);
    assert.equal(apres.accesOffre, "team");
    assert.equal(apres.descenteOffre, null);
  });

  it("quand la comptabilité paie, elle donne la place", async () => {
    const r = await commeExpert((db) =>
      identite.placePourLeClient(db, cabinet, pme, `caisse-${marque}@essai.local`),
    );
    assert.equal(r.mode, "donnee");
  });

  it("elle arrête de payer : l'abonnement revient au dirigeant, prévenu, et la place se suggère", async () => {
    const e = await etat(pme);
    const r = await commeExpert((db) => facturation.arreterAbonnement(db, e.accesId!));
    assert.equal(r.effet, "rendu_au_dirigeant");
    assert.equal(await forfait(pme), "team");
    const notes = await admin.query(
      `select 1 from collab.notifications where tenant_id = $1 and kind = 'acces.arrete'`,
      [pme],
    );
    assert.equal(notes.rowCount, 1);
    const p = await commeExpert((db) =>
      identite.placePourLeClient(db, cabinet, pme, `compta-${marque}@essai.local`),
    );
    assert.equal(p.mode, "suggeree");
  });

  it("la comptabilité corrige le nom et l'adresse ; un matricule faux est refusé", async () => {
    const r = await commeExpert((db) =>
      identite.modifierDossier(db, {
        cabinetId: cabinet,
        pmeId: pme,
        nom: `Épicerie Fine ${marque}`,
        legalId: mf1,
        adresse: "Rue de Rome, Tunis",
      }),
    );
    assert.equal(r.adresse, "Rue de Rome, Tunis");
    await assert.rejects(
      commeExpert((db) =>
        identite.modifierDossier(db, {
          cabinetId: cabinet,
          pmeId: pme,
          nom: "X",
          legalId: "123",
          adresse: null,
        }),
      ),
      /refus\./,
    );
    await assert.rejects(
      commeDirigeant((db) =>
        identite.modifierDossier(db, {
          cabinetId: cabinet,
          pmeId: pme,
          nom: "X",
          legalId: mf1,
          adresse: null,
        }),
      ),
      /refus\.reserve\.expert_mandate$/,
    );
  });

  it("une liste à importer se vérifie ligne par ligne, sans rien créer", async () => {
    const neuf = matriculeDEssai();
    const lignes = await commeExpert((db) =>
      identite.verifierDossiers(db, cabinet, [
        { matricule: neuf, raison_sociale: "Neuve SARL", email: "neuve@essai.local" },
        { matricule: mf1, raison_sociale: "", email: "" },
        { matricule: "123", raison_sociale: "Faux", email: "faux@essai.local" },
        { matricule: neuf, raison_sociale: "Doublon", email: "d@essai.local" },
        { matricule: matriculeDEssai(), raison_sociale: "Sans mail", email: "" },
      ]),
    );
    assert.deepEqual(
      lignes.map((l) => l.statut),
      ["pret", "deja_client", "a_corriger", "a_corriger", "a_corriger"],
    );
    assert.equal(lignes[3]!.motif, "refus.import.matricule_en_double");
    assert.equal(lignes[4]!.motif, "refus.invitation.adresse");
  });
});
