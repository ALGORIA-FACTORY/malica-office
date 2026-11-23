/**
 * Le port d'authentification.
 *
 * Les écrans appelaient le fournisseur d'authentification directement — cinq
 * appels dans trois
 * fichiers. C'était la seule couture par laquelle un changement de fournisseur
 * atteignait l'interface : les données, elles, étaient déjà derrière des ports.
 *
 * Ce contrat referme cette couture. Ce qui suit ne nomme aucun fournisseur.
 */

export interface Compte {
  id: string;
  email: string;
}

export interface AuthPort {
  /** Le compte connecté, ou `null`. Appelé à chaque navigation : doit rester bon marché. */
  session(): Promise<Compte | null>;

  /** Crée un compte et ouvre la session dans le même geste. */
  inscription(email: string, motDePasse: string, nom?: string): Promise<Compte>;

  connexion(email: string, motDePasse: string): Promise<Compte>;

  deconnexion(): Promise<void>;

  /** Demande un lien de nouveau mot de passe par courriel. Ne dit jamais si l'adresse existe. */
  motDePasseOublie(email: string): Promise<void>;

  /** Pose un nouveau mot de passe contre le secret du lien, et ouvre la session. */
  reinitialiser(secret: string, motDePasse: string): Promise<Compte>;

  /** L'adresse du compte connecté est-elle prouvée ? Déclarée seulement, elle n'ouvre aucune invitation. */
  adresseConfirmee(): Promise<boolean>;

  /** Confirme l'adresse contre le secret du lien reçu par courriel. */
  confirmerAdresse(secret: string): Promise<void>;

  /** Renvoie le lien de confirmation à l'adresse du compte connecté. */
  renvoyerConfirmation(): Promise<void>;
}

/**
 * Les échecs que l'interface doit distinguer.
 *
 * `identifiants` couvre aussi bien un mot de passe faux qu'une adresse
 * inconnue : les séparer dirait à un attaquant lesquelles existent.
 */
export type MotifEchecAuth = "identifiants" | "adresse_prise" | "saisie" | "reseau" | "lien_expire";

export class EchecAuth extends Error {
  // Champ déclaré puis affecté : Node décape les types sans compiler, et une
  // propriété de paramètre est la seule syntaxe qu'il ne sait pas effacer.
  readonly motif: MotifEchecAuth;
  constructor(motif: MotifEchecAuth, message: string) {
    super(message);
    this.name = "EchecAuth";
    this.motif = motif;
  }
}
