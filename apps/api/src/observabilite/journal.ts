/**
 * Le journal d'observabilité — écrire sans jamais nuire, et sans perdre.
 *
 * ============================================================== CE QU'IL PROMET
 *
 *   1. Il n'est JAMAIS dans la transaction métier : il écrit par sa propre
 *      connexion (`consignerEnBase`), après coup. La trace d'un refus ou d'un
 *      rollback reste.
 *   2. Il ne ralentit pas une requête : `consigner` range l'événement dans une
 *      file en mémoire et rend la main ; la file s'écrit par lots.
 *   3. Sa mémoire est BORNÉE : file pleine, ou base injoignable, les
 *      événements partent dans un fichier d'attente sur disque
 *      (`JOURNAL_ATTENTE`), une ligne JSON par événement, rejoué au démarrage
 *      et périodiquement. Le rejeu est sans doublon : la base ne retient
 *      qu'une fois (trace, étape, clé) et compte les répétitions.
 *   4. Un arrêt demandé (SIGTERM, SIGINT) vide la file : en base si elle
 *      répond, sur disque sinon.
 *   5. Ce qui est réellement perdu — disque plein, ligne illisible, lot que la
 *      base refuse — est COMPTÉ, et dit par une étape `perte` au prochain lot
 *      écrit.
 *
 * Ce qu'il ne promet pas : un arrêt brutal (SIGKILL, panne de la machine)
 * perd ce que la file tenait en mémoire, au plus un intervalle d'écriture.
 * C'est le prix de « ne jamais ralentir une requête » ; le compter serait
 * mentir, puisque le processus qui compte est mort.
 */
