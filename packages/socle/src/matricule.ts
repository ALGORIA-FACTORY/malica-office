/**
 * Lire un matricule fiscal tunisien, quelle qu'en soit l'écriture.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, une facture parfaitement lue a été rejetée parce que la
 * fiche du dossier portait `1856324/A/M/000` au lieu de `1876543W/A/M/000`.
 * Depuis, la saisie d'une fiche refuse une forme invalide.
 *
 * Mais sur une PIÈCE, le matricule arrive comme l'œil l'a vu : avec son
 * étiquette (« MF : », « المعرف الجبائي »), en chiffres arabes, séparé par des
 * espaces ou des tirets, et parfois abîmé par une confusion de caractères —
 * un « l » pour un « 1 », un « B » pour un « 8 ».
 *
 * Comparer deux matricules écrits différemment mot à mot ferait échouer toutes
 * les pièces d'un dossier. D'où ce module : UN SEUL normaliseur, dont la clé
 * sert à toutes les comparaisons du produit.
 *
 * ========================================== CE QU'IL NE FAIT PAS, ET POURQUOI
 *
 * Il ne VALIDE rien. Les séries réglementaires — codes de TVA, catégories
 * d'établissement — vivent dans `ref.identifiant_formats`, datées et
 * versionnées par juridiction, et la validation est faite par
 * `identifiant_verifier` au seul moment où elle doit être stricte : la saisie
 * de la fiche entreprise. Les recopier ici en ferait deux sources de vérité,
 * et R4 interdit la constante réglementaire dans le code.
 *
 * Ce module ne juge donc que la FORME : y a-t-il un noyau de sept chiffres et
 * une lettre de contrôle, et les trois groupes suivent-ils ?
 *
 * Sur une pièce lue, un matricule incomplet doit produire une QUESTION, jamais
 * un rejet de la pièce : c'est pour cela que `forme` distingue « partielle »
 * de « illisible » au lieu de rendre un simple booléen.
 *
 * ==================================================== OÙ CECI DEVRAIT VIVRE
 *
 * Les étiquettes et les confusions d'OCR sont des dictionnaires de lecture —
 * la quatrième couche de la base de correction, gouvernée et versionnée. Elles
 * sont ici en attendant cette table, comme les noms de mois dans
 * `normalizeDate`. Ce n'est pas une constante réglementaire ; c'est du
 * vocabulaire, et il devra descendre en base avec le reste de la couche 4.
 */

/**
 * Ce qu'on a pu tirer d'une écriture de matricule.
 *
 *   complete    noyau + les trois groupes : la forme pleine
 *   courte      le noyau seul — « 1876543W », qui se compare très bien
 *   partielle   sept chiffres sans lettre de contrôle : une QUESTION, pas un rejet
 *   illisible   rien d'exploitable
 */
export type FormeDuMatricule = "complete" | "courte" | "partielle" | "illisible";

export interface MatriculeLu {
  /**
   * La clé de comparaison : sept chiffres et la lettre de contrôle, en
   * capitales. `null` dès que la lettre manque — comparer sur les sept chiffres
   * seuls ferait coïncider deux entreprises différentes, et une coïncidence
   * silencieuse est pire qu'une question.
   */
  cle: string | null;
  /** Les sept chiffres, même quand la lettre manque. Pour expliquer, jamais pour comparer. */
  chiffres: string | null;
  /** La forme pleine reconstituée, quand les trois groupes sont là. */
  complet: string | null;
  forme: FormeDuMatricule;
  /**
   * Ce qui a été corrigé pour arriver là. L'écran doit pouvoir le dire : une
   * correction invisible sur un identifiant est une correction qu'on ne peut
   * pas contester.
   */
  corrections: string[];
}

/** Les chiffres arabes et persans, ramenés aux latins par simple décalage. */
/**
 * Les diacritiques arabes, retirés avant de chercher une étiquette.
 *
 * « المعرّف » et « المعرف » sont le même mot : l'un porte une chadda. La mettre
 * dans une classe de caractères — `[فّ]` — mélange une lettre et une marque
 * combinante, ce qui ne veut rien dire et que le lint refuse à juste titre.
 * On nettoie le texte, et les motifs restent lisibles.
 */
