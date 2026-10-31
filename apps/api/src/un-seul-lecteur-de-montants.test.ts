/**
 * Un seul lecteur de montants : la table de tout ce que le dépôt imprime, et
 * deux oracles qui ne doivent rien à l'implémentation.
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
 * plan, ancien scan]. Chaque écart porte sa cause, et chaque cause une règle
 * du lecteur (`CAUSES`, plus bas).
 *
 * ================================================================= LES ORACLES
 *
 * Revue de la PR 144 : une table relevée sur l'implémentation est un
 * instantané, pas un oracle — elle aurait gardé, trois fois au moins, une
 * valeur fausse (« 1,000 » lu 1 franc CFA). Les valeurs attendues sont donc
 * tenues par deux sources indépendantes de `montant-imprime.ts` :
 *
 *   — `oracle`, plus bas : les règles écrites, réécrites ici par une autre
 *     voie (une grammaire d'expressions régulières, la répétition par force
 *     brute). La table entière doit lui être égale ;
 *   — `DECIDES_A_LA_MAIN` : les cas que le relecteur de la PR 144 a décidés à
 *     la main, chacun avec ses lectures justes. Deux écarts y sont tranchés
 *     contre lui, et dits.
 *
 * Elle ne se régénère pas pour faire passer l'épreuve : une ligne qui change
 * est un comportement qui change, et il se justifie ici.
 *
 *   node --experimental-strip-types --test src/un-seul-lecteur-de-montants.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { lireUnMontantImprime, type DeviseLue } from "@malica/socle/montant-imprime";

import { treillisMontant } from "./malica/lecture/montants.ts";
import { DEVISES_LUES_D_ESSAI, deviseDEssai } from "./scan/devise-d-essai.ts";
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
    "règle 5 : une parenthèse, appariée ou orpheline, ne se lit pas — négatif comptable, « (base 514,700) », ou avoir coupé (revue de la PR 144)",
  plus: "règle 5 : « + » n'est pas un signe — le « 4 » du total du 13 octobre ; le plan le lisait",
  taux: "règle 3 : « 19% » est un taux ; le plan le lisait 19 unités",
  zero_de_tete:
    "règle 8 : « 020,000 » est le morceau d'un montant coupé à l'espace des milliers ; les deux le lisaient",
  separateur_final: "règle 5 : « 8, » n'est pas fini ; le plan le lisait",
  virgule_decimale_du_dinar:
    "règle 7 : la virgule, séparateur décimal du dinar (`ref.devises`), ne sépare pas de milliers ; le scan lisait aussi « 100,000 » à l'anglaise",
  devise_sans_decimales:
    "règle 7 : une devise sans décimales n'en lit jamais — « 1,000 » ne vaut pas 1 franc CFA (revue de la PR 144)",
  bruit_de_colonne:
    "règle 10 : « | », « ; », « : » séparent deux occurrences (#135) ; le plan refusait",
  apostrophe: "règle 7 : l'apostrophe sépare des milliers ; le plan refusait",
  zeros_au_dela:
    "règle 7 : des zéros au-delà de l'exposant ne changent pas la valeur ; le plan refusait",
  devise_a_moins_de_trois_decimales:
    "règles 7 et 9 : à moins de trois décimales, le plan lit enfin comme le scan (zéros au-delà, milliers à la virgule, millimes en dernier groupe)",
};

const trie = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

/* ------------------------------------------------------------------ l'oracle */

const CHIFFRES = ["٠١٢٣٤٥٦٧٨٩", "۰۱۲۳۴۵۶۷۸۹"];
const cleDeMarque = (s: string) => s.normalize("NFKC").replace(/[\s.]/g, "").toUpperCase();
const MARQUES = new Set(DEVISES_LUES_D_ESSAI[0]!.marques.map((m) => cleDeMarque(m.marque)));

/**
 * Les règles de `montant-imprime.ts`, réécrites sans son code : ce que le
 * texte DOIT rendre. `arabesRefuses` : la politique du plan de jetons.
 */
