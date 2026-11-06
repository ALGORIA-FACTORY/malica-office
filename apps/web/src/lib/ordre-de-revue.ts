/**
 * L'ordre dans lequel l'expert parcourt la file, figé au moment où il l'a vue.
 *
 * Staging, 5 novembre 2026 : « Commencer la revue » ouvrait la première pièce
 * de la file, qui s'annonçait « 84 sur 91 ». Ouvrir une pièce la fait passer
 * de « Reçue » à « Vue » ; la file, relue, la retriait parmi les vues, et la
 * flèche « suivante » menait à la 85ᵉ — 83 pièces à traiter sautées sans un
 * mot. Le statut reste celui de la base ; seul l'ORDRE du parcours est gardé
 * tel qu'il a été montré. Une pièce arrivée depuis se range à la fin.
 */
export function dansLOrdreVu<T extends { pieceId: string }>(
  vu: readonly string[] | null,
  frais: readonly T[],
): T[] {
  if (!vu) return [...frais];
  const parId = new Map(frais.map((r) => [r.pieceId, r]));
  const deja = new Set(vu);
  return [
    ...vu.flatMap((id) => {
      const r = parId.get(id);
      return r ? [r] : [];
    }),
    ...frais.filter((r) => !deja.has(r.pieceId)),
  ];
}

/*
 * L'ordre vu doit survivre au changement de pièce : l'écran de la pièce se
 * remonte à chaque identifiant (`remountDeps`), et la file en cache a déjà
 * été relue et retriée après la première « Vue » (revue Codex de #235 :
 * a → b → c → a, chaque pièce annoncée « 1 sur 3 »). Il se garde donc ici,
 * par cabinet, le temps d'une revue — en mémoire de l'onglet, rien de plus.
 * L'accueil l'oublie : revenir à la file, c'est recommencer une revue.
 */
const ordres = new Map<string, readonly string[]>();

/** L'ordre de la revue en cours, s'il contient cette pièce. */
export function ordreDeLaRevue(cabinet: string, pieceId: string): readonly string[] | null {
  const ordre = ordres.get(cabinet);
  return ordre && ordre.includes(pieceId) ? ordre : null;
}

export function retenirLOrdre(cabinet: string, ordre: readonly string[]): void {
  ordres.set(cabinet, ordre);
}

export function oublierLOrdre(cabinet: string): void {
  ordres.delete(cabinet);
}
