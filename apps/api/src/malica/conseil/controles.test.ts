/**
 * Les contrôles doivent attraper l'invention — et se taire sur le reste.
 *
 * Un garde-fou qui crie à tort est un garde-fou qu'on désactive au bout de
 * trois jours. La moitié de ces épreuves vérifie donc qu'il SE TAIT quand
 * tout va bien, ce qui compte autant que le reste.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FragmentDeDroit } from "./corpus.ts";
import { articlesCites, canonique, chiffresEngageants, controler } from "./controles.ts";

const AUJOURDHUI = "2026-09-01";

function fragment(p: Partial<FragmentDeDroit> = {}): FragmentDeDroit {
  return {
    corpus: "CTVA",
    numero: "7",
    validFrom: "2026-01-01",
    validTo: null,
    ordinal: 1,
    langue: "fr",
    extrait:
      "ARTICLE 7.- Sont soumis à la taxe sur la valeur ajoutée au taux de 19%, les opérations…",
    statut: "en_vigueur",
    abrogePar: null,
    nature: "Loi ordinaire",
    autorite: "normative",
    opposableA: "administration, contribuable, juge",
    jortReference: "JORT 2025/104",
    provenance: "verbatim",
    distance: 0.21,
    ...p,
  };
}

describe("repérer ce qui est cité", () => {
  it("trouve les articles sous leurs formes usuelles", () => {
    assert.deepEqual(articlesCites("Le code de la TVA, art. 7, fixe…"), ["7"]);
    assert.deepEqual(articlesCites("l'article 89 du CDPF"), ["89"]);
    assert.deepEqual(articlesCites("CDPF art. 84 quinquies"), ["84 quinquies"]);
  });

  it("ne confond pas deux articles voisins", () => {
    const trouves = articlesCites("les articles 81 et 84 bis");
    assert.ok(trouves.includes("81"));
    assert.ok(trouves.includes("84 bis"));
  });
});

describe("repérer les chiffres qui engagent", () => {
  it("retient les taux et les montants, sous leur forme canonique", () => {
    assert.ok(chiffresEngageants("le taux est de 19%").includes("19"));
    // « 1 240,500 » et « 1240.5 » sont le même montant : c'est la valeur qui
    // se compare, pas la façon de l'écrire.
    assert.ok(chiffresEngageants("un crédit de 1 240,500 TND").includes("1240.5"));
  });

  it("ignore les années, les dates et les numéros d'article", () => {
    assert.deepEqual(chiffresEngageants("l'article 7, depuis 2018"), []);
    assert.deepEqual(chiffresEngageants("comptabilisée le 12/04/2026"), []);
    assert.deepEqual(chiffresEngageants("la loi de finances 2026"), []);
  });

  it("ignore un petit entier isolé, qui n'est pas un montant", () => {
    assert.deepEqual(chiffresEngageants("il me manque 2 factures"), []);
  });

  /*
   * Ce que la vraie prose a cassé.
   *
   * Ces quatre cas viennent d'une réponse réelle, juste, sur laquelle le
   * contrôle a crié quatre fois. Mes épreuves d'origine employaient des
   * entrées propres et ne les voyaient pas. Elles sont ici pour qu'aucune ne
   * revienne.
   */
  it("ne mord pas le début d'un nombre plus long", () => {
    // « 4488 » livrait « 448 » : le motif s'arrêtait à trois chiffres sans
    // vérifier ce qui suivait, et inventait un chiffre absent de la réponse.
    assert.ok(!chiffresEngageants("la facture 4488 est comptabilisée").includes("448"));
    assert.ok(chiffresEngageants("le nombre 4488,000 est un montant").includes("4488"));
  });

  it("ne prend pas une année pour un montant, quel que soit ce qui la précède", () => {
    // « 2026 » livrait « 202 », et « le 1er janvier 2026 » n'était couvert par
    // aucune des tournures que je neutralisais.
    assert.deepEqual(chiffresEngageants("en vigueur depuis le 1er janvier 2026"), []);
    assert.deepEqual(chiffresEngageants("l'exercice 2024 est clos"), []);
  });

  it("ne prend pas un numéro de facture pour un montant", () => {
    assert.deepEqual(chiffresEngageants("la facture 4471 n'est pas comptabilisée"), []);
  });
});

describe("la forme canonique", () => {
  it("ramène deux écritures du même montant à la même valeur", () => {
    assert.equal(canonique("64,600"), canonique("64.6"));
    assert.equal(canonique("1 240,500"), "1240.5");
    assert.equal(canonique("19 %"), "19");
  });

  it("refuse ce qui n'est pas un nombre", () => {
    assert.equal(canonique("bis"), null);
    assert.equal(canonique(""), null);
    assert.equal(canonique("12,34,56"), null);
  });
});

