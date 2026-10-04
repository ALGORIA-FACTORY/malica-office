/**
 * Une pièce photographiée part-elle au cabinet, ou reste-t-elle chez vous ?
 *
 * ============================================================ LES DEUX DÉFAUTS
 *
 * Le produit a connu les deux erreurs, dans cet ordre.
 *
 * D'abord : TOUT PARTAIT. La capture marquait « partage » d'office — un reçu
 * personnel, une photo ratée, un document sans rapport, tout arrivait chez
 * l'expert-comptable sans que personne l'ait décidé. Corrigé en capturant
 * « personnel », la transmission devenant un geste.
 *
 * Ensuite, le 4 octobre 2026 : RIEN NE PARTAIT. Première facture réelle
 * photographiée depuis le téléphone, et le cabinet ne la voyait pas. Le geste
 * existait, personne ne l'a fait — et rien à l'écran ne disait qu'il manquait.
 *
 * ===================================================================== LA RÈGLE
 *
 * Décidée après comparaison avec Dext, AutoEntry, Hubdoc et Pennylane : sous
 * MANDAT ACTIF, la pièce part au cabinet par défaut. C'est ce que fait le
 * métier, et c'est ce qu'attend quelqu'un qui photographie une facture pour
 * son comptable. Sans mandat, elle reste chez soi : il n'y a personne à qui
 * l'envoyer.
 *
 * Les deux garde-fous qui rendent ce défaut acceptable, et sans lesquels il ne
 * le serait pas :
 *   — l'écran DIT « transmise à [cabinet] » ;
 *   — un geste la retire, tant qu'elle n'est pas comptabilisée.
 */
import { describe, expect, it } from "vitest";

import { visibiliteALaCapture } from "../visibilite-a-la-capture";

describe("la visibilité d'une pièce à la capture", () => {
  it("part au cabinet quand un mandat est actif", () => {
    expect(visibiliteALaCapture({ mandatActif: true })).toBe("partage");
  });

  it("reste chez soi sans mandat : il n'y a personne à qui l'envoyer", () => {
    expect(visibiliteALaCapture({ mandatActif: false })).toBe("personnel");
  });

  it("reste chez soi tant qu'on ne sait pas s'il y a un mandat", () => {
    // Au chargement, la liste des mandats n'est pas encore là. Dans le doute,
    // on ne transmet pas : une pièce retenue se transmet d'un geste, une pièce
    // partie par erreur ne se reprend pas dans la tête de celui qui l'a lue.
    expect(visibiliteALaCapture({ mandatActif: undefined })).toBe("personnel");
  });
});
