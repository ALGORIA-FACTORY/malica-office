import assert from "node:assert/strict";
import { test } from "node:test";

import { jetonDouteux } from "./lexique.ts";

test("un signe étranger au français sur un mot connu sans ses accents est douteux", () => {
  // OCR PP-OCRv6 du 8 novembre 2026, algoria-044 : « Zennara Hötels SA »
  assert.equal(jetonDouteux("Hötels"), true);
  assert.equal(jetonDouteux("Hôtels"), false);
  // l'accent omis ou d'usage français n'est pas une mauvaise lecture
  assert.equal(jetonDouteux("telephone"), false);
  assert.equal(jetonDouteux("dépot"), false);
  assert.equal(jetonDouteux("Noël"), false);
  // un nom propre étranger reste un nom propre
  assert.equal(jetonDouteux("Müller"), false);
});

test("une capitale suivie d'un s au dessin d'un 5 est douteuse", () => {
  // OCR frais du staging, dirigeant 50/12 : « Flyers As recto-verso » pour « A5 »
  assert.equal(jetonDouteux("As"), true);
  assert.equal(jetonDouteux("A5"), false);
  // les unités et les sigles restent lus
  for (const t of ["Go", "To", "Mo", "AS", "Il"]) assert.equal(jetonDouteux(t), false, t);
});
