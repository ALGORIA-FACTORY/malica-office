/**
 * La relecture ciblée par Claude (décision du 8 novembre 2026) — sans aucun appel réseau.
 *
 * Ce qui se prouve ici : les cases choisies sont celles de l'outil mesuré ; la relecture
 * n'est qu'un candidat (une case illisible, deux nombres, une réponse cassée ne changent
 * rien) ; sans budget, sans clé ou coupée, rien n'est appelé ; non prouvée, la lecture
 * reste et le motif dit la case ; prouvée, une lecture nouvelle passe par la porte des
 * relectures, et chaque appel se journalise. Les valeurs sûres ne touchent jamais un montant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import type { Grille, SortieDuSudoku } from "@malica/sudoku";

import type { AppelApi } from "../appel-local.ts";

import {
  casesARelire,
  corpsDeLaRequete,
  decouper,
  estUneCaseDeMontant,
  leMontant,
  lireLaReponse,
  motifDeNonPreuve,
  planCandidat,
  positionDe,
  translitterer,
  type CaseDecoupee,
} from "./relecture-ciblee.ts";
import { afficherLesValeursSures } from "./sudoku.ts";
import type { PageToken } from "./token-plan.ts";
import { lireLaConfiguration, verifierLesCases } from "./verification.ts";

const jeton = (ordinal: number, text: string, x0: number, y0: number): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0,
  y0,
  x1: x0 + 0.15,
  y1: y0 + 0.02,
  confidence: 0.9,
});

const plan: PageToken[] = [
  jeton(0, "Facture", 0.1, 0.05),
  jeton(1, "Total HT", 0.5, 0.8),
  jeton(2, "1.000,000", 0.75, 0.8),
  jeton(3, "TVA 19%", 0.5, 0.85),
  jeton(4, "190,000", 0.75, 0.85),
  jeton(5, "Total TTC", 0.5, 0.9),
  jeton(6, "1.191,O00", 0.75, 0.9),
];

describe("les cases relues sont celles de l'outil mesuré", () => {
  it("une case de montant : chiffres latins, orientaux, ou leurs sosies, un séparateur au bout", () => {
    assert.ok(estUneCaseDeMontant("1.075,898"));
    assert.ok(estUneCaseDeMontant("٤٣٨٧،٢٦٩"));
    assert.ok(estUneCaseDeMontant("VA,517"));
    assert.ok(estUneCaseDeMontant("1,..."));
    assert.ok(!estUneCaseDeMontant("Total TTC"));
    assert.ok(!estUneCaseDeMontant("2026"));
    assert.ok(!estUneCaseDeMontant("71 334 556"));
  });

  it("d'abord les lectures étranges, puis du bas vers le haut, bornées par le réglage", () => {
    assert.deepEqual(
      casesARelire(plan, 40).map((t) => t.ordinal),
      [6, 4, 2],
    );
    assert.deepEqual(
      casesARelire(plan, 2).map((t) => t.ordinal),
      [6, 4],
    );
    assert.deepEqual(casesARelire([{ ...plan[2]!, page: 2 }], 40), []);
  });
});

describe("la relecture n'est qu'un candidat", () => {
  const cases: CaseDecoupee[] = casesARelire(plan, 40).map((t, i) => ({
    id: `C${i + 1}`,
    jeton: t,
    kase: "",
    ligne: "",
  }));

  it("une case lisible, réduite à son seul montant, remplace le texte de son jeton", () => {
    const { plan: candidat, changements } = planCandidat(plan, cases, [
      { id: "C1", texte: "1.191,000 DT", lisible: true },
      { id: "C2", texte: "190,000", lisible: true },
    ]);
    assert.equal(candidat[6]!.text, "1.191,000");
    assert.equal(candidat[4]!.text, "190,000");
    assert.deepEqual(
      changements.map((c) => c.ordinal),
      [6],
    );
    // Le plan d'origine ne bouge pas.
    assert.equal(plan[6]!.text, "1.191,O00");
  });

  it("illisible, vide, deux nombres : rien ne change", () => {
    const { changements } = planCandidat(plan, cases, [
      { id: "C1", texte: "", lisible: false },
      { id: "C2", texte: "19 % 190,000", lisible: true },
      { id: "C3", texte: "   ", lisible: true },
    ]);
    assert.deepEqual(changements, []);
  });

  it("les chiffres orientaux deviennent latins, les séparateurs arabes aussi", () => {
    assert.equal(translitterer("٧٥٤٣٫٩٠٤"), "7543,904");
    assert.equal(translitterer("١٬١١٧،٦٥٨"), "1 117,658");
    assert.equal(leMontant("5.780,238 س"), "5.780,238");
    assert.equal(leMontant("% 2 245,018"), "2 245,018");
    assert.equal(leMontant("12 et 34,5"), null);
  });

  it("une réponse qui n'est pas le JSON attendu ne rend rien", () => {
    assert.deepEqual(lireLaReponse({ content: [{ type: "text", text: "pas du json" }] }), []);
    assert.deepEqual(lireLaReponse({ content: [{ type: "text", text: '{"autre":1}' }] }), []);
    assert.deepEqual(
      lireLaReponse({
        content: [
          {
            type: "text",
            text: '{"cellules":[{"id":"C1","texte":"1,000","lisible":true},{"id":2}]}',
          },
        ],
      }),
      [{ id: "C1", texte: "1,000", lisible: true }],
    );
  });

  it("le motif nomme la case illisible la plus basse, son libellé et sa place", () => {
    const motif = motifDeNonPreuve(plan, cases, [{ id: "C1", texte: "", lisible: false }]);
    assert.deepEqual(motif, {
      code: "case_illisible",
      kase: { texte: "1.191,O00", libelle: "Total TTC", position: "bas_droite" },
    });
    assert.equal(motifDeNonPreuve(plan, cases, []).code, "ne_ferme_pas");
    assert.equal(positionDe(jeton(0, "x", 0.05, 0.05)), "haut_gauche");
  });

  it("la requête : consigne en cache, ligne puis case par case, réponse au schéma strict", () => {
    const corps = corpsDeLaRequete("claude-haiku-5-5", "consigne", cases.slice(0, 1)) as {
      model: string;
      system: Array<{ cache_control?: unknown }>;
      messages: Array<{ content: Array<{ type: string }> }>;
      output_config: { format: { type: string }; effort: string };
    };
    assert.equal(corps.model, "claude-haiku-5-5");
    assert.deepEqual(corps.system[0]!.cache_control, { type: "ephemeral" });
    assert.deepEqual(
      corps.messages[0]!.content.map((c) => c.type),
      ["text", "image", "text", "image", "text"],
    );
    assert.equal(corps.output_config.format.type, "json_schema");
    assert.equal(corps.output_config.effort, "low");
  });

  it("la découpe rend la case agrandie et sa ligne, en JPEG", async () => {
    const toile = createCanvas(800, 1000);
    const g = toile.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 800, 1000);
    const [d] = await decouper(toile.toBuffer("image/png"), [plan[6]!]);
    assert.ok(d);
    assert.equal(d.id, "C1");
    assert.ok(
      Buffer.from(d.kase, "base64")
        .subarray(0, 2)
        .equals(Buffer.from([0xff, 0xd8])),
    );
    assert.ok(Buffer.from(d.ligne, "base64").length > 0);
  });
});

/* ======================================================== LE FLUX, SANS RÉSEAU === */

