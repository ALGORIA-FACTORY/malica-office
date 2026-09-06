/**
 * Les contrôles : vérifier qu'une réponse est VÉRIFIABLE.
 *
 * ================================================================ LE PRINCIPE
 *
 * On ne sait pas si une réponse est juste — il faudrait connaître la réponse.
 * On sait en revanche dire si elle s'appuie sur ce qu'on lui a montré, et
 * c'est ce qui attrape les fautes dangereuses : l'article inventé, le texte
 * périmé, le chiffre sorti de nulle part.
 *
 * Ce module ne parle à personne : il reçoit la réponse, les fragments qu'on a
 * transmis, les chiffres autorisés, et il rend des verdicts. Aucune requête,
 * aucun appel de modèle — donc entièrement éprouvable, et rapide.
 *
 * ================================================ POURQUOI PAS UN AUTRE MODÈLE
 *
 * Un contrôle mécanique ne se laisse pas convaincre. Un modèle qui relit un
 * modèle peut se tromper deux fois de la même façon. Tout ce qui peut tenir
 * ici y tient ; le reste seulement passe par une relecture.
 *
 * ==================================================== TROIS SUITES POSSIBLES
 *
 * Une faute n'appelle pas toujours la même réponse, et traiter les trois cas
 * pareil appauvrirait Regalica sans la rendre plus sûre :
 *
 *   retirer   — c'est une invention. La phrase saute.
 *   completer — la phrase est vraie, il lui manque une incise.
 *   signaler  — c'est un doute sur NOTRE corpus. Le cabinet le voit ; le
 *               client, non. Ce n'est pas son problème.
 */

import type { FragmentDeDroit } from "./corpus.ts";
import type { Verdict } from "@regalica/socle/ports/regalica";

/**
 * Les numéros d'article cités dans une réponse.
 *
 * On ne cherche PAS à savoir de quel code il s'agit — la question est « ce
 * numéro fait-il partie de ce qu'on lui a montré ? », et l'ensemble transmis
 * tient en six fragments. Chercher le corpus en plus multiplierait les façons
 * de se tromper sans rien ajouter au verdict.
 *
 * Le suffixe compte : « 84 » et « 84 quinquies » sont deux articles.
 */
export function articlesCites(reponse: string): string[] {
  /*
   * Une citation ne vient pas toujours seule.
   *
   * « les articles 81 et 84 bis », « les articles 81 à 86 » : seul le premier
   * numéro porte le mot « article ». Une détection qui s'arrête là manque les
   * suivants — et un contrôle qui ne voit pas une citation la déclare saine.
   * C'est le pire défaut possible pour un garde-fou : il passe au vert en
   * silence.
   *
   * On repère donc l'amorce, puis on consomme la SUITE de numéros qu'elle
   * introduit, tant qu'ils sont reliés par « et », « à », « ou » ou une
   * virgule. Une plage n'est pas dépliée : ses deux bornes suffisent à dire
   * si la réponse s'appuie sur du texte qu'on ne lui a pas montré.
   */
  const RANG = "\\d+(?:\\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))*";
  const amorce = new RegExp(`\\b(?:art\\.?|articles?)\\s*(${RANG})`, "gi");
  const suite = new RegExp(`^\\s*(?:,|\\bet\\b|\\bà\\b|\\bou\\b)\\s*(${RANG})`, "i");

  const vus = new Set<string>();
  const propre = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  for (const m of reponse.matchAll(amorce)) {
    vus.add(propre(m[1]!));
    let position = m.index + m[0].length;
    // Tant que la phrase enchaîne des numéros, ils appartiennent à la même
    // citation. On s'arrête au premier mot qui n'est pas un lien.
    for (;;) {
      const s = suite.exec(reponse.slice(position));
      if (!s) break;
      vus.add(propre(s[1]!));
      position += s[0].length;
    }
  }
  return [...vus];
}

/** Le même numéro, écrit de deux façons, est le même article. */
function memeNumero(a: string, b: string): boolean {
  const propre = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return propre(a) === propre(b);
}

/**
 * La forme canonique d'un nombre écrit.
 *
 * « 64,600 », « 64.600 », « 64 600 » et « 64.6 » ne s'écrivent pas pareil et
 * valent pourtant la même chose. Comparer des CHAÎNES faisait crier le contrôle
 * sur « 64,600 » quand le dossier portait « 64.6 » — le même montant, écrit à
 * deux précisions, et un faux positif sur un chiffre parfaitement sourcé.
 *
 * On compare donc des VALEURS, des deux côtés.
 *
 * Rend `null` pour ce qui n'est pas un nombre : l'appelant écarte, il ne
 * devine pas.
 */