function sansTashkeel(s: string): string {
  return s.replace(/[ؐ-ًؚ-ٰٟ]/g, "");
}

function enChiffresLatins(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * Les étiquettes qui précèdent un matricule, en français et en arabe.
 *
 * Retirées avant toute lecture : « MF » contient un M, et « Matricule » un
 * « l » que la réparation de confusion prendrait pour un 1.
 */
const ETIQUETTES: readonly RegExp[] = [
  /\bmatricule\s*fiscal(e)?\b/gi,
  /\bmatricule\b/gi,
  /\bidentifiant\s*fiscal\b/gi,
  /\bid\s*fiscal\b/gi,
  /\bm\s*\.?\s*f\s*\.?\b/gi,
  /\bn\s*[°º]?\s*fiscal\b/gi,
  /\bcode\s*tva\b/gi,
  // Arabe : « le identifiant fiscal », et l'abrégé. La chadda de « المعرّف » a
  // déjà été retirée par `sansTashkeel` : la mettre dans une classe mélangerait
  // une lettre et une marque combinante, ce qui ne veut rien dire.
  /المعرف\s*ال?جبائ[يى]/g,
  /رقم\s*ال?جبائ[يى]/g,
  /م\s*\.?\s*ج\s*\.?/g,
];

/**
 * Les confusions de l'œil, appliquées AUX POSITIONS DE CHIFFRES seulement.
 *
 * Jamais dans l'autre sens. Un chiffre vu à la place de la lettre de contrôle
 * ne se « répare » pas : la lettre peut être n'importe laquelle, donc toute
 * réparation y serait une invention. Le matricule part alors en question.
 */
const CONFUSIONS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/O/g, "0", "O lu pour 0"],
  [/Q/g, "0", "Q lu pour 0"],
  [/[IL|]/g, "1", "I ou L lu pour 1"],
  [/S/g, "5", "S lu pour 5"],
  [/B/g, "8", "B lu pour 8"],
  [/G/g, "6", "G lu pour 6"],
  [/Z/g, "2", "Z lu pour 2"],
];

/** Sept caractères qui devraient être des chiffres, réparés si besoin. */
function reparerLesChiffres(sept: string): { chiffres: string; corrections: string[] } {
  let sortie = sept;
  const corrections: string[] = [];
  for (const [motif, bon, dit] of CONFUSIONS) {
    if (motif.test(sortie)) {
      sortie = sortie.replace(motif, bon);
      if (!corrections.includes(dit)) corrections.push(dit);
    }
  }
  return { chiffres: sortie, corrections };
}

const RIEN: MatriculeLu = {
  cle: null,
  chiffres: null,
  complet: null,
  forme: "illisible",
  corrections: [],
};