const CONFIG = {
  actif: true,
  modele: "claude-haiku-5-5",
  cases_max: 40,
  lot: 6,
  consigne: { id: "c", texte: "consigne" },
  tarife: true,
  budget: { fournisseur: "anthropic", epuise: false },
};

function scene(options: { config?: unknown; abstention?: string | null; prouvee?: boolean }) {
  const appels: Array<{ methode: string; args: unknown[] }> = [];
  const api: AppelApi = {
    async rpc<T>(_depot: string, methode: string, args: unknown[] = []): Promise<T> {
      appels.push({ methode, args });
      if (methode === "verificationAFaire") {
        return {
          pieceId: "p1",
          extractionId: "x1",
          mode: "paddle",
          consigne: { lecteur: "paddle", paddleTente: true, plan },
          abstention: options.abstention ?? null,
        } as T;
      }
      if (methode === "configurationRelectureCiblee") return (options.config ?? CONFIG) as T;
      return null as T;
    },
    async contenu() {
      throw new Error("non appelé");
    },
  };
  const toile = createCanvas(400, 500);
  const sansIa: Array<readonly PageToken[]> = [];
  const preparer = (async () => ({
    contexte: { piece: { tenantId: "t1" }, packId: "pack" },
    parametres: { bytes: new Uint8Array(toile.toBuffer("image/png")), mime: "image/png" },
    sudoku: {
      async sansIa(tokens: readonly PageToken[]) {
        sansIa.push(tokens);
        return options.prouvee ? { totals: {}, lines: [], articles: [] } : null;
      },
      async lire(l: unknown) {
        return l;
      },
      async inscrire() {},
    },
    construire: () => ({
      extract: { document_kind: "facture_achat" },
      flags: [],
      citations: [],
      contract: "extract.v1",
    }),
  })) as never;
  const requetes: unknown[] = [];
  const appeler = async (corps: unknown) => {
    requetes.push(corps);
    return {
      reponse: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              cellules: [
                { id: "C1", texte: "1.191,000", lisible: true },
                { id: "C2", texte: "", lisible: false },
              ],
            }),
          },
        ],
        usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 700 },
      },
      latencyMs: 12,
    };
  };
  return { api, appels, requetes, appeler, preparer, sansIa };
}

