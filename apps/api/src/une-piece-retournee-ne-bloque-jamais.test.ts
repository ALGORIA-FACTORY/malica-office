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
import { fabrique } from "./depots/fabrique.ts";
import { identite } from "./depots/identite.ts";
import { lireLaPieceDEssai } from "./lecture-d-essai.ts";
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
    sousIdentiteDuServeur(dirigeant.id, (db) => lireLaPieceDEssai(db, pieceId));

  /** Transmet la pièce au cabinet, lue d'abord : une pièce non lue ne part pas (3 novembre 2026). */
  const lireEtPartager = async (pieceId: string) => {
    await lire(pieceId);
    await pmeFait("collab.setPieceVis", pieceId, "partage");
  };

  let n = 0;
  /** Une pièce transmise, lue, au type lu mais pas confirmé : le cas réel. */
  const transmiseLue = async () => {
    n += 1;
    const id = await sousIdentiteDuServeur(dirigeant.id, async () => {
      const { rows } = await admin.query<{ id: string }>(
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
          { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0", tax_code: "EXO" },
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
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [pieceId]),
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
          // Même pour qui la lit aussi comme cabinet engagé : la liste de la
          // société ne la rend pas (le dirigeant qui est son propre comptable).
          const vueDuCabinet = (await cabinetFait("capture.listAvecLecture", pme)) as Array<{
            id: string;
          }>;
          assert.ok(!vueDuCabinet.some((p) => p.id === id), "archivée : hors de la liste");
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
        await assert.rejects(
          pmeFait("collab.setPieceVis", autre, "personnel"),
          /refus\.piece\.transmise_au_cabinet$/,
        );
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

  it("une suppression se demande sur une pièce prise en charge : le cabinet accorde, contre-passe, archive", async () => {
    /*
     * Spec « Malica sans blocage » §3 (lot 4) : « Supprimer une pièce prise en
     * charge — le comptable accorde : contre-passation, et la pièce est
     * archivée, jamais effacée. » La demande était refusée d'emblée, et la
     * matrice des droits du 28 octobre le relevait (« Pièce prise en charge :
     * refusé »). Seul un RÈGLEMENT inscrit la retient encore.
     */
    const id = await transmiseLue();
    await priseEnCharge(id);
    await pmeFait("collab.demanderSurPiece", id, "suppression");
    await cabinetFait("collab.repondreSurPiece", id, "suppression", true, null);
    assert.ok((await etat(id))?.archivee_le, "archivée, jamais effacée");
    assert.equal(await ecrituresVivantes(id), 0, "son écriture est contre-passée");
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
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'personnel') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
  };

  it("une photo privée remplacée puis retirée part avec ses versions : le cabinet ne la lit jamais", async () => {
    const a = await privee();
    const b = await remplacer(a, "personnel");
    assert.equal(await pmeFait("capture.supprimer", b), true);
    // Sans écriture sur la chaîne, la pièce part tout entière, comme une
    // pièce jamais reprise (revue indépendante de #127).
    assert.equal(await etat(a), null, "la version précédente part avec la courante");
    assert.ok(!(await listeDeLaPme()).includes(a));
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
        db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [id]),
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
    // La version précédente garde son fait ; elle se lit à travers la courante,
    // désormais dans la société : le cabinet ne la lit plus (ci-dessous).
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
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
    const paiement = await payer(ancienne, 20000);
    const nouvelle = await remplacer(ancienne, "entite");
    await lireEtPartager(nouvelle);
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
    // Une écriture inscrite puis contre-passée sur la chaîne : la pièce
    // s'archive au lieu de partir (revue indépendante de #127).
    const ancienne = await retournee("après contre-passation");
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

  /* === « une version précédente se lit à travers sa version courante » (revue Codex de #127) */

  it("une photo de la société remplacée puis partagée : le cabinet voit ses règlements hérités", async () => {
    n += 1;
    const ancienne = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
    const paiement = await payer(ancienne, 25000);
    const nouvelle = await remplacer(ancienne, "entite");
    await lireEtPartager(nouvelle);
    const vus = (await cabinetFait("capture.paiementsDUnePiece", nouvelle)) as Array<{
      id: string;
    }>;
    assert.deepEqual(
      vus.map((p) => p.id),
      [paiement],
    );
  });

  it("le dossier lié de la photo courante garde les justificatifs de l'ancienne", async () => {
    const ancienne = await retournee("avant écriture");
    const { id: talon } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "partage",
      idempotencyKey: `${marque}-talon-lie-${ancienne}`,
      contentType: "image/jpeg",
      documentKind: "justificatif_paiement",
      sourcePieceId: ancienne,
    })) as { id: string };
    const paiement = await payer(ancienne, 15000, { justificatifPieceId: talon });
    const nouvelle = await remplacer(ancienne);
    const lie = (await cabinetFait("supervision.documentsLies", cabinet, pme, [nouvelle])) as {
      documents: Array<{ id: string }>;
      paiements: Array<{ id: string; pieceId: string }>;
    };
    const docs = lie.documents.map((d) => d.id);
    assert.ok(docs.includes(nouvelle) && docs.includes(talon), "le justificatif reste lié");
    assert.ok(!docs.includes(ancienne), "la version précédente ne s'ajoute pas au dossier");
    assert.deepEqual(
      lie.paiements.map((p) => [p.id, p.pieceId]),
      [[paiement, nouvelle]],
    );
  });

  it("une version privée jamais partagée reste invisible au cabinet tant que sa courante l'est", async () => {
    const a = await privee();
    const b = await remplacer(a, "personnel");
    await assert.rejects(cabinetFait("capture.dossier", a), /piece\.not_found/);
    await assert.rejects(cabinetFait("capture.dossier", b), /piece\.not_found/);
  });

  /* ============ un règlement hérité s'inscrit : la pièce se juge à sa courante (revue Codex de #127) */

  it("un règlement saisi sur l'ancienne photo s'inscrit quand le type de la nouvelle est confirmé", async () => {
    const ancienne = await transmiseLue();
    const paiement = await payer(ancienne, 30000);
    const nouvelle = await remplacer(ancienne);
    await lire(nouvelle);
    await ttcTranche(nouvelle, 30000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    const ecriture = (await cabinetFait("office.inscrireLeReglement", paiement)) as string;
    const { rows } = await admin.query<{ piece_id: string; status: string }>(
      `select piece_id, status from socle.ecritures where id = $1`,
      [ecriture],
    );
    assert.equal(rows[0]?.status, "booked", "le contrôle R2 juge la version courante");
    assert.equal(rows[0]?.piece_id, ancienne, "l'écriture reste sur la pièce du règlement");
    // Le second regard porte sur la pièce, donc sur sa version courante.
    await sousIdentiteDuServeur(expert.id, (db) =>
      supervision.review(db, { ecritureId: ecriture, outcome: "valide" }),
    );
    const { rows: verdicts } = await admin.query(
      `select 1 from capture.conformite where piece_id = $1`,
      [nouvelle],
    );
    assert.equal(verdicts.length, 1, "le verdict est inscrit sur la version courante");
  });

  it("deux inscriptions simultanées d'un règlement hérité n'en font qu'une", async () => {
    // L'ancienne est restée dans la société : le cabinet ne peut pas la
    // verrouiller. Seul le verrou de la version courante sérialise.
    n += 1;
    const ancienne = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
    const paiement = await payer(ancienne, 20000);
    const nouvelle = await remplacer(ancienne, "entite");
    await lireEtPartager(nouvelle);
    await ttcTranche(nouvelle, 20000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    // Deux connexions, deux transactions, au même instant.
    const issues = await Promise.allSettled([
      cabinetFait("office.proposerLeReglement", paiement),
      cabinetFait("office.proposerLeReglement", paiement),
    ]);
    const rendues = issues.flatMap((i) => (i.status === "fulfilled" ? [i.value] : []));
    assert.ok(rendues.length >= 1, "au moins une inscription aboutit");
    assert.equal(new Set(rendues).size, 1, "la seconde rend la même écriture");
    const { rows } = await admin.query(
      `select id from socle.ecritures
        where paiement_id = $1 and nature = 'reglement' and reverses_id is null`,
      [paiement],
    );
    assert.equal(rows.length, 1, "une seule écriture pour le règlement");
  });

  /* ============ une écriture vivante se cherche sur toute la chaîne (revue Codex de #127) */

  /**
   * Un règlement saisi sur l'ancienne photo, inscrit après la reprise : l'écriture vit sur A.
   * `facture` : la facture elle-même est prise en charge d'abord (forcée par le
   * cabinet) — le cas que la revue de #134 a trouvé ouvert : le retour passait
   * par la contre-passation de la facture et ne voyait plus le règlement.
   */
  const reglementHeriteInscrit = async ({ facture = false }: { facture?: boolean } = {}) => {
    const ancienne = await transmiseLue();
    const paiement = await payer(ancienne, 10000);
    const nouvelle = await remplacer(ancienne);
    await lire(nouvelle);
    await ttcTranche(nouvelle, 10000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    if (facture)
      await cabinetFait("office.forcer", {
        pieceId: nouvelle,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture prise en charge",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "10", credit: "0", tax_code: "EXO" },
          { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "10", tax_code: null },
        ],
      });
    const ecriture = (await cabinetFait("office.inscrireLeReglement", paiement)) as string;
    return { ancienne, nouvelle, ecriture };
  };

  it("une facture prise en charge dont le règlement est inscrit ne se retourne pas", async () => {
    const { nouvelle, ecriture } = await reglementHeriteInscrit({ facture: true });
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) =>
        supervision.retourner(db, { pieceId: nouvelle, motifId: motifs["montant_incoherent"]! }),
      ),
      /refus\.retour\.inscrite/,
    );
    const { rows } = await admin.query<{ vivante: boolean }>(
      `select app.ecriture_vivante($1) as vivante`,
      [ecriture],
    );
    assert.equal(rows[0]?.vivante, true, "le règlement reste inscrit");
    assert.notEqual((await etat(nouvelle))?.status, "retournee");
  });

  it("une photo reprise dont le règlement hérité est inscrit ne se retourne, ne se remplace ni ne se supprime", async () => {
    const { nouvelle, ecriture } = await reglementHeriteInscrit();
    // La fiche de la courante montre l'écriture de la pièce, toutes versions.
    const vues = (await cabinetFait("office.ecrituresForPiece", nouvelle)) as Array<{ id: string }>;
    assert.ok(
      vues.some((e) => e.id === ecriture),
      "l'écriture héritée est sur la fiche",
    );
    await assert.rejects(
      sousIdentiteDuServeur(expert.id, (db) =>
        supervision.retourner(db, { pieceId: nouvelle, motifId: motifs["montant_incoherent"]! }),
      ),
      /refus\.retour\.inscrite/,
    );
    await assert.rejects(remplacer(nouvelle), /refus\.remplacement\.inscrite/);
    // Retournée par quelque chemin que ce soit, elle reste engagée : ni
    // supprimée, ni partie dans un espace privé.
    await admin.query(`update capture.pieces set status = 'retournee' where id = $1`, [nouvelle]);
    await assert.rejects(pmeFait("capture.supprimer", nouvelle), /refus\.suppression\.engagee$/);
    await assert.rejects(
      pmeFait("collab.setPieceVis", nouvelle, "personnel"),
      /refus\.piece\.comptabilisee_dans_la_societe$/,
    );
    assert.ok(await etat(nouvelle), "la photo courante existe toujours");
  });

  it("ni rappel ni suppression ne se demandent sur une photo dont le règlement hérité est inscrit", async () => {
    const { nouvelle } = await reglementHeriteInscrit();
    await assert.rejects(
      pmeFait("collab.demanderSurPiece", nouvelle, "rappel"),
      /refus\.rappel\.inscrite/,
    );
    await assert.rejects(
      pmeFait("collab.demanderSurPiece", nouvelle, "suppression"),
      /refus\.suppression\.inscrite/,
    );
  });

  it("sous un rappel en attente, un règlement hérité ne s'inscrit pas ; le rappel refusé, il s'inscrit", async () => {
    const ancienne = await transmiseLue();
    const paiement = await payer(ancienne, 10000);
    const nouvelle = await remplacer(ancienne);
    await lire(nouvelle);
    await ttcTranche(nouvelle, 10000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    await pmeFait("collab.demanderSurPiece", nouvelle, "rappel");
    await assert.rejects(
      cabinetFait("office.inscrireLeReglement", paiement),
      /refus\.piece\.rappelEnAttente/,
    );
    await cabinetFait("collab.repondreSurPiece", nouvelle, "rappel", false, "Elle reste ici.");
    const ecriture = (await cabinetFait("office.inscrireLeReglement", paiement)) as string;
    const { rows } = await admin.query<{ status: string }>(
      `select status from socle.ecritures where id = $1`,
      [ecriture],
    );
    assert.equal(rows[0]?.status, "booked");
  });

  it("un rappel ne s'accorde pas tant qu'une écriture vit sur une version de la pièce", async () => {
    const { nouvelle } = await reglementHeriteInscrit();
    // Une demande d'avant cette règle, restée en attente.
    await admin.query(
      `insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur)
       values ($1, $2, 'rappel', 'demandee', $3)`,
      [pme, nouvelle, dirigeant.id],
    );
    await assert.rejects(
      cabinetFait("collab.repondreSurPiece", nouvelle, "rappel", true, null),
      /refus\.piece\.comptabilisee_partagee$/,
    );
    assert.equal((await etat(nouvelle))?.vis, "partage");
  });

  it("partager la photo courante transmet l'écriture proposée sur l'ancienne", async () => {
    n += 1;
    const ancienne = await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
    const paiement = await payer(ancienne, 10000);
    const nouvelle = await remplacer(ancienne, "entite");
    await lire(nouvelle);
    await ttcTranche(nouvelle, 10000);
    await admin.query(`update capture.pieces set document_kind_statut = 'confirme' where id = $1`, [
      nouvelle,
    ]);
    const ecriture = (await pmeFait("office.proposerLeReglement", paiement)) as string;
    const cote = async () =>
      (
        await admin.query<{ vis: string }>(
          `select vis::text as vis from socle.ecritures where id = $1`,
          [ecriture],
        )
      ).rows[0]?.vis;
    assert.equal(await cote(), "entite");
    await pmeFait("collab.setPieceVis", nouvelle, "partage");
    assert.equal(await cote(), "partage", "l'écriture suit la pièce chez le cabinet");
  });

  /** Une photo de la société, jamais partie au cabinet. */
  const societe = async () => {
    n += 1;
    return sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
  };

  it("un règlement hérité s'inscrit et s'exporte comme la version courante, partagée depuis", async () => {
    const ancienne = await societe();
    const paiement = await payer(ancienne, 30000);
    const nouvelle = await remplacer(ancienne, "entite");
    const numero = `FB-${marque}`;
    // Lue avant d'être transmise : une pièce non lue ne part pas (3 novembre
    // 2026). La lecture porte ici le numéro, que l'export et le rapprochement lisent.
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      lireLaPieceDEssai(db, nouvelle, { document_kind: "facture_achat", references: { numero } }),
    );
    await pmeFait("collab.setPieceVis", nouvelle, "partage");
    await ttcTranche(nouvelle, 30000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    const ecriture = (await cabinetFait("office.inscrireLeReglement", paiement)) as string;
    const { rows } = await admin.query<{ vis: string }>(
      `select vis::text as vis from socle.ecritures where id = $1`,
      [ecriture],
    );
    assert.equal(rows[0]?.vis, "partage", "le côté de l'écriture est celui de la courante");
    const lignes = await sousIdentiteDuServeur(expert.id, async (db) => {
      const { rows: l } = await db.query<{ piece_ref: string }>(
        `select piece_ref from public.export_lignes_lire($1, $2, '2026-01-01', '2026-12-31')
          where ecriture_id = $3`,
        [cabinet, pme, ecriture],
      );
      return l;
    });
    assert.ok(lignes.length > 0, "le règlement entre dans l'export du cabinet");
    assert.ok(
      lignes.every((l) => l.piece_ref === numero),
      "la référence est lue sur la version courante",
    );
    // Le rapprochement bancaire lit la même référence.
    const banque = await sousIdentiteDuServeur(expert.id, async (db) => {
      const { rows: b } = await db.query<{ reference: string | null }>(
        `select reference from public.banque_book_lignes($1, '5', '2026-01-01', '2026-12-31')
          where ecriture_id = $2`,
        [pme, ecriture],
      );
      return b;
    });
    assert.ok(banque.length > 0, "le règlement est au rapprochement");
    assert.ok(
      banque.every((b) => b.reference === numero),
      "le rapprochement lit la référence de la version courante",
    );
  });

  it("un règlement ou un reçu saisi sur l'ancienne photo prend le côté de la courante", async () => {
    const ancienne = await societe();
    const nouvelle = await remplacer(ancienne, "entite");
    await lireEtPartager(nouvelle);
    const paiement = await payer(ancienne, 1000);
    const { rows } = await admin.query<{ vis: string }>(
      `select vis::text as vis from capture.paiements where id = $1`,
      [paiement],
    );
    assert.equal(rows[0]?.vis, "partage");

    const gardee = await retournee("avant écriture");
    const courante = await remplacer(gardee);
    await pmeFait("collab.garderPiece", courante);
    const { id: recu } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-recu-ancienne-${gardee}`,
      contentType: "application/pdf",
      documentKind: "recu_de_paiement",
      sourcePieceId: gardee,
    })) as { id: string };
    assert.equal((await etat(recu))?.vis, "entite", "le reçu ne part pas au cabinet");
  });

  /* ============ un rattachement se lit par paire LOGIQUE (revue Codex de #127) */

  const lies = async (pieceId: string) =>
    ((await pmeFait("capture.piecesRattachees", pieceId)) as Array<{ id: string }>).map(
      (p) => p.id,
    );
  const dossierLie = async (pieceId: string) =>
    (
      (await cabinetFait("supervision.documentsLies", cabinet, pme, [pieceId])) as {
        documents: Array<{ id: string }>;
      }
    ).documents.map((d) => d.id);

  it("détacher sur la photo courante détache pour de bon : le lien de l'ancienne ne revient pas", async () => {
    const ancienne = await retournee("avant écriture");
    const bl = await transmiseLue();
    await pmeFait("capture.rattacher", ancienne, bl);
    const nouvelle = await remplacer(ancienne);
    assert.deepEqual(await lies(nouvelle), [bl], "hérité, lu à travers la courante");
    await pmeFait("capture.detacher", nouvelle, bl, "pas le bon bon de livraison");
    assert.deepEqual(await lies(nouvelle), []);
    assert.ok(!(await dossierLie(nouvelle)).includes(bl), "le dossier lié ne le ressuscite pas");
    // Rattacher de nouveau : le dernier fait de la paire gagne.
    await pmeFait("capture.rattacher", nouvelle, bl);
    assert.deepEqual(await lies(nouvelle), [bl]);
    assert.ok((await dossierLie(nouvelle)).includes(bl));
  });

  it("un rattachement hérité ne se refait pas, et ne se détache pas sur l'ancienne", async () => {
    const ancienne = await retournee("avant écriture");
    const bl = await transmiseLue();
    await pmeFait("capture.rattacher", ancienne, bl);
    const nouvelle = await remplacer(ancienne);
    assert.deepEqual(await pmeFait("capture.rattacher", nouvelle, bl), { deja: true });
    await assert.rejects(
      pmeFait("capture.detacher", ancienne, bl, "essai"),
      /refus\.piece\.remplacee/,
    );
    // Aucun fait recopié : l'historique de la paire tient en un seul fait.
    const { rows } = await admin.query(
      `select 1 from capture.rattachements where $1 in (piece_id, piece_liee_id)`,
      [bl],
    );
    assert.equal(rows.length, 1);
  });

  it("la preuve « rattachement » d'un retour reste juste : un lien d'avant le retour ne prouve rien", async () => {
    const id = await transmiseLue();
    const bl = await transmiseLue();
    await pmeFait("capture.rattacher", id, bl);
    await sousIdentiteDuServeur(expert.id, (db) =>
      supervision.retourner(db, {
        pieceId: id,
        motifId: motifs["justificatif_manquant"]!,
        note: "Le bon de livraison, s'il vous plaît.",
      }),
    );
    const fait = async (p: string) =>
      ((await pmeFait("capture.retourDeLaPiece", p, "fr")) as { fait: boolean }).fait;
    assert.equal(await fait(id), false);
    const autre = await transmiseLue();
    await pmeFait("capture.rattacher", id, autre);
    assert.equal(await fait(id), true);
  });

  /* ============ revue indépendante de #127 (29 octobre 2026) */

  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /**
   * Inscrit l'écriture dans une transaction qui reste ouverte : `pris` se
   * résout quand l'inscription est faite (ses verrous tenus), `fin` au commit.
   */
  const inscrireSansCommettre = (ecriture: string) => {
    let tenu: () => void = () => undefined;
    const pris = new Promise<void>((r) => (tenu = r));
    const fin = sousIdentiteDuServeur(expert.id, async (db) => {
      await office.book(db, ecriture);
      tenu();
      await dormir(400);
    });
    return { pris: Promise.race([pris, fin]), fin };
  };

  it("une version remplacée ne se lit plus : refus définitif, travail clos, octets refusés", async () => {
    const ancienne = await sousIdentiteDuServeur(dirigeant.id, async () => {
      n += 1;
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, now()) returning id`,
        [pme, `essai/${marque}-${n}.pdf`, `${marque}-${n}`, dirigeant.id],
      );
      return rows[0]!.id;
    });
    const { travailId } = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      fabrique.enregistrerLecture(db, ancienne),
    );
    await remplacer(ancienne);
    const verdict = (
      await sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query<{ v: { autorisee: boolean; motif: string } }>(
          `select public.lecture_autorisee($1) as v`,
          [ancienne],
        ),
      )
    ).rows[0]!.v;
    assert.deepEqual([verdict.autorisee, verdict.motif], [false, "piece_remplacee"]);
    const { rows } = await admin.query<{ etat: string; prenable: boolean | null }>(
      `select etat, prenable from fabrique.etat_des_travaux_v where travail_id = $1`,
      [travailId],
    );
    assert.equal(rows[0]?.etat, "refuse", "le travail de l'ancienne ne se reprend plus");
    assert.notEqual(rows[0]?.prenable, true);
    await assert.rejects(
      sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query(`select public.capture_sceller_empreinte($1, $2)`, [ancienne, "a".repeat(64)]),
      ),
      /refus\.piece\.remplacee/,
    );
  });

  it("une photo gardée puis supprimée sans écriture emporte ses versions : le cabinet ne relit rien", async () => {
    const ancienne = await retournee("avant écriture");
    const nouvelle = await remplacer(ancienne);
    await pmeFait("collab.garderPiece", nouvelle);
    assert.equal(await pmeFait("capture.supprimer", nouvelle), true);
    assert.equal(await etat(ancienne), null, "aucune archive : rien n'a été inscrit");
    await assert.rejects(cabinetFait("capture.dossier", ancienne), /piece\.not_found/);
  });

  it("inscrire un règlement hérité et remplacer la courante ne se croisent pas", async () => {
    const ancienne = await transmiseLue();
    const paiement = await payer(ancienne, 10000);
    const nouvelle = await remplacer(ancienne);
    await lire(nouvelle);
    await ttcTranche(nouvelle, 10000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    const ecriture = (await cabinetFait("office.proposerLeReglement", paiement)) as string;
    // L'inscription tient sa transaction ouverte ; la reprise arrive pendant.
    const inscription = inscrireSansCommettre(ecriture);
    await inscription.pris;
    const reprise = remplacer(nouvelle);
    const [ins, rep] = await Promise.allSettled([inscription.fin, reprise]);
    assert.equal(ins.status, "fulfilled", String((ins as PromiseRejectedResult).reason));
    assert.equal(rep.status, "rejected", "la reprise attend l'inscription, puis la voit");
    assert.match(String((rep as PromiseRejectedResult).reason), /refus\.remplacement\.inscrite/);
  });

  it("inscrire un règlement hérité et supprimer la courante ne se croisent pas", async () => {
    const ancienne = await transmiseLue();
    const paiement = await payer(ancienne, 10000);
    const nouvelle = await remplacer(ancienne);
    await lire(nouvelle);
    await ttcTranche(nouvelle, 10000);
    await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [nouvelle]),
    );
    const ecriture = (await cabinetFait("office.proposerLeReglement", paiement)) as string;
    // La suppression passe par l'accord du cabinet, qui l'exécute aussitôt.
    await pmeFait("collab.demanderSurPiece", nouvelle, "suppression");
    const inscription = inscrireSansCommettre(ecriture);
    await inscription.pris;
    const suppression = cabinetFait("collab.repondreSurPiece", nouvelle, "suppression", true, null);
    const [ins, sup] = await Promise.allSettled([inscription.fin, suppression]);
    assert.equal(ins.status, "fulfilled", String((ins as PromiseRejectedResult).reason));
    assert.equal(sup.status, "rejected", "la suppression attend l'inscription, puis la voit");
    assert.ok(await etat(nouvelle), "la pièce que l'écriture porte est toujours là");
  });

  it("le retour d'une version précédente ne se lit plus : seule la courante le porte", async () => {
    const ancienne = await retournee("avant écriture");
    const nouvelle = await remplacer(ancienne);
    assert.equal(await pmeFait("capture.retourDeLaPiece", ancienne, "fr"), null);
    assert.ok(await pmeFait("capture.retourDeLaPiece", nouvelle, "fr"));
  });

  it("une reprise hors ligne refusée le dit par un code de reprise", async () => {
    const ancienne = await retournee("avant écriture");
    await remplacer(ancienne);
    // L'ancienne est déjà remplacée : une seconde photo arrive pour elle.
    await assert.rejects(
      pmeFait("capture.enregistrer", {
        tenantId: pme,
        source: "photo",
        vis: "partage",
        idempotencyKey: `${marque}-r2-${ancienne}`,
        contentType: "image/jpeg",
        remplace: ancienne,
      }),
      /refus\.piece\.remplacee/,
    );
    // Retirée entre-temps : la pièce n'est plus là.
    const retiree = await privee();
    assert.equal(await pmeFait("capture.supprimer", retiree), true);
    await assert.rejects(remplacer(retiree, "personnel"), /refus\.remplacement\.introuvable/);
  });

  it("un fait nouveau sur une version gelée va à la courante", async () => {
    const ancienne = await retournee("avant écriture");
    const nouvelle = await remplacer(ancienne);
    const paiement = await payer(ancienne, 1000);
    const { rows } = await admin.query<{ piece_id: string }>(
      `select piece_id from capture.paiements where id = $1`,
      [paiement],
    );
    assert.equal(rows[0]?.piece_id, nouvelle, "le règlement va à la version courante");
    const { id: recu } = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-recu-gele-${ancienne}`,
      contentType: "application/pdf",
      documentKind: "recu_de_paiement",
      sourcePieceId: ancienne,
    })) as { id: string };
    const { rows: source } = await admin.query<{ source_piece_id: string }>(
      `select source_piece_id from capture.pieces where id = $1`,
      [recu],
    );
    assert.equal(source[0]?.source_piece_id, nouvelle, "le reçu est issu de la courante");
  });

  it("rien ne s'écrit plus sur une version gelée : analyse, articles, biens, stocks, fiche fiscale", async () => {
    const ancienne = await transmiseLue();
    await remplacer(ancienne);
    await assert.rejects(ttcTranche(ancienne, 1000), /refus\.piece\.remplacee/);
    await assert.rejects(
      sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query(`select public.capture_articles_persist($1, $2, null, '601', $3::jsonb)`, [
          ancienne,
          pack,
          JSON.stringify([{ designation: "Ramettes de papier", total_ht: "10.000" }]),
        ]),
      ),
      /refus\.piece\.remplacee/,
    );
    const { rows } = await admin.query<{ t: string }>(
      `select tgrelid::regclass::text as t from pg_trigger
        where tgname = 'pas_de_geste_sur_une_version_precedente' order by 1`,
    );
    for (const table of [
      "capture.analyses",
      "capture.piece_articles",
      "identity.fiches_fiscales",
      "immo.assets",
      "stocks.mouvements",
    ]) {
      assert.ok(
        rows.some((r) => r.t === table),
        `${table} refuse un fait nouveau sur une version gelée`,
      );
    }
  });

  it("la file du cabinet montre l'écriture inscrite sur une version précédente", async () => {
    const { nouvelle, ecriture } = await reglementHeriteInscrit();
    const file = (await cabinetFait("supervision.queue", cabinet, pme)) as Array<{
      pieceId: string;
      ecritureId: string | null;
    }>;
    assert.equal(file.find((q) => q.pieceId === nouvelle)?.ecritureId, ecriture);
  });

  it("une photo reprise aux mêmes octets n'est pas le doublon de sa version précédente", async () => {
    const ancienne = await privee();
    const empreinte = "b".repeat(63) + String(n % 10);
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query(`select public.capture_sceller_empreinte($1, $2)`, [ancienne, empreinte]),
    );
    const nouvelle = await remplacer(ancienne, "personnel");
    const r = (
      await sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query<{ r: { doublonDe: string | null } }>(
          `select public.capture_sceller_empreinte($1, $2) as r`,
          [nouvelle, empreinte],
        ),
      )
    ).rows[0]!.r;
    assert.equal(r.doublonDe, null);
    const { rows } = await admin.query<{ doublon_de: string | null }>(
      `select doublon_de from capture.pieces where id = $1`,
      [nouvelle],
    );
    assert.equal(rows[0]?.doublon_de, null);
  });

  it("le cabinet ne lit pas le remplacement d'une photo qu'il ne voit plus", async () => {
    const ancienne = await retournee("avant écriture");
    const nouvelle = await remplacer(ancienne);
    await pmeFait("collab.garderPiece", nouvelle);
    const vus = await sousIdentiteDuServeur(expert.id, (db) =>
      db.query(`select 1 from capture.remplacements where piece_id = $1`, [ancienne]),
    );
    assert.equal(vus.rows.length, 0);
  });

  it("une chaîne A → B → C mène de A à C en un geste", async () => {
    const a = await retournee("avant écriture");
    const b = await remplacer(a);
    const c = await remplacer(b);
    const dossier = (await pmeFait("capture.dossier", a)) as {
      piece: { versionCourante: string; remplaceePar: string | null };
    };
    assert.equal(dossier.piece.remplaceePar, b);
    assert.equal(dossier.piece.versionCourante, c);
  });

  it("joindre un document ne se prouve pas par une nouvelle photo", async () => {
    const id = await transmiseLue();
    await sousIdentiteDuServeur(expert.id, (db) =>
      supervision.retourner(db, {
        pieceId: id,
        motifId: motifs["justificatif_manquant"]!,
        note: "Le bon de livraison, s'il vous plaît.",
      }),
    );
    const nouvelle = await remplacer(id);
    const retour = (await pmeFait("capture.retourDeLaPiece", nouvelle, "fr")) as { fait: boolean };
    assert.equal(retour.fait, false, "le geste demandé est de joindre, pas de reprendre");
  });

  it("une photo reprise par le dirigeant reste celle de son auteur", async () => {
    const siege = await creerCompte(`siege-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(siege);
    // Une offre qui ouvre les sièges, par la vraie porte.
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query("select public.forfait_changer('team', $1, current_date)", [pme]),
    );
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [pme, siege.id],
    );
    n += 1;
    const ancienne = await sousIdentiteDuServeur(siege.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.capture_piece_register($1, 'photo', $2, $3, null, 'entite') as id`,
        [pme, `essai/${marque}-${n}.jpg`, `${marque}-${n}`],
      );
      return rows[0]!.id;
    });
    const nouvelle = await remplacer(ancienne, "entite");
    const { rows } = await admin.query<{ created_by: string; auteur: string }>(
      `select p.created_by, r.auteur from capture.pieces p
         join capture.remplacements r on r.remplacee_par = p.id where p.id = $1`,
      [nouvelle],
    );
    assert.equal(rows[0]?.created_by, siege.id, "la pièce reste celle du siège");
    assert.equal(rows[0]?.auteur, dirigeant.id, "qui l'a reprise est au registre");
  });
});
