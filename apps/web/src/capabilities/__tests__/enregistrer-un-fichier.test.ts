// @vitest-environment jsdom
/**
 * Remettre un fichier ne perd jamais un fichier (revue Codex de #146).
 *
 * Dans la coque native, deux pièces de même société, même jour, même type
 * recevaient le même nom : la seconde écrasait la première, et le lot disait
 * « téléchargé ». Le nom porte désormais l'identifiant de la pièce, et
 * l'écriture native n'écrase jamais un fichier déjà là.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disque = vi.hoisted(() => new Map<string, string>());

vi.mock("../coque", () => ({ estNatif: () => true }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Documents: "DOCUMENTS" },
  Filesystem: {
    stat: async ({ path }: { path: string }) => {
      if (!disque.has(path)) throw new Error("File does not exist");
      return { uri: `file:///docs/${path}` };
    },
    // Comme Capacitor : écrire sur un nom pris l'ÉCRASE.
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      disque.set(path, data);
      return { uri: `file:///docs/${path}` };
    },
  },
}));

import { nomDeFichierDePiece } from "@/lib/nom-de-fichier";

import { enregistrerUnFichier } from "../enregistrer-un-fichier";

const pdf = (texte: string) => new Blob([texte], { type: "application/pdf" });

describe("remettre un fichier dans la coque native", () => {
  beforeEach(() => disque.clear());
  afterEach(() => vi.clearAllMocks());

  it("deux PDF de même société, même jour, même type donnent deux fichiers", async () => {
    const noms = ["p1", "p2"].map((id) =>
      nomDeFichierDePiece("SOCIETE ESSAI 2026-10-20", id, "application/pdf"),
    );
    expect(new Set(noms).size).toBe(2);
    const a = await enregistrerUnFichier(pdf("un"), noms[0]!);
    const b = await enregistrerUnFichier(pdf("deux"), noms[1]!);
    expect(a.chemin).not.toBe(b.chemin);
    expect(disque.size).toBe(2);
  });

  it("un nom déjà pris n'est jamais écrasé : le second reçoit un nom libre", async () => {
    const a = await enregistrerUnFichier(pdf("un"), "releve.pdf");
    const b = await enregistrerUnFichier(pdf("deux"), "releve.pdf");
    expect(a.chemin).toBe("file:///docs/releve.pdf");
    expect(b.chemin).toBe("file:///docs/releve (2).pdf");
    expect(disque.size).toBe(2);
  });
});
