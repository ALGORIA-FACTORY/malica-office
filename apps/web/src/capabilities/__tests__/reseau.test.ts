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
 *   — le pont qui sait, lui, existait : `coque().reseau`, bâti sur
 *     `@capacitor/network`, déclaré dans les dépendances depuis septembre.
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Le pont de la coque, tel qu'un faux l'offre. */
type Rappel = (enLigne: boolean) => void;

const pont = {
  etatInitial: true,
  rappels: [] as Rappel[],
  desabonnements: 0,
};

vi.mock("../coque", () => ({
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
  pont.etatInitial = true;
  pont.rappels = [];
  pont.desabonnements = 0;
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

afterEach(() => {
  vi.resetModules();
});

describe("la source de vérité du réseau", () => {
  it("ne lit QUE le pont de la coque — jamais `navigator` elle-même", () => {
    /*
     * Le partage des rôles. La coque sait si l'on tourne dans un navigateur ou
     * dans une WebView, et c'est elle qui écoute ce qu'il faut : les
     * événements de la fenêtre d'un côté, le greffon réseau de l'autre. Ce
     * module ne sait que lire.
     *
     * Une première version posait ici les écouteurs de la fenêtre, derrière un
     * test sur la nature de la coque — un doublon de ce que la coque faisait
     * déjà depuis septembre, à corriger deux fois le jour où l'un des deux se
     * révélerait faux.
     */
    // Le chemin part du dossier de travail de Vitest (`apps/web`) : sous
    // jsdom, `import.meta.url` n'est pas une URL de fichier et
    // `fileURLToPath` refuse.
    const source = readFileSync(resolve(process.cwd(), "src/capabilities/reseau.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((ligne) => !/^\s*(\*|\/\/|\/\*)/.test(ligne))
      .join("\n");
    expect(code).not.toMatch(/navigator\.onLine/);
    expect(code).not.toMatch(/addEventListener/);
    expect(code).toMatch(/coque\(\)\.reseau/);
  });

  it("suit le pont, et non `navigator.onLine`", async () => {
    /*
     * L'épreuve du défaut. `navigator.onLine` reste à `true` en mode avion
     * dans une WebView : si la source le croyait, le bandeau ne paraîtrait
     * jamais sur un téléphone.
     */
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
    pont.etatInitial = false;
    const { estEnLigne, pretAEtreLu } = await charger();
    await pretAEtreLu();
    expect(estEnLigne()).toBe(false);
  });

  it("prévient ses abonnés, une fois par changement", async () => {
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
    const { surChangementDuReseau, pretAEtreLu } = await charger();
    await pretAEtreLu();
    surChangementDuReseau(() => undefined);
    surChangementDuReseau(() => undefined);
    expect(pont.rappels.length).toBe(1);
  });
});
