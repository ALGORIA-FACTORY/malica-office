/**
 * La relecture des cellules se branche sur la production (24 novembre 2026).
 *
 * Le banc sans IA relisait seules les cellules d'un tableau que l'arithmétique contredit
 * (`relecture.ts`) ; la production ne le faisait pas. Elle le fait désormais, sur le relevé
 * de PaddleOCR, AVANT le Sudoku d'abord. Trois choses sont éprouvées ici, sans moteur ni base :
 *
 *   — la règle qui retient une relecture : les lignes deviennent prouvées, et rien de ce qui
 *     était prouvé ne bouge (`relectureRetenue`) ;
 *   — le réglage du cabinet (`lecture.relecture_cellules`) se lit sans repli ;
 *   — le branchement dans `runVisionRead` : le plan relu est celui que le Sudoku d'abord
 *     prouve ET celui que la lecture rend (donc celui que la base garde, R2) ; un plan
 *     fourni (le rattrapage) ne se relit pas ;
 *   — le Sudoku et le banc se chargent SANS base : le banc du moteur tourne sans
 *     `DATABASE_URL`. Le premier passage de cette livraison importait le journal dans
 *     `sudoku.ts`, qui ouvre la base à l'import, et le banc tombait avant de mesurer.
 *
 *   node --experimental-strip-types --test src/malica/lecture/la-relecture-des-cellules-se-branche.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";

import type { SortieDuSudoku } from "@malica/sudoku";

import type { ReglagesResolus } from "../../scan/reglages-comptables.ts";

import { refermerLeCoupeCircuit } from "./paddle.ts";
import { relectureDesCellules, relectureRetenue } from "./sudoku.ts";
import type { PageToken } from "./token-plan.ts";
import { runVisionRead, type Releve, type VisionSelection } from "./vision.ts";

/* ------------------------------------------------------------ LA RÈGLE PURE */

const cite = (valeur: string) => ({ valeur, refs: [{ page: 1, ordinal: 0 }] });

/** Une sortie du moteur réduite à ce que la règle lit. */
function sortie(o: {
  issue?: SortieDuSudoku["issue"];
  lignes?: "prouve" | "signale" | null;
  champs?: Record<string, [string | null, string]>;
  parties?: { statut: "prouve" | "signale" | "absent"; sens: "achat" | "vente" | null };
}): SortieDuSudoku {
  return {
    issue: o.issue ?? "prouvee",
    solutions: 1,
    combinaisons: 1,
    preuves: {},
    champs: Object.fromEntries(
      Object.entries(o.champs ?? { total_ht: ["100.000", "prouve"] }).map(([k, [v, statut]]) => [
        k,
        { valeur: v, refs: [], statut },
      ]),
    ),
    ...(o.lignes === null
      ? {}
      : {
          lignes: {
            statut: o.lignes ?? "prouve",
            taux_par_base: "",
            instances: [
              {
                designation: cite("Article"),
                quantite: cite("1"),
                prix: cite("100.000"),
                remise: null,
                montant: cite("100.000"),
                taux: null,
              },
            ],
          },
        }),
    ...(o.parties
      ? {
          parties: {
            ...o.parties,
            emetteur: { matricule: null, nom: null },
            client: { matricule: null, nom: null },
            tiers: null,
          },
        }
      : {}),
  } as unknown as SortieDuSudoku;
}

