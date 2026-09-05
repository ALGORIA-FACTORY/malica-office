/**
 * Decoupage d'un fascicule juridique en articles — francais ET arabe.
 *
 * ================================================== CE QU'UN FASCICULE CONTIENT
 *
 * Un PDF publie par la DGELF n'est jamais « un code ». Il enchaine, a la suite :
 * un sommaire, la loi de promulgation, LE CORPS DU CODE, puis des decrets et
 * arretes annexes. Chacun de ces textes renumerote ses articles a partir de 1.
 * Un recueil, lui, n'est QUE cela : cinquante textes bout a bout.
 *
 * Tout le travail consiste donc a retrouver, parmi ces suites, celle qui est le
 * texte demande — et a ne pas confondre un article avec la citation d'un article.
 *
 * ================================================== LES QUATRE REGLES
 *
 *   1. BLOCS   — on coupe a chaque « article premier » : un texte qui recommence.
 *   2. CHAINE  — dans un bloc, on garde la plus longue suite non decroissante.
 *                Une citation (« ... prevu par l'article 87 ... ») en tete de
 *                ligne casse l'ordre : la chaine la contourne au lieu de s'y
 *                arreter.
 *   3. RECOUDRE— un « article premier » CITE ouvre un faux bloc. Si le bloc
 *                suivant reprend la numerotation strictement au-dessus de la fin
 *                du precedent — a deux citations pres, et pour autant que ces
 *                citations soient une petite minorite du bloc — c'est le meme
 *                texte qui continue.
 *   4. CHOISIR — entre les candidats restants : d'abord le NOMBRE d'articles
 *                (au moins la moitie du plus fourni), puis l'ETENDUE en
 *                caracteres. Le nombre seul donne le decret sur les vins
 *                (46 articles) plutot que le code de la TVA (30) ; l'etendue
 *                seule donne, dans une loi de finances, deux annexes eloignees
 *                plutot que le corps de la loi.
 *
 * ================================================== L'ARABE
 *
 * L'arabe fait foi autant que le francais. Trois pieges lui sont propres :
 *
 *   - l'extraction PDF colle les mots (« الفصل13مكرر ») : aucun espace a exiger ;
 *   - elle intervertit parfois les lettres de « الأول » (article premier) : on
 *     reconnait la forme par sa silhouette, pas par sa graphie exacte ;
 *   - les rangs s'ecrivent en toutes lettres — مكرر, ثالثا, رابعا... Sans eux,
 *     les huit articles 13 du code de la TVA se confondaient en un seul, et
 *     l'edition arabe rendait onze articles la ou le francais en rendait trente.
 *
 * Le numero, lui, est ecrit en chiffres arabes occidentaux dans les deux langues.
 */

// Diacritiques et tatweel : ornements qui s'inserent entre les lettres sans
// changer le mot. On les tolere partout plutot que de normaliser le texte, dont
// les positions doivent rester exactes pour decouper.
const D = "[\\u064B-\\u0652\\u0640]*";

// Les PDF arabes n'ecrivent pas toujours les lettres dans leur forme normale :
// certains emploient les FORMES DE PRESENTATION, une lettre par position dans le
// mot. « الفصل » s'y ecrit « اﻟفصل », visuellement identique, et aucune recherche
// ne le trouve. Le code des societes commerciales en arabe, 479 articles, en
// rendait zero pour cette seule raison.
//
// On ne normalise pas le texte — le decoupage travaille sur des positions, et
// certaines ligatures valent deux lettres. On elargit la RECHERCHE : pour chaque
// lettre, on accepte toutes les formes qui se ramenent a elle. La table se
// deduit d'Unicode, elle n'est pas ecrite a la main.
const FORMES = new Map();
for (let c = 0xfb50; c <= 0xfeff; c += 1) {
  const forme = String.fromCodePoint(c);
  const base = forme.normalize("NFKC");
  if (base.length !== 1) continue; // les ligatures ne sont pas une lettre
  FORMES.set(base, (FORMES.get(base) ?? "") + forme);
}
const lettre = (c) => (FORMES.has(c) ? `[${c}${FORMES.get(c)}]` : c);

