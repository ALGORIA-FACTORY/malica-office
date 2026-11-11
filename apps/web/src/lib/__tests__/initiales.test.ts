/**
 * Les initiales d'une personne — pour sa pastille, sans jamais rien rendre de vide.
 *
 * Garantit les initiales tirées d'une adresse e-mail, d'un mot seul ou d'un nom complet,
 * et le tiret « — » quand il n'y a rien à lire, pour que la pastille ne reste jamais
 * vide.
 */
import { describe, expect, it } from "vitest";

import { initialesDe } from "../initiales";

describe("initialesDe", () => {
  it("prend la première lettre des deux premiers morceaux d'une adresse", () => {
    expect(initialesDe("amine.bouzid@cabinet.tn")).toBe("AB");
    expect(initialesDe("leila_ben-salah@x.tn")).toBe("LB");
  });

  it("prend les deux premières lettres d'un seul mot", () => {
    expect(initialesDe("support@malica.tn")).toBe("SU");
    expect(initialesDe("dev")).toBe("DE");
  });

  it("marche sur un nom complet", () => {
    expect(initialesDe("Leïla Ben Salah")).toBe("LB");
  });

  it("ne rend jamais rien", () => {
    expect(initialesDe("")).toBe("—");
    expect(initialesDe("@malica.tn")).toBe("—");
  });
});
