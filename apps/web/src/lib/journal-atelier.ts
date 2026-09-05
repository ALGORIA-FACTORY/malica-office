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

/** À appeler depuis un `catch` qui, autrement, avalerait la trace. */
export function noterAuJournal(ou: string, raison: unknown): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const { message, pile } = texteEtPile(raison);
  rapporter(ou, message, pile);
}
