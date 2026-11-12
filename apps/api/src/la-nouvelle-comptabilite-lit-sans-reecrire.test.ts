/**
 * La nouvelle comptabilité voit l'historique, sans jamais réécrire celui de
 * l'ancienne (décision du dirigeant du 12 novembre 2026, 7.3).
 *
 * Une société change de comptabilité. La nouvelle lit tout le dossier ; les
 * écritures de l'ancienne lui sont « inscrites par [ancienne] · lecture
 * seule » : elle ne les revoit ni ne les retourne, elle les contre-passe au
 * jour et à son nom, puis régularise. Les pièces que l'ancienne n'avait pas
 * prises en charge passent à la nouvelle. Le changement est au journal des
 * trois parties ; l'ancienne est prévenue, la nouvelle reçoit le modèle de
 * lettre au confrère — que Malica n'envoie pas.
 *
 * Tout est joué sous l'identité de chacun, par les portes.
 *
 *   node --experimental-strip-types --test src/la-nouvelle-comptabilite-lit-sans-reecrire.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { supervision } from "./depots/supervision.ts";

describe("la nouvelle comptabilité lit sans réécrire", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let confrere: Utilisateur;
  let nouvelle = "";
  let nomDeLaNouvelle = "";
  let traitee = "";
  let ecritureDeLAncienne = "";
  let enAttente = "";
  let jour = "";

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
    const marque = `succession-${Date.now()}`;
    s = await monterUneSociete(marque);
    traitee = await chezLeComptable();
    ecritureDeLAncienne = await s.priseEnCharge(traitee);
    enAttente = await chezLeComptable();

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
    jour = (await s.admin.query<{ j: string }>(`select current_date::text as j`)).rows[0]!.j;
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

  it("la séparation au jour du changement est au journal des trois parties", async () => {
    const { rows } = await s.admin.query<{ tenant_id: string; jour: string; precedente: string }>(
      `select tenant_id, payload ->> 'jour' as jour, payload ->> 'precedente' as precedente
         from audit.event_log
        where action = 'mandat.changement_de_comptabilite' and payload ->> 'pme_org_id' = $1`,
      [s.pme],
    );
    assert.deepEqual(new Set(rows.map((r) => r.tenant_id)), new Set([s.pme, s.cabinet, nouvelle]));
    assert.ok(rows.every((r) => r.jour === jour && r.precedente === s.nomDuCabinet));
  });

  it("l'ancienne est prévenue chez elle ; la nouvelle reçoit le modèle de lettre", async () => {
    const lues = (qui: string, cabinet: string, kind: string) =>
      sousIdentite(qui, async (db) => {
        const { rows } = await db.query<{ nouvelle: string }>(
          `select payload ->> 'nouvelle' as nouvelle from collab.notifications
            where tenant_id = $1 and kind = $2`,
          [cabinet, kind],
        );
        return rows.map((r) => r.nouvelle);
      });
    assert.deepEqual(await lues(s.gens.expert.id, s.cabinet, "mandat.succede"), [nomDeLaNouvelle]);
    assert.deepEqual(await lues(confrere.id, nouvelle, "mandat.lettre_au_confrere"), [
      nomDeLaNouvelle,
    ]);

    const lettre = await parLaNouvelle((db) => identite.lettreAuConfrere(db, nouvelle, s.pme));
    assert.equal(lettre?.confrere, s.nomDuCabinet);
    assert.equal(lettre?.comptabilite, nomDeLaNouvelle);
    assert.match(lettre!.client, /^SOCIETE /);
    assert.equal(lettre?.depuis, jour);
    // Ni la société, ni l'ancienne ne lisent la lettre de la nouvelle.
    assert.equal(
      await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
        identite.lettreAuConfrere(db, nouvelle, s.pme),
      ),
      null,
    );
    assert.equal(
      await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        identite.lettreAuConfrere(db, s.cabinet, s.pme),
      ),
      null,
    );
  });

  it("l'écriture de l'ancienne se lit « inscrite par » elle, chez la nouvelle seulement", async () => {
    const [e] = await parLaNouvelle((db) => office.ecrituresForPiece(db, traitee));
    assert.equal(e?.id, ecritureDeLAncienne);
    assert.equal(e?.inscritePar, s.nomDuCabinet);
    const [archive] = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      office.ecrituresForPiece(db, traitee),
    );
    assert.equal(archive?.inscritePar, null, "chez l'ancienne, c'est la sienne");
  });

  it("la nouvelle ne la revoit pas, ne la retourne pas : la ligne reste telle quelle", async () => {
    const avant = await s.admin.query(
      `select reviewed_by, reviewed_at, review_outcome from socle.ecritures where id = $1`,
      [ecritureDeLAncienne],
    );
    await assert.rejects(
      parLaNouvelle((db) =>
        supervision.review(db, { ecritureId: ecritureDeLAncienne, outcome: "valide" }),
      ),
      /refus\.ecriture\.d_un_confrere/,
    );
    await assert.rejects(
      parLaNouvelle((db) =>
        supervision.retourner(db, { pieceId: traitee, motifId: s.motifs["montant_incoherent"]! }),
      ),
      /refus\.ecriture\.d_un_confrere/,
    );
    const apres = await s.admin.query(
      `select reviewed_by, reviewed_at, review_outcome from socle.ecritures where id = $1`,
      [ecritureDeLAncienne],
    );
    assert.deepEqual(apres.rows, avant.rows);
  });

  it("elle la contre-passe au jour et à son nom, puis régularise par une écriture à elle", async () => {
    const rev = await parLaNouvelle((db) =>
      office.contrePasserLEcritureDuConfrere(db, ecritureDeLAncienne),
    );
    const { rows } = await s.admin.query<{ date: string; booked_by: string; motif: string }>(
      `select e.date_ecriture::text as date, e.booked_by, m.code as motif
         from socle.ecritures e join ref.rejet_motifs m on m.id = e.reversal_reason_id
        where e.id = $1`,
      [rev],
    );
    assert.equal(rows[0]?.date, jour, "jamais dans la période de l'ancienne");
    assert.equal(rows[0]?.booked_by, confrere.id);
    assert.equal(rows[0]?.motif, "contre_passation_du_confrere");
    // Une seconde fois : il n'y a plus rien de vivant à contre-passer.
    await assert.rejects(
      parLaNouvelle((db) => office.contrePasserLEcritureDuConfrere(db, ecritureDeLAncienne)),
    );

    const regularisation = await parLaNouvelle(async (db) => {
      const id = await office.propose(db, {
        pieceId: traitee,
        journal: "ACH",
        date: jour,
        libelle: "Régularisation",
        packVersionId: s.pack,
        devise: "TND",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0", tax_code: "EXO" },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "100.000",
            tax_code: null,
          },
        ],
      });
      await office.book(db, id);
      return id;
    });
    const lues = await parLaNouvelle((db) => office.ecrituresForPiece(db, traitee));
    const parId = new Map(lues.map((e) => [e.id, e]));
    assert.equal(parId.get(rev)?.inscritePar, null);
    assert.equal(parId.get(regularisation)?.inscritePar, null);
    assert.equal(parId.get(regularisation)?.vivante, true);
    assert.equal(parId.get(ecritureDeLAncienne)?.inscritePar, s.nomDuCabinet);
  });

  it("le geste « Contre-passer » ne sert qu'aux écritures d'une autre comptabilité", async () => {
    const piece = await chezLeComptable();
    const sienne = await parLaNouvelle(async (db) => {
      await db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [piece]);
      const id = await office.propose(db, {
        pieceId: piece,
        journal: "ACH",
        date: jour,
        libelle: "Facture essai",
        packVersionId: s.pack,
        devise: "TND",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "50.000", credit: "0", tax_code: "EXO" },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "50.000",
            tax_code: null,
          },
        ],
      });
      await office.book(db, id);
      return id;
    });
    await assert.rejects(
      parLaNouvelle((db) => office.contrePasserLEcritureDuConfrere(db, sienne)),
      /refus\.introuvable\.ecriture/,
    );
  });

  it("la pièce que l'ancienne n'avait pas prise en charge est dans la file de la nouvelle", async () => {
    const file = await parLaNouvelle((db) => supervision.queue(db, nouvelle));
    assert.ok(file.some((f) => f.pieceId === enAttente));
    const fileDeLAncienne = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      supervision.queue(db, s.cabinet),
    );
    assert.ok(!fileDeLAncienne.some((f) => f.pieceId === enAttente));
  });
});
