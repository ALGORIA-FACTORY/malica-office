/**
 * La garde des chiffres et le flux de Claude, en pur : aucune base, aucun réseau.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Assembleur, lireLeFluxSSE, type EvenementClaude } from "./claude-flux.ts";
import { chiffresDe, GardeDesChiffres, phrasesDe, type SourceConnue } from "./garde.ts";

const source = (cle: string, texte: string, titre = cle): SourceConnue => ({
  cle,
  genre: "piece",
  titre,
  objetId: null,
  texte,
});

describe("les chiffres d'une phrase", () => {
  it("lit les montants à toutes les précisions, sans le numéro d'une liste", () => {
    assert.deepEqual(chiffresDe("1. Total : **1 234,500 TND**"), ["1234.5"]);
    assert.deepEqual(chiffresDe("Le total est 1234.500."), ["1234.5"]);
    assert.deepEqual(chiffresDe("Aucun chiffre ici."), []);
    assert.deepEqual(chiffresDe("تنتظر ٤ وثائق"), ["4"]);
  });

  it("coupe les phrases sans couper « art. 52 » ni « 1.5 »", () => {
    const t = "Selon l'art. 52, le taux est 1.5 %. Voilà ! Et ensuite\nune ligne.";
    assert.equal(phrasesDe(t).join(""), t);
    assert.deepEqual(
      phrasesDe(t).map((p) => p.trim()),
      ["Selon l'art. 52, le taux est 1.5 %.", "Voilà !", "Et ensuite", "une ligne."],
    );
  });
});

describe("la garde des chiffres", () => {
  it("laisse partir aussitôt une phrase complète sans chiffre", () => {
    const g = new GardeDesChiffres("question");
    g.ouvrirBloc();
    assert.equal(g.recevoirTexte("Je regarde vos "), "");
    assert.equal(g.recevoirTexte("pièces. Et "), "Je regarde vos pièces. ");
    assert.deepEqual(g.fermerBloc(), { aEmettre: "Et ", retirees: [] });
  });

  it("retient une phrase chiffrée jusqu'à la fin du bloc, puis la laisse partir si sa source la porte", () => {
    const g = new GardeDesChiffres("Quelle TVA ?");
    const i = g.ajouterSource(source("malica:tva:2026-10", "Solde : 1090.504 TND."));
    g.ouvrirBloc();
    assert.equal(g.recevoirTexte("Vous devez 1090.504 TND. "), "");
    assert.equal(g.recevoirTexte("Merci. "), "", "tout ce qui suit une phrase retenue attend");
    g.recevoirCitation({
      type: "search_result_location",
      source: "malica:tva:2026-10",
      cited_text: "Solde : 1090.504 TND.",
      search_result_index: i,
    });
    const j = g.fermerBloc();
    assert.equal(j.aEmettre, "Vous devez 1090.504 TND. Merci. ");
    assert.deepEqual(j.retirees, []);
    assert.deepEqual(
      g.sourcesCitees().map((s) => s.cle),
      ["malica:tva:2026-10"],
    );
  });

  it("RETIRE une phrase dont un chiffre n'a aucune source — elle ne part jamais", () => {
    const g = new GardeDesChiffres("Combien de pénalités ?");
    g.ajouterSource(source("malica:conseil:x", "Les textes ne répondent pas."));
    g.ouvrirBloc();
    let vu = g.recevoirTexte("Je ne trouve pas cela. Vous paierez environ 450 dinars. ");
    vu += g.recevoirTexte("Votre cabinet chiffrera.");
    const j = g.fermerBloc();
    vu += j.aEmettre;
    assert.equal(vu, "Je ne trouve pas cela. Votre cabinet chiffrera.");
    assert.deepEqual(j.retirees, ["Vous paierez environ 450 dinars."]);
    assert.equal(g.texteEmis().includes("450"), false);
  });

  it("refuse une citation qui ne désigne pas la source envoyée à cet index", () => {
    const g = new GardeDesChiffres("q");
    g.ajouterSource(source("malica:piece:a", "Total : 10"));
    g.ouvrirBloc();
    assert.equal(
      g.recevoirCitation({
        type: "search_result_location",
        source: "malica:piece:b",
        search_result_index: 0,
      }),
      false,
    );
    assert.equal(
      g.recevoirCitation({
        type: "search_result_location",
        source: "malica:piece:a",
        search_result_index: 5,
      }),
      false,
    );
  });

  it("laisse passer un chiffre que la personne a écrit elle-même", () => {
    const g = new GardeDesChiffres("Où est ma facture 2417 ?");
    const j = g.jugerTout("Je ne trouve pas de facture 2417 dans ce dossier.");
    assert.deepEqual(j.retirees, []);
  });

  it("adosse une phrase non citée à la source remise qui porte son chiffre", () => {
    const g = new GardeDesChiffres("q");
    g.ajouterSource(source("malica:liste:pieces", "Pièces trouvées : 4."));
    const j = g.jugerTout("**4 pièces** attendent un geste.");
    assert.deepEqual(j.retirees, []);
    assert.deepEqual(
      g.sourcesCitees().map((s) => s.cle),
      ["malica:liste:pieces"],
    );
  });
});

describe("le flux de Claude", () => {
  it("recompose texte cité, entrée d'outil en JSON partiel, réflexion signée et usage", () => {
    const a = new Assembleur();
    const ev: EvenementClaude[] = [
      {
        type: "message_start",
        message: { model: "m", usage: { input_tokens: 10, cache_read_input_tokens: 90 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "je" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "SIG" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Bon" } },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "citations_delta",
          citation: { type: "search_result_location", search_result_index: 0 },
        },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "t1", name: "tva_du_mois", input: {} },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"mois":' },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '"2026-10"}' },
      },
      { type: "content_block_stop", index: 2 },
      { type: "ping" },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } },
      { type: "message_stop" },
    ];
    for (const e of ev) a.recevoir(e);
    const m = a.message();
    assert.equal(m.stopReason, "tool_use");
    assert.deepEqual(m.usage, { entree: 10, sortie: 42, cacheLu: 90, cacheEcrit: 0 });
    assert.deepEqual(m.content[0], { type: "thinking", thinking: "je", signature: "SIG" });
    assert.deepEqual(m.content[1], {
      type: "text",
      text: "Bon",
      citations: [{ type: "search_result_location", search_result_index: 0 }],
    });
    assert.deepEqual(m.content[2], {
      type: "tool_use",
      id: "t1",
      name: "tva_du_mois",
      input: { mois: "2026-10" },
    });
  });

  it("une erreur dans le flux lève une panne passagère", () => {
    const a = new Assembleur();
    assert.throws(
      () =>
        a.recevoir({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      /overloaded/,
    );
  });

  it("lit un flux SSE coupé n'importe où", async () => {
    const brut =
      'event: message_start\ndata: {"type":"message_start","message":{"model":"m"}}\n\n' +
      'event: ping\ndata: {"type":"ping"}\n\nevent: content_block_delta\r\ndata: {"type":"content_block_delta","index":0}\r\n\r\n';
    const octets = new TextEncoder().encode(brut);
    const corps = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < octets.length; i += 7) c.enqueue(octets.slice(i, i + 7));
        c.close();
      },
    });
    const vus: string[] = [];
    for await (const e of lireLeFluxSSE(corps)) vus.push(e.type);
    assert.deepEqual(vus, ["message_start", "ping", "content_block_delta"]);
  });
});

describe("la garde ne retient que ce qui engage, quand la base dit ce qui engage", () => {
  const regle = {
    marques_liantes: [
      "%",
      "tnd",
      "dinar*",
      "taux",
      "tva",
      "factur*",
      "delai*",
      "ht",
      "ttc",
      "نسبة",
    ],
    entier_liant_des: 10000,
  };
  const juger = (texte: string, question = "question", sources: SourceConnue[] = []) => {
    const g = new GardeDesChiffres(question, regle);
    for (const s of sources) g.ajouterSource(s);
    return g.jugerTout(texte);
  };

  it("laisse passer une année, un âge, un rang dans une phrase qui n'engage pas", () => {
    const t =
      "Ibn Khaldoun est né à Tunis en 1332 et mort au Caire en 1406. Il décrit un cycle de 3 générations.";
    assert.deepEqual(juger(t), { aEmettre: t, retirees: [] });
  });

  it("retire toujours un taux, un montant, un délai écrits de mémoire", () => {
    for (const phrase of [
      "Le taux normal est de 19 %.",
      "La TVA est de 19.",
      "Vous devez 250 dinars.",
      "Le délai est de 28 jours.",
      "النسبة العادية هي 19.",
      "Vous avez dépensé 5 310,500 chez Kordane.",
      "Cela représente 48000 au total.",
      "Votre facture 2417 est payée.",
    ]) {
      assert.deepEqual(juger(phrase), { aEmettre: "", retirees: [phrase] }, phrase);
    }
  });

  it("garde un chiffre liant porté par la question ou par une source", () => {
    const t = "17 % de 2 450 font 416,5.";
    assert.equal(juger(t).retirees.length, 1, "sans source, le résultat est retiré");
    const calcul = source(
      "malica:calcul:2450*17/100",
      "Opération : 2450 * 17 / 100\nRésultat exact : 416,5",
    );
    assert.deepEqual(juger(t, "Combien font 17 % de 2 450 ?", [calcul]), {
      aEmettre: t,
      retirees: [],
    });
  });

  it("ne prend pas une formule de tableur pour un chiffre", () => {
    const t =
      "Mettez en C2 la formule du TTC :\n`=A2*(1+B2)`\nSi le taux est saisi en nombre entier : `=A2*(1+B2/100)`.\nA2 porte le HT et B2 le taux.";
    assert.deepEqual(juger(t), { aEmettre: t, retirees: [] });
    // Hors formule, la marque joue : un taux glissé entre accents graves reste jugé.
    assert.equal(juger("Le taux est `19` aujourd'hui.").retirees.length, 1);
    assert.equal(juger("Écrivez `=19%` comme taux.").retirees.length, 1);
    // Le morceau qu'on explique nomme une cellule : il passe, phrase à marque comprise.
    const morceau = "- `(1+B2)` ajoute la part du taux au HT.";
    assert.deepEqual(juger(morceau), { aEmettre: morceau, retirees: [] });
    const unite = "Le `1` représente le HT lui-même, et `/100` ramène le taux à une fraction.";
    assert.deepEqual(juger(unite), { aEmettre: unite, retirees: [] });
    // Un taux d'exemple sorti de la mémoire reste retiré, formule ou non.
    assert.equal(juger("Si B2 contient 19 %, `1+B2` vaut 1,19.").retirees.length, 1);
  });

  it("une marque est un mot entier ou une racine, pas un bout de mot", () => {
    // « ht » ne se trouve pas dans « http », « taux » pas dans « plateaux ».
    const t = "Le site http répond en 2 secondes sur 3 plateaux.";
    assert.deepEqual(juger(t), { aEmettre: t, retirees: [] });
    assert.equal(juger("La facturation a 2 étapes.").retirees.length, 1);
  });

  it("en flux, une phrase à chiffre non liant part sans attendre la fin du bloc", () => {
    const g = new GardeDesChiffres("question", regle);
    g.ouvrirBloc();
    assert.equal(g.recevoirTexte("Il est né en 1332. "), "Il est né en 1332. ");
    assert.equal(g.recevoirTexte("Le taux est de 19 %. Et la suite. "), "");
    assert.deepEqual(g.fermerBloc(), {
      aEmettre: "Et la suite. ",
      retirees: ["Le taux est de 19 %."],
    });
  });

  it("sans règle, ou avec une règle vide, tout chiffre se juge comme avant", () => {
    const t = "Il est né en 1332.";
    assert.deepEqual(new GardeDesChiffres("q").jugerTout(t), { aEmettre: "", retirees: [t] });
    assert.deepEqual(
      new GardeDesChiffres("q", { marques_liantes: [], entier_liant_des: 10000 }).jugerTout(t),
      { aEmettre: "", retirees: [t] },
    );
  });
});

describe("le chiffre sans source part marqué quand le corpus s'est tu (M-9)", () => {
  it("sans la marque, la phrase est retirée", () => {
    const g = new GardeDesChiffres("Quel est le taux ?");
    const j = g.jugerTout("Le taux est de 7 %. Il se déclare chaque mois.");
    assert.equal(j.aEmettre, "Il se déclare chaque mois.");
    assert.deepEqual(g.marquees(), []);
    assert.equal(g.retirees().length, 1);
  });

  it("avec la marque, la phrase reste et porte la marque avant l'espace qui la suit", () => {
    const g = new GardeDesChiffres("Quel est le taux ?");
    g.marquerSansSource("_(non vérifié)_");
    const j = g.jugerTout("Le taux est de 7 %. Il se déclare chaque mois.");
    assert.equal(j.aEmettre, "Le taux est de 7 %. _(non vérifié)_ Il se déclare chaque mois.");
    assert.deepEqual(g.marquees(), ["Le taux est de 7 %."]);
    assert.deepEqual(g.retirees(), []);
  });

  it("un chiffre porté par une source ne reçoit pas la marque", () => {
    const g = new GardeDesChiffres("Quel est le taux ?");
    g.ajouterSource({
      cle: "malica:article:ESSAI:7",
      genre: "article",
      titre: "Texte d'essai, article 7",
      objetId: null,
      texte: "Le taux est fixé à 19 %.",
    });
    g.marquerSansSource("_(non vérifié)_");
    const j = g.jugerTout("Le taux est de 19 %.");
    assert.equal(j.aEmettre, "Le taux est de 19 %.");
    assert.deepEqual(g.marquees(), []);
  });
});
