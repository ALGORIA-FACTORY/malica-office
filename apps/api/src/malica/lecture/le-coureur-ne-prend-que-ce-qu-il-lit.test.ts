/**
 * Le coureur ne prend que ce que son appelant peut lire (constat B.0 de la
 * passe de nuit, 2 novembre 2026) — reproduit d'abord, sur la vraie base.
 *
 * LE CONSTAT. Le coureur fait tourner la file du DOSSIER sous l'identité de
 * celui qui vient de déposer. Or `app.piece_lisible` n'ouvre une pièce
 * `personnel` qu'à son auteur, et une pièce `entite` qu'à son auteur ou à qui
 * a `societe.tout_voir`. Scénario : Sami (collaborateur) dépose une pièce
 * personnelle ; Sonia (collaboratrice, sans `tout_voir`) dépose à son tour, et
 * son coureur prend le travail de Sami — qu'elle ne peut pas lire. La
 * tentative est brûlée sur un refus, et le travail finit mort.
 *
 * Deux natures sont exposées : la lecture (`lecture_piece`) et la relecture
 * (`relecture_piece`). La relecture sort du coureur des membres (passe de
 * nuit, décision 4) ; la lecture est corrigée en base : `travail_prendre` ne
 * rend qu'un travail dont la pièce est lisible par l'appelant.
 *
 *   node --experimental-strip-types --test src/malica/lecture/le-coureur-ne-prend-que-ce-qu-il-lit.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "../../circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../../db.ts";
import { parametrage } from "../../depots/parametrage.ts";
import { executerUnTravail } from "../../fabrique/travaux-execution.ts";
import { enregistrerTravail, type NatureDeTravail } from "../../fabrique/travaux.ts";
import { creerAppelLocal } from "../appel-local.ts";

import { naturesDuCoureur } from "./coureur.ts";
import { readPieceFlow, relirePiece } from "./read-flow.ts";

/** Aucun modèle ne doit être appelé : la pièce n'est pas à Sonia. */
const SANS_MODELE = {
  lire: async () => {
    throw new Error("appel de modèle imprévu");
  },
  secondLecteurDisponible: () => true,
};

describe(
  "le coureur ne prend que ce que son appelant peut lire",
  { skip: !BASE_CONFIGUREE },
  () => {
    let s: SocieteDEssai;

    before(async () => {
      s = await monterUneSociete(`coureur-${Date.now()}`);
      const jour = (
        await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
          parametrage.fuseauDuCabinet(db, s.cabinet),
        )
      ).aujourdhui!;
      // La relecture de nuit active, due tout de suite.
      await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        parametrage.arreterReglagesComptables(db, {
          cabinetId: s.cabinet,
          portee: "dossier",
          porteeId: s.pme,
          packId: s.pack,
          depuis: jour,
          valeurs: [
            { code: "lecture.relecture_nuit", valeur: "active" },
            { code: "lecture.relecture_delai_heures", valeur: "0.000001" },
          ],
        }),
      );
    });

    after(async () => {
      try {
        await s?.fermer();
      } finally {
        await fermerLePool();
      }
    });

    /** Le tour que ferait le coureur de Sonia, avec les natures qu'il prend. */
    const tourDeSonia = (natures: readonly NatureDeTravail[]) =>
      executerUnTravail(
        (travail) => sousIdentiteDuServeur(s.gens.sonia.id, travail),
        s.pme,
        natures,
        async (t) =>
          t.nature === "relecture_piece"
            ? relirePiece(
                creerAppelLocal((x) => sousIdentite(s.gens.sonia.id, x)),
                t,
                SANS_MODELE,
              )
            : void (await readPieceFlow(
                creerAppelLocal((x) => sousIdentite(s.gens.sonia.id, x)),
                t.pieceId,
                SANS_MODELE,
              )),
      );

    const etat = async (travailId: string) =>
      (
        await s.admin.query<{ etat: string; tentatives: number }>(
          `select etat, tentatives from fabrique.etat_des_travaux_v where travail_id = $1`,
          [travailId],
        )
      ).rows[0];

    it("la lecture d'une pièce personnelle de Sami n'est pas prise par le coureur de Sonia", async () => {
      const piece = await s.deposer("sami", "personnel");
      const { travailId } = await sousIdentiteDuServeur(s.gens.sami.id, (db) =>
        enregistrerTravail(db, {
          tenantId: s.pme,
          pieceId: piece,
          nature: "lecture_piece",
          cleIdempotence: `lecture_piece:${piece}`,
        }),
      );

      const fait = await tourDeSonia(["lecture_piece"]);

      assert.equal(fait, null, "Sonia ne prend pas une lecture qu'elle ne peut pas faire");
      assert.deepEqual(await etat(travailId), { etat: "a_faire", tentatives: 0 });
    });

    it("la relecture d'une pièce personnelle de Sami n'est pas prise par le coureur de Sonia", async () => {
      const piece = await s.deposer("sami", "personnel");
      await s.lire("sami", piece);
      const { rows } = await sousIdentiteDuServeur(s.gens.sami.id, (db) =>
        db.query<{ r: { travail_id: string } }>(
          `select fabrique.relecture_inscrire($1, '{"lecteur":"vision","paddleTente":false}') as r`,
          [piece],
        ),
      );
      const travailId = rows[0]!.r.travail_id;

      const fait = await tourDeSonia(["relecture_piece"]);

      assert.equal(fait, null, "Sonia ne prend pas une relecture qu'elle ne peut pas faire");
      assert.deepEqual(await etat(travailId), { etat: "a_faire", tentatives: 0 });
    });

    it("le coureur des membres ne prend plus de relecture : elle est à la passe de nuit", () => {
      assert.ok(!naturesDuCoureur({}).includes("relecture_piece"));
      assert.ok(!naturesDuCoureur({ DEEPSEEK_API_KEY: "x" }).includes("relecture_piece"));
      assert.ok(naturesDuCoureur({}).includes("lecture_piece"));
    });

    it("Sami, lui, prend la lecture de sa pièce", async () => {
      const piece = await s.deposer("sami", "personnel");
      await sousIdentiteDuServeur(s.gens.sami.id, (db) =>
        enregistrerTravail(db, {
          tenantId: s.pme,
          pieceId: piece,
          nature: "lecture_piece",
          cleIdempotence: `lecture_piece:${piece}`,
        }),
      );
      const pris = await sousIdentiteDuServeur(s.gens.sami.id, async (db) => {
        const { rows } = await db.query<{ piece_id: string }>(
          `select piece_id from fabrique.travail_prendre($1, array['lecture_piece']::fabrique.travail_nature_t[])`,
          [s.pme],
        );
        return rows.map((r) => r.piece_id);
      });
      assert.ok(pris.length === 1, "il en prend une");
    });
  },
);
