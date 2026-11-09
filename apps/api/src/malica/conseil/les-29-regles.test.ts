/**
 * Les 29 règles fiscales de Malica, une épreuve chacune — section 11 du
 * dirigeant, figée AVANT la reconstruction du chat.
 *
 * Les règles sont les lignes numérotées de `systemPrompt()` (`ask.ts`), de 1 à
 * 29, plus 1 bis et 20 bis : 31 lignes. Leur texte exact, tel qu'il est le
 * 9 novembre 2026, est figé dans `les-29-regles.json`.
 *
 * Chaque épreuve fige sa règle au niveau qu'on peut vérifier SANS modèle :
 *
 *   (a) le texte de la règle part dans la consigne réellement envoyée au
 *       modèle — dans chaque langue de réponse. La consigne n'existe qu'en
 *       français : en anglais et en arabe, c'est le même texte, et seule la
 *       ligne « Tu réponds exclusivement en … » change. (a) vaut pour les 31.
 *   (b) là où le serveur applique ou nourrit la règle — un contrôle, une
 *       relecture des sources, une section de l'invite, un garde —, ce chemin
 *       se comporte comme aujourd'hui, exercé avec le fournisseur simulé
 *       (`fournisseurs-simules.ts`) et une API en mémoire.
 *
 * Une règle en (a) seulement est une règle que rien, côté serveur, ne vérifie
 * ni ne prépare : elle ne tient que par le modèle. C'est dit dans son épreuve.
 *
 *   node --experimental-strip-types --test src/malica/conseil/les-29-regles.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import type { ReponseDeMalica } from "@malica/socle/ports/malica";

import { askMalica, systemPrompt } from "./ask.ts";
import {
  apiEnMemoire,
  simulerLesFournisseurs,
  TENANT_SIMULE,
  unFragment,
  unParametre,
  type MessageEnvoye,
} from "./fournisseurs-simules.ts";

interface Regle {
  numero: string;
  section: string;
  texte: string;
}

const REGLES = JSON.parse(
  readFileSync(new URL("./les-29-regles.json", import.meta.url), "utf8"),
) as Regle[];
const LOCALES = ["fr", "en", "ar"] as const;

type Scenario = Parameters<typeof apiEnMemoire>[0];

interface Pose {
  r: ReponseDeMalica;
  envoye: MessageEnvoye[];
  memoire: ReturnType<typeof apiEnMemoire>;
}

/** Une question posée à `askMalica`, réel, sur l'API en mémoire et le modèle simulé. */
async function poser(
  scenario: Scenario,
  options: {
    reponse?: Record<string, unknown>;
    locale?: string;
    question?: string;
    conversationId?: string | null;
    encodeurEnPanne?: boolean;
  } = {},
): Promise<Pose> {
  const sim = simulerLesFournisseurs({
    ...(options.reponse ? { reponse: options.reponse } : {}),
    ...(options.encodeurEnPanne ? { encodeurEnPanne: true } : {}),
  });
  const memoire = apiEnMemoire(scenario);
  try {
    const r = await askMalica(memoire.api, {
      tenantId: TENANT_SIMULE,
      question: options.question ?? "Quel est le taux de TVA sur mes ventes ?",
      locale: options.locale ?? "fr",
      conversationId: options.conversationId ?? "fil-existant",
    });
    return { r, envoye: sim.messagesDeLaReponse(), memoire };
  } finally {
    sim.restaurer();
  }
}

/** Le message système qui commence par cet en-tête. */
function section(envoye: MessageEnvoye[], entete: string): string {
  const m = envoye.find((x) => x.role === "system" && x.content.startsWith(entete));
  assert.ok(m, `aucune section « ${entete} » dans l'invite envoyée`);
  return m.content;
}

const codes = (r: ReponseDeMalica) => r.controles.map((v) => `${v.code}:${v.suite}`);

/** La consigne effectivement envoyée au modèle, par langue. */
const consignesEnvoyees = new Map<string, string>();

before(async () => {
  for (const locale of LOCALES) {
    const { envoye } = await poser({}, { locale });
    assert.equal(envoye[0]?.role, "system");
    consignesEnvoyees.set(locale, envoye[0]!.content);
  }
});

function regle(numero: string): Regle {
  const r = REGLES.find((x) => x.numero === numero);
  assert.ok(r, `la règle ${numero} n'est plus dans le relevé`);
  return r;
}

