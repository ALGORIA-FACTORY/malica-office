// @vitest-environment jsdom
/**
 * Le réseau a UNE source de vérité, et elle vient de la coque.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 12 octobre 2026, parcours Maestro sur émulateur : trois flux sur six
 * échouent, dont celui du mode avion. L'arbre d'écran capturé en mode avion
 * montre l'accueil normal, SANS bandeau.
 *
 * La cause, et ce n'est pas le test :
 *
 *   — le bandeau et la file d'attente lisaient tous deux `navigator.onLine` ;
 *   — dans une WebView Android, `navigator.onLine` NE BASCULE PAS en mode
 *     avion : Chromium embarqué garde sa valeur optimiste, et les événements
 *     `offline` ne sont pas délivrés ;
 *   — le pont qui sait, lui, existait : `coque().reseau.surChangement`, bâti
 *     sur `@capacitor/network`, déclaré dans les dépendances depuis septembre.
 *     Personne ne l'importait.
 *
 * C'est le motif récurrent de ce dépôt — l'outil construit, le consommateur
 * absent — et il tombe ici sur la promesse centrale du produit : « vos photos
 * partiront au retour du réseau ».
 *
 * ======================================== POURQUOI UNE SEULE SOURCE
 *
 * Deux consommateurs lisaient deux fois la même chose : le bandeau par un
 * hook React, la file par une fermeture sur `navigator`. Deux lectures qui
 * peuvent diverger, et qui ont divergé — le bandeau n'apparaissait pas tandis
 * que la file, elle, tentait d'envoyer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Le pont de la coque, tel qu'un faux l'offre. */
type Rappel = (enLigne: boolean) => void;

const pont = {
  natif: false,
  etatInitial: true,
  rappels: [] as Rappel[],
  desabonnements: 0,
};

vi.mock("../coque", () => ({
  estNatif: () => pont.natif,
  coque: () => ({
    reseau: {
      surChangement(rappel: Rappel) {
        pont.rappels.push(rappel);
        return () => {
          pont.desabonnements += 1;
        };
      },
      etat: async () => pont.etatInitial,
    },
  }),
}));

/** Le module est à état : on le recharge entre deux épreuves. */
async function charger() {
  vi.resetModules();
  return import("../reseau");
}

beforeEach(() => {
  pont.natif = false;
  pont.etatInitial = true;
  pont.rappels = [];
  pont.desabonnements = 0;
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

afterEach(() => {
  vi.resetModules();
});

describe("la source de vérité du réseau", () => {
  it("dans un navigateur, elle suit `navigator.onLine`", async () => {
    const { estEnLigne } = await charger();
    expect(estEnLigne()).toBe(true);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    expect(estEnLigne()).toBe(false);
  });

  it("dans la COQUE, elle suit le pont — et non `navigator.onLine`", async () => {
    /*
     * L'épreuve du défaut. `navigator.onLine` reste à `true` en mode avion
     * dans une WebView : si la source le croyait, le bandeau ne paraîtrait
     * jamais sur un téléphone.
     */
    pont.natif = true;
    const { estEnLigne, pretAEtreLu } = await charger();
    await pretAEtreLu();

    expect(pont.rappels.length).toBe(1);
    pont.rappels[0]!(false);

    expect(window.navigator.onLine).toBe(true);
    expect(estEnLigne()).toBe(false);
  });

  it("et elle lit l'état AU DÉMARRAGE, sans attendre un changement", async () => {
    /*
     * Un auditeur seul ne suffit pas : l'application lancée alors que le
     * téléphone est DÉJÀ en mode avion ne recevrait aucun événement, et se
     * croirait en ligne jusqu'au premier changement. C'est le cas d'un
     * dirigeant qui photographie dans un sous-sol.
     */
    pont.natif = true;
    pont.etatInitial = false;
    const { estEnLigne, pretAEtreLu } = await charger();
    await pretAEtreLu();
    expect(estEnLigne()).toBe(false);
  });

  it("prévient ses abonnés, une fois par changement", async () => {
    pont.natif = true;
    const { surChangementDuReseau, pretAEtreLu } = await charger();
    await pretAEtreLu();

    const vus: boolean[] = [];
    const arreter = surChangementDuReseau((e) => vus.push(e));
    pont.rappels[0]!(false);
    pont.rappels[0]!(true);
    arreter();
    pont.rappels[0]!(false);

    expect(vus).toEqual([false, true]);
  });

  it("ne s'abonne au pont qu'UNE fois, quel que soit le nombre de lecteurs", async () => {
    // Le bandeau, la file, et demain un troisième. Un abonnement par lecteur
    // multiplierait les auditeurs natifs pour une seule vérité.
    pont.natif = true;
    const { surChangementDuReseau, pretAEtreLu } = await charger();
    await pretAEtreLu();
    surChangementDuReseau(() => undefined);
    surChangementDuReseau(() => undefined);
    expect(pont.rappels.length).toBe(1);
  });
});
