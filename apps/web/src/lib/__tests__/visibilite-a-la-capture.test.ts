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

import { lectureInterdite, visibiliteALaCapture } from "../visibilite-a-la-capture";

describe("la visibilité d'une pièce à la capture", () => {
  /**
   * ============================================ LE TROISIÈME ÉTAT, ET POURQUOI
   *
   * 7 octobre 2026. Une facture d'achat de SUARL CASA-ELECT est lue « facture
   * de vente », rejetée parce que l'émetteur n'est pas ALGORIA — et elle est
   * DÉJÀ partie au cabinet, marquée « partage » à la photo.
   *
   * Le défaut n'est pas le rejet : c'est d'avoir transmis AVANT de savoir. Une
   * pièce partagée à la photo est partagée avant d'être lue, donc avant que son
   * verdict, son sens et ses montants existent. Il n'y a eu aucun instant où
   * quelqu'un a pu décider.
   *
   * Le mandat ne décide donc plus de la visibilité. Il décide s'il y a
   * QUELQU'UN à qui envoyer — ce que l'écran de vérification lit lui-même, et
   * c'est lui qui pose la question.
   */
  it("reste chez soi, mandat actif ou non : rien ne part avant d'être lu", () => {
    expect(visibiliteALaCapture({ mandatActif: true })).toBe("personnel");
    expect(visibiliteALaCapture({ mandatActif: false })).toBe("personnel");
  });

  it("reste chez soi tant qu'on ne sait pas s'il y a un mandat", () => {
    // Au chargement, la liste des mandats n'est pas encore là. Dans le doute,
    // on ne transmet pas : une pièce retenue se transmet d'un geste, une pièce
    // partie par erreur ne se reprend pas dans la tête de celui qui l'a lue.
    expect(visibiliteALaCapture({ mandatActif: undefined })).toBe("personnel");
  });

  it("aucune entrée ne fait partir une pièce : la fonction n'a plus de porte", () => {
    /*
     * Assertion volontairement exhaustive. La règle a changé trois fois en six
     * semaines, et chaque fois le défaut venait d'un chemin qu'on n'avait pas
     * regardé. Tant que la transmission est une RÉPONSE, aucune entrée de cette
     * fonction ne doit pouvoir rendre « partage ».
     */
    for (const mandatActif of [true, false, undefined]) {
      expect(visibiliteALaCapture({ mandatActif })).not.toBe("partage");
    }
  });
});

describe("ce que la visibilité interdit", () => {
  /*
   * 18 octobre 2026, mesuré : 30 pièces photographiées, 0 lue. La règle de
   * capture et celle de lecture sont la même phrase lue dans les deux sens —
   * ce qui naît chez soi ne se lit pas chez soi —, et elles vivent donc dans
   * le même fichier.
   *
   * `public.lecture_autorisee` refuse toute pièce `personnel` (B6). La file
   * demandait quand même, et récoltait un refus par pièce au journal d'audit.
   */
  it("une pièce de l'espace privé ne se lit pas, et on ne le demande donc pas", () => {
    expect(lectureInterdite("personnel")).toBe(true);
  });

  it("la bibliothèque de la société et le cabinet se lisent", () => {
    expect(lectureInterdite("entite")).toBe(false);
    expect(lectureInterdite("partage")).toBe(false);
  });

  it("ce que la capture produit est exactement ce que la lecture refuse", () => {
    // Si l'une des deux change sans l'autre, ce cas tombe — et c'est le but :
    // la boucle « né personnel, jamais lu » s'est refermée une fois déjà.
    expect(lectureInterdite(visibiliteALaCapture({ mandatActif: true }))).toBe(true);
  });
});
