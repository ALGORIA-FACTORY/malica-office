import { describe, expect, it } from "vitest";

import { fichierDuJournal, jourLisible, jourVoisin } from "../journal-du-jour";

describe("le journal du jour, côté écran", () => {
  it("recule et avance d'un jour, mois et années compris", () => {
    expect(jourVoisin("2026-03-01", -1)).toBe("2026-02-28");
    expect(jourVoisin("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("ne lit dans l'adresse qu'un vrai jour", () => {
    expect(jourLisible("2026-10-28")).toBe("2026-10-28");
    expect(jourLisible("2026-02-30")).toBeUndefined();
    expect(jourLisible("28/10/2026")).toBeUndefined();
    expect(jourLisible(20261028)).toBeUndefined();
  });

  it("rend les octets d'un classeur tels que l'API les a encodés", async () => {
    const octets = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]);
    const blob = fichierDuJournal({
      contenu: btoa(String.fromCharCode(...octets)),
      encodage: "base64",
      typeMime: "application/octet-stream",
    });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(octets);
    const texte = fichierDuJournal({ contenu: "a;b", encodage: "utf8", typeMime: "text/csv" });
    expect(await texte.text()).toBe("a;b");
  });
});
