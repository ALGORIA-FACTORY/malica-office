/**
 * Une pièce retournée ne bloque jamais, et « Renvoyer » n'inscrit jamais une
 * lecture fausse (« Malica sans blocage », maquette validée le 28 octobre 2026).
 *
 * Relevé sur la base de test le 28 octobre, pièce transmise puis retournée par
 * le cabinet — avant toute écriture, ET après prise en charge puis
 * contre-passation (`socle_ecriture_review` « retourne ») :
 *   - la PME ne pouvait ni la supprimer, ni la garder (« demande son accord ») ;
 *   - une suppression accordée par le cabinet échouait (« engagée ») ;
 *   - un rappel accordé la mettait dans un espace privé, d'où plus rien ne la
 *     sortait (« engagée ») ;
 *   - « Reprendre la photo » créait une pièce sans lien, et « Renvoyer »
 *     réinscrivait l'ANCIENNE lecture — avec ses montants faux.
 *
 * Chaque cas est joué deux fois : avant écriture, après contre-passation.
 *
 *   node --experimental-strip-types --test src/une-piece-retournee-ne-bloque-jamais.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

type Cas = "avant écriture" | "après contre-passation";
const CAS: Cas[] = ["avant écriture", "après contre-passation"];

describe("une pièce retournée ne bloque jamais", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sans-blocage-${Date.now()}`;
  const legalId = matriculeDEssai();
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let pack = "";
  const motifs: Record<string, string> = {};
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }));
  const pmeFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return rpc(dirigeant, depot, nom, ...args);
  };
  const cabinetFait = (methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return rpc(expert, depot, nom, ...args);
  };

  /** Une lecture minimale, persistée par la porte du serveur : un jeton, un type lu. */
  const lire = (pieceId: string) =>
    sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query(
        `select public.capture_read_persist($1, $2::jsonb, 'extract.v1', $3::jsonb,
                                             '[]'::jsonb, '[]'::jsonb)`,
        [
          pieceId,
          JSON.stringify([{ page: 1, ordinal: 0, text: "TOTAL", x0: 0, y0: 0, x1: 1, y1: 1 }]),
          JSON.stringify({ document_kind: "facture_achat" }),
        ],
      ),
    );

  let n = 0;
  /** Une pièce transmise, lue, au type lu mais pas confirmé : le cas réel. */
  const transmiseLue = async () => {
    n += 1;
    const id = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, now())
         returning id`,
        [pme, `essai/${marque}-${n}.pdf`, `${marque}-${n}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    await lire(id);
    return id;
  };

  /** Le cabinet propose une écriture sur la pièce, lignes données. */
  const proposer = (pieceId: string) =>
    sousIdentiteDuServeur(expert.id, (db) =>
      office.propose(db, {
        pieceId,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture essai",
        packVersionId: pack,
        devise: "TND",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0", tax_code: null },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "100.000",
            tax_code: null,
          },
        ],
      }),
    );
  /** Le cabinet inscrit lui-même l'écriture de la pièce (« prise en charge »). */
  const priseEnCharge = async (pieceId: string) => {
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_confirmer_le_type_lu($1)`, [pieceId]),
    );
    const e = await proposer(pieceId);
    await sousIdentiteDuServeur(expert.id, (db) => office.book(db, e));
    return e;
  };

  /**
   * Une pièce retournée par le cabinet (motif « montants incohérents » : le
   * geste demandé est de reprendre la photo).
   */
  const retournee = async (cas: Cas) => {
    const id = await transmiseLue();
    if (cas === "avant écriture") {
      await sousIdentiteDuServeur(expert.id, (db) =>
        supervision.retourner(db, { pieceId: id, motifId: motifs["montant_incoherent"]! }),
      );
    } else {
      const ecriture = await priseEnCharge(id);
      await sousIdentiteDuServeur(expert.id, (db) =>
        supervision.review(db, {
          ecritureId: ecriture,
          outcome: "retourne",
          motifId: motifs["montant_incoherent"]!,
        }),
      );
    }
    assert.equal(await etat(id).then((e) => e?.status), "retournee");
    return id;
  };

  // `to_jsonb` : la colonne de l'archive n'existe pas encore sur une base
  // d'avant ce changement, et l'épreuve doit y échouer sur le FAIT, pas ici.
  const etat = async (id: string) =>
    (
      await admin.query<{ status: string; vis: string; archivee_le: string | null }>(
        `select status, vis::text as vis, to_jsonb(p) ->> 'archivee_le' as archivee_le
           from capture.pieces p where id = $1`,
        [id],
      )
    ).rows[0] ?? null;
  const ecrituresVivantes = async (id: string) =>
    Number(
      (
        await admin.query<{ n: string }>(
          `select count(*)::text as n from socle.ecritures e
            where e.piece_id = $1 and e.status = 'booked' and app.ecriture_vivante(e.id)`,
          [id],
        )
      ).rows[0]!.n,
    );
  const notifie = async (id: string, kind: string) =>
    (
      await admin.query(
        `select 1 from collab.notifications
          where tenant_id = $1 and kind = $2 and payload ->> 'piece_id' = $3`,
        [pme, kind, id],
      )
    ).rows.length > 0;
  const listeDeLaPme = async () =>
    ((await pmeFait("capture.listAvecLecture", pme)) as Array<{ id: string }>).map((p) => p.id);

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
          [kind, nom, "autonome", mf, "TN", "TND"],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    await sousIdentiteDuServeur(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.mandatsProposes(db, pme),
    );
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );
    pack = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    for (const m of await sousIdentiteDuServeur(expert.id, (db) => supervision.motifs(db, "fr")))
      motifs[m.code] = m.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  for (const cas of CAS) {
    describe(cas, () => {
      it("la PME supprime une pièce retournée : effacée sans écriture, archivée sinon", async () => {
        const id = await retournee(cas);
        assert.equal(await pmeFait("capture.supprimer", id), true);
        const apres = await etat(id);
        if (cas === "avant écriture") {
          assert.equal(apres, null, "aucune écriture n'a jamais existé : la pièce part");
          assert.ok(await notifie(id, "piece.supprimee"), "le cabinet est prévenu");
        } else {
          assert.ok(apres?.archivee_le, "une écriture contre-passée la retient : archivée");
          assert.equal(await ecrituresVivantes(id), 0);
          assert.ok(await notifie(id, "piece.archivee"), "le cabinet est prévenu");
          // Invisible pour la PME, conservée côté cabinet.
          assert.ok(!(await listeDeLaPme()).includes(id));
          await assert.rejects(pmeFait("capture.dossier", id), /piece\.not_found/);
          const vue = (await cabinetFait("capture.dossier", id)) as { piece: { id: string } };
          assert.equal(vue.piece.id, id);
        }
      });

      it("la PME garde une pièce retournée DANS LA SOCIÉTÉ (« Gardée »), et le cabinet le sait", async () => {
        // Décision du 28 octobre 2026 : garder ne sort jamais une pièce de la
        // société — ni le justificatif d'une écriture contre-passée, ni la
        // pièce d'un siège que le dirigeant garde.
        const id = await retournee(cas);
        assert.deepEqual(await pmeFait("collab.garderPiece", id), { changed: true });
        const { rows } = await admin.query<{ vis: string; status: string; gardee: boolean }>(
          `select vis::text as vis, status, gardee_le is not null as gardee
             from capture.pieces where id = $1`,
          [id],
        );
        assert.deepEqual(rows[0], { vis: "entite", status: "lue", gardee: true });
        assert.ok(await notifie(id, "piece.gardee"));
        // Jamais vers un espace privé, même par la porte de la visibilité.
        const autre = await retournee(cas);
        await assert.rejects(pmeFait("collab.setPieceVis", autre, "personnel"));
        assert.equal((await etat(autre))?.vis, "partage");
      });

      it("une suppression demandée puis accordée aboutit, sans jamais être acceptée puis impossible", async () => {
        const id = await retournee(cas);
        await pmeFait("collab.demanderSurPiece", id, "suppression");
        await cabinetFait("collab.repondreSurPiece", id, "suppression", true, null);
        const apres = await etat(id);
        if (cas === "avant écriture") assert.equal(apres, null);
        else assert.ok(apres?.archivee_le);
      });

      it("un rappel accordé rend la pièce à la SOCIÉTÉ, d'où elle se supprime", async () => {
        const id = await retournee(cas);
        await pmeFait("collab.demanderSurPiece", id, "rappel");
        await cabinetFait("collab.repondreSurPiece", id, "rappel", true, null);
        assert.equal((await etat(id))?.vis, "entite", "jamais un espace privé");
        assert.equal(await pmeFait("capture.supprimer", id), true);
        const apres = await etat(id);
        if (cas === "avant écriture") assert.equal(apres, null);
        else assert.ok(apres?.archivee_le);
      });

      it("reprendre la photo REMPLACE : la nouvelle hérite du retour, des rattachements et de la file", async () => {
        const ancienne = await retournee(cas);
        const bl = await transmiseLue();
        await pmeFait("capture.rattacher", ancienne, bl);
        const { transmise_le: transmiseLe } = (
          await admin.query<{ transmise_le: Date }>(
            `select transmise_le from capture.pieces where id = $1`,
            [ancienne],
          )
        ).rows[0]!;

        const { id: nouvelle } = (await pmeFait("capture.enregistrer", {
          tenantId: pme,
          source: "photo",
          vis: "partage",
          idempotencyKey: `${marque}-remplace-${ancienne}`,
          contentType: "image/jpeg",
          remplace: ancienne,
        })) as { id: string };

        const n2 = await admin.query<{ vis: string; status: string; transmise_le: Date }>(
          `select vis::text as vis, status, transmise_le from capture.pieces where id = $1`,
          [nouvelle],
        );
        assert.equal(n2.rows[0]?.vis, "partage");
        assert.equal(n2.rows[0]?.status, "retournee", "elle porte le retour en cours");
        assert.equal(
          n2.rows[0]?.transmise_le.toISOString(),
          transmiseLe.toISOString(),
          "elle garde la place de l'ancienne dans la file du cabinet",
        );
        const r = (await pmeFait("capture.retourDeLaPiece", nouvelle, "fr")) as {
          motif: string;
          fait: boolean;
        } | null;
        assert.equal(r?.motif, "montant_incoherent");
        assert.equal(r?.fait, true, "reprendre la photo EST le geste demandé");
        const liees = (await pmeFait("capture.piecesRattachees", nouvelle)) as Array<{
          id: string;
        }>;
        assert.deepEqual(
          liees.map((p) => p.id),
          [bl],
        );

        // L'ancienne reste, comme version précédente, et quitte les listes.
        assert.ok(await etat(ancienne), "jamais effacée");
        const liste = await listeDeLaPme();
        assert.ok(liste.includes(nouvelle) && !liste.includes(ancienne));
        const file = (await cabinetFait("supervision.queue", cabinet, pme)) as Array<{
          id?: string;
          pieceId?: string;
        }>;
        assert.ok(!file.some((x) => (x.pieceId ?? x.id) === ancienne));
        const d1 = (await pmeFait("capture.dossier", ancienne)) as {
          piece: { remplaceePar: string | null };
        };
        assert.equal(d1.piece.remplaceePar, nouvelle);
        const d2 = (await pmeFait("capture.dossier", nouvelle)) as {
          piece: { remplace: string | null };
        };
        assert.equal(d2.piece.remplace, ancienne);
        assert.ok(await notifie(nouvelle, "piece.remplacee"));

        // L'ancienne lecture ne s'inscrit plus, par personne.
        await assert.rejects(proposer(ancienne), /refus\.piece\.remplacee/);

        // Rejouer l'enregistrement (réseau perdu) rend la même pièce, sans doublon.
        const rejoue = (await pmeFait("capture.enregistrer", {
          tenantId: pme,
          source: "photo",
          vis: "partage",
          idempotencyKey: `${marque}-remplace-${ancienne}`,
          contentType: "image/jpeg",
          remplace: ancienne,
        })) as { id: string };
        assert.equal(rejoue.id, nouvelle);
      });

      it("dans la file du cabinet, la photo de remplacement garde la place de l'ancienne", async () => {
        const ancienne = await retournee(cas);
        // Envoyée APRÈS l'ancienne, retournée elle aussi : même priorité.
        const plusRecente = await retournee(cas);
        const { id: nouvelle } = (await pmeFait("capture.enregistrer", {
          tenantId: pme,
          source: "photo",
          vis: "partage",
          idempotencyKey: `${marque}-file-${ancienne}`,
          contentType: "image/jpeg",
          remplace: ancienne,
        })) as { id: string };
        const file = (
          (await cabinetFait("supervision.queue", cabinet, pme)) as Array<{ pieceId: string }>
        ).map((x) => x.pieceId);
        assert.ok(
          file.indexOf(plusRecente) < file.indexOf(nouvelle),
          "classée à la date d'envoi de l'ancienne, pas à celle de la photo",
        );
      });

      it("les règlements saisis sur l'ancienne photo se lisent sur la nouvelle", async () => {
        const ancienne = await retournee(cas);
        const paiement = (await pmeFait("capture.enregistrerPaiement", {
          pieceId: ancienne,
          packId: pack,
          moyenCode: "especes",
          montantMineur: 40000,
          devise: "TND",
          payeLe: "2026-10-03",
        })) as string;
        const { id: nouvelle } = (await pmeFait("capture.enregistrer", {
          tenantId: pme,
          source: "photo",
          vis: "partage",
          idempotencyKey: `${marque}-paiement-${ancienne}`,
          contentType: "image/jpeg",
          remplace: ancienne,
        })) as { id: string };
        const vus = (await pmeFait("capture.paiementsDUnePiece", nouvelle)) as Array<{
          id: string;
          montantMineur: number | null;
        }>;
        assert.deepEqual(
          vus.map((p) => [p.id, p.montantMineur]),
          [[paiement, 40000]],
        );
        // Le fait n'a pas bougé (R7) : le règlement reste inscrit sur sa pièce.
        const { rows } = await admin.query<{ piece_id: string }>(
          `select piece_id from capture.paiements where id = $1`,
          [paiement],
        );
        assert.equal(rows[0]?.piece_id, ancienne);
      });

      it("lue, la photo de remplacement garde son retour jusqu'à « Renvoyer »", async () => {
        const ancienne = await retournee(cas);
        const { id: nouvelle } = (await pmeFait("capture.enregistrer", {
          tenantId: pme,
          source: "photo",
          vis: "partage",
          idempotencyKey: `${marque}-lue-${ancienne}`,
          contentType: "image/jpeg",
          remplace: ancienne,
        })) as { id: string };
        await lire(nouvelle);
        assert.equal((await etat(nouvelle))?.status, "retournee");
        assert.ok(await pmeFait("capture.retourDeLaPiece", nouvelle, "fr"));
      });

      it("« Renvoyer » remet la pièce au cabinet, sans écriture, et jamais l'ancienne lecture", async () => {
        const id = await retournee(cas);
        const avant = await ecrituresVivantes(id);
        await pmeFait("capture.renvoyer", id);
        assert.equal((await etat(id))?.status, "lue", "envoyée : au cabinet d'en décider");
        assert.equal(await ecrituresVivantes(id), avant, "la PME n'inscrit rien");
        assert.equal(await pmeFait("capture.retourDeLaPiece", id, "fr"), null);
        assert.ok(await notifie(id, "piece.renvoyee"));

        // Une pièce remplacée ne se renvoie pas : c'est la nouvelle qui part.
        const ancienne = await retournee(cas);
        await pmeFait("capture.enregistrer", {
          tenantId: pme,
          source: "photo",
          vis: "partage",
          idempotencyKey: `${marque}-renvoi-${ancienne}`,
          contentType: "image/jpeg",
          remplace: ancienne,
        });
        await assert.rejects(pmeFait("capture.renvoyer", ancienne), /refus\.piece\.remplacee/);
      });
    });
  }

  it("une suppression ne se demande pas sur une pièce prise en charge : refus dès la demande", async () => {
    const id = await transmiseLue();
    await priseEnCharge(id);
    await assert.rejects(
      pmeFait("collab.demanderSurPiece", id, "suppression"),
      /refus\.suppression\.inscrite/,
    );
  });

  /* ======================= relecture indépendante du lot (28 octobre 2026) */

  /** La photo qui remplace `ancienne`, enregistrée comme le fait l'écran. */
  const remplacer = async (ancienne: string, vis = "partage") =>
    (
      (await pmeFait("capture.enregistrer", {
        tenantId: pme,
        source: "photo",
        vis,
        idempotencyKey: `${marque}-r-${ancienne}`,
        contentType: "image/jpeg",
        remplace: ancienne,
      })) as { id: string }
    ).id;
  /** Une pièce privée du dirigeant, jamais partagée. */
  const privee = async () => {
    n += 1;
    return sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'photo', 'personnel', $2, $3, $4) returning id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
  };

  it("une photo privée remplacée puis retirée reste au client : le cabinet ne la lit jamais", async () => {
    const a = await privee();
    const b = await remplacer(a, "personnel");
    assert.equal(await pmeFait("capture.supprimer", b), true);
    const apres = await etat(a);
    assert.ok(apres, "jamais effacée");
    assert.equal(apres?.archivee_le, null, "jamais partagée, sans écriture : pas d'archive");
    await assert.rejects(cabinetFait("capture.dossier", a), /piece\.not_found/);
    assert.ok((await listeDeLaPme()).includes(a), "elle redevient la pièce du client");
  });

  it("une version précédente ne se supprime, ne se garde, ni ne se demande", async () => {
    const ancienne = await retournee("avant écriture");
    await remplacer(ancienne);
    await assert.rejects(pmeFait("capture.supprimer", ancienne), /refus\.piece\.remplacee/);
    await assert.rejects(pmeFait("collab.garderPiece", ancienne), /refus\.piece\.remplacee/);
    await assert.rejects(
      pmeFait("collab.setPieceVis", ancienne, "entite"),
      /refus\.piece\.remplacee/,
    );
    await assert.rejects(
      pmeFait("collab.demanderSurPiece", ancienne, "suppression"),
      /refus\.piece\.remplacee/,
    );
    assert.ok(await etat(ancienne), "toujours là");
  });

  it("les reçus et justificatifs de l'ancienne photo se lisent sur la nouvelle", async () => {
    const ancienne = await retournee("avant écriture");
    const { id: recu } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-recu-${ancienne}`,
      contentType: "application/pdf",
      documentKind: "recu_de_paiement",
      sourcePieceId: ancienne,
    })) as { id: string };
    const nouvelle = await remplacer(ancienne);
    const issues = (await pmeFait("capture.piecesIssuesDe", nouvelle)) as Array<{ id: string }>;
    assert.deepEqual(
      issues.map((p) => p.id),
      [recu],
    );
  });

  it("« Renvoyer » emporte la proposition faite sur l'ancienne lecture", async () => {
    const id = await transmiseLue();
    await proposer(id);
    await sousIdentiteDuServeur(expert.id, (db) =>
      supervision.retourner(db, { pieceId: id, motifId: motifs["montant_incoherent"]! }),
    );
    const propositions = async () =>
      Number(
        (
          await admin.query<{ n: string }>(
            `select count(*)::text as n from socle.ecritures
              where piece_id = $1 and status = 'proposee'`,
            [id],
          )
        ).rows[0]!.n,
      );
    assert.equal(await propositions(), 1);
    await pmeFait("capture.renvoyer", id);
    assert.equal(await propositions(), 0);
  });

  it("une proposition déjà là ne s'inscrit pas sur une pièce remplacée ou archivée", async () => {
    // Le type confirmé : seul le retrait de la pièce doit pouvoir refuser.
    const confirmee = async () => {
      const id = await transmiseLue();
      await sousIdentiteDuServeur(expert.id, (db) =>
        db.query(`select public.piece_confirmer_le_type_lu($1)`, [id]),
      );
      return id;
    };
    const remplacee = await confirmee();
    const e1 = await proposer(remplacee);
    const autre = await privee();
    await admin.query(
      `insert into capture.remplacements (tenant_id, piece_id, remplacee_par) values ($1, $2, $3)`,
      [pme, remplacee, autre],
    );
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) => office.book(db, e1)),
      /refus\.piece\.remplacee/,
    );
    const archivee = await confirmee();
    const e2 = await proposer(archivee);
    await admin.query(`update capture.pieces set archivee_le = now() where id = $1`, [archivee]);
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) => office.book(db, e2)),
      /refus\.piece\.archivee/,
    );
  });

  it("une version précédente ne compte nulle part : TVA, tableau du cabinet, intégrations", async () => {
    // Remplacée depuis la fiche, sans retour : son statut reste « proposée ».
    const ancienne = await transmiseLue();
    await proposer(ancienne);
    const stats = async () =>
      ((await cabinetFait("collab.stats", [pme])) as Array<{ pieces: number }>)[0]?.pieces ?? 0;
    const photos = async () =>
      ((await cabinetFait("integrations.etat", cabinet)) as { piecesApp30j: number }).piecesApp30j;
    const avant = await stats();
    const premiere = await remplacer(ancienne);
    const photosAvant = await photos();
    // Une photo reprise elle-même reprise : une seule photo compte.
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: pme,
            source: "photo",
            vis: "partage",
            idempotencyKey: `${marque}-r2-${premiere}`,
            contentType: "image/jpeg",
            remplace: premiere,
          },
        ],
      }),
    );
    assert.equal(await photos(), photosAvant, "la photo remplacée ne compte plus");
    assert.equal(await stats(), avant, "une pièce reste une pièce, quelle que soit sa photo");
    const { rows } = await admin.query(`select 1 from pieces_qui_comptent_v where id = $1`, [
      ancienne,
    ]);
    assert.equal(rows.length, 0, "une version précédente n'entre dans aucune déclaration");
  });

  it("la reprise d'une pièce déjà envoyée passe, même licence impayée", async () => {
    const ancienne = await retournee("avant écriture");
    await admin.query(
      `update facturation.licences l set statut = 'suspendue', suspendue_le = now()
         from facturation.licence_organisations lo
        where lo.licence_id = l.id and lo.tenant_id = $1`,
      [pme],
    );
    try {
      const nouvelle = await remplacer(ancienne);
      assert.equal((await etat(nouvelle))?.vis, "partage", "elle hérite du partage");
    } finally {
      await admin.query(
        `update facturation.licences l set statut = 'active', suspendue_le = null
           from facturation.licence_organisations lo
          where lo.licence_id = l.id and lo.tenant_id = $1`,
        [pme],
      );
    }
  });

  /* ============ revue Codex de #127 : la chaîne des versions, partout (29 octobre 2026) */

  /** Le TTC tranché par l'analyse de la dernière lecture d'une pièce. */
  const ttcTranche = async (pieceId: string, ttcMineur: number) => {
    await admin.query(
      `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                     normalisation, controles, verdict, motifs)
       select $1, $2, x.id, $3, jsonb_build_object('montants', jsonb_build_object('ttc', $4::text)),
              '["essai"]', 'à comptabiliser', '["essai"]'
         from capture.extractions x where x.piece_id = $2
        order by x.created_at desc limit 1`,
      [pme, pieceId, pack, ttcMineur],
    );
  };
  const payer = (pieceId: string, montantMineur: number | null, extra = {}) =>
    pmeFait("capture.enregistrerPaiement", {
      pieceId,
      packId: pack,
      moyenCode: "especes",
      montantMineur,
      devise: "TND",
      payeLe: "2026-10-03",
      ...extra,
    }) as Promise<string>;

  it("un règlement sur la nouvelle photo compte ceux saisis sur l'ancienne", async () => {
    const ancienne = await retournee("avant écriture");
    await ttcTranche(ancienne, 100000);
    await payer(ancienne, 60000);
    const nouvelle = await remplacer(ancienne);
    await lire(nouvelle);
    await ttcTranche(nouvelle, 100000);
    // Un montant explicite ne dépasse pas le total cumulé des versions.
    await assert.rejects(payer(nouvelle, 50000), /paiement\.depasse_le_total/);
    // « Tout payé » règle le reste : 40, pas 100.
    const solde = await payer(nouvelle, null);
    const { rows } = await admin.query<{ m: string }>(
      `select montant_mineur::text as m from capture.paiements where id = $1`,
      [solde],
    );
    assert.equal(rows[0]?.m, "40000");
  });

  it("un reçu produit depuis la nouvelle photo atteste les règlements de l'ancienne", async () => {
    const ancienne = await retournee("avant écriture");
    const paiement = await payer(ancienne, 30000);
    const nouvelle = await remplacer(ancienne);
    const { id: recu } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-recu-chaine-${nouvelle}`,
      contentType: "application/pdf",
      documentKind: "recu_de_paiement",
      sourcePieceId: nouvelle,
      paiementsAttestes: [paiement],
    })) as { id: string };
    const { rows } = await admin.query(
      `select 1 from capture.recu_paiements where piece_id = $1 and paiement_id = $2`,
      [recu, paiement],
    );
    assert.equal(rows.length, 1, "le reçu sait ce qu'il atteste");
  });

  it("garder la nouvelle photo emporte l'ancienne et ses reçus hors du cabinet", async () => {
    const ancienne = await retournee("avant écriture");
    const { id: recu } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-recu-garde-${ancienne}`,
      contentType: "application/pdf",
      documentKind: "recu_de_paiement",
      sourcePieceId: ancienne,
    })) as { id: string };
    const nouvelle = await remplacer(ancienne);
    await pmeFait("collab.garderPiece", nouvelle);
    assert.equal((await etat(recu))?.vis, "entite", "le reçu suit sa facture");
    assert.equal((await etat(ancienne))?.vis, "entite", "la version précédente aussi");
    await assert.rejects(cabinetFait("capture.dossier", recu), /piece\.not_found/);
    await assert.rejects(cabinetFait("capture.dossier", ancienne), /piece\.not_found/);
  });

  it("le justificatif d'un règlement de l'ancienne photo mène à la nouvelle", async () => {
    const ancienne = await retournee("avant écriture");
    const { id: talon } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "partage",
      idempotencyKey: `${marque}-talon-${ancienne}`,
      contentType: "image/jpeg",
      documentKind: "justificatif_paiement",
      sourcePieceId: ancienne,
    })) as { id: string };
    await payer(ancienne, 20000, { justificatifPieceId: talon });
    const nouvelle = await remplacer(ancienne);
    const fiche = (await pmeFait("capture.pieceQuiAccompagne", talon, "fr")) as {
      mere: { id: string } | null;
    };
    assert.equal(fiche.mere?.id, nouvelle);
  });

  it("un « pas encore payé » de l'ancienne photo s'éteint quand la nouvelle est réglée", async () => {
    const ancienne = await retournee("avant écriture");
    const nonPaye = await payer(ancienne, null, { moyenCode: "non_paye" });
    const nouvelle = await remplacer(ancienne);
    await payer(nouvelle, 30000);
    const { rows } = await admin.query(
      `select 1 from capture.paiements where annule_paiement_id = $1`,
      [nonPaye],
    );
    assert.equal(rows.length, 1, "le « pas encore payé » ne survit pas au règlement");
  });

  it("un justificatif se déplace vers un règlement de l'ancienne photo, côté et mère de la courante", async () => {
    // L'ancienne n'est jamais partie ; la nouvelle, si : leurs côtés diffèrent.
    n += 1;
    const ancienne = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by)
         values ($1, 'photo', 'entite', $2, $3, $4) returning id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    const paiement = await payer(ancienne, 20000);
    const nouvelle = await remplacer(ancienne, "entite");
    await pmeFait("collab.setPieceVis", nouvelle, "partage");
    const { id: talon } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "partage",
      idempotencyKey: `${marque}-talon-dep-${nouvelle}`,
      contentType: "image/jpeg",
      documentKind: "justificatif_paiement",
      sourcePieceId: nouvelle,
    })) as { id: string };
    await pmeFait("capture.deplacerJustificatif", talon, paiement);
    const { rows } = await admin.query<{ source_piece_id: string }>(
      `select source_piece_id from capture.pieces where id = $1`,
      [talon],
    );
    assert.equal(rows[0]?.source_piece_id, nouvelle);
  });

  it("ce qui est issu d'une version archivée la suit aux archives", async () => {
    const ancienne = await retournee("avant écriture");
    const { id: recu } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-recu-arch-${ancienne}`,
      contentType: "application/pdf",
      documentKind: "recu_de_paiement",
      sourcePieceId: ancienne,
    })) as { id: string };
    const nouvelle = await remplacer(ancienne);
    assert.equal(await pmeFait("capture.supprimer", nouvelle), true);
    assert.ok((await etat(ancienne))?.archivee_le, "la version que le cabinet a connue s'archive");
    assert.ok((await etat(recu))?.archivee_le, "son reçu la suit");
  });
});
