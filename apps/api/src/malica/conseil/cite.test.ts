/**
 * Le conseil cité, en pur : ce que Claude reçoit, et ce qu'on croit de ce
 * qu'il rend. Aucun réseau, aucune base.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PassageTrouve } from "../../depots/corpus.ts";
import {
  choisirLeModele,
  construireLaRequete,
  coutDeLAppel,
  decouperEnBlocs,
  lireConfiguration,
  lireLaReponseCitee,
  motsDeRecherche,
  nombresDe,
  resultatsCitables,
  sourceDuPassage,
  type ReglageDuConseil,
  type ReponseClaudeBrute,
} from "./cite.ts";
import type { ParametreFiscal } from "./corpus.ts";

const REGLAGE: ReglageDuConseil = {
  modele_courant: "modele-courant",
  modele_difficile: "modele-difficile",
  longueur_difficile: 120,
  mots_difficiles: ["convention", "plus-value"],
  corpus_distincts_difficile: 3,
  passages_max: 8,
  distance_max: 0.37,
  distance_max_mots: 0.45,
  sortie_max_jetons: 900,
};

function passage(p: Partial<PassageTrouve> = {}): PassageTrouve {
  return {
    corpus: "CIRPPIS",
    numero: "52",
    validFrom: "2026-01-01",
    validTo: null,
    ordinal: 1,
    langue: "fr",
    texte: "Premier alinéa du texte. Second alinéa du texte.",
    entete: null,
    statut: "en_vigueur",
    abrogePar: null,
    nature: "Loi",
    autorite: "normative",
    opposableA: "administration, contribuable, juge",
    jortReference: null,
    provenance: "verbatim",
    distance: 0.2,
    parLesMots: true,
    score: 0.03,
    lacune: false,
    reprise: null,
    ...p,
  };
}

const PARAMETRE: ParametreFiscal = {
  code: "PARAM_ESSAI",
  libelle: "Paramètre d'essai",
  forme: "taux",
  echelle: "pourcentage",
  valeur: "7",
  corpus: "CIRPPIS",
  article: "Article 52-I-a",
  citation: null,
  autorite: "loi",
  confiance: "confirme",
  validFrom: "2026-01-01",
  validTo: null,
  note: null,
};

describe("les mots de la recherche", () => {
  it("écarte les mots-outils, garde le sujet et les numéros", () => {
    const mots = motsDeRecherche(
      "Quel est le taux de la retenue selon l'article 52 pour les loyers ?",
    );
    assert.ok(mots.includes("retenue"));
    assert.ok(mots.includes("loyers"));
    assert.ok(mots.includes("52"));
    assert.ok(!mots.includes("quel"));
    assert.ok(!mots.includes("pour"));
  });

  it("garde les mots d'une question en arabe", () => {
    const mots = motsDeRecherche("ما هي نسبة الضريبة على الشركات؟");
    assert.ok(mots.includes("الضريبة"));
    assert.ok(mots.includes("الشركات"));
    assert.ok(!mots.includes("على"));
  });
});

describe("le modèle : courant par défaut, difficile selon une règle réglée en base", () => {
  it("une question courte et simple va au modèle courant", () => {
    const c = choisirLeModele("Taux de la retenue sur loyers ?", 1, REGLAGE);
    assert.deepEqual(c, { modele: "modele-courant", difficile: false, motif: null });
  });
  it("une question longue va au modèle difficile", () => {
    const c = choisirLeModele("x".repeat(121), 1, REGLAGE);
    assert.equal(c.modele, "modele-difficile");
    assert.equal(c.motif, "longueur");
  });
  it("un mot désigné suffit", () => {
    const c = choisirLeModele("Imposition de la Plus-Value ?", 1, REGLAGE);
    assert.equal(c.modele, "modele-difficile");
    assert.equal(c.motif, "mot:plus-value");
  });
  it("des passages venus de plusieurs textes aussi", () => {
    assert.equal(choisirLeModele("Taux ?", 3, REGLAGE).motif, "textes_multiples");
    assert.equal(choisirLeModele("Taux ?", 2, REGLAGE).difficile, false);
  });
});

describe("les résultats citables", () => {
  it("coupe un texte en blocs aux fins de phrase", () => {
    const blocs = decouperEnBlocs("Une phrase. ".repeat(80), 100);
    assert.ok(blocs.length > 5);
    assert.ok(blocs.every((b) => b.length <= 100));
    assert.deepEqual(decouperEnBlocs("   "), []);
  });

  it("chaque passage porte une source qui nomme l'article ET sa version", () => {
    const { blocs, index } = resultatsCitables([passage()], [PARAMETRE], {
      CIRPPIS: "Code IRPP-IS",
    });
    assert.equal(blocs.length, 2);
    assert.equal(blocs[0]!.source, "malica://corpus/CIRPPIS/52@2026-01-01");
    assert.match(blocs[0]!.title, /Code IRPP-IS \(CIRPPIS\), art\. 52/);
    assert.match(blocs[0]!.title, /en vigueur depuis le 2026-01-01/);
    assert.deepEqual(blocs[0]!.citations, { enabled: true });
    assert.equal(blocs[1]!.source, "malica://referentiel/PARAM_ESSAI@2026-01-01");
    assert.equal(index[0]!.type, "article");
    assert.equal(index[1]!.type, "parametre");
  });

  it("une note commune se dit telle, dans le titre", () => {
    const { blocs } = resultatsCitables(
      [passage({ corpus: "NC-2025", nature: "Note commune DGELF", opposableA: "administration" })],
      [],
    );
    assert.match(blocs[0]!.title, /Note commune DGELF, opposable à : administration/);
  });
});

describe("la requête", () => {
  const configuration = {
    consigne: { id: "c1", texte: "CONSIGNE LUE EN BASE", decide_le: "2026-11-08" },
    reglage: REGLAGE,
    sources: [
      {
        code: "LOI",
        libelle: "Loi",
        autorite: "normative",
        opposable_a: "contribuable",
        fondement: null,
      },
    ],
  };

  it("la consigne vient de la base, le cache est posé sur le dernier bloc système", () => {
    const { blocs } = resultatsCitables([passage()], []);
    const r = construireLaRequete({
      modele: "modele-courant",
      configuration,
      blocs,
      question: "Taux ?",
      jour: "2026-06-30",
      locale: "fr",
    });
    assert.equal(r.system[0]!.text, "CONSIGNE LUE EN BASE");
    assert.equal(r.system[0]!.cache_control, undefined);
    assert.match(r.system[1]!.text, /HIÉRARCHIE DES SOURCES/);
    assert.deepEqual(r.system[1]!.cache_control, { type: "ephemeral" });
    assert.equal(r.max_tokens, 900);
    const contenu = r.messages[0]!.content;
    assert.equal(contenu[0]!.type, "search_result");
    const dernier = contenu[contenu.length - 1]!;
    assert.equal(dernier.type, "text");
    assert.match((dernier as { text: string }).text, /Date d'effet : 2026-06-30/);
    // Citations et sorties structurées sont incompatibles : aucune sortie structurée.
    assert.ok(!("output_config" in r));
  });
});

const INDEX = resultatsCitables(
  [passage(), passage({ numero: "53", validFrom: "2026-01-01" })],
  [],
).index;

function reponse(content: ReponseClaudeBrute["content"], stop = "end_turn"): ReponseClaudeBrute {
  return { model: "modele-courant", content, stop_reason: stop };
}

describe("la lecture de la réponse : on relit dans ce qu'on a montré", () => {
  it("une citation qui correspond à un résultat envoyé fonde une source versionnée", () => {
    const lu = lireLaReponseCitee(
      reponse([
        {
          type: "text",
          text: "La retenue est de 10 %",
          citations: [
            {
              type: "search_result_location",
              source: INDEX[0]!.source,
              search_result_index: 0,
              cited_text: "…10%…",
            },
          ],
        },
        { type: "text", text: "." },
      ]),
      INDEX,
    );
    assert.equal(lu.refus, false);
    assert.equal(lu.texte, "La retenue est de 10 %.");
    assert.deepEqual(lu.sources, [
      {
        type: "article",
        corpus: "CIRPPIS",
        numero: "52",
        code: null,
        validFrom: "2026-01-01",
        validTo: null,
      },
    ]);
    assert.equal(lu.citationsRejetees, 0);
    assert.equal(lu.versionsMelangees, false);
  });

  it("une citation dont la source ne correspond pas tombe, et une réponse sans citation est un refus", () => {
    const lu = lireLaReponseCitee(
      reponse([
        {
          type: "text",
          text: "Le taux est de 19 % depuis toujours, je le sais.",
          citations: [
            {
              type: "search_result_location",
              source: "malica://corpus/CTVA/7@2019-01-01",
              search_result_index: 0,
            },
            { type: "search_result_location", source: INDEX[0]!.source, search_result_index: 9 },
          ],
        },
      ]),
      INDEX,
    );
    assert.equal(lu.citationsRejetees, 2);
    assert.equal(lu.refus, true);
    // Le chiffre n'est porté par aucune citation : la phrase ne sort pas.
    assert.equal(lu.texte, "");
    assert.deepEqual(lu.chiffresRetires, ["Le taux est de 19 % depuis toujours, je le sais."]);
    assert.deepEqual(lu.chiffresNonCites, []);
  });

  it("deux versions d'un même article citées ensemble se voient", () => {
    const index = resultatsCitables(
      [passage({ validFrom: "2025-01-01", validTo: "2026-01-01" }), passage()],
      [],
    ).index;
    const lu = lireLaReponseCitee(
      reponse([
        {
          type: "text",
          text: "A",
          citations: [
            { type: "search_result_location", source: index[0]!.source, search_result_index: 0 },
            { type: "search_result_location", source: index[1]!.source, search_result_index: 1 },
          ],
        },
      ]),
      index,
    );
    assert.equal(lu.versionsMelangees, true);
  });

  it("une réponse coupée par la borne de sortie le dit", () => {
    assert.equal(lireLaReponseCitee(reponse([], "max_tokens"), INDEX).tronquee, true);
  });
});

describe("une phrase chiffrée sans citation ne sort jamais", () => {
  const citee = (texte: string, extrait: string) => ({
    type: "text",
    text: texte,
    citations: [
      {
        type: "search_result_location",
        source: INDEX[0]!.source,
        search_result_index: 0,
        cited_text: extrait,
      },
    ],
  });

  it("une phrase d'annonce dont les chiffres sont portés par une citation la reçoit", () => {
    const lu = lireLaReponseCitee(
      reponse([
        { type: "text", text: "Le taux est de 10 %, ramené à 3 % pour une société. " },
        citee(
          "Le texte dit : 10%(1) au titre des honoraires",
          "a) 10%(1) au titre des honoraires ; réduit à 3%(1)",
        ),
      ]),
      INDEX,
    );
    assert.deepEqual(lu.chiffresNonCites, []);
    assert.deepEqual(lu.chiffresRetires, []);
    assert.equal(lu.affirmations[0]!.citations.length, 1);
    assert.match(lu.texte, /^Le taux est de 10 %, ramené à 3 %/);
  });

  it("une phrase dont un chiffre n'est porté par rien est retirée, le reste demeure", () => {
    const lu = lireLaReponseCitee(
      reponse([
        { type: "text", text: "Le taux est de 10 %. Il passera à 12 % en 2030. Voici le texte. " },
        citee(
          "Selon l'article 52, 10%(1) au titre des honoraires.",
          "a) 10%(1) au titre des honoraires",
        ),
      ]),
      INDEX,
    );
    assert.deepEqual(lu.chiffresRetires, ["Il passera à 12 % en 2030."]);
    assert.ok(!lu.texte.includes("12 %"));
    assert.match(lu.texte, /Voici le texte\./);
    assert.deepEqual(lu.chiffresNonCites, []);
    assert.equal(lu.refus, false);
  });

  it("« 5 000 », « 5.000 » et « 5000 » sont le même nombre ; « 0,3 » et « 0.3 » aussi", () => {
    assert.deepEqual(nombresDe("5 000 dinars, 5.000 DT, 5000"), ["5000"]);
    assert.deepEqual(nombresDe("0,3 et 0.3"), ["0.3"]);
    assert.deepEqual(nombresDe("le 01/01"), ["1"]);
    assert.deepEqual(nombresDe("٢٠٪"), ["20"]);
  });

  it("une date que la réponse ajoute d'elle-même, sans source, est retirée", () => {
    const lu = lireLaReponseCitee(
      reponse([
        citee("Le taux est de 20%.", "est fixé à 20%"),
        { type: "text", text: " En vigueur au 2026-06-30 : art. 49." },
      ]),
      INDEX,
    );
    assert.equal(lu.chiffresRetires.length, 1);
    assert.equal(lu.texte, "Le taux est de 20%.");
  });
});

describe("le coût, au tarif de la base", () => {
  const tarifs = [
    { model: "m", role: "chat", in: 1, out: 5 },
    { model: "m", role: "cache", in: 0.1, out: 0 },
    { model: "m", role: "cache_ecriture", in: 1.25, out: 0 },
  ];
  it("additionne entrée, sortie, cache lu et cache écrit", () => {
    const cout = coutDeLAppel(
      "m",
      { entree: 1000, sortie: 200, cacheLu: 10_000, cacheEcrit: 0 },
      tarifs,
    );
    // 1000×1 + 200×5 + 10000×0,1 = 3000 par million
    assert.equal(cout, 0.003);
  });
  it("un tarif manquant rend un coût inconnu, pas zéro", () => {
    assert.equal(
      coutDeLAppel("autre", { entree: 1, sortie: 1, cacheLu: 0, cacheEcrit: 0 }, tarifs),
      null,
    );
    assert.equal(
      coutDeLAppel("m", { entree: 1, sortie: 1, cacheLu: 0, cacheEcrit: 5 }, tarifs.slice(0, 2)),
      null,
    );
  });
});

describe("la configuration", () => {
  it("sans consigne en base, on ne répond pas : aucune consigne de repli dans le code", () => {
    assert.throws(() => lireConfiguration({ reglage: REGLAGE }), /consigne_absente/);
    assert.throws(
      () => lireConfiguration({ consigne: { id: "c", texte: "x", decide_le: "" } }),
      /reglage_absent/,
    );
  });
  it("les nombres de jsonb se relisent en nombres", () => {
    const c = lireConfiguration({
      consigne: { id: "c", texte: "x", decide_le: "" },
      reglage: { ...REGLAGE, distance_max: "0.37" },
      tarifs: [{ model: "m", role: "chat", in: "0.10", out: "0.50" }],
    });
    assert.equal(c.reglage.distance_max, 0.37);
    assert.equal(c.tarifs[0]!.in, 0.1);
  });
});

describe("la source d'un passage", () => {
  it("encode le texte et l'article", () => {
    assert.equal(
      sourceDuPassage({ corpus: "LF-2026", numero: "51 ter", validFrom: "2026-01-01" }),
      "malica://corpus/LF-2026/51%20ter@2026-01-01",
    );
  });
});
