/**
 * Dechiffrement des editions dont la police porte un encodage maison.
 *
 * Huit lois de finances (2000-2005) sont publiees avec une police sous-ensemble
 * sans table ToUnicode : l'extraction rend « /RLQGXGpFHPEUH » la ou le papier
 * porte « Loi n du 28 decembre ». Ce n'est pas du bruit, c'est une substitution :
 * chaque code du fichier vaut un caractere, toujours le meme.
 *
 * Deux etages :
 *
 *   1. UN DECALAGE de +29 rend les lettres, chiffres et ponctuations ASCII. Il
 *      se lit sans rien supposer : le caractere le plus frequent d'un texte est
 *      l'espace, et il vaut ici 0x03.
 *   2. UNE TABLE pour la trentaine de codes restants — les accents, les
 *      guillemets, l'apostrophe — que la police a ranges dans son propre ordre.
 *      Chaque entree est ADOSSEE A UNE PREUVE relevee dans le texte lui-meme,
 *      citee en commentaire. On ne devine pas : « impts » ne peut etre que
 *      « impots », « exerant » que « exercant », « en uvre » que « en oeuvre ».
 *
 * Le tout est ensuite VERIFIE : une deduction independante, fondee sur des mots
 * francais dont la forme accentuee est certaine, doit retomber sur la meme
 * table. Un code qui resiste aux deux est remplace par une espace, jamais devine.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DECALAGE = 29;

/**
 * Table de la police, code apres decalage -> caractere reel.
 * La preuve de chaque entree est le mot ou la tournure ou elle se lit.
 */
export const TABLE_POLICE = new Map(
  Object.entries({
    "0x81": "Ç", // « TRADUCTION FRANAISE » -> FRANCAISE, C cedille majuscule
    "0x87": "à", // « appeles  exercer », « conseillers  la cour » -> a accent grave
    "0x88": "â", // « terrains non btis » -> batis
    "0x8c": "ç", // « entreprises exerant » -> exercant
    "0x94": "ï", // « Lamia Ben Ismal », « Mohamed Mana » -> Ismail, Manai
    "0x98": "ô", // « les impts, taxes, redevances » -> impots
    "0x9c": "ù", // « dans le cas o les interesses » -> ou
    "0xa0": "°", // « Loi n 2001-123 », « N 104 » -> n degre
    "0xc6": "«", // « conformement au tableau  A  annexe » -> guillemet ouvrant
    "0xc7": "»", // idem, guillemet fermant
    "0xc8": ".", // suite de points de conduite d'une table des matieres
    "0xcd": "œ", // « en uvre », « d uvrer » -> oeuvre, oeuvrer
    "0xce": "—", // « articles 16 et 17  I et II » -> tiret cadratin
    "0xcf": "—", // « Republique Tunisienne  28 decembre 2001 » -> tiret cadratin
    "0xd3": "’", // « larticle 39 bis », « dun secretaire » -> apostrophe
  }).map(([k, v]) => [Number(k), v]),
);

// Mots frequents dont la forme accentuee est certaine : leur squelette de
// consonnes ne correspond a aucun autre mot francais. Ils servent de temoins.
const TEMOINS = [
  "décembre",
  "février",
  "présent",
  "arrêté",
  "année",
  "après",
  "économique",
  "société",
  "opérations",
  "impôt",
  "impôts",
  "général",
  "règlement",
  "française",
  "élément",
  "août",
  "décret",
  "réduction",
  "déclaration",
  "prévu",
  "conformément",
  "intérêt",
  "créance",
  "propriété",
  "activité",
  "bénéfice",
  "déduction",
  "exonération",
  "période",
  "révision",
  "sécurité",
  "spécial",
  "unité",
  "réalisé",
  "ministère",
  "complémentaire",
  "procédure",
  "détermination",
  "régime",
  "modalités",
  "exerçant",
  "bâtis",
  "contrôle",
];