// Les ligatures lam-alif (U+FEF5 a U+FEFC) valent DEUX lettres a elles seules :
// « الأول » sort de l'extraction en quatre signes, pas cinq, et aucune classe
// de caracteres ne peut le rendre. C'est ce qui privait chaque loi de finances
// arabe de son article premier. On accepte donc, partout ou un mot porte un lam
// suivi d'un alif, soit les deux lettres, soit la ligature qui les remplace.
const LIGATURES_LAM_ALIF = "\ufef5\ufef6\ufef7\ufef8\ufef9\ufefa\ufefb\ufefc";
const ALIFS = "اأإآ";
function mot(s) {
  const parties = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\u0644" && i + 1 < s.length && ALIFS.includes(s[i + 1])) {
      parties.push(`(?:${lettre("\u0644")}${D}${lettre(s[i + 1])}|[${LIGATURES_LAM_ALIF}])`);
      i += 1;
      continue;
    }
    parties.push(lettre(s[i]));
  }
  return parties.join(D);
}

// La reconnaissance optique arabe rend les nombres en chiffres arabo-indiens
// (٠١٢٣٤٥٦٧٨٩), et le persan en emploie une seconde serie (۰۱۲۳۴۵۶۷۸۹). Ce sont
// les memes valeurs, ecrites autrement : la convention avec l'Arabie saoudite
// portait ses soixante-trois articles en chiffres arabo-indiens et n'en rendait
// aucun. On les accepte a la lecture et on les ramene en chiffres occidentaux.
const CHIFFRES_ORIENTAUX = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const CHIFFRE = "[0-9٠-٩۰-۹]";

/**
 * Ramene les chiffres orientaux d'un texte en chiffres occidentaux, et ne
 * touche a rien d'autre. Le datage des editions s'en sert : une convention en
 * arabe porte son millesime en chiffres arabo-indiens, et sans cette lecture
 * elle etait ecartee pour « millesime introuvable ».
 */
export function enChiffresOccidentaux(texte) {
  let s = "";
  for (const c of texte) {
    const i = CHIFFRES_ORIENTAUX.indexOf(c);
    s += i >= 0 ? String(i % 10) : c;
  }
  return s;
}

function nombre(texte) {
  return Number(enChiffresOccidentaux(texte));
}


// « Article premier » est la graphie legale francaise du numero 1 : sans elle,
// le premier article de chaque code manquait. Le point d'« Art. » est facultatif :
// la reconnaissance optique des vieux JORT le perd une fois sur dix.
export const RE_ARTICLE =
  /^[ \t]*(?:Article|Art\.?)\s*(\d{1,4}|premier|1\s*er)(\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?\s*(\((?:nouveau|modifie|modifié)[^)]{0,30}\))?\s*[.:\-–]?\s*/gim;

/**
 * Les ordinaux arabes : « الفصل الأولى », « المادة الثالثة ».
 *
 * Une partie des conventions internationales numerote ses articles en toutes
 * lettres plutot qu'en chiffres. Celles avec l'Arabie saoudite et la Cote
 * d'Ivoire n'en rendaient aucun pour cette seule raison. On construit la table
 * des ordinaux de 1 a 40, masculins et feminins, plutot que de l'ecrire a la
 * main : les formes composees s'en deduisent.
 */
