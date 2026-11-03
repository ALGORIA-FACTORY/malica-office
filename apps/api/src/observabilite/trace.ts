/**
 * La trace d'une opération — ce qui relie une capture à son affichage.
 *
 * Une trace naît une fois, là où l'opération commence : sur le téléphone dès
 * la capture (qui l'envoie ensuite dans l'en-tête `x-malica-trace` de chaque
 * requête, même après une reconnexion), ou à l'entrée HTTP si le client n'en
 * dit rien. Elle suit tout le code d'une requête sans être passée de fonction
 * en fonction : `AsyncLocalStorage` la porte, à travers les promesses et les
 * appels à la base.
 *
 * Ce module ne parle à personne : il tient le contexte. L'écriture est dans
 * `journal.ts`, l'entrée HTTP dans `requete.ts`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

/** D'où vient l'opération : le vocabulaire de `observabilite.origine_t`. */
export type Origine = "android" | "pwa" | "web" | "api" | "tache";

export interface Trace {
  readonly id: string;
  /** L'opération d'origine, pour un travail différé ou une reprise. */
  readonly parente: string | null;
  readonly origine: Origine;
  /** « coque-android/0.3.1 », « web/0.2.99 » : ce que le client a déclaré. */
  readonly version: string | null;
  readonly debut: Date;
  /**
   * La clé d'idempotence de la requête en cours (`x-malica-cle`, sinon tirée
   * au sort) : un renvoi de la même requête retombe sur les mêmes étapes.
   */
  readonly cleDeRequete: string;
  /** Le dossier et la pièce, dès qu'ils sont connus ; la base juge le dossier. */
  tenant: string | null;
  acteur: string | null;
  piece: string | null;
  /** Les lignes d'`audit.event_log` écrites par l'appel en cours, relues avant le commit. */
  audits: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant bien formé, ou rien : ce qui vient du réseau ne se croit pas sur parole. */
function uuidBienForme(valeur: unknown): string | null {
  return typeof valeur === "string" && UUID.test(valeur) ? valeur.toLowerCase() : null;
}

const contexte = new AsyncLocalStorage<Trace>();

/**
 * Un identifiant de trace TIRÉ de ce qui identifie un travail (le travail et sa
 * tentative) : la même tentative rejouée retombe sur la même trace, et ses
 * étapes comptent des répétitions au lieu de s'ajouter. Forme d'un UUID v8.
 */
export function identifiantDerive(...parties: readonly string[]): string {
  const h = createHash("sha256").update(parties.join("\u0000")).digest("hex");
  const variante = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** La trace de l'opération en cours, s'il y en a une. */
export function traceCourante(): Trace | undefined {
  return contexte.getStore();
}

/** Exécute un travail sous une trace : tout ce qu'il appelle la retrouve. */
export function sousLaTrace<T>(trace: Trace, travail: () => T): T {
  return contexte.run(trace, travail);
}

export function nouvelleTrace(
  origine: Origine,
  champs: {
    id?: string | null;
    parente?: string | null;
    version?: string | null;
    cleDeRequete?: string | null;
    tenant?: string | null;
    acteur?: string | null;
  } = {},
): Trace {
  const id = uuidBienForme(champs.id) ?? randomUUID();
  const parente = uuidBienForme(champs.parente);
  return {
    id,
    parente: parente === id ? null : parente,
    origine,
    version: champs.version ?? null,
    debut: new Date(),
    cleDeRequete: champs.cleDeRequete ?? randomUUID(),
    tenant: uuidBienForme(champs.tenant),
    acteur: uuidBienForme(champs.acteur),
    piece: null,
    audits: [],
  };
}

/**
 * Nomme le dossier ou la pièce de l'opération en cours, s'ils ne le sont pas
 * déjà : la première désignation vaut. Le dossier n'est qu'une prétention —
 * `observabilite.consigner` ne le retient que s'il appartient à l'acteur.
 */
export function noterLObjet(objet: { tenant?: string | null; piece?: string | null }): void {
  const trace = traceCourante();
  if (!trace) return;
  trace.tenant ??= uuidBienForme(objet.tenant);
  trace.piece ??= uuidBienForme(objet.piece);
}

/** Ajoute à la trace en cours les lignes d'audit qu'une transaction vient d'écrire. */
export function noterLesAudits(identifiants: readonly string[]): void {
  const trace = traceCourante();
  if (!trace) return;
  for (const id of identifiants) {
    const propre = uuidBienForme(id);
    if (propre && !trace.audits.includes(propre)) trace.audits.push(propre);
  }
}
