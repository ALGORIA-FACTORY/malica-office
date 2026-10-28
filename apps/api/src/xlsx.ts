/**
 * Un classeur Excel (.xlsx) d'une feuille, écrit sans bibliothèque de tableur.
 *
 * ============================================================== POURQUOI
 *
 * Le journal du jour s'exporte « en Excel » : un comptable l'ouvre, le trie,
 * l'additionne. Un fichier .xlsx n'est qu'une archive zip de quelques
 * fichiers XML (Office Open XML, ECMA-376). Les bibliothèques de tableur
 * pèsent des mégaoctets pour lire et écrire tout le format ; il nous faut
 * l'écrire, une feuille, du texte et des montants. On écrit donc le XML
 * ici, et `fflate` — déjà au dépôt, pour l'archive comptable du poste —
 * fait le zip.
 *
 * Les montants entrent en CHAÎNES décimales et sortent telles quelles dans
 * la cellule (`<v>428.731</v>`) : aucun flottant ne passe entre la base et
 * le fichier. Le tableur les lira comme des nombres ; le format d'affichage
 * porte la précision du pack, reçue en paramètre.
 *
 * L'archive est datée d'un instant fourni par l'appelant, pas de l'horloge :
 * le même contenu donne les mêmes octets, donc la même empreinte.
 */
import { zipSync, strToU8 } from "fflate";

/** Une cellule : du texte, ou un montant en chaîne décimale. */
export type Cellule = { texte: string } | { montant: string };

export interface Feuille {
  nom: string;
  /** La première ligne : en gras, figée au défilement. */
  entete: readonly string[];
  lignes: readonly Cellule[][];
  /** Les lignes de total, en gras après les lignes. */
  totaux?: readonly Cellule[][];
  /** Une feuille lue de droite à gauche (arabe). */
  droiteAGauche?: boolean;
}

const NS_TABLEUR = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_RELATIONS_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_RELATIONS_PAQUET = "http://schemas.openxmlformats.org/package/2006/relationships";
const EN_TETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Les styles de cellule, dans l'ordre de `cellXfs` ci-dessous. */
const STYLE = { texte: 0, montant: 1, texteGras: 2, montantGras: 3 } as const;

/** Le numéro de format personnalisé : 164 est le premier libre (ECMA-376, 18.8.30). */
const FORMAT_MONTANT = 164;

/** Échappe un texte pour XML, et retire les caractères qu'XML 1.0 interdit. */
function xml(v: string): string {
  return (
    v
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  );
}

/** A, B, …, Z, AA, AB… — la colonne d'un indice partant de zéro. */
export function lettreDeColonne(indice: number): string {
  let n = indice + 1;
  let lettres = "";
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettres = String.fromCharCode(65 + reste) + lettres;
    n = Math.floor((n - 1) / 26);
  }
  return lettres;
}

/** Un montant n'entre dans une cellule numérique que s'il est un décimal écrit. */
function montantValide(v: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`xlsx.montant_illisible: ${v}`);
  return v;
}

function cellule(c: Cellule, ref: string, gras: boolean): string {
  if ("montant" in c) {
    const s = gras ? STYLE.montantGras : STYLE.montant;
    return `<c r="${ref}" s="${s}"><v>${montantValide(c.montant)}</v></c>`;
  }
  const s = gras ? STYLE.texteGras : STYLE.texte;
  if (c.texte === "") return `<c r="${ref}" s="${s}"/>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(c.texte)}</t></is></c>`;
}

function rangee(cellules: readonly Cellule[], numero: number, gras: boolean): string {
  const contenu = cellules
    .map((c, i) => cellule(c, `${lettreDeColonne(i)}${numero}`, gras))
    .join("");
  return `<row r="${numero}">${contenu}</row>`;
}

function feuilleXml(f: Feuille): string {
  const rangees: string[] = [
    rangee(
      f.entete.map((texte) => ({ texte })),
      1,
      true,
    ),
  ];
  let n = 2;
  for (const l of f.lignes) rangees.push(rangee(l, n++, false));
  for (const l of f.totaux ?? []) rangees.push(rangee(l, n++, true));
  const sens = f.droiteAGauche ? ' rightToLeft="1"' : "";
  return (
    EN_TETE_XML +
    `<worksheet xmlns="${NS_TABLEUR}">` +
    `<sheetViews><sheetView workbookViewId="0"${sens}>` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetData>${rangees.join("")}</sheetData>` +
    `</worksheet>`
  );
}

/** Le format d'affichage d'un montant : séparateur de milliers, N décimales. */
function formatDeMontant(decimales: number): string {
  return decimales > 0 ? `#,##0.${"0".repeat(decimales)}` : "#,##0";
}

function stylesXml(decimales: number): string {
  return (
    EN_TETE_XML +
    `<styleSheet xmlns="${NS_TABLEUR}">` +
    `<numFmts count="1"><numFmt numFmtId="${FORMAT_MONTANT}" formatCode="${xml(formatDeMontant(decimales))}"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="${FORMAT_MONTANT}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="${FORMAT_MONTANT}" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`
  );
}

/**
 * Le classeur. `decimales` vient du pack ; `date` date les entrées de
 * l'archive (le même contenu, les mêmes octets).
 */
export function classeurXlsx(f: Feuille, decimales: number, date: Date): Uint8Array {
  const fichiers: Record<string, string> = {
    "[Content_Types].xml":
      EN_TETE_XML +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      EN_TETE_XML +
      `<Relationships xmlns="${NS_RELATIONS_PAQUET}">` +
      `<Relationship Id="rId1" Type="${NS_RELATIONS_DOC}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      EN_TETE_XML +
      `<workbook xmlns="${NS_TABLEUR}" xmlns:r="${NS_RELATIONS_DOC}">` +
      `<sheets><sheet name="${xml(f.nom.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      EN_TETE_XML +
      `<Relationships xmlns="${NS_RELATIONS_PAQUET}">` +
      `<Relationship Id="rId1" Type="${NS_RELATIONS_DOC}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${NS_RELATIONS_DOC}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    "xl/worksheets/sheet1.xml": feuilleXml(f),
    "xl/styles.xml": stylesXml(decimales),
  };
  const entrees = Object.fromEntries(
    Object.entries(fichiers).map(([chemin, texte]) => [chemin, strToU8(texte)]),
  );
  return zipSync(entrees, { level: 6, mtime: date });
}

/** Le type d'un classeur, tel qu'un navigateur l'attend. */
export const TYPE_MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