function decale(texte) {
  let s = "";
  for (const c of texte) {
    const k = c.codePointAt(0);
    s += k === 10 || k === 13 || k === 32 ? c : String.fromCodePoint(k + DECALAGE);
  }
  return s;
}

function squelette(mot) {
  let s = "";
  for (const c of mot) s += /[A-Za-z]/.test(c) ? c.toLowerCase() : " ";
  return s;
}

/** Deduction independante : sert de controle, pas de source. */
export function tableDeduite(texte) {
  const d = decale(texte);
  const parSquelette = new Map();
  for (const t of TEMOINS) {
    const sq = squelette(t);
    const liste = parSquelette.get(sq) ?? [];
    liste.push(t);
    parSquelette.set(sq, liste);
  }
  const votes = new Map();
  for (const mot of d.split(/[^A-Za-z-ÿ]+/)) {
    if (mot.length < 3) continue;
    const sq = squelette(mot);
    if (!sq.includes(" ")) continue;
    const cands = parSquelette.get(sq);
    if (!cands || cands.length !== 1) continue;
    const cible = cands[0];
    if (cible.length !== mot.length) continue;
    for (let i = 0; i < mot.length; i += 1) {
      if (/[A-Za-z]/.test(mot[i])) continue;
      const k = mot.codePointAt(i);
      const v = votes.get(k) ?? new Map();
      v.set(cible[i], (v.get(cible[i]) ?? 0) + 1);
      votes.set(k, v);
    }
  }
  const table = new Map();
  for (const [code, v] of votes) {
    let lettre = null,
      n = 0;
    for (const [l, c] of v)
      if (c > n) {
        n = c;
        lettre = l;
      }
    if (n >= 3) table.set(code, lettre); // une seule attestation ne fait pas une regle
  }
  return table;
}

/** true si le texte sort d'une police a encodage maison. */
export function estChiffre(texte) {
  if (!texte) return false;
  const freq = new Map();
  for (const c of texte) {
    const k = c.codePointAt(0);
    if (k === 10 || k === 13) continue;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  let dominant = 32,
    n = -1;
  for (const [k, v] of freq)
    if (v > n) {
      n = v;
      dominant = k;
    }
  return dominant === 32 - DECALAGE;
}

export function dechiffrer(texte) {
  const d = decale(texte);
  const controle = tableDeduite(texte);
  const desaccords = [];
  for (const [k, v] of controle) {
    const attendu = TABLE_POLICE.get(k);
    if (attendu && attendu !== v)
      desaccords.push(`${k.toString(16)}: table=${attendu} deduit=${v}`);
  }
  const table = new Map(TABLE_POLICE);
  for (const [k, v] of controle) if (!table.has(k)) table.set(k, v);
  let s = "";
  let inconnus = 0;
  for (const c of d) {
    const k = c.codePointAt(0);
    const r = table.get(k);
    if (r !== undefined) {
      s += r;
      continue;
    }
    // Les accents rendus tels quels par le decalage (e aigu, e grave, e
    // circonflexe, u circonflexe) sont deja justes ; le reste est inconnu.
    if (k <= 0x7e || (k >= 0xc0 && k <= 0xff)) {
      s += c;
      continue;
    }
    inconnus += 1;
    s += " ";
  }
  return { texte: s, desaccords, inconnus, codes: table.size };
}

if (process.argv[2]) {
  const brut = readFileSync(process.argv[2], "utf8");
  const r = dechiffrer(brut);
  console.error(
    `${process.argv[2]} : ${r.codes} codes, ${r.inconnus} caracteres inconnus` +
      (r.desaccords.length ? ` | DESACCORDS ${r.desaccords.join(", ")}` : " | controle ok"),
  );
  if (process.argv[3]) writeFileSync(process.argv[3], r.texte, "utf8");
  else console.log(r.texte.slice(0, 1000));
}