describe("la vérification, en arrière-plan", () => {
  const travail = { travailId: "w1", pieceId: "p1" };

  it("coupée, budget épuisé ou absent, clé absente : rien n'est appelé, le motif reste", async () => {
    for (const [config, motif, cle] of [
      [{ ...CONFIG, actif: false }, "relecture.abstention.coupee", "k"],
      [{ ...CONFIG, budget: { epuise: true } }, "verification.non_relue.budget_epuise", "k"],
      [{ ...CONFIG, budget: null }, "verification.non_relue.sans_budget", "k"],
      [{ ...CONFIG, tarife: false }, "verification.non_relue.modele_sans_tarif", "k"],
      [CONFIG, "verification.non_relue.indisponible", undefined],
    ] as const) {
      const s = scene({ config });
      const r = await verifierLesCases(s.api, travail, { cle, preparer: s.preparer });
      assert.equal(r.motif, motif);
      assert.equal(s.requetes.length, 0);
      assert.ok(!s.appels.some((a) => a.methode === "persisterRelecture"));
    }
  });

  it("une correction humaine ou une lecture plus récente : abstention avant tout appel", async () => {
    const s = scene({ abstention: "correction_humaine" });
    const r = await verifierLesCases(s.api, travail, { appeler: s.appeler, preparer: s.preparer });
    assert.equal(r.motif, "relecture.abstention.correction_humaine");
    assert.equal(s.requetes.length, 0);
  });

  it("non prouvée : la lecture reste, le motif dit la case, chaque appel se journalise", async () => {
    const s = scene({ prouvee: false });
    const r = await verifierLesCases(s.api, travail, { appeler: s.appeler, preparer: s.preparer });
    assert.equal(r.motif, "verification.non_prouvee");
    assert.deepEqual((r.detail as { kase: unknown }).kase, {
      texte: "190,000",
      libelle: "TVA 19%",
      position: "bas_droite",
    });
    // Le Sudoku a rejoué sur le plan candidat : la case relue, et elle seule, a changé.
    assert.equal(s.sansIa[0]![6]!.text, "1.191,000");
    assert.equal(s.sansIa[0]![4]!.text, "190,000");
    assert.ok(!s.appels.some((a) => a.methode === "persisterRelecture"));
    const journal = s.appels.filter((a) => a.methode === "journaliserAgent").map((a) => a.args[0]);
    assert.deepEqual(
      journal.map((l) => [(l as { agent: string }).agent, (l as { role: string }).role]),
      [
        ["malica.lecture.relecture_ciblee", "chat"],
        ["malica.lecture.relecture_ciblee.cache", "cache"],
      ],
    );
  });

  it("prouvée : une lecture nouvelle par la porte des relectures, puis la pièce se rejuge", async () => {
    const s = scene({ prouvee: true });
    const r = await verifierLesCases(s.api, travail, { appeler: s.appeler, preparer: s.preparer });
    assert.equal(r.motif, "verification.prouvee");
    const persistee = s.appels.find((a) => a.methode === "persisterRelecture");
    assert.ok(persistee);
    const lecture = persistee.args[0] as { travailId: string; tokens: PageToken[] };
    assert.equal(lecture.travailId, "w1");
    assert.equal(lecture.tokens[6]!.text, "1.191,000");
    assert.ok(s.appels.some((a) => a.methode === "analyser"));
  });

  it("Claude en panne : la lecture reste, rien n'est rejoué, la panne se journalise", async () => {
    const s = scene({ prouvee: true });
    const r = await verifierLesCases(s.api, travail, {
      appeler: async () => {
        throw new Error("Claude 529 : surcharge");
      },
      preparer: s.preparer,
    });
    assert.equal(r.motif, "verification.non_relue.indisponible");
    assert.equal(s.sansIa.length, 0);
    const erreur = s.appels.find((a) => a.methode === "journaliserAgent")?.args[0] as {
      status: string;
    };
    assert.equal(erreur.status, "error");
  });

  it("la configuration se lit sans rien deviner", () => {
    assert.equal(lireLaConfiguration(null).actif, false);
    assert.equal(lireLaConfiguration({ ...CONFIG, budget: { epuise: "?" } }).budget?.epuise, true);
  });
});

