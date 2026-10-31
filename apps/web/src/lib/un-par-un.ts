/** Un lot arrêté en route : ce qui est passé, ce qui reste, et pourquoi. */
export class LotInterrompu extends Error {
  constructor(
    readonly faits: readonly string[],
    readonly restants: readonly string[],
    override readonly cause: unknown,
  ) {
    super("lot interrompu");
  }
}

/**
 * Un geste sur chaque papier, l'un après l'autre ; s'il s'arrête, on sait où
 * (Mon espace, dans la société et hors d'elle). Jamais un état partiel muet.
 */
export async function unParUn(
  ids: readonly string[],
  geste: (id: string) => Promise<unknown>,
): Promise<readonly string[]> {
  const faits: string[] = [];
  for (const [i, id] of ids.entries()) {
    try {
      await geste(id);
    } catch (cause) {
      throw new LotInterrompu(faits, ids.slice(i), cause);
    }
    faits.push(id);
  }
  return faits;
}