describe("une relecture des cellules n'est retenue que si elle prouve les lignes sans rien déplacer", () => {
  it("les lignes deviennent prouvées, les totaux restent : retenue", () => {
    assert.equal(
      relectureRetenue(sortie({ lignes: "signale" }), sortie({ lignes: "prouve" })),
      true,
    );
  });

  it("les lignes restent à vérifier : écartée (aucun gain)", () => {
    assert.equal(
      relectureRetenue(sortie({ lignes: "signale" }), sortie({ lignes: "signale" })),
      false,
    );
  });

  it("les lignes étaient déjà prouvées : écartée (rien à gagner, rien à risquer)", () => {
    assert.equal(
      relectureRetenue(sortie({ lignes: "prouve" }), sortie({ lignes: "prouve" })),
      false,
    );
  });

  it("la pièce n'est plus prouvée après : écartée", () => {
    assert.equal(
      relectureRetenue(
        sortie({ lignes: "signale" }),
        sortie({ issue: "aucune", lignes: "prouve" }),
      ),
      false,
    );
  });

  it("la pièce n'était pas prouvée avant : écartée (la relecture ne part que d'un centre prouvé)", () => {
    assert.equal(
      relectureRetenue(
        sortie({ issue: "aucune", lignes: "signale" }),
        sortie({ lignes: "prouve" }),
      ),
      false,
    );
  });

  it("un total prouvé change de valeur : écartée", () => {
    assert.equal(
      relectureRetenue(
        sortie({ lignes: "signale", champs: { total_ht: ["100.000", "prouve"] } }),
        sortie({ lignes: "prouve", champs: { total_ht: ["100.500", "prouve"] } }),
      ),
      false,
    );
  });

  it("un champ prouvé perd sa preuve : écartée", () => {
    assert.equal(
      relectureRetenue(
        sortie({
          lignes: "signale",
          champs: { total_ht: ["100.000", "prouve"], date_emission: ["2026-11-02", "prouve"] },
        }),
        sortie({
          lignes: "prouve",
          champs: { total_ht: ["100.000", "prouve"], date_emission: ["2026-11-02", "signale"] },
        }),
      ),
      false,
    );
  });

  it("un champ qui n'était pas prouvé peut changer : il n'engageait rien", () => {
    assert.equal(
      relectureRetenue(
        sortie({
          lignes: "signale",
          champs: { total_ht: ["100.000", "prouve"], numero_facture: ["F-1", "conforme"] },
        }),
        sortie({
          lignes: "prouve",
          champs: { total_ht: ["100.000", "prouve"], numero_facture: ["F-7", "conforme"] },
        }),
      ),
      true,
    );
  });

  it("des parties prouvées gardent leur preuve et leur sens, ou la relecture est écartée", () => {
    const avant = sortie({ lignes: "signale", parties: { statut: "prouve", sens: "achat" } });
    assert.equal(
      relectureRetenue(
        avant,
        sortie({ lignes: "prouve", parties: { statut: "prouve", sens: "vente" } }),
      ),
      false,
    );
    assert.equal(
      relectureRetenue(
        avant,
        sortie({ lignes: "prouve", parties: { statut: "signale", sens: "achat" } }),
      ),
      false,
    );
    assert.equal(
      relectureRetenue(
        avant,
        sortie({ lignes: "prouve", parties: { statut: "prouve", sens: "achat" } }),
      ),
      true,
    );
  });
});

/* ------------------------------------------------------------ LE RÉGLAGE */

describe("le réglage `lecture.relecture_cellules` se lit sans repli", () => {
  const reglages = (v: string | null) => ({ get: () => v }) as unknown as ReglagesResolus;

  it("active, coupée", () => {
    assert.equal(relectureDesCellules(reglages("active")), true);
    assert.equal(relectureDesCellules(reglages("coupee")), false);
  });

  it("absent ou inconnu : une erreur nommée, jamais un défaut deviné (R4)", () => {
    assert.throws(() => relectureDesCellules(reglages(null)), /reglage\.lecture\.illisible/);
    assert.throws(() => relectureDesCellules(reglages("parfois")), /reglage\.lecture\.illisible/);
  });
});

/* ------------------------------------------------------------ LE BRANCHEMENT */

