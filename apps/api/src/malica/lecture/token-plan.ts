import type { FieldCitation, PageToken, ReadFlag, TokenRef } from "@malica/socle/ports/malica";

import { enDecimal, treillisMontant, type Hypothese } from "./montants.ts";
/**
 * Plan de tokens — R2 « zéro hallucination dès la lecture ».
 *
 * Le plan de tokens est la seule vérité de ce qui est écrit sur la pièce.
 * Le modèle de vision ne transcrit jamais un montant : il désigne un token
 * (page + ordinal) déjà présent dans ce plan. Toute valeur émise est ensuite
 * relue depuis le texte du token — jamais depuis la réponse du modèle.
 *
 * Module pur : aucun réseau, aucune base, aucun framework.
 */

export interface CitationBinding {
  zone?: string | null;
  uiField?: string | null;
}

/** Retrouve un token dans le plan. */
function findToken(tokens: readonly PageToken[], ref: TokenRef): PageToken | null {
  return tokens.find((t) => t.page === ref.page && t.ordinal === ref.ordinal) ?? null;
}

/**
/**
 * ================================== CE QUI A ÉTÉ RETIRÉ D'ICI, ET POURQUOI
 *
 * Ce module portait `normalizeAmount`, qui rendait UNE valeur par token. Pour
 * y arriver, il tranchait ce que le papier ne tranche pas : « 2.800 » y était
 * lu 2 800 dinars, par une règle fixe. Sur un ticket, c'est 2,800 dinar — et
 * l'erreur ne se voyait pas, puisque le résultat avait la forme d'un montant.
 *
 * La lecture d'un montant vit désormais dans `montants.ts` : elle rend TOUTES
 * les lectures admissibles, et c'est l'arithmétique de la facture qui choisit
 * (`lireMontantDuPlan`, plus bas). Ce qu'elle ne choisit pas est demandé à
 * l'écran plutôt que deviné.

/**
 * Une date existe-t-elle vraiment ?
 *
 * ============================================== POURQUOI CE CONTRÔLE EXISTE
 *
 * La version précédente assemblait les trois nombres sans les vérifier. Un
 * token mal découpé — « 45/13/2026 », ou une date américaine « 12/25/2026 »
 * lue comme jour/mois — produisait « 2026-13-45 » : une chaîne parfaitement
 * conforme au format ISO, donc acceptée par le contrat, et pourtant impossible.
 *
 * Sur un produit fiscal, ce n'est pas un détail de présentation : la date
 * décide de la PÉRIODE DE TVA et du taux applicable. Une date fausse qui passe
 * les contrôles est pire qu'une date absente, qui elle se voit.
 */
function dateReelle(y: string, m: string, d: string): boolean {
  const annee = Number(y);
  const mois = Number(m);
  const jour = Number(d);
  if (mois < 1 || mois > 12 || jour < 1) return false;
  // Le mois 0 du mois suivant : le dernier jour du mois demandé.
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return jour <= dernier;
}

/**
 * Les chiffres arabes et persans, ramenés aux latins.
 *
 * Une facture tunisienne peut porter « ١٥ سبتمبر ٢٠٢٦ ». Les deux séries de
 * chiffres sont contiguës dans Unicode, donc la conversion est un décalage —
 * pas une table, pas un cas particulier.
 *
 * Volontairement limité aux DATES. Les montants en chiffres arabes ne sont
 * toujours pas lus (`montants.test.ts` verrouille ce refus) : élargir la
 * lecture d'un montant demande le banc du jeu d'or, pas une ligne ici.
 */
function enChiffresLatins(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * Ce qui rend deux écritures d'un même mois comparables.
 *
 * Une OCR rend « fevrier » aussi souvent que « février » : refuser le premier
 * reviendrait à perdre la date pour un accent. On décompose donc, puis on
 * retire les marques — mais en DEUX plages, et c'est le piège qui a coûté un
 * test rouge : « أغسطس » décomposé donne « ا » suivi de U+0654, qui vit dans
 * le bloc arabe et non dans celui des diacritiques latins. Retirer seulement
 * U+0300–U+036F réunit « février » et « fevrier », et laisse « أوت » et
 * « اوت » distincts.
 *
 * Les marques arabes retirées couvrent aussi le tashkeel (U+064B–U+0652) :
 * une facture vocalisée se lit comme une facture qui ne l'est pas.
 */
function comparable(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ؐ-ًؚ-ٰٟ]/g, "")
    .toLowerCase();
}

/**
 * Les mois, en toutes lettres.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, une vraie facture portait « Tunis, le 1 septembre 2026 ».
 * Le produit a rendu `null`, le contrat exige la date, et la pièce entière est
 * sortie partielle. Aucun nom de mois n'existait alors dans le code de lecture.
 *
 * Les deux séries arabes sont présentes, et ce n'est pas un excès de zèle : la
 * Tunisie dit « جانفي », « فيفري », « أوت », là où le Machrek dit « يناير »,
 * « فبراير », « أغسطس ». Une facture peut porter l'une ou l'autre, et l'arabe
 * fait foi.
 */
