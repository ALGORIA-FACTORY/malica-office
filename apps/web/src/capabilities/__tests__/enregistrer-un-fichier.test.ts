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

const natif = vi.hoisted(() => ({ oui: true }));
const disque = vi.hoisted(() => new Map<string, string>());

vi.mock("../coque", () => ({ estNatif: () => natif.oui }));
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
  beforeEach(() => {
    disque.clear();
    natif.oui = true;
  });
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

/*
 * Revue Codex de #146 : un libellé de 64 caractères, plus l'identifiant et
 * « .pdf », dépassait 100 caractères ; le second nettoyage, à la remise,
 * tronquait l'identifiant et l'extension.
 */
describe("un libellé long garde l'identifiant et l'extension", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const LONG = "SOCIETE AU NOM TRES LONG ET DETAILLE SARL ".repeat(5);

  beforeEach(() => {
    disque.clear();
    natif.oui = true;
  });

  it("le nom de la pièce tient dans la limite, identifiant et extension compris", () => {
    for (const libelle of [LONG.slice(0, 64), LONG]) {
      const nom = nomDeFichierDePiece(libelle, ID, "application/pdf");
      expect(nom.endsWith(`_${ID}.pdf`)).toBe(true);
      expect(nom.length).toBeLessThanOrEqual(100);
    }
  });

  it("dans la coque native, le fichier écrit garde « .pdf » et l'identifiant", async () => {
    const nom = nomDeFichierDePiece(LONG.slice(0, 64), ID, "application/pdf");
    const { chemin } = await enregistrerUnFichier(pdf("un"), nom);
    expect(chemin).toBe(`file:///docs/${nom}`);
  });

  it("dans le navigateur, le lien de téléchargement garde « .pdf » et l'identifiant", async () => {
    natif.oui = false;
    URL.createObjectURL = vi.fn(() => "blob:essai");
    URL.revokeObjectURL = vi.fn();
    let telecharge = "";
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      telecharge = this.download;
    });
    const nom = nomDeFichierDePiece(LONG, ID, "application/pdf");
    await enregistrerUnFichier(pdf("un"), nom);
    expect(telecharge).toBe(nom);
    expect(telecharge.endsWith(`_${ID}.pdf`)).toBe(true);
    clic.mockRestore();
  });

  it("un nom trop long qui n'est pas celui d'une pièce garde son extension", async () => {
    natif.oui = true;
    const { chemin } = await enregistrerUnFichier(pdf("un"), `${LONG}${LONG}.zip`);
    expect(chemin?.endsWith(".zip")).toBe(true);
    expect(chemin!.slice("file:///docs/".length).length).toBeLessThanOrEqual(100);
  });
});