/** (a) — le texte exact de la règle part, en ligne entière, dans chaque langue. */
function partDansChaqueLangue(numero: string): void {
  const { texte } = regle(numero);
  for (const locale of LOCALES) {
    assert.ok(
      systemPrompt(locale).split("\n").includes(texte),
      `règle ${numero} absente de systemPrompt("${locale}")`,
    );
    assert.ok(
      consignesEnvoyees.get(locale)!.split("\n").includes(texte),
      `règle ${numero} absente de la consigne ENVOYÉE en ${locale}`,
    );
  }
}

describe("le relevé des règles", () => {
  it("31 lignes numérotées : 1 à 29, plus 1 bis et 20 bis, dans cet ordre", () => {
    const numeros = systemPrompt("fr")
      .split("\n")
      .map((l) => /^(\d+(?: bis)?)\. /.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    assert.deepEqual(
      numeros,
      REGLES.map((r) => r.numero),
    );
    assert.equal(numeros.length, 31);
  });

  it("la consigne n'existe qu'en français : seule la langue de réponse change", () => {
    const fr = consignesEnvoyees.get("fr")!;
    const en = consignesEnvoyees.get("en")!;
    const ar = consignesEnvoyees.get("ar")!;
    assert.ok(fr.includes("Tu réponds exclusivement en français."));
    assert.ok(en.includes("Tu réponds exclusivement en English."));
    assert.ok(ar.includes("Tu réponds exclusivement en العربية."));
    const sansLangue = (s: string) =>
      s
        .split("\n")
        .filter((l) => !l.startsWith("Tu réponds exclusivement en"))
        .join("\n");
    assert.equal(sansLangue(en), sansLangue(fr));
    assert.equal(sansLangue(ar), sansLangue(fr));
    // Une langue inconnue retombe sur le français.
    assert.equal(systemPrompt("de"), systemPrompt("fr"));
  });
});

describe("LES CHIFFRES", () => {
  it("règle 1 — on ne calcule jamais une valeur qui engage (a+b : contrôle chiffre_sans_source, chiffres du dossier autorisés)", async () => {
    partDansChaqueLangue("1");
    const contexte = {
      ecritures: [
        { id: "e1", date: "2026-10-31", journal: "OD", libelle: "TVA", status: "validee" },
      ],
      lignes: [
        {
          ecritureId: "e1",
          compte: "4366",
          libelle: "TVA due",
          debit: 0,
          credit: 741,
          taxCode: null,
        },
      ],
    };
    // Un montant du dossier, recopié : rien à dire.
    const cite = await poser(
      { contexte },
      { reponse: { reponse: "Votre TVA due est de 741,000 dinars.", conseil: false } },
    );
    assert.deepEqual(codes(cite.r), []);
    // Un montant recomposé, absent du dossier : retiré — au journal seulement (voir les contrôles).
    const recompose = await poser(
      { contexte },
      { reponse: { reponse: "Avec le crédit, cela fait 1 482,000 dinars.", conseil: false } },
    );
    assert.deepEqual(codes(recompose.r), ["chiffre_sans_source:retirer"]);
  });

  it("règle 1 bis — un décompte de pièces se donne (a+b : la clé `pieces` part au dossier, un décompte n'est pas contrôlé)", async () => {
    partDansChaqueLangue("1 bis");
    const pieces = [
      ...Array.from({ length: 4 }, () => ({ status: "lue" })),
      ...Array.from({ length: 2 }, () => ({ status: "capturee" })),
    ];
    const { r, envoye } = await poser(
      { contexte: { pieces } },
      {
        reponse: {
          reponse: "Deux factures attendent votre réponse, et 4 sont lues.",
          conseil: false,
        },
      },
    );
    assert.ok(section(envoye, "DOSSIER").includes(`"pieces":{"lue":4,"capturee":2}`));
    assert.deepEqual(codes(r), []);
  });

  it("règle 2 — un taux vient du PARAMÉTRAGE (a+b : section PARAMÉTRAGE envoyée, choisie d'après les articles remontés ; « 19 % » y trouve sa source)", async () => {
    partDansChaqueLangue("2");
    const { r, envoye, memoire } = await poser(
      {
        fragments: [unFragment({ extrait: "ARTICLE 7.- Le taux normal est fixé par la loi." })],
        parametres: [unParametre()],
      },
      { reponse: { reponse: "Vos ventes sont à 19 %.", conseil: false } },
    );
    const parametrage = section(envoye, "PARAMÉTRAGE");
    assert.ok(parametrage.includes("tva_taux_normal = 0.19 (taux, fraction) — Taux normal de TVA"));
    assert.ok(
      parametrage.includes("fondement : CTVA art. 7 · loi · en vigueur depuis le 2018-01-01"),
    );
    assert.deepEqual(memoire.premierArgument("corpus.parametresPour"), {
      jurisdiction: "TN",
      articles: [{ corpus: "CTVA", numero: "7" }],
      mots: ["taux", "ventes"],
      jour: null,
    });
    assert.deepEqual(codes(r), []);
  });

  it("règle 3 — une valeur non « confirmé » n'est pas un chiffre (a+b : le paramétrage la marque VALEUR <confiance>)", async () => {
    partDansChaqueLangue("3");
    const { envoye } = await poser({ parametres: [unParametre({ confiance: "estime" })] });
    assert.ok(section(envoye, "PARAMÉTRAGE").includes("— VALEUR ESTIME"));
  });

  it("règle 4 — un chiffre absent se dit absent (a seule : l'estimation ne se reconnaît pas sans modèle)", () => {
    partDansChaqueLangue("4");
  });

  it("règle 5 — l'enjeu d'un risque ne se calcule pas (a+b : une pénalité chiffrée sans source tombe sous chiffre_sans_source)", async () => {
    partDansChaqueLangue("5");
    const { r } = await poser(
      {},
      { reponse: { reponse: "Vous risquez une pénalité de 1 250,000 dinars.", conseil: false } },
    );
    assert.deepEqual(codes(r), ["chiffre_sans_source:retirer"]);
  });
});

describe("LE DROIT", () => {
  it("règle 6 — le droit se lit dans les textes transmis (a+b : le silence et la panne se disent ; sans source relue, certitude 0)", async () => {
    partDansChaqueLangue("6");
    const muet = await poser(
      {},
      {
        reponse: {
          reponse: "De mémoire, c'est 19 %.",
          conseil: true,
          portee: "generale",
          certitude: 0.9,
          sources: [{ corpus: "CTVA", numero: "7" }],
        },
      },
    );
    assert.equal(
      section(muet.envoye, "DROIT"),
      "DROIT : AUCUN TEXTE ne t'a été transmis pour cette question " +
        "(aucun texte ne répond à cette question). Dis-le à la personne, en une " +
        "phrase, et n'énonce aucune règle de mémoire. « sources » vide, « certitude » 0.",
    );
    assert.equal(muet.r.conseil?.certitude, 0);
    assert.deepEqual(muet.r.conseil?.sources, []);

    const panne = await poser({}, { encodeurEnPanne: true });
    assert.match(section(panne.envoye, "DROIT"), /\(corpus : encodage refusé \(503\)/);
  });

  it("règle 7 — article ET depuis quand (a+b : chaque texte part avec sa date ; un article non transmis est relevé)", async () => {
    partDansChaqueLangue("7");
    const { r, envoye } = await poser(
      { fragments: [unFragment()] },
      { reponse: { reponse: "Le code de la TVA, art. 47 bis, l'exonère.", conseil: false } },
    );
    assert.ok(section(envoye, "DROIT").includes("CTVA art. 7 (fr, en vigueur depuis 2026-01-01)"));
    assert.deepEqual(codes(r), ["article_non_fourni:retirer"]);
  });

  it("règle 8 — la hiérarchie des normes (a+b : chaque texte part avec sa nature et son autorité)", async () => {
    partDansChaqueLangue("8");
    const { envoye } = await poser({ fragments: [unFragment()] });
    assert.ok(
      section(envoye, "DROIT").includes(
        "  Loi ordinaire — normative — opposable à : administration, contribuable, juge — publié : JORT 2025/104",
      ),
    );
  });

  it("règle 9 — postérieur et spécial (a+b : la période de validité de chaque édition part avec elle)", async () => {
    partDansChaqueLangue("9");
    const { envoye } = await poser({
      fragments: [unFragment({ validFrom: "2023-01-01", validTo: "2024-01-01" })],
    });
    assert.ok(section(envoye, "DROIT").includes("en vigueur du 2023-01-01 au 2024-01-01"));
  });

  it("règle 10 — une convention ne crée jamais l'impôt (a seule : aucun garde côté serveur)", () => {
    partDansChaqueLangue("10");
  });

  it("règle 11 — une note commune n'oblige que l'administration (a+b : contrôle portee_non_dite, opposabilité envoyée)", async () => {
    partDansChaqueLangue("11");
    const note = unFragment({
      corpus: "NC-2019",
      numero: "23",
      autorite: "interpretative",
      opposableA: "administration",
      nature: "Note commune DGELF",
      extrait: "La présente note précise les modalités…",
    });
    const tue = await poser(
      { fragments: [note] },
      { reponse: { reponse: "D'après l'art. 23, procédez ainsi.", conseil: false } },
    );
    assert.ok(section(tue.envoye, "DROIT").includes("opposable à : administration"));
    assert.deepEqual(codes(tue.r), ["portee_non_dite:completer"]);
    const dite = await poser(
      { fragments: [note] },
      {
        reponse: {
          reponse:
            "D'après l'art. 23 — une note qui n'oblige que l'administration — procédez ainsi.",
          conseil: false,
        },
      },
    );
    assert.deepEqual(codes(dite.r), []);
  });

  it("règle 12 — un article qui n'est pas en vigueur ne fonde rien d'actuel (a+b : statut et remplaçant envoyés, contrôle statut_non_en_vigueur)", async () => {
    partDansChaqueLangue("12");
    const { r, envoye } = await poser(
      { fragments: [unFragment({ statut: "abroge", abrogePar: "LF-2026 art. 12" })] },
      { reponse: { reponse: "L'art. 7 s'applique.", conseil: false } },
    );
    assert.ok(section(envoye, "DROIT").includes("— STATUT : abroge (abrogé par LF-2026 art. 12)"));
    assert.deepEqual(codes(r), ["statut_non_en_vigueur:completer"]);
    assert.match(r.controles[0]!.detail, /remplacé par LF-2026 art\. 12/);
  });

  it("règle 13 — le droit du fait générateur (a+b, figé tel quel : le serveur cherche le droit du JOUR et juge à l'horloge)", async () => {
    partDansChaqueLangue("13");
    // Aujourd'hui le serveur ne déduit aucune date du fait générateur
    // (constat 3) : la recherche part sans jour, donc à `current_date`, et la
    // règle ne tient que par le modèle. La reconstruction entend le changer.
    const { memoire } = await poser({}, { question: "Quel était le taux de TVA en 2016 ?" });
    const recherche = memoire.premierArgument("corpus.rechercher") as Record<string, unknown>;
    assert.equal(recherche["jour"], null);
    assert.equal(recherche["historique"], false);
    assert.equal(recherche["nb"], 6);
    assert.equal(recherche["doctrine"], true);
  });

  it("règle 14 — une lecture partielle se rend en sens (a+b : la provenance part, contrôle lecture_incertaine)", async () => {
    partDansChaqueLangue("14");
    const { r, envoye } = await poser(
      { fragments: [unFragment({ provenance: "partiel" })] },
      { reponse: { reponse: "Selon l'art. 7, le régime s'applique.", conseil: false } },
    );
    assert.ok(section(envoye, "DROIT").includes("  provenance de la lecture : partiel"));
    assert.deepEqual(codes(r), ["lecture_incertaine:signaler"]);
  });

  it("règle 15 — l'arabe et le français font foi (a+b : les éditions plus récentes sont cherchées, contrôle edition_plus_recente)", async () => {
    partDansChaqueLangue("15");
    const fragment = unFragment({ validFrom: "2023-01-01", validTo: "2024-01-01" });
    const { r, memoire } = await poser(
      {
        fragments: [fragment],
        editionsPlusRecentes: [
          { corpus: "CTVA", numero: "7", validFrom: "2026-01-01", langue: "ar" },
        ],
      },
      { reponse: { reponse: "Selon l'art. 7, c'est exigible.", conseil: false } },
    );
    assert.deepEqual(memoire.premierArgument("corpus.editionsPlusRecentes"), [
      { corpus: "CTVA", numero: "7", validFrom: "2023-01-01" },
    ]);
    assert.deepEqual(codes(r), ["edition_perimee:completer", "edition_plus_recente:completer"]);
  });

  it("règle 16 — le corpus est tunisien, et lui seul (a seule : la distance ne sépare pas deux droits étrangers, le refus est dans la consigne)", () => {
    partDansChaqueLangue("16");
  });
});

describe("AVANT DE CONCLURE", () => {
  it("règle 17 — jamais sur un seul article (a seule)", () => {
    partDansChaqueLangue("17");
  });

  it("règle 18 — le taux dépend de l'opération (a seule)", () => {
    partDansChaqueLangue("18");
  });

  it("règle 19 — une charge non comptabilisée n'est pas déductible (a seule)", () => {
    partDansChaqueLangue("19");
  });

  it("règle 20 — une seule question, après avoir aidé (a seule)", () => {
    partDansChaqueLangue("20");
  });

  it("règle 20 bis — le régime vient de la fiche (a+b : la fiche part au dossier, nulle quand elle manque)", async () => {
    partDansChaqueLangue("20 bis");
    const sans = await poser({});
    assert.ok(section(sans.envoye, "DOSSIER").includes(`"fiche":null`));
    const avec = await poser({
      contexte: {
        fiche: {
          regimeImposition: "reel",
          regimeTva: "assujetti",
          prorataTva: null,
          secteur: "commerce",
          debutActivite: null,
          clotureExercice: "31-12",
        },
      },
    });
    assert.ok(section(avec.envoye, "DOSSIER").includes(`"regimeImposition":"reel"`));
  });
});

describe("LE DOUTE", () => {
  it("règle 21 — texte clair : on conclut (a+b : une source transmise garde la certitude déclarée, arrondie)", async () => {
    partDansChaqueLangue("21");
    const { r } = await poser(
      { fragments: [unFragment()] },
      {
        reponse: {
          reponse: "Vos ventes sont à 19 %, art. 7 du code de la TVA.",
          conseil: true,
          portee: "generale",
          theme: "Taux de TVA",
          certitude: 0.923,
          sources: [{ corpus: "CTVA", numero: "7" }],
          doute: null,
        },
      },
    );
    assert.equal(r.conseil?.certitude, 0.92);
    assert.deepEqual(
      r.conseil?.sources.map((s) => `${s.corpus} ${s.numero}`),
      ["CTVA 7"],
    );
    assert.equal(r.retenue, false);
  });

  it("règle 22 — une position de l'administration : réserve (a seule ; la portée d'une note se contrôle à la règle 11)", () => {
    partDansChaqueLangue("22");
  });

  it("règle 23 — contradiction ou silence : on expose et on dit qui tranche (a+b : le doute est gardé, une portée incertaine part au cabinet)", async () => {
    partDansChaqueLangue("23");
    const { r, memoire } = await poser(
      { fragments: [unFragment()], cabinet: { appelantMembre: true, cabinetId: "cabinet-simule" } },
      {
        reponse: {
          reponse: "Deux textes se contredisent ; votre comptable tranchera.",
          conseil: true,
          portee: "incertaine",
          theme: "Exonération à l'export",
          certitude: 0.4,
          sources: [{ corpus: "CTVA", numero: "7" }],
          doute: "L'art. 7 et la note commune divergent.",
        },
      },
    );
    assert.equal(r.retenue, true);
    assert.equal(r.conseil?.doute, "L'art. 7 et la note commune divergent.");
    const creer = memoire.premierArgument("conseil.creer") as Record<string, unknown>;
    assert.equal(creer["doute"], "L'art. 7 et la note commune divergent.");
    assert.equal(creer["statut"], "en_attente");
  });
});

describe("LA FORME", () => {
  it("règle 24 — la réponse d'abord, en une phrase (a seule)", () => {
    partDansChaqueLangue("24");
  });

  it("règle 25 — aucune mécanique interne ne sort (a seule)", () => {
    partDansChaqueLangue("25");
  });

  it("règle 26 — « les textes que j'ai sous les yeux » (a seule)", () => {
    partDansChaqueLangue("26");
  });

  it("règle 27 — ne jamais renvoyer le client chercher (a seule)", () => {
    partDansChaqueLangue("27");
  });
});

describe("LE FIL", () => {
  const fil = Array.from({ length: 20 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    contenu: `tour ${i}`,
  }));

  it("règle 28 — un changement de sujet (a+b : le fil part relu de la base, seize tours au plus, avant la question)", async () => {
    partDansChaqueLangue("28");
    const { envoye, memoire } = await poser({ fil }, { question: "Autre sujet : le timbre ?" });
    assert.deepEqual(memoire.premierArgument("conversations.ouvrir"), "fil-existant");
    const apresLaConsigneDeForme = envoye.slice(
      envoye.findIndex((m) => m.content.startsWith("LA FORME DE TA RÉPONSE")) + 1,
    );
    assert.deepEqual(
      apresLaConsigneDeForme.map((m) => m.content),
      [...fil.slice(-16).map((m) => m.contenu), "Autre sujet : le timbre ?"],
    );
  });

  it("règle 29 — un prolongement s'appuie sur l'établi (a+b : les tours passés gardent leur rôle)", async () => {
    partDansChaqueLangue("29");
    const { envoye } = await poser({ fil: fil.slice(0, 2) }, { question: "Et pour les hôtels ?" });
    assert.deepEqual(
      envoye.filter((m) => m.role !== "system").map((m) => `${m.role}:${m.content}`),
      ["user:tour 0", "assistant:tour 1", "user:Et pour les hôtels ?"],
    );
  });
});