const MOIS: Readonly<Record<string, number>> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  // Arabe du Maghreb.
  جانفي: 1,
  فيفري: 2,
  افريل: 4,
  ماي: 5,
  جوان: 6,
  جويلية: 7,
  اوت: 8,
  // Arabe du Machrek, employé aussi par une partie des éditeurs.
  يناير: 1,
  فبراير: 2,
  ابريل: 4,
  مايو: 5,
  يونيو: 6,
  يوليو: 7,
  اغسطس: 8,
  // Communs aux deux.
  مارس: 3,
  سبتمبر: 9,
  اكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
};

/*
 * « 1er septembre 2026 », « le 15 mars 2026 ».
 *
 * L'année est exigée sur QUATRE chiffres. Une date en lettres abrégée —
 * « 15 mars 26 » — est refusée plutôt que rattachée au siècle courant : sur
 * une pièce comptable, choisir un siècle au jugé est une écriture fausse, et
 * la date décide de la période de TVA.
 */
const MOTIF_EN_LETTRES = new RegExp(
  `(\\d{1,2})\\s*(?:er|re)?\\s+(${Object.keys(MOIS).join("|")})\\s+(\\d{4})`,
);

export function normalizeDate(text: string): string | null {
  const s = enChiffresLatins(text.trim());
  const rendre = (y: string, m: string, d: string): string | null =>
    dateReelle(y, m, d) ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;

  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return rendre(iso[1]!, iso[2]!, iso[3]!);

  const dmy = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const yRaw = dmy[3]!;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    // Jour/mois : la convention tunisienne et française. On ne bascule PAS sur
    // mois/jour quand le premier nombre dépasse 12 — ce serait deviner la
    // provenance du document, et une écriture datée au jugé est une écriture
    // fausse. Une date qui n'existe pas est rendue absente, et demandée.
    return rendre(y, dmy[2]!, dmy[1]!);
  }

  const lettres = comparable(s).match(MOTIF_EN_LETTRES);
  if (lettres) return rendre(lettres[3]!, String(MOIS[lettres[2]!]), lettres[1]!);

  return null;
}

/**
 * La citation d'une plage de tokens : ce que l'écran surligne, et à quel titre.
 *
 * ============================================= POURQUOI UNE PLAGE, ET NON UN TOKEN
 *
 * Elle ne prenait qu'un token, et perdait donc `ordinalEnd`. Trois
 * conséquences, trouvées le 5 octobre 2026 :
 *
 *   — l'écran surlignait « 2 » d'un montant imprimé « 2 800,000 » : il montrait
 *     à la personne un chiffre qui n'était pas celui qu'on lui annonçait ;
 *   — la relecture d'audit ne pouvait pas retrouver la valeur à partir de sa
 *     citation, ce qui est exactement ce que R2 promet ;
 *   — `analyse.ts` annonçait en commentaire réassembler les tokens cités d'un
 *     champ — un `join(" ")` qui ne joignait jamais rien, faute de second token.
 *
 * Le cadre rendu est l'UNION des tokens de la plage. Pour un token seul, c'est
 * son cadre, et `ordinalEnd` reste absent : une plage d'un token n'est pas une
 * plage, et la citation ne doit pas prétendre le contraire.
 */
function citer(
  plage: readonly PageToken[],
  field: string,
  role: "montant" | "date" | "texte",
  zone?: string | null,
  binding?: CitationBinding,
): FieldCitation {
  const premier = plage[0]!;
  const dernier = plage[plage.length - 1]!;
  return {
    field,
    page: premier.page,
    ordinal: premier.ordinal,
    ...(plage.length > 1 ? { ordinalEnd: dernier.ordinal } : {}),
    zone: binding?.zone ?? zone ?? null,
    ui_field: binding?.uiField ?? field,
    ui_role: role,
    bbox: {
      x0: Math.min(...plage.map((t) => t.x0)),
      y0: Math.min(...plage.map((t) => t.y0)),
      x1: Math.max(...plage.map((t) => t.x1)),
      y1: Math.max(...plage.map((t) => t.y1)),
    },
  };
}

export interface ResolvedValue {
  /** Valeur relue depuis le token, jamais depuis le modèle. */
  value: string | null;
  citation: FieldCitation | null;
  flag: ReadFlag | null;
}

/**
 * Le texte d'une plage de jetons, ou celui du jeton seul.
 *
 * Le modèle désigne parfois une VALEUR qui s'étale sur plusieurs jetons : un
 * montant coupé par l'espace des milliers, un libellé en plusieurs mots. La
 * plage est celle qu'il a lui-même donnée — on ne l'étend jamais.
 */
