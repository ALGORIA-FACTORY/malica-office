/**
 * La matrice des droits, ligne par ligne (« Malica sans blocage », planche
 * « Matrice des droits » validée le 28 octobre 2026, colonnes SIÈGE ·
 * PROPRIÉTAIRE · COMPTABLE).
 *
 * Une épreuve par ligne, sous l'identité de chacun, par l'API : la base
 * décide, l'écran ne fait que montrer. La colonne « Aujourd'hui » de la
 * planche nommait les écarts relevés le 28 octobre — le siège voyait tout,
 * envoyait au comptable, pouvait « Garder », supprimait la pièce d'un autre
 * siège, ne pouvait pas rendre une pièce de la société à Mon espace —, et
 * chacun échoue ici avant ce lot.
 *
 *   node --experimental-strip-types --test src/la-matrice-des-droits.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PieceLue } from "@malica/socle/ports/repositories";
import { statutCabinet, statutDuCircuit, type SuiviDEnvoi } from "@malica/socle/statut-d-envoi";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("la matrice des droits", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`matrice-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  /** Ce que `qui` lit de la table, sous la RLS de la base. */
  const lit = (qui: Personne, table: string, id: string, colonne = "id") =>
    sousIdentiteDuServeur(s.gens[qui].id, async (db) => {
      const { rows } = await db.query(`select 1 from ${table} where ${colonne} = $1`, [id]);
      return rows.length > 0;
    });
  const voit = (qui: Personne, id: string) => lit(qui, "capture.pieces", id);
  const qui_voit = async (id: string) => {
    const r: Record<string, boolean> = {};
    for (const p of ["sami", "sonia", "amel", "bilel", "expert"] as const) r[p] = await voit(p, id);
    return r;
  };

  const statut = async (qui: Personne, id: string) => {
    const liste = (await s.fait(qui, "capture.listAvecLecture", s.pme)) as PieceLue[];
    const p = liste.find((x) => x.id === id);
    return p ? statutDuCircuit(p) : null;
  };
  const vis = async (id: string) =>
    (
      await s.admin.query<{ vis: string }>(
        `select vis::text as vis from capture.pieces where id = $1`,
        [id],
      )
    ).rows[0]?.vis ?? null;

  /** Une pièce lue de `qui`, dans la société. */
  const lue = async (qui: Personne) => {
    const id = await s.deposer(qui, "entite");
    await s.lire(qui, id);
    return id;
  };
  /** Une pièce du siège, envoyée au propriétaire. */
  const chezLeProprietaire = async (qui: Personne = "sami") => {
    const id = await lue(qui);
    await s.fait(qui, "collab.envoyer", id);
    return id;
  };
  /** Une pièce du siège, passée par le propriétaire chez le comptable. */
  const chezLeComptable = async (qui: Personne = "sami") => {
    const id = await chezLeProprietaire(qui);
    await s.fait("amel", "collab.envoyer", id);
    return id;
  };
  const retour = (qui: Personne, pieceId: string, motif: string, note: string | null = null) =>
    s.fait(qui, "supervision.retourner", { pieceId, motifId: s.motifs[motif], note });

  /* ======================================================== 1 · VOIR */

  it("1 · Mon espace — son auteur seul, même pour le patron", async () => {
    const id = await s.deposer("sami", "personnel");
    assert.deepEqual(await qui_voit(id), {
      sami: true,
      sonia: false,
      amel: false,
      bilel: false,
      expert: false,
    });
  });

  it("1 · Pièces de la société — le siège celles qu'il a faites, le propriétaire toutes", async () => {
    const duSiege = await s.deposer("sami", "entite");
    assert.deepEqual(await qui_voit(duSiege), {
      sami: true,
      sonia: false,
      amel: true,
      bilel: true,
      expert: false,
    });
    const duProprietaire = await s.deposer("amel", "entite");
    assert.equal(await voit("sami", duProprietaire), false);
    // Et ce qui la lit avec elle : sa lecture, sa liste.
    await s.lire("amel", duProprietaire);
    assert.equal(await lit("sami", "capture.extractions", duProprietaire, "piece_id"), false);
    const liste = (await s.fait("sami", "capture.listAvecLecture", s.pme)) as PieceLue[];
    assert.ok(!liste.some((p) => p.id === duProprietaire));
  });

  it("1 · Pièces chez le comptable — le siège les siennes, le propriétaire toutes, le comptable celles reçues", async () => {
    const duSiege = await chezLeComptable("sami");
    const duProprietaire = await lue("amel");
    await s.fait("amel", "collab.envoyer", duProprietaire);
    assert.deepEqual(await qui_voit(duSiege), {
      sami: true,
      sonia: false,
      amel: true,
      bilel: true,
      expert: true,
    });
    assert.equal(await voit("sami", duProprietaire), false);
    assert.equal(await voit("expert", duProprietaire), true);
  });

  it("1 · L'écriture comptable — le comptable seul ; la PME lit « Prise en charge »", async () => {
    const id = await chezLeComptable("sami");
    const ecriture = await s.priseEnCharge(id);
    assert.equal(await lit("expert", "socle.ecritures", ecriture), true);
    for (const qui of ["amel", "sami"] as const) {
      assert.equal((await statut(qui, id))?.statut, "prise_en_charge", qui);
      const d = (await s.fait(qui, "capture.dossier", id)) as { suivi: SuiviDEnvoi | null };
      assert.equal(d.suivi?.prisePar, null, "le nom du comptable reste au cabinet");
    }
    // Un autre siège ne lit pas, par la porte de service, l'écriture d'une
    // pièce qu'il ne voit pas.
    assert.equal(await lit("sonia", "socle.ecritures", ecriture), false);
    assert.equal(await lit("sonia", "socle.ecriture_lignes", ecriture, "ecriture_id"), false);
  });

  /* ===================================================== 2 · DÉPOSER */

  it("2 · Scanner — le siège et le propriétaire déposent", async () => {
    for (const qui of ["sami", "amel"] as const) {
      const id = await s.deposer(qui, "entite");
      assert.equal(await voit(qui, id), true, qui);
    }
  });

  it("2 · Déplacer entre Mon espace et la société — chacun les siennes, dans les deux sens", async () => {
    const id = await s.deposer("sami", "personnel");
    await s.fait("sami", "collab.setPieceVis", id, "entite");
    assert.equal(await vis(id), "entite");
    // Le relevé du 28 octobre : « Retour vers Mon espace refusé au siège ».
    await s.fait("sami", "collab.setPieceVis", id, "personnel");
    assert.equal(await vis(id), "personnel");
    await s.fait("sami", "collab.setPieceVis", id, "entite");
    // Le propriétaire ne met pas la pièce d'un siège dans un espace privé.
    await assert.rejects(
      s.fait("amel", "collab.setPieceVis", id, "personnel"),
      /refus\.deplacer\.pas_la_sienne/,
    );
    // Partie chez le propriétaire, elle se demande.
    await s.lire("sami", id);
    await s.fait("sami", "collab.envoyer", id);
    await assert.rejects(
      s.fait("sami", "collab.setPieceVis", id, "personnel"),
      /refus\.deplacer\.chez_le_proprietaire/,
    );
    const duProprietaire = await s.deposer("amel", "entite");
    await s.fait("amel", "collab.setPieceVis", duProprietaire, "personnel");
    assert.equal(await vis(duProprietaire), "personnel");
  });

  /* ===================================================== 3 · ENVOYER */

  it("3 · Envoyer au propriétaire — le siège, les siennes", async () => {
    const id = await lue("sami");
    const r = (await s.fait("sami", "collab.envoyer", id)) as { chez: string; deja: boolean };
    assert.deepEqual({ chez: r.chez, deja: r.deja }, { chez: "proprietaire", deja: false });
    const encore = (await s.fait("sami", "collab.envoyer", id)) as { deja: boolean };
    assert.equal(encore.deja, true, "le doigt ripe : rien de nouveau");
    const deSonia = await lue("sonia");
    await assert.rejects(s.fait("sami", "collab.envoyer", deSonia), /non autorisee/);
    // Le propriétaire, lui, envoie au comptable.
    const duProprietaire = await lue("amel");
    const p = (await s.fait("amel", "collab.envoyer", duProprietaire)) as { chez: string };
    assert.equal(p.chez, "cabinet");
  });

  it("3 · Envoyer au comptable — le propriétaire seul, à l'unité ou en lot ; jamais le siège", async () => {
    const id = await lue("sami");
    await assert.rejects(
      s.fait("sami", "collab.setPieceVis", id, "partage"),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    // Le même geste en lot : chez le siège, il part au propriétaire.
    const lot = (await s.fait("sami", "collab.transmettreLesPieces", [id])) as {
      transmises: number;
    };
    assert.equal(lot.transmises, 1);
    assert.equal((await statut("sami", id))?.chez, "proprietaire");
    await assert.rejects(
      s.fait("sami", "capture.enregistrer", {
        tenantId: s.pme,
        source: "photo",
        vis: "partage",
        idempotencyKey: `matrice-partage-${Date.now()}`,
        contentType: "image/jpeg",
      }),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    assert.equal(await vis(id), "entite");
    // Le propriétaire : toutes, en lot — celle du siège aussi.
    const autre = await lue("amel");
    const r = (await s.fait("amel", "collab.transmettreLesPieces", [id, autre])) as {
      transmises: number;
    };
    assert.equal(r.transmises, 2);
    assert.equal(await vis(id), "partage");
  });

  it("3 · Garder — le propriétaire seul", async () => {
    const id = await lue("sami");
    await assert.rejects(
      s.fait("sami", "collab.garderPiece", id),
      /refus\.garder\.reserve_au_proprietaire/,
    );
    assert.deepEqual(await s.fait("amel", "collab.garderPiece", id), { changed: true });
    assert.equal((await statut("amel", id))?.statut, "gardee");
  });

  /* ===================================================== 4 · RECEVOIR */

  it("4 · « Vue » à l'ouverture — le propriétaire pour le siège, le comptable pour le client", async () => {
    const id = await chezLeProprietaire();
    // Le siège qui rouvre sa pièce ne se « voit » pas lui-même.
    assert.deepEqual(await s.fait("sami", "supervision.voir", id), { vueLe: null, deja: false });
    const v = (await s.fait("amel", "supervision.voir", id)) as { vueLe: string | null };
    assert.ok(v.vueLe);
    assert.equal((await statut("sami", id))?.statut, "vue");
    await s.fait("amel", "collab.envoyer", id);
    const c = (await s.fait("expert", "supervision.voir", id)) as { vueLe: string | null };
    assert.ok(c.vueLe);
    assert.equal((await statut("amel", id))?.statut, "vue");
  });

  it("4 · Retourner avec un motif et une note — le propriétaire au siège, le comptable au client", async () => {
    const id = await chezLeProprietaire();
    await assert.rejects(retour("sami", id, "hors_exercice"), /non autorisee/);
    await assert.rejects(retour("amel", id, "justificatif_manquant"), /ce motif exige une note/);
    await retour("amel", id, "justificatif_manquant", "Le bon de livraison");
    assert.equal((await statut("sami", id))?.statut, "retour");
    // Rien de reçu : rien à retourner.
    const pasEnvoyee = await lue("sonia");
    await assert.rejects(retour("amel", pasEnvoyee, "hors_exercice"), /refus\.retour\.rien_recu/);
    const auComptable = await chezLeComptable("sonia");
    await retour("expert", auComptable, "hors_exercice");
    assert.equal((await statut("amel", auComptable))?.statut, "retour");
  });

  it("4 · Revoir une pièce « Corrigée » après envoi — chez celui qui l'a reçue", async () => {
    const id = await chezLeProprietaire();
    await s.fait("amel", "supervision.voir", id);
    await s.fait("sami", "capture.preciser", id, "document_date", "2026-10-05");
    assert.equal((await statut("amel", id))?.statut, "corrigee");
    // Le comptable : la correction du client après l'envoi.
    await s.fait("amel", "collab.envoyer", id);
    await s.fait("expert", "supervision.voir", id);
    await s.fait("amel", "capture.preciser", id, "document_date", "2026-10-06");
    const d = (await s.fait("expert", "capture.dossier", id)) as {
      piece: { status: string };
      suivi: SuiviDEnvoi | null;
    };
    assert.equal(statutCabinet({ status: d.piece.status, suivi: d.suivi }), "corrigee");
  });

  it("4 · Valider ou forcer l'écriture — le comptable seul", async () => {
    const id = await chezLeComptable();
    for (const qui of ["sami", "amel"] as const)
      await assert.rejects(
        sousIdentiteDuServeur(s.gens[qui].id, (db) =>
          db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [id]),
        ),
        /supervision revient/,
        qui,
      );
    await s.priseEnCharge(id);
    assert.equal((await statut("amel", id))?.statut, "prise_en_charge");
  });

  /* ========================================= 5 · CORRIGER CE QUI EST LU */

  it("5 · Montants, date, type — le siège les siennes, le propriétaire toutes, avant prise en charge", async () => {
    const deSami = await lue("sami");
    await s.fait("sami", "capture.preciser", deSami, "document_date", "2026-10-07");
    await assert.rejects(
      s.fait("sonia", "capture.preciser", deSami, "document_date", "2026-10-07"),
      /non autorisee/,
    );
    await s.fait("amel", "capture.preciser", deSami, "document_date", "2026-10-08");
    const prise = await chezLeComptable("sami");
    await s.priseEnCharge(prise);
    await assert.rejects(
      s.fait("amel", "capture.preciser", prise, "document_date", "2026-10-09"),
      /engagee ne se precise plus/,
    );
  });

  it("5 · Reprendre la photo (remplace) — le siège les siennes, le propriétaire toutes", async () => {
    const id = await chezLeProprietaire();
    await s.fait("amel", "supervision.voir", id);
    await retour("amel", id, "piece_illisible");
    const reprendre = (qui: Personne, ancienne: string) =>
      s.fait(qui, "capture.enregistrer", {
        tenantId: s.pme,
        source: "photo",
        vis: "entite",
        idempotencyKey: `matrice-reprise-${qui}-${ancienne}`,
        contentType: "image/jpeg",
        remplace: ancienne,
      }) as Promise<{ id: string }>;
    await assert.rejects(reprendre("sonia", id), /refus\.remplacement\.introuvable/);
    const { id: nouvelle } = await reprendre("sami", id);
    assert.equal(
      ((await s.fait("sami", "capture.retourDeLaPiece", nouvelle, "fr")) as { fait: boolean }).fait,
      true,
    );
    const autre = await lue("sami");
    const { id: parLeProprietaire } = await reprendre("amel", autre);
    assert.equal(await voit("sami", parLeProprietaire), true, "elle reste la pièce du siège");
  });

  it("5 · Joindre un document — le siège aux siennes, le propriétaire à toutes", async () => {
    const facture = await lue("sami");
    const bl = await lue("sami");
    await s.fait("sami", "capture.rattacher", facture, bl);
    const deSonia = await lue("sonia");
    await assert.rejects(
      s.fait("sami", "capture.rattacher", deSonia, bl),
      /non autorisee|introuvable/,
    );
    const duProprietaire = await lue("amel");
    await s.fait("amel", "capture.rattacher", facture, duProprietaire);
  });

  it("5 · Écrire — le siège au propriétaire, le propriétaire au comptable", async () => {
    const id = await chezLeProprietaire();
    await retour("amel", id, "taux_tva_inapproprie");
    await s.fait("sami", "capture.repondreAuCabinet", id, "19 %");
    const notes = (await s.fait("amel", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string };
    }>;
    assert.ok(notes.some((n) => n.kind === "piece.reponse_client" && n.payload.piece_id === id));
    // Le comptable n'en lit rien : la conversation est dans la société.
    const cabinet = (await s.fait("expert", "collab.notifications", [s.pme])) as Array<{
      payload: { piece_id?: string };
    }>;
    assert.ok(!cabinet.some((n) => n.payload.piece_id === id));
    const auComptable = await chezLeComptable("bilel");
    await retour("expert", auComptable, "taux_tva_inapproprie");
    await s.fait("amel", "capture.repondreAuCabinet", auComptable, "7 %");
  });

  /* ==================================== 6 · RÉPONDRE À UN RETOUR */

  it("6 · Faire le geste demandé — le siège sur le retour du propriétaire et sur celui du comptable", async () => {
    const id = await chezLeComptable();
    await retour("expert", id, "hors_exercice");
    for (const qui of ["sami", "amel"] as const) {
      const c = (await s.fait(qui, "capture.retourDeLaPiece", id, "fr")) as {
        fait: boolean;
      } | null;
      assert.equal(c?.fait, false, qui);
    }
    await s.fait("sami", "capture.preciser", id, "document_date", "2026-10-10");
    assert.equal(
      ((await s.fait("amel", "capture.retourDeLaPiece", id, "fr")) as { fait: boolean }).fait,
      true,
    );
  });

  it("6 · Renvoyer — le siège au propriétaire, le propriétaire au comptable", async () => {
    const id = await chezLeProprietaire();
    await retour("amel", id, "doublon");
    await s.fait("sami", "capture.renvoyer", id);
    assert.equal((await statut("sami", id))?.statut, "envoyee");
    const auComptable = await chezLeComptable();
    await retour("expert", auComptable, "doublon");
    await assert.rejects(
      s.fait("sami", "capture.renvoyer", auComptable),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    await s.fait("amel", "capture.renvoyer", auComptable);
    assert.equal((await statut("amel", auComptable))?.statut, "envoyee");
  });

  it("6 · Supprimer ou garder la pièce retournée — le siège supprime, le propriétaire supprime ou garde", async () => {
    const id = await chezLeProprietaire();
    await retour("amel", id, "doublon");
    await assert.rejects(s.fait("sami", "collab.garderPiece", id), /refus\.garder/);
    assert.equal(await s.fait("sami", "capture.supprimer", id), true);
    const auComptable = await chezLeComptable();
    await retour("expert", auComptable, "doublon");
    assert.deepEqual(await s.fait("amel", "collab.garderPiece", auComptable), { changed: true });
    const { rows } = await s.admin.query(
      `select 1 from collab.notifications where kind = 'piece.gardee' and payload ->> 'piece_id' = $1`,
      [auComptable],
    );
    assert.equal(rows.length, 1, "le comptable est prévenu");
  });

  /* ============================================ 7 · DEMANDER */

  it("7 · Demander à récupérer — le siège au propriétaire, le propriétaire au comptable ; jamais vers un espace privé", async () => {
    const chezAmel = await chezLeProprietaire();
    const r = (await s.fait("sami", "collab.demanderSurPiece", chezAmel, "rappel")) as {
      dejaDemandee: boolean;
    };
    assert.equal(r.dejaDemandee, false);
    await s.fait("amel", "collab.repondreSurPiece", chezAmel, "rappel", true, null);
    assert.equal(await vis(chezAmel), "entite");
    // Pas envoyée : il la reprend sans demander.
    await assert.rejects(
      s.fait("sami", "collab.demanderSurPiece", chezAmel, "rappel"),
      /rien a demander/,
    );
    const auComptable = await lue("amel");
    await s.fait("amel", "collab.envoyer", auComptable);
    await s.fait("amel", "collab.demanderSurPiece", auComptable, "rappel");
    await s.fait("expert", "collab.repondreSurPiece", auComptable, "rappel", true, null);
    assert.equal(await vis(auComptable), "entite");
  });

  it("7 · Demander à supprimer — et l'accord aboutit, même sur une pièce retournée", async () => {
    const id = await chezLeComptable();
    await retour("expert", id, "doublon");
    await s.fait("amel", "collab.demanderSurPiece", id, "suppression");
    await s.fait("expert", "collab.repondreSurPiece", id, "suppression", true, null);
    assert.equal(await vis(id), null, "effacée");
  });

  it("7 · Accorder ou refuser (note si refus) — le propriétaire pour le siège, le comptable pour le client", async () => {
    const id = await chezLeProprietaire();
    await s.fait("sami", "collab.demanderSurPiece", id, "suppression");
    await assert.rejects(
      s.fait("sami", "collab.repondreSurPiece", id, "suppression", true, null),
      /seul le proprietaire/,
    );
    await assert.rejects(
      s.fait("expert", "collab.repondreSurPiece", id, "suppression", true, null),
      /non autorisee/,
    );
    await s.fait("bilel", "collab.repondreSurPiece", id, "suppression", false, "Non");
    assert.ok(await vis(id));
    const auComptable = await lue("amel");
    await s.fait("amel", "collab.envoyer", auComptable);
    await s.fait("amel", "collab.demanderSurPiece", auComptable, "suppression");
    await assert.rejects(
      s.fait("expert", "collab.repondreSurPiece", auComptable, "suppression", false, null),
      /demandes_refus_motive/,
    );
    await s.fait(
      "expert",
      "collab.repondreSurPiece",
      auComptable,
      "suppression",
      false,
      "À garder",
    );
  });

  it("7 · Demande d'un siège sur une pièce chez le comptable — le propriétaire accorde, elle est transmise d'elle-même", async () => {
    const id = await chezLeComptable();
    await s.fait("sami", "collab.demanderSurPiece", id, "suppression");
    await s.fait("amel", "collab.repondreSurPiece", id, "suppression", true, null);
    assert.ok(await vis(id), "rien n'est effacé avant la réponse du comptable");
    const d = (await s.fait("expert", "collab.demandesDUnePiece", id)) as Array<{
      fait: string;
      etape: string;
    }>;
    assert.deepEqual(
      d.map((x) => `${x.etape}:${x.fait}`),
      ["cabinet:demandee"],
    );
    await s.fait("expert", "collab.repondreSurPiece", id, "suppression", true, null);
    assert.equal(await vis(id), null);
  });

  it("7 · Après un accord — récupérer : dans la société ; supprimer : effacée, ou archivée si prise en charge (contre-passation)", async () => {
    const prise = await chezLeComptable();
    const ecriture = await s.priseEnCharge(prise);
    await s.fait("amel", "collab.demanderSurPiece", prise, "suppression");
    await s.fait("expert", "collab.repondreSurPiece", prise, "suppression", true, null);
    const { rows } = await s.admin.query<{ archivee: boolean; vivantes: string }>(
      `select p.archivee_le is not null as archivee,
              (select count(*)::text from socle.ecritures e
                where e.piece_id = p.id and e.status = 'booked' and app.ecriture_vivante(e.id))
                as vivantes
         from capture.pieces p where p.id = $1`,
      [prise],
    );
    assert.deepEqual(rows[0], { archivee: true, vivantes: "0" }, "contre-passée, archivée");
    const { rows: cp } = await s.admin.query(
      `select 1 from socle.ecritures where reverses_id = $1 and status = 'booked'`,
      [ecriture],
    );
    assert.equal(cp.length, 1, "la contre-passation est au journal");

    const rappel = await chezLeComptable();
    await s.priseEnCharge(rappel);
    await s.fait("sami", "collab.demanderSurPiece", rappel, "rappel");
    await s.fait("amel", "collab.repondreSurPiece", rappel, "rappel", true, null);
    await s.fait("expert", "collab.repondreSurPiece", rappel, "rappel", true, null);
    assert.equal(await vis(rappel), "entite", "dans la société, jamais un espace privé");
    assert.equal((await statut("sami", rappel))?.statut, "a_envoyer");
  });

  /* =========================================== 8 · SUPPRIMER DIRECTEMENT */

  it("8 · Pièce pas encore envoyée — le siège les siennes, le propriétaire toutes (le siège est prévenu)", async () => {
    const deSonia = await s.deposer("sonia", "entite");
    // Le relevé du 28 octobre : « Un siège supprime celle d'un autre ».
    // Ce qu'il ne lit pas n'existe pas pour lui : rien n'est effacé.
    assert.equal(await s.fait("sami", "capture.supprimer", deSonia), false);
    assert.ok(await vis(deSonia));
    const deSami = await s.deposer("sami", "entite");
    assert.equal(await s.fait("sami", "capture.supprimer", deSami), true);
    const envoyee = await chezLeProprietaire();
    await assert.rejects(
      s.fait("sami", "capture.supprimer", envoyee),
      /refus\.suppression\.chez_le_proprietaire/,
    );
    assert.equal(await s.fait("amel", "capture.supprimer", deSonia), true);
    const notes = (await s.fait("sonia", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string };
    }>;
    assert.ok(
      notes.some(
        (n) => n.kind === "piece.supprimee_par_le_proprietaire" && n.payload.piece_id === deSonia,
      ),
    );
    const privee = await s.deposer("sami", "personnel");
    // Mon espace d'un siège : le propriétaire ne le lit pas, il n'y efface rien.
    assert.equal(await s.fait("amel", "capture.supprimer", privee), false);
    assert.ok(await vis(privee));
  });

  /* ============================================== 9 · LES PERSONNES */

  it("9 · Plusieurs propriétaires — mêmes droits ; le premier qui ouvre donne « Vue par {prénom} »", async () => {
    const id = await chezLeProprietaire();
    await s.fait("bilel", "supervision.voir", id);
    await s.fait("amel", "supervision.voir", id);
    assert.deepEqual(await statut("sami", id), {
      statut: "vue",
      chez: "proprietaire",
      qui: "Bilel",
    });
    const droits = async (qui: Personne) =>
      ((await s.fait(qui, "acces.monAcces", s.pme)) as { droits: string[] }).droits;
    assert.deepEqual(await droits("bilel"), await droits("amel"));
    assert.ok((await droits("sami"))?.includes("envoi.proprietaire"));
    assert.ok(!(await droits("sami"))?.includes("envoi.cabinet"));
    await s.fait("bilel", "collab.envoyer", id);
    assert.equal(await vis(id), "partage");
  });

  it("9 · Un siège quitte la société — son Mon espace part avec lui, la société garde ses pièces", async () => {
    const t = await monterUneSociete(`matrice-depart-${Date.now()}`);
    try {
      const societe = await t.deposer("sami", "entite");
      const privee = await t.deposer("sami", "personnel");
      // Le relevé du 28 octobre : « Non défini » — son espace privé le retenait.
      const r = (await t.fait("amel", "facturation.libererPlace", t.pme, t.gens.sami.id)) as {
        libere: boolean;
      };
      assert.equal(r.libere, true);
      const lu = (qui: Personne, id: string) =>
        sousIdentiteDuServeur(t.gens[qui].id, async (db) => {
          const { rows } = await db.query(`select 1 from capture.pieces where id = $1`, [id]);
          return rows.length === 1;
        });
      assert.deepEqual(
        [await lu("amel", societe), await lu("amel", privee), await lu("sami", privee)],
        [true, false, true],
      );
    } finally {
      await t.fermer();
    }
  });

  /* ================================================== 10 · JOURNAL */

  it("10 · Journal du jour, export — le comptable seul", async () => {
    const j = (await s.fait("expert", "journalDuJour.lire", s.cabinet, s.pme, null, "fr")) as {
      jour: string;
    };
    assert.ok(j.jour);
    for (const qui of ["amel", "sami"] as const)
      await assert.rejects(s.fait(qui, "journalDuJour.lire", s.cabinet, s.pme, null, "fr"));
  });
});