function ordinauxArabes() {
  const unites = [
    ["الأول", "الأولى"], ["الثاني", "الثانية"], ["الثالث", "الثالثة"],
    ["الرابع", "الرابعة"], ["الخامس", "الخامسة"], ["السادس", "السادسة"],
    ["السابع", "السابعة"], ["الثامن", "الثامنة"], ["التاسع", "التاسعة"],
    ["العاشر", "العاشرة"],
  ];
  const dizaines = [[20, ["العشرون", "العشرين"]], [30, ["الثلاثون", "الثلاثين"]], [40, ["الأربعون", "الأربعين"]]];
  const table = new Map();
  const poser = (mots, valeur) => { for (const m of mots) table.set(m, valeur); };
  unites.forEach(([m, f], i) => poser([m, f], i + 1));
  // 11 a 19 : l'unite suivie de « عشر » ou « عشرة ».
  for (let i = 0; i < 9; i += 1) {
    const [m, f] = unites[i];
    poser([`${m} عشر`, `${f} عشرة`, `${m} عشرة`, `${f} عشر`], 11 + i);
  }
  for (const [valeur, formes] of dizaines) poser(formes, valeur);
  // 21 a 49 : l'unite, « و », puis la dizaine.
  for (const [valeur, formes] of dizaines) {
    for (let i = 0; i < 9; i += 1) {
      const [m, f] = unites[i];
      for (const d of formes) poser([`${m} و${d}`, `${f} و${d}`], valeur + i + 1);
    }
  }
  return table;
}

const ORDINAUX_AR = ordinauxArabes();
// L'alternance est ordonnee du plus long au plus court : sans quoi « الحادي »
// serait reconnu avant « الحادي والعشرون », et l'article 21 deviendrait le 1er.
const MOTIF_ORDINAL_AR = [...ORDINAUX_AR.keys()]
  .sort((a, b) => b.length - a.length)
  .map((o) => o.split(" ").map(mot).join("[ \\t]+"))
  .join("|");

const SUF_AR = {
  "مكرر": "bis", "ثالثا": "ter", "رابعا": "quater", "خامسا": "quinquies",
  "سادسا": "sexies", "سابعا": "septies", "ثامنا": "octies", "تاسعا": "nonies",
  "عاشرا": "decies",
};
const NOMS_AR = Object.keys(SUF_AR);
// « الأول » ressort de l'extraction tantot ا-ل-أ-و-ل, tantot ا-أ-ل-و-ل : on
// reconnait cinq lettres dont les trois premieres sont des alif ou des lam.
const CLASSE_ALIF = "[اأإآ]".split("").map((c) => (FORMES.get(c) ?? "")).join("");
const CLASSE_LAM = FORMES.get("ل") ?? "";
const ALIF_OU_LAM = `[الأإآ${CLASSE_ALIF}${CLASSE_LAM}]`;
const PREMIER_AR = `[اأإآ${CLASSE_ALIF}]` + D +
  `(?:${ALIF_OU_LAM}${D}${ALIF_OU_LAM}|[${LIGATURES_LAM_ALIF}])` + D +
  lettre("و") + D + lettre("ل");
export const RE_ARTICLE_AR = new RegExp(
  // « الفصل » dans les codes, « المادة » dans les conventions internationales :
  // les deux mots designent l'article, et une convention ratifiee entre au
  // corpus comme un code.
  "^[ \\t]*(?:" + mot("الفصل") + "|" + mot("المادة") + ")[ \\t]*(?:\\([ \\t]*)?(" + CHIFFRE + "{1,4}|" + MOTIF_ORDINAL_AR + "|" + PREMIER_AR + ")[ \\t]*" +
  "(" + NOMS_AR.map(mot).join("|") + ")?[ \\t]*" +
  "(?:\\)[ \\t]*)?(\\([ \\t]*" + mot("جديد") + "[ \\t]*\\))?[ \\t]*[.:\\-–]?[ \\t]*", "gm");


const RANG_SUFFIXE = {
  "": 0, bis: 1, ter: 2, quater: 3, quinquies: 4, sexies: 5,
  septies: 6, octies: 7, nonies: 8, decies: 9,
};
const RE_SUF_AR = new RegExp("^(?:" + NOMS_AR.map((n) => `(${mot(n)})`).join("|") + ")$");

function sufAr(s) {
  if (!s) return "";
  const m = RE_SUF_AR.exec(s.trim());
  if (!m) return "";
  for (let i = 1; i < m.length; i += 1) if (m[i]) return SUF_AR[NOMS_AR[i - 1]];
  return "";
}

