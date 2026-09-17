// @vitest-environment jsdom
/**
 * Le fil de Malica, refermé, ne se rouvre pas au montage suivant.
 *
 * Le choix « fermé » est retenu dans le navigateur. L'accueil qui se remonte —
 * au retour d'un autre écran — doit le respecter dès le PREMIER rendu posé dans
 * le DOM : un fil peint ouvert, même le temps d'un effet, recouvre l'écran d'un
 * téléphone lent, et le doigt qui tape à ce moment-là tape dans le fil.
 *
 * On relève la valeur de `ouvert` à chaque rendu validé (useLayoutEffect : après
 * l'écriture du DOM, avant la peinture) — c'est ce qui peut se voir à l'écran.
 */
import { cleanup, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePanneauMalica } from "../panneau-malica";

function Temoin({ releves }: { releves: boolean[] }) {
  const { ouvert } = usePanneauMalica("pme");
  useLayoutEffect(() => {
    releves.push(ouvert);
  });
  return null;
}

describe("le fil de Malica au montage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it("refermé, il n'est jamais posé ouvert dans le DOM", () => {
    window.localStorage.setItem("malica.panneau.ouvert.pme", "0");
    const releves: boolean[] = [];
    render(<Temoin releves={releves} />);
    expect(releves.length).toBeGreaterThan(0);
    expect(releves).not.toContain(true);
  });

  it("sans choix retenu, il s'ouvre : un assistant qu'il faut découvrir n'assiste personne", () => {
    const releves: boolean[] = [];
    render(<Temoin releves={releves} />);
    expect(releves.at(-1)).toBe(true);
  });

  it("ouvert par choix, il reste ouvert", () => {
    window.localStorage.setItem("malica.panneau.ouvert.pme", "1");
    const releves: boolean[] = [];
    render(<Temoin releves={releves} />);
    expect(releves.at(-1)).toBe(true);
  });
});
