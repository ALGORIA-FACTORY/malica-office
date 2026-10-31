/**
 * Le chargeur du sudoku — le moteur Rust, servi en WebAssembly.
 *
 * Le moteur est SANS ÉTAT : un JSON entre (contrat §3), un JSON sort
 * (contrat §4, `docs/sudoku/contrat-du-moteur.md`). Il ne lit aucun texte de
 * montant et ne porte aucune constante réglementaire : tout ce qu'il sait lui
 * est donné ici, par l'appelant, depuis la base.
 *
 * Trois exports bruts, sans wasm-bindgen : `alloc`, `dealloc`, `solve_json`.
 * `solve_json` rend un u64 : l'adresse de la sortie dans les 32 bits hauts,
 * sa longueur dans les 32 bits bas.
 */
import { readFileSync } from "node:fs";

/* ============================================================ L'ENTRÉE (§3) */

export interface LectureDeMontant {
  /** La valeur, en unités mineures entières. */
  readonly v: number;
  /** Lecture décimale (forte), ou lecture de repli (milliers, entier). */
  readonly forte: boolean;
}

export interface JetonDuSudoku {
  readonly page: number;
  readonly ordinal: number;
  readonly texte: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly montants: readonly LectureDeMontant[];
  /** Date ISO, ou null. */
  readonly date: string | null;
}

export interface ChampDeGrille {
  readonly code: string;
  readonly type: string;
  readonly reperes_fr: readonly string[];
  readonly reperes_ar: readonly string[];
  readonly format_code: string | null;
}

export interface PreuveDeGrille {
  readonly code: string;
  readonly expression: unknown;
  readonly statut: string;
  /** Nulle : la preuve vaut pour toute la grille. Nommée : pour cette variante seule. */
  readonly variante?: string | null;
}

export interface Grille {
  readonly code: string;
  readonly champs: readonly ChampDeGrille[];
  readonly preuves: readonly PreuveDeGrille[];
}

export interface PackDuSudoku {
  readonly decimales: number;
  readonly tolerance: number;
  readonly baremes: Readonly<Record<string, readonly { code: string; ppm: number }[]>>;
  readonly charges: readonly {
    code: string;
    montant_fixe: number | null;
    taux_ppm: number | null;
    assiette_tva: boolean;
  }[];
  readonly formats: Readonly<Record<string, string>>;
}

/** Ce que la base sait du dossier et de ses tiers (anneau 2). */
export interface Connus {
  readonly dossier: { readonly matricule: string; readonly raison_sociale: string | null } | null;
  readonly tiers: readonly {
    readonly code: string;
    readonly matricule: string;
    readonly raison_sociale: string | null;
  }[];
  readonly formes_juridiques: readonly string[];
}

export interface EntreeDuSudoku {
  readonly connus?: Connus;
  readonly jetons: readonly JetonDuSudoku[];
  readonly grille: Grille;
  readonly pack: PackDuSudoku;
  readonly plafond?: number;
}

/* ============================================================ LA SORTIE (§4) */

export interface RefDeJeton {
  readonly page: number;
  readonly ordinal: number;
}

export interface InstanceLue {
  /** Le code du taux dans le barème du pack. */
  readonly taux: string;
  readonly valeur: string | null;
  readonly refs: readonly RefDeJeton[];
}

export interface ChampLu {
  readonly valeur: string | null;
  readonly refs: readonly RefDeJeton[];
  readonly statut: "prouve" | "conforme" | "signale" | "absent";
  readonly instances?: readonly InstanceLue[];
}

