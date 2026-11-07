/**
 * Les dictionnaires, coupés en deux paquets à la compilation : la BASE
 * (vitrine, connexion, invitation, erreurs, commun) et les ESPACES (`cab.*`,
 * `pme.*`, `tour.*`).
 *
 * ================================================================ POURQUOI
 *
 * Un dictionnaire pèse 75 à 80 Ko gzippés, et les trois espaces en portent
 * les quatre cinquièmes (3 100 clés sur 3 900). Les écrans publics — ceux qui
 * se rendent sur l'appareil comme `/invitation` ou le lien de
 * `/reinitialiser` — attendaient tout le dictionnaire avant de s'afficher.
 * Ils n'attendent plus que la base ; les espaces se chargent à l'entrée d'un
 * espace (`_authenticated`), avant son premier écran — jamais une clé à nu.
 *
 * Les fichiers du Socle ne bougent pas : l'API et les épreuves continuent de
 * lire un dictionnaire entier. La coupe n'existe que dans le paquet du
 * navigateur, par deux modules virtuels par langue :
 *
 *   virtual:dictionnaire/<langue>/base
 *   virtual:dictionnaire/<langue>/espaces
 */
import { join } from "node:path";

import { runnerImport, type Plugin } from "vite";

const PREFIXE = "virtual:dictionnaire/";
/** Les clés des trois espaces ; tout le reste est la base. */
const CLES_DES_ESPACES = /^(cab|pme|tour)\./;

export function dictionnairesParEspace(sourcesDuSocle: string): Plugin {
  const lus = new Map<string, Promise<Record<string, string>>>();

  const lire = (langue: string) => {
    let attente = lus.get(langue);
    if (!attente) {
      const fichier = join(sourcesDuSocle, `messages-${langue}.ts`);
      attente = runnerImport<Record<string, Record<string, string>>>(fichier, {
        configFile: false,
        logLevel: "silent",
      }).then(({ module }) => {
        const dict = module[langue];
        if (!dict) throw new Error(`messages-${langue}.ts n'exporte pas « ${langue} »`);
        return dict;
      });
      lus.set(langue, attente);
    }
    return attente;
  };

  return {
    name: "malica:dictionnaires-par-espace",
    // Un dictionnaire modifié en développement se relit au rechargement.
    watchChange(id) {
      if (id.includes("messages-")) lus.clear();
    },
    resolveId(id) {
      return id.startsWith(PREFIXE) ? `\0${id}` : undefined;
    },
    async load(id) {
      if (!id.startsWith(`\0${PREFIXE}`)) return undefined;
      const [langue, paquet] = id.slice(PREFIXE.length + 1).split("/");
      if (!langue || (paquet !== "base" && paquet !== "espaces")) {
        throw new Error(`dictionnaire inconnu : ${id}`);
      }
      this.addWatchFile(join(sourcesDuSocle, `messages-${langue}.ts`));
      const dict = await lire(langue);
      const garde = Object.fromEntries(
        Object.entries(dict).filter(
          ([cle]) => CLES_DES_ESPACES.test(cle) === (paquet === "espaces"),
        ),
      );
      return `export default ${JSON.stringify(garde)};`;
    },
  };
}
