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
    // Une valeur d'exemple dans une phrase qui nomme sa cellule reste (demande du
    // dirigeant, 11 novembre 2026 : l'explication d'une formule doit être
    // complète ; point M-10). Sans cellule nommée, elle tombe toujours.
    const exemple = "Si `B2` contient 10 %, `1+B2` vaut 1,10.";
    assert.deepEqual(juger(exemple), { aEmettre: exemple, retirees: [] });
    assert.equal(juger("Si le taux est de 19 %, le produit vaut 1,19.").retirees.length, 1);
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

const UNITES = ["%", "pour cent", "jour", "jours", "mois", "يوم"];

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
    g.marquerSansSource("_(non vérifié)_", UNITES);
    const j = g.jugerTout("Le taux est de 7 %. Il se déclare chaque mois.");
    assert.equal(j.aEmettre, "Le taux est de 7 %. _(non vérifié)_ Il se déclare chaque mois.");
    assert.deepEqual(g.marquees(), ["Le taux est de 7 %."]);
    assert.deepEqual(g.retirees(), []);
  });

  it("la marque que le modèle a écrite lui-même ne se dit pas deux fois", () => {
    const g = new GardeDesChiffres("Quel est le taux ?");
    g.marquerSansSource("_(non vérifié)_", UNITES);
    const j = g.jugerTout("Le taux y est de **18 %** (non vérifié). Il se déclare chaque mois.");
    assert.equal(j.aEmettre, "Le taux y est de **18 %** (non vérifié). Il se déclare chaque mois.");
    // Elle compte quand même : c'est elle qui envoie la réponse à la comptabilité.
    assert.equal(g.marquees().length, 1);
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
    g.marquerSansSource("_(non vérifié)_", UNITES);
    const j = g.jugerTout("Le taux est de 19 %.");
    assert.equal(j.aEmettre, "Le taux est de 19 %.");
    assert.deepEqual(g.marquees(), []);
  });
});

describe("ce que Malica a déjà dit dans le fil peut se redire", () => {
  const REGLE = { marques_liantes: ["tnd", "%"], entier_liant_des: 10000 };

  it("un montant d'une réponse précédente passe ; un montant nouveau tombe", () => {
    const g = new GardeDesChiffres("Et le deuxième ?", REGLE);
    g.admettreDuFil(["Le premier pèse 26 109,600 TND et le deuxième 4 999,000 TND."]);
    const j = g.jugerTout("Le deuxième est à 4 999,000 TND. Le troisième est à 1 234,000 TND.");
    assert.equal(j.aEmettre, "Le deuxième est à 4 999,000 TND. ");
    assert.equal(g.retirees().length, 1);
  });

  it("une longue phrase répétée dans la même réponse ne part qu'une fois", () => {
    const g = new GardeDesChiffres("q", REGLE);
    const longue =
      "Je vous conseille de surveiller le premier fournisseur, qui pèse le plus dans vos achats.";
    const j = g.jugerTout(`${longue}\n\nVoici le détail.\n\n${longue}`);
    assert.equal(j.aEmettre.split(longue).length - 1, 1);
  });
});

describe("ce qu'une phrase retirée laisse derrière elle se recoud", () => {
  const REGLE = { marques_liantes: ["%", "taux", "dinar"], entier_liant_des: 10000 };

  it("un paragraphe retiré ne laisse pas de lignes vides en trop", () => {
    const g = new GardeDesChiffres("q", REGLE);
    const j = g.jugerTout(
      "Premier paragraphe.\n\nUn café coûte 10 % de plus.\n\nDernier paragraphe.",
    );
    assert.equal(j.aEmettre, "Premier paragraphe.\n\nDernier paragraphe.");
  });

  it("la puce d'une phrase retirée passe à la suite de sa ligne", () => {
    const g = new GardeDesChiffres("q", REGLE);
    const j = g.jugerTout("- Un : oui.\n- Deux : le taux monte de 5 %. Négociez.\n- Trois : fin.");
    assert.equal(j.aEmettre, "- Un : oui.\n- Négociez.\n- Trois : fin.");
  });

  it("une puce entièrement retirée disparaît avec sa ligne", () => {
    const g = new GardeDesChiffres("q", REGLE);
    const j = g.jugerTout("- Un : oui.\n- Le taux monte de 5 %.\n- Trois : fin.");
    assert.equal(j.aEmettre, "- Un : oui.\n- Trois : fin.");
  });

  it("une phrase retirée au milieu d'une ligne ne touche pas aux sauts", () => {
    const g = new GardeDesChiffres("q", REGLE);
    const j = g.jugerTout("Début. Le taux est de 5 %.\n\nSuite.");
    assert.equal(j.aEmettre, "Début. \n\nSuite.");
  });
});