export function normaliserMatricule(brut: string | null | undefined): MatriculeLu {
  if (brut === null || brut === undefined) return RIEN;

  let texte = sansTashkeel(enChiffresLatins(String(brut)));
  const corrections: string[] = [];
  if (enChiffresLatins(String(brut)) !== String(brut))
    corrections.push("chiffres arabes convertis");

  for (const e of ETIQUETTES) {
    if (e.test(texte)) {
      texte = texte.replace(e, " ");
      if (!corrections.includes("étiquette retirée")) corrections.push("étiquette retirée");
    }
  }

  /*
   * On raisonne sur la forme ÉCRITE, séparateurs compris.
   *
   * La première version compactait tout — « 1856324/A/M/000 » devenait
   * « 1856324AM000 » — puis cherchait sept chiffres suivis d'une lettre. Elle
   * prenait donc le CODE DE TVA pour la lettre de contrôle, et fabriquait la
   * clé « 1856324A » à partir d'un matricule qui n'en a pas. Exactement la
   * coïncidence silencieuse que ce module existe pour empêcher.
   *
   * Et elle trouvait un matricule dans « FA/2026/00412 », parce que sans les
   * séparateurs, « 2026 » et « 00412 » se touchent.
   *
   * Les séparateurs sont donc gardés, et c'est LE NOMBRE DE GROUPES qui dit si
   * la lettre de contrôle est là : trois lettres avant les trois chiffres, elle
   * est là ; deux lettres seulement, elle manque.
   */
  const SEP = "\\s*[/\\-.\\s]\\s*";
  // Les caractères qu'une OCR rend à la place d'un chiffre. Un groupe de sept
  // ne se forme pas par hasard dans un mot : « ALGORIA » n'en contient pas.
  const C = "[0-9OQILSBGZoqilsbgz|]";
  // Le groupe de sept doit commencer après autre chose qu'un chiffre, sinon on
  // le trouverait décalé dans un nombre plus long.
  const DEBUT = "(?:^|[^0-9])";

  /*
   * La lettre de contrôle est collée aux chiffres… ou séparée comme les autres
   * groupes.
   *
   * Relevé le 7 octobre 2026 sur la facture SUARL CASA-ELECT :
   *
   *     1589037 /M/P/M/000
   *
   * Sept chiffres, une ESPACE, puis QUATRE groupes. Les treize écritures
   * connues jusque-là collaient la lettre au numéro (« 1876543W/A/M/000 »).
   *
   * Le séparateur est donc FACULTATIF entre les chiffres et la lettre. Ce qui
   * distingue toujours les deux cas reste le nombre de groupes : quatre, la
   * lettre est là ; trois, elle manque. On ne devine rien, on compte.
   *
   * Ce qu'une écriture non reconnue a coûté, et c'est pour cela que la
   * correction est ici et non ailleurs : sans matricule lisible, la déduction
   * du sens ne pouvait pas se faire, le modèle a gardé la main, il a dit
   * « vente » sur un achat, et le contrôle du destinataire a rejeté une facture
   * d'achat parfaitement normale.
   */
  const avecLettre = new RegExp(
    `${DEBUT}(${C}{7})(?:${SEP}|\\s*)([A-Za-z])${SEP}([A-Za-z])${SEP}([A-Za-z])${SEP}(\\d{3})`,
  );
  const sansLettre = new RegExp(`${DEBUT}(${C}{7})${SEP}([A-Za-z])${SEP}([A-Za-z])${SEP}(\\d{3})`);
  const courte = new RegExp(`${DEBUT}(${C}{7})\\s*([A-Za-z])(?![0-9A-Za-z])`);

  const pleine = texte.match(avecLettre);
  if (pleine) {
    const { chiffres, corrections: reparees } = reparerLesChiffres(pleine[1]!.toUpperCase());
    if (/^\d{7}$/.test(chiffres)) {
      const cle = `${chiffres}${pleine[2]!.toUpperCase()}`;
      return {
        cle,
        chiffres,
        complet: `${cle}/${pleine[3]!.toUpperCase()}/${pleine[4]!.toUpperCase()}/${pleine[5]}`,
        forme: "complete",
        corrections: [...corrections, ...reparees],
      };
    }
  }

  /*
   * Trois groupes sans lettre de contrôle : c'est l'ancienne fiche du staging,
   * et c'est une forme qu'une pièce peut porter. Une QUESTION, jamais un rejet
   * de la pièce — et surtout aucune clé, pour qu'aucune comparaison ne réussisse
   * par accident.
   */
  const sans = texte.match(sansLettre);
  if (sans) {
    const { chiffres, corrections: reparees } = reparerLesChiffres(sans[1]!.toUpperCase());
    if (/^\d{7}$/.test(chiffres)) {
      return {
        cle: null,
        chiffres,
        complet: null,
        forme: "partielle",
        corrections: [...corrections, ...reparees],
      };
    }
  }

  const court = texte.match(courte);
  if (court) {
    const { chiffres, corrections: reparees } = reparerLesChiffres(court[1]!.toUpperCase());
    if (/^\d{7}$/.test(chiffres)) {
      return {
        cle: `${chiffres}${court[2]!.toUpperCase()}`,
        chiffres,
        complet: null,
        forme: "courte",
        corrections: [...corrections, ...reparees],
      };
    }
  }

  return { ...RIEN, corrections };
}

/**
 * Deux écritures désignent-elles le même matricule ?
 *
 * Sur la clé, donc sur sept chiffres ET la lettre de contrôle. Une comparaison
 * qui tomberait sur les sept chiffres seuls confondrait deux entreprises, et
 * c'est exactement le genre de coïncidence qui ne se voit jamais.
 */
export function memeMatricule(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = normaliserMatricule(a).cle;
  const cb = normaliserMatricule(b).cle;
  return ca !== null && ca === cb;
}
