/**
 * Un seul lecteur de montants : la table de tout ce que le dépôt imprime.
 *
 * ================================================================= POURQUOI
 *
 * Jusqu'au 30 octobre 2026, deux lecteurs lisaient les mêmes textes : celui du
 * plan de jetons (`treillisMontant`, R2) et celui de la normalisation du scan
 * (`candidatsMontant`, qui nourrit les contrôles et la proposition). Ils se
 * contredisaient sur 107 des 548 textes de ce corpus (à trois décimales) :
 * « + 135,183 », « (514,700) », « 100,000 », « ٣ ٠٢٠٫٠٠٠ »… Il n'y en a plus
 * qu'un (`@malica/socle/montant-imprime`), et ses règles y sont écrites.
 *
 * ================================================================= LA TABLE
 *
 * `un-seul-lecteur-de-montants.table.json` porte CHAQUE texte de montant du
 * dépôt — chaque littéral à chiffres des épreuves de lecture et du scan
 * (`malica/lecture/*.test.ts`, `scan/*.test.ts`), le jeu d'or (chaque jeton et
 * chaque plage désignée), la lecture d'essai, le témoin de mesure, et les
 * désaccords nommés par la PR 142 —, à trois décimales (le dinar), deux
 * (l'euro) et zéro (le franc CFA). Le relevé des 32 textes de la PR 142 n'est
 * pas dans le dépôt ; ses exemples nommés y sont.
 *
 * Une ligne : [texte, exposant, lectures au plan, lectures du scan], et quand
 * l'un des deux anciens lecteurs disait autre chose : [..., cause, ancien
 * plan, ancien scan]. Les anciennes valeurs ont été relevées en jouant les deux
 * anciens lecteurs sur le corpus, le 30 octobre 2026 ; chaque écart y porte sa
 * cause, et chaque cause renvoie à une règle du lecteur (`CAUSES`, plus bas).
 *
 * Elle ne se régénère pas pour faire passer l'épreuve : une ligne qui change
 * est un comportement qui change, et il se justifie ici.
 *
 *   node --experimental-strip-types --test src/un-seul-lecteur-de-montants.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { lireUnMontantImprime } from "@malica/socle/montant-imprime";

import { treillisMontant } from "./malica/lecture/montants.ts";
import { deviseDEssai } from "./scan/devise-d-essai.ts";
import { candidatsMontant } from "./scan/normaliser-montants.ts";

type Ligne =
  | [texte: string, exposant: number, plan: number[], scan: number[]]
  | [
      texte: string,
      exposant: number,
      plan: number[],
      scan: number[],
      cause: string,
      avantPlan: number[],
      avantScan: number[],
    ];

const TABLE = JSON.parse(
  readFileSync(new URL("./un-seul-lecteur-de-montants.table.json", import.meta.url), "utf8"),
) as Ligne[];

/** Pourquoi une lecture a changé le 30 octobre 2026 — la règle du lecteur qui le décide. */
const CAUSES: Readonly<Record<string, string>> = {
  parentheses:
    "règle 5 : une paire ne se lit pas — négatif comptable, ou « (base 514,700) » (15 octobre) ; le plan la lisait en négatif",
  plus: "règle 5 : « + » n'est pas un signe — le « 4 » du total du 13 octobre ; le plan le lisait",
  taux: "règle 3 : « 19% » est un taux ; le plan le lisait 19 unités",
  zero_de_tete:
    "règle 8 : « 020,000 » est le morceau d'un montant coupé à l'espace des milliers ; les deux le lisaient",
  separateur_final: "règle 5 : « 8, » n'est pas fini ; le plan le lisait",
  virgule_decimale_du_dinar:
    "règle 7 : la virgule, séparateur décimal du dinar (`ref.devises`), ne sépare pas de milliers ; le scan lisait aussi « 100,000 » à l'anglaise",
  "parenthese_orpheline+virgule_decimale_du_dinar":
    "règles 5 et 7 : la parenthèse orpheline est du bruit (le plan refusait), et la virgule du dinar est décimale (le scan doutait)",
  parenthese_orpheline:
    "règle 5 : une parenthèse sans partenaire est du bruit de plage (#135) ; le plan refusait",
  bruit_de_colonne:
    "règle 10 : « | », « ; », « : » séparent deux occurrences (#135) ; le plan refusait",
  apostrophe: "règle 7 : l'apostrophe sépare des milliers ; le plan refusait",
  zeros_au_dela:
    "règle 7 : des zéros au-delà de l'exposant ne changent pas la valeur ; le plan refusait",
  devise_a_moins_de_trois_decimales:
    "règles 7 et 9 : à moins de trois décimales, le plan lit enfin comme le scan (zéros au-delà, milliers à la virgule, millimes en dernier groupe)",
};

const trie = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

describe("un seul lecteur de montants — la table du dépôt", () => {
  it("couvre le corpus : 548 textes, aux trois exposants du référentiel", () => {
    assert.equal(new Set(TABLE.map((l) => l[0])).size, 548);
    assert.deepEqual([...new Set(TABLE.map((l) => l[1]))].sort(), [0, 2, 3]);
  });

  for (const ligne of TABLE) {
    const [texte, exposant, plan, scan] = ligne;
    it(`« ${texte} » à ${exposant} décimale(s)`, () => {
      const devise = deviseDEssai(exposant);
      assert.deepEqual(
        treillisMontant(texte, devise).map((h) => h.millimes),
        plan,
        "lecture au plan de jetons",
      );
      assert.deepEqual(
        trie(candidatsMontant(texte, devise).map((c) => c.mineur)),
        scan,
        "normalisation du scan",
      );
    });
  }

  it("chaque écart avec les anciens lecteurs porte une cause, et la cause une règle", () => {
    const sansCause = TABLE.filter((l) => l.length > 4 && !(String(l[4]) in CAUSES));
    assert.deepEqual(sansCause, []);
  });

  it("les deux chaînes lisent les mêmes valeurs ; seul le plan refuse les chiffres arabes", () => {
    /*
     * La preuve qu'il n'y a plus deux lecteurs : sur tout le corpus, le plan
     * et le scan rendent les MÊMES valeurs, à une politique près, écrite à un
     * seul endroit (`treillisMontant`) — le modèle de vision rend les
     * chiffres arabes inversés, le plan ne les lit pas.
     */
    const divergences = TABLE.filter(([texte, exposant, plan, scan]) => {
      if (JSON.stringify(trie(plan)) === JSON.stringify(scan)) return false;
      return !(
        plan.length === 0 && lireUnMontantImprime(texte, deviseDEssai(exposant)).chiffresArabes
      );
    });
    assert.deepEqual(divergences, []);
  });
});

describe("le total du 13 octobre — « + 135,183 »", () => {
  /*
   * `un-total-illisible-n-efface-pas-la-facture.test.ts` : « 4 135,183 »
   * imprimé en blanc sur bande noire, et la reconnaissance a rendu « + » pour
   * « 4 ». La normalisation le refusait déjà, et c'est ce refus qui laisse la
   * facture se vérifier par sa TVA ; le plan de jetons, lui, lisait 135,183 —
   * un total amputé de 4 000 dinars, à lecture unique, donc sans drapeau.
   */
  it("ne se lit dans aucune des deux chaînes", () => {
    const devise = deviseDEssai(3);
    assert.deepEqual(treillisMontant("+ 135,183", devise), []);
    assert.deepEqual(candidatsMontant("+ 135,183", devise), []);
  });
});