/** Le numero tel qu'il est ecrit : chiffres, ordinal en toutes lettres, ou « premier ». */
function numeroLu(brut) {
  if (new RegExp(`^${CHIFFRE}+$`).test(brut)) return nombre(brut);
  const normalise = brut.replace(/[\u064B-\u0652\u0640]/g, "").replace(/\s+/g, " ").trim();
  return ORDINAUX_AR.get(normalise) ?? 1;
}

export function occurrences(texte, langue) {
  const ar = langue === "ar";
  const rx = new RegExp((ar ? RE_ARTICLE_AR : RE_ARTICLE).source, ar ? "gm" : "gim");
  return [...texte.matchAll(rx)].map((m) => ({
    num: numeroLu(m[1]),
    suf: ar ? sufAr(m[2]) : (m[2] ?? "").replace(/\s+/g, "").toLowerCase(),
    // « (jadid) » en arabe, « (nouveau) » en francais : la redaction en vigueur,
    // imprimee juste apres celle qu'elle remplace.
    neuf: Boolean(m[3]),
    pos: m.index,
  }));
}

/** Cle d'ordre : 13 bis vient apres 13 et avant 14. */
function rang(o) { return o.num * 10 + (RANG_SUFFIXE[o.suf] ?? 0); }

// Un code saute des numeros abroges. Mais un saut ne se juge pas dans l'absolu :
// dans le code des obligations et des contrats, qui compte 1 531 articles, les
// quatre-vingts numeros abroges d'un coup sont une broutille ; dans une loi de
// finances qui en compte cinquante, un saut de quatre-vingts est un renvoi vers
// un autre texte. Le saut tolere est donc PROPORTIONNEL au numero atteint, avec
// un plancher pour les textes courts.
const SAUT_PLANCHER = 15;
const SAUT_FRACTION = 0.20;
function sautTolere(rangPrecedent) {
  return Math.max(SAUT_PLANCHER * 10, rangPrecedent * SAUT_FRACTION);
}

/** Plus longue suite non decroissante d'un bloc : les citations sont contournees. */
function chaine(bloc) {
  const n = bloc.length;
  if (n === 0) return [];
  const long = new Array(n).fill(1);
  const prec = new Array(n).fill(-1);
  let meilleur = 0;
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const d = rang(bloc[i]) - rang(bloc[j]);
      if (d >= 0 && d <= sautTolere(rang(bloc[j])) && long[j] + 1 > long[i]) { long[i] = long[j] + 1; prec[i] = j; }
    }
    if (long[i] > long[meilleur]) meilleur = i;
  }
  const sortie = [];
  for (let i = meilleur; i >= 0; i = prec[i]) sortie.push(bloc[i]);
  return sortie.reverse();
}

/** Un fascicule enchaine des textes ; chacun renumerote a partir de 1. */
function blocs(occ) {
  const out = [];
  let courant = [];
  for (const o of occ) {
    if (o.num === 1 && o.suf === "" && courant.length) { out.push(courant); courant = []; }
    courant.push(o);
  }
  if (courant.length) out.push(courant);
  return out;
}

/** Un rang qui reapparait est une citation — sauf « (nouveau) », qui remplace. */
function dedoublonner(liste) {
  const par = new Map();
  for (const o of liste) {
    const cle = rang(o);
    const v = par.get(cle);
    if (!v || (o.neuf && !v.neuf)) par.set(cle, o);
  }
  return [...par.values()].sort((a, b) => a.pos - b.pos);
}

const CITATIONS_TOLEREES = 2;
// On ne recoud qu'a la suite d'un vrai debut de texte. Le code de la TVA s'ouvre
// sur le decret de promulgation — deux articles — puis sur le code lui-meme, qui
// renumerote a 1. Recoudre les deux faisait disparaitre les articles 1 et 2 DU
// CODE au profit de ceux du decret : « le ministre est charge de l'execution »
// tenait lieu d'article 2 de la TVA. Un texte a plus de quatre articles avant
// qu'une citation ne vienne le couper en deux.
const MINIMUM_AVANT_COUTURE = 5;