function jetonsDeLaPlage(
  tokens: readonly PageToken[],
  ref: TokenRef,
  token: PageToken,
): PageToken[] {
  if (typeof ref.ordinalEnd !== "number" || ref.ordinalEnd <= ref.ordinal) return [token];
  const plage = tokens
    .filter((t) => t.page === ref.page && t.ordinal >= ref.ordinal && t.ordinal <= ref.ordinalEnd!)
    .sort((a, b) => a.ordinal - b.ordinal);
  return plage.length > 1 ? plage : [token];
}

const texteDeLaPlage = (plage: readonly PageToken[]): string => plage.map((t) => t.text).join(" ");

/**
 * Filtre du plan de tokens : traduit une désignation de token en valeur.
 * `kind` décide de la relecture : montant, date ou texte brut.
 */
export function resolveFromTokenPlan(
  tokens: readonly PageToken[],
  field: string,
  ref: TokenRef | null | undefined,
  kind: "date" | "text",
  zone?: string | null,
  binding?: CitationBinding,
): ResolvedValue {
  if (!ref) {
    return { value: null, citation: null, flag: { field, code: "MISSING_CITATION" } };
  }
  const token = findToken(tokens, ref);
  if (!token) {
    return {
      value: null,
      citation: null,
      flag: {
        field,
        code: "TOKEN_NOT_FOUND",
        detail: `page ${ref.page} · token ${ref.ordinal}`,
      },
    };
  }
  const plage = jetonsDeLaPlage(tokens, ref, token);
  const texte = texteDeLaPlage(plage);
  const citation = citer(plage, field, kind === "date" ? "date" : "texte", zone, binding);
  if (kind === "date") {
    /*
     * La date se relit sur TOUTE la plage, comme un texte.
     *
     * Elle ne lisait que `token.text`, alors même que la plage était calculée
     * juste à côté pour les champs textuels. Sur « 1 septembre 2026 » — trois
     * tokens — elle recevait « 1 », et rendait « illisible ». Le drapeau
     * portait d'ailleurs ce « 1 » en détail, ce qui désignait le défaut sans
     * que personne le lise.
     */
    const value = normalizeDate(texte);
    return value === null
      ? {
          value: null,
          citation,
          flag: { field, code: "DATE_UNREADABLE", detail: texte },
        }
      : { value, citation, flag: null };
  }
  return { value: texte, citation, flag: null };
}

/** Un montant lu au plan : sa valeur si elle est certaine, et toutes ses lectures. */
export interface MontantLu extends ResolvedValue {
  hypotheses: Hypothese[];
}

/**
 * Lit un montant au plan de tokens, sans jamais trancher à la place du papier.
 *
 * Trois sorties, et c'est tout le dispositif :
 *
 *   une seule lecture admissible  → la valeur, sans drapeau ;
 *   plusieurs lectures            → aucune valeur, drapeau « SEPARATEUR_AMBIGU »
 *                                   qui porte les deux lectures, pour que
 *                                   l'écran pose la question ;
 *   aucune lecture                → aucune valeur, drapeau « pas un nombre ».
 *
 * La deuxième sortie est celle qui manquait. Le solveur (`read-piece.ts`) la
 * reprend ensuite : quand l'arithmétique de la facture ne laisse qu'une
 * lecture debout, le drapeau devient « DECIDE_PAR_ARITHMETIQUE ».
 */
export function lireMontantDuPlan(
  tokens: readonly PageToken[],
  field: string,
  ref: TokenRef | null | undefined,
  decimales: number,
  zone?: string | null,
  binding?: CitationBinding,
): MontantLu {
  if (!ref) {
    return {
      value: null,
      citation: null,
      flag: { field, code: "MISSING_CITATION" },
      hypotheses: [],
    };
  }
  const token = findToken(tokens, ref);
  if (!token) {
    return {
      value: null,
      citation: null,
      flag: {
        field,
        code: "TOKEN_NOT_FOUND",
        detail: `page ${ref.page} · token ${ref.ordinal}`,
      },
      hypotheses: [],
    };
  }
  const plage = jetonsDeLaPlage(tokens, ref, token);
  const citation = citer(plage, field, "montant", zone, binding);
  const texte = texteDeLaPlage(plage);
  const hypotheses = treillisMontant(texte, decimales);

  if (hypotheses.length === 0) {
    return {
      value: null,
      citation,
      flag: { field, code: "VALUE_NOT_A_NUMBER", detail: token.text },
      hypotheses,
    };
  }
  if (hypotheses.length === 1) {
    return {
      value: enDecimal(hypotheses[0]!.millimes, decimales),
      citation,
      flag: null,
      hypotheses,
    };
  }
  return {
    value: null,
    citation,
    flag: {
      field,
      code: "SEPARATEUR_AMBIGU",
      detail: `« ${texte} » se lit ${hypotheses.map((h) => enDecimal(h.millimes, decimales)).join(" ou ")}`,
    },
    hypotheses,
  };
}

export type { FieldCitation, PageToken, ReadFlag, TokenRef } from "@malica/socle/ports/malica";
