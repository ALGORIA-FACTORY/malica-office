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
    const sorti = expurger("échec pour personne@exemple-fictif.tn lors de la lecture");
    expect(sorti).not.toContain("personne@exemple-fictif.tn");
    expect(sorti).toContain("[retiré]");
  });

  it("retire un matricule fiscal tunisien", () => {
    expect(expurger("tenant 1856324/A/M/000 refusé")).not.toContain("1856324/A/M/000");
  });

  it("retire un matricule au FORMAT RÉEL, lettre de clé comprise", () => {
    /*
     * Fuite trouvée le 5 octobre 2026, en posant la validation du format.
     *
     * Un matricule tunisien s'écrit « 1876543W/A/M/000 » : sept chiffres, UNE
     * LETTRE DE CLÉ, puis trois groupes. Le motif d'expurgation attendait
     * `\d{7}` suivi immédiatement d'une barre : il reconnaissait donc la forme
     * tronquée des fixtures du dépôt, et PAS celle que portent les vraies
     * pièces.
     *
     * Conséquence : le matricule d'un vrai client partait en clair dans un
     * rapport de plantage. C'est exactement ce que ce module promet
     * d'empêcher, et la promesse était fausse pour le seul format qui existe
     * en production.
     *
     * Les fixtures mal formées ont caché la fuite : le test passait sur une
     * valeur qu'aucune pièce réelle ne porte.
     */
    const sorti = expurger("tenant 1876543W/A/M/000 refusé");
    expect(sorti).not.toContain("1876543W/A/M/000");
    expect(sorti).not.toContain("1876543");
  });

  it("retire aussi celui d'un émetteur, dont le troisième groupe diffère", () => {
    // 1456987L/A/P/000 — relevé sur la facture du 4 octobre 2026.
    expect(expurger("émetteur 1456987L/A/P/000")).not.toContain("1456987L/A/P/000");
  });

  it("retire TOUTES les variantes du matricule, les vingt-cinq", () => {
    /*
     * Un matricule tunisien porte un code de TVA (A, B, P, D, N) et une
     * catégorie d'établissement (M, C, P, N, E). Vingt-cinq combinaisons, et
     * un motif d'expurgation qui n'en couvrirait que certaines laisserait
     * fuir les autres — sans que rien ne le signale.
     *
     * Le cas du 5 octobre a montré comment cela arrive : le motif couvrait la
     * forme des fixtures et pas celle des vraies pièces, et le test était
     * complice parce qu'il n'exerçait que la forme des fixtures. On exerce
     * donc TOUT l'espace, pas un représentant.
     */
    const fuites: string[] = [];
    for (const tva of ["A", "B", "P", "D", "N"]) {
      for (const cat of ["M", "C", "P", "N", "E"]) {
        const mf = `1876543W/${tva}/${cat}/000`;
        if (expurger(`dossier ${mf} refusé`).includes(mf)) fuites.push(mf);
      }
    }
    expect(fuites).toEqual([]);
  });

  it("retire un matricule d'établissement secondaire", () => {
    // Le dernier groupe n'est pas toujours « 000 ».
    expect(expurger("succursale 1876543W/A/E/042")).not.toContain("1876543W/A/E/042");
  });

  it("retire un matricule en minuscules, que l'OCR rend parfois ainsi", () => {
    expect(expurger("lu 1876543w/a/m/000")).not.toContain("1876543w/a/m/000");
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

describe("ce que l'expurgation doit ÉPARGNER", () => {
  it("garde la ligne ET la colonne d'une pile, même à six chiffres", () => {
    /*
     * Relevé sur le premier vrai plantage remonté, le 4 octobre 2026 :
     *   at $u (https://localhost/assets/index-DsYR1TaX.js:12:[retiré])
     * La colonne avait six chiffres, et la règle « six chiffres ou plus » l'a
     * prise pour un montant. Sans elle, il faut lire le paquet minifié à la
     * main pour retrouver l'endroit. Une position dans un fichier ne nomme
     * personne : elle reste.
     */
    const pile = "at $u (https://localhost/assets/index-DsYR1TaX.js:12:150823)";
    const sorti = expurger(pile);
    expect(sorti).toContain(":12:150823");
  });

  it("retire quand même un montant qui suit un deux-points", () => {
    // La protection vaut pour « ligne:colonne », pas pour « total: 1234567 ».
    expect(expurger("total: 1234567")).not.toContain("1234567");
  });
});
