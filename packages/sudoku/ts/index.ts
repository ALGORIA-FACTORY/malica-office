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
  /** La confiance de l'OCR dans ce jeton (0..1) ; absente, il est exact. */
  readonly confiance?: number;
  /** Le jeton porte un mot que l'OCR a pu mal lire (`lexique.ts` de l'API). */
  readonly douteux?: boolean;
  /** Date ISO, ou null. */
  readonly date: string | null;
  /**
   * Quand la date s'écrit sur plusieurs jetons d'une rangée (« 13 mai 2026 ») :
   * l'ordinal du dernier. Elle est portée par le premier, et citée en entier.
   */
  readonly date_fin?: number;
  /**
   * Les identifiants que le lecteur du pack lit dans ce jeton (et ses voisins
   * collés jusqu'à `fin`) : le matricule normalisé par `normaliserMatricule`,
   * sous le code de son format. Le moteur ne relit pas le texte.
   */
  readonly identifiants?: readonly {
    readonly format: string;
    readonly valeur: string;
    readonly fin: number;
  }[];
  /**
   * Le montant écrit en toutes lettres qui commence à ce jeton, lu par
   * l'adaptateur (`lireLeMontantEnLettres`) dans la devise de la pièce, en
   * unités mineures ; `fin` : l'ordinal de son dernier mot.
   */
  readonly lettres?: { readonly v: number; readonly fin: number };
  /**
   * Les coupes possibles d'un jeton où l'OCR a collé deux cellules
   * (« 12400,000 » = « 1 » | « 2400,000 ») : `coupe` caractères à gauche, lus
   * comme un entier (`gauche`, en unités mineures) ; le reste, comme un montant.
   */
  readonly decoupes?: readonly {
    readonly coupe: number;
    readonly gauche: number;
    readonly droite: readonly LectureDeMontant[];
  }[];
}

export interface ChampDeGrille {
  readonly code: string;
  readonly type: string;
  readonly reperes_fr: readonly string[];
  readonly reperes_ar: readonly string[];
  readonly format_code: string | null;
  /** La famille d'experts du concept du champ (`ref.concepts.expert`). */
  readonly expert?: string;
  /** La parcelle de la grille où le champ s'imprime (`ref.grille_champs.parcelle`). */
  readonly parcelle?: string;
  /**
   * La partie que le champ décrit (`ref.grille_champs.role` : fournisseur, client,
   * employeur…), ou `null` : l'identité du dossier ne remplit qu'un seul rôle par pièce.
   */
  readonly role?: string | null;
  /**
   * Le champ appartient à une parcelle répétée (une occurrence par ligne, par résolution,
   * par mouvement : `ref.grille_champs.repetee`) : il ne se lit pas comme un champ unique.
   */
  readonly repetee?: boolean;
  /**
   * Le domaine d'un champ « liste » (`ref_valeurs_des_domaines_v`) : chaque code et ses
   * formes imprimables. Présent, le champ ne se lit qu'en un code de ce domaine.
   */
  readonly valeurs?: readonly { readonly code: string; readonly formes: readonly string[] }[];
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
    /** Le montant standard ; gardé pour compatibilité, il compte parmi les admis. */
    montant_fixe: number | null;
    /** Tout montant que le pack admet au jour de la pièce (le standard et son barème). */
    montants_admis?: readonly number[];
    taux_ppm: number | null;
    assiette_tva: boolean;
  }[];
  readonly formats: Readonly<Record<string, string>>;
  /**
   * Sous cette confiance de lecture, un texte qu'aucun calcul ne prouve (une
   * désignation) n'est pas rendu (`lecture.confiance_du_texte`).
   */
  readonly confiance_du_texte?: number;
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
  /**
   * « deduit » : trouvée par le calcul du tableau, pas lue ; « coupe » : lue dans
   * un jeton où l'OCR a collé deux cases, à la coupe `coupe` ; absente, elle est lue.
   */
  readonly statut?: "lu" | "deduit" | "coupe";
  /** Pour une cellule « coupe » : la coupe retenue parmi les `decoupes` du jeton. */
  readonly coupe?: number;
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
  /** Le prix lu est TTC : la rangée ferme par q × prix ÷ (1 + taux) = montant HT. */
  readonly prix_ttc?: boolean;
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
    /** La remise globale lue qui ferme les lignes sur le total HT, quand le total brut n'est pas prouvé. */
    readonly remise_globale?: Cite | null;
  } | null;
  /**
   * `signalee` : une seule affectation ferme l'arithmétique, mais une preuve de
   * recoupement la contredit (le montant en lettres) — la pièce n'est pas prouvée.
   */
  readonly issue: "prouvee" | "signalee" | "ambigue" | "aucune";
  /** La variante de la grille qui a prouvé la pièce, quand la grille en a. */
  readonly variante?: string;
  readonly solutions: number;
  readonly champs: Readonly<Record<string, ChampLu>>;
  readonly preuves: Readonly<Record<string, string>>;
  readonly combinaisons: number;
  readonly raison?: string;
  /**
   * Le champ dont la valeur vient du montant en lettres : rien ne fermait en
   * chiffres, et la pièce s'est prouvée par lui (le total relevé de travers).
   */
  readonly par_lettres?: string;
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
