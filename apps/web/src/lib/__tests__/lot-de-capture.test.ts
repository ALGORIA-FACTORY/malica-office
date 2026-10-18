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
import { identifiantsDuLot, lireLotDeCapture } from "@/lib/lot-de-capture";

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
    expect(lireLotDeCapture({ pieces: "nimporte,quoi" })).toEqual({});
    expect(lireLotDeCapture({ pieces: 42 })).toEqual({});
  });

  it("un lot lisible ressort normalisé, jamais tel qu'il est arrivé", () => {
    expect(lireLotDeCapture({ pieces: `${UN.toUpperCase()} , bruit` })).toEqual({ pieces: UN });
  });
});
