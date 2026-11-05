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
