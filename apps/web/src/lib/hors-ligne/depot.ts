/**
 * Où la file est rangée.
 *
 * Une interface, plusieurs réalisations : la mémoire pour les épreuves,
 * IndexedDB pour le navigateur, le stockage de l'appareil pour la coque. Le
 * vidage ne sait pas laquelle il tient — c'est ce qui le rend éprouvable
 * sans navigateur ni téléphone.
 *
 * Les octets s'écrivent une fois, à la création ; les métadonnées à chaque
 * pas. `ecrire` sans octets conserve ceux qui sont là.
 */
import type { ElementDeFile } from "./file";

export interface DepotDeFile {
  lister(): Promise<ElementDeFile[]>;
  ecrire(element: ElementDeFile, octets?: Blob): Promise<void>;
  octets(cle: string): Promise<Blob | null>;
  supprimer(cle: string): Promise<void>;
  tailleTotale(): Promise<number>;
}

/** Tout en mémoire : les épreuves, et un environnement sans IndexedDB. */
export function depotMemoire(): DepotDeFile {
  const elements = new Map<string, { meta: ElementDeFile; octets: Blob | null }>();
  return {
    async lister() {
      return [...elements.values()].map((e) => e.meta);
    },
    async ecrire(element, octets) {
      const existant = elements.get(element.cle);
      elements.set(element.cle, { meta: element, octets: octets ?? existant?.octets ?? null });
    },
    async octets(cle) {
      return elements.get(cle)?.octets ?? null;
    },
    async supprimer(cle) {
      elements.delete(cle);
    },
    async tailleTotale() {
      let total = 0;
      for (const e of elements.values()) total += e.meta.taille;
      return total;
    },
  };
}