/** Une valeur lue et citée. */
export interface Cite {
  readonly valeur: string;
  readonly refs: readonly RefDeJeton[];
  /** « deduit » : trouvée par le calcul du tableau, pas lue ; absente, elle est lue. */
  readonly statut?: "lu" | "deduit";
  /** Pour une cellule déduite : là où elle devrait être imprimée (relecture ciblée). */
  readonly case?: {
    readonly page: number;
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

/** Une ligne d'article (anneau 1). */
export interface LigneLue {
  readonly designation: Cite | null;
  readonly quantite: Cite;
  readonly prix: Cite;
  readonly remise: Cite | null;
  readonly montant: Cite;
  readonly taux: { readonly code: string; readonly refs: readonly RefDeJeton[] } | null;
}

/** Une valeur de l'en-tête, citée, avec son statut. */
export interface ValeurLue {
  readonly valeur: string;
  readonly refs: readonly RefDeJeton[];
  readonly statut: "prouve" | "conforme" | "signale";
}

export interface SortieDuSudoku {
  /** Les parties (anneau 2) : le sens par le matricule du dossier, la contrepartie par les tiers. */
  readonly parties?: {
    readonly sens: "achat" | "vente" | null;
    readonly statut: "prouve" | "signale" | "absent";
    readonly emetteur: { readonly matricule: ValeurLue | null; readonly nom: ValeurLue | null };
    readonly client: { readonly matricule: ValeurLue | null; readonly nom: ValeurLue | null };
    readonly tiers: { readonly code: string; readonly statut: string } | null;
    readonly raison?: string;
  };
  /** Les lignes d'articles, quand la grille porte une preuve `lignes`. Non bloquantes. */
  readonly lignes?: {
    readonly statut: "prouve" | "signale" | "absent";
    readonly instances: readonly LigneLue[];
    readonly taux_par_base: string;
    /** Le nombre de cellules trouvées par le calcul (lecture middle-out). */
    readonly deduites?: number;
  } | null;
  readonly issue: "prouvee" | "ambigue" | "aucune";
  /** La variante de la grille qui a prouvé la pièce, quand la grille en a. */
  readonly variante?: string;
  readonly solutions: number;
  readonly champs: Readonly<Record<string, ChampLu>>;
  readonly preuves: Readonly<Record<string, string>>;
  readonly combinaisons: number;
  readonly raison?: string;
}

/* ============================================================ LE MOTEUR ==== */

interface Exports {
  readonly memory: { readonly buffer: ArrayBuffer };
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  solve_json(ptr: number, len: number): bigint;
}

interface WasmGlobal {
  Module: new (octets: Uint8Array) => object;
  Instance: new (module: object, imports: object) => { exports: unknown };
}

let moteur: Exports | null = null;

/** Le moteur est compilé une fois par processus, au premier appel. */
function charger(): Exports {
  if (moteur) return moteur;
  let octets: Buffer;
  try {
    octets = readFileSync(new URL("../malica_sudoku.wasm", import.meta.url));
  } catch {
    throw new Error("sudoku : moteur absent — « npm run build -w @malica/sudoku » le construit");
  }
  // `WebAssembly` est un global de Node, que les types de Node ne déclarent pas
  // (ils vivent dans la bibliothèque DOM) : on décrit ici le seul usage qu'on en fait.
  const wasm = (globalThis as unknown as { WebAssembly: WasmGlobal }).WebAssembly;
  moteur = new wasm.Instance(new wasm.Module(octets), {}).exports as Exports;
  return moteur;
}

/** Le moteur est-il construit ? Les épreuves qui en dépendent s'en servent pour se dire sautées. */
export function moteurDisponible(): boolean {
  try {
    charger();
    return true;
  } catch {
    return false;
  }
}

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

/** Résoudre une pièce : une entrée du contrat, une sortie du contrat. */
export function resoudre(entree: EntreeDuSudoku): SortieDuSudoku {
  const m = charger();
  const octets = encodeur.encode(JSON.stringify(entree));
  const ptr = m.alloc(octets.length);
  if (octets.length > 0 && ptr === 0) throw new Error("sudoku : mémoire refusée");
  new Uint8Array(m.memory.buffer, ptr, octets.length).set(octets);

  const rendu = m.solve_json(ptr, octets.length);
  m.dealloc(ptr, octets.length);

  const sortiePtr = Number(BigInt.asUintN(64, rendu) >> 32n);
  const sortieLen = Number(BigInt.asUintN(64, rendu) & 0xffffffffn);
  if (sortiePtr === 0) throw new Error("sudoku : mémoire refusée");
  // Copier AVANT de libérer : la vue pointe dans la mémoire du moteur.
  const texte = decodeur.decode(new Uint8Array(m.memory.buffer, sortiePtr, sortieLen).slice());
  m.dealloc(sortiePtr, sortieLen);
  return JSON.parse(texte) as SortieDuSudoku;
}
