/**
 * Le reçu de dépense ou de revenu — son CONTENU, pas sa mise en page.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026 : « Malica génère le reçu de dépense ou de revenu et le
 * moyen de paiement. » Le type `recu_de_paiement` existait en base depuis le
 * 11, avec `porte_ecriture = false`, et rien ne le produisait.
 *
 * ====================================== POURQUOI LE CONTENU VIT DANS LE SOCLE
 *
 * Un reçu est un document qui porte des chiffres et qu'on remet à un tiers.
 * Composé dans un écran, la première juridiction à deux décimales en aurait
 * fait un document faux — et un document faux remis à quelqu'un est pire
 * qu'un document absent.
 *
 * Tout ce qui pouvait se tromper est donc ici, pur et testable : la somme en
 * unités mineures, le refus d'un reçu vide, le refus d'un dossier sans
 * matricule. Un dessinateur met ensuite en page, et il ne décide de rien.
 *
 * ============================================================= CE QU'IL N'EST PAS
 *
 * Il ne porte aucune écriture : ni compte, ni taux, ni imputation. La forme
 * même de son résultat l'en empêche, et une épreuve le vérifie. Un reçu
 * transmis au cabinet et comptabilisable une seconde fois est la façon la
 * plus simple de compter une charge deux fois.
 *
 * R4 : aucune mention obligatoire n'est écrite ici. La liste vient du pack,
 * déjà traduite, et ce module la recopie.
 */
import { sommeDecimale } from "../somme-decimale.ts";

/** Un paiement tel qu'il est inscrit : son moyen, son montant, sa date. */
export interface PaiementDuRecu {
  /** Le libellé traduit du moyen, lu au pack — jamais son code. */
  moyen: string;
  /** Nul quand rien n'a été payé (« pas encore payé ») : il n'y a pas de reçu. */
  montant: string | null;
  date: string | null;
}

/** Les libellés de l'imprimé, dans la langue de la personne. */
export interface LibellesDuRecu {
  titreDepense: string;
  titreRevenu: string;
  dossier: string;
  matricule: string;
  tiers: string;
  piece: string;
  date: string;
  moyen: string;
  montant: string;
  total: string;
  emisLe: string;
}

export interface EntreeRecu {
  /** Une dépense ou un revenu. Il n'y a pas de sens par défaut. */
  sens: "depense" | "revenu";
  /** Les décimales de la devise, lues au pack. */
  decimales: number;
  devise: string;
  dossier: { nom: string; matricule: string | null };
  /** L'autre partie, telle que la lecture l'a citée. Nulle si elle n'a pas été lue. */
  tiers: string | null;
  piece: { reference: string | null; date: string | null };
  paiements: readonly PaiementDuRecu[];
  /** Les mentions obligatoires du pack, déjà traduites. */
  mentions: readonly string[];
  libelles: LibellesDuRecu;
  /** La date d'émission, donnée par l'appelant — jamais lue à l'horloge (R11). */
  emisLe: string;
}

export interface Recu {
  titre: string;
  dossier: { nom: string; matricule: string };
  tiers: string | null;
  piece: { reference: string | null; date: string | null };
  paiements: ReadonlyArray<{ moyen: string; montant: string; date: string | null }>;
  total: string;
  devise: string;
  mentions: readonly string[];
  libelles: LibellesDuRecu;
  emisLe: string;
}

export function construireRecu(entree: EntreeRecu): Recu {
  if (entree.paiements.length === 0) {
    throw new Error(
      "aucun paiement : un reçu sans règlement n'atteste de rien, et laisserait croire qu'il y en a eu un",
    );
  }

  const paiements = entree.paiements.map((p) => {
    if (p.montant === null) {
      throw new Error(
        `paiement sans montant (${p.moyen}) : « pas encore payé » est une réponse valable sur une facture à trente jours, et ce n'est pas un reçu`,
      );
    }
    return { moyen: p.moyen, montant: p.montant, date: p.date };
  });

  // Le matricule est une mention obligatoire là où le pack l'exige. Un reçu
  // sans lui se fabriquerait à moitié, et c'est le dossier de contrôle qui
  // s'en apercevrait.
  if (!entree.dossier.matricule) {
    throw new Error("matricule du dossier absent : le reçu ne peut pas porter sa mention");
  }

  return {
    titre: entree.sens === "depense" ? entree.libelles.titreDepense : entree.libelles.titreRevenu,
    dossier: { nom: entree.dossier.nom, matricule: entree.dossier.matricule },
    tiers: entree.tiers,
    piece: entree.piece,
    paiements,
    // La somme se fait en unités mineures : en flottant, 500,000 + 113,493
    // rend 613,4929999, et un reçu ne porte pas de décimale fantôme.
    total: sommeDecimale(
      paiements.map((p) => p.montant),
      entree.decimales,
    ),
    devise: entree.devise,
    mentions: entree.mentions,
    libelles: entree.libelles,
    emisLe: entree.emisLe,
  };
}
