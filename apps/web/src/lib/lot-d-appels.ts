/**
 * Les lectures demandées ensemble partent ensemble — un aller-retour au lieu
 * de N.
 *
 * 7 novembre 2026, recette d'un propriétaire de nombreuses sociétés : la
 * bibliothèque demandait les pièces société par société, chacune sous sa clé
 * de cache. Les clés restent (chaque écran invalide toujours la société qu'il
 * a changée) ; c'est le CHARGEMENT qui se groupe : les demandes faites dans le
 * même instant sont réunies et envoyées en un appel.
 *
 * Un lot d'une seule société reste l'appel d'une seule société : rien ne
 * change pour qui n'en a qu'une.
 */

interface Attente<R> {
  resoudre: (valeur: R) => void;
  rejeter: (raison: unknown) => void;
}

interface OptionsDuLot<R> {
  /** Un appel pour plusieurs clés ; rend la valeur de chacune. */
  plusieurs: (cles: string[]) => Promise<Map<string, R>>;
  /** Un appel pour une seule clé — le chemin d'avant, inchangé. */
  une: (cle: string) => Promise<R>;
  /** Combien de clés au plus par appel (la borne du serveur). */
  taille: number;
  /** Valeur d'une clé que l'appel groupé n'a pas rendue. */
  absente: R;
}

export function creerLotDAppels<R>(options: OptionsDuLot<R>): (cle: string) => Promise<R> {
  let enAttente: Map<string, Attente<R>[]> | null = null;

  function envoyer(lot: Map<string, Attente<R>[]>) {
    const cles = [...lot.keys()];
    const regler = (
      cle: string,
      issue: { ok: true; valeur: R } | { ok: false; raison: unknown },
    ) => {
      for (const a of lot.get(cle) ?? []) {
        if (issue.ok) a.resoudre(issue.valeur);
        else a.rejeter(issue.raison);
      }
    };

    if (cles.length === 1) {
      const cle = cles[0]!;
      options.une(cle).then(
        (valeur) => regler(cle, { ok: true, valeur }),
        (raison: unknown) => regler(cle, { ok: false, raison }),
      );
      return;
    }

    for (let i = 0; i < cles.length; i += options.taille) {
      const tranche = cles.slice(i, i + options.taille);
      options.plusieurs(tranche).then(
        (valeurs) => {
          for (const cle of tranche)
            regler(cle, { ok: true, valeur: valeurs.get(cle) ?? options.absente });
        },
        (raison: unknown) => {
          for (const cle of tranche) regler(cle, { ok: false, raison });
        },
      );
    }
  }

  return (cle) =>
    new Promise<R>((resoudre, rejeter) => {
      if (!enAttente) {
        enAttente = new Map();
        /*
         * Un tour de boucle, pas une micro-tâche : les requêtes d'un même
         * écran démarrent dans des effets qui ne s'exécutent pas tous dans la
         * même micro-tâche. Le délai est celui d'un `setTimeout(0)` —
         * imperceptible à côté d'un aller-retour réseau.
         */
        setTimeout(() => {
          const lot = enAttente!;
          enAttente = null;
          envoyer(lot);
        }, 0);
      }
      const file = enAttente.get(cle) ?? [];
      file.push({ resoudre, rejeter });
      enAttente.set(cle, file);
    });
}
