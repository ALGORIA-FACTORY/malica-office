/**
 * Un article marqué « abrogé » ne l'est que si son texte le dit vraiment (C1).
 *
 * 121 articles du corpus portaient le statut « abrogé » avec une version en
 * vigueur. Ces épreuves tiennent les trois causes relevées le 11 novembre 2026
 * (abrogation d'un seul alinéa, « abrogé et remplacé », mention du voisin) et
 * gardent les vraies pierres tombales abrogées.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { classerAbrogation } from "./statuts.mjs";

const v = (t) => classerAbrogation(t).verdict;

test("CIRPPIS 49 : une abrogation d'alinéa ne rend pas l'article abrogé", () => {
  const texte =
    "ARTICLE 49 :\n\nI. Le taux de l’impôt sur les sociétés, appliqué au bénéfice imposable arrondi au dinar inférieur, est fixé à 20% (Modifié Art 14-1 LF 2020-46 du 23/12/2020). " +
    "II. Les sociétés pétrolières sont soumises à un taux de 35% pour les bénéfices réalisés. (Abrogé Art 14-2 LF 2020-46 du 23/12/2020). " +
    "III. Le taux est fixé à 10% pour les entreprises exerçant dans le secteur agricole et de la pêche.";
  assert.equal(v(texte), "en_vigueur");
});

test("une pierre tombale reste abrogée : seule la mention est dans le texte", () => {
  assert.equal(v("Article 80 (Abrogé par la loi n° 96-62 du 15 juillet 1996).-"), "abroge");
  assert.equal(
    v(
      "Article 9.- (Abrogé par la loi n° 96-62 du 15 juillet 1996). Chapitre II Les obligations du salarié",
    ),
    "abroge",
  );
});

test("abrogé et remplacé : le numéro porte le texte de remplacement", () => {
  const t =
    "Article 76 (Abrogé et remplacé par art. 9 du décret-loi n° 2011-117 du 5 novembre 2011).- A l'exclusion des établissements bancaires, l'exercice de l'activité d'intermédiaire en assurance est incompatible avec toute autre activité à caractère commercial.";
  assert.equal(v(t), "en_vigueur");
});

test("la mention d'un article voisin ne rend pas abrogé l'article qui la porte", () => {
  const t =
    "الفصل12:I-تورد مؤسسات التوزيع التي إختارت صفة خاضع للأداء على القيمة المضافة زيوت البترول بتوقيف العمل بالأداء على القيمة المضافة. II-يحتسب الأداء على القيمة المضافة عند التوزيع. الكحول الفصل13: (ألغي بموجب الفصل 68 من قانون المالية عدد 89 لسنة 1991 المؤرخ في 31 ديسمبر 1991 .)";
  assert.equal(v(t), "en_vigueur");
});

test("parenthèses inversées et formes de présentation arabes", () => {
  assert.equal(v("اﻟفصل242–)أﻟغﻲ باﻟقانون عدد65ﻟﺳنﺔ2005اﻟمؤرخ ﻓﻲ27جويليﺔ2005("), "abroge");
});

test("« I- (Abrogé) II- … » : le premier alinéa seul est abrogé", () => {
  const t =
    "ARTICLE 6 -I- (Abrogé Art 77 LF 2002-101 du 17/12/2002) II- Sont dégrevés totalement de la taxe sur les immeubles bâtis les propriétaires dont les immeubles sont occupés à titre de résidence principale par leurs propriétaires.";
  assert.equal(v(t), "en_vigueur");
});

test("dans le doute, on ne tranche pas", () => {
  assert.equal(v(""), "incertain");
  assert.equal(v("Article 3"), "incertain");
});
