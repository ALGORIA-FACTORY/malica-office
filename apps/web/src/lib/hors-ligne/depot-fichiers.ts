/**
 * La file dans le stockage de l'appareil — la coque.
 *
 * Pourquoi pas IndexedDB ici : la WebView applique la même politique
 * d'éviction « au mieux » que Chrome sous pression de stockage, précisément
 * sur les téléphones visés — 32 Go pleins. Le répertoire de données de
 * l'application, lui, n'est évacué que si l'application est désinstallée.
 *
 * Un élément = deux fichiers, `<cle>.pdf` (les octets) et `<cle>.json` (les
 * métadonnées). Le répertoire EST l'index : pas de second lieu de vérité qui
 * pourrait diverger quand Android tue la WebView entre deux écritures. Les
 * octets s'écrivent d'abord, les métadonnées ensuite ; un `.pdf` orphelin au
 * démarrage est effacé.
 */
import type { DepotDeFile } from "./depot";
import type { ElementDeFile } from "./file";

const DOSSIER = "file-d-attente";

async function greffon() {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  return { Filesystem, Directory, Encoding };
}

function enBase64(blob: Blob): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const s = String(lecteur.result);
      resoudre(s.slice(s.indexOf(",") + 1));
    };
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.readAsDataURL(blob);
  });
}

function depuisBase64(base64: string, type: string): Blob {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type });
}

export function creerDepotFichiers(): DepotDeFile {
  let pret: Promise<void> | null = null;

  async function preparer(): Promise<void> {
    if (!pret) {
      pret = (async () => {
        const { Filesystem, Directory } = await greffon();
        await Filesystem.mkdir({ path: DOSSIER, directory: Directory.Data, recursive: true }).catch(
          () => undefined,
        );
        // Les octets sans métadonnées : une écriture interrompue. On efface.
        const { files } = await Filesystem.readdir({ path: DOSSIER, directory: Directory.Data });
        const noms = new Set(files.map((f) => f.name));
        for (const nom of noms) {
          if (nom.endsWith(".pdf") && !noms.has(nom.replace(/\.pdf$/, ".json"))) {
            await Filesystem.deleteFile({ path: `${DOSSIER}/${nom}`, directory: Directory.Data });
          }
        }
      })();
    }
    return pret;
  }

  async function lireMeta(nom: string): Promise<ElementDeFile | null> {
    const { Filesystem, Directory, Encoding } = await greffon();
    try {
      const { data } = await Filesystem.readFile({
        path: `${DOSSIER}/${nom}`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return JSON.parse(String(data)) as ElementDeFile;
    } catch {
      return null;
    }
  }

  return {
    async lister() {
      await preparer();
      const { Filesystem, Directory } = await greffon();
      const { files } = await Filesystem.readdir({ path: DOSSIER, directory: Directory.Data });
      const metas = await Promise.all(
        files.filter((f) => f.name.endsWith(".json")).map((f) => lireMeta(f.name)),
      );
      return metas.filter((m): m is ElementDeFile => m !== null);
    },

    async ecrire(element, octets) {
      await preparer();
      const { Filesystem, Directory, Encoding } = await greffon();
      if (octets) {
        await Filesystem.writeFile({
          path: `${DOSSIER}/${element.cle}.pdf`,
          directory: Directory.Data,
          data: await enBase64(octets),
        });
      }
      await Filesystem.writeFile({
        path: `${DOSSIER}/${element.cle}.json`,
        directory: Directory.Data,
        data: JSON.stringify(element),
        encoding: Encoding.UTF8,
      });
    },

    async octets(cle) {
      await preparer();
      const { Filesystem, Directory } = await greffon();
      const meta = await lireMeta(`${cle}.json`);
      if (!meta) return null;
      try {
        const { data } = await Filesystem.readFile({
          path: `${DOSSIER}/${cle}.pdf`,
          directory: Directory.Data,
        });
        return typeof data === "string" ? depuisBase64(data, meta.contentType) : data;
      } catch {
        return null;
      }
    },

    async supprimer(cle) {
      await preparer();
      const { Filesystem, Directory } = await greffon();
      for (const ext of ["json", "pdf"]) {
        await Filesystem.deleteFile({
          path: `${DOSSIER}/${cle}.${ext}`,
          directory: Directory.Data,
        }).catch(() => undefined);
      }
    },

    async tailleTotale() {
      const elements = await this.lister();
      return elements.reduce((n, e) => n + e.taille, 0);
    },
  };
}
