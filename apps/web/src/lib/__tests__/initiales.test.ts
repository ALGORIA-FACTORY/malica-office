import { describe, expect, it } from "vitest";

import { initialesDe } from "../initiales";

describe("initialesDe", () => {
  it("prend la première lettre des deux premiers morceaux d'une adresse", () => {
    expect(initialesDe("amine.bouzid@cabinet.tn")).toBe("AB");
    expect(initialesDe("leila_ben-salah@x.tn")).toBe("LB");
  });

  it("prend les deux premières lettres d'un seul mot", () => {
    expect(initialesDe("support@regalica.tn")).toBe("SU");
    expect(initialesDe("dev")).toBe("DE");
  });

  it("marche sur un nom complet", () => {
    expect(initialesDe("Leïla Ben Salah")).toBe("LB");
  });

  it("ne rend jamais rien", () => {
    expect(initialesDe("")).toBe("—");
    expect(initialesDe("@regalica.tn")).toBe("—");
  });
});