describe("le plan relu est celui que la lecture prouve et rend", () => {
  const vraiFetch = globalThis.fetch;
  const avant = process.env["OCR_URL"];
  afterEach(() => {
    globalThis.fetch = vraiFetch;
    refermerLeCoupeCircuit();
    if (avant === undefined) delete process.env["OCR_URL"];
    else process.env["OCR_URL"] = avant;
  });

  const IMAGE = "data:image/png;base64,AA==";
  const SELECTION = { lines: [] } as unknown as VisionSelection;

  /** Un PaddleOCR qui lit deux lignes : « Total HT » et « 100,000 ». */
  function paddleQuiLit(): void {
    process.env["OCR_URL"] = "http://ocr.invalid";
    const lignes = [
      { texte: "Total HT", boite: [0.1, 0.8, 0.3, 0.82], confiance: 0.99 },
      { texte: "100,000", boite: [0.7, 0.8, 0.9, 0.82], confiance: 0.6 },
    ];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const adresse = String(url instanceof Request ? url.url : url);
      if (!adresse.startsWith("http://ocr.invalid"))
        throw new Error(`appel inattendu : ${adresse}`);
      const corps = [
        { vague: 1, lignes, modele: "essai", millisecondes: 1 },
        { vague: 2, lignes, marques: [], modele: "essai", millisecondes: 2 },
      ]
        .map((t) => JSON.stringify(t))
        .join("\n");
      return new Response(`${corps}\n`);
    }) as typeof fetch;
  }

  /** La relecture d'essai : le jeton « 100,000 » devient « 100,500 ». */
  const relu = (plan: readonly PageToken[]) =>
    plan.map((t) => (t.text === "100,000" ? { ...t, text: "100,500", confidence: 0.98 } : t));

  it("PaddleOCR : le Sudoku d'abord prouve le plan RELU, et la lecture rend ce même plan", async () => {
    paddleQuiLit();
    const vus: { releve?: Releve; prouve?: readonly PageToken[] } = {};
    const lu = await runVisionRead({
      dataUrl: IMAGE,
      mime: "image/png",
      taxCodes: [],
      relireLesCellules: async (plan, releve) => {
        vus.releve = releve;
        return relu(plan);
      },
      sudokuDAbord: async (plan, releve) => {
        vus.prouve = plan;
        assert.equal(releve.lecteur, "paddle", "le Sudoku d'abord sait quel lecteur a relevé");
        return SELECTION;
      },
    });
    assert.equal(vus.releve?.lecteur, "paddle");
    assert.deepEqual(
      vus.releve?.pages?.map((p) => [p.page, p.dataUrl]),
      [[1, IMAGE]],
      "la relecture reçoit l'image de la page",
    );
    assert.ok(
      vus.prouve?.some((t) => t.text === "100,500"),
      "le Sudoku d'abord lit le plan relu",
    );
    assert.ok(
      lu.tokens.some((t) => t.text === "100,500") && !lu.tokens.some((t) => t.text === "100,000"),
      "la lecture rend le plan relu : c'est lui que la base garde (R2)",
    );
  });

  it("une relecture qui rend le plan reçu ne change rien", async () => {
    paddleQuiLit();
    const lu = await runVisionRead({
      dataUrl: IMAGE,
      mime: "image/png",
      taxCodes: [],
      relireLesCellules: async (plan) => plan,
      sudokuDAbord: async () => SELECTION,
    });
    assert.ok(lu.tokens.some((t) => t.text === "100,000"));
  });

  it("un plan fourni (le rattrapage) ne se relit pas", async () => {
    let appelee = false;
    const plan: PageToken[] = [
      { page: 1, ordinal: 0, text: "100,000", x0: 0.7, y0: 0.8, x1: 0.9, y1: 0.82 },
    ];
    const lu = await runVisionRead({
      dataUrl: IMAGE,
      mime: "image/png",
      taxCodes: [],
      tokens: plan,
      relireLesCellules: async (p) => {
        appelee = true;
        return relu(p);
      },
      sudokuDAbord: async () => SELECTION,
    });
    assert.equal(appelee, false);
    assert.equal(lu.tokens[0]?.text, "100,000");
  });
});

/* ------------------------------------------------------------ SANS BASE */

describe("le Sudoku et le banc se chargent sans base", () => {
  it("aucun import n'exige DATABASE_URL", () => {
    const ici = fileURLToPath(new URL(".", import.meta.url));
    const env = { ...process.env };
    delete env["DATABASE_URL"];
    delete env["DATABASE_URL_ADMIN"];
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--input-type=module",
        "-e",
        "await import('./sudoku.ts'); await import('./banc-sans-ia.ts');",
      ],
      { cwd: ici, env, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
  });
});
