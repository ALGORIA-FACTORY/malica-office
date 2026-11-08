/**
 * Un mot que l'OCR a pu mal lire, vu par le seul lexique — sans modèle.
 *
 * ================================================================== POURQUOI
 *
 * Les chiffres d'une ligne d'articles sont prouvés par le calcul ; sa désignation ne
 * l'est par rien, et l'OCR la lit parfois de travers avec assurance : « matérel »,
 * « chifres », « 2oo Mbps », « I'Ouest », « -Iot 1 » (pour « lot 1 »), « 'entreprise ».
 * Banc sans IA du 4 novembre 2026 : 7 des 9 désignations fausses restantes portaient un tel
 * mot. Avec les seules listes de mots, 19 des 556 justes se taisaient aussi
 * (« externalisée », « empilable ») ; les dictionnaires Hunspell, qui connaissent les
 * flexions, en gardent la plupart.
 *
 * ================================================================== CE QUI EST DOUTEUX
 *
 *   — une élision dont la lettre est perdue (« 'entreprise ») ou lue I (« I'Ouest ») ;
 *   — un petit nombre où un o, un l ou un I tient la place d'un chiffre (« 2oo », « 1o ») ;
 *   — un mot en minuscules absent des lexiques français et anglais (Hunspell et listes) ;
 *   — un mot capitalisé absent des lexiques, qu'une confusion classique de l'OCR (l↔i,
 *     o↔0, l↔1, rn↔m, c↔e) rend présent (« Iot » → « lot ») — sinon c'est un nom propre ;
 *   — un mot qui porte un signe étranger au français, inconnu tel qu'écrit et connu sans
 *     ses accents (« Hötels » pour « Hôtels »,
 *     OCR PP-OCRv6 du 8 novembre 2026, algoria-044) ;
 *   — deux signes, une capitale puis une lettre qui a le dessin d'un chiffre (« As » pour
 *     « A5 », OCR frais du staging, dirigeant 50/12 : « Flyers As recto-verso »).
 *
 * Ne sont jamais douteux : un sigle ou une marque en capitales, un terme à casse mêlée
 * (« vCPU »), un composé de deux mots connus (« autoforeuse », ou deux mots collés à
 * l'impression : « lotpalettisé »), l'abréviation d'un mot connu (« quadri »). L'arabe n'a pas de lexique ici :
 * il n'est jamais déclaré douteux par ce module.
 */
import motsAnglais from "an-array-of-english-words" with { type: "json" };
import motsFrancais from "an-array-of-french-words" with { type: "json" };
import dictionnaireAnglais from "dictionary-en";
import dictionnaireFrancais from "dictionary-fr";
import nspell from "nspell";

/** Les confusions classiques de l'OCR, dans les deux sens. */
const CONFUSIONS: readonly (readonly [string, string])[] = [
  ["l", "i"],
  ["i", "l"],
  ["0", "o"],
  ["o", "0"],
  ["1", "l"],
  ["l", "1"],
  ["rn", "m"],
  ["m", "rn"],
  ["c", "e"],
  ["e", "c"],
];

/** Les mots ne comptent pas en deçà : « de », « la », « se » sont des mots partout. */
const LONGUEUR_MIN = 3;
/** Une abréviation au moins aussi longue (« quadri ») : en deçà, tout commence un mot. */
const ABREVIATION_MIN = 5;
/** Un nombre au plus aussi long (« 2oo », « 1o ») ; au-delà, c'est un code. */
const NOMBRE_COURT = 4;

const sansAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

interface Lexique {
  /** Le mot existe-t-il, tel qu'écrit, ou sans ses accents (une pièce en omet souvent) ? */
  connait(mot: string): boolean;
  /**
   * Le mot est-il dans les listes de mots ? Plus strict que `connait` : Hunspell admet des
   * bribes (« rel ») qui feraient d'une mauvaise lecture (« matérel ») un composé.
   */
  liste(mot: string): boolean;
  /** Le mot commence-t-il un mot connu (une abréviation : « quadri », « maint ») ? */
  commence(debut: string): boolean;
  /** Le mot est-il connu AVEC ses accents (Hunspell, ou les listes telles qu'écrites) ? */
  accentue(mot: string): boolean;
}

let lexique: Lexique | null = null;

/**
 * Les lexiques, construits une fois, au premier mot qui en a besoin : les dictionnaires
 * Hunspell français et anglais (leurs flexions : « externalisée », « empilable »), et les
 * listes de mots des deux langues, sans accents — un mot imprimé sans ses accents
 * (« telephone ») n'est pas une mauvaise lecture.
 */
