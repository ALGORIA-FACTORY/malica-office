/**
 * Où part l'appel — la question la plus lourde de conséquences du navigateur.
 *
 * Se tromper d'hôte, c'est envoyer les pièces d'un client ailleurs. En
 * développement la réponse est « la même origine que la page », parce que le
 * serveur web relaie l'API ; en production, elle est « ce qui a été déclaré »,
 * et rien d'autre.
 */
import { describe, expect, it } from "vitest";

import { resoudreApi } from "../rpc";

describe("en développement — le relais du serveur web", () => {
  it("appelle la même origine quand l'adresse déclarée est locale", () => {
    // C'est ce qui fait qu'un téléphone du réseau fonctionne sans configurer
    // quoi que ce soit : un seul port, un seul certificat, aucun CORS.
    expect(resoudreApi("http://localhost:3000", false)).toBe("");
    expect(resoudreApi("http://127.0.0.1:3000", false)).toBe("");
  });

  it("appelle la même origine quand rien n'est déclaré", () => {
    expect(resoudreApi(undefined, false)).toBe("");
    expect(resoudreApi("", false)).toBe("");
  });

  it("respecte une adresse distante déclarée : c'est une décision", () => {
    expect(resoudreApi("https://api.exemple.tn", false)).toBe("https://api.exemple.tn");
  });

  it("laisse passer une adresse déjà relative", () => {
    expect(resoudreApi("/api", false)).toBe("/api");
  });
});

describe("en production — ce qui est déclaré fait foi", () => {
  it("emploie l'adresse telle quelle", () => {
    expect(resoudreApi("https://api.exemple.tn", true)).toBe("https://api.exemple.tn");
  });

  it("n'invente JAMAIS la même origine", () => {
    // Une page servie depuis un domaine compromis désignerait sinon elle-même
    // la destination des pièces d'un client.
    expect(resoudreApi("http://localhost:3000", true)).toBe("http://localhost:3000");
  });

  it("refuse de démarrer sans adresse", () => {
    expect(() => resoudreApi(undefined, true)).toThrow(/VITE_API_URL/);
    expect(() => resoudreApi("", true)).toThrow(/VITE_API_URL/);
  });
});

describe("la forme de l'adresse", () => {
  it("retire la barre oblique finale, et rien d'autre", () => {
    expect(resoudreApi("https://api.exemple.tn/", true)).toBe("https://api.exemple.tn");
  });

  it("garde le chemin d'une API montée sous un préfixe", () => {
    expect(resoudreApi("https://exemple.tn/api", true)).toBe("https://exemple.tn/api");
  });
});
