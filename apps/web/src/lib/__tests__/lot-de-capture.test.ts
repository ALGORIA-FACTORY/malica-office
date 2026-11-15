/**
 * Le lot qui voyage dans l'URL — ce qu'on en lit, et ce qu'on en jette.
 *
 * Il existe parce que l'obturateur mène désormais à l'écran de capture : sans
 * les identifiants de la photo qu'on vient de prendre, cet écran demanderait
 * la destination des trente pièces non lues du dossier pour une seule photo.
 *
 * Et parce qu'un paramètre d'URL vient de l'extérieur : ce qui n'a pas la
 * forme d'un identifiant est jeté, pas corrigé.
 */
import { describe, expect, it } from "vitest";

import { PLAFOND_ELEMENTS } from "@/lib/hors-ligne/file";
import type { PieceLue } from "@malica/socle/ports/repositories";

import {
  identifiantsDuLot,
  lireLotDeCapture,
  piecesDuLot,
  suiteDuPassage,
  urlDeLaReprise,
} from "@/lib/lot-de-capture";

const UN = "0b6f1d2e-3c4a-4b5c-8d9e-0f1a2b3c4d5e";
const DEUX = "11111111-2222-4333-8444-555555555555";

describe("le lot passé dans l'URL", () => {
  it("garde les identifiants, dans l'ordre reçu", () => {
    expect(identifiantsDuLot(`${UN},${DEUX}`)).toEqual([UN, DEUX]);
  });

  it("jette ce qui n'a pas la forme d'un identifiant", () => {
    expect(identifiantsDuLot(`${UN},../../etc,<script>,42`)).toEqual([UN]);
  });

  it("ne garde qu'une fois le même identifiant", () => {
    expect(identifiantsDuLot(`${UN},${UN}`)).toEqual([UN]);
  });

  it("ne lit jamais plus que le plafond de la file", () => {
    // Une liste bricolée à la main ne doit pas devenir dix mille comparaisons
    // à chaque rendu de l'écran.
    const beaucoup = Array.from(
      { length: PLAFOND_ELEMENTS + 20 },
      (_, i) => `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`,
    ).join(",");
    expect(identifiantsDuLot(beaucoup)).toHaveLength(PLAFOND_ELEMENTS);
  });

  it("un lot absent, vide ou entièrement faux vaut « montre-moi ce qui traîne »", () => {
    expect(lireLotDeCapture({})).toEqual({});
    expect(lireLotDeCapture({ pieces: "" })).toEqual({});
  });

  it("ne part de « Pour qui ? » qu'avec un lot, et seulement sur la valeur admise", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(lireLotDeCapture({ pieces: id, depart: "destination" })).toEqual({
      pieces: id,
      depart: "destination",
    });
    expect(lireLotDeCapture({ depart: "destination" })).toEqual({});
    expect(lireLotDeCapture({ pieces: id, depart: "ailleurs" })).toEqual({ pieces: id });
    expect(lireLotDeCapture({ pieces: "nimporte,quoi" })).toEqual({});
    expect(lireLotDeCapture({ pieces: 42 })).toEqual({});
  });

  it("un lot lisible ressort normalisé, jamais tel qu'il est arrivé", () => {
    expect(lireLotDeCapture({ pieces: `${UN.toUpperCase()} , bruit` })).toEqual({ pieces: UN });
  });

  it("le contexte d'où l'on vient : seulement les valeurs admises", () => {
    expect(lireLotDeCapture({ dossier: "achats" })).toEqual({ dossier: "achats" });
    expect(lireLotDeCapture({ dossier: "../x" })).toEqual({});
    expect(lireLotDeCapture({ dossier: "A".repeat(3) })).toEqual({});
    expect(lireLotDeCapture({ pour: "moi", depuis: "echeance" })).toEqual({
      pour: "moi",
      depuis: "echeance",
    });
    expect(lireLotDeCapture({ pour: "lui", depuis: "ailleurs" })).toEqual({});
    expect(lireLotDeCapture({ pieces: UN, pour: "moi" })).toEqual({ pieces: UN, pour: "moi" });
  });

  it("après un dépôt, le dossier et « pour moi » suivent la photo suivante (revue de #277)", () => {
    expect(suiteDuPassage([UN], { dossier: "banque", depuis: "echeance" })).toEqual({
      pieces: UN,
      dossier: "banque",
    });
    expect(suiteDuPassage([], { pour: "moi" })).toEqual({ pour: "moi" });
    expect(suiteDuPassage([UN, DEUX], null)).toEqual({ pieces: `${UN},${DEUX}` });
  });
});

const piece = (id: string, autre: Partial<PieceLue> = {}): PieceLue => ({
  id,
  status: "capturee",
  createdAt: "2026-11-13T10:00:00Z",
  auteurId: null,
  vis: "personnel",
  gardeeLe: null,
  emetteur: null,
  dateDocument: null,
  kind: null,
  typeDeDocument: null,
  total: null,
  devise: null,
  lectureRefusee: null,
  lecture: null,
  ...autre,
});

describe("le lot de l'écran de capture (G2 : une pièce « Pour moi » n'y revient pas)", () => {
  it("une pièce gardée pour soi n'est plus à destiner, ni à lire", () => {
    const lot = piecesDuLot([piece(UN), piece(DEUX, { gardeeLe: "2026-11-13" })], []);
    expect(lot.map((p) => p.id)).toEqual([UN]);
  });

  it("ni une pièce déjà lue, ni un document joint, ni un reçu", () => {
    const lot = piecesDuLot(
      [
        piece(UN, { status: "lue" }),
        piece(DEUX, { jointe: true }),
        piece("x", { accompagne: true }),
      ],
      [],
    );
    expect(lot).toEqual([]);
  });

  it("le passage ne retient que les pièces qu'il nomme", () => {
    const lot = piecesDuLot([piece(UN), piece(DEUX)], [DEUX]);
    expect(lot.map((p) => p.id)).toEqual([DEUX]);
  });
});

describe("la progression survit au rechargement (G6b) — dans l'URL", () => {
  it("l'étape se lit avec un lot, et seulement entre « Pour qui ? » et le règlement", () => {
    expect(lireLotDeCapture({ pieces: UN, etape: "3" }).etape).toBe(3);
    expect(lireLotDeCapture({ pieces: UN, etape: 3 }).etape).toBe(3);
    expect(lireLotDeCapture({ pieces: UN, etape: "7" }).etape).toBe(7);
  });

  it("la fin (8), le zéro, l'inconnu et le bricolé sont jetés", () => {
    for (const etape of ["8", "0", "9", "-1", "2.5", "abc", "", "1e1"])
      expect(lireLotDeCapture({ pieces: UN, etape }).etape).toBeUndefined();
  });

  it("sans lot, l'étape n'a rien à reprendre : elle est jetée", () => {
    expect(lireLotDeCapture({ etape: "3" }).etape).toBeUndefined();
  });

  it("l'URL de la reprise porte l'étape et le lot, et garde le contexte d'où l'on vient", () => {
    expect(urlDeLaReprise(3, [UN, DEUX], { dossier: "achats", pour: "moi" })).toEqual({
      pieces: `${UN},${DEUX}`,
      etape: 3,
      dossier: "achats",
      pour: "moi",
    });
  });

  it("à l'étape 0, ou sans lot, il n'y a rien à reprendre", () => {
    expect(urlDeLaReprise(0, [UN], null)).toEqual({ pieces: UN });
    expect(urlDeLaReprise(3, [], null)).toEqual({});
  });
});
