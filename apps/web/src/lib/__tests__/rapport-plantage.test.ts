/**
 * Ce qu'un rapport de plantage a le droit d'emporter.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, l'application installée a planté sur un téléphone et
 * n'a laissé AUCUNE trace : le journal d'atelier n'existe qu'en développement,
 * et le serveur n'a rien vu. Trois corrections à l'aveugle avaient déjà échoué
 * pour la même raison en septembre.
 *
 * On rapporte donc, vers notre propre serveur. Mais une pièce est un document
 * de client : un message d'erreur ou une pile d'appels peut en porter un
 * morceau — une adresse, un matricule fiscal, un montant, un jeton. Ce module
 * ne fait pas confiance à ce qu'on lui donne : il expurge AVANT d'envoyer, et
 * ce test dit ce qui ne doit jamais passer.
 *
 * La règle est volontairement plus sévère que nécessaire. Un numéro de ligne
 * perdu coûte une minute d'enquête ; un montant de facture parti sur le réseau
 * ne se rattrape pas.
 */
import { describe, expect, it } from "vitest";

import { expurger } from "../rapport-plantage";

describe("l'expurgation d'un rapport de plantage", () => {
  it("retire une adresse de courriel", () => {
    const sorti = expurger("échec pour contact@sotumag.tn lors de la lecture");
    expect(sorti).not.toContain("contact@sotumag.tn");
    expect(sorti).toContain("[retiré]");
  });

  it("retire un matricule fiscal tunisien", () => {
    expect(expurger("tenant 1856324/A/M/000 refusé")).not.toContain("1856324/A/M/000");
  });

  it("retire une longue suite de chiffres — montant, téléphone, identifiant", () => {
    const sorti = expurger("total 1234567 dinars, tel 21698765432");
    expect(sorti).not.toContain("1234567");
    expect(sorti).not.toContain("21698765432");
  });

  it("garde les numéros de ligne d'une pile : ils ne nomment personne", () => {
    const pile = "at lirePiece (/assets/index-D54PbA5v.js:1420:37)";
    const sorti = expurger(pile);
    expect(sorti).toContain("1420:37");
    expect(sorti).toContain("lirePiece");
  });

  it("retire ce qui ressemble à un jeton", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
    expect(expurger(`Authorization Bearer ${jwt}`)).not.toContain(jwt);
  });

  it("retire la requête d'une adresse, garde le chemin", () => {
    const sorti = expurger("échec sur https://staging.exemple.tn/pieces/abc?jeton=secret&id=42");
    expect(sorti).toContain("/pieces/abc");
    expect(sorti).not.toContain("secret");
  });

  it("retire une image en ligne plutôt que de l'envoyer", () => {
    const sorti = expurger("source data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA");
    expect(sorti).not.toContain("9j/4AAQ");
  });

  it("borne la taille : une pile ne se déverse pas", () => {
    expect(expurger("x".repeat(9000)).length).toBeLessThanOrEqual(4000);
  });

  it("ne rend jamais null ni undefined", () => {
    expect(expurger(undefined)).toBe("");
    expect(expurger(null)).toBe("");
  });
});
