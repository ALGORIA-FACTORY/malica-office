/**
 * Le libellé d'une écriture — composé, jamais rédigé à la main.
 *
 * ========================================================== CE QUE DIT LA NORME
 *
 * Un libellé n'est pas un commentaire : c'est la piste d'audit. ISA 500 et la
 * norme ISO 21378 sur les fichiers d'audit demandent la même chose en substance
 * — un tiers doit pouvoir identifier l'opération SANS ouvrir la pièce. Dans les
 * fichiers d'échange normalisés (SAF-T, FEC français, ISO 21378), la ligne
 * porte quatre choses : la nature de l'opération, la contrepartie, la référence
 * du document et sa date.
 *
 * Trois défauts sont universellement reprochés en revue :
 *
 *   « Facture »                  ne distingue pas deux écritures du même jour
 *   « Achat fourn. 1429 DT »     répète un montant que les lignes portent déjà
 *   « Règlement de la facture    raconte au lieu de désigner ; illisible dans
 *     du fournisseur de verres     une balance générale, où la colonne est
 *     reçue la semaine dernière »  large de quarante caractères
 *
 * ========================================================== LA FORME RETENUE
 *
 *   Nature — Contrepartie — Réf. document du JJ/MM/AAAA
 *   Achat de marchandises — VERRES DE TUNISIE — Fact. 2026-114 du 31/08/2026
 *
 * Les séparateurs sont des tirets cadratins entourés d'espaces : ils survivent
 * à un export CSV, se coupent proprement en colonne étroite, et se relisent.
 *
 * AUCUN MONTANT. Il figure sur les lignes, et un libellé qui le répète devient
 * faux dès la première correction — c'est la source d'incohérence la plus
 * fréquente dans un grand livre.
 *
 * AUCUNE DATE DE SAISIE. La date qui compte est celle du document, pas celle où
 * quelqu'un l'a enregistré.
 *
 * ========================================================== POURQUOI ICI
 *
 * Dans le socle : c'est une règle du domaine, elle ne connaît ni base ni écran,
 * et elle se vérifie sans les deux.
 */

/** Les faits dont un libellé se compose. Rien de plus, rien d'inventé. */
export interface FaitsDuLibelle {
  /** La nature de l'opération, telle que le schéma d'écriture la nomme. */
  nature: string;
  /** La contrepartie : raison sociale du tiers, ou son code à défaut. */
  contrepartie?: string | null;
  /** Le numéro porté par le document lui-même. */
  reference?: string | null;
  /** La date du document, en ISO. Jamais la date de saisie. */
  date?: string | null;
}

/** Longueur au-delà de laquelle une colonne de balance devient illisible. */
const LARGEUR_MAX = 120;

const NATURES: Record<string, string> = {
  facture_achat: "Achat",
  facture_vente: "Vente",
  avoir_achat: "Avoir fournisseur",
  avoir_vente: "Avoir client",
  reglement_achat: "Règlement fournisseur",
  reglement_vente: "Encaissement client",
  od: "Opération diverse",
};

/**
 * Le nom de la nature, lisible.
 *
 * La table ci-dessus n'est PAS un référentiel réglementaire : ce sont des mots
 * français pour des natures d'opération, au même titre qu'un libellé de bouton.
 * R4 interdit les constantes réglementaires — un taux, un compte, un seuil —,
 * pas le vocabulaire de l'interface.
 */
export function nomDeLaNature(kind: string | null | undefined): string {
  if (!kind) return NATURES["od"]!;
  return NATURES[kind] ?? kind.replace(/_/g, " ");
}

/** Une date ISO en forme lisible. Rend la chaîne d'origine si elle ne l'est pas. */
function jour(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Compose le libellé.
 *
 * Chaque partie absente est simplement omise : un libellé tronqué reste juste,
 * un libellé qui invente une contrepartie ne l'est pas. Une pièce sans numéro
 * donne « Achat — VERRES DE TUNISIE », et c'est déjà mieux que « Facture ».
 */
export function composerLibelle(faits: FaitsDuLibelle): string {
  const parties: string[] = [];

  const nature = faits.nature.trim();
  if (nature) parties.push(nature);

  const contrepartie = faits.contrepartie?.trim();
  if (contrepartie) parties.push(contrepartie);

  const reference = faits.reference?.trim();
  const date = faits.date?.trim();
  if (reference && date) parties.push(`Réf. ${reference} du ${jour(date)}`);
  else if (reference) parties.push(`Réf. ${reference}`);
  else if (date) parties.push(`du ${jour(date)}`);

  const libelle = parties.join(" — ");
  if (libelle.length <= LARGEUR_MAX) return libelle;

  // On coupe la contrepartie, jamais la référence : c'est elle qui permet de
  // retrouver la pièce, et un nom raccourci reste reconnaissable.
  const reste = LARGEUR_MAX - (libelle.length - (contrepartie?.length ?? 0));
  if (contrepartie && reste > 12) {
    parties[parties.indexOf(contrepartie)] = `${contrepartie.slice(0, reste - 1).trimEnd()}…`;
    return parties.join(" — ");
  }
  return `${libelle.slice(0, LARGEUR_MAX - 1).trimEnd()}…`;
}

/**
 * Ce qu'on reproche à un libellé, s'il y a lieu.
 *
 * Rendu à l'écran plutôt qu'imposé : l'expert reste maître de ce qu'il écrit,
 * mais il doit voir ce qu'un contrôleur verra. Une remarque sans blocage vaut
 * mieux qu'un refus qu'on contourne en tapant n'importe quoi.
 */
export function critiquerLibelle(libelle: string): string[] {
  const remarques: string[] = [];
  const texte = libelle.trim();

  if (texte.length < 8) remarques.push("trop court pour identifier l'opération");
  if (/^(facture|avoir|achat|vente|od|divers)\.?$/i.test(texte)) {
    remarques.push("ne distingue pas cette écriture d'une autre du même jour");
  }
  if (/\d[\d\s.,]*\s*(tnd|dt|eur|usd|€|\$)/i.test(texte)) {
    remarques.push("répète un montant que les lignes portent déjà");
  }
  if (texte.length > LARGEUR_MAX) {
    remarques.push(`dépasse ${LARGEUR_MAX} caractères et se coupera en balance`);
  }
  return remarques;
}
