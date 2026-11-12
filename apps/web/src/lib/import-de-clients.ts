/**
 * Lire la liste de clients qu'une comptabilité importe : un fichier Excel
 * (.xlsx), un CSV, ou des lignes collées depuis un tableur.
 *
 * Les noms de colonnes se reconnaissent seuls (« Matricule fiscal », « MF »,
 * « Raison sociale », « E-mail du dirigeant »…) : la comptabilité dépose son
 * tableur tel quel. Rien ne se décide ici sur la validité d'une ligne : la
 * base vérifie (`identite.verifierDossiers`).
 */
import { strFromU8, unzipSync } from "fflate";

export type ChampImport =
  "matricule" | "raison_sociale" | "email" | "adresse" | "offre" | "honoraires";

export interface LigneImport {
  matricule: string;
  raison_sociale: string;
  email: string;
  adresse: string;
  offre: string;
  honoraires: string;
}

/** Les noms qu'une colonne peut porter, sans accents, en minuscules. */
const NOMS: Record<ChampImport, readonly string[]> = {
  matricule: [
    "matricule",
    "matricule fiscal",
    "mf",
    "identifiant fiscal",
    "id fiscal",
    "numero fiscal",
    "tax id",
  ],
  raison_sociale: [
    "raison sociale",
    "societe",
    "nom",
    "nom de la societe",
    "denomination",
    "entreprise",
    "client",
    "company",
  ],
  email: [
    "email",
    "e-mail",
    "mail",
    "courriel",
    "email du dirigeant",
    "e-mail du dirigeant",
    "dirigeant",
    "contact",
  ],
  adresse: ["adresse", "adresse du siege", "siege", "address"],
  offre: ["offre", "abonnement", "offre malica", "forfait malica"],
  honoraires: ["honoraires", "forfait", "honoraires mensuels", "forfait mensuel", "montant"],
};

const sansAccents = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_.:*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** La colonne de chaque champ reconnu dans l'en-tête ; un champ absent n'y est pas. */
export function reconnaitreColonnes(
  entete: readonly string[],
): Partial<Record<ChampImport, number>> {
  const vu: Partial<Record<ChampImport, number>> = {};
  const noms = entete.map(sansAccents);
  for (const champ of Object.keys(NOMS) as ChampImport[]) {
    const i = noms.findIndex((n) => NOMS[champ].includes(n));
    if (i >= 0 && !Object.values(vu).includes(i)) vu[champ] = i;
  }
  return vu;
}

/** Un texte CSV, TSV ou collé : le séparateur se devine sur la première ligne. */
export function lireTexte(texte: string): string[][] {
  const propre = texte.replace(/^\uFEFF/, "");
  const premiere = propre.split(/\r?\n/, 1)[0] ?? "";
  const sep = premiere.includes("\t")
    ? "\t"
    : premiere.split(";").length > premiere.split(",").length
      ? ";"
      : ",";
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let cellule = "";
  let guillemets = false;
  for (let i = 0; i < propre.length; i++) {
    const c = propre[i]!;
    if (guillemets) {
      if (c === '"' && propre[i + 1] === '"') {
        cellule += '"';
        i++;
      } else if (c === '"') {
        guillemets = false;
      } else {
        cellule += c;
      }
      continue;
    }
    if (c === '"' && cellule === "") guillemets = true;
    else if (c === sep) {
      ligne.push(cellule);
      cellule = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && propre[i + 1] === "\n") i++;
      ligne.push(cellule);
      lignes.push(ligne);
      ligne = [];
      cellule = "";
    } else cellule += c;
  }
  if (cellule !== "" || ligne.length > 0) {
    ligne.push(cellule);
    lignes.push(ligne);
  }
  return lignes.map((l) => l.map((x) => x.trim())).filter((l) => l.some((x) => x !== ""));
}

/** La colonne d'une référence de cellule Excel (« C12 » → 2). */
function colonneDe(ref: string): number {
  const lettres = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const l of lettres) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

