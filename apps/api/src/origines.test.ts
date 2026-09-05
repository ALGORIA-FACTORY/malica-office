/**
 * Qui a le droit de faire agir un client authentifié.
 *
 * La session voyage en cookie : une origine acceptée à tort, c'est un site
 * tiers qui agit sur le dossier d'un client depuis son propre navigateur.
 * L'essentiel de ces épreuves porte donc sur les REFUS.
 *
 *   node --experimental-strip-types --test src/origines.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estReseauPrive, origineAutorisee } from "./origines.ts";

const DECLAREES = ["http://localhost:8080"];

describe("ce qui est déclaré passe toujours", () => {
  it("accepte une origine de la liste", () => {
    assert.equal(origineAutorisee("http://localhost:8080", DECLAREES, false), true);
    assert.equal(origineAutorisee("http://localhost:8080", DECLAREES, true), true);
  });

  it("ignore une barre oblique finale, des deux côtés", () => {
    assert.equal(origineAutorisee("http://localhost:8080/", DECLAREES, true), true);
    assert.equal(origineAutorisee("http://localhost:8080", ["http://localhost:8080/"], true), true);
  });
});

describe("le réseau local, en développement seulement", () => {
  it("accepte un téléphone du même réseau", () => {
    assert.equal(origineAutorisee("http://192.168.1.192:8080", DECLAREES, false), true);
    assert.equal(origineAutorisee("http://10.0.0.5:8080", DECLAREES, false), true);
    assert.equal(origineAutorisee("http://172.20.3.4:8080", DECLAREES, false), true);
  });

  it("REFUSE ce même téléphone en production", () => {
    assert.equal(origineAutorisee("http://192.168.1.192:8080", DECLAREES, true), false);
  });
});

describe("ce qui est refusé, et doit le rester", () => {
  it("refuse un site public, même en développement", () => {
    assert.equal(origineAutorisee("https://evil.example", DECLAREES, false), false);
    assert.equal(origineAutorisee("http://93.184.216.34", DECLAREES, false), false);
  });

  it("refuse un domaine qui IMITE une adresse privée", () => {
    // « 192.168.1.192.evil.com » n'est pas une adresse privée : c'est un nom
    // de domaine que son propriétaire contrôle.
    assert.equal(origineAutorisee("http://192.168.1.192.evil.com", DECLAREES, false), false);
    assert.equal(origineAutorisee("http://localhost.evil.com", DECLAREES, false), false);
  });

  it("refuse une origine illisible", () => {
    assert.equal(origineAutorisee("pas-une-url", DECLAREES, false), false);
  });

  it("refuse un octet hors bornes", () => {
    assert.equal(estReseauPrive("192.168.1.999"), false);
    assert.equal(estReseauPrive("10.300.0.1"), false);
  });

  it("refuse le voisinage de 172.16-31", () => {
    assert.equal(estReseauPrive("172.15.0.1"), false);
    assert.equal(estReseauPrive("172.32.0.1"), false);
    assert.equal(estReseauPrive("172.16.0.1"), true);
    assert.equal(estReseauPrive("172.31.255.255"), true);
  });
});

describe("sans origine", () => {
  it("laisse passer : il n'y a pas de navigateur à protéger", () => {
    // Un appel serveur à serveur, ou une sonde de santé, n'a pas d'origine.
    assert.equal(origineAutorisee(undefined, DECLAREES, true), true);
  });
});

describe("les formes que prend une adresse privée", () => {
  it("reconnaît la boucle et les noms locaux", () => {
    assert.equal(estReseauPrive("localhost"), true);
    assert.equal(estReseauPrive("127.0.0.1"), true);
    assert.equal(estReseauPrive("::1"), true);
    assert.equal(estReseauPrive("[::1]"), true);
    assert.equal(estReseauPrive("macbook.local"), true);
  });

  it("reconnaît l'IPv6 locale, et refuse l'IPv6 publique", () => {
    assert.equal(estReseauPrive("fd00::1"), true);
    assert.equal(estReseauPrive("fe80::1"), true);
    assert.equal(estReseauPrive("2001:db8::1"), false);
  });

  it("reconnaît le lien-local, attribué quand aucun DHCP ne répond", () => {
    assert.equal(estReseauPrive("169.254.10.2"), true);
  });
});
