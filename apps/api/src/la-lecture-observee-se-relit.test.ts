/**
 * Ce que le lecteur prouvé a lu se RELIT — sous de vraies identités.
 *
 * Le moteur tourne en observation : il inscrit ses champs dans
 * `capture.champs_lus` sans toucher à la lecture retenue. Le dirigeant doit
 * pouvoir le voir avant de l'allumer. Ces épreuves tiennent la lecture
 * (`capture.lectureObservee`), appelée comme le navigateur l'appelle :
 *
 *   — seule la DERNIÈRE inscription est rendue, son issue en tête ;
 *   — le rôle, la famille d'experts et l'avertissement sont traduits par
 *     `ref.labels` (`concept_role`, `concept_expert`, `avertissement_lecture`),
 *     le français à défaut ;
 *   — la société relit sa pièce, le cabinet engagé aussi ; un inconnu ne relit rien ;
 *   — une pièce jamais lue rend `null`, pas une liste vide qui ferait croire à une lecture.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { LectureObservee } from "@malica/socle/ports/repositories";

import { creerCompte } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { sousIdentiteDuServeur } from "./db.ts";
import type { ChampsLusAInscrire } from "./malica/lecture/sudoku.ts";
import { executerRpc } from "./rpc.ts";

describe("la lecture observée se relit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `observee-${Date.now()}`;
  const JOUR = "2026-09-15";
  let s: SocieteDEssai;
  let piece = "";
  let jamaisLue = "";
  let inconnu = "";

  const inscrire = (champs: ChampsLusAInscrire["champs"], issue: ChampsLusAInscrire["issue"]) =>
    sousIdentiteDuServeur(s.gens.amel.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "inscrireChampsLus",
          args: [
            {
              pieceId: piece,
              packId: s.pack,
              jour: JOUR,
              grille: "facture",
              issue,
              champs,
            } satisfies ChampsLusAInscrire,
          ],
        },
        "serveur",
      ),
    );

  const relire = (qui: string, id: string, locale: string) =>
    sousIdentiteDuServeur(qui, (db) =>
      executerRpc(db, { depot: "capture", methode: "lectureObservee", args: [id, locale] }),
    ) as Promise<LectureObservee | null>;

  const ligne = (
    champ: string | null,
    valeur: string | null,
    statut: string | null,
    citations: ChampsLusAInscrire["champs"][number]["citations"] = [],
    rang: number | null = null,
  ) => ({ champ, rang, instance: null, valeur, statut, citations });

  before(async () => {
    s = await monterUneSociete(marque);
    piece = await s.deposer("amel", "entite");
    jamaisLue = await s.deposer("amel", "entite");
    const u = await creerCompte(`${marque}-inconnu@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    inconnu = u.id;

    // Une première lecture, que la seconde remplace : seule la seconde se relit.
    await inscrire([ligne("total_ht", "1000.000", "prouve", [{ page: 1, ordinal: 2 }])], "prouvee");
    await inscrire(
      [
        ligne("quantite", "3", "deduit", [{ case: { page: 1, ligne: 1 } }], 1),
        ligne("total_ht", null, "signale"),
        {
          ...ligne("matricule_fiscal_emetteur", "1876543W/A/M/000", "prouve", [
            { page: 1, ordinal: 12 },
          ]),
          avertissement: "lettre_de_controle_discordante",
        },
      ],
      "signalee",
    );
    // Lue, puis transmise : le cabinet la voit.
    await s.lire("amel", piece);
    await s.fait("amel", "collab.transmettreLesPieces", [piece]);
  });
  after(async () => {
    await s.fermer();
  });

  it("la société relit la dernière lecture, triée par rang, libellés dans sa langue", async () => {
    const l = await relire(s.gens.amel.id, piece, "en");
    assert.ok(l, "une lecture inscrite se relit");
    assert.equal(l.issue, "signalee");
    assert.equal(l.grille?.code, "facture");
    assert.deepEqual(
      l.champs.map((c) => [c.code, c.statut, c.rang]),
      [
        ["matricule_fiscal_emetteur", "prouve", null],
        ["total_ht", "signale", null],
        ["quantite", "deduit", 1],
      ],
      "la première inscription n'apparaît pas ; hors tableau d'abord, puis par rang",
    );
    const mf = l.champs[0]!;
    assert.deepEqual(mf.role, { code: "fournisseur", libelle: "Supplier" });
    assert.deepEqual(mf.expert, { code: "identifiant", libelle: "Identifier" });
    assert.equal(mf.avertissement?.code, "lettre_de_controle_discordante");
    assert.match(mf.avertissement!.libelle, /check letter/);
    assert.deepEqual(mf.citations, [{ page: 1, ordinal: 12 }]);
    assert.equal(l.champs[1]!.role, null, "un total ne porte sur aucune partie");
    assert.equal(l.champs[1]!.valeur, null);
  });

  it("en arabe, l'arabe ; une langue sans libellé retombe sur le français", async () => {
    const ar = await relire(s.gens.amel.id, piece, "ar");
    assert.equal(ar!.champs[0]!.role!.libelle, "المزوّد");
    const de = await relire(s.gens.amel.id, piece, "de");
    assert.equal(de!.champs[0]!.role!.libelle, "Fournisseur");
    assert.equal(de!.champs[0]!.expert!.libelle, "Identifiant");
  });

  it("le cabinet engagé relit la pièce de son client", async () => {
    const l = await relire(s.gens.expert.id, piece, "fr");
    assert.equal(l?.issue, "signalee");
    assert.equal(l?.champs.length, 3);
  });

  it("un inconnu ne relit rien, et une pièce jamais lue rend null", async () => {
    assert.equal(await relire(inconnu, piece, "fr"), null);
    assert.equal(await relire(s.gens.amel.id, jamaisLue, "fr"), null);
  });

  it("relire n'écrit rien", async () => {
    const compter = async () =>
      Number(
        (
          await s.admin.query<{ n: string }>(
            `select count(*) as n from capture.champs_lus where piece_id = $1`,
            [piece],
          )
        ).rows[0]!.n,
      );
    const avant = await compter();
    await relire(s.gens.amel.id, piece, "fr");
    assert.equal(await compter(), avant);
  });
});
