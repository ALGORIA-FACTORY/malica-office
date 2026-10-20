// @vitest-environment jsdom
/**
 * Plusieurs documents d'un coup.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « et l'upload plusieurs doc pdf ? »
 *
 * Deux défauts se cachaient derrière cette question, et le second était le
 * pire : l'entrée de fichiers n'avait pas l'attribut `multiple` — un document
 * à la fois, trente allers-retours pour un mois de retard — et AUCUN écran
 * n'appelait le chemin PDF. Un dirigeant qui reçoit ses factures par courriel
 * n'avait que l'appareil photo.
 *
 * Ces épreuves tiennent la capacité : ce que l'entrée déclare, et ce qu'elle
 * rend. L'écran, lui, est tenu par le bouton « Importer des PDF » de la liste.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { files } from "../files";

/** La dernière entrée fabriquée par la capacité, pour l'inspecter et la jouer. */
let derniere: HTMLInputElement | null = null;

beforeEach(() => {
  derniere = null;
  const vrai = document.createElement.bind(document);
  document.createElement = ((nom: string) => {
    const el = vrai(nom);
    if (nom === "input") {
      derniere = el as HTMLInputElement;
      // jsdom ne clique pas sur un sélecteur de fichiers : on neutralise le
      // clic et c'est l'épreuve qui déclenche `onchange`.
      (el as HTMLInputElement).click = () => undefined;
    }
    return el;
  }) as typeof document.createElement;
});

/** Pose une liste de fichiers sur l'entrée, puis déclenche son `onchange`. */
function choisit(entree: HTMLInputElement, ...noms: string[]) {
  Object.defineProperty(entree, "files", {
    value: noms.map(
      (nom) =>
        new File([new Uint8Array([37, 80, 68, 70])], nom, {
          type: "application/pdf",
        }),
    ),
    configurable: true,
  });
  entree.onchange?.(new Event("change"));
}

describe("choisir des fichiers", () => {
  it("l'entrée des PDF accepte PLUSIEURS fichiers", async () => {
    // Sans cet attribut, le navigateur n'en laisse choisir qu'un, et rien à
    // l'écran ne dit pourquoi les vingt-neuf autres n'ont pas suivi.
    const promesse = files.pickPdfs();
    expect(derniere!.multiple).toBe(true);
    expect(derniere!.accept).toBe("application/pdf");
    choisit(derniere!, "mars.pdf", "avril.pdf", "mai.pdf");
    await promesse;
  });

  it("et rend une pièce par fichier choisi, dans l'ordre", async () => {
    const promesse = files.pickPdfs();
    choisit(derniere!, "mars.pdf", "avril.pdf", "mai.pdf");
    const lot = await promesse;
    expect(lot.map((p) => p.name)).toEqual(["mars.pdf", "avril.pdf", "mai.pdf"]);
    expect(lot.every((p) => p.source === "pdf")).toBe(true);
  });

  it("un seul fichier reste un lot d'un seul, pas un cas à part", async () => {
    // C'est ce qui permet au reste de l'application de n'avoir qu'un chemin :
    // un tableau d'un élément se traite comme un tableau de trente.
    const promesse = files.pickPdfs();
    choisit(derniere!, "une-seule.pdf");
    expect(await promesse).toHaveLength(1);
  });

  it("un fichier qui n'est pas un PDF est refusé, et nommé", async () => {
    // Recette du 20 octobre 2026 : un .txt renommé entrait comme une facture.
    const promesse = files.pickPdfs();
    Object.defineProperty(derniere!, "files", {
      value: [
        new File([new Uint8Array([37, 80, 68, 70])], "vraie.pdf", { type: "application/pdf" }),
        new File(["Bonjour, ceci est un texte"], "faux.pdf", { type: "application/pdf" }),
      ],
      configurable: true,
    });
    derniere!.onchange?.(new Event("change"));
    await expect(promesse).rejects.toMatchObject({ name: "FichierNonPdf", noms: ["faux.pdf"] });
  });

  it("une annulation ne rend rien, et ce n'est pas une panne", async () => {
    const promesse = files.pickPdfs();
    derniere!.oncancel?.(new Event("cancel"));
    expect(await promesse).toEqual([]);
  });

  it("la PHOTO, elle, reste unitaire", async () => {
    // On ne prend pas deux photos à la fois, et les pages d'UNE pièce ont
    // déjà leur chemin : les confondre ferait d'un document de cinq pages
    // cinq pièces à rapprocher à la main.
    const promesse = files.takePhoto();
    expect(derniere!.multiple).toBe(false);
    expect(derniere!.getAttribute("capture")).toBe("environment");
    derniere!.oncancel?.(new Event("cancel"));
    expect(await promesse).toEqual([]);
  });
});
