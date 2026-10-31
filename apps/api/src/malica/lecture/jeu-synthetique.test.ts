/**
 * Le banc du jeu synthétique : cent factures fictives sur la vraie chaîne.
 *
 * `outils/jeu-synthetique/mesure.json` est l'issue de chaque cas à la livraison
 * du banc (31 octobre 2026, après les corrections de la PR). Il ne se régénère
 * pas pour faire passer l'épreuve : un cas qui recule est une régression, quelle
 * qu'en soit la cause. Il se régénère quand un cas PROGRESSE
 * (`node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs`), et le
 * rapport (`RAPPORT.md`) avec lui.
 *
 * Sans `OCR_URL`, les photos et les carnets ne se relèvent pas : ils sortent
 * « non mesurés », et l'épreuve ne les juge pas. Les PDF, eux, se relèvent
 * toujours — leur couche de texte n'appelle aucun modèle.
 *
 *   node --experimental-strip-types --test src/malica/lecture/jeu-synthetique.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import {
  lesCas,
  mesurerLeJeu,
  tableau,
  type ResultatDuCas,
  type Verdict,
} from "./jeu-synthetique.ts";

const LIVRE = JSON.parse(
  readFileSync(
    new URL("../../../../../outils/jeu-synthetique/mesure.json", import.meta.url),
    "utf8",
  ),
) as Record<string, { verdict: Verdict; champsFaux: number }>;

describe("le jeu synthétique", () => {
  let r: ResultatDuCas[] = [];
  const mesure = (id: string) => r.find((x) => x.id === id);
  before(async () => {
    r = await mesurerLeJeu();
  });

  it("imprime son tableau", (t) => {
    t.diagnostic(`\n${tableau(r)}`);
    assert.equal(r.length, lesCas().length);
  });

  it("porte cent cas, tous synthétiques et nommés", () => {
    const cas = lesCas();
    assert.equal(cas.length, 100);
    assert.deepEqual(
      cas.filter((c) => c.synthetique !== true || !/\S/.test(c.provenance)).map((c) => c.id),
      [],
    );
  });

  it("chaque PDF se relève par sa couche de texte, sans modèle", () => {
    assert.deepEqual(
      r
        .filter((x) => x.rendu === "pdf" && x.lecteur !== "pdf-text")
        .map((x) => `${x.id} : ${x.detail}`),
      [],
    );
  });

  it("aucun cas exact ou refusé à bon droit ne recule", () => {
    const recules = Object.entries(LIVRE)
      .filter(([, l]) => l.verdict === "exacte" || l.verdict === "refus_juste")
      .filter(
        ([id, l]) =>
          mesure(id) && mesure(id)!.verdict !== "non_mesuree" && mesure(id)!.verdict !== l.verdict,
      )
      .map(([id, l]) => `${id} : ${l.verdict} → ${mesure(id)!.verdict} (${mesure(id)!.detail})`);
    assert.deepEqual(recules, []);
  });

  it("aucune écriture fausse nouvelle : proposer moins vaut mieux que proposer faux", () => {
    const nouvelles = r
      .filter((x) => x.verdict === "fausse" && LIVRE[x.id]?.verdict !== "fausse")
      .map((x) => `${x.id} : ${x.detail}`);
    assert.deepEqual(nouvelles, []);
  });

  it("aucun champ ne se lit moins bien qu'à la livraison du banc", () => {
    const pires = r
      .filter((x) => x.verdict !== "non_mesuree" && LIVRE[x.id])
      .filter((x) => x.champs.faux.length > LIVRE[x.id]!.champsFaux)
      .map((x) => `${x.id} : ${x.champs.faux.join(" ; ")}`);
    assert.deepEqual(pires, []);
  });
});
