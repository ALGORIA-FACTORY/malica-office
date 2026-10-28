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

      it("la PME garde une pièce retournée dans son espace, et le cabinet le sait", async () => {
        const id = await retournee(cas);
        assert.equal(await pmeFait("collab.setPieceVis", id, "personnel"), true);
        const apres = await etat(id);
        assert.equal(apres?.vis, "personnel");
        assert.equal(apres?.status, "lue", "le retour est clos : elle redevient une pièce lue");
        assert.ok(await notifie(id, "piece.gardee"));

        const autre = await retournee(cas);
        assert.deepEqual(await pmeFait("collab.garderPiece", autre), { changed: true });
        assert.equal((await etat(autre))?.vis, "personnel");
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
});
