// @vitest-environment jsdom
/**
 * Glisser et coller des fichiers sur l'écran d'ajout, au poste de bureau : les fichiers vont à
 * la coque ; un transfert sans fichier (du texte) reste au navigateur ; rien sous la largeur de
 * bureau ni hors de l'écran d'ajout.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDepotDeFichiers } from "../use-depot-de-fichiers";

function largeur(bureau: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: bureau,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as typeof window.matchMedia;
}

/** jsdom n'a pas de `DataTransfer` : la forme que le crochet lit suffit. */
function transfert(fichiers: File[]) {
  return { files: fichiers, types: fichiers.length > 0 ? ["Files"] : ["text/plain"] };
}

function evenement(type: "dragover" | "drop" | "paste", fichiers: File[]) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, type === "paste" ? "clipboardData" : "dataTransfer", {
    value: transfert(fichiers),
  });
  window.dispatchEvent(e);
  return e;
}

const facture = new File(["%PDF-"], "facture.pdf", { type: "application/pdf" });

afterEach(cleanup);

describe("useDepotDeFichiers", () => {
  it("un dépôt et un collage de fichiers vont à la coque", () => {
    largeur(true);
    const recus = vi.fn();
    renderHook(() => useDepotDeFichiers(true, recus));
    expect(evenement("dragover", [facture]).defaultPrevented).toBe(true);
    expect(evenement("drop", [facture]).defaultPrevented).toBe(true);
    expect(evenement("paste", [facture]).defaultPrevented).toBe(true);
    expect(recus).toHaveBeenCalledTimes(2);
    expect(recus).toHaveBeenLastCalledWith([facture]);
  });

  it("un collage de texte reste au navigateur", () => {
    largeur(true);
    const recus = vi.fn();
    renderHook(() => useDepotDeFichiers(true, recus));
    expect(evenement("paste", []).defaultPrevented).toBe(false);
    expect(evenement("dragover", []).defaultPrevented).toBe(false);
    expect(recus).not.toHaveBeenCalled();
  });

  it("rien sous la largeur de bureau, ni hors de l'écran d'ajout", () => {
    largeur(false);
    const telephone = vi.fn();
    renderHook(() => useDepotDeFichiers(true, telephone));
    evenement("drop", [facture]);
    expect(telephone).not.toHaveBeenCalled();
    cleanup();

    largeur(true);
    const ailleurs = vi.fn();
    renderHook(() => useDepotDeFichiers(false, ailleurs));
    evenement("paste", [facture]);
    expect(ailleurs).not.toHaveBeenCalled();
  });
});