export function corpsDuCode(occ) {
  const chaines = blocs(occ).map(chaine).map(dedoublonner).filter((c) => c.length > 1);
  if (chaines.length === 0) return [];

  // RECOUDRE. Un « article premier » cite au milieu d'un code y ouvre une fausse
  // frontiere : sur le code des droits d'enregistrement, « Art. 1er loi n° 94-56 »
  // tombe entre l'article 9 et l'article 10, et le code perdait ses neuf premiers
  // articles. On referme la frontiere quand la suite reprend STRICTEMENT au-dessus
  // — un numero qui se repete a la jointure n'est pas la suite du texte — et quand
  // les elements a ecarter sont une petite minorite du bloc. Une VRAIE frontiere,
  // elle, fait repartir tout un bloc depuis 1 : il faudrait en retirer la moitie.
  const candidats = [chaines[0]];
  for (let i = 1; i < chaines.length; i += 1) {
    const prec = candidats[candidats.length - 1];
    const fin = rang(prec[prec.length - 1]);
    let k = 0;
    while (k < chaines[i].length && rang(chaines[i][k]) <= fin) k += 1;
    if (k <= CITATIONS_TOLEREES && k * 3 < chaines[i].length && chaines[i].length - k >= 2
        && prec.length >= MINIMUM_AVANT_COUTURE) {
      candidats[candidats.length - 1] = prec.concat(chaines[i].slice(k));
    } else candidats.push(chaines[i]);
  }

  // CHOISIR. Le nombre d'articles ecarte les faux candidats — deux occurrences
  // tres eloignees couvrent une immense etendue sans etre un texte. L'etendue en
  // caracteres tranche ensuite : le corps d'un code s'etale sur des dizaines de
  // milliers de caracteres, un decret annexe non, meme avec plus d'articles.
  const plusFourni = Math.max(...candidats.map((c) => c.length));
  const finalistes = candidats.filter((c) => c.length * 2 >= plusFourni);
  let corps = finalistes[0];
  let max = -1;
  for (const c of finalistes) {
    const etendue = c[c.length - 1].pos - c[0].pos;
    if (etendue > max) { max = etendue; corps = c; }
  }
  return dedoublonner(corps);
}

// ============================================================ LES RECUEILS

const MOIS = {
  janvier: 1, jan: 1, "جانفي": 1, fevrier: 2, "février": 2, "فيفري": 2,
  mars: 3, "مارس": 3, "مار": 3, avril: 4, "أفريل": 4, "افريل": 4,
  mai: 5, "ماي": 5, juin: 6, "جوان": 6, juillet: 7, "جويلية": 7,
  aout: 8, "août": 8, "أوت": 8, "اوت": 8, septembre: 9, "سبتمبر": 9,
  octobre: 10, "أكتوبر": 10, "اكتوبر": 10, "أثتوبر": 10, novembre: 11, "نوفمبر": 11,
  decembre: 12, "décembre": 12, "ديسمبر": 12,
};
const RE_MOIS = new RegExp("(\\d{1,2})\\s*(" + Object.keys(MOIS).join("|") + ")\\s*(\\d{4})", "i");
const RE_NUM_AR = /عدد\s*(\d{1,4})\s*(?:لسنة\s*(\d{4}))?/;
const RE_NUM_FR = /n°\s*(\d{2,4})\s*[-–]\s*(\d{1,4})/i;

/**
 * Reference du texte qui ouvre un bloc dans un recueil.
 *
 * Un recueil compile des dizaines d'arretes, decrets et lois, dont chacun
 * renumerote a partir de 1. Les confondre donnait cinquante « article premier »
 * dont un seul survivait : les autres textes disparaissaient, avales par
 * l'article precedent, et huit articles pesaient plus de douze mille caracteres.
 *
 * On rattache donc chaque bloc au texte imprime juste avant lui. La reference se
 * prend sur des CHIFFRES — numero, annee, date — et non sur des mots : ils sont
 * identiques en francais et en arabe, si bien qu'un texte porte la meme
 * reference dans les deux editions et que ses versions se relient.
 */
