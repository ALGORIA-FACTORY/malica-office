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
function consignerEnBase(ou: string, message: string, pile: string): void {
  if (dossierCourant === null) return;
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

/** À appeler depuis un `catch` qui, autrement, avalerait la trace. */
export function noterAuJournal(ou: string, raison: unknown): void {
  if (typeof window === "undefined") return;
  const { message, pile } = texteEtPile(raison);
  // La base, toujours : c'est elle qui se relit.
  consignerEnBase(ou, message, pile);
  // Le serveur d'atelier, en développement seulement.
  if (import.meta.env.DEV) rapporter(ou, message, pile);
}
