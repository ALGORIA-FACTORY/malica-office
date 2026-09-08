/**
 * Le vidage — ce qui fait partir la file, pas à pas, en un seul vol.
 *
 * ============================================================== LA RÈGLE
 *
 *   — persister d'abord : `deposer` écrit l'élément et ses octets AVANT de
 *     tenter quoi que ce soit. Une application tuée juste après a tout gardé.
 *   — un vol unique : `vider` ne tourne qu'une fois à la fois ; les appels
 *     concurrents rejoignent la passe en cours.
 *   — un élément à la fois, du plus ancien au plus récent : deux dépôts de
 *     quatre mégaoctets en parallèle ne vont pas plus vite sur un réseau mobile.
 *   — trois pas, chacun rejouable : enregistrer (même clé → même pièce),
 *     déposer les octets (redéposer remplace), demander la lecture (rejoindre
 *     celle qui tourne). Puis l'élément est purgé.
 *   — un réseau absent ou une panne serveur arrête la passe et recule
 *     l'élément (1 s, 2 s, 4 s… cinq minutes au plus) ; un refus lisible de
 *     l'API marque l'élément en échec définitif, montré, jamais jeté.
 */
import { ErreurApi, ErreurReseau, ErreurVersion } from "@/lib/transport/erreurs";

import type { DepotDeFile } from "./depot";
import {
  estADeclencher,
  nouvelElement,
  PLAFOND_ELEMENTS,
  PLAFOND_OCTETS,
  transition,
  type ElementDeFile,
  type Evenement,
  type NouvelElement,
} from "./file";

export class FilePleine extends Error {
  constructor() {
    super("file.pleine");
    this.name = "FilePleine";
  }
}

export interface PortsDuVidage {
  /** `capture.enregistrer` : la ligne, contre la clé. Rend l'identifiant de la pièce. */
  enregistrer(element: ElementDeFile): Promise<string>;
  /** `/pieces/:id/contenu` : les octets. */
  deposerOctets(pieceId: string, octets: Blob, contentType: string): Promise<void>;
  /** `/malica/lectures/:id?attendre=0` : la lecture part, on n'attend pas. */
  demanderLaLecture(pieceId: string): Promise<void>;
}

export interface Vidage {
  /** Range l'élément et ses octets, puis lance une passe. Rend la clé. */
  deposer(entree: Omit<NouvelElement, "taille">, octets: Blob): Promise<string>;
  /** Une passe sur tout ce qui peut partir. Vol unique. */
  vider(): Promise<void>;
  /** Attend que l'élément soit arrivé chez l'API, ou que le délai passe. */
  attendre(cle: string, delaiMs: number): Promise<ElementDeFile | null>;
  reessayer(cle: string): Promise<void>;
  abandonner(cle: string): Promise<void>;
  elements(): Promise<ElementDeFile[]>;
  surChangement(cb: (elements: ElementDeFile[]) => void): () => void;
}

