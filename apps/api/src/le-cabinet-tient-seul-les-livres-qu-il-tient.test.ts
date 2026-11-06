/**
 * Le cabinet tient seul les livres qu'il tient (revue indépendante de #134).
 *
 * « Malica sans blocage » donne au cabinet la prise en charge : valider,
 * forcer, retourner. La revue a trouvé les portes restées ouvertes autour :
 *
 *   T1  retourner une pièce prise en charge dont le règlement est inscrit
 *       laissait le règlement vivant (régression du lot 1) ;
 *   T2  la PME contre-passait l'écriture du cabinet par la revue — et le
 *       journal du jour gardait l'écriture sans son annulation ;
 *   T3  la PME « validait » l'écriture du cabinet ;
 *   T5  forcer acceptait un code de taxe inconnu ;
 *   T6  forcer une pièce en retour laissait le client devant un geste
 *       devenu impossible ;
 *   T7  une saisie malformée faisait une panne (TypeError), pas un refus ;
 *   T8  ouvrir une pièce retirée la disait « Vue » ; deux ouvertures
 *       simultanées en écrivaient deux ;
 *   T9  un collaborateur non affecté validait, forçait, retournait, voyait ;
 *   T10 la PME lisait le nom du comptable dans `capture.vues`, et
 *       `app.pack_de_la_piece` répondait sur n'importe quelle pièce ;
 *   T11 valider re-proposait côté serveur au lieu d'inscrire ce qui était
 *       affiché.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-cabinet-tient-seul-les-livres-qu-il-tient.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { journalDuJour } from "./depots/journal-du-jour.ts";
import { parametrage } from "./depots/parametrage.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le cabinet tient seul les livres qu'il tient", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `livres-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let collaborateur: Utilisateur;
  let cabinet = "";
  let packId = "";
  let jour = "";
  const motifs: Record<string, string> = {};
  const dossiers: Record<"mandat" | "autonome", { id: string; mf: string }> = {
    mandat: { id: "", mf: matriculeDEssai("A", "M") },
    autonome: { id: "", mf: matriculeDEssai("B", "M") },
  };

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));
  const fait =
    (u: () => Utilisateur) =>
    (methode: string, ...args: unknown[]) => {
      const [depot, nom] = methode.split(".") as [string, string];
      return rpc(u(), depot, nom, ...args);
    };
  const pmeFait = fait(() => dirigeant);
  const cabinetFait = fait(() => expert);
  const collabFait = fait(() => collaborateur);

  let n = 0;
  /** Une facture lue, transmise au cabinet : le Socle en propose l'écriture. */
  const transmise = async (dossier: "mandat" | "autonome" = "mandat") => {
    n += 1;
    const { id: tenant, mf } = dossiers[dossier];
    const l = lectureDEssai({ clientMf: mf, numero: `LIV-${n}` });
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: tenant,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract: l.extract,
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: "facture_achat",
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    await pmeFait("collab.setPieceVis", p.id, "partage");
    return p.id;
  };
  /** Valider comme l'écran : la proposition affichée et son empreinte. */
  const valider = async (u: Utilisateur, id: string) => {
    const p = (await rpc(u, "office", "propositionDePiece", id)) as { empreinte?: string };
    return rpc(u, "office", "valider", id, p.empreinte ?? null) as Promise<string>;
  };
  const lignes = (tax: string | null = "EXO") => [
    { account_code: "601", libelle: "Achat", debit: "100", credit: "0", tax_code: tax },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "100", tax_code: null },
  ];
  const forcer = (u: Utilisateur, pieceId: string, l: unknown = lignes()) =>
    rpc(u, "office", "forcer", {
      pieceId,
      journal: "ACH",
      date: "2026-10-02",
      libelle: "Facture saisie",
      lignes: l,
    }) as Promise<string>;
  const vivantes = async (id: string) =>
    (
      await admin.query<{ id: string; nature: string }>(
        `select e.id, e.nature from socle.ecritures e
          where e.piece_id in (select app.versions_de_la_piece($1)) and app.ecriture_vivante(e.id)
          order by e.nature`,
        [id],
      )
    ).rows;
  const journal = async (dossier: string) =>
    (
      await sousIdentite(expert.id, (db) => journalDuJour.lire(db, cabinet, dossier, jour, "fr"))
    ).journaux.flatMap((x) => x.ecritures);
  const notifications = async (id: string, kind: string) =>
    Number(
      (
        await admin.query<{ n: string }>(
          `select count(*)::text as n from collab.notifications
            where kind = $1 and payload ->> 'piece_id' = $2`,
          [kind, id],
        )
      ).rows[0]!.n,
    );

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    collaborateur = (await creerCompte(`collab-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && expert && collaborateur);
    const creer = (u: Utilisateur, kind: string, nom: string, mode: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, 'TN', 'TND') as id`,
          [kind, nom, mode, mf],
        );
        return rows[0]!.id;
      });
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, "mandate", null);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [cabinet, collaborateur.id],
    );
    for (const mode of ["mandat", "autonome"] as const) {
      const d = dossiers[mode];
      d.id = await creer(
        dirigeant,
        "pme",
        `PME ${mode.toUpperCase()} ${marque}`,
        mode === "mandat" ? "mandate" : "autonome",
        d.mf,
      );
      await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, d.mf));
      const [propose] = await sousIdentite(dirigeant.id, (db) =>
        identite.mandatsProposes(db, d.id),
      );
      await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    }
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    for (const m of await sousIdentite(expert.id, (db) => supervision.motifs(db, "fr")))
      motifs[m.code] = m.id;
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[cabinet, dossiers.mandat.id, dossiers.autonome.id].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("T1 un règlement inscrit bloque le retour, même pièce prise en charge", async () => {
    const id = await transmise();
    await valider(expert, id);
    const paiement = (await pmeFait("capture.enregistrerPaiement", {
      pieceId: id,
      packId,
      moyenCode: "especes",
      montantMineur: 1470126,
      devise: "TND",
      payeLe: "2026-10-03",
    })) as string;
    await pmeFait("office.inscrireLeReglement", paiement, {
      codes: [],
      baseReglee: "1470.126",
      justification: "Fournisseur dispensé de retenue : attestation d'essai.",
    });
    assert.deepEqual(
      (await vivantes(id)).map((e) => e.nature),
      ["piece", "reglement"],
    );
    await assert.rejects(
      cabinetFait("supervision.retourner", {
        pieceId: id,
        motifId: motifs["montant_incoherent"],
        note: "Le total ne se lit pas.",
      }),
      /refus\.retour\.inscrite/,
    );
    assert.deepEqual(
      (await vivantes(id)).map((e) => e.nature),
      ["piece", "reglement"],
      "ni la facture ni le règlement ne sont défaits",
    );
  });

  it("T2 en mandat, la PME ne contre-passe pas l'écriture du cabinet", async () => {
    const id = await transmise();
    const ecriture = await forcer(expert, id);
    await assert.rejects(
      pmeFait("supervision.review", {
        ecritureId: ecriture,
        outcome: "retourne",
        motifId: motifs["montant_incoherent"],
        note: "x",
      }),
      // Depuis le lot S2, la PME ne lit pas l'écriture du cabinet : la porte
      // ne la trouve pas, avant même de juger le geste.
      /refus\.(supervision\.reservee|introuvable\.ecriture)$/,
    );
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        db.query(`select public.socle_ecriture_contre_passer($1, $2)`, [
          ecriture,
          motifs["montant_incoherent"],
        ]),
      ),
      /refus\.(supervision\.reservee|introuvable\.ecriture)$/,
    );
    assert.deepEqual(
      (await vivantes(id)).map((e) => e.id),
      [ecriture],
    );
  });

  it("T2 toute contre-passation d'une écriture du journal y entre aussi", async () => {
    // Un dossier autonome tient ses livres. Il défaisait l'écriture que son
    // cabinet a prise en charge ; depuis le lot S2, la PME d'un dossier où un
    // cabinet est engagé ne lit plus l'écriture du cabinet, et ne la trouve
    // donc plus (décision portée au dirigeant). Le cabinet, lui, la défait, et
    // le journal du cabinet doit le dire.
    const id = await transmise("autonome");
    const ecriture = await forcer(expert, id);
    const retour = {
      ecritureId: ecriture,
      outcome: "retourne",
      motifId: motifs["montant_incoherent"],
      note: "Erreur de saisie.",
    };
    await assert.rejects(pmeFait("supervision.review", retour), /refus\.introuvable\.ecriture$/);
    await cabinetFait("supervision.review", retour);
    const lignesDuJour = await journal(dossiers.autonome.id);
    assert.equal(lignesDuJour.filter((x) => x.id === ecriture).length, 1);
    assert.equal(
      lignesDuJour.filter((x) => x.contrePasse === ecriture).length,
      1,
      "l'annulation est au journal, à côté de l'écriture",
    );
  });

  it("T3 en mandat, la PME ne valide pas l'écriture du cabinet", async () => {
    const id = await transmise();
    const ecriture = await forcer(expert, id);
    await assert.rejects(
      pmeFait("supervision.review", { ecritureId: ecriture, outcome: "valide" }),
      /refus\.(supervision\.reservee|introuvable\.ecriture)$/,
    );
    assert.equal(await notifications(id, "piece.validee"), 0);
  });

  it("T5 forcer refuse un code de taxe que le référentiel ne connaît pas", async () => {
    const id = await transmise();
    await assert.rejects(forcer(expert, id, lignes("TVA_INCONNUE")), /refus\.ecriture\.taxe/);
    assert.deepEqual(await vivantes(id), []);
    await forcer(expert, id, lignes("TVA19"));
  });

  it("T6 forcer une pièce en retour clôt le retour : le client lit « Prise en charge »", async () => {
    const id = await transmise();
    await cabinetFait("supervision.retourner", {
      pieceId: id,
      motifId: motifs["montant_incoherent"],
      note: "Reprenez la photo.",
    });
    assert.ok(await pmeFait("capture.retourDeLaPiece", id, "fr"));
    await forcer(expert, id);
    assert.equal(await pmeFait("capture.retourDeLaPiece", id, "fr"), null, "plus de carte");
    const { rows } = await admin.query(
      `select payload from audit.event_log where action = 'piece.retour_clos' and object_id = $1`,
      [id],
    );
    assert.equal(rows.length, 1, "le fait qui clôt le retour");
    const d = (await pmeFait("capture.dossier", id)) as {
      piece: { status: string };
      suivi: { prise: string | null } | null;
    };
    assert.equal(d.piece.status, "supervisee");
    assert.equal(d.suivi?.prise, "forcee");
  });

  it("T7 une saisie malformée est un refus métier, jamais une panne", async () => {
    const id = await transmise();
    for (const mal of [null, "x", [{ debit: "1" }], [{ account_code: "601", debit: 1 }]]) {
      await assert.rejects(forcer(expert, id, mal), (e: Error & { code?: string }) => {
        assert.equal(e.code, "22023", `${JSON.stringify(mal)} : ${e.message}`);
        assert.match(e.message, /^refus\.ecriture\./);
        return true;
      });
    }
    await assert.rejects(
      rpc(expert, "office", "forcer", { pieceId: id, journal: "ACH", lignes: lignes() }),
      /refus\.ecriture\.saisie/,
    );
  });

  it("T8 une pièce retirée ne se « voit » pas ; deux ouvertures n'écrivent qu'une vue", async () => {
    const id = await transmise();
    const [a, b] = (await Promise.all([
      cabinetFait("supervision.voir", id),
      cabinetFait("supervision.voir", id),
    ])) as { vueLe: string }[];
    assert.equal(a!.vueLe, b!.vueLe);
    const vues = async (piece: string) =>
      Number(
        (
          await admin.query<{ n: string }>(
            `select count(*)::text as n from capture.vues where piece_id = $1`,
            [piece],
          )
        ).rows[0]!.n,
      );
    assert.equal(await vues(id), 1);

    const retiree = await transmise();
    await admin.query(`update capture.pieces set archivee_le = now() where id = $1`, [retiree]);
    const r = (await cabinetFait("supervision.voir", retiree)) as { vueLe: string | null };
    assert.equal(r.vueLe, null);
    assert.equal(await vues(retiree), 0);
  });

  it("T9 un collaborateur n'agit que sur les dossiers qui lui sont affectés", async () => {
    const id = await transmise();
    const motif = motifs["montant_incoherent"];
    await assert.rejects(collabFait("supervision.voir", id), /refus\.introuvable\.piece$/);
    await assert.rejects(valider(collaborateur, id), /refus\.supervision\.reservee$/);
    await assert.rejects(forcer(collaborateur, id), /refus\.supervision\.reservee$/);
    await assert.rejects(
      collabFait("supervision.retourner", { pieceId: id, motifId: motif, note: "x" }),
      /refus\.supervision\.reservee$/,
    );
    await cabinetFait("collab.assign", {
      cabinetTenantId: cabinet,
      clientTenantId: dossiers.mandat.id,
      collaboratorId: collaborateur.id,
      briefing: null,
    });
    // Affecté, il voit et retourne. Inscrire reste l'acte de l'expert : la
    // base n'ouvre l'écriture qu'à lui (`ecritures_ins_expert`).
    await collabFait("supervision.voir", id);
    await collabFait("supervision.retourner", { pieceId: id, motifId: motif, note: "x" });
    assert.equal(
      (await admin.query(`select status from capture.pieces where id = $1`, [id])).rows[0].status,
      "retournee",
    );
  });

  it("T10 la PME ne lit pas le nom du comptable ; le pack ne se lit pas à côté de la pièce", async () => {
    const id = await transmise();
    await cabinetFait("supervision.voir", id);
    const vuesLues = (u: Utilisateur) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query(`select par_nom from capture.vues where piece_id = $1`, [
          id,
        ]);
        return rows.length;
      });
    assert.equal(await vuesLues(expert), 1, "le cabinet lit son registre");
    assert.equal(await vuesLues(dirigeant), 0, "la PME, non");
    const d = (await pmeFait("capture.dossier", id)) as {
      suivi: { vuePar: string | null; prisePar: string | null } | null;
    };
    assert.match(d.suivi?.vuePar ?? "", /^CABINET D'ESSAI/, "« Vue par {cabinet} »");

    const etranger = (await creerCompte(`etranger-${marque}@essai.local`, mdp))!;
    const pack = await sousIdentite(etranger.id, async (db) => {
      const { rows } = await db.query<{ p: string | null }>(
        `select app.pack_de_la_piece($1) as p`,
        [id],
      );
      return rows[0]!.p;
    });
    assert.equal(pack, null);
  });

  it("T11 valider inscrit la proposition affichée, ou refuse si elle a changé", async () => {
    const id = await transmise();
    await assert.rejects(
      cabinetFait("office.valider", id, "0".repeat(64)),
      /refus\.proposition\.changee/,
    );
    await assert.rejects(cabinetFait("office.valider", id, null), /refus\.proposition\.changee/);
    assert.deepEqual(await vivantes(id), []);
    await valider(expert, id);
    assert.equal((await vivantes(id)).length, 1);
  });
});
