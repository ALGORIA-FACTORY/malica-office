/**
 * Statut d'un article marqué « abrogé » : le texte le dit-il vraiment ?
 *
 * ============================================================ LE DÉFAUT (C1)
 *
 * 121 articles portaient `statut = 'abroge'` ET une version ouverte (sans
 * `valid_to`). Relevé du 11 novembre 2026, voir `db/verification/defauts_corpus.sql`.
 * Trois causes, lues dans le texte même des versions :
 *
 *   1. ABROGATION PARTIELLE. « (abrogé Art 14-2 LF 2020-46) » vise un alinéa.
 *      L'article 49 du CIRPPIS fixe l'IS et sortait avec « STATUT : abrogé ».
 *   2. « ABROGÉ ET REMPLACÉ ». Le numéro porte le texte de remplacement : il est
 *      en vigueur (CASSUR 54, 58, 60, 61, 76, 80, 83, 92).
 *   3. FUITE DU VOISIN. Le découpage laisse la mention de l'article suivant dans
 *      le texte de celui-ci (CTVA 12 porte « الفصل13: (ألغي … »).
 *
 * ============================================================ LA RÈGLE
 *
 * Fonction pure : un texte entre, un verdict et sa raison sortent. Aucun accès
 * à la base. Elle ne tranche JAMAIS dans le doute : « incertain » laisse le
 * statut tel quel et met l'article dans la liste de l'expert.
 *
 *   - on coupe le texte à la mention d'abrogation d'un AUTRE article
 *     (« Articles 272 à 277 (Abrogés … » ; « الفصل13: (ألغي … ») ;
 *   - mention en tête, sans remplacement  -> abrogé (le corps ne contient que des intertitres) ;
 *   - mention en tête avec remplacement et un corps -> en vigueur (remplacé) ;
 *   - mention dans le corps et un corps substantiel -> en vigueur (partielle) ;
 *   - aucune mention propre et un corps substantiel -> en vigueur (fuite du voisin) ;
 *   - le reste -> incertain.
 *
 * Le seuil de lettres n'est pas une constante réglementaire : c'est le réglage
 * du lecteur. Il est exporté pour que l'épreuve le fasse varier.
 */

export const SEUIL_CORPS = 100;
export const SEUIL_CORPS_REMPLACE = 40;

const LETTRES = /[A-Za-zÀ-ɏء-ي]/g;
const TATWEEL = /ـ/g;
const MOT_ABROGATION = /abrog|أ?لغ|ألغ|الغ/i;
const MOT_REMPLACE = /remplac|عوض|وعوض|بدل/i;

// Un groupe entre parenthèses (un niveau d'imbrication toléré).
// Le texte arabe extrait arrive parfois avec les parenthèses inversées : « )ألغي … ( ».
const GROUPE = /[(（][^()]*(?:\([^()]*\)[^()]*)*[)）]|\)[^()]{1,300}?\(/g;

const TITRE =
  /^\s*(?:ARTICLE|Article|Art\.?|الفصل)\s*\d+(?:\s*(?:bis|ter|quater|quinquies|quinto|sexies|septies|octies|مكرر))?[\s:.\-–—ـ]*/;

// Un autre article annoncé, avec sa propre mention d'abrogation juste derrière.
const AUTRE_ARTICLE_ABROGE = new RegExp(
  "(?:Articles?|ARTICLES?|\\u0627\\u0644\\u0641\\u0635\\u0644|\\u0627\\u0644\\u0641\\u0635\\u0648\\u0644)\\s*\\d+[^()]{0,40}?[(\\uFF08]\\s*(?:[Aa]brog|\\u0623?\\u0644\\u063a|\\u0623\\u0644\\u063a)",
  "g",
);

const INTERTITRE =
  /(?:Imprimerie Officielle[^\d]*\d*|Chapitre\s+[\wIVX]+|Section\s+[\wIVX]+|Titre\s+[\wIVX]+|Livre\s+[\wIVX]+|القسم|الباب|الفصل الأول)/g;

const lettres = (s) => (s.match(LETTRES) ?? []).length;

/** Coupe le texte avant la mention d'abrogation d'un autre article. */
function couperAuVoisin(t) {
  for (const m of t.matchAll(AUTRE_ARTICLE_ABROGE)) {
    if (m.index > 10) return t.slice(0, m.index);
  }
  return t;
}

/**
 * @param {string} texte  texte de la version ouverte (français, sinon arabe)
 * @returns {{verdict: 'abroge'|'en_vigueur'|'incertain', raison: string, mention: string|null}}
 */
export function classerAbrogation(texte) {
  const brut = (texte ?? "").normalize("NFKC").replace(TATWEEL, "").replace(/\s+/g, " ").trim();
  const coupe = couperAuVoisin(brut);
  const sansTitre = coupe.replace(TITRE, "");

  const groupes = [...sansTitre.matchAll(GROUPE)];
  const abrogations = groupes.filter((g) => MOT_ABROGATION.test(g[0]));
  const mention = abrogations[0]?.[0] ?? null;

  // Corps : le texte sans aucun groupe d'amendement ni intertitre.
  const corps = sansTitre.replace(GROUPE, " ").replace(INTERTITRE, " ");
  const nCorps = lettres(corps);

  if (abrogations.length === 0) {
    return nCorps >= SEUIL_CORPS
      ? {
          verdict: "en_vigueur",
          raison: "aucune mention propre : la mention venait d'un article voisin",
          mention: null,
        }
      : {
          verdict: "incertain",
          raison: "aucune mention propre et un corps trop court",
          mention: null,
        };
  }

  const avant = sansTitre.slice(0, abrogations[0].index).replace(GROUPE, " ");
  const enTete = lettres(avant) < 15;
  // « I- (Abrogé …) II- … » : la mention couvre le seul premier alinéa.
  const premierAlinea = /^\s*(?:I|1|\u0623)\s*[-\u2013.:)]*\s*$/.test(avant);
  const remplace = MOT_REMPLACE.test(mention);

  if (premierAlinea && nCorps >= SEUIL_CORPS) {
    return {
      verdict: "en_vigueur",
      raison: "abrogation partielle : la mention couvre le seul alinéa I",
      mention,
    };
  }
  if (enTete && !remplace) {
    // Le corps qui suit n'est composé que d'intertitres ou du texte d'articles voisins.
    return nCorps < SEUIL_CORPS * 3
      ? { verdict: "abroge", raison: "mention en tête, sans remplacement", mention }
      : {
          verdict: "incertain",
          raison: "mention en tête mais corps long : abrogation du seul premier alinéa ?",
          mention,
        };
  }
  if (enTete && remplace) {
    return nCorps >= SEUIL_CORPS_REMPLACE
      ? {
          verdict: "en_vigueur",
          raison: "abrogé et remplacé : le numéro porte le texte de remplacement",
          mention,
        }
      : {
          verdict: "abroge",
          raison: "abrogé et remplacé par un autre texte, sans corps ici",
          mention,
        };
  }
  return nCorps >= SEUIL_CORPS
    ? { verdict: "en_vigueur", raison: "abrogation partielle : la mention vise un alinéa", mention }
    : { verdict: "incertain", raison: "mention dans le corps et corps court", mention };
}
