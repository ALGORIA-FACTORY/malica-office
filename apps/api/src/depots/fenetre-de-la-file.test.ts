/**
 * La file du cabinet ne coupe jamais ce qui attend le cabinet.
 *
 * Audit du 10 novembre 2026 : la file gardait les 200 pièces les plus
 * récentes, tous statuts confondus. Une pièce reçue et jamais traitée en
 * sortait dès que 200 pièces plus récentes étaient prises en charge.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StatutCabinet } from "@malica/socle/statut-d-envoi";

import { FENETRE_DU_PASSE, retenirPourLaFile, type PieceTransmise } from "./fenetre-de-la-file.ts";

const piece = (id: string, statut: StatutCabinet, demandeEnAttente = false): PieceTransmise => ({
  id,
  statut,
  demandeEnAttente,
});

describe("ce que la file du cabinet retient", () => {
  it("une pièce à traiter reste, même derrière plus de pièces traitées que la fenêtre", () => {
    const traitees = Array.from({ length: 5 }, (_, i) => piece(`v${i}`, "validee"));
    const retenues = retenirPourLaFile(
      [...traitees, piece("ancienne-recue", "recue"), piece("ancienne-vue", "vue")],
      2,
    );
    assert.deepEqual(retenues, ["v0", "v1", "ancienne-recue", "ancienne-vue"]);
  });

  it("chaque statut à traiter est gardé sans limite : reçue, vue, corrigée", () => {
    const aTraiter = (["recue", "vue", "corrigee"] as const).flatMap((s) =>
      Array.from({ length: 4 }, (_, i) => piece(`${s}${i}`, s)),
    );
    assert.equal(retenirPourLaFile(aTraiter, 1).length, aTraiter.length);
  });

  it("une demande en attente garde la pièce, quel que soit son statut", () => {
    const retenues = retenirPourLaFile(
      [
        piece("v0", "validee"),
        piece("v1", "forcee"),
        piece("demandee", "validee", true),
        piece("retournee-demandee", "retournee", true),
      ],
      1,
    );
    assert.deepEqual(retenues, ["v0", "demandee", "retournee-demandee"]);
  });

  it("le passé est une fenêtre : les plus récentes de ce qui n'attend plus", () => {
    const passe = [
      piece("r0", "retournee"),
      piece("v0", "validee"),
      piece("f0", "forcee"),
      piece("v1", "validee"),
    ];
    assert.deepEqual(retenirPourLaFile(passe, 3), ["r0", "v0", "f0"]);
    assert.deepEqual(retenirPourLaFile(passe, 0), []);
  });

  it("sans fenêtre dite, c'est celle de la file", () => {
    const passe = Array.from({ length: FENETRE_DU_PASSE + 3 }, (_, i) => piece(`v${i}`, "validee"));
    assert.equal(retenirPourLaFile(passe).length, FENETRE_DU_PASSE);
  });
});