/**
 * Nature du texte qui ouvre un bloc : c'est elle qui dit ce qu'il vaut.
 *
 * Dans un recueil, une loi, un decret et un arrete se suivent sans transition et
 * n'ont pas la meme autorite. On lit la nature sur le mot qui ouvre l'entete —
 * le dernier de l'entete, car c'est celui qui precede immediatement le texte.
 * Les codes renvoyes sont ceux de legal.sources.
 */
// Ce qui ouvre le titre d'un texte, en francais et en arabe. L'arabe s'ecrit
// sans frontiere de mot au sens de JavaScript, et l'extraction colle parfois le
// mot au suivant (« أمرحكومي ») : on ne pose donc pas de \b, on ancre en tete de
// ligne. L'article defini « ال » est facultatif : les recueils ecrivent aussi
// bien « أمر » que « الأمر ». L'ordre compte — un decret-loi contient le mot
// decret, et doit etre reconnu avant lui.
const NATURES = [
  ["DECRET_LOI", /(?:d[ée]cret[ -]loi|مرسوم)/i],
  ["DECRET", /(?:d[ée]cret|[اأإ]?ل?[اأ]مر)/i],
  ["ARRETE", /(?:arr[êe]t[ée]|قرار)/i],
  ["LOI", /(?:loi|قانون)/i],
];

export function typeDuTexte(entete) {
  // Le titre du texte OUVRE une ligne : « ARRETE DU 15 MAI 1992 PRIS EN
  // APPLICATION DU DECRET DU 25 MAI 1950 » est un arrete, pas un decret. On lit
  // donc le premier mot d'une ligne, et l'on remonte depuis la fin de l'entete :
  // le titre le plus proche de l'article est le sien.
  const lignes = entete.split(/\r?\n/);
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const l = lignes[i].trim();
    if (!l) continue;
    for (const [code, rx] of NATURES) {
      if (new RegExp("^[(\\[]?\\s*(?:ال)?" + rx.source, "i").test(l)) return code;
    }
  }
  return null;
}

export function referenceDuTexte(entete) {
  const ar = RE_NUM_AR.exec(entete);
  const fr = RE_NUM_FR.exec(entete);
  const date = RE_MOIS.exec(entete);
  const annee = date ? Number(date[3]) : null;
  if (fr) {
    // « n° 2017-1061 » : l'annee est le membre a quatre chiffres ; « n° 60-22 »
    // porte un millesime a deux chiffres, d'avant l'an 2000 au-dela de 40.
    const a = Number(fr[1]), b = Number(fr[2]);
    return a > 1800 ? `${b}-${a}` : `${b}-${a < 100 ? (a > 40 ? 1900 + a : 2000 + a) : a}`;
  }
  if (ar) {
    const a = ar[2] ? Number(ar[2]) : annee;
    if (a) return `${Number(ar[1])}-${a}`;
  }
  if (date) {
    const m = MOIS[date[2].toLowerCase()];
    return `${annee}-${String(m).padStart(2, "0")}-${String(Number(date[1])).padStart(2, "0")}`;
  }
  return null;
}

// Le dernier article d'un texte porte souvent, collee derriere lui, toute son
// annexe tarifaire : « le ministre est charge de l'execution » suivi de
// quatre-vingt mille caracteres de tableaux. Le contenu compte, mais ce n'est
// pas l'article : au-dela de ce seuil on le detache sous son propre nom.
const SEUIL_ANNEXE = 8000;

// Ce qui, en tete de ligne, annonce la fin des articles et le debut des annexes.
const DEBUT_ANNEXE =
  /^[ \t]*(?:TABLEAU|ANNEXE|ANNEXES|D[EÉ]CRET|ARR[EÊ]T[EÉ]|LOI[ \t]+N|جدول|ملحق|أمر|قرار)\b/im;