function oracle(texte: string, exp: number, sepDec: string, arabesRefuses: boolean): number[] {
  let t = [...texte]
    .map((c) => {
      for (const serie of CHIFFRES) if (serie.includes(c)) return String(serie.indexOf(c));
      return c;
    })
    .join("");
  if (t !== texte && arabesRefuses) return [];
  if (/[%/+()]/.test(t) || /\d:\d/.test(t)) return [];
  t = t.replace(/٫/g, sepDec).replace(/[٬’]/g, "'");
  let inconnu = false;
  t = t.replace(/[\p{L}\p{M}\p{Sc}\p{So}]+(?:[.\s]*[\p{L}\p{M}\p{Sc}\p{So}]+)*\.?/gu, (w) => {
    if (MARQUES.has(cleDeMarque(w))) return " ";
    inconnu = true;
    return w;
  });
  if (inconnu) return [];
  t = t
    .replace(/\s+/g, " ")
    .replace(/ ?([.,]) ?/g, "$1")
    .trim();
  if (!t || !/^[\d.,' |;:-]+$/.test(t)) return [];
  const un = (s: string) => unMontant(s, exp, sepDec);
  const entier = un(t);
  if (entier.length) return entier;
  if (un(t.replace(/ /g, "")).length) return [];
  const jetons = t.split(/[\s|;:]+/).filter(Boolean);
  if (jetons.length < 2 || jetons.length > 20) return [];
  const vus = new Set<string>();
  const decouper = (i: number, cle: string | null, n: number): void => {
    if (i === jetons.length) {
      if (n >= 2 && cle) vus.add(cle);
      return;
    }
    for (let j = i + 1; j <= jetons.length; j++) {
      const l = un(jetons.slice(i, j).join(" "));
      if (l.length === 0) continue;
      const c = JSON.stringify(l);
      if (cle === null || c === cle) decouper(j, c, n + 1);
    }
  };
  decouper(0, null, 0);
  return vus.size === 1 ? (JSON.parse([...vus][0]!) as number[]) : [];
}

/** Un seul montant, par grammaire. */
function unMontant(brut: string, exp: number, sepDec: string): number[] {
  let s = brut.trim();
  let signe = 1n;
  if (s.startsWith("-")) {
    signe = -1n;
    s = s.slice(1).trim();
  }
  const rendu: number[] = [];
  const ajouter = (v: bigint) => {
    const n = Number(signe * v);
    if (Number.isSafeInteger(n) && !rendu.includes(n)) rendu.push(n);
  };
  const E = 10n ** BigInt(exp);
  if (/^0\d/.test(s)) return [];
  if (/^\d+$/.test(s)) {
    if (exp > 0 && s.length > exp) ajouter(BigInt(s));
    ajouter(BigInt(s) * E);
    return rendu.sort((a, b) => Math.abs(a) - Math.abs(b));
  }
  const echapper = (c: string) => (c === "." ? "\\." : c);
  if (exp > 0)
    for (const D of [".", ","])
      for (const T of [null, " ", "'", ".", ","]) {
        if (T === D) continue;
        const partie = T === null ? "(\\d+)" : `(\\d{1,3}(?:${echapper(T)}\\d{3})+)`;
        const m = new RegExp(`^${partie}${echapper(D)}(\\d+)$`).exec(s);
        if (!m || (T !== null && m[1]!.split(T)[0] === "0")) continue;
        if (/[1-9]/.test(m[2]!.slice(exp))) continue;
        ajouter(
          BigInt(m[1]!.replace(/[ '.,]/g, "")) * E +
            BigInt(m[2]!.slice(0, exp).padEnd(exp, "0") || "0"),
        );
      }
  for (const T of [" ", "'", ".", ","]) {
    const m = new RegExp(`^(\\d{1,3})((?:${echapper(T)}\\d{3})+)$`).exec(s);
    if (!m || m[1] === "0" || (T === sepDec && exp >= 3)) continue;
    const groupes = s.split(T);
    const n = BigInt(groupes.join(""));
    if (T === " " && groupes[groupes.length - 1]!.length === exp) ajouter(n);
    ajouter(n * E);
  }
  return rendu.sort((a, b) => Math.abs(a) - Math.abs(b));
}

/* ---------------------------------------------------- décidés à la main */

/**
 * Les cas de la revue de la PR 144, décidés à la main par le relecteur : les
 * lectures JUSTES de chaque texte (null : il ne doit pas se lire). Une lecture
 * rendue hors de cet ensemble est fausse ; une lecture juste absente aussi.
 */
const D3 = 3;
const D2 = 2;
const D0 = 0;
const DECIDES_A_LA_MAIN: ReadonlyArray<readonly [string, number, number[] | null]> = [
  ["1 234,560", D3, [1234560]],
  ["1.234,560", D3, [1234560]],
  ["1,234.560", D3, [1234560]],
  ["1 234 560", D3, [1234560, 1234560000]],
  ["1234560", D3, [1234560, 1234560000]],
  ["1234,560", D3, [1234560]],
  ["1234.560", D3, [1234560]],
  ["100,000", D3, [100000]],
  ["100.000", D3, [100000, 100000000]],
  ["2.800", D3, [2800, 2800000]],
  ["0,500", D3, [500]],
  ["0.500", D3, [500]],
  ["12,5", D3, [12500]],
  ["1 234,56", D3, [1234560]],
  ["1234,5600", D3, [1234560]],
  ["1234,5601", D3, null],
  ["-1 234,560", D3, [-1234560]],
  ["- 1 234,560", D3, [-1234560]],
  ["1 234,560-", D3, null],
  ["(1 234,560)", D3, null],
  ["1 234,560 DT", D3, [1234560]],
  ["DT 1 234,560", D3, [1234560]],
  ["1 234,560DT", D3, [1234560]],
  ["1.234,560 D.T.", D3, [1234560]],
  ["د.ت 1 234,560", D3, [1234560]],
  ["١ ٢٣٤٫٥٦٠", D3, [1234560]],
  ["١٢٣٤٫٥٦٠", D3, [1234560]],
  ["۱۲۳۴٫۵۶۰", D3, [1234560]],
  ["١٬٢٣٤٫٥٦٠", D3, [1234560]],
  ["1O0,000", D3, null],
  ["l 234,560", D3, null],
  ["1 234,56O", D3, null],
  ["19%", D3, null],
  ["19 % 1 234,560", D3, null],
  ["1 234,560 19%", D3, null],
  ["1 234,560 19", D3, null],
  ["1 234,560 1 234,560", D3, [1234560]],
  ["1 234,560 1 470,126", D3, null],
  ["+ 135,183", D3, null],
  ["08/09/2026", D3, null],
  ["23:18", D3, null],
  ["020,000", D3, null],
  /*
   * Tranché CONTRE la décision du relecteur, qui attendait 1 234,560 : sa
   * propre revue (P2-3) établit que « 1 234,560) » peut être un avoir coupé.
   * La fermante d'un mot coupé se retire au plan (`texteDuMontantCite`) ; le
   * texte seul ne se lit pas.
   */
  ["1 234,560)", D3, null],
  ["3,020.000,000", D3, null],
  ["1,000", D2, [100, 100000]],
  ["1.234,56 €", D2, [123456]],
  ["1,234.56", D2, [123456]],
  ["€1,234.56", D2, [123456]],
  ["1 234,56", D2, [123456]],
  ["12,345", D2, [1234500]],
  ["12.345", D2, [1234500]],
  ["1234,567", D2, null],
  ["-12,50 €", D2, [-1250]],
  ["1 234 560", D0, [1234560]],
  ["1.234.560", D0, [1234560]],
  ["1,234,560", D0, [1234560]],
  ["1 234 560 F CFA", D0, [1234560]],
  ["1 234 560 FCFA", D0, [1234560]],
  ["5.000", D0, [5000]],
  ["5,000", D0, [5000]],
  ["1 234,560", D0, null],
  ["10,5", D0, null],
  ["0", D3, [0]],
  ["٣ ٠٢٠٫٠٠٠", D3, [3020000]],
  ["1'234,560", D3, [1234560]],
  /*
   * Tranché CONTRE le doute du relecteur (« should refuse? ») : une espace
   * collée à un séparateur n'est pas un groupe de milliers (règle 6), et
   * « ,560 » ne peut pas être un montant à lui seul — un seul nombre se lit.
   */
  ["1 234 ,560", D3, [1234560]],
  ["TVA 19", D3, null],
  ["Total 1 234,560", D3, null],
];

/* ------------------------------------------------------------------ les épreuves */

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

  it("la table entière vaut l'oracle indépendant, ligne à ligne", () => {
    const ecarts = TABLE.filter(([texte, exposant, plan, scan]) => {
      const sep = deviseDEssai(exposant).separateurDecimal;
      return (
        JSON.stringify(oracle(texte, exposant, sep, true)) !== JSON.stringify(plan) ||
        JSON.stringify(trie(oracle(texte, exposant, sep, false))) !== JSON.stringify(scan)
      );
    });
    assert.deepEqual(ecarts, []);
  });

  it("chaque écart avec les anciens lecteurs porte une cause, et la cause une règle", () => {
    const sansCause = TABLE.filter((l) => l.length > 4 && !(String(l[4]) in CAUSES));
    assert.deepEqual(sansCause, []);
  });

  it("les deux chaînes lisent les mêmes valeurs ; seul le plan refuse les chiffres arabes", () => {
    const divergences = TABLE.filter(([texte, exposant, plan, scan]) => {
      if (JSON.stringify(trie(plan)) === JSON.stringify(scan)) return false;
      return !(
        plan.length === 0 && lireUnMontantImprime(texte, deviseDEssai(exposant)).chiffresArabes
      );
    });
    assert.deepEqual(divergences, []);
  });
});

describe("un seul lecteur de montants — les cas décidés à la main (revue de la PR 144)", () => {
  /** La devise d'un exposant : le dinar, l'euro ou le franc CFA du référentiel d'essai. */
  const devise = (exposant: number): DeviseLue =>
    DEVISES_LUES_D_ESSAI.find((d) => d.decimales === exposant)!;
  for (const [texte, exposant, justes] of DECIDES_A_LA_MAIN) {
    it(`« ${texte} » à ${exposant} décimale(s) : ${justes ? justes.join(" ou ") : "ne se lit pas"}`, () => {
      const lues = trie(
        lireUnMontantImprime(texte, devise(exposant)).lectures.map((l) => l.mineur),
      );
      assert.deepEqual(lues, justes ? trie(justes) : []);
    });
  }
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
    const d = deviseDEssai(3);
    assert.deepEqual(treillisMontant("+ 135,183", d), []);
    assert.deepEqual(candidatsMontant("+ 135,183", d), []);
  });
});
