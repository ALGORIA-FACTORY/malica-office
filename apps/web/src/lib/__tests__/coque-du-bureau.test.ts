// @vitest-environment jsdom
/**
 * La coque de bureau : la rubrique du fil d'Ariane, et les deux raccourcis N et M, qui se
 * taisent dès que la lettre est du texte (un champ, une fenêtre ouverte par-dessus).
 */
import { describe, expect, it } from "vitest";

import {
  lettreDuRaccourci,
  raccourciDuBureau,
  rubriqueDuChemin,
  type ToucheEnfoncee,
} from "../coque-du-bureau";

function touche(code: string, autre: Partial<ToucheEnfoncee> = {}): ToucheEnfoncee {
  return {
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: document.body,
    ...autre,
  };
}

describe("la rubrique du fil d'Ariane", () => {
  it.each([
    ["/pme", "societe"],
    ["/pme/tva", "societe"],
    ["/pme/charges", "societe"],
    ["/pme/list", "bibliotheque"],
    ["/pme/dossier/achats", "bibliotheque"],
    ["/pme/piece/42", "bibliotheque"],
    ["/pme/echeances", "echeances"],
    ["/pme/coffre", "prive"],
    ["/pme/reglages", "reglages"],
    ["/pme/malica", "malica"],
  ])("%s → %s", (chemin, rubrique) => {
    expect(rubriqueDuChemin(chemin)).toBe(rubrique);
  });
});

describe("les raccourcis du bureau", () => {
  it("N ajoute une pièce, M ouvre Malica", () => {
    expect(raccourciDuBureau(touche("KeyN"))).toBe("ajouter");
    expect(raccourciDuBureau(touche("KeyM"))).toBe("malica");
    expect(raccourciDuBureau(touche("KeyB"))).toBeNull();
  });

  it("se lit par la position de la touche : la même sur un clavier arabe", () => {
    expect(lettreDuRaccourci("ajouter")).toBe("N");
    expect(lettreDuRaccourci("malica")).toBe("M");
  });

  it("se tait quand le focus est dans un champ", () => {
    for (const balise of ["input", "textarea", "select"]) {
      const champ = document.createElement(balise);
      document.body.append(champ);
      expect(raccourciDuBureau(touche("KeyN", { target: champ }))).toBeNull();
      champ.remove();
    }
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const dedans = document.createElement("span");
    editable.append(dedans);
    document.body.append(editable);
    expect(raccourciDuBureau(touche("KeyM", { target: dedans }))).toBeNull();
    editable.remove();
  });

  it("se tait dans une fenêtre ouverte par-dessus l'écran", () => {
    const fenetre = document.createElement("div");
    fenetre.setAttribute("role", "dialog");
    const bouton = document.createElement("button");
    fenetre.append(bouton);
    document.body.append(fenetre);
    expect(raccourciDuBureau(touche("KeyN", { target: bouton }))).toBeNull();
    fenetre.remove();
  });

  it("laisse au navigateur les combinaisons, la répétition et la composition", () => {
    expect(raccourciDuBureau(touche("KeyN", { metaKey: true }))).toBeNull();
    expect(raccourciDuBureau(touche("KeyN", { ctrlKey: true }))).toBeNull();
    expect(raccourciDuBureau(touche("KeyN", { altKey: true }))).toBeNull();
    expect(raccourciDuBureau(touche("KeyN", { shiftKey: true }))).toBeNull();
    expect(raccourciDuBureau(touche("KeyN", { repeat: true }))).toBeNull();
    expect(raccourciDuBureau(touche("KeyN", { isComposing: true }))).toBeNull();
    expect(raccourciDuBureau(touche("KeyN", { defaultPrevented: true }))).toBeNull();
  });
});
