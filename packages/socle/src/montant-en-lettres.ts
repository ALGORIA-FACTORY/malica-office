/**
 * Lire un montant écrit en toutes lettres : « mille deux cent trente-quatre
 * dinars et cinq cents millimes », « ألف ومائتان وأربعة وثلاثون دينارا وخمسمائة مليم ».
 *
 * ================================================================= POURQUOI
 *
 * Le 1er novembre 2026, au banc des 150 factures fictives, la pièce 100/D-04
 * imprimait « Trois mille deux cents dinars » sous un net à payer de
 * 9 676,890 : ses chiffres fermaient toute leur arithmétique, et elle sortait
 * PROUVÉE. Les lettres sont la seconde écriture du même montant ; quand elles
 * le contredisent, la pièce ne se prouve pas — elle se signale.
 *
 * ================================================================ CE QU'IL FAIT
 *
 * Il reçoit des mots (les jetons qui suivent le repère, dans l'ordre de
 * lecture) et le LEXIQUE du pack (`ref.nombres_en_lettres`,
 * `ref.devises_en_lettres`) : aucun mot n'est écrit ici (R4). Il rend le montant
 * en unités majeures et mineures de la devise nommée, et le nombre de mots
 * qu'il a lus — pour que la citation couvre exactement ces jetons (R2).
 *
 * Il ne devine rien. Un mot inconnu AU MILIEU du montant (« cinguante » pour
 * « cinquante ») arrête la lecture : si l'unité n'est pas encore lue, ou s'il
 * suit une liaison (« dinars et cing cents millimes », OCR de 100/A-13), il n'y
 * a pas de montant. Des nombres lus après l'unité majeure sans unité mineure
 * (« … dinars et six cent cinquante ») ne se rattachent à rien : pas de montant
 * non plus. Un montant illisible n'est jamais un montant faux.
 *
 * Module pur (R1).
 */
import { comparable } from "./mot-comparable.ts";

/**
 * La nature d'un mot de nombre (`ref.nombres_en_lettres.nature`) :
 *
 *   nombre          s'ajoute au groupe en cours (« trois », « vingt », « خمسمائة ») ;
 *   centaine        multiplie le groupe en cours (« deux cents ») ;
 *   multiplicateur  ferme le groupe (« mille », « آلاف ») ;
 *   liaison         ne compte pas (« et ») ;
 *   prefixe         se retire d'un mot inconnu (« و » de « ومائتان »), ou ne compte pas seul.
 */
export type NatureDuMot = "nombre" | "centaine" | "multiplicateur" | "liaison" | "prefixe";

export interface MotDeNombre {
  readonly mot: string;
  readonly nature: NatureDuMot;
  readonly valeur: number;
}

/** Une unité monétaire en lettres (`ref.devises_en_lettres`). */
export interface UniteEnLettres {
  readonly mot: string;
  readonly devise: string;
  readonly unite: "majeure" | "mineure" | "qualificatif";
}

export interface LexiqueDesLettres {
  readonly mots: readonly MotDeNombre[];
  readonly unites: readonly UniteEnLettres[];
}

export interface MontantEnLettres {
  readonly devise: string;
  readonly majeures: number;
  /** Les unités mineures lues ; nulles quand la pièce n'en écrit pas. */
  readonly mineures: number | null;
  /** Le nombre de mots (jetons) lus, à partir du premier. */
  readonly mots: number;
}

type Entree =
  | { readonly genre: "mot"; readonly nature: NatureDuMot; readonly valeur: number }
  | { readonly genre: "unite"; readonly devise: string; readonly unite: UniteEnLettres["unite"] };

interface Index {
  readonly entrees: ReadonlyMap<string, Entree>;
  readonly prefixes: readonly string[];
  /** Le plus grand nombre de morceaux d'un mot composé (« quatre-vingt » : 2). */
  readonly composes: number;
}

const INDEX = new WeakMap<LexiqueDesLettres, Index>();

/** La clé d'un mot : comparable, et un mot composé se joint par un trait d'union. */
const cle = (s: string) =>
  comparable(s)
    .trim()
    .split(/[\s-]+/u)
    .join("-");

function indexDe(lexique: LexiqueDesLettres): Index {
  const deja = INDEX.get(lexique);
  if (deja) return deja;
  const entrees = new Map<string, Entree>();
  for (const m of lexique.mots) {
    entrees.set(cle(m.mot), { genre: "mot", nature: m.nature, valeur: m.valeur });
  }
  for (const u of lexique.unites) {
    entrees.set(cle(u.mot), { genre: "unite", devise: u.devise, unite: u.unite });
  }
  const index: Index = {
    entrees,
    prefixes: lexique.mots.filter((m) => m.nature === "prefixe").map((m) => cle(m.mot)),
    composes: Math.max(1, ...[...entrees.keys()].map((k) => k.split("-").length)),
  };
  INDEX.set(lexique, index);
  return index;
}

