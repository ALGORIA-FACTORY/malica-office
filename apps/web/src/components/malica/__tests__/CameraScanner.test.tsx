// @vitest-environment jsdom
/**
 * L'écran de capture, dans un navigateur simulé.
 *
 * ============================================================== POURQUOI
 *
 * Après une photo, l'aperçu remplace toute la vue — `<video>` compris. Quand
 * la personne tape « Reprendre », un `<video>` NEUF revient. Le flux caméra,
 * lui, n'avait été posé qu'une seule fois, au montage : l'élément neuf restait
 * noir, et plus aucune photo n'était possible. Aucune exception ; le journal
 * d'atelier restait vide ; seul un téléphone le voyait.
 *
 * Cette épreuve rejoue le geste complet — flux, prise automatique, aperçu,
 * « Reprendre », nouvelle prise — et vérifie que le flux suit l'élément.
 *
 * ================================================ CE QUI EST SIMULÉ, ET POURQUOI
 *
 * jsdom n'a ni caméra, ni canvas, ni décodeur d'image. On simule donc ce
 * que le navigateur fournit (`getUserMedia`, `play`, les dimensions de la
 * vidéo, le contexte 2D, `toBlob`) et ce que le détecteur rend (`cadrer`,
 * `analyzeFrame`, `preparePage`). Tout le reste — l'état, la boucle
 * d'analyse, la prise automatique, l'aperçu, les boutons — est le vrai code.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

import { CameraScanner } from "../CameraScanner";

const { noterAuJournal } = vi.hoisted(() => ({ noterAuJournal: vi.fn() }));

vi.mock("@/lib/journal-atelier", () => ({
  noterAuJournal: (...args: unknown[]) => noterAuJournal(...args),
  installerJournalAtelier: () => undefined,
}));

vi.mock("@/capabilities/cadrage", () => ({
  cadrer: vi.fn(async () => ({ coins: null, certitude: 0.9, origine: "modele" })),
}));

vi.mock("@/capabilities/scanner", () => ({
  analyzeFrame: vi.fn(() => ({
    quad: null,
    coverage: 0.6,
    sharpness: 1,
    inkRatio: 0.1,
    blank: false,
    petitCotePx: 800,
    ok: true,
    reason: "ok",
  })),
  preparePage: vi.fn(async () => ({
    jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
    cropped: true,
    cadrage: { coins: null, certitude: 0.9, origine: "modele" },
  })),
}));

/** Un flux caméra : ce que le composant en touche, et rien de plus. */
function fluxFactice(): MediaStream {
  return { getTracks: () => [{ stop: () => undefined }] } as unknown as MediaStream;
}

/** Un contexte 2D qui accepte tout et ne dessine rien. */
function contexteFactice(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_cible, cle) => {
      if (cle === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        });
      }
      return () => undefined;
    },
    set: () => true,
  });
}

const restaurations: Array<() => void> = [];

function definir<T extends object>(cible: T, cle: PropertyKey, descripteur: PropertyDescriptor) {
  const avant = Object.getOwnPropertyDescriptor(cible, cle);
  Object.defineProperty(cible, cle, { ...descripteur, configurable: true });
  restaurations.push(() => {
    if (avant) Object.defineProperty(cible, cle, avant);
    else delete (cible as Record<PropertyKey, unknown>)[cle];
  });
}

let flux: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  flux = fluxFactice();
  getUserMedia = vi.fn(async () => flux);
  noterAuJournal.mockClear();

  definir(window, "isSecureContext", { value: true });
  definir(navigator, "mediaDevices", { value: { getUserMedia } });
  definir(HTMLMediaElement.prototype, "play", { value: async () => undefined });
  definir(HTMLVideoElement.prototype, "readyState", { get: () => 4 });
  definir(HTMLVideoElement.prototype, "videoWidth", { get: () => 640 });
  definir(HTMLVideoElement.prototype, "videoHeight", { get: () => 480 });
  definir(HTMLCanvasElement.prototype, "getContext", { value: () => contexteFactice() });
  definir(HTMLCanvasElement.prototype, "toBlob", {
    value: (cb: BlobCallback) => cb(new Blob([new Uint8Array([1])], { type: "image/jpeg" })),
  });
});

afterEach(() => {
  cleanup();
  while (restaurations.length) restaurations.pop()!();
});

function video(): HTMLVideoElement | null {
  return document.querySelector("video");
}

function monter() {
  return render(
    <I18nProvider>
      <CameraScanner
        onDone={() => undefined}
        onCancel={() => undefined}
        onFallback={() => undefined}
      />
    </I18nProvider>,
  );
}

describe("l'écran de capture", () => {
  it("branche le flux sur la vidéo au démarrage", async () => {
    monter();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(video()?.srcObject).toBe(flux));
  });

  it("garde le flux après « Reprendre », et reprend une photo", async () => {
    monter();
    await waitFor(() => expect(video()?.srcObject).toBe(flux));
    const premiere = video();

    // Trois analyses stables, et la prise part toute seule : c'est le vrai
    // mécanisme, pas un raccourci. L'aperçu remplace alors toute la vue.
    const reprendre = await screen.findByText("Reprendre", {}, { timeout: 8_000 });
    expect(video()).toBeNull();

    fireEvent.click(reprendre);

    // Un élément NEUF — et il porte déjà le flux. C'est ce qui manquait.
    const seconde = video();
    expect(seconde).not.toBeNull();
    expect(seconde).not.toBe(premiere);
    expect(seconde?.srcObject).toBe(flux);

    // La preuve par l'usage : une seconde photo se prend sur cet élément.
    await screen.findByText("Reprendre", {}, { timeout: 8_000 });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const prisesVides = noterAuJournal.mock.calls.filter(
      ([ou]) => typeof ou === "string" && ou.includes("prise"),
    );
    expect(prisesVides).toEqual([]);
  });
});
