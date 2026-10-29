/**
 * La machine à états de la file : chaque événement depuis chaque état.
 */
import { describe, expect, it } from "vitest";

import {
  delaiAvantEssai,
  estADeclencher,
  nouvelElement,
  repriseRefusee,
  transition,
  type ElementDeFile,
  type EtatElement,
} from "../file";

const T0 = Date.parse("2026-09-05T20:00:00Z");

function element(etat: EtatElement, extra: Partial<ElementDeFile> = {}): ElementDeFile {
  return {
    ...nouvelElement(
      {
        cle: "k",
        tenantId: "t",
        entityId: null,
        source: "photo",
        vis: "personnel",
        contentType: "application/pdf",
        nomFichier: "piece.pdf",
        taille: 1000,
      },
      T0,
    ),
    etat,
    pieceId: etat === "a_envoyer" ? null : "p1",
    ...extra,
  };
}

describe("les pas, dans l'ordre", () => {
  it("a_envoyer → enregistree → deposee → lecture_demandee, et pas de saut", () => {
    const a = element("a_envoyer");
    const b = transition(a, { type: "enregistree", pieceId: "p1" }, T0);
    expect(b).toMatchObject({ etat: "enregistree", pieceId: "p1" });
    const c = transition(b, { type: "deposee" }, T0);
    expect(c.etat).toBe("deposee");
    const d = transition(c, { type: "lecture_demandee" }, T0);
    expect(d.etat).toBe("lecture_demandee");

    // Un événement en retard ne fait ni avancer deux fois ni reculer.
    expect(transition(a, { type: "deposee" }, T0)).toBe(a);
    expect(transition(c, { type: "enregistree", pieceId: "p2" }, T0)).toBe(c);
    expect(transition(d, { type: "deposee" }, T0)).toBe(d);
  });
});

describe("les échecs", () => {
  it("un réseau absent recule l'élément avec un délai qui double, sans changer d'état", () => {
    let e = element("enregistree");
    e = transition(e, { type: "echec", nature: "reseau", message: "hors ligne" }, T0);
    expect(e).toMatchObject({ etat: "enregistree", tentatives: 1, derniereErreur: "hors ligne" });
    expect(Date.parse(e.prochainEssaiLe!) - T0).toBe(1000);
    e = transition(e, { type: "echec", nature: "serveur", message: "500" }, T0);
    expect(Date.parse(e.prochainEssaiLe!) - T0).toBe(2000);
    expect(estADeclencher(e, T0)).toBe(false);
    expect(estADeclencher(e, T0 + 2000)).toBe(true);
  });

  it("le délai plafonne à cinq minutes", () => {
    expect(delaiAvantEssai(1)).toBe(1000);
    expect(delaiAvantEssai(9)).toBe(256_000);
    expect(delaiAvantEssai(20)).toBe(300_000);
  });

  it("un refus de l'API est définitif : gardé, montré, jamais rejoué tout seul", () => {
    const e = transition(
      element("a_envoyer"),
      { type: "echec", nature: "refus", message: "pièce trop volumineuse" },
      T0,
    );
    expect(e).toMatchObject({ etat: "echec_definitif", derniereErreur: "pièce trop volumineuse" });
    expect(estADeclencher(e, T0 + 1e9)).toBe(false);
    // Un nouvel échec ne change rien ; « réessayer » remet à zéro.
    expect(transition(e, { type: "echec", nature: "reseau", message: "x" }, T0)).toBe(e);
    const r = transition(e, { type: "reessayer" }, T0);
    expect(r).toMatchObject({ etat: "a_envoyer", tentatives: 0, derniereErreur: null });
  });

  it("« réessayer » sur un élément reculé le rend immédiat, sans changer d'état", () => {
    const e = transition(element("deposee"), { type: "echec", nature: "reseau", message: "x" }, T0);
    const r = transition(e, { type: "reessayer" }, T0);
    expect(r).toMatchObject({ etat: "deposee", prochainEssaiLe: null, tentatives: 0 });
  });

  it("ce qui est parti ne bouge plus", () => {
    const e = element("lecture_demandee");
    expect(transition(e, { type: "echec", nature: "reseau", message: "x" }, T0)).toBe(e);
    expect(estADeclencher(e, T0)).toBe(false);
  });
});

describe("une reprise refusée", () => {
  const refusee = (message: string) =>
    element("echec_definitif", { remplace: "A", derniereErreur: message });

  it("se reconnaît à son code, et seulement sur une photo qui reprenait une pièce", () => {
    expect(repriseRefusee(refusee("refus.piece.remplacee"))).toBe(true);
    expect(repriseRefusee(refusee("refus.remplacement.inscrite"))).toBe(true);
    expect(repriseRefusee(refusee("refus.remplacement.introuvable"))).toBe(true);
    expect(repriseRefusee(refusee("pièce trop volumineuse"))).toBe(false);
    expect(
      repriseRefusee(element("echec_definitif", { derniereErreur: "refus.piece.remplacee" })),
    ).toBe(false);
    expect(repriseRefusee(element("a_envoyer", { remplace: "A" }))).toBe(false);
  });

  it("repart vers une autre cible — la version actuelle, ou aucune", () => {
    const vers = transition(refusee("refus.piece.remplacee"), { type: "recibler", remplace: "C" }, T0);
    expect(vers).toMatchObject({ etat: "a_envoyer", remplace: "C", derniereErreur: null });
    const libre = transition(refusee("refus.remplacement.inscrite"), { type: "recibler", remplace: null }, T0);
    expect(libre).toMatchObject({ etat: "a_envoyer", remplace: null, tentatives: 0 });
    // Hors d'un échec, rien ne bouge : on ne détourne pas un envoi en cours.
    const enCours = element("enregistree", { remplace: "A" });
    expect(transition(enCours, { type: "recibler", remplace: null }, T0)).toBe(enCours);
  });
});