/** La première feuille d'un classeur .xlsx, en lignes de textes. */
export function lireXlsx(octets: Uint8Array): string[][] {
  const fichiers = unzipSync(octets);
  const xml = (nom: string) => {
    const f = fichiers[nom];
    return f ? new DOMParser().parseFromString(strFromU8(f), "application/xml") : null;
  };
  const partages: string[] = [];
  const sst = xml("xl/sharedStrings.xml");
  if (sst) {
    for (const si of Array.from(sst.getElementsByTagName("si"))) {
      partages.push(
        Array.from(si.getElementsByTagName("t"))
          .map((t) => t.textContent ?? "")
          .join(""),
      );
    }
  }
  const nomFeuille =
    Object.keys(fichiers)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))[0] ?? "";
  const feuille = xml(nomFeuille);
  if (!feuille) return [];
  const lignes: string[][] = [];
  for (const row of Array.from(feuille.getElementsByTagName("row"))) {
    const ligne: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const texte =
        type === "s"
          ? (partages[Number(v)] ?? "")
          : type === "inlineStr"
            ? Array.from(c.getElementsByTagName("t"))
                .map((t) => t.textContent ?? "")
                .join("")
            : v;
      ligne[colonneDe(c.getAttribute("r") ?? "A")] = texte.trim();
    }
    const pleine = Array.from(ligne, (x) => x ?? "");
    if (pleine.some((x) => x !== "")) lignes.push(pleine);
  }
  return lignes;
}

/** Un montant d'honoraires écrit à la main : « 250 », « 1 200,500 ». */
const UN_MONTANT = /^\d+(?:[.,]\d+)?$/;

/**
 * Les lignes à importer. La première ligne est l'en-tête si elle nomme au
 * moins le matricule ; sinon l'ordre attendu est matricule, raison sociale,
 * e-mail du dirigeant, puis les colonnes facultatives.
 *
 * Sans en-tête, une cellule facultative se reconnaît à ce qu'elle porte
 * (recette du 11 novembre 2026, 3.4 : « …;Solo;250 » arrivait sans mandat ni
 * abonnement) : un montant est l'honoraire mensuel, une offre du catalogue
 * (`offres`, lu en base par l'écran) est l'offre Malica, le reste l'adresse.
 */
export function lignesDuTableur(
  tableau: string[][],
  offres: readonly { code: string; libelle: string }[] = [],
): {
  lignes: LigneImport[];
  colonnes: ChampImport[];
} {
  if (tableau.length === 0) return { lignes: [], colonnes: [] };
  const vu = reconnaitreColonnes(tableau[0]!);
  const avecEntete = vu.matricule !== undefined;
  const carte: Partial<Record<ChampImport, number>> = avecEntete
    ? vu
    : { matricule: 0, raison_sociale: 1, email: 2 };
  const corps = avecEntete ? tableau.slice(1) : tableau;
  const lire = (l: string[], champ: ChampImport) =>
    carte[champ] === undefined ? "" : (l[carte[champ]!] ?? "").trim();
  const offreDe = (valeur: string) => {
    const v = sansAccents(valeur);
    return offres.find((o) => sansAccents(o.code) === v || sansAccents(o.libelle) === v)?.code;
  };
  const facultatifs = (l: string[]) => {
    const f = {
      adresse: lire(l, "adresse"),
      offre: lire(l, "offre"),
      honoraires: lire(l, "honoraires"),
    };
    if (avecEntete) return f;
    for (const cellule of l
      .slice(3)
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (UN_MONTANT.test(cellule.replace(/\s/g, ""))) f.honoraires ||= cellule;
      else if (offreDe(cellule)) f.offre ||= cellule;
      else f.adresse ||= cellule;
    }
    return f;
  };
  return {
    colonnes: Object.keys(carte) as ChampImport[],
    lignes: corps.map((l) => {
      const f = facultatifs(l);
      return {
        matricule: lire(l, "matricule").toUpperCase(),
        raison_sociale: lire(l, "raison_sociale"),
        email: lire(l, "email").toLowerCase(),
        adresse: f.adresse,
        offre: offreDe(f.offre) ?? sansAccents(f.offre),
        honoraires: f.honoraires.replace(/\s/g, "").replace(",", "."),
      };
    }),
  };
}

/** Le modèle à télécharger : les colonnes déjà nommées. */
export const MODELE_CSV =
  "Matricule fiscal;Raison sociale;E-mail du dirigeant;Adresse;Offre;Honoraires\n";