export function canonique(ecrit: string): string | null {
  const nu = ecrit
    .trim()
    .replace(/[\s\u00a0\u202f]*%$/, "")
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(nu)) return null;
  const n = Number(nu);
  if (!Number.isFinite(n)) return null;
  // `String(64.600)` rend « 64.6 » : c'est la forme canonique cherchée.
  return String(Math.abs(n));
}

/**
 * Les nombres qui engagent : montants, taux, seuils.
 *
 * On écarte ce qui n'est pas une valeur — les années, les numéros d'article,
 * les numéros de facture, les dates. Un contrôle qui crierait sur « article 7 »
 * ou « depuis 2018 » serait ignoré au bout de trois jours, et c'est ainsi qu'un
 * garde-fou meurt.
 */
export function chiffresEngageants(reponse: string): string[] {
  // On neutralise d'abord les contextes où un nombre ne vaut pas une valeur.
  const neutralise = reponse
    .replace(
      /\b(?:art\.?|articles?)\s*\d+(?:\s*[-–]?\s*[IVXLC]+)?(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))*/gi,
      " ",
    )
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    // Une année isolée n'est pas un montant, quel que soit ce qui la précède.
    // « le 1er janvier 2026 », « depuis 2018 », « LF 2026 » : deux mille dinars
    // s'écrivent « 2 000,000 », jamais « 2000 » tout court.
    .replace(/(?<![\d.,])(?:19|20)\d{2}(?![\d.,])/g, " ")
    // Une facture porte un numéro, pas une valeur.
    .replace(/\b(?:factures?|pi[èe]ces?|quittances?|n[°o]\.?)\s*[A-Z-]*\d+[\w-]*/gi, " ");

  const vus = new Set<string>();
  /*
   * Les bornes comptent DES DEUX CÔTÉS.
   *
   * Sans borne de fin, « 4488 » livrait « 448 » et « 2026 » livrait « 202 » :
   * le motif mordait le début d'un nombre plus long et inventait des chiffres
   * que la réponse ne contenait pas. Un garde-fou qui crie à tort est
   * désactivé en trois jours — c'est sa pire issue possible.
   */
  /*
   * Et les chiffres non groupés comptent aussi.
   *
   * Le motif exigeait « 1 240,500 » — trois chiffres puis des groupes séparés.
   * « 4488,000 », écrit sans séparateur, n'était alors détecté NULLE PART :
   * un montant à quatre chiffres passait sans être vu. Un faux négatif est
   * plus grave ici qu'un faux positif — il laisse passer l'invention.
   */
  for (const m of neutralise.matchAll(
    /(?<![\d.,])\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?(?![\d.,])[\s\u00a0\u202f]*%?/g,
  )) {
    const brut = m[0].trim();
    const valeur = canonique(brut);
    if (valeur === null) continue;
    // Un entier isolé de un à deux chiffres est presque toujours un rang, un
    // délai ou un compte — pas un montant. On ne le retient que s'il porte un
    // pourcentage ou des décimales.
    const porteUneUnite = brut.endsWith("%") || /[.,]/.test(brut);
    if (!porteUneUnite && Number(valeur) < 100) continue;
    vus.add(valeur);
  }
  return [...vus];
}

