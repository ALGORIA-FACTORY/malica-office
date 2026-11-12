/**
 * L'ancienne comptabilité garde son archive (recette du 11 novembre 2026, 1.6).
 *
 * Après la révocation du mandat, la pièce validée répondait « Pièce
 * indisponible » chez l'ancienne comptabilité (`capture.dossier` → 404), et la
 * société quittait sa Bibliothèque. Règle 10 du 16 octobre : la comptabilité
 * qui a travaillé garde son archive en lecture seule, sur la période traitée.
 *
 * C'est une affaire de RLS (R6) : la lecture s'élargit à ce qu'elle a pris en
 * charge pendant son mandat, l'écriture reste refusée. Tout est éprouvé sous
 * l'identité de l'ancienne comptabilité, par les portes du navigateur.
 *
 *   node --experimental-strip-types --test src/l-ancienne-comptabilite-garde-son-archive.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { documents, documentsAImprimer, documentsLies } from "./bibliotheque.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { supervision } from "./depots/supervision.ts";

describe("l'ancienne comptabilité garde son archive", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let confrere: Utilisateur;
  let nouvelle = "";
  /** Prise en charge par l'ancienne comptabilité, pendant son mandat. */
  let traitee = "";
  let ecritureTraitee = "";
  /** Transmise pendant le mandat, jamais prise en charge. */
  let jamaisTraitee = "";
  /** Déposée après la fin du mandat. */
  let posterieure = "";

  const chezLeComptable = async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    await s.fait("sami", "collab.envoyer", id);
    await s.fait("amel", "collab.envoyer", id);
    return id;
  };

  /** Ce que l'ancienne comptabilité lit, table par table, sous sa propre identité. */
  const luParLAncienne = <T extends Record<string, unknown>>(sql: string, args: unknown[]) =>
    sousIdentite(s.gens.expert.id, async (db) => (await db.query<T>(sql, args)).rows);

  before(async () => {
    const marque = `archive-${Date.now()}`;
    s = await monterUneSociete(marque);
    traitee = await chezLeComptable();
    ecritureTraitee = await s.priseEnCharge(traitee);
    jamaisTraitee = await chezLeComptable();

    await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.revoquerMandat(db, s.pme, "Je change de comptabilité"),
    );
    posterieure = await s.deposer("amel", "entite");

    const c = await creerCompte(`${marque}-confrere@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    confrere = c;
    nouvelle = await sousIdentiteDuServeur(confrere.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`CONFRERE ${marque}`],
      );
      return rows[0]!.id;
    });
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

  it("la pièce qu'elle a prise en charge se lit encore, avec son écriture et ses lignes", async () => {
    const d = (await s.fait("expert", "capture.dossier", traitee)) as {
      piece: { id: string };
      archive: { mandatClosLe: string } | null;
    };
    assert.equal(d.piece.id, traitee);
    assert.ok(d.archive, "le dossier dit que la pièce se lit en archive");
    assert.match(d.archive.mandatClosLe, /^\d{4}-\d{2}-\d{2}$/);

    const ecritures = (await s.fait("expert", "office.ecrituresForPiece", traitee)) as Array<{
      id: string;
      lines: unknown[];
    }>;
    assert.deepEqual(
      ecritures.map((e) => e.id),
      [ecritureTraitee],
    );
    assert.equal(ecritures[0]!.lines.length, 2);
  });

  it("le fichier se télécharge : la route de l'aperçu retrouve la pièce", async () => {
    // `stockage.ts` autorise le téléchargement par cette lecture, et elle seule.
    const lignes = await luParLAncienne(`select id from pieces_v where id = $1`, [traitee]);
    assert.equal(lignes.length, 1);
  });

  it("elle ne lit ni la pièce qu'elle n'a jamais traitée, ni celle d'après son mandat", async () => {
    const pieces = await luParLAncienne<{ id: string }>(
      `select id from pieces_v where tenant_id = $1`,
      [s.pme],
    );
    assert.deepEqual(
      pieces.map((p) => p.id),
      [traitee],
    );
    for (const id of [jamaisTraitee, posterieure])
      await assert.rejects(s.fait("expert", "capture.dossier", id), /piece\.not_found/);
    for (const table of ["extractions_v", "citations_v", "token_plan_v"]) {
      const autres = await luParLAncienne(
        `select 1 from ${table} where tenant_id = $1 and piece_id <> $2`,
        [s.pme, traitee],
      );
      assert.equal(autres.length, 0, table);
    }
  });

  it("la société reste dans sa Bibliothèque, marquée en archive, avec cette seule pièce", async () => {
    const clients = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      supervision.listClients(db, s.cabinet),
    );
    const client = clients.find((c) => c.tenantId === s.pme);
    assert.equal(client?.engagementStatus, "termine");
    assert.equal(client?.archive, true);
    assert.match(client!.name, /^SOCIETE /);
    // L'archive n'est pas du travail en cours : rien dans la file, rien aux compteurs.
    assert.equal(client?.aTraiter, 0);
    assert.equal(
      Object.values(client!.parStatut).reduce((n, x) => n + x, 0),
      0,
    );
    const file = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      supervision.queue(db, s.cabinet),
    );
    assert.deepEqual(
      file.filter((f) => f.tenantId === s.pme),
      [],
    );

    const docs = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      documents(db, s.cabinet, s.pme, null),
    );
    assert.deepEqual(
      docs.map((d) => d.id),
      [traitee],
    );

    // Le dossier à télécharger : la pièce, son écriture, ses deux lignes.
    const lie = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      documentsLies(db, s.cabinet, s.pme, [traitee]),
    );
    assert.deepEqual(
      lie.documents.map((d) => d.id),
      [traitee],
    );
    assert.deepEqual([...new Set(lie.ecritures.map((e) => e.id))], [ecritureTraitee]);
    assert.equal(lie.ecritures.length, 2);
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        documentsLies(db, s.cabinet, s.pme, [jamaisTraitee]),
      ),
    );
  });

  it("elle imprime son archive comme elle la télécharge, et rien de plus", async () => {
    for (const cabinet of [s.cabinet, null]) {
      const [societe] = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        documentsAImprimer(db, cabinet, [traitee]),
      );
      assert.deepEqual(
        societe?.documents.map((d) => d.id),
        [traitee],
      );
    }
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        documentsAImprimer(db, s.cabinet, [jamaisTraitee]),
      ),
    );
  });

  it("rien ne s'écrit : ni retour, ni écriture, ni contre-passation, ni mise à jour directe", async () => {
    await assert.rejects(
      s.fait("expert", "supervision.retourner", {
        pieceId: traitee,
        motifId: s.motifs["montant_incoherent"],
      }),
      /refus\.supervision\.reservee/,
    );
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        db.query(`select public.socle_ecriture_contre_passer($1, $2)`, [
          ecritureTraitee,
          s.motifs["montant_incoherent"],
        ]),
      ),
      /refus\.supervision\.reservee/,
    );
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [traitee]),
      ),
    );
    await assert.rejects(s.priseEnCharge(traitee));
    await assert.rejects(s.fait("expert", "supervision.voir", traitee));
    // Les portes qui ne jugent que « la pièce se lit » : elle se lit désormais,
    // et aucune n'écrit pour autant — la politique d'écriture de chaque table
    // exige toujours un membre ou un mandat en vigueur.
    const moyen = (
      await s.admin.query<{ code: string }>(
        `select code from ref.payment_means where pack_version_id = $1 limit 1`,
        [s.pack],
      )
    ).rows[0]!.code;
    const portes: Array<[string, unknown[]]> = [
      [`select public.capture_precision_persist($1, 'issuer', 'Autre')`, [traitee]],
      [`select public.capture_piece_set_vis($1, 'entite', false)`, [traitee]],
      [`select public.capture_piece_supprimer($1, false)`, [traitee]],
      [`select public.capture_sceller_empreinte($1, repeat('a', 64))`, [traitee]],
      [`select public.piece_demander($1, 'rappel')`, [traitee]],
      [`select public.piece_renvoyer($1)`, [traitee]],
      [
        `select public.paiement_inscrire($1, $2, $3::uuid, 1000, 'TND', current_date, null, null)`,
        [traitee, moyen, s.pack],
      ],
      [`select public.socle_ecriture_review($1, 'valide', null, null)`, [ecritureTraitee]],
      [`select public.fait_consigner('ecriture.forcee', $1, '{}'::jsonb)`, [ecritureTraitee]],
    ];
    for (const [sql, args] of portes)
      await assert.rejects(
        sousIdentiteDuServeur(s.gens.expert.id, (db) => db.query(sql, args)),
        sql,
      );
    // En direct, sans porte : la base refuse le droit lui-même (R6).
    for (const sql of [
      `update capture.pieces set status = 'recue' where id = $1`,
      `update socle.ecritures set libelle = 'réécrite' where piece_id = $1`,
      `delete from socle.ecritures where piece_id = $1`,
    ])
      await assert.rejects(luParLAncienne(sql, [traitee]), /permission denied|droit refusé/);
    const { rows } = await s.admin.query<{ status: string; libelle: string }>(
      `select p.status, e.libelle from capture.pieces p
         join socle.ecritures e on e.piece_id = p.id where e.id = $1`,
      [ecritureTraitee],
    );
    assert.equal(rows[0]?.libelle, "Facture essai");
    assert.equal(rows[0]?.status, "supervisee");
  });

  it("redemander un mandat ne fait pas sortir la société de sa Bibliothèque", async () => {
    // Revue de #362 : `mandat_proposer` réutilise l'engagement terminé et le
    // repasse à « proposé » ; l'archive ne dépend pas de ce statut.
    const legalId = (
      await s.admin.query<{ legal_id: string }>(
        `select legal_id from identity.organizations where id = $1`,
        [s.pme],
      )
    ).rows[0]!.legal_id;
    await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      identite.proposerMandat(db, s.cabinet, legalId),
    );
    const clients = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      supervision.listClients(db, s.cabinet),
    );
    const client = clients.find((c) => c.tenantId === s.pme);
    assert.equal(client?.engagementStatus, "propose");
    assert.equal(client?.archive, true);
    const docs = await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
      documents(db, s.cabinet, s.pme, null),
    );
    assert.deepEqual(
      docs.map((d) => d.id),
      [traitee],
    );
  });

  it("ce que la comptabilité suivante inscrit ensuite lui reste fermé", async () => {
    const legalId = (
      await s.admin.query<{ legal_id: string }>(
        `select legal_id from identity.organizations where id = $1`,
        [s.pme],
      )
    ).rows[0]!.legal_id;
    await sousIdentiteDuServeur(confrere.id, (db) =>
      identite.proposerMandat(db, nouvelle, legalId),
    );
    const propose = (
      await sousIdentiteDuServeur(s.gens.amel.id, (db) => identite.mandatsProposes(db, s.pme))
    ).find((p) => p.cabinetTenantId === nouvelle);
    await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );
    // La nouvelle comptabilité contre-passe l'écriture de l'ancienne : le
    // journal de l'ancienne en reçoit la trace (`geler_la_prise_en_charge`),
    // datée d'après son mandat.
    await sousIdentiteDuServeur(confrere.id, (db) =>
      db.query(`select public.socle_ecriture_contre_passer($1, $2)`, [
        ecritureTraitee,
        s.motifs["montant_incoherent"],
      ]),
    );
    const { rows: toutes } = await s.admin.query(
      `select id from socle.ecritures where tenant_id = $1`,
      [s.pme],
    );
    assert.equal(toutes.length, 2, "l'écriture et sa contre-passation existent");

    const lues = await luParLAncienne<{ id: string }>(
      `select id from ecritures_v where tenant_id = $1`,
      [s.pme],
    );
    assert.deepEqual(
      lues.map((e) => e.id),
      [ecritureTraitee],
    );
    const lignes = await luParLAncienne<{ ecriture_id: string }>(
      `select distinct ecriture_id from ecriture_lignes_v where tenant_id = $1`,
      [s.pme],
    );
    assert.deepEqual(
      lignes.map((l) => l.ecriture_id),
      [ecritureTraitee],
    );
  });
});