/**
 * Detache l'annexe collee derriere un article.
 *
 * Le dernier article d'un texte porte tout ce qui le suit jusqu'au texte
 * suivant : sur le code de la TVA, l'article 21 — abroge, deux lignes — pesait
 * quarante et un mille caracteres, dont les tableaux A et B qui donnent les taux
 * reduits. Le contenu compte, mais ce n'est pas l'article : on le detache sous
 * son propre nom, et on coupe la ou l'annexe s'annonce plutot qu'au caractere
 * pres.
 */
function detacherAnnexe(article) {
  if (article.texte.length <= SEUIL_ANNEXE) return [article];
  let coupe = -1;
  const m = DEBUT_ANNEXE.exec(article.texte.slice(200));
  if (m) coupe = 200 + m.index;
  if (coupe < 0 || coupe > SEUIL_ANNEXE) {
    coupe = article.texte.lastIndexOf("\n", SEUIL_ANNEXE);
    if (coupe < SEUIL_ANNEXE / 2) coupe = SEUIL_ANNEXE;
  }
  const annexe = article.texte.slice(coupe).trim();
  const tete = article.texte.slice(0, coupe).trim();
  if (annexe.length < 30 || tete.length < 30) return [article];
  return [
    { ...article, texte: tete, fin: article.debut + coupe },
    { numero: `${article.numero} annexe`, texte: annexe, debut: article.debut + coupe, fin: article.fin },
  ];
}

function etiquette(o) { return o.suf ? `${o.num} ${o.suf}` : String(o.num); }

function tailler(texte, corps, finDuCorps, nom) {
  const articles = [];
  for (let i = 0; i < corps.length; i += 1) {
    const debut = corps[i].pos;
    const fin = i + 1 < corps.length ? corps[i + 1].pos : finDuCorps;
    const t = texte.slice(debut, fin).trim();
    if (t.length < 30) continue;
    articles.push({ numero: nom(corps[i]), texte: t, debut, fin });
  }
  return articles;
}

function decouperRecueil(texte, occ) {
  const groupes = blocs(occ).map(chaine).map(dedoublonner).filter((c) => c.length >= 2);
  const articles = [];
  const vus = new Set();
  for (let g = 0; g < groupes.length; g += 1) {
    const bloc = groupes[g];
    const entete = texte.slice(Math.max(0, bloc[0].pos - 700), bloc[0].pos);
    const ref = referenceDuTexte(entete) ?? `texte-${g + 1}`;
    const source = typeDuTexte(entete);
    const suivant = groupes[g + 1];
    const fin = suivant ? suivant[0].pos : texte.length;
    for (const a of tailler(texte, bloc, fin, (o) => `${ref} art. ${etiquette(o)}`)) {
      // Deux blocs peuvent renvoyer a la meme reference (un texte coupe par une
      // citation) : on garde la premiere occurrence de chaque article.
      if (vus.has(a.numero)) continue;
      vus.add(a.numero);
      for (const b of detacherAnnexe(a)) articles.push({ ...b, source });
    }
  }
  return articles;
}

/**
 * Decoupe un fascicule en articles.
 *
 * `compilation` : le fascicule n'est pas un code mais un RECUEIL de textes
 * separes. On ne cherche alors pas « le corps du code » — il n'y en a pas — et
 * chaque article est nomme par la reference de son texte d'origine.
 */
export function decouper(texte, langue, { compilation = false } = {}) {
  const occ = occurrences(texte, langue);
  if (occ.length === 0) return [];
  if (compilation) return decouperRecueil(texte, occ);
  const corps = corpsDuCode(occ);
  if (corps.length < 5) return [];
  const dernier = corps[corps.length - 1];
  const apres = occ.find((o) => o.pos > dernier.pos);
  const articles = tailler(texte, corps, apres ? apres.pos : texte.length, etiquette);
  if (articles.length === 0) return articles;
  return articles.slice(0, -1).concat(detacherAnnexe(articles[articles.length - 1]));
}
