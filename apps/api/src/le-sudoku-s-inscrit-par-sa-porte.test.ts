/**
 * Le sudoku, sous de vraies identités — pas en superutilisateur.
 *
 * Ce que le banc du moteur ne voit pas : qui peut lire la grille, qui peut
 * écrire ce que le sudoku a lu, et qui peut le relire. Tout passe par les
 * vraies portes (`executerRpc`), sous l'identité d'une personne d'une société
 * d'essai, et sous celle d'un inconnu.
 *
 *   — la grille et le pack se lisent par les vues, sous l'identité du client ;
 *   — un navigateur n'atteint ni le contexte ni l'inscription (méthodes du serveur) ;
 *   — un client ne peut ni insérer directement, ni appeler la porte hors serveur ;
 *   — le serveur inscrit par la porte, et seule la société relit ses champs ;
 *   — ce qui est inscrit ne se réécrit pas (R7).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import type { ContexteDuSudoku } from "./malica/lecture/sudoku.ts";
import { executerRpc } from "./rpc.ts";

describe("le sudoku s'inscrit par sa porte", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sudoku-${Date.now()}`;
  let s: SocieteDEssai;
  let piece = "";
  let inconnu = "";

  const serveur = (qui: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(qui, (db) =>
      executerRpc(db, { depot: "capture", methode, args }, "serveur"),
    );

  const champs = {
    grille: "facture",
    issue: "ambigue" as const,
    champs: [
      { champ: "total_ht", valeur: null, statut: "signale", citations: [] },
      {
        champ: "droit_timbre",
        valeur: "1000",
        statut: "prouve",
        citations: [{ page: 1, ordinal: 3 }],
      },
    ],
  };

  before(async () => {
    s = await monterUneSociete(marque);
    piece = await s.deposer("amel", "entite");
    const u = await creerCompte(`${marque}-inconnu@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    inconnu = u.id;
  });
  after(async () => {
    await s.fermer();
  });

  it("la grille et le pack se lisent sous l'identité du client, par les vues", async () => {
    const c = (await serveur(
      s.gens.amel.id,
      "contexteSudoku",
      s.pack,
      "facture",
    )) as ContexteDuSudoku;
    assert.ok(c.grille.champs.length > 0, "les champs de la grille");
    assert.ok(
      c.grille.preuves.some((p) => (p.expression as { op?: string }).op === "somme"),
      "une preuve exécutable",
    );
    assert.ok(c.pack.baremes["tva"]!.length > 0, "le barème de TVA du pack");
    assert.ok(
      c.pack.charges.some((ch) => ch.montant_fixe !== null),
      "un droit fixe du pack",
    );
  });

  it("un navigateur n'atteint ni le contexte ni l'inscription", async () => {
    for (const methode of ["contexteSudoku", "inscrireChampsLus"]) {
      await assert.rejects(
        s.fait("amel", `capture.${methode}`, { pieceId: piece, ...champs }),
        /méthode inconnue/,
      );
    }
  });

  it("un client n'insère pas directement, ni n'appelle la porte hors serveur", async () => {
    await assert.rejects(
      sousIdentite(s.gens.amel.id, (db) =>
        db.query(
          `insert into capture.champs_lus (tenant_id, piece_id, champ_code, statut, issue)
           values ($1, $2, 'total_ht', 'prouve', 'prouvee')`,
          [s.pme, piece],
        ),
      ),
      /permission denied|42501/,
    );
    await assert.rejects(
      sousIdentite(s.gens.amel.id, (db) =>
        db.query(`select public.capture_champs_lus_inscrire($1, 'facture', 'prouvee', '[]')`, [
          piece,
        ]),
      ),
      /reserve au serveur/,
    );
  });

  it("le serveur inscrit par la porte ; seule la société relit ses champs", async () => {
    const r = (await serveur(s.gens.amel.id, "inscrireChampsLus", {
      pieceId: piece,
      ...champs,
    })) as { inscrits: number };
    assert.equal(r.inscrits, 2);

    const relus = (qui: string) =>
      sousIdentiteDuServeur(qui, async (db) => {
        const { rows } = await db.query<{ champ_code: string; valeur: string | null }>(
          `select champ_code, valeur from capture.champs_lus where piece_id = $1 order by champ_code`,
          [piece],
        );
        return rows;
      });
    assert.deepEqual(await relus(s.gens.amel.id), [
      { champ_code: "droit_timbre", valeur: "1000" },
      { champ_code: "total_ht", valeur: null },
    ]);
    assert.deepEqual(await relus(inconnu), [], "un inconnu ne relit rien");
  });

  it("un inconnu ne peut pas inscrire sur la pièce d'une autre société", async () => {
    await assert.rejects(
      serveur(inconnu, "inscrireChampsLus", { pieceId: piece, ...champs }),
      /piece\.inaccessible/,
    );
  });

  it("ce qui est inscrit ne se réécrit pas (R7)", async () => {
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.amel.id, (db) =>
        db.query(`update capture.champs_lus set valeur = '0' where piece_id = $1`, [piece]),
      ),
      /permission denied|42501|refus/i,
    );
  });
});