/** Les mots par lesquels une réponse dit la portée d'un texte interprétatif. */
const DIT_LA_PORTEE =
  /(n'oblige|ne lie|opposable|ne s'impose|valeur interprétative|interprétative|pas tenu de la suivre|administration seule|seule l'administration)/i;

export interface EntreeDeControle {
  reponse: string;
  /** Ce qu'on lui a réellement montré. */
  fragments: readonly FragmentDeDroit[];
  /**
   * Les chiffres qu'elle avait le droit d'écrire : ceux du dossier et du
   * paramétrage, sous leur forme décimale brute.
   */
  chiffresAutorises: readonly string[];
  /** Le jour où l'on juge la validité. Injecté, jamais lu de l'horloge. */
  aujourdhui: string;
  /**
   * Pour chaque article transmis, l'édition la plus récente qui existe —
   * toutes langues confondues. C'est le seul apport de la base à ce module.
   */
  editionsPlusRecentes?: ReadonlyArray<{
    numero: string;
    corpus: string;
    validFrom: string;
    langue: string;
  }>;
}

export function controler(entree: EntreeDeControle): Verdict[] {
  const { reponse, fragments, chiffresAutorises, aujourdhui } = entree;
  const verdicts: Verdict[] = [];

  /* ------------------------------------------- 1. l'article a-t-il été montré */
  const cites = articlesCites(reponse);
  const fournis = fragments.map((f) => f.numero);
  // Un numéro qui apparaît dans le TEXTE d'un fragment transmis est légitime :
  // elle recopie un renvoi qu'elle a sous les yeux, elle ne l'invente pas.
  const dansLeTexte = fragments.map((f) => f.extrait).join(" ");
  for (const numero of cites) {
    const montre = fournis.some((n) => memeNumero(n, numero));
    const renvoye = new RegExp(
      `\\b(?:art\\.?|articles?)\\s*${numero.replace(/\s+/g, "\\s*")}\\b`,
      "i",
    ).test(dansLeTexte);
    if (!montre && !renvoye) {
      verdicts.push({
        code: "article_non_fourni",
        suite: "retirer",
        detail: `l'article ${numero} est cité sans avoir été transmis ni figurer dans le texte fourni`,
      });
    }
  }

  for (const f of fragments) {
    const estCite = cites.some((n) => memeNumero(n, f.numero));
    if (!estCite) continue;

    /* --------------------------------- 2. l'édition citée a-t-elle expiré */
    if (f.validTo !== null && f.validTo <= aujourdhui) {
      verdicts.push({
        code: "edition_perimee",
        suite: "completer",
        detail: `${f.corpus} art. ${f.numero} : l'édition transmise s'arrête au ${f.validTo}`,
      });
    }

    /* ------------------------------ 3. l'article tient-il encore debout */
    if (f.statut !== "en_vigueur") {
      verdicts.push({
        code: "statut_non_en_vigueur",
        suite: f.statut === "indetermine" ? "signaler" : "completer",
        detail:
          `${f.corpus} art. ${f.numero} : statut « ${f.statut} »` +
          (f.abrogePar ? `, remplacé par ${f.abrogePar}` : ""),
      });
    }

    /* --------------------- 4. la portée d'un texte interprétatif est-elle dite */
    if (f.autorite === "interpretative" && !DIT_LA_PORTEE.test(reponse)) {
      verdicts.push({
        code: "portee_non_dite",
        suite: "completer",
        detail:
          `${f.corpus} art. ${f.numero} est interprétatif (opposable à : ` +
          `${f.opposableA ?? "personne"}) et la réponse ne le dit pas`,
      });
    }

    /* ------------------------------- 5. la lecture du texte était-elle sûre */
    if (f.provenance !== "verbatim") {
      verdicts.push({
        code: "lecture_incertaine",
        suite: "signaler",
        detail: `${f.corpus} art. ${f.numero} : lecture « ${f.provenance} »`,
      });
    }
  }

  /* ---------------------- 6. une édition plus récente existe-t-elle ailleurs */
  for (const plus of entree.editionsPlusRecentes ?? []) {
    if (!cites.some((n) => memeNumero(n, plus.numero))) continue;
    verdicts.push({
      code: "edition_plus_recente",
      suite: "completer",
      detail:
        `${plus.corpus} art. ${plus.numero} : une édition du ${plus.validFrom} ` +
        `existe en ${plus.langue} et n'a pas été transmise`,
    });
  }

  /* -------------------------------- 7. chaque chiffre a-t-il une provenance
   *
   * Les DEUX CÔTÉS passent par la forme canonique. Comparer « 64.600 » de la
   * réponse à « 64.6 » du dossier faisait crier le contrôle sur un montant
   * parfaitement sourcé — trois faux positifs sur une réponse juste, ce qui
   * suffit à faire ignorer le garde-fou.
   */
  const autorises = new Set(
    chiffresAutorises.map((c) => canonique(c)).filter((c): c is string => c !== null),
  );
  const dansLesTextes = fragments.map((f) => f.extrait).join(" ");
  // Les nombres écrits dans les textes de loi transmis : « au taux de 19% »
  // est une source, au même titre que le dossier.
  const desTextes = new Set(chiffresEngageants(dansLesTextes));

  for (const chiffre of chiffresEngageants(reponse)) {
    if (autorises.has(chiffre) || desTextes.has(chiffre)) continue;
    verdicts.push({
      code: "chiffre_sans_source",
      suite: "retirer",
      detail: `le chiffre ${chiffre} n'est ni au dossier, ni au paramétrage, ni dans les textes fournis`,
    });
  }

  return verdicts;
}