describe("l'article inventé", () => {
  it("est signalé quand rien ne le porte", () => {
    const v = controler({
      reponse: "Le code de la TVA, art. 47 bis, prévoit une exonération.",
      fragments: [fragment()],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(v.map((x) => x.code).includes("article_non_fourni"));
    assert.equal(v.find((x) => x.code === "article_non_fourni")?.suite, "retirer");
  });

  it("n'est PAS signalé quand l'article a été transmis", () => {
    const v = controler({
      reponse: "Le code de la TVA, art. 7, fixe le taux normal à 19%.",
      fragments: [fragment()],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(!v.map((x) => x.code).includes("article_non_fourni"));
  });

  it("n'est PAS signalé quand elle recopie un renvoi qu'elle a sous les yeux", () => {
    // L'article 89 renvoie lui-même aux articles 81 à 86 : les citer n'est
    // pas les inventer.
    const v = controler({
      reponse: "L'art. 89 renvoie aux pénalités de l'art. 81.",
      fragments: [
        fragment({
          corpus: "CDPF",
          numero: "89",
          extrait: "Article 89 … en sus des pénalités prévues par les articles 81 à 86 …",
        }),
      ],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(!v.map((x) => x.code).includes("article_non_fourni"));
  });
});

describe("l'édition et le statut", () => {
  it("signale une édition expirée, sans retirer la phrase", () => {
    const v = controler({
      reponse: "Le code de la TVA, art. 7, fixe le taux à 19%.",
      fragments: [fragment({ validFrom: "2023-01-01", validTo: "2024-01-01" })],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    const e = v.find((x) => x.code === "edition_perimee");
    assert.notEqual(e, undefined);
    assert.equal(e?.suite, "completer");
  });

  it("signale qu'une édition plus récente existe ailleurs", () => {
    const v = controler({
      reponse: "Le code de la TVA, art. 7, fixe le taux à 19%.",
      fragments: [fragment({ validFrom: "2023-01-01", validTo: "2024-01-01" })],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
      editionsPlusRecentes: [
        { numero: "7", corpus: "CTVA", validFrom: "2026-01-01", langue: "ar" },
      ],
    });
    assert.ok(v.map((x) => x.code).includes("edition_plus_recente"));
  });

  it("signale un article qui ne tient plus debout, et nomme son remplaçant", () => {
    const v = controler({
      reponse: "L'art. 7 s'applique.",
      fragments: [fragment({ statut: "abroge", abrogePar: "LF-2026 art. 12" })],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    const s = v.find((x) => x.code === "statut_non_en_vigueur");
    assert.ok((s?.detail ?? "").includes("LF-2026 art. 12"));
  });
});

describe("la portée d'une note commune", () => {
  const note = fragment({
    corpus: "NC-2019",
    numero: "23",
    autorite: "interpretative",
    opposableA: "administration",
    nature: "Note commune DGELF",
    extrait: "La présente note précise les modalités…",
  });

  it("est exigée quand la réponse s'appuie dessus", () => {
    const v = controler({
      reponse: "D'après l'art. 23, vous devez procéder ainsi.",
      fragments: [note],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(v.map((x) => x.code).includes("portee_non_dite"));
  });

  it("ne l'est plus quand la réponse la dit", () => {
    const v = controler({
      reponse: "D'après l'art. 23 — une note qui n'oblige que l'administration — vous pouvez…",
      fragments: [note],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(!v.map((x) => x.code).includes("portee_non_dite"));
  });
});

describe("le chiffre sans provenance", () => {
  it("est retiré quand il ne vient de nulle part", () => {
    const v = controler({
      reponse: "Votre crédit est de 4 812,300 TND.",
      fragments: [fragment()],
      chiffresAutorises: ["64.600"],
      aujourdhui: AUJOURDHUI,
    });
    const c = v.find((x) => x.code === "chiffre_sans_source");
    assert.notEqual(c, undefined);
    assert.equal(c?.suite, "retirer");
  });

  it("passe quand il vient du dossier", () => {
    const v = controler({
      reponse: "Votre crédit est de 64,600 TND.",
      fragments: [fragment()],
      chiffresAutorises: ["64.600"],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(!v.map((x) => x.code).includes("chiffre_sans_source"));
  });

  it("passe quand le taux est écrit dans le texte de loi transmis", () => {
    const v = controler({
      reponse: "Le taux normal est de 19%.",
      fragments: [fragment()],
      chiffresAutorises: [],
      aujourdhui: AUJOURDHUI,
    });
    assert.ok(!v.map((x) => x.code).includes("chiffre_sans_source"));
  });
});

describe("une réponse saine ne déclenche rien", () => {
  it("se tait entièrement", () => {
    const v = controler({
      reponse:
        "Vos achats sont à 19 %, et c'est correct. C'est le taux normal, fixé par le code de la TVA, art. 7.",
      fragments: [fragment()],
      chiffresAutorises: ["19"],
      aujourdhui: AUJOURDHUI,
    });
    assert.deepEqual(v, []);
  });
});
