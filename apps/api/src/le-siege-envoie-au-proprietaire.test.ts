/**
 * Un seul circuit, deux fois : siège → propriétaire → comptable (« Malica
 * sans blocage », lot 4 ; décisions du 18 et du 28 octobre 2026).
 *
 * Chaque chemin est joué de bout en bout par l'API, sous l'identité de chacun
 * — l'API ne filtre rien, la base décide — et chaque statut est celui que le
 * Socle dérive des faits que l'API rend (`statutDuCircuit`), le même que les
 * écrans lisent.
 *
 * Relevé sur la base de test le 28 octobre : « Envoyer au propriétaire », sa
 * « Vue », son retour et ses demandes n'existaient pas ; le siège envoyait
 * au comptable et ne voyait pas le retour du comptable sur sa pièce ; son
 * départ n'était pas défini.
 *
 *   node --experimental-strip-types --test src/le-siege-envoie-au-proprietaire.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PieceLue } from "@malica/socle/ports/repositories";
import { statutDuCircuit, type StatutDuCircuit } from "@malica/socle/statut-d-envoi";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("un seul circuit, deux fois", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`circuit-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  /** Le statut de la pièce dans la liste de `qui`, ou `null` s'il ne la voit pas. */
  const statut = async (qui: Personne, id: string): Promise<StatutDuCircuit | null> => {
    const liste = (await s.fait(qui, "capture.listAvecLecture", s.pme)) as PieceLue[];
    const p = liste.find((x) => x.id === id);
    return p ? statutDuCircuit(p) : null;
  };

  /** Une pièce lue du siège, envoyée au propriétaire. */
  const envoyeeParSami = async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    const r = (await s.fait("sami", "collab.envoyer", id)) as { chez: string };
    assert.equal(r.chez, "proprietaire");
    return id;
  };

  const carte = (qui: Personne, id: string) =>
    s.fait(qui, "capture.retourDeLaPiece", id, "fr") as Promise<{
      chez: string;
      qui: string;
      motif: string;
      geste: string;
      note: string | null;
      fait: boolean;
    } | null>;

  it("le chemin entier : siège → propriétaire → comptable → retour → geste du siège → le propriétaire renvoie → le comptable valide → « Prise en charge » des deux côtés", async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    assert.deepEqual(await statut("sami", id), { statut: "a_envoyer", chez: null, qui: null });

    // Le siège envoie : au propriétaire, jamais au comptable.
    const envoi = (await s.fait("sami", "collab.envoyer", id)) as { chez: string; le: string };
    assert.equal(envoi.chez, "proprietaire");
    assert.ok(envoi.le, "l'heure de la base, que l'écran « Envoyé. » dit");
    assert.deepEqual(await statut("sami", id), {
      statut: "envoyee",
      chez: "proprietaire",
      qui: null,
    });
    assert.equal((await statut("amel", id))?.statut, "recue", "chez le propriétaire : Reçue");

    // Le propriétaire ouvre : « Vue par Amel », automatique.
    await s.fait("amel", "supervision.voir", id);
    assert.deepEqual(await statut("sami", id), {
      statut: "vue",
      chez: "proprietaire",
      qui: "Amel",
    });
    assert.equal((await statut("amel", id))?.statut, "a_envoyer", "vue, elle est à lui d'envoyer");

    // Le propriétaire envoie au comptable : le même geste.
    const envoi2 = (await s.fait("amel", "collab.envoyer", id)) as { chez: string };
    assert.equal(envoi2.chez, "cabinet");
    assert.deepEqual(await statut("amel", id), { statut: "envoyee", chez: "cabinet", qui: null });
    assert.deepEqual(await statut("sami", id), {
      statut: "vue",
      chez: "proprietaire",
      qui: "Amel",
    });

    // Le comptable ouvre, puis retourne : un motif qui demande une réponse.
    await s.fait("expert", "supervision.voir", id);
    assert.equal((await statut("amel", id))?.statut, "vue");
    await s.fait("expert", "supervision.retourner", {
      pieceId: id,
      motifId: s.motifs["taux_tva_inapproprie"],
      note: "Quel taux ?",
    });

    // La carte apparaît chez le propriétaire ET chez le siège.
    for (const qui of ["amel", "sami"] as const) {
      assert.deepEqual(
        await statut(qui, id),
        { statut: "retour", chez: "cabinet", qui: null },
        qui,
      );
      const c = await carte(qui, id);
      assert.equal(c?.chez, "cabinet", qui);
      assert.equal(c?.qui, s.nomDuCabinet, qui);
      assert.equal(c?.fait, false, qui);
    }

    // Le siège fait le geste ; le propriétaire le voit fait.
    await s.fait("sami", "capture.repondreAuCabinet", id, "Taux à 19 %");
    assert.equal((await carte("amel", id))?.fait, true);

    // Le siège ne renvoie pas au comptable : le propriétaire renvoie.
    await assert.rejects(
      s.fait("sami", "capture.renvoyer", id),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    await assert.rejects(
      s.fait("sami", "collab.envoyer", id),
      /refus\.envoi\.proprietaire\.hors_societe/,
    );
    const renvoi = (await s.fait("amel", "collab.envoyer", id)) as { chez: string };
    assert.equal(renvoi.chez, "cabinet");
    assert.equal((await statut("amel", id))?.statut, "envoyee");
    assert.equal(await carte("sami", id), null, "le retour est clos");

    // Le comptable valide : « Prise en charge » des deux côtés.
    await s.priseEnCharge(id);
    for (const qui of ["amel", "sami"] as const)
      assert.deepEqual(await statut(qui, id), {
        statut: "prise_en_charge",
        chez: "cabinet",
        qui: null,
      });
  });

  it("le retour du propriétaire au siège : la même carte — motif, note, un geste, puis « Renvoyer »", async () => {
    const id = await envoyeeParSami();
    await s.fait("amel", "supervision.voir", id);
    await s.fait("amel", "supervision.retourner", {
      pieceId: id,
      motifId: s.motifs["hors_exercice"],
      note: "La date ?",
    });

    assert.deepEqual(await statut("sami", id), {
      statut: "retour",
      chez: "proprietaire",
      qui: "Amel",
    });
    assert.deepEqual(await statut("amel", id), { statut: "retournee", chez: "siege", qui: "Sami" });
    const c = await carte("sami", id);
    assert.equal(c?.chez, "proprietaire");
    assert.equal(c?.qui, "Amel");
    assert.equal(c?.motif, "hors_exercice");
    assert.equal(c?.geste, "corriger_date");
    assert.equal(c?.note, "La date ?");
    assert.equal(c?.fait, false);

    // Le siège a été prévenu, lui seul.
    const notes = (await s.fait("sami", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string };
    }>;
    assert.ok(
      notes.some(
        (n) => n.kind === "piece.retournee_par_le_proprietaire" && n.payload.piece_id === id,
      ),
    );

    // Le geste, puis « Renvoyer » : au propriétaire.
    await s.fait("sami", "capture.preciser", id, "document_date", "2026-10-01");
    assert.equal((await carte("sami", id))?.fait, true);
    const r = (await s.fait("sami", "capture.renvoyer", id)) as { le: string };
    assert.ok(r.le);
    assert.deepEqual(await statut("sami", id), {
      statut: "envoyee",
      chez: "proprietaire",
      qui: null,
    });
    assert.equal((await statut("amel", id))?.statut, "recue", "renvoyée : de nouveau Reçue");
    assert.equal(await carte("sami", id), null);
  });

  it("« Corrigée » : le siège corrige après l'envoi, le propriétaire la revoit", async () => {
    const id = await envoyeeParSami();
    await s.fait("amel", "supervision.voir", id);
    assert.equal((await statut("amel", id))?.statut, "a_envoyer");
    await s.fait("sami", "capture.preciser", id, "document_date", "2026-10-02");
    assert.equal((await statut("amel", id))?.statut, "corrigee");
    // Ce que le propriétaire corrige lui-même ne la rend pas « Corrigée ».
    await s.fait("amel", "supervision.voir", id);
    assert.equal((await statut("amel", id))?.statut, "a_envoyer");
    await s.fait("amel", "capture.preciser", id, "document_date", "2026-10-03");
    assert.equal((await statut("amel", id))?.statut, "a_envoyer");
  });

  it("deux propriétaires qui ouvrent ensemble ne donnent qu'UNE « Vue »", async () => {
    const id = await envoyeeParSami();
    const [a, b] = (await Promise.all([
      s.fait("amel", "supervision.voir", id),
      s.fait("bilel", "supervision.voir", id),
    ])) as Array<{ vueLe: string; deja: boolean }>;
    assert.equal(a!.vueLe, b!.vueLe, "la même vue, rendue aux deux");
    assert.deepEqual([a!.deja, b!.deja].sort(), [false, true]);
    const { rows } = await s.admin.query<{ n: string }>(
      `select count(*)::text as n from capture.vues where piece_id = $1 and cabinet_org_id = $2`,
      [id, s.pme],
    );
    assert.equal(rows[0]!.n, "1");
    const vu = await statut("sami", id);
    assert.equal(vu?.statut, "vue");
    assert.ok(vu?.qui === "Amel" || vu?.qui === "Bilel");
    // Le comptable ne compte pas cette vue comme la sienne.
    const d = (await s.fait("amel", "capture.dossier", id)) as { suivi: unknown };
    assert.equal(d.suivi, null);
  });

  it("demander à récupérer : le siège au propriétaire ; accordée, elle revient dans la société, à envoyer", async () => {
    const id = await envoyeeParSami();
    await s.fait("sami", "collab.demanderSurPiece", id, "rappel");
    // Le comptable n'en sait rien : la demande n'est pas la sienne.
    const vuesDuCabinet = (await s.fait("expert", "collab.demandesDUnePiece", id)) as unknown[];
    assert.equal(vuesDuCabinet.length, 0);
    await s.fait("amel", "collab.repondreSurPiece", id, "rappel", true, null);
    const { rows } = await s.admin.query<{ vis: string }>(
      `select vis::text as vis from capture.pieces where id = $1`,
      [id],
    );
    assert.equal(rows[0]!.vis, "entite", "jamais un espace privé");
    assert.deepEqual(await statut("sami", id), { statut: "a_envoyer", chez: null, qui: null });
  });

  it("demander à supprimer : refusée avec une note, puis accordée — effacée, le siège le sait", async () => {
    const id = await envoyeeParSami();
    await s.fait("sami", "collab.demanderSurPiece", id, "suppression");
    await assert.rejects(
      s.fait("amel", "collab.repondreSurPiece", id, "suppression", false, null),
      /demandes_refus_motive/,
    );
    await s.fait("amel", "collab.repondreSurPiece", id, "suppression", false, "Gardons-la");
    const d = (await s.fait("sami", "collab.demandesDUnePiece", id)) as Array<{
      fait: string;
      note: string | null;
      etape: string;
    }>;
    assert.deepEqual(
      { fait: d[0]!.fait, note: d[0]!.note, etape: d[0]!.etape },
      { fait: "refusee", note: "Gardons-la", etape: "proprietaire" },
    );
    await s.fait("sami", "collab.demanderSurPiece", id, "suppression");
    await s.fait("amel", "collab.repondreSurPiece", id, "suppression", true, null);
    const { rows } = await s.admin.query(`select 1 from capture.pieces where id = $1`, [id]);
    assert.equal(rows.length, 0, "aucune écriture n'a existé : elle part");
    const notes = (await s.fait("sami", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string; accorde?: boolean };
    }>;
    assert.ok(
      notes.some(
        (n) =>
          n.kind === "piece.demande_tranchee" && n.payload.piece_id === id && n.payload.accorde,
      ),
    );
  });

  it("la demande d'un siège sur une pièce chez le comptable : le propriétaire accorde, elle part d'elle-même au comptable", async () => {
    const id = await envoyeeParSami();
    await s.fait("amel", "collab.envoyer", id);
    await s.fait("sami", "collab.demanderSurPiece", id, "rappel");
    await s.fait("amel", "collab.repondreSurPiece", id, "rappel", true, null);

    const chezLeSiege = (await s.fait("sami", "collab.demandesDUnePiece", id)) as Array<{
      fait: string;
      etape: string;
    }>;
    assert.deepEqual(
      chezLeSiege.map((d) => `${d.etape}:${d.fait}`),
      ["cabinet:demandee", "proprietaire:accordee", "proprietaire:demandee"],
      "« Demande transmise » au cabinet",
    );
    const chezLeCabinet = (await s.fait("expert", "collab.demandesDUnePiece", id)) as Array<{
      fait: string;
      etape: string;
    }>;
    assert.deepEqual(
      chezLeCabinet.map((d) => `${d.etape}:${d.fait}`),
      ["cabinet:demandee"],
    );

    // Le comptable accorde : la pièce revient à la société, à envoyer chez le siège.
    await s.fait("expert", "collab.repondreSurPiece", id, "rappel", true, null);
    assert.deepEqual(await statut("sami", id), { statut: "a_envoyer", chez: null, qui: null });
    const notes = (await s.fait("sami", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string; accorde?: boolean; transmise?: boolean };
    }>;
    assert.ok(notes.some((n) => n.payload.piece_id === id && n.payload.transmise === true));
    assert.ok(
      notes.filter((n) => n.kind === "piece.demande_tranchee" && n.payload.piece_id === id)
        .length >= 2,
      "il apprend l'accord du propriétaire, puis celui du comptable",
    );
  });

  it("le propriétaire supprime la pièce pas encore envoyée d'un siège ; le siège est prévenu", async () => {
    const id = await s.deposer("sonia", "entite");
    assert.equal(await s.fait("amel", "capture.supprimer", id), true);
    const notes = (await s.fait("sonia", "collab.notifications", [s.pme])) as Array<{
      kind: string;
      payload: { piece_id?: string; par?: string };
    }>;
    const n = notes.find(
      (x) => x.kind === "piece.supprimee_par_le_proprietaire" && x.payload.piece_id === id,
    );
    assert.equal(n?.payload.par, "Amel");
    // L'autre siège ne lit pas cette notification.
    const autre = (await s.fait("sami", "collab.notifications", [s.pme])) as Array<{
      payload: { piece_id?: string };
    }>;
    assert.ok(!autre.some((x) => x.payload.piece_id === id));
  });

  it("un siège qui quitte la société : ses pièces restent à la société, son Mon espace part avec son compte", async () => {
    const marque = `depart-${Date.now()}`;
    const t = await monterUneSociete(marque);
    try {
      const societe = await t.deposer("sonia", "entite");
      await t.fait("sonia", "collab.envoyer", societe);
      const privee = await t.deposer("sonia", "personnel");
      const evenements = async () =>
        Number(
          (
            await t.admin.query<{ n: string }>(
              `select count(*)::text as n from audit.event_log where object_id = any($1::uuid[])`,
              [[societe, privee]],
            )
          ).rows[0]!.n,
        );
      const avant = await evenements();

      const r = (await t.fait("amel", "facturation.libererPlace", t.pme, t.gens.sonia.id)) as {
        libere: boolean;
      };
      assert.equal(r.libere, true, "son espace privé ne retient plus sa place");

      const lit = (qui: Personne, id: string) =>
        sousIdentiteDuServeur(t.gens[qui].id, async (db) => {
          const { rows } = await db.query(`select 1 from capture.pieces where id = $1`, [id]);
          return rows.length === 1;
        });
      assert.equal(await lit("amel", societe), true, "la pièce de la société reste à la société");
      assert.equal(await statut2(t, "amel", societe), "recue", "et son envoi avec elle");
      assert.equal(
        await lit("amel", privee),
        false,
        "le propriétaire ne lit jamais son Mon espace",
      );
      assert.equal(await lit("sonia", privee), true, "son Mon espace part avec son compte");
      assert.equal(await lit("sonia", societe), false, "la société ne lui est plus ouverte");
      assert.ok((await evenements()) >= avant, "aucun fait n'est effacé");
      const { rows } = await t.admin.query(
        `select 1 from capture.circuit where piece_id = $1 and fait = 'envoyee'`,
        [societe],
      );
      assert.equal(rows.length, 1);
      // Un propriétaire ne se retire pas par cette porte.
      await assert.rejects(
        t.fait("amel", "facturation.libererPlace", t.pme, t.gens.bilel.id),
        /refus\.place\.proprietaire/,
      );
    } finally {
      await t.fermer();
    }
  });

  /** Le statut dans la liste de `qui`, pour une autre société d'essai. */
  async function statut2(t: SocieteDEssai, qui: Personne, id: string) {
    const liste = (await t.fait(qui, "capture.listAvecLecture", t.pme)) as PieceLue[];
    const p = liste.find((x) => x.id === id);
    return p ? statutDuCircuit(p).statut : null;
  }
});
