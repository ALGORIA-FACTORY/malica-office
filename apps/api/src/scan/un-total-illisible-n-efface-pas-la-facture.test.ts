/**
 * Un total illisible n'efface pas une facture qui, elle, se lit.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. L'écran du cabinet affiche, sous « L'écriture du Socle » :
 * « Aucune écriture comptabilisée sur cette pièce : rien à superviser. »
 * Six pièces réelles sur six, aucune écriture.
 *
 * Le plan de jetons de la pièce `6a2d49aa` dit pourquoi, et il ne laisse place
 * à aucune interprétation :
 *
 *     158 | 3          159 | 561,300     ← Total HT, lu juste
 *     162 | 4          163 | 134,183     ← Total TTC, lisible
 *     169 | +          170 | 135,183     ← NET À PAYER, le « 4 » perdu
 *
 * La ligne « NET À PAYER » est imprimée en blanc sur bande noire. La
 * reconnaissance y a lu « + » là où la facture imprime « 4 ». Le modèle a
 * désigné cette ligne — c'est le montant à payer, le choix se défend — et la
 * plage recollée donne « + 135,183 », que rien ne peut lire.
 *
 * Alors la normalisation a mis TOUS les montants à `null` : les deux bases
 * (864,700 à 7 %, 2 696,600 à 19 %), la TVA, le timbre. Tous lus, tous cités,
 * tous jetés — pour un total qui n'est que leur RAPPEL.
 *
 * S'ensuit : verdict « anomalie à signaler », aucune écriture proposée, et un
 * cabinet à qui l'on dit qu'il n'y a rien à superviser.
 *
 * ======================================================= CE QUE CORRIGE CE TEST
 *
 * Le TTC n'est pas une donnée de plus : c'est la somme des autres, imprimée une
 * seconde fois. Quand il ne se lit pas alors que la TVA, elle, se lit, la
 * facture reste vérifiable — par sa TVA. On garde ce qui est lu, on nomme ce
 * qui ne l'est pas, et l'écriture se propose avec sa réserve.
 *
 * Ce qui reste fatal ne bouge pas : une BASE illisible, une TVA illisible, un
 * droit illisible. Eux ne se recomposent pas, et les inventer serait R2 violé.
 *
 *   node --experimental-strip-types --test src/scan/un-total-illisible-n-efface-pas-la-facture.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normaliserMontants } from "./normaliser-montants.ts";

/** Du paramétrage dans la vraie vie ; fixé ici par le test. */
const P = { decimales: 3, toleranceMineure: 1 };

/* La facture du 11 octobre, telle qu'elle imprime. */
const BASES = [
  { ht: "864,700", taux: "0.07" },
  { ht: "2 696,600", taux: "0.19" },
];
const TVA = "572,883"; // 60,529 + 512,354
/*
 * Le droit de timbre, tel que `analyse.ts` le passe : son montant est FIXÉ par
 * le pack de juridiction, et cette valeur attendue ancre l'échelle. « 1,000 »
 * se lit sinon 1 dinar ou 1 000 dinars, et rien, sans le TTC, ne tranche.
 *
 * Limite connue, antérieure à cette correction : un droit SANS montant fixe au
 * référentiel garde ses deux lectures, et comme il n'entre dans aucune équation
 * une fois le total écarté, la pièce reste « ambiguë ». Ce qui est décidé — les
 * bases, la TVA — est alors perdu avec lui. Départager champ par champ demande
 * une autre épreuve, et ce n'est pas celle-ci.
 */
const TIMBRE = { brut: "1,000", attendu: 1_000 };
/** Ce que la reconnaissance a rendu de « 4 135,183 », bande noire comprise. */
const TOTAL_PERDU = "+ 135,183";

describe("un total illisible n'efface pas une facture qui se lit", () => {
  it("garde les bases et la TVA, et dit quel total n'a pas été lu", () => {
    const r = normaliserMontants({ bases: BASES, tva: TVA, autres: [TIMBRE], ttc: TOTAL_PERDU }, P);

    // Avant : « illisible », et tout à null.
    assert.notEqual(r.etat, "illisible", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 864_700);
    assert.equal(r.montants.bases[1]!.ht, 2_696_600);
    assert.equal(r.montants.tva, 572_883);
    assert.equal(r.montants.autres[0], 1_000);

    // Le total n'est pas deviné : il reste vide, et il est NOMMÉ.
    assert.equal(r.montants.ttc, null);
    assert.equal(r.totalNonLu, TOTAL_PERDU);
    assert.match(r.raison, /total/i);

    // Ce que la pièce PORTE ne change pas : elle imprime bien un total.
    assert.equal(r.imprime.ttc, TOTAL_PERDU);
  });

  it("sans TVA, plus rien ne vérifie — et le total perdu est nommé quand même", () => {
    /*
     * Le total écarté et la TVA absente, il ne reste rien pour confronter les
     * lectures entre elles : « 1,000 » vaut un dinar ou mille. On ne feint pas
     * la vérification, et on ne retient rien.
     *
     * Ce qui change ici, et c'est tout l'objet : même dans ce refus, la pièce
     * dit QUEL total elle n'a pas su lire. Une perte silencieuse serait un
     * repli implicite.
     */
    const r = normaliserMontants({ bases: [BASES[1]!], autres: [TIMBRE], ttc: TOTAL_PERDU }, P);
    assert.equal(r.etat, "ambigu", r.raison);
    assert.equal(r.montants.bases[0]!.ht, null);
    assert.equal(r.totalNonLu, TOTAL_PERDU);
    assert.match(r.raison, /\+ 135,183/);
  });

  it("une base illisible reste fatale — elle ne se recompose pas", () => {
    const r = normaliserMontants(
      { bases: [{ ht: "+ 696,600", taux: "0.19" }], tva: TVA, ttc: "3 269,483" },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
    assert.equal(r.montants.bases[0]!.ht, null);
    assert.equal(r.totalNonLu, null);
  });

  it("une TVA illisible reste fatale, même si le total se lit", () => {
    const r = normaliserMontants(
      { bases: BASES, tva: "+ 72,883", autres: [TIMBRE], ttc: "4 135,183" },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
  });

  it("un total lisible garde son rang : rien ne signale de total perdu", () => {
    const r = normaliserMontants({ bases: BASES, tva: TVA, autres: [TIMBRE], ttc: "4 135,183" }, P);
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.ttc, 4_135_183);
    assert.equal(r.totalNonLu, null);
  });
});