describe("une phrase qui nomme une cellule de tableur n'affirme aucun chiffre", () => {
  const REGLE = { marques_liantes: ["%", "taux", "tva", "tnd"], entier_liant_des: 10000 };

  it("la saisie du taux et l'exemple en cellules restent", () => {
    const g = new GardeDesChiffres("Une formule pour le TTC ?", REGLE);
    const texte =
      "Dans `B2`, saisissez le taux en pourcentage (10 %) ou en décimale (0,10). " +
      "Avec `A2 = 1 000` et `B2 = 10 %`, la cellule `C2` affiche 1 100.";
    const j = g.jugerTout(texte);
    assert.equal(j.aEmettre, texte);
    assert.deepEqual(g.retirees(), []);
  });

  it("sans cellule nommée, un taux sans source tombe toujours", () => {
    const g = new GardeDesChiffres("Une formule pour le TTC ?", REGLE);
    const j = g.jugerTout("Le taux de TVA est de 19 %.");
    assert.equal(j.aEmettre, "");
    assert.equal(g.retirees().length, 1);
  });

  it("sans règle en base, la garde reste stricte, cellule ou non", () => {
    const g = new GardeDesChiffres("Une formule pour le TTC ?");
    g.jugerTout("Dans `B2`, saisissez 10 %.");
    assert.equal(g.retirees().length, 1);
  });
});

describe("une phrase qui nomme un outil ne part pas à l'écran", () => {
  const NOMS = ["afficher_visuel", "conseil_fiscal", "calculer"];

  it("en flux comme à la fin du bloc, la phrase est tue et les autres passent", () => {
    const g = new GardeDesChiffres("Combien ai-je acheté chez Kordane ?");
    g.taire(NOMS);
    g.ouvrirBloc();
    const flux = g.recevoirTexte(
      "Je regarde vos achats. Calling afficher_visuel on that source is what they're asking for. Voici le total. ",
    );
    const fin = g.fermerBloc();
    assert.equal(flux + fin.aEmettre, "Je regarde vos achats. Voici le total. ");
    assert.equal(g.tues().length, 1);
    assert.deepEqual(g.retirees(), [], "une phrase tue n'est pas un chiffre retiré");
  });

  it("un mot de tous les jours n'est pas un nom d'outil : « calculer » passe", () => {
    const g = new GardeDesChiffres("Peux-tu calculer ?");
    g.taire(NOMS);
    assert.equal(
      g.jugerTout("Je peux calculer cela pour vous.").aEmettre,
      "Je peux calculer cela pour vous.",
    );
    assert.deepEqual(g.tues(), []);
  });

  it("sans liste, rien n'est tu", () => {
    const g = new GardeDesChiffres("Bonjour");
    assert.equal(
      g.jugerTout("L'outil conseil_fiscal répond.").aEmettre,
      "L'outil conseil_fiscal répond.",
    );
  });
});

describe("la marque ne couvre qu'un taux ou une durée (revue de la PR #352)", () => {
  const marquee = () => {
    const g = new GardeDesChiffres("Quelle TVA dois-je ?");
    g.ajouterSource({
      cle: "malica:piece:1",
      genre: "piece",
      titre: "Facture F-07",
      objetId: null,
      texte: "Total TTC : 1 190,000 TND",
    });
    g.marquerSansSource("_(non vérifié)_", UNITES);
    return g;
  };

  it("un montant de facture inventé et un calcul fait de tête restent retirés", () => {
    const g = marquee();
    const j = g.jugerTout(
      "Le taux est de 19 %. Votre facture F-12 s'élève à 4 870,500 TND. Soit une TVA de 925,395 TND à payer.",
    );
    assert.equal(j.aEmettre, "Le taux est de 19 %. _(non vérifié)_ ");
    assert.equal(g.retirees().length, 2);
    assert.deepEqual(g.marquees(), ["Le taux est de 19 %."]);
  });

  it("une phrase qui mêle un taux et un montant sans source est retirée entière", () => {
    const g = marquee();
    assert.equal(g.jugerTout("Au taux de 19 %, vous devez 925,395 TND.").aEmettre, "");
    assert.deepEqual(g.marquees(), []);
  });

  it("un taux à côté d'un montant du dossier, lui sourcé, part marqué", () => {
    const g = marquee();
    const j = g.jugerTout("Sur vos 1 190,000 TND, le taux serait de 19 %.");
    assert.equal(j.aEmettre, "Sur vos 1 190,000 TND, le taux serait de 19 %. _(non vérifié)_");
  });

  it("une durée se marque, en français comme en arabe ; un mot voisin n'est pas une unité", () => {
    const g = marquee();
    assert.match(g.jugerTout("Le délai est de 28 jours.").aEmettre, /non vérifié/);
    assert.match(g.jugerTout("الأجل 28 يوم.").aEmettre, /non vérifié/);
    assert.equal(g.jugerTout("La taxe vaut 28 jourdains par facture.").aEmettre, "");
  });

  it("sans liste d'unités, rien ne se marque", () => {
    const g = new GardeDesChiffres("Quel taux ?");
    g.marquerSansSource("_(non vérifié)_", []);
    assert.equal(g.jugerTout("Le taux est de 19 %.").aEmettre, "");
  });

  it("un nom d'outil au soulignement échappé est tu aussi", () => {
    const g = new GardeDesChiffres("Bonjour");
    g.taire(["afficher_visuel"]);
    assert.equal(g.jugerTout("J'appelle afficher\\_visuel. Voici.").aEmettre, "Voici.");
  });
});
