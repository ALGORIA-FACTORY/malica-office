import { describe, expect, it, vi } from "vitest";

import { creerLotDAppels } from "../lot-d-appels";

/*
 * Cent sociétés demandées dans le même instant = UN appel au réseau. Une
 * seule = l'appel d'avant, inchangé. Un échec ne laisse aucune attente
 * pendante, et chaque clé reçoit SA valeur.
 */
function banc(taille = 200) {
  const une = vi.fn(async (cle: string) => [`seule:${cle}`]);
  const plusieurs = vi.fn(
    async (cles: string[]) => new Map(cles.map((c) => [c, [`lot:${c}`]] as const)),
  );
  const charger = creerLotDAppels<string[]>({ une, plusieurs, taille, absente: [] });
  return { une, plusieurs, charger };
}

describe("les lectures nées ensemble partent ensemble", () => {
  it("cent clés du même instant : un seul appel, chaque clé sa valeur", async () => {
    const { une, plusieurs, charger } = banc();
    const cles = Array.from({ length: 100 }, (_, i) => `s${i}`);
    const valeurs = await Promise.all(cles.map(charger));
    expect(plusieurs).toHaveBeenCalledTimes(1);
    expect(une).not.toHaveBeenCalled();
    expect(valeurs[0]).toEqual(["lot:s0"]);
    expect(valeurs[99]).toEqual(["lot:s99"]);
  });

  it("une seule clé garde l'appel d'avant", async () => {
    const { une, plusieurs, charger } = banc();
    expect(await charger("a")).toEqual(["seule:a"]);
    expect(une).toHaveBeenCalledTimes(1);
    expect(plusieurs).not.toHaveBeenCalled();
  });

  it("la même clé demandée deux fois n'est envoyée qu'une fois", async () => {
    const { plusieurs, charger } = banc();
    const [a, b, c] = await Promise.all([charger("a"), charger("a"), charger("b")]);
    expect(plusieurs).toHaveBeenCalledWith(["a", "b"]);
    expect(a).toEqual(b);
    expect(c).toEqual(["lot:b"]);
  });

  it("au-delà de la borne du serveur, le lot se coupe en tranches", async () => {
    const { plusieurs, charger } = banc(2);
    await Promise.all(["a", "b", "c", "d", "e"].map(charger));
    expect(plusieurs.mock.calls.map(([c]) => c)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("une clé que l'appel groupé n'a pas rendue reçoit la valeur vide", async () => {
    const plusieurs = vi.fn(async () => new Map([["a", ["x"]]]));
    const charger = creerLotDAppels<string[]>({
      une: async () => [],
      plusieurs,
      taille: 10,
      absente: [],
    });
    const [a, b] = await Promise.all([charger("a"), charger("b")]);
    expect(a).toEqual(["x"]);
    expect(b).toEqual([]);
  });

  it("un échec rejette chaque attente de la tranche, sans en oublier", async () => {
    const charger = creerLotDAppels<string[]>({
      une: async () => [],
      plusieurs: async () => {
        throw new Error("panne");
      },
      taille: 10,
      absente: [],
    });
    const issues = await Promise.allSettled([charger("a"), charger("b"), charger("a")]);
    expect(issues.every((i) => i.status === "rejected")).toBe(true);
  });

  it("un appel plus tard ouvre un nouveau lot", async () => {
    const { une, plusieurs, charger } = banc();
    await Promise.all([charger("a"), charger("b")]);
    await charger("c");
    expect(plusieurs).toHaveBeenCalledTimes(1);
    expect(une).toHaveBeenCalledWith("c");
  });
});