export function creerVidage(deps: {
  depot: DepotDeFile;
  ports: PortsDuVidage;
  enLigne: () => boolean;
  maintenant?: () => number;
}): Vidage {
  const maintenant = deps.maintenant ?? (() => Date.now());
  const abonnes = new Set<(elements: ElementDeFile[]) => void>();
  let passe: Promise<void> | null = null;

  async function publier(partie?: ElementDeFile): Promise<void> {
    if (abonnes.size === 0) return;
    const elements = await elementsTries();
    // Ce qui vient de partir n'est plus dans le dépôt : on le montre une
    // dernière fois, avec son identifiant, pour qui l'attendait.
    for (const cb of abonnes) cb(partie ? [...elements, partie] : elements);
  }

  async function elementsTries(): Promise<ElementDeFile[]> {
    const tous = await deps.depot.lister();
    return tous.sort((a, b) => a.creeLe.localeCompare(b.creeLe));
  }

  async function appliquer(e: ElementDeFile, evt: Evenement): Promise<ElementDeFile> {
    const suivant = transition(e, evt, maintenant());
    if (suivant.etat === "lecture_demandee") {
      await deps.depot.supprimer(e.cle);
      await publier(suivant);
    } else {
      await deps.depot.ecrire(suivant);
      await publier();
    }
    return suivant;
  }

  function natureDe(erreur: unknown): Evenement | "arreter" {
    if (erreur instanceof ErreurReseau) {
      return { type: "echec", nature: "reseau", message: erreur.message };
    }
    if (erreur instanceof ErreurVersion) return "arreter";
    if (erreur instanceof ErreurApi) {
      // 401 : la session est à refaire, pas l'envoi. Le transport a déjà signalé.
      if (erreur.statut === 401) return "arreter";
      if (erreur.statut >= 500) {
        return { type: "echec", nature: "serveur", message: erreur.message };
      }
      return { type: "echec", nature: "refus", message: erreur.message };
    }
    return { type: "echec", nature: "serveur", message: String(erreur) };
  }

  /** Un pas pour un élément. Rend `true` si la passe peut continuer. */
  async function avancer(e: ElementDeFile): Promise<boolean> {
    try {
      if (e.etat === "a_envoyer") {
        const pieceId = await deps.ports.enregistrer(e);
        await appliquer(e, { type: "enregistree", pieceId });
        return true;
      }
      if (e.etat === "enregistree") {
        const octets = await deps.depot.octets(e.cle);
        if (!octets) {
          // Les octets ont disparu sous nos pieds : l'élément ne peut plus partir.
          await appliquer(e, { type: "echec", nature: "refus", message: "file.octets_perdus" });
          return true;
        }
        await deps.ports.deposerOctets(e.pieceId!, octets, e.contentType);
        await appliquer(e, { type: "deposee" });
        return true;
      }
      if (e.etat === "deposee") {
        await deps.ports.demanderLaLecture(e.pieceId!);
        await appliquer(e, { type: "lecture_demandee" });
        return true;
      }
      return true;
    } catch (erreur) {
      const evt = natureDe(erreur);
      if (evt === "arreter") return false;
      await appliquer(e, evt);
      // Un refus n'empêche pas les suivants de partir ; un réseau absent, si.
      return evt.type === "echec" && evt.nature === "refus";
    }
  }

  async function unePasse(): Promise<void> {
    if (!deps.enLigne()) return;
    for (;;) {
      const candidats = (await elementsTries()).filter((e) => estADeclencher(e, maintenant()));
      const e = candidats[0];
      if (!e) return;
      // Un élément avance jusqu'à partir ou échouer ; on relit toujours l'état
      // persisté, jamais une copie, pour que « tuée entre deux pas » et
      // « vidée d'un trait » suivent le même chemin.
      let courant: ElementDeFile | undefined = e;
      while (courant && estADeclencher(courant, maintenant())) {
        const continuer = await avancer(courant);
        if (!continuer) return;
        courant = (await deps.depot.lister()).find((x) => x.cle === e.cle);
      }
    }
  }

  function vider(): Promise<void> {
    if (!passe) {
      passe = unePasse().finally(() => {
        passe = null;
      });
    }
    return passe;
  }

  return {
    async deposer(entree, octets) {
      const elements = await deps.depot.lister();
      const taille = await deps.depot.tailleTotale();
      if (elements.length >= PLAFOND_ELEMENTS || taille + octets.size > PLAFOND_OCTETS) {
        throw new FilePleine();
      }
      const element = nouvelElement({ ...entree, taille: octets.size }, maintenant());
      await deps.depot.ecrire(element, octets);
      await publier();
      void vider();
      return element.cle;
    },

    vider,

    attendre(cle, delaiMs) {
      return new Promise((resoudre) => {
        let fini = false;
        const conclure = (e: ElementDeFile | null) => {
          if (fini) return;
          fini = true;
          clearTimeout(minuteur);
          desabonner();
          resoudre(e);
        };
        const examiner = (elements: ElementDeFile[]) => {
          const e = elements.find((x) => x.cle === cle);
          // Purgé : la pièce est partie et sa lecture demandée — c'est arrivé.
          if (!e) conclure(null);
          else if (e.pieceId !== null || e.etat === "echec_definitif") conclure(e);
        };
        const desabonner = (() => {
          abonnes.add(examiner);
          return () => abonnes.delete(examiner);
        })();
        const minuteur = setTimeout(() => {
          void elementsTries().then((elements) =>
            conclure(elements.find((x) => x.cle === cle) ?? null),
          );
        }, delaiMs);
        void elementsTries().then(examiner);
      });
    },

    async reessayer(cle) {
      const e = (await deps.depot.lister()).find((x) => x.cle === cle);
      if (!e) return;
      await appliquer(e, { type: "reessayer" });
      void vider();
    },

    async abandonner(cle) {
      await deps.depot.supprimer(cle);
      await publier();
    },

    elements: elementsTries,

    surChangement(cb) {
      abonnes.add(cb);
      return () => {
        abonnes.delete(cb);
      };
    },
  };
}
