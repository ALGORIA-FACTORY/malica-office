/**
 * La file dans IndexedDB — le navigateur, et l'aperçu dans Chrome.
 *
 * Un magasin, une clé, une valeur qui porte les métadonnées et les octets. Le
 * stockage persistant est demandé une fois : sans lui, le navigateur peut
 * évacuer la base sous pression — ce qui reste acceptable ici, parce que la
 * coque, elle, range ses fichiers dans le stockage de l'appareil, que rien
 * n'évacue.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { DepotDeFile } from "./depot";
import type { ElementDeFile } from "./file";

interface SchemaDeFile extends DBSchema {
  elements: {
    key: string;
    value: { meta: ElementDeFile; octets: Blob | null };
  };
}

const NOM = "regalica-file";

export function creerDepotIdb(): DepotDeFile {
  let base: Promise<IDBPDatabase<SchemaDeFile>> | null = null;

  function ouvrir(): Promise<IDBPDatabase<SchemaDeFile>> {
    if (!base) {
      base = openDB<SchemaDeFile>(NOM, 1, {
        upgrade(db) {
          db.createObjectStore("elements", { keyPath: "meta.cle" });
        },
      });
      // Demandé une fois, jamais attendu : un refus ne change rien à ce qu'on fait.
      void navigator.storage?.persist?.().catch(() => undefined);
    }
    return base;
  }

  return {
    async lister() {
      const db = await ouvrir();
      return (await db.getAll("elements")).map((v) => v.meta);
    },
    async ecrire(element, octets) {
      const db = await ouvrir();
      const tx = db.transaction("elements", "readwrite");
      const existant = await tx.store.get(element.cle);
      await tx.store.put({ meta: element, octets: octets ?? existant?.octets ?? null });
      await tx.done;
    },
    async octets(cle) {
      const db = await ouvrir();
      return (await db.get("elements", cle))?.octets ?? null;
    },
    async supprimer(cle) {
      const db = await ouvrir();
      await db.delete("elements", cle);
    },
    async tailleTotale() {
      const db = await ouvrir();
      let total = 0;
      for (const v of await db.getAll("elements")) total += v.meta.taille;
      return total;
    },
  };
}