function lexiques(): Lexique {
  if (lexique) return lexique;
  const hunspell = [dictionnaireFrancais, dictionnaireAnglais].map((d) =>
    nspell({ aff: Buffer.from(d.aff), dic: Buffer.from(d.dic) }),
  );
  const listes = new Set([...motsFrancais, ...motsAnglais].map(sansAccents));
  const exactes = new Set([...motsFrancais, ...motsAnglais].map((m) => m.toLowerCase()));
  const ordonnes = [...listes].sort();
  lexique = {
    connait: (mot) => hunspell.some((h) => h.correct(mot)) || listes.has(sansAccents(mot)),
    liste: (mot) => listes.has(sansAccents(mot)),
    accentue: (mot) =>
      hunspell.some((h) => h.correct(mot) || h.correct(mot.toLowerCase())) ||
      exactes.has(mot.toLowerCase()),
    commence: (debut) => {
      const d = sansAccents(debut);
      let [bas, haut] = [0, ordonnes.length];
      while (bas < haut) {
        const milieu = (bas + haut) >> 1;
        if (ordonnes[milieu]! < d) bas = milieu + 1;
        else haut = milieu;
      }
      return ordonnes[bas]?.startsWith(d) === true && ordonnes[bas] !== d;
    },
  };
  return lexique;
}

/** Les variantes d'un mot par une confusion de l'OCR. */
function variantes(mot: string): string[] {
  return CONFUSIONS.flatMap(([a, b]) => {
    const out: string[] = [];
    for (let i = mot.indexOf(a); i >= 0; i = mot.indexOf(a, i + 1))
      out.push(mot.slice(0, i) + b + mot.slice(i + a.length));
    return out;
  });
}

function motDouteux(brut: string): boolean {
  const mot = brut.replace(/^['’]+|['’]+$/gu, "");
  // un petit nombre où une lettre tient la place d'un chiffre (« 2oo », « 1o ») — pas un
  // code, où une lettre est à sa place (« 8764010I » d'un matricule)
  if (
    mot.length <= NOMBRE_COURT &&
    /\d/u.test(mot) &&
    /[oOlI]/u.test(mot) &&
    /^[\doOlI]+$/u.test(mot)
  )
    return true;
  // deux signes : une capitale, puis une lettre au dessin d'un chiffre (« As » pour « A5 »)
  if (/^\p{Lu}s$/u.test(mot)) return true;
  if (mot.length < LONGUEUR_MIN || !/^[\p{Script=Latin}'’]+$/u.test(mot)) return false;
  if (/^I['’]/u.test(mot)) return true;
  return mot
    .split(/['’]/u)
    .filter((p) => p.length >= LONGUEUR_MIN)
    .some((p) => {
      const l = lexiques();
      // un sigle (« EPSON »), un terme technique à casse mêlée (« vCPU », « iPhone »)
      if (p === p.toUpperCase() || /\p{Ll}\p{Lu}/u.test(p)) return false;
      // un accent faux : inconnu tel qu'écrit, connu sans ses accents (« Hötels »)
      if (/[^\p{ASCII}àâçéèêëîïôùûüÿæœ]/iu.test(p) && !l.accentue(p) && l.liste(p)) return true;
      if (l.connait(p) || l.connait(p.toLowerCase())) return false;
      const bas = p.toLowerCase();
      // un composé ou deux mots que l'impression a collés (« autoforeuse », « lotpalettisé »)
      for (let i = LONGUEUR_MIN; i <= bas.length - LONGUEUR_MIN; i++)
        if (l.liste(bas.slice(0, i)) && l.liste(bas.slice(i))) return false;
      // une abréviation d'un mot connu (« quadri » pour « quadrichromie »)
      if (bas.length >= ABREVIATION_MIN && l.commence(bas)) return false;
      if (variantes(bas).some((v) => l.connait(v))) return true;
      return p[0] !== p[0]!.toUpperCase();
    });
}

/** Un jeton de l'OCR porte-t-il un mot que l'OCR a pu mal lire ? */
export function jetonDouteux(texte: string): boolean {
  // une élision dont la lettre est perdue : « 'entreprise »
  if (/(^|[^\p{L}])['’]\p{L}/u.test(texte) && !/\p{L}['’]/u.test(texte)) return true;
  return texte.split(/[^\p{L}\p{N}'’]+/u).some(motDouteux);
}