import { appendFileSync, createReadStream, mkdirSync } from "node:fs";
import { readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";

import { consignerEnBase, purgerLeJournal } from "../db.ts";
import { introuvableLisible, refusLisible } from "../refus.ts";
import { nouvelleTrace, sousLaTrace, traceCourante, type Trace } from "./trace.ts";

/** L'issue d'une étape : le vocabulaire de `observabilite.issue_t`. */
export type Issue = "ok" | "refus" | "erreur" | "ignore";

/** Un détail : des scalaires seulement. La base n'en garde que les clés que l'étape autorise. */
type Detail = Readonly<Record<string, string | number | boolean | null>>;

/** Un événement tel qu'il part en base, et tel qu'il dort sur disque. */
export interface Evenement {
  trace: {
    id: string;
    parente: string | null;
    origine: string;
    tenant: string | null;
    acteur: string | null;
    piece: string | null;
    version: string | null;
    debut: string;
  };
  etape: string;
  issue: Issue;
  cle: string;
  debut: string;
  dureeMs: number | null;
  acteur: string | null;
  piece: string | null;
  audits: readonly string[];
  detail: Detail;
}

export interface OptionsDuJournal {
  /**
   * Écrit un lot en base ; rejette si la base ne répond pas ou refuse. Rend
   * le nombre d'événements que la porte a écartés à la validation : ce sont
   * des pertes, et elles se disent.
   */
  ecrire: (lot: readonly Evenement[]) => Promise<{ rejetes: number }>;
  /** Le dossier du fichier d'attente ; `null` : rien ne se déverse, tout débordement est une perte. */
  repertoire: string | null;
  /** Le nombre d'événements que la file tient en mémoire, au plus. */
  borne: number;
  /** La taille d'un lot écrit en base. */
  taille: number;
  /** Le délai avant d'écrire une file qui n'a pas atteint un lot. */
  intervalleMs: number;
  /** Le délai entre deux rejeux du fichier d'attente, et l'attente après une panne de base. */
  rejeuMs: number;
  /** La taille d'un fichier d'attente au-delà de laquelle on passe au suivant (16 Mo par défaut). */
  fichierMaxOctets?: number;
  /** L'écriture sur disque (ajout en fin de fichier) ; remplacée par les épreuves du disque plein. */
  ajouter?: (chemin: string, texte: string) => void;
}

const FICHIER_MAX_OCTETS = 16 * 1024 * 1024;

/**
 * Une panne de la base (connexion, délai, arrêt) se réessaie plus tard ; un
 * REFUS de la base (donnée, contrainte, droit, porte) ne se réessaie pas : le
 * rejouer l'empoisonnerait pour toujours. Les classes 22, 23, 42 et P0 sont
 * ces refus.
 */
function estUnRefusDeLaBase(erreur: unknown): boolean {
  const code = (erreur as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^(22|23|42|P0)/.test(code);
}

const PREFIXE_ATTENTE = "attente-";
const PREFIXE_REJEU = "rejeu-";

export class Journal {
  private file: Evenement[] = [];
  private ecriture: Promise<void> | null = null;
  /** Le lot qu'une écriture en cours a retiré de la file. */
  private enVol: readonly Evenement[] | null = null;
  private rejeu: Promise<void> | null = null;
  private minuteur: NodeJS.Timeout | null = null;
  private minuteurDeRejeu: NodeJS.Timeout | null = null;
  /** Jusqu'à quand la base est tenue pour injoignable : on déverse sans l'essayer. */
  private baseEnPanneJusqua = 0;
  /** Ce qui a été perdu et pas encore dit, par raison. */
  private readonly pertes = new Map<string, number>();
  private readonly instance = randomUUID();
  private sequence = 0;
  /** Ce que le fichier d'attente en cours porte déjà : au-delà de la borne, il tourne. */
  private octetsDuFichier = 0;

  private readonly options: OptionsDuJournal;

  constructor(options: OptionsDuJournal) {
    this.options = options;
  }

  /** Range un événement. Ne lève jamais, ne fait jamais attendre. */
  consigner(evenement: Evenement): void {
    if (this.file.length >= this.options.borne) {
      // File pleine : elle part entière sur disque, l'événement avec elle.
      // La mémoire retombe à zéro au lieu de grossir.
      this.deverser([...this.file.splice(0), evenement]);
      return;
    }
    this.file.push(evenement);
    if (this.file.length >= this.options.taille) void this.vider();
    else this.planifier();
  }

  /** Ce que la file tient en mémoire. */
  enMemoire(): number {
    return this.file.length;
  }

  /**
   * Écrit toute la file : en base si elle répond, sur disque sinon. Les pertes
   * comptées partent avec le premier lot ; la boucle ne tourne que tant que
   * la file a quelque chose — une perte qui se perd ne la relance pas.
   */
  vider(): Promise<void> {
    if (this.ecriture) return this.ecriture;
    if (this.minuteur) {
      clearTimeout(this.minuteur);
      this.minuteur = null;
    }
    this.ecriture = (async () => {
      do {
        const lot = [...this.direLesPertes(), ...this.file.splice(0, this.options.taille)];
        if (lot.length === 0) break;
        if (Date.now() < this.baseEnPanneJusqua) {
          this.deverser(lot);
          continue;
        }
        this.enVol = lot;
        try {
          await this.ecrireOuTrier(lot);
        } catch {
          this.baseEnPanneJusqua = Date.now() + this.options.rejeuMs;
          this.deverser(lot);
        } finally {
          this.enVol = null;
        }
      } while (this.file.length > 0);
    })().finally(() => {
      this.ecriture = null;
      // Un événement arrivé entre la fin de la boucle et ce rappel n'a pas pu
      // se planifier : il l'est maintenant. Une perte comptée pendant le lot
      // (un rejet de la porte) se dit au suivant, sauf base en panne.
      if (this.file.length > 0 || (this.pertes.size > 0 && Date.now() >= this.baseEnPanneJusqua)) {
        this.planifier();
      }
    });
    return this.ecriture;
  }

  /**
   * Rejoue le fichier d'attente : chaque fichier est d'abord RÉCLAMÉ par un
   * renommage (atomique), pour qu'une autre instance ne le rejoue pas en même
   * temps. Ce qui ne s'écrit pas retourne en attente ; ce qui est illisible
   * (une ligne coupée par un arrêt brutal) est compté comme perdu.
   */
  rejouer(): Promise<void> {
    if (this.rejeu) return this.rejeu;
    this.rejeu = this.rejouerLesFichiers()
      .catch((erreur: unknown) => {
        // Un rejeu qui échoue réessaiera : le fichier réclamé reste sur disque.
        console.error("[journal] rejeu interrompu :", (erreur as Error).message);
      })
      .finally(() => {
        this.rejeu = null;
      });
    return this.rejeu;
  }

  /** Rejoue maintenant, puis à intervalle régulier. */
  demarrer(): void {
    void this.rejouer();
    this.minuteurDeRejeu ??= setInterval(() => void this.rejouer(), this.options.rejeuMs);
    this.minuteurDeRejeu.unref();
  }

  /** L'arrêt : plus de minuteur, la file vidée — en base, ou sur disque. */
  async arreter(delaiMs: number): Promise<void> {
    if (this.minuteurDeRejeu) clearInterval(this.minuteurDeRejeu);
    this.minuteurDeRejeu = null;
    let delai: NodeJS.Timeout | undefined;
    const echeance = new Promise<void>((resoudre) => {
      delai = setTimeout(resoudre, delaiMs);
    });
    await Promise.race([this.vider(), echeance]);
    clearTimeout(delai);
    // Ce qui n'a pas pu s'écrire à temps dort sur disque : rien ne reste en
    // mémoire. Un lot encore en vol peut finir par s'écrire aussi : son rejeu
    // ne fera qu'une répétition, jamais un doublon.
    const reste = [...(this.enVol ?? []), ...this.direLesPertes(), ...this.file.splice(0)];
    if (reste.length > 0) this.deverser(reste);
  }

  private planifier(): void {
    if (this.minuteur || this.ecriture) return;
    this.minuteur = setTimeout(() => {
      this.minuteur = null;
      void this.vider();
    }, this.options.intervalleMs);
    this.minuteur.unref();
  }

  /**
   * Écrit un lot. Une panne de base remonte (le lot sera déversé) ; un refus
   * de la base fait essayer chaque événement seul, et ceux qu'elle refuse
   * encore sont perdus, comptés.
   */
  private async ecrireOuTrier(lot: readonly Evenement[]): Promise<void> {
    try {
      this.compterLesRejets(await this.options.ecrire(lot));
    } catch (erreur) {
      if (!estUnRefusDeLaBase(erreur)) throw erreur;
      console.error("[journal] la base refuse un lot :", (erreur as Error).message);
      for (const evenement of lot) {
        try {
          this.compterLesRejets(await this.options.ecrire([evenement]));
        } catch (refus) {
          if (!estUnRefusDeLaBase(refus)) throw refus;
          this.perdre([evenement], "rejet");
        }
      }
    }
  }

  /**
   * Les événements que la porte a écartés (mal formés, étape inconnue) ne sont
   * pas inscrits : ils sont perdus, et la perte se dit comme les autres.
   */
  private compterLesRejets(bilan: { rejetes: number } | undefined): void {
    const rejetes = bilan?.rejetes ?? 0;
    if (rejetes > 0) this.compterLaPerte("rejete", rejetes);
  }

  /** Sur disque, d'un seul appel système : sinon c'est une perte, comptée. */
  private deverser(lot: readonly Evenement[]): void {
    if (lot.length === 0) return;
    if (!this.options.repertoire) {
      this.perdre(lot, "sans_fichier");
      return;
    }
    if (!this.ecrireSurDisque(lot.map((e) => JSON.stringify(e)))) this.perdre(lot, "disque");
  }

  /**
   * Ajoute des lignes au fichier d'attente en cours, qui TOURNE au-delà de sa
   * borne : un fichier ne grossit pas indéfiniment, et le rejeu les prend un
   * par un. Rend faux si le disque refuse (plein, absent) ; ne lève jamais.
   */
  private ecrireSurDisque(lignes: readonly string[]): boolean {
    const repertoire = this.options.repertoire;
    if (!repertoire || lignes.length === 0) return lignes.length === 0;
    const texte = lignes.join("\n") + "\n";
    const octets = Buffer.byteLength(texte);
    try {
      mkdirSync(repertoire, { recursive: true });
      const borne = this.options.fichierMaxOctets ?? FICHIER_MAX_OCTETS;
      if (this.octetsDuFichier > 0 && this.octetsDuFichier + octets > borne) {
        this.sequence += 1;
        this.octetsDuFichier = 0;
      }
      (this.options.ajouter ?? appendFileSync)(
        path.join(repertoire, `${PREFIXE_ATTENTE}${this.instance}-${this.sequence}.jsonl`),
        texte,
      );
      this.octetsDuFichier += octets;
      return true;
    } catch (erreur) {
      console.error("[journal] déversement impossible :", (erreur as Error).message);
      return false;
    }
  }

  /**
   * Compte un lot perdu. Une étape `perte` qui se perd à son tour rend son
   * compte à sa raison : la perte dite plus tard reste exacte.
   */
  private perdre(lot: readonly Evenement[], raison: string): void {
    for (const e of lot) {
      const { nombre, raison: sienne } = e.detail;
      if (e.etape === "perte" && typeof nombre === "number" && typeof sienne === "string") {
        this.compterLaPerte(sienne, nombre);
      } else {
        this.compterLaPerte(raison, 1);
      }
    }
  }

  private compterLaPerte(raison: string, nombre: number): void {
    this.pertes.set(raison, (this.pertes.get(raison) ?? 0) + nombre);
  }

  /** Les pertes comptées deviennent des étapes `perte`, et le compteur repart de zéro. */
  private direLesPertes(): Evenement[] {
    const dites: Evenement[] = [];
    for (const [raison, nombre] of this.pertes) {
      dites.push(
        evenementDe(nouvelleTrace("api"), "perte", "erreur", {
          detail: { nombre, raison },
        }),
      );
    }
    this.pertes.clear();
    return dites;
  }

  private async rejouerLesFichiers(): Promise<void> {
    const repertoire = this.options.repertoire;
    // Base en panne : les fichiers attendent tels quels le rejeu suivant.
    if (!repertoire || Date.now() < this.baseEnPanneJusqua) return;
    let noms: string[];
    try {
      noms = await readdir(repertoire);
    } catch {
      return; // Pas encore de dossier : rien n'a jamais été déversé.
    }
    for (const nom of noms.sort()) {
      if (Date.now() < this.baseEnPanneJusqua) break;
      const reclame = await this.reclamer(repertoire, nom);
      if (reclame) await this.rejouerUnFichier(repertoire, reclame);
    }
    // Les pertes du rejeu se disent au prochain lot.
    if (this.pertes.size > 0) this.planifier();
  }

  /**
   * Rejoue un fichier réclamé EN FLUX : ligne à ligne, un lot au plus en
   * mémoire, quelle que soit la longueur de la panne qui l'a rempli.
   *
   * Si la base tombe en chemin, le reste — le lot en cours et les lignes non
   * lues — est réécrit dans un fichier d'attente neuf ; le fichier réclamé ne
   * s'efface qu'une fois ce reste à l'abri. Si le disque refuse aussi, il est
   * GARDÉ, rendu à l'attente : la reprise le relira depuis le début, et ce qui
   * est déjà inscrit n'y comptera qu'une répétition (la clé d'idempotence).
   */
  private async rejouerUnFichier(repertoire: string, reclame: string): Promise<void> {
    const flux = createReadStream(reclame, { encoding: "utf8" });
    const lignes = createInterface({ input: flux, crlfDelay: Infinity });
    const suite = lignes[Symbol.asyncIterator]();
    let lot: Evenement[] = [];
    let aLAbri = true;
    try {
      for (;;) {
        const { value: ligne, done } = await suite.next();
        if (!done && ligne.length > 0) {
          try {
            lot.push(JSON.parse(ligne) as Evenement);
          } catch {
            this.compterLaPerte("illisible", 1);
          }
        }
        if (lot.length >= this.options.taille || (done && lot.length > 0)) {
          try {
            await this.ecrireOuTrier(lot);
          } catch {
            this.baseEnPanneJusqua = Date.now() + this.options.rejeuMs;
            aLAbri = await this.reecrireLeReste(lot, suite);
            break;
          }
          lot = [];
        }
        if (done) break;
      }
    } finally {
      lignes.close();
      flux.destroy();
    }
    if (aLAbri) {
      await unlink(reclame);
    } else {
      await rename(
        reclame,
        path.join(repertoire, `${PREFIXE_ATTENTE}reprise-${randomUUID()}.jsonl`),
      );
    }
  }

  /** Réécrit le lot en cours et les lignes non lues ; faux dès que le disque refuse. */
  private async reecrireLeReste(
    lot: readonly Evenement[],
    suite: AsyncIterator<string>,
  ): Promise<boolean> {
    if (!this.ecrireSurDisque(lot.map((e) => JSON.stringify(e)))) return false;
    let paquet: string[] = [];
    for (;;) {
      const { value: ligne, done } = await suite.next();
      if (!done && ligne.length > 0) paquet.push(ligne);
      if (paquet.length >= this.options.taille || (done && paquet.length > 0)) {
        if (!this.ecrireSurDisque(paquet)) return false;
        paquet = [];
      }
      if (done) return true;
    }
  }

  /**
   * Réclame un fichier : un fichier d'attente (le sien en cours d'écriture
   * compris : les déversements suivants iront au suivant), ou un rejeu
   * abandonné depuis plus d'un intervalle de rejeu (son instance s'est arrêtée
   * au milieu). Le renommage est daté de maintenant : un rejeu en cours n'a
   * jamais l'air abandonné.
   */
  private async reclamer(repertoire: string, nom: string): Promise<string | null> {
    if (!nom.endsWith(".jsonl")) return null;
    const chemin = path.join(repertoire, nom);
    try {
      if (nom.startsWith(PREFIXE_REJEU)) {
        if (Date.now() - (await stat(chemin)).mtimeMs < this.options.rejeuMs) return null;
      } else if (!nom.startsWith(PREFIXE_ATTENTE)) {
        return null;
      }
      if (nom === `${PREFIXE_ATTENTE}${this.instance}-${this.sequence}.jsonl`) {
        this.sequence += 1;
        this.octetsDuFichier = 0;
      }
      const cible = path.join(repertoire, `${PREFIXE_REJEU}${this.instance}-${randomUUID()}.jsonl`);
      await rename(chemin, cible);
      const maintenant = new Date();
      await utimes(cible, maintenant, maintenant);
      return cible;
    } catch {
      return null; // Une autre instance l'a pris, ou il vient de disparaître.
    }
  }
}

/** L'événement d'une étape, sous une trace. */
function evenementDe(trace: Trace, etape: string, issue: Issue, options: OptionsDEtape): Evenement {
  return {
    trace: {
      id: trace.id,
      parente: trace.parente,
      origine: trace.origine,
      tenant: trace.tenant,
      acteur: trace.acteur,
      piece: trace.piece,
      version: trace.version,
      debut: trace.debut.toISOString(),
    },
    etape,
    issue,
    cle: options.cle ?? trace.cleDeRequete,
    debut: (options.debut && !Number.isNaN(options.debut.getTime())
      ? options.debut
      : new Date()
    ).toISOString(),
    dureeMs: options.dureeMs === undefined ? null : Math.max(0, Math.round(options.dureeMs)),
    acteur: trace.acteur,
    piece: options.piece ?? null,
    audits: options.audits ?? [],
    detail: options.detail ?? {},
  };
}

export interface OptionsDEtape {
  /** La clé d'idempotence de l'étape ; par défaut celle de la requête. */
  cle?: string;
  debut?: Date;
  dureeMs?: number;
  /** La pièce que l'étape concerne, si ce n'est pas celle de la trace. */
  piece?: string | null;
  /** Les lignes d'`audit.event_log` que l'étape a écrites. */
  audits?: readonly string[];
  detail?: Detail;
}

/* ------------------------------------------------------------- le journal de l'API */

const entier = (nom: string, defaut: number): number => {
  const valeur = Number(process.env[nom]);
  return Number.isInteger(valeur) && valeur > 0 ? valeur : defaut;
};

let leJournal: Journal | null = null;

function journal(): Journal {
  if (!leJournal) {
    const instance = new Journal({
      ecrire: consignerEnBase,
      repertoire: process.env["JOURNAL_ATTENTE"] || null,
      borne: entier("JOURNAL_FILE_MAX", 10_000),
      taille: entier("JOURNAL_LOT", 200),
      intervalleMs: entier("JOURNAL_INTERVALLE_MS", 1_000),
      rejeuMs: entier("JOURNAL_REJEU_MS", 30_000),
      fichierMaxOctets: entier("JOURNAL_FICHIER_MAX_OCTETS", FICHIER_MAX_OCTETS),
    });
    // Un processus qui se termine de lui-même (une épreuve, un outil) écrit
    // d'abord ce qui reste : `beforeExit` revient tant que la file n'est pas vide.
    process.on("beforeExit", () => {
      if (instance.enMemoire() > 0) void instance.vider();
    });
    leJournal = instance;
  }
  return leJournal;
}

/**
 * Le dossier du fichier d'attente, exigé au démarrage comme la racine du
 * stockage : une API sans lui perdrait en silence tout ce qu'une panne de base
 * lui ferait garder.
 */
export function exigerLeFichierDAttente(): string {
  const valeur = process.env["JOURNAL_ATTENTE"];
  if (!valeur) {
    throw new Error(
      "JOURNAL_ATTENTE absente : l'API refuse de démarrer plutôt que de perdre ses traces en silence",
    );
  }
  return valeur;
}

/**
 * Inscrit une étape de l'opération en cours (ou de la trace nommée, depuis un
 * rappel qu'`AsyncLocalStorage` ne suit pas). Ne lève jamais, ne fait jamais
 * attendre. Hors de toute trace, l'étape ouvre la sienne (origine `api`).
 */
export function consigner(
  etape: string,
  issue: Issue,
  options: OptionsDEtape = {},
  trace: Trace | undefined = traceCourante(),
): void {
  journal().consigner(evenementDe(trace ?? nouvelleTrace("api"), etape, issue, options));
}

/** L'issue d'une erreur : un refus rédigé pour l'appelant, ou une panne. */
function issueDe(erreur: unknown): Issue {
  return refusLisible(erreur) || introuvableLisible(erreur) ? "refus" : "erreur";
}

/** Mesure un travail comme une étape : sa durée et son issue, qu'il réussisse ou non. */
export async function mesurer<T>(
  etape: string,
  travail: () => Promise<T>,
  options: Omit<OptionsDEtape, "debut" | "dureeMs"> = {},
): Promise<T> {
  const debut = new Date();
  try {
    const resultat = await travail();
    consigner(etape, "ok", { ...options, debut, dureeMs: Date.now() - debut.getTime() });
    return resultat;
  } catch (erreur) {
    consigner(etape, issueDe(erreur), { ...options, debut, dureeMs: Date.now() - debut.getTime() });
    throw erreur;
  }
}

/**
 * Un travail différé, sous sa propre trace rattachée à l'opération d'origine :
 * la chronologie d'une pièce suit ainsi la lecture de nuit ou la relance
 * jusqu'à la capture qui l'a fait naître.
 */
export function tracerUnTravail<T>(
  nom: string,
  parente: string | null,
  travail: () => Promise<T>,
  champs: { tenant?: string | null; tentative?: number } = {},
): Promise<T> {
  const trace = nouvelleTrace("tache", { parente, tenant: champs.tenant ?? null });
  const detail = champs.tentative === undefined ? { nom } : { nom, tentative: champs.tentative };
  return sousLaTrace(trace, () => mesurer("tache", travail, { detail }));
}

/** Le démarrage de l'API : rejouer ce qui attend, puis purger au-delà de la rétention. */
export function demarrerLeJournal(): void {
  journal().demarrer();
  const purger = async () => {
    try {
      // Par paquets : la porte en purge un nombre borné à chaque appel.
      while ((await purgerLeJournal()) > 0);
    } catch (erreur) {
      console.error("[journal] purge impossible :", (erreur as Error).message);
    }
  };
  void purger();
  setInterval(() => void purger(), entier("JOURNAL_PURGE_MS", 6 * 60 * 60 * 1000)).unref();
}

/** L'arrêt de l'API : la file en base, ou sur disque — rien ne reste en mémoire. */
export function arreterLeJournal(): Promise<void> {
  return leJournal ? leJournal.arreter(entier("JOURNAL_ARRET_MS", 5_000)) : Promise.resolve();
}
