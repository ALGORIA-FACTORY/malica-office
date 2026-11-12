/**
 * Changer de comptabilité en un seul geste (recette du 11 novembre 2026, 3.2)
 * et ne rien montrer d'une société à qui l'on a seulement demandé un mandat
 * (3.3).
 *
 * 3.2 — Accepter le mandat d'une nouvelle comptabilité était refusé
 * (`refus.mandat.un_seul_actif`) tant que l'ancienne était mandatée. Règle D2
 * du 16 octobre : passage simultané, sans trou, l'ancienne prévenue avec le
 * motif.
 *
 * 3.3 — Une comptabilité qui a seulement DEMANDÉ un mandat lisait le nom du
 * dirigeant et « a rejoint ». Prouvé ici sur ce que la fonction rend, sous
 * l'identité de cette comptabilité.
 *
 *   node --experimental-strip-types --test src/changer-de-comptabilite-en-un-geste.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";

describe("changer de comptabilité en un seul geste", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let legalId = "";
  const autres: Array<{ u: Utilisateur; id: string; nom: string }> = [];

  const uneComptabilite = async (marque: string, n: number) => {
    const u = await creerCompte(`${marque}-compta${n}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    const nom = `COMPTA ${n} ${marque}`;
    const id = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'autonome', null, 'TN', 'TND') as id`,
        [nom],
      );
      return rows[0]!.id;
    });
    await sousIdentiteDuServeur(u.id, (db) => identite.proposerMandat(db, id, legalId));
    return { u, id, nom };
  };
  const propositions = () =>
    sousIdentiteDuServeur(s.gens.amel.id, (db) => identite.mandatsProposes(db, s.pme));
  const mandats = async () =>
    (
      await s.admin.query<{ cabinet: string; status: string; du: string; au: string | null }>(
        `select cabinet_org_id as cabinet, status, starts_on::text as du, ends_on::text as au
           from identity.engagements where pme_org_id = $1`,
        [s.pme],
      )
    ).rows;

  before(async () => {
    const marque = `changer-${Date.now()}`;
    s = await monterUneSociete(marque);
    legalId = (
      await s.admin.query<{ legal_id: string }>(
        `select legal_id from identity.organizations where id = $1`,
        [s.pme],
      )
    ).rows[0]!.legal_id;
    autres.push(await uneComptabilite(marque, 2), await uneComptabilite(marque, 3));
  });

  after(async () => {
    try {
      await s.admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [autres.map((a) => a.id)],
      );
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("3.3 — une comptabilité qui a seulement demandé ne lit ni le dirigeant, ni « a rejoint »", async () => {
    const [demandee] = autres;
    const etat = await sousIdentiteDuServeur(demandee!.u.id, (db) =>
      identite.etatDesClients(db, demandee!.id),
    );
    const ligne = etat.find((e) => e.tenantId === s.pme);
    assert.ok(ligne, "la demande est listée");
    assert.equal(ligne.dirigeantPresent, false);
    assert.equal(ligne.titulaireNom, null);
    assert.equal(ligne.invitationEmail, null);
    assert.equal(ligne.adresse, null);
    assert.equal(ligne.licenceId, null);
    assert.equal(ligne.siegesOccupes, null);
    assert.equal(ligne.placesEnAttente, 0);

    // La comptabilité mandatée, elle, les lit.
    const mandatee = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      identite.etatDesClients(db, s.cabinet),
    );
    const sienne = mandatee.find((e) => e.tenantId === s.pme);
    assert.equal(sienne?.dirigeantPresent, true);
    assert.ok(sienne?.titulaireNom);
  });

  it("la proposition dit la comptabilité qu'elle remplacerait", async () => {
    const p = await propositions();
    assert.equal(p.length, 2);
    assert.ok(p.every((x) => x.remplace === s.nomDuCabinet));
  });

  it("sans motif, ou par qui n'est pas dirigeant, rien ne change", async () => {
    const [p] = await propositions();
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.amel.id, (db) => identite.repondreAuMandat(db, p!.id, true)),
      /refus\.mandat\.motif_de_revocation$/,
    );
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.sami.id, (db) =>
        identite.repondreAuMandat(db, p!.id, true, "Je préfère"),
      ),
      /refus\.reserve\.dirigeant$/,
    );
    const m = await mandats();
    assert.deepEqual(
      m.filter((x) => x.status === "actif").map((x) => x.cabinet),
      [s.cabinet],
    );
  });

  it("« Accepter et quitter » : l'ancienne finit le jour où la nouvelle commence, prévenue du motif", async () => {
    const [nouvelle] = autres;
    const p = (await propositions()).find((x) => x.cabinetTenantId === nouvelle!.id)!;
    await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.repondreAuMandat(db, p.id, true, "Plus proche de nous"),
    );
    const m = await mandats();
    const ancienne = m.find((x) => x.cabinet === s.cabinet)!;
    const neuve = m.find((x) => x.cabinet === nouvelle!.id)!;
    assert.equal(ancienne.status, "termine");
    assert.equal(neuve.status, "actif");
    assert.equal(ancienne.au, neuve.du, "aucun jour sans comptabilité");
    assert.equal(m.filter((x) => x.status === "actif").length, 1);

    const motifs = await sousIdentite(s.gens.expert.id, async (db) => {
      const { rows } = await db.query<{ motif: string }>(
        `select payload ->> 'motif' as motif from collab.notifications
          where tenant_id = $1 and kind = 'mandat.revoque'`,
        [s.cabinet],
      );
      return rows.map((r) => r.motif);
    });
    assert.deepEqual(motifs, ["Plus proche de nous"]);
    const { rows } = await s.admin.query(
      `select 1 from audit.event_log
        where action = 'mandat.changement_de_comptabilite' and tenant_id = $1`,
      [s.pme],
    );
    assert.equal(rows.length, 1, "la séparation est au journal");
  });

  it("la proposition restante dit désormais la nouvelle comptabilité", async () => {
    const p = await propositions();
    assert.deepEqual(
      p.map((x) => x.remplace),
      [autres[0]!.nom],
    );
  });
});
