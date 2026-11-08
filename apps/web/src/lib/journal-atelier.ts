/**
 * Rapporter au poste de l'atelier ce que l'appareil a vraiment vu.
 *
 * ============================================================== POURQUOI
 *
 * Un défaut n'existait que sur un téléphone. Trois corrections à l'aveugle,
 * trois échecs : le poste de développement ne reproduisait jamais la panne, et
 * le TEXTE du message ne suffisait pas à dire d'où il venait.
 *
 * Ce qui manquait est la pile d'appels — le fichier, la ligne. Elle existe sur
 * l'appareil, et n'en sortait pas. Ce module l'envoie au serveur de
 * développement, qui l'écrit dans son journal.
 *
 * ========================================================= CE QUE ÇA N'EST PAS
 *
 * Ni de la télémétrie, ni un service tiers. `import.meta.env.DEV` en décide :
 * rien de tout ceci n'existe dans le paquet livré. Et rien ne quitte le réseau
 * local — l'appareil parle au poste posé à côté de lui.
 *
 * L'utilisateur ne voit rien : c'est la règle du produit, et elle tient.
 */
import { versionClient } from "@/capabilities/coque";

// Statique : la racine l'importe déjà pour la frontière d'erreur, un import
// à la demande ne découpait rien (avertissement INEFFECTIVE_DYNAMIC_IMPORT).
import { expurger } from "./rapport-plantage";

/** Ce qu'on a déjà rapporté : une boucle de rendu ne doit pas noyer le journal. */
const dejaVu = new Set<string>();

function rapporter(ou: string, message: string, pile: string): void {
  const empreinte = `${ou}|${message}`;
  if (dejaVu.has(empreinte)) return;
  dejaVu.add(empreinte);

  // `keepalive` : le rapport part même si la page se démonte dans la foulée.
  void fetch("/journal-atelier", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      ou,
      message,
      pile,
      appareil: navigator.userAgent,
    }),
  }).catch(() => {
    // Un rapport perdu ne doit jamais aggraver la panne qu'il décrit.
  });
}

function texteEtPile(raison: unknown): { message: string; pile: string } {
  if (raison instanceof Error) {
    return { message: raison.message, pile: raison.stack ?? "(sans pile)" };
  }
  return { message: String(raison), pile: "(pas une erreur)" };
}

/** À appeler une fois, au montage de l'application. */
export function installerJournalAtelier(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const w = window as Window & { __journalAtelier?: boolean };
  if (w.__journalAtelier) return;
  w.__journalAtelier = true;

  window.addEventListener("error", (e) => {
    const { message, pile } = texteEtPile(e.error ?? e.message);
    rapporter(`${e.filename ?? "?"}:${e.lineno ?? 0}`, message, pile);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const { message, pile } = texteEtPile(e.reason);
    rapporter("promesse non rattrapée", message, pile);
  });
}

/*
 * ======================================= LE DOSSIER COURANT, POUR LA TRACE EN BASE
 *
 * 13 octobre 2026. « Il ne se passe rien » quand on génère un reçu, et la
 * raison est perdue : ce journal-ci n'écrit QUE en développement, vers le
 * serveur d'atelier. Sur l'application installée, rien n'est jamais consigné.
 *
 * Une panne qu'on ne peut pas relire n'existe pas. Elle va donc désormais en
 * base, dans `audit.journal_client` — mais cette table est sous RLS de
 * dossier, et il faut donc dire DANS QUEL dossier on écrit.
 *
 * Ce module n'a pas de contexte React : le dossier lui est remis par le
 * fournisseur PME, en un seul endroit, et il est oublié à la déconnexion.
 */
let dossierCourant: string | null = null;

/** Le dossier dans lequel consigner. `null` oublie, à la déconnexion. */
export function dossierDuJournal(tenantId: string | null): void {
  dossierCourant = tenantId;
}

/**
 * Consigner en base, sans jamais nuire.
 *
 * Signaler une panne ne doit pas en créer une seconde : tout échec de
 * l'envoi est ignoré, délibérément, et c'est le seul `catch` muet que ce
 * dépôt s'autorise — il n'avale rien d'autre que son propre échec.
 */
function consignerEnBase(ou: string, message: string, pile: string, code: string): void {
  if (dossierCourant === null) {
    consignerHorsDossier(ou, message, code);
    return;
  }
  void import("@/verticals/malica-office/composition")
    .then(({ office }) =>
      office().journal.consigner({
        tenantId: dossierCourant!,
        ou,
        message,
        pile: pile === "" ? null : pile,
        // La MEME notion de version que le signalement manuel : deux facons
        // de nommer la version produiraient deux histoires inconciliables.
        version: versionClient(),
        plateforme: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 100),
      }),
    )
    .catch(() => undefined);
}

/*
 * ========================================= ET QUAND AUCUN DOSSIER N'EST OUVERT
 *
 * 6 novembre 2026. Accepter une invitation, ouvrir le dossier d'un client
 * depuis le cabinet, la tour : ces écrans échouent sans dossier ouvert, et
 * leur panne n'allait nulle part. Elle part désormais par la porte hors
 * dossier (`journal.consignerHorsDossier`, bornée par la base) : qui (la
 * session), où, le code, et un détail EXPURGÉ et court — un message peut
 * citer un matricule, une adresse ou un montant, et cette trace-là n'est
 * rattachée à aucun dossier qui la protégerait.
 *
 * Sans session, la porte refuse : l'écran de connexion ne lit aucune donnée
 * de client, et c'est la limite connue de `rapport-plantage.ts`.
 */
function consignerHorsDossier(ou: string, message: string, code: string): void {
  void import("@/verticals/malica-office/composition")
    .then(({ office }) =>
      office().journal.consignerHorsDossier({
        ou: expurger(ou).slice(0, 200) || "inconnu",
        code: code.slice(0, 100),
        detail: expurger(message).slice(0, 500) || null,
        version: versionClient().slice(0, 120),
        plateforme: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 300),
      }),
    )
    .catch(() => undefined);
}

/** Ce qu'une erreur dit d'elle-même sans son message : son nom, et un statut d'API. */
function codeDe(raison: unknown): string {
  if (!(raison instanceof Error)) return typeof raison;
  const statut = (raison as { statut?: unknown }).statut;
  return typeof statut === "number" ? `${raison.name} ${statut}` : raison.name;
}

/**
 * À appeler depuis un `catch` qui, autrement, avalerait la trace.
 *
 * `ref` est la référence que l'écran a montrée (`texteDeLErreur`) : elle
 * mène la ligne (« [ref 7F3A21C9] … »), pour qu'on la retrouve quand la
 * personne la cite.
 */
export function noterAuJournal(ou: string, raison: unknown, ref?: string): void {
  if (typeof window === "undefined") return;
  const { message, pile } = texteEtPile(raison);
  const marque = ref === undefined ? "" : `[ref ${ref}] `;
  // La base, toujours : c'est elle qui se relit.
  consignerEnBase(ou, `${marque}${message}`, pile, `${marque}${codeDe(raison)}`);
  // Le serveur d'atelier, en développement seulement.
  if (import.meta.env.DEV) rapporter(ou, message, pile);
}