/* ===================================================== LES VALEURS SÛRES === */

describe("les valeurs lues sûres, jamais un montant", () => {
  const grille = {
    code: "facture",
    champs: [
      { code: "telephone_email_emetteur", type: "texte" },
      { code: "total_ttc", type: "montant" },
      { code: "montant_en_lettres", type: "texte" },
      { code: "date_emission", type: "date" },
    ],
    preuves: [
      { code: "P13", statut: "arrete", expression: { op: "lettres", champ: "montant_en_lettres" } },
    ],
  } as unknown as Grille;
  const sortie = {
    issue: "aucune",
    champs: {
      telephone_email_emetteur: {
        valeur: "71 000 000",
        refs: [{ page: 1, ordinal: 1 }],
        statut: "signale",
      },
      total_ttc: { valeur: "1191000", refs: [{ page: 1, ordinal: 2 }], statut: "signale" },
      montant_en_lettres: { valeur: "mille", refs: [{ page: 1, ordinal: 3 }], statut: "signale" },
      date_emission: { valeur: "2026-11-08", refs: [{ page: 1, ordinal: 4 }], statut: "signale" },
    },
  } as unknown as SortieDuSudoku;

  it("un champ réglé sûr passe de « signalé » à « lu » ; les autres ne bougent pas", () => {
    const r = afficherLesValeursSures(sortie, {
      grille,
      champsSurs: ["telephone_email_emetteur", "total_ttc", "montant_en_lettres"],
    });
    assert.equal(r.champs["telephone_email_emetteur"]!.statut, "lu");
    assert.equal(r.champs["total_ttc"]!.statut, "signale");
    assert.equal(r.champs["montant_en_lettres"]!.statut, "signale");
    assert.equal(r.champs["date_emission"]!.statut, "signale");
  });

  it("aucun réglage : la sortie est rendue telle quelle", () => {
    assert.equal(afficherLesValeursSures(sortie, { grille, champsSurs: [] }), sortie);
  });
});
