/**
 * Ce qu'un appel à l'API peut rendre d'autre qu'une réponse.
 *
 * Trois natures, et l'écran les distingue par l'ORIGINE, jamais par le texte :
 *
 *   ErreurApi      l'API a répondu, et refusé. Son message est écrit par nous,
 *                  pour la personne — ou c'est un code que l'écran traduit.
 *   ErreurReseau   l'API n'a pas répondu : le téléphone est hors ligne, ou le
 *                  serveur injoignable. Rien n'est arrivé jusqu'à lui.
 *   ErreurVersion  l'API refuse de parler à une coque trop ancienne (426). Il
 *                  n'y a rien à réessayer : il faut mettre à jour.
 */

export class ErreurApi extends Error {
  // Champ déclaré puis affecté : le paquet socle et l'API le font ainsi, pour
  // que le même code passe partout où Node décape les types sans compiler.
  readonly statut: number;
  constructor(message: string, statut: number) {
    super(message);
    this.name = "ErreurApi";
    this.statut = statut;
  }
}

export type NatureReseau = "hors_ligne" | "injoignable";

export class ErreurReseau extends Error {
  readonly nature: NatureReseau;
  constructor(nature: NatureReseau) {
    super(nature === "hors_ligne" ? "hors ligne" : "API injoignable");
    this.name = "ErreurReseau";
    this.nature = nature;
  }
}

export class ErreurVersion extends Error {
  readonly versionMinimale: string | null;
  constructor(versionMinimale: string | null) {
    super("mise à jour requise");
    this.name = "ErreurVersion";
    this.versionMinimale = versionMinimale;
  }
}
