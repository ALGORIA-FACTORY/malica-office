/**
 * La dégradation par offre — une règle, et une seule.
 *
 * Il y en avait deux, et elles ne disaient pas la même chose : l'accueil
 * ouvrait les sièges sur le NOM de l'offre (`team` ou `premium`), les réglages
 * sur le NOMBRE que la base rend (`sieges_max > 1`). Deux écrans jugeaient le
 * même fait sur deux données différentes.
 *
 * Ces cas disent laquelle a gagné, et pourquoi : le nombre. Il vient de
 * `ref.offres`, il est versionné par date d'effet, et il n'oblige personne à
 * réécrire du TypeScript le jour où la grille change.
 */
import { describe, expect, it } from "vitest";

import { nombre, ouverturesDuForfait } from "@/lib/forfait";
import type { MonForfait } from "@malica/socle/ports/repositories";

/** La grille livrée au 17 octobre 2026, telle que `ref.offres` la porte. */
function forfait(offre: string, sieges_max: number): MonForfait {
  return {
    offre,
    statut: "active",
    lectures_droit: 65,
    lectures_consommees: 0,
    lectures_restantes: 65,
    organisations: 1,
    sieges_occupes: 0,
    sieges_inclus: 0,
    sieges_max,
    prix_mensuel_ht: "9.000",
  };
}

describe("ce que l'offre ouvre", () => {
  it("Basic et Solo n'ouvrent ni les sièges ni les sociétés", () => {
    expect(ouverturesDuForfait(forfait("basic", 0))).toEqual({ sieges: false, societes: false });
    expect(ouverturesDuForfait(forfait("solo", 0))).toEqual({ sieges: false, societes: false });
  });

  it("Team ouvre les sièges, pas les sociétés", () => {
    expect(ouverturesDuForfait(forfait("team", 10))).toEqual({ sieges: true, societes: false });
  });

  it("Premium ouvre les deux", () => {
    expect(ouverturesDuForfait(forfait("premium", 20))).toEqual({ sieges: true, societes: true });
  });

  it("les sièges se décident sur le nombre, pas sur le nom de l'offre", () => {
    // Le jour où la grille vend des places sur une offre qui ne s'appelle ni
    // « team » ni « premium », l'écran suit la base sans qu'on le réécrive.
    expect(ouverturesDuForfait(forfait("solo", 3)).sieges).toBe(true);
    expect(ouverturesDuForfait(forfait("team", 0)).sieges).toBe(false);
  });

  it("un forfait non lu n'ouvre rien — jamais l'inverse", () => {
    // Un client Premium dont l'appel échoue voit ses cartes verrouillées, et
    // l'écran dit « verrouillé parce que le forfait n'est pas lu ». Ouvrir par
    // défaut montrerait un bloc vide en promettant une fonction non payée.
    expect(ouverturesDuForfait(null)).toEqual({ sieges: false, societes: false });
    expect(ouverturesDuForfait(undefined)).toEqual({ sieges: false, societes: false });
  });

  it("sans plafond (grille du 19 octobre), les sièges s'ouvrent au titulaire seul", () => {
    // Team et Premium : `sieges_max` vide, `sieges_inclus` lu — c'est ouvert.
    expect(
      ouverturesDuForfait({ ...forfait("team", 0), sieges_max: null, sieges_inclus: 2 }).sieges,
    ).toBe(true);
    // Un collaborateur reçoit les deux vides : il ne donne pas de place.
    expect(
      ouverturesDuForfait({ ...forfait("team", 0), sieges_max: null, sieges_inclus: null }).sieges,
    ).toBe(false);
  });

  it("un compteur rendu en chaîne reste un compteur", () => {
    // Les entiers de PostgreSQL arrivent en chaînes selon le pilote.
    expect(ouverturesDuForfait({ ...forfait("team", 10), sieges_max: "10" }).sieges).toBe(true);
  });
});

describe("un entier, ou l'absence", () => {
  it("lit les deux formes que la base rend", () => {
    expect(nombre(7)).toBe(7);
    expect(nombre("7")).toBe(7);
  });

  it("n'invente jamais un zéro", () => {
    // Zéro est un fait, l'absence n'en est pas un, et les confondre sur un
    // compteur de quota ferait croire à un plafond atteint.
    expect(nombre(null)).toBeNull();
    expect(nombre(undefined)).toBeNull();
    expect(nombre("pas un nombre")).toBeNull();
    expect(nombre(0)).toBe(0);
  });
});