/** Un morceau de mot, et le jeton qui le porte. */
interface Morceau {
  readonly texte: string;
  readonly jeton: number;
}

/** Les morceaux d'une suite de jetons : sans ponctuation, coupés aux traits d'union. */
function morceaux(jetons: readonly string[]): Morceau[] {
  return jetons.flatMap((t, jeton) =>
    comparable(t)
      .split(/[\s-]+/u)
      .map((m) => m.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter((m) => m.length > 0)
      .map((texte) => ({ texte, jeton })),
  );
}

/**
 * Lire le montant en lettres qui commence au premier jeton.
 *
 * `null` : aucun montant lisible — un mot inconnu avant l'unité, une unité sans
 * nombre, des nombres sans unité, deux devises.
 */
export function lireLeMontantEnLettres(
  jetons: readonly string[],
  lexique: LexiqueDesLettres,
): MontantEnLettres | null {
  const index = indexDe(lexique);
  const ms = morceaux(jetons);

  let total = 0;
  let groupe = 0;
  let nombres = 0; // mots de nombre lus depuis la dernière unité
  let devise: string | null = null;
  let majeures: number | null = null;
  let mineures: number | null = null;
  let fin = -1; // dernier jeton rattaché à une unité
  let lie = false; // le dernier mot lu est une liaison : la phrase continue

  const ferme = () => {
    const v = total + groupe;
    total = 0;
    groupe = 0;
    nombres = 0;
    return v;
  };

  let i = 0;
  lecture: while (i < ms.length) {
    // Le plus long mot composé connu (« quatre-vingt-dix » : « quatre-vingt », puis « dix »).
    let entree: Entree | undefined;
    let n = Math.min(index.composes, ms.length - i);
    for (; n >= 1; n--) {
      entree = index.entrees.get(
        ms
          .slice(i, i + n)
          .map((m) => m.texte)
          .join("-"),
      );
      if (entree) break;
    }
    if (!entree) {
      // Un préfixe collé à un mot connu (« ومائتان »), jamais à un mot inconnu.
      const p = index.prefixes.find((p) => ms[i]!.texte.startsWith(p));
      const reste = p ? index.entrees.get(ms[i]!.texte.slice(p.length)) : undefined;
      // « … dinars et cing cents millimes » : la phrase continuait, et le mot n'est pas lu.
      // Ce qui suit la liaison manque au montant : il n'y a pas de montant.
      if (!reste && lie) return null;
      if (!reste) break;
      entree = reste;
      n = 1;
    }
    const jeton = ms[i + n - 1]!.jeton;
    i += n;

    lie = entree.genre === "mot" && (entree.nature === "liaison" || entree.nature === "prefixe");
    if (entree.genre === "mot") {
      switch (entree.nature) {
        case "nombre":
          groupe += entree.valeur;
          nombres++;
          break;
        case "centaine":
          groupe = Math.max(groupe, 1) * entree.valeur;
          nombres++;
          break;
        case "multiplicateur":
          total += Math.max(groupe, 1) * entree.valeur;
          groupe = 0;
          nombres++;
          break;
        default:
          break; // liaison, préfixe seul
      }
      continue;
    }

    if (entree.unite === "qualificatif") {
      if (fin >= 0) fin = jeton;
      continue;
    }
    if (nombres === 0 || (devise !== null && devise !== entree.devise)) return null;
    devise = entree.devise;
    if (entree.unite === "majeure") {
      if (majeures !== null) return null;
      majeures = ferme();
      fin = jeton;
      continue;
    }
    mineures = ferme();
    fin = jeton;
    // Un qualificatif peut suivre (« millimes tunisiens ») ; rien d'autre ne compte.
    while (i < ms.length) {
      const q = index.entrees.get(ms[i]!.texte);
      if (q?.genre !== "unite" || q.unite !== "qualificatif") break lecture;
      fin = ms[i]!.jeton;
      i++;
    }
    break;
  }

  // Des nombres lus que nulle unité ne ferme : on ne sait pas ce qu'ils comptent.
  if (devise === null || nombres > 0) return null;
  return { devise, majeures: majeures ?? 0, mineures, mots: fin + 1 };
}
