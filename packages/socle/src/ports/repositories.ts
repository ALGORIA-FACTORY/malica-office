/**
 * Ports du domaine. Les écrans ne connaissent que ce vocabulaire :
 * aucune requête, aucun nom de table, aucun SQL au-delà de cette frontière.
 */

import type { CodeVerdict } from "../verdicts.ts";
import type { ProposalResult } from "../use-cases/propose-ecriture.ts";

export type OrgKind = "pme" | "cabinet";
export type ValidationMode = "autonome" | "mandate";

export interface Organization {
  id: string;
  kind: OrgKind;
  name: string;
  legalId: string | null;
  jurisdiction: string;
  currency: string;
  validationMode: ValidationMode;
}

export interface Membership {
  tenantId: string;
  role: string;
}

export interface Entity {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface NewOrganization {
  kind: OrgKind;
  name: string;
  legalId?: string | null;
  /**
   * Obligatoires, et c'est le fond du sujet.
   *
   * Elles étaient facultatives, et l'omission valait « Tunisie, dinar ». Une
   * organisation créée sans que personne n'ait choisi sa juridiction héritait
   * d'une fiscalité par défaut — dans un produit dont la raison d'être est de
   * l'appliquer correctement.
   */
  jurisdiction: string;
  currency: string;
  validationMode?: ValidationMode;
  defaultEntityName?: string;
}

/** Un mandat proposé, vu depuis la PME qui doit y répondre. */
export interface MandatPropose {
  id: string;
  cabinetTenantId: string;
  cabinet: string;
  proposeLe: string;
}

/** Une invitation reçue, vue par la personne qui peut la rejoindre. */
export interface InvitationRecue {
  id: string;
  cabinetTenantId: string;
  cabinet: string;
  role: string;
  expiresAt: string;
}

export interface IdentityRepository {
  listMyOrganizations(): Promise<Array<Organization & { role: string }>>;
  /**
   * Le cabinet qui suit ce dossier, vu depuis la PME.
   *
   * `null` quand personne ne la mandate — et l'écran dit alors autre chose
   * plutôt que d'inventer un interlocuteur.
   */
  monCabinet(pmeTenantId: string): Promise<{ id: string; name: string } | null>;
  /** Les mandats proposés à cette PME, qui attendent sa réponse. */
  mandatsProposes(pmeTenantId: string): Promise<MandatPropose[]>;
  repondreAuMandat(engagementId: string, accepte: boolean): Promise<{ id: string; status: string }>;
  listEntities(tenantId: string): Promise<Entity[]>;
  createOrganization(input: NewOrganization): Promise<string>;
  /**
   * Le cabinet se décrit : nom, identifiant fiscal, juridiction. La devise
   * n'est pas demandée, elle suit le pack de la juridiction (R4).
   */
  definirOrganisation(input: {
    tenantId: string;
    name: string;
    legalId: string | null;
    jurisdiction: string;
  }): Promise<{
    id: string;
    name: string;
    legalId: string | null;
    jurisdiction: string;
    currency: string;
  }>;
  /**
   * Proposer un mandat à une PME inscrite, par son identifiant fiscal. Le
   * mandat naît « proposé » ; c'est la PME qui l'active.
   */
  proposerMandat(
    cabinetTenantId: string,
    legalId: string,
  ): Promise<{ id: string; pmeTenantId: string; pmeName: string; status: string; deja: boolean }>;
  /**
   * Le cabinet ouvre le dossier d'une PME qui n'existe pas encore : la PME, son
   * établissement principal et un mandat actif. Un matricule qui a déjà un
   * dossier est refusé.
   */
  ouvrirDossier(input: {
    cabinetTenantId: string;
    name: string;
    legalId: string;
    adresse: string | null;
  }): Promise<{ id: string; name: string; legalId: string; adresse: string | null }>;
  /**
   * Le cabinet invite le contact du dossier. Le jeton n'est rendu qu'ici, une
   * fois. `courriel` dit si un courriel est parti ; sinon le cabinet transmet
   * le lien lui-même.
   */
  inviterContact(
    pmeTenantId: string,
    email: string,
  ): Promise<{
    id: string;
    email: string;
    jeton: string;
    expiresAt: string;
    courriel: "envoye" | "non_configure" | "echec";
    lien: string | null;
  }>;
  /** Les invitations d'un dossier et leur état. Jamais le jeton. */
  invitationsDuDossier(pmeTenantId: string): Promise<InvitationDuDossier[]>;
  revoquerInvitation(invitationId: string): Promise<{ id: string; statut: "revoquee" }>;
  /** Ce que le lien fait rejoindre ; null pour un jeton inconnu. */
  lireInvitationParLien(jeton: string): Promise<{
    pme: string;
    cabinet: string | null;
    email: string;
    statut: StatutInvitation;
    valable: boolean;
  } | null>;
  /** Le contact rejoint le dossier ; son compte doit porter l'adresse invitée. */
  accepterInvitationParLien(jeton: string): Promise<{ tenantId: string; role: string }>;
  /** Les régimes que la juridiction connaît, tels que la base les porte. */
  regimesDisponibles(jurisdiction: string): Promise<RegimeDisponible[]>;
  /** Les formes juridiques et modes de dépôt que le calendrier distingue. */
  formesDisponibles(jurisdiction: string): Promise<FormeDisponible[]>;
  ficheCourante(tenantId: string): Promise<FicheCourante | null>;
  /**
   * L'expert arrête la fiche (R10) : une entrée nouvelle, datée. Lire une
   * carte n'établit rien — c'est ce geste-ci, et lui seul, qui fait foi.
   */
  etablirFiche(input: NouvelleFiche): Promise<{ id: string }>;
  /** Le prénom salue, le nom complet facture. `null` tant que rien n'est écrit. */
  monProfil(): Promise<MonProfil | null>;
  /** Un champ vide s'efface ; la base compose « Prénom Nom ». */
  ecrireMonProfil(prenom: string | null, nom: string | null): Promise<MonProfil | null>;
}

export interface MonProfil {
  prenom: string | null;
  nom: string | null;
  display_name: string | null;
}

export type StatutInvitation = "en_attente" | "acceptee" | "expiree" | "revoquee";

export interface InvitationDuDossier {
  id: string;
  email: string;
  statut: StatutInvitation;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface RegimeDisponible {
  axe: "imposition" | "tva";
  code: string;
  libelle: string;
  fondement: string;
}

/** Une forme juridique ou un mode de dépôt que le calendrier distingue. */
export interface FormeDisponible {
  axe: "forme" | "mode";
  code: string;
}

export interface FicheCourante {
  id: string;
  regimeImposition: string | null;
  regimeTva: string | null;
  prorataTva: string | null;
  secteur: string | null;
  debutActivite: string | null;
  clotureExercice: string | null;
  formeJuridique: string | null;
  modeDepot: string | null;
  source: string;
  pieceId: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface NouvelleFiche {
  tenantId: string;
  regimeImposition: string | null;
  regimeTva: string | null;
  prorataTva: number | null;
  secteur: string | null;
  debutActivite: string | null;
  clotureExercice: string | null;
  formeJuridique: string | null;
  modeDepot: string | null;
  /** D'où vient la fiche, et elle ne ment pas : « carte » seulement si l'œil a rempli quelque chose. */
  source: "carte" | "saisie";
  pieceId?: string | null;
  validFrom: string;
}

// ------------------------------------------------- les fils de Malica
/**
 * Aucune de ces méthodes ne dit à qui appartient un fil : la base le sait, et
 * elle seule décide. R6 — un filtre applicatif oublié ouvre l'accès, une
 * politique oubliée le refuse.
 */
export interface ConversationsRepository {
  lister(tenantId: string): Promise<ConversationResume[]>;
  ouvrir(conversationId: string): Promise<MessageDuFil[]>;
  renommer(input: { conversationId: string; titre: string }): Promise<void>;
  /**
   * Le geste du comptable : juste, ou faux. C'est ce qui construit la banque
   * de cas sans que personne n'écrive une question à froid.
   */
  juger(input: {
    tenantId: string;
    messageId: string;
    verdict: "juste" | "faux";
    attendu: string | null;
  }): Promise<void>;
  supprimer(conversationId: string): Promise<void>;
}

export interface ConversationResume {
  id: string;
  titre: string;
  createdAt: string;
  updatedAt: string;
  messages: number;
}

export interface MessageDuFil {
  id: string;
  role: "user" | "assistant";
  contenu: string;
  raisonnement: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface JurisdictionPack {
  id: string;
  jurisdiction: string;
  version: string;
  effectiveFrom: string;
  ratified: boolean;
  currency: string;
}

/** Une juridiction que le produit sait traiter, telle que le référentiel la déclare. */
export interface Juridiction {
  jurisdiction: string;
  currency: string;
  version: string;
}

export interface ReferentialRepository {
  juridictions(): Promise<Juridiction[]>;
  activePack(jurisdiction: string): Promise<JurisdictionPack | null>;
  /** Les taux du pack. Le libelle est traduit : il descend a l ecran. */
  taxRates(packId: string, jurisdiction: string, locale?: string): Promise<TaxRate[]>;
  accountMappings(packId: string): Promise<AccountMapping[]>;
  /** Ce qu'est chaque classe du plan : le compte de résultat en a besoin. */
  classesDeComptes(packId: string): Promise<AccountClass[]>;
  /** Droits et taxes hors TVA du pack (droit de timbre…). */
  /** Les droits hors TVA du pack, libelle traduit. */
  fiscalCharges(packId: string, locale?: string): Promise<FiscalCharge[]>;
  /** Paramètres du Socle (décimales, méthode de stock, tolérances) lus au pack. */
  /**
   * Les types de document proposés au moment de la photo, traduits.
   *
   * Six, pas les dix-sept du pack : choisir dans une liste de dix-sept est un
   * autre genre d'abandon. Le libellé vient de `ref.labels`, pas de la
   * colonne française.
   */
  /**
   * Les moyens de paiement du pack, traduits, en vigueur à une date.
   *
   * La date vient de l'appelant — celle de la pièce — et non de l'horloge :
   * un cabinet peut retirer un moyen, et les pièces d'avant gardent celui
   * qu'elles portaient.
   */
  moyensDePaiement(
    packId: string,
    locale: string,
    au: string,
  ): Promise<
    Array<{
      code: string;
      libelle: string;
      tresorerieAccount: string | null;
      exigeJustificatif: boolean;
      /** Ce moyen porte-t-il une reference que l'extrait bancaire reprendra ? */
      exigeReference: boolean;
    }>
  >;
  typesDeDocument(locale: string): Promise<
    Array<{
      code: string;
      famille: string;
      libelle: string;
      porteEcriture: boolean;
      transmissible: boolean;
      /** Vrai pour les types proposés au moment de la photo — six, pas dix-sept. */
      proposeALaCapture: boolean;
    }>
  >;
  /**
   * Les mentions que le pack exige, traduites.
   *
   * R4 : aucune mention obligatoire n'est écrite dans le code. Le reçu de
   * paiement les porte en pied, et c'est le pack qui dit lesquelles.
   */
  mentionsDuPack(packId: string, locale: string): Promise<MentionDuPack[]>;
  socleParams(packId: string): Promise<SocleParams>;
}

// ---------------------------------------------------------------- paramétrage
/**
 * Un rôle comptable, avec le compte que le paramétrage lui donne aujourd'hui.
 *
 * `origine` est la colonne qui porte le sens : elle dit QUI répond de ce
 * choix — le pack livré, le cabinet, ou ce dossier précis. Sans elle, l'écran
 * afficherait un numéro sans dire d'où il vient.
 */
export interface RoleComptable {
  code: string;
  libelle: string;
  famille: string;
  classesAdmises: number[];
  note: string | null;
  compte: string | null;
  compteLibelle: string | null;
  origine: "pack" | "cabinet" | "dossier" | "aucun";
  motif: string | null;
  decideLe: string | null;
  defautDuPack: string | null;
  justificationDuPack: string | null;
}

/** Une ligne du plan comptable tel qu'un cabinet le voit. */
export interface CompteDuPlan {
  code: string;
  libelle: string;
  parent: string | null;
  classe: string;
  sensUsuel: string | null;
  /** officiel = verbatim NC 01 ; extension = ouverte par Malica ; cabinet = la vôtre. */
  origine: "officiel" | "extension" | "cabinet";
  officiel: boolean;
  /** Un compte collectif reçoit des tiers, jamais des sous-comptes. */
  collectif: boolean;
  source: string | null;
}

/** Les seuils et préférences d'un cabinet. `regle` dit si une ligne existe ou si ce sont les défauts. */
export interface ReglagesCabinet {
  /** Au-dessus de cette confiance de lecture, un lot se valide d'un geste (0..1). */
  seuilConfianceLot: number;
  /** En dessous de cette confiance, chaque pièce se revoit une à une (0..1). */
  seuilConfianceRevue: number;
  /** Au-delà de ce montant, une écriture demande deux signatures ; `null` : jamais. */
  doubleValidationAuDela: string | null;
  propositionsProactives: boolean;
  /** La capacité de référence d'un collaborateur, en dossiers actifs. */
  capaciteDossiers: number;
  /** Le registre des restitutions que Malica rédige : sobre | chaleureux. */
  ton: string;
  /** Au-dessus de cette certitude (0..1), Malica répond seule à une question de conseil ; en dessous, elle la remet au cabinet. */
  seuilCertitudeConseil: number;
  regle: boolean;
}

/** Une obligation du calendrier du cabinet, pour un exercice et un secteur. */
export interface ObligationDuCalendrier {
  /** Le code du référentiel, ou « CAB:<id> » pour une obligation propre. */
  code: string;
  libelle: string;
  periodicite: string;
  echeanceJour: number;
  echeanceMois: number | null;
  /** La règle littérale, qui fait foi. */
  regle: string;
  texteSource: string | null;
  article: string | null;
  propre: boolean;
  secteur: string;
  /**
   * À qui l'obligation s'applique : la forme juridique (physique | morale),
   * le mode de dépôt (papier | electronique), le régime — ou rien quand elle
   * vise tout le monde. Une obligation propre ne vise personne en particulier.
   */
  formeJuridique: string | null;
  modeDepot: string | null;
  regime: string | null;
  /** Les mandats concernés, comptés depuis leurs fiches. */
  mandats: number;
  active: boolean;
  rappelJours: number;
  regleParLeCabinet: boolean;
}

/** Qui je suis dans ce cabinet, et si je suis opérateur de plateforme. */
export interface MonAcces {
  /** dirigeant | collaborateur | expert | assistant, ou rien si je ne suis pas membre. */
  role: string | null;
  plateforme: boolean;
}

export interface AccesRepository {
  monAcces(tenantId: string): Promise<MonAcces>;
}

export interface ParametrageRepository {
  reglagesCabinet(tenantId: string): Promise<ReglagesCabinet>;
  /** Quand la mise en route a été terminée, ou rien si elle ne l'a jamais été. */
  miseEnRoute(tenantId: string): Promise<{ termineeLe: string | null }>;
  terminerMiseEnRoute(tenantId: string): Promise<{ termineeLe: string }>;
  definirReglagesCabinet(input: {
    tenantId: string;
    seuilConfianceLot: number;
    seuilConfianceRevue: number;
    doubleValidationAuDela: string | null;
    propositionsProactives: boolean;
    capaciteDossiers: number;
    ton: string;
    seuilCertitudeConseil: number;
  }): Promise<ReglagesCabinet>;
  calendrierCabinet(
    tenantId: string,
    exercice: number,
    secteur: string,
  ): Promise<ObligationDuCalendrier[]>;
  definirObligation(input: {
    tenantId: string;
    code: string;
    exercice: number;
    secteur: string;
    active: boolean;
    rappelJours: number;
  }): Promise<{ active: boolean; rappelJours: number }>;
  creerObligationPropre(input: {
    tenantId: string;
    libelle: string;
    periodicite: string;
    echeanceJour: number;
    echeanceMois: number | null;
    regle: string;
    secteur: string;
  }): Promise<{ id: string }>;
  secteursDuCabinet(tenantId: string): Promise<string[]>;
  roles(tenantId: string, dossierId: string | null): Promise<RoleComptable[]>;
  plan(tenantId: string, classes: number[] | null): Promise<CompteDuPlan[]>;
  ouvrirCompte(input: {
    tenantId: string;
    code: string;
    libelle: string;
    parent: string;
    sensUsuel?: string | null;
    motif?: string | null;
  }): Promise<string>;
  fermerCompte(tenantId: string, code: string): Promise<void>;
  definirLiaison(input: {
    tenantId: string;
    portee: "cabinet" | "dossier";
    porteeId: string;
    roleCode: string;
    compte: string;
    motif?: string | null;
  }): Promise<void>;
  rendreAuPack(input: {
    tenantId: string;
    portee: "cabinet" | "dossier";
    porteeId: string;
    roleCode: string;
  }): Promise<void>;
}

// ------------------------------------------------------------- intégrations
/** Une clé d'API du cabinet, telle que l'écran la voit : jamais la valeur en clair. */
export interface CleApi {
  id: string;
  libelle: string;
  /** Les huit premiers caractères après le préfixe, et les quatre derniers. */
  prefixe: string;
  suffixe: string;
  /** Ce que la clé ouvre : ecritures.lire, pieces.deposer. */
  portees: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Rendue une seule fois, à la création : la valeur en clair ne se relit jamais. */
export interface CleApiCreee {
  id: string;
  cle: string;
  prefixe: string;
  suffixe: string;
}

/** L'état des intégrations, tel que les tables le disent — rien n'est déclaré. */
export interface EtatIntegrations {
  clesActives: number;
  dernierUsage: string | null;
  /** Les pièces arrivées par l'application PME, sur les mandats. */
  piecesApp30j: number;
  dernierePieceApp: string | null;
  /** Les lignes de relevé importées dans le rapprochement, sur les mandats. */
  lignesReleves30j: number;
  dernierImportReleve: string | null;
  /** Les exports produits par le cabinet. */
  exports30j: number;
  dernierExport: string | null;
}

export interface IntegrationsRepository {
  cles(tenantId: string): Promise<CleApi[]>;
  creerCle(tenantId: string, libelle: string, portees: string[]): Promise<CleApiCreee>;
  revoquerCle(id: string): Promise<void>;
  etat(tenantId: string): Promise<EtatIntegrations>;
}

// --------------------------------------------------------------------- tiers
/**
 * Un tiers : l'auxiliaire d'un compte collectif.
 *
 * Il appartient au DOSSIER, pas au cabinet qui le saisit — « DREAM OPTIC » est
 * un client de la PME A, et la PME B n'a rien à voir dans ses créances.
 */
export interface Tiers {
  id: string;
  nature: NatureTiers;
  code: string;
  raisonSociale: string;
  identifiantFiscal: string | null;
  compteCollectif: string;
  compteLibelle: string | null;
  actif: boolean;
  note: string | null;
  creeLe: string;
}

export type NatureTiers = "client" | "fournisseur" | "salarie" | "associe" | "compte_bancaire";

/** Un compte du plan qui accepte un auxiliaire — 401, 411, 425, 442… */
export interface CompteCollectif {
  code: string;
  libelle: string;
  classe: string;
  exigeAuxiliaire: boolean;
}

export interface TiersRepository {
  lister(tenantId: string, nature: NatureTiers | null): Promise<Tiers[]>;
  comptesCollectifs(): Promise<CompteCollectif[]>;
  creer(input: {
    tenantId: string;
    nature: NatureTiers;
    code: string;
    raisonSociale: string;
    compteCollectif: string;
    identifiantFiscal?: string | null;
    note?: string | null;
  }): Promise<string>;
  modifier(input: {
    id: string;
    raisonSociale: string;
    compteCollectif: string;
    identifiantFiscal?: string | null;
    note?: string | null;
  }): Promise<void>;
  desactiver(id: string, actif: boolean): Promise<void>;
}

// ---------------------------------------------------------------- référentiel
export interface TaxRate {
  code: string;
  label: string;
  rate: string; // chaîne décimale, ex. "0.190"
  validFrom: string;
  validTo: string | null;
  jurisdiction: string;
}

export interface AccountMapping {
  documentKind: "facture_achat" | "facture_vente";
  taxCode: string | null;
  mainAccount: string;
  vatAccount: string;
  counterpartyAccount: string;
  /**
   * Le journal où l'écriture s'inscrit, lu au pack.
   *
   * Il était écrit dans le code — « achat ? ACH : VEN » — et un code de
   * journal appartient au plan de l'organisation, pas au produit (R4). `null`
   * quand le pack ne le dit pas : la proposition REFUSE alors, plutôt que de
   * ranger l'écriture dans un journal inventé qu'aucun grand-livre ne
   * retrouverait.
   */
  journalCode: string | null;
}

/**
 * Ce qu'est une classe du plan comptable : charge, produit, actif ou passif.
 *
 * Le moteur du compte de résultat testait `code.startsWith("6")`. C'est une
 * propriété du plan tunisien écrite dans le code du produit, et la première
 * juridiction numérotant autrement aurait rendu un résultat VIDE — sans
 * aucune erreur à l'écran.
 *
 * La reconnaissance se fait par PRÉFIXE, le plus long d'abord : c'est la règle
 * du plan lui-même, et elle vaut aussi pour un compte qu'un cabinet a créé et
 * qui n'est pas dans le plan livré.
 */
export interface AccountClass {
  prefix: string;
  nature: "charge" | "produit" | "actif" | "passif";
}

export interface FiscalCharge {
  code: string;
  label: string;
  documentKind: "facture_achat" | "facture_vente";
  accountCode: string;
  fixedAmount: string | null;
  legalReference: string | null;
}

// ------------------------------------------------------------------- capture
export type PieceStatus =
  "capturee" | "lue" | "proposee" | "comptabilisee" | "supervisee" | "retournee";

export interface Piece {
  id: string;
  tenantId: string;
  entityId: string | null;
  status: PieceStatus;
  source: "photo" | "pdf";
  /** Les trois lieux : l'espace privé, la bibliothèque de la société, le cabinet. */
  vis: Visibility;
  storagePath: string;
  createdAt: string;
  /**
   * Le type de la pièce (facture d'achat, de vente…) et ce qu'on en sait :
   * lu par Malica (`a_confirmer`), tranché par une personne (`confirme`),
   * ou encore inconnu. Le verrou R2 n'accepte une écriture que sur un type
   * confirmé : l'écran confirme donc le type avec le « Oui » du dirigeant.
   */
  documentKind: string | null;
  documentKindStatut: "a_determiner" | "a_confirmer" | "confirme";
  /** La facture dont cette pièce est issue — un reçu, un justificatif. */
  sourcePieceId: string | null;
  /**
   * Quand le dirigeant a décidé de garder la pièce chez lui.
   *
   * `null` ne veut pas dire « non » : il veut dire « pas encore répondu », et
   * c'est à cela que l'écran reconnaît qu'il doit poser la question. Sans
   * cette distinction, `vis = "personnel"` disait à la fois « j'ai décidé »
   * et « je n'ai rien dit », et la question revenait à chaque visite.
   */
  gardeeLe: string | null;
}

export interface Token {
  page: number;
  ordinal: number;
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Ce qu'une PME peut demander au cabinet sur une pièce transmise. */
export type DemandeSurPiece = "rappel" | "suppression";

/**
 * Un fait d'une demande. Une demande n'est pas une ligne qui change d'état :
 * c'est une suite de faits, et l'état courant est le dernier inscrit (R7).
 */
export interface FaitDeDemande {
  objet: DemandeSurPiece;
  fait: "demandee" | "accordee" | "refusee";
  note: string | null;
  createdAt: string;
}

/** Un paiement inscrit sur une pièce. Un fait, jamais réécrit (R7). */
export interface PaiementDUnePiece {
  id: string;
  moyenCode: string;
  /** En unités mineures. Nul quand rien n'a encore été payé. */
  montantMineur: number | null;
  devise: string;
  payeLe: string | null;
  /** La photo du talon, du ticket ou de l'avis — une pièce à part entière. */
  justificatifPieceId: string | null;
  createdAt: string;
  /** Le numero du cheque, de la traite, la reference du virement. */
  reference: string | null;
  /** Le paiement que cette ligne eteint, si c'est une annulation. */
  annulePaiementId: string | null;
  /**
   * Eteint : annule, ou annulation d'un autre.
   *
   * Les deux faces, repondues par la base. « Ce qui est paye aujourd'hui »
   * est la somme des lignes NON eteintes — une seule definition, un seul
   * endroit, et aucun ecran qui choisit.
   */
  eteint: boolean;
}

/** Un motif d'annulation du referentiel, traduit. */
export interface MotifDAnnulation {
  id: string;
  code: string;
  libelle: string;
  exigeUneNote: boolean;
}

export interface Citation {
  field: string;
  page: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  zone: string | null;
}

export interface Extraction {
  id: string;
  contract: string;
  payload: unknown;
  flags: Array<{ field: string; code: string; detail?: string }>;
  createdAt: string;
}

export interface PieceDossier {
  piece: Piece;
  /**
   * Les octets de la pièce, pas une URL.
   *
   * Une URL signée supposait un stockage qui en émettait. Les pièces sont
   * servies par l'API, sous cookie de session : ni un `<img src>` vers une
   * autre origine ni une règle CSS `url()` n'emporteraient ce cookie. On
   * transporte donc le contenu, et la visionneuse en fabrique ce qu'il lui faut.
   *
   * `null` dit que la ligne existe mais pas ses octets — un dépôt interrompu.
   * C'est une information, pas une erreur à masquer.
   */
  contenu: ArrayBuffer | null;
  extraction: Extraction | null;
  /**
   * Les précisions posées par la personne, par champ, la dernière faisant
   * foi. Le payload de l'extraction rendu ici les intègre déjà ; elles sont
   * exposées à part pour que l'écran sache ce qui vient d'elle.
   */
  precisions: Record<string, string>;
  /** Voir `PieceLue.lectureRefusee` : le motif, tant que la pièce n'est pas lue. */
  lectureRefusee?: LectureRefusee | null;
  citations: Citation[];
  tokens: Token[];
}

export interface NewPiece {
  tenantId: string;
  entityId: string | null;
  file: Blob;
  fileName: string;
  source: "photo" | "pdf";
  vis: Visibility;
  idempotencyKey: string;
}

/** La ligne d'une pièce, sans ses octets — ce que `enregistrer` écrit. */
export interface NouvellePiece {
  tenantId: string;
  entityId: string | null;
  source: "photo" | "pdf";
  /**
   * Où la pièce naît. `personnel`, toujours, depuis le 7 octobre 2026 : rien
   * ne part avant d'être connu, et la destination se répond ensuite, sur
   * l'écran de capture (`visibilite-a-la-capture.ts`).
   */
  vis: Visibility;
  /** Générée AVANT tout appel : la même clé rend la même pièce, toujours. */
  idempotencyKey: string;
  contentType: string | null;
  /**
   * Ce que la personne a DÉCLARÉ au moment de la photo.
   *
   * Déclaré, pas vérifié : la pièce naît « a_confirmer », et la lecture
   * pourra le contredire — c'est elle qui tranche, par la position du
   * matricule. Une déclaration est une intention, pas une preuve.
   *
   * Nul quand la question n'a pas été posée : un import, une reprise.
   */
  documentKind?: string | null;
  /**
   * La facture dont cette pièce est issue : un reçu de paiement, un
   * justificatif. Sans ce lien, le cabinet voit un document flottant et
   * personne ne peut dire ce qu'il atteste.
   */
  sourcePieceId?: string | null;
}

/**
 * Une pièce telle que l'écran « Vos documents » doit la montrer.
 *
 * L'état seul ne suffisait pas : une liste qui dit « comptabilisée » sans dire
 * DE QUI ni COMBIEN oblige à ouvrir chaque ligne pour reconnaître sa facture.
 * Ce que Malica a lu vient donc avec — et vaut `null` tant qu'elle n'a pas lu.
 */
export interface PieceLue {
  id: string;
  status: PieceStatus;
  createdAt: string;
  /**
   * Où la pièce est — et c'est ce qui décide si elle peut être lue.
   *
   * Une pièce `personnel` n'est jamais lue (B6). L'écran qui l'affiche doit
   * donc le DIRE, plutôt que de la ranger avec celles qui attendent leur
   * tour : trente pièces privées disaient « en attente de lecture » alors
   * qu'elles n'attendaient rien.
   */
  vis: Visibility;
  /** L'émetteur, tel que la lecture l'a relevé. */
  emetteur: string | null;
  /** La date portée par le DOCUMENT, qui décide de son mois. */
  dateDocument: string | null;
  kind: "facture_achat" | "facture_vente" | null;
  /** Le total TTC, chaîne décimale du Socle. */
  total: string | null;
  devise: string | null;
  /**
   * Pourquoi Malica a refusé de lire cette pièce — `null` si elle ne l'a pas
   * refusée, ou si elle a été lue depuis. `motif` est le CODE de la base
   * (`plafond_atteint`, `licence_suspendue`…), jamais une phrase : l'écran le
   * traduit. Une pièce refusée est photographiée et rangée, seulement non lue.
   */
  lectureRefusee?: LectureRefusee | null;
}

/** Un refus de lecture, tel que la base l'a inscrit. */
export interface LectureRefusee {
  motif: string;
  le: string;
}

export interface CaptureRepository {
  /**
   * Les deux pas d'un dépôt, séparés pour que la file hors ligne reprenne
   * entre les deux : la ligne d'abord (même clé → même pièce), les octets
   * ensuite (redéposer remplace). Une application tuée au milieu rejoue le pas
   * manquant, jamais les deux.
   */
  enregistrer(piece: NouvellePiece): Promise<string>;
  deposerOctets(pieceId: string, octets: Blob, contentType: string): Promise<void>;
  /** Les deux pas d'un trait, pour qui n'a pas de file — le cabinet, un import. */
  register(input: NewPiece): Promise<string>;
  list(tenantId: string): Promise<Piece[]>;
  /**
   * Les pièces d'un dossier, chacune avec sa dernière lecture.
   *
   * Une seule requête pour tout l'écran : demander la lecture pièce par pièce
   * ferait autant d'allers-retours que de documents, et l'écran s'ouvre sur
   * un mois qui peut en compter cinquante.
   */
  listAvecLecture(tenantId: string): Promise<PieceLue[]>;
  /**
   * Inscrire un paiement sur une pièce. Append-only (R7).
   *
   * Un acompte puis un solde font DEUX lignes : une colonne sur la pièce
   * dirait « payée par chèque » là où il y a eu des espèces le 3 et un
   * chèque le 28. Une erreur se corrige par un paiement d'annulation, daté.
   */
  enregistrerPaiement(input: {
    pieceId: string;
    packId: string;
    moyenCode: string;
    montantMineur?: number | null;
    devise: string;
    payeLe?: string | null;
    justificatifPieceId?: string | null;
    /**
     * Le numero du cheque, de la traite, la reference du virement.
     *
     * C'est ce que l'extrait bancaire reprendra : sans lui, le rapprochement
     * n'est pas outille, il est photographie. Quels moyens en portent une est
     * une donnee du pack (R4).
     */
    reference?: string | null;
  }): Promise<string>;
  /**
   * Les pièces issues d'une pièce : son reçu, ses justificatifs.
   *
   * Le cabinet les télécharge avec la facture. Sans cette lecture, elles
   * existent, sont transmises, et restent introuvables depuis la pièce
   * qu'elles accompagnent.
   */
  piecesIssuesDe(pieceId: string): Promise<Piece[]>;
  /**
   * Donner a la main la date qu'on n'a pas su lire.
   *
   * La precision s'inscrit, puis les articles SE REPROJETTENT : sans la
   * reprojection, la date serait enregistree et la piece resterait hors de
   * tous les mois — le drapeau changerait, pas le chiffre.
   */
  daterLaPiece(pieceId: string, date: string): Promise<{ periode: string | null }>;
  /**
   * Rattacher une preuve à un paiement déjà inscrit.
   *
   * Le paiement ne se réécrit pas : la preuve tardive est une écriture
   * nouvelle, et c'est la dernière qui vaut. Sans ce chemin, il faudrait soit
   * bloquer le paiement jusqu'à la photo — donc faire cocher « espèces » pour
   * avancer — soit inscrire un second paiement, qui doublerait le montant.
   */
  rattacherJustificatif(paiementId: string, pieceId: string): Promise<void>;
  /** Les paiements d'une pièce, du plus ancien au plus récent. */
  paiementsDUnePiece(pieceId: string): Promise<PaiementDUnePiece[]>;
  /**
   * Annuler un paiement — par une ecriture nouvelle, motivee.
   *
   * La table refuse l'UPDATE (R7) : un paiement est un fait declare, date,
   * qui a pu partir au cabinet. Une ligne l'eteint donc, et l'ancienne reste
   * lisible. Refuse d'annuler deux fois, ou d'annuler une annulation.
   */
  annulerPaiement(paiementId: string, motifId: string): Promise<void>;
  /** Les motifs d'annulation du referentiel, traduits. */
  motifsDAnnulation(locale: string): Promise<MotifDAnnulation[]>;
  dossier(pieceId: string): Promise<PieceDossier>;
  /**
   * Ce que la personne précise quand la lecture ne pouvait pas conclure —
   * aujourd'hui le sens de la pièce, achat ou vente. Une entrée nouvelle,
   * jamais une modification de la lecture (R7) ; la base contraint le champ,
   * la valeur et l'état de la pièce.
   */
  preciser(
    pieceId: string,
    champ: "document_kind",
    valeur: "facture_achat" | "facture_vente",
  ): Promise<{ id: string; champ: string; valeur: string }>;
  /**
   * Efface une pièce qui n'est encore partie nulle part.
   *
   * La base refuse si elle a été transmise au cabinet, si elle est engagée
   * dans une écriture, ou si quoi que ce soit s'en sert de justificatif.
   * Une pièce effacée emporte ses citations, son plan de tokens et ses
   * octets — il ne doit rien en rester.
   */
  supprimer(pieceId: string): Promise<boolean>;
}

// ------------------------------------------------------------------- écriture
export interface EcritureLine {
  ordinal: number;
  accountCode: string;
  libelle: string;
  debit: string;
  credit: string;
  taxCode: string | null;
}

export interface Ecriture {
  id: string;
  pieceId: string | null;
  journal: string;
  dateEcriture: string;
  devise: string;
  libelle: string;
  status: string;
  /**
   * Le pack sous lequel cette écriture a été arrêtée.
   *
   * Une correction doit rester sous LE MÊME pack, pas sous celui du jour :
   * une écriture de 2025 corrigée en 2026 relève du droit de 2025. Sans cette
   * colonne, l'écran ne pouvait que deviner, et il aurait deviné faux au
   * premier changement de version.
   */
  packVersionId: string;
  lines: EcritureLine[];
}

export interface ProposedEcriture {
  pieceId: string;
  journal: string;
  date: string;
  libelle: string;
  packVersionId: string;
  devise: string;
  lignes: Array<{
    account_code: string;
    libelle: string;
    debit: string;
    credit: string;
    tax_code?: string | null;
  }>;
}

/** Une ligne comptabilisée d'une période — de quoi calculer, rien de plus. */
export interface LigneDePeriode {
  dateEcriture: string;
  journal: string;
  accountCode: string;
  debit: string;
  credit: string;
}

/** La proposition d'écriture calculée par le serveur (3B-6), ou son refus motivé. */
/**
 * La proposition d une piece, ou son refus.
 *
 * Le verdict voyage sous DEUX formes : la phrase inscrite en base, qui est
 * l historique (R7), et le CODE, sur lequel les ecrans branchent. L ecran
 * comparait la phrase francaise accent par accent, dans un autre paquet que
 * celui qui la produit.
 */
export type PropositionDePiece =
  | {
      ok: true;
      verdict: string;
      verdictCode: CodeVerdict | null;
      packVersionId: string;
      proposition: ProposalResult;
    }
  | { ok: false; raison: string; verdict?: string; verdictCode?: CodeVerdict | null };

export interface OfficeRepository {
  propose(input: ProposedEcriture): Promise<string>;
  /**
   * La proposition d'écriture d'une pièce, calculée côté SERVEUR : depuis les
   * montants imprimés et normalisés, seulement si le verdict la déclare
   * comptabilisable. `dateSaisie` complète une date non lue, jamais une date lue.
   */
  propositionDePiece(pieceId: string, dateSaisie?: string | null): Promise<PropositionDePiece>;
  /** Enregistre la proposition du serveur : aucune ligne ne vient du client. */
  proposerDepuisPiece(pieceId: string, dateSaisie?: string | null): Promise<string>;
  /**
   * Ce que le moyen de paiement engage : l'ecriture du reglement.
   *
   * La facture constate une dette ; le reglement l'eteint. Deux faits, deux
   * dates — les confondre rend tout rapprochement bancaire impossible.
   */
  propositionDeReglement(paiementId: string): Promise<PropositionDeReglement>;
  /** Inscrire le reglement propose. Rend l'identifiant de l'ecriture. */
  proposerLeReglement(paiementId: string): Promise<string>;
  /**
   * Les lignes comptabilisées entre deux dates.
   *
   * C'est la fonction `socle_periode_lignes` du Socle, pas une requête montée
   * ici : le périmètre de ce qui est « comptabilisé » est une décision de la
   * base, et un écran qui la redéfinirait afficherait un résultat que la
   * balance ne confirmerait pas.
   */
  periodeLignes(tenantId: string, from: string, to: string): Promise<LigneDePeriode[]>;
  book(ecritureId: string): Promise<void>;
  ecrituresForPiece(pieceId: string): Promise<Ecriture[]>;
  ecrituresByIds(ids: string[]): Promise<Ecriture[]>;
  bookedExtracts(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<Array<{ pieceId: string; extract: unknown }>>;
  /**
   * Les lectures des pièces TRANSMISES au cabinet dans la fenêtre.
   *
   * La lecture de la PME, là où `bookedExtracts` est celle du cabinet. Une
   * TVA se récupère sur une déclaration, et le cabinet ne déclare que ce
   * qu'il a reçu : une pièce gardée au coffre pèse zéro, et c'est juste.
   */
  extraitsTransmis(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<Array<{ pieceId: string; extract: unknown; transmiseLe: string }>>;
  /** Les pièces parties au cabinet sans qu'on sache quand. Voir `extraitsTransmis`. */
  transmisesSansDate(tenantId: string): Promise<number>;
}

// --------------------------------------------------------------- supervision
export type ReviewOutcome = "valide" | "retourne";

export interface RejetMotif {
  id: string;
  code: string;
  label: string;
  severity: string;
  requiresNote: boolean;
}

export interface ClientSummary {
  tenantId: string;
  name: string;
  legalId: string | null;
  jurisdiction: string;
  currency: string;
  validationMode: ValidationMode;
  engagementStatus: string;
  /** Le premier jour du mandat, ou rien si l'engagement ne le dit pas. */
  mandatDepuis: string | null;
  /** Pièces partagées par statut — le mur de visibilité est tenu par la base. */
  counts: Record<PieceStatus, number>;
}

export interface QueueItem {
  pieceId: string;
  tenantId: string;
  clientName: string;
  status: PieceStatus;
  source: "photo" | "pdf";
  createdAt: string;
  ecritureId: string | null;
  libelle: string | null;
  dateEcriture: string | null;
  /** La somme des débits de l'écriture comptabilisée, posée par le Socle. */
  montant: string | null;
  /** L'adresse du collaborateur affecté au client, s'il y en a un. */
  collaborateur: string | null;
  /** La confiance globale de la dernière lecture (0..1), ou rien si elle n'a pas été mesurée. */
  confiance: number | null;
  /**
   * Ce que la PME demande sur cette pièce, et qui attend le cabinet.
   *
   * Dans la file, et non dans un écran séparé : une demande qu'il faut aller
   * chercher est une demande qui dort. `null` quand il n'y a rien à trancher.
   */
  demandeEnAttente: DemandeSurPiece | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string | null;
  at: string;
  motifId: string | null;
  payload: unknown;
}

/** Les statistiques d'un cabinet, agrégées en base sur ses mandats. */
export interface StatistiquesCabinet {
  /** Écritures supervisées, par mois (« YYYY-MM ») et par collaborateur (adresse, ou rien). */
  parMois: Array<{ mois: string; collaborateur: string | null; supervisees: number }>;
  /** Les cinq motifs de retour les plus fréquents, dans la langue demandée. */
  motifsDeRetour: Array<{ label: string; retours: number }>;
  /** Ce que le Socle a produit sur trente jours ; le délai est une médiane, en heures, ou rien. */
  socle: {
    lues: number;
    proposees: number;
    comptabilisees: number;
    delaiMedianHeures: number | null;
  };
}

export interface SupervisionRepository {
  statistiques(cabinetTenantId: string, locale: string): Promise<StatistiquesCabinet>;
  /** Les derniers événements d'un dossier mandaté, du plus récent au plus ancien. */
  journalDuMandat(
    tenantId: string,
    limite?: number,
  ): Promise<
    Array<{ id: string; action: string; at: string; objet: string | null; objetId: string | null }>
  >;
  /** Organisations cabinet dont l'utilisateur est membre. */
  listMyCabinets(): Promise<Organization[]>;
  listClients(cabinetTenantId: string): Promise<ClientSummary[]>;
  /** File priorisée : comptabilisé d'abord, puis proposé, puis lu. */
  queue(cabinetTenantId: string, tenantId?: string): Promise<QueueItem[]>;
  motifs(locale: string): Promise<RejetMotif[]>;
  review(input: {
    ecritureId: string;
    outcome: ReviewOutcome;
    motifId?: string | null;
    note?: string | null;
  }): Promise<string | null>;
  auditForPiece(pieceId: string): Promise<AuditEntry[]>;
}

// ------------------------------------------------------- paramètres du Socle
/** Aucune constante fiscale en TypeScript : tout vient du pack (R4). */
export interface SocleParams {
  packVersionId: string;
  moneyDecimals: number;
  stockMethode: "cump" | "fifo";
  stockQuantiteDecimals: number;
  rapprochementToleranceJours: number;
  rapprochementToleranceMontant: string;
}

export interface ImmoCategory {
  id: string;
  code: string;
  label: string;
  method: "lineaire" | "degressif";
  dureeAnnees: number;
  coefficient: string;
  accountImmo: string;
  accountAmort: string;
  accountDotation: string;
  legalReference: string | null;
}

// ----------------------------------------------------------- immobilisations
export interface Asset {
  id: string;
  tenantId: string;
  categoryId: string;
  label: string;
  miseEnService: string;
  valeurBrute: string;
  valeurResiduelle: string;
  method: "lineaire" | "degressif";
  dureeAnnees: number;
  coefficient: string;
  devise: string;
  status: "en_service" | "cede" | "rebute";
  pieceId: string | null;
  createdAt: string;
}

export interface NewAsset {
  tenantId: string;
  entityId: string | null;
  categoryId: string;
  label: string;
  miseEnService: string;
  valeurBrute: string;
  valeurResiduelle: string;
  method: "lineaire" | "degressif";
  dureeAnnees: number;
  coefficient: string;
  devise: string;
  packVersionId: string;
  pieceId?: string | null;
  vis?: "personnel" | "partage";
}

export interface Dotation {
  id: string;
  assetId: string;
  exercice: number;
  months: number;
  dotation: string;
  cumul: string;
  vnc: string;
  ecritureId: string | null;
  createdAt: string;
}

export interface Depreciation {
  id: string;
  assetId: string;
  at: string;
  vnc: string;
  valeurRecouvrable: string;
  mouvement: string;
  cumul: string;
  note: string | null;
  ecritureId: string | null;
  createdAt: string;
}

export interface Cession {
  id: string;
  assetId: string;
  at: string;
  prix: string;
  vnc: string;
  resultat: string;
  createdAt: string;
}

export interface ImmoRepository {
  categories(packVersionId: string): Promise<ImmoCategory[]>;
  listAssets(tenantId: string): Promise<Asset[]>;
  createAsset(input: NewAsset): Promise<string>;
  dotations(tenantId: string, assetId?: string): Promise<Dotation[]>;
  depreciations(tenantId: string, assetId?: string): Promise<Depreciation[]>;
  /** Édition d'un bien — permise tant qu'aucune dotation n'est constatée. */
  updateAsset(input: {
    id: string;
    label: string;
    miseEnService: string;
    valeurBrute: string;
    valeurResiduelle: string;
    method: "lineaire" | "degressif";
    dureeAnnees: number;
    coefficient: string;
    status: "en_service" | "cede" | "rebute";
  }): Promise<void>;
  /** Geste indivisible : écriture du Socle comptabilisée + dotation au journal. */
  constaterDotation(input: {
    assetId: string;
    exercice: number;
    months: number;
    dotation: string;
    cumul: string;
    vnc: string;
    packVersionId: string;
    date?: string | null;
  }): Promise<{ dotationId: string; ecritureId: string }>;
  /** Dépréciation (mouvement > 0) ou reprise (mouvement < 0), écriture comprise. */
  constaterDepreciation(input: {
    assetId: string;
    at: string;
    vnc: string;
    valeurRecouvrable: string;
    mouvement: string;
    cumul: string;
    packVersionId: string;
    note?: string | null;
  }): Promise<{ depreciationId: string; ecritureId: string }>;
  cessions(tenantId: string): Promise<Cession[]>;
  recordCession(input: {
    tenantId: string;
    assetId: string;
    at: string;
    prix: string;
    vnc: string;
    resultat: string;
  }): Promise<string>;
}

// -------------------------------------------------------------------- stocks
export interface StockCategory {
  id: string;
  code: string;
  label: string;
  accountStock: string;
  accountVariation: string;
  accountProvision: string;
  accountProvisionDotation: string;
  accountProvisionReprise: string;
  legalReference: string | null;
}

export interface StockItem {
  id: string;
  tenantId: string;
  categoryId: string | null;
  reference: string;
  designation: string;
  unite: string;
  methode: "cump" | "fifo";
  accountStock: string;
  accountVariation: string;
  devise: string;
  active: boolean;
}

export interface NewStockItem {
  tenantId: string;
  entityId: string | null;
  categoryId: string | null;
  reference: string;
  designation: string;
  unite: string;
  methode: "cump" | "fifo";
  accountStock: string;
  accountVariation: string;
  devise: string;
  packVersionId: string;
}

export interface StockMouvementRow {
  id: string;
  itemId: string;
  sens: "entree" | "sortie";
  at: string;
  quantite: string;
  coutUnitaire: string | null;
  reference: string | null;
  pieceId: string | null;
}

export interface StockInventaireRow {
  id: string;
  itemId: string | null;
  period: string;
  initial: string;
  final: string;
  variation: string;
  ecritureId: string | null;
  createdAt: string;
}

export interface StockDepreciationRow {
  id: string;
  itemId: string;
  at: string;
  valeurStock: string;
  valeurNette: string;
  mouvement: string;
  cumul: string;
  note: string | null;
  ecritureId: string | null;
  createdAt: string;
}

export interface StocksRepository {
  categories(packVersionId: string): Promise<StockCategory[]>;
  listItems(tenantId: string): Promise<StockItem[]>;
  createItem(input: NewStockItem): Promise<string>;
  updateItem(input: {
    id: string;
    designation: string;
    unite: string;
    methode: "cump" | "fifo";
    active: boolean;
  }): Promise<void>;
  mouvements(tenantId: string, itemId?: string): Promise<StockMouvementRow[]>;
  addMouvement(input: {
    tenantId: string;
    itemId: string;
    sens: "entree" | "sortie";
    at: string;
    quantite: string;
    coutUnitaire?: string | null;
    reference?: string | null;
    pieceId?: string | null;
  }): Promise<string>;
  inventaires(tenantId: string, itemId?: string): Promise<StockInventaireRow[]>;
  constaterInventaire(input: {
    itemId: string;
    period: string;
    initial: string;
    final: string;
    variation: string;
    packVersionId: string;
    date: string;
  }): Promise<{ inventaireId: string; ecritureId: string }>;
  depreciations(tenantId: string, itemId?: string): Promise<StockDepreciationRow[]>;
  constaterDepreciation(input: {
    itemId: string;
    at: string;
    valeurStock: string;
    valeurNette: string;
    mouvement: string;
    cumul: string;
    packVersionId: string;
    note?: string | null;
  }): Promise<{ depreciationId: string; ecritureId: string }>;
}

// -------------------------------------------------------------------- banque
export interface BankAccount {
  id: string;
  tenantId: string;
  label: string;
  iban: string | null;
  devise: string;
  accountCode: string;
  active: boolean;
}

export interface BankStatementLine {
  id: string;
  compteId: string;
  at: string;
  label: string;
  montant: string;
  reference: string | null;
  status: "ouverte" | "rapprochee" | "ignoree";
}

/** Écriture comptabilisée candidate au lettrage, avec sa pièce d'origine. */
export interface BankBookLine {
  id: string;
  pieceId: string | null;
  at: string;
  journal: string;
  label: string;
  montant: string;
  reference: string | null;
  lettree: boolean;
}

/** État courant du lettrage d'une ligne : au plus un actif par ligne et par écriture. */
export interface LettrageEtat {
  ligneId: string;
  ecritureId: string;
  active: boolean;
  score: number;
  ecartMontant: string;
  ecartJours: number;
  referenceExacte: boolean;
  updatedAt: string;
}

/** Décision consignée : lettrage ou délettrage. Rien ne s'efface (R7). */
export interface LettrageRow {
  id: string;
  ligneId: string;
  ecritureId: string;
  action: "lettre" | "delettre";
  seq: number;
  score: number;
  ecartMontant: string;
  ecartJours: number;
  referenceExacte: boolean;
  motifId: string | null;
  note: string | null;
  createdAt: string;
}

export interface BanqueRepository {
  listAccounts(tenantId: string): Promise<BankAccount[]>;
  createAccount(input: {
    tenantId: string;
    entityId: string | null;
    label: string;
    iban?: string | null;
    devise: string;
    accountCode: string;
  }): Promise<string>;
  lines(tenantId: string, compteId: string): Promise<BankStatementLine[]>;
  /** Import idempotent : la clé empêche tout doublon de relevé. */
  importLines(input: {
    tenantId: string;
    compteId: string;
    batchId: string;
    lines: Array<{
      at: string;
      label: string;
      montant: string;
      reference: string | null;
      idempotencyKey: string;
    }>;
  }): Promise<number>;
  /** Lignes comptables du compte bancaire, candidates au lettrage. */
  bookLines(input: {
    tenantId: string;
    accountCode: string;
    from: string;
    to: string;
  }): Promise<BankBookLine[]>;
  /** État courant des appariements du tenant. */
  etat(tenantId: string): Promise<LettrageEtat[]>;
  /** Journal append-only des décisions d'appariement. */
  lettrages(tenantId: string): Promise<LettrageRow[]>;
  /** L'appariement retenu vient du Socle ; ici on ne fait que le consigner. */
  lettrer(input: {
    ligneId: string;
    ecritureId: string;
    score: number;
    ecartMontant: string;
    ecartJours: number;
    referenceExacte: boolean;
    packVersionId: string;
  }): Promise<string>;
  /** Contre-passation du lettrage : motif gouverné obligatoire. */
  delettrer(input: { ligneId: string; motifId: string; note?: string | null }): Promise<string>;
  /** Journal d'audit des gestes bancaires du tenant. */
  audit(tenantId: string): Promise<AuditEntry[]>;
  setLineStatus(ligneId: string, status: "ouverte" | "rapprochee" | "ignoree"): Promise<void>;
}

// ------------------------------------------------------------- collaboration
/**
 * Les trois lieux où une pièce peut être.
 *
 * ================================================= POURQUOI TROIS, ET PAS DEUX
 *
 * `entite` existe en base depuis le 18 octobre 2026
 * (`20261018100000_la_societe_est_un_troisieme_lieu.sql`) et l'API l'accepte
 * (`apps/api/src/depots/collab.ts`). Ce type n'en portait que deux : la
 * migration n'avait donc AUCUN effet visible, et « la société, sans
 * transmettre » était une option morte à l'écran.
 *
 *   personnel  l'espace privé de la personne. Jamais transmise, jamais LUE —
 *              c'est B6, et `public.lecture_autorisee` le refuse.
 *   entite     la bibliothèque de la société. Lue, rangée, pas transmise.
 *   partage    chez le cabinet. C'est la seule transmission, et le retour
 *              demande son accord.
 */
export type Visibility = "personnel" | "entite" | "partage";

/** Collaborateur du cabinet, seul destinataire possible d'une affectation. */
export interface CabinetMember {
  tenantId: string;
  userId: string;
  role: string;
  email: string;
}

/** Affectation d'un dossier client à un collaborateur. Rien ne s'efface (R7). */
export interface Assignment {
  id: string;
  cabinetTenantId: string;
  clientTenantId: string;
  collaboratorId: string;
  briefing: string | null;
  active: boolean;
  seq: number;
  createdAt: string;
}

/** Une section du procès-verbal : un intitulé et son corps. Le texte, jamais un chiffre. */
export interface PvSection {
  kicker: string;
  corps: string;
}

/**
 * Un chiffre cité par le procès-verbal, avec le moteur qui l'a produit.
 *
 * `label` et `source` sont des codes que l'écran traduit ; `valeur` est la
 * chaîne décimale du Socle, ou un comptage. Aucune de ces valeurs n'a
 * traversé un modèle de langage (R3).
 */
export interface PvChiffre {
  label: string;
  valeur: string;
  source: string;
  genre: "montant" | "nombre";
  devise: string | null;
}

export interface PvReunion {
  id: string;
  cabinetTenantId: string;
  clientTenantId: string | null;
  at: string;
  titre: string;
  participants: string | null;
  ordreDuJour: string | null;
  decisions: string | null;
  createdAt: string;
  sections: PvSection[];
  chiffres: PvChiffre[];
  /** Le registre demandé à Malica : sobre | chaleureux, ou rien si personne n'a rédigé. */
  ton: string | null;
  /** brouillon | envoye — envoyé, le PV est figé (R7). */
  statut: string;
  envoyeLe: string | null;
  redigeParMalica: boolean;
}

/** Une invitation à rejoindre le cabinet, consignée en attendant d'être acceptée. */
export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/** Agrégats de lecture — comptages d'états, jamais un montant. */
export interface ClientStats {
  tenantId: string;
  pieces: number;
  capturees: number;
  lues: number;
  proposees: number;
  comptabilisees: number;
  supervisees: number;
  retournees: number;
  heuresMoyennes: number;
  dernierePiece: string | null;
}

export interface Notification {
  id: string;
  tenantId: string;
  kind: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface Echeance {
  id: string;
  tenantId: string;
  /** Le code de l'obligation dans le référentiel. */
  kind: string;
  label: string;
  period: string | null;
  dueDate: string;
  /** a_venir | fait | en_retard — le retard se constate, il ne se saisit pas. */
  status: string;
  faitLe: string | null;
  /** La règle littérale du référentiel, qui fait foi. */
  regle: string | null;
  texteSource: string | null;
  article: string | null;
  periodicite: string | null;
}

/** Ce que la dérivation a produit pour un dossier — ou pourquoi rien. */
export interface DerivationEcheances {
  tenantId: string;
  generees: number;
  /** fiche.absente | fiche.incomplete | pack.absent, ou rien. */
  raison: string | null;
}

export interface CollabRepository {
  members(cabinetTenantId: string): Promise<CabinetMember[]>;
  assignments(cabinetTenantId: string): Promise<Assignment[]>;
  /** Réaffectation atomique : l'ancienne reste au journal avec son briefing. */
  assign(input: {
    cabinetTenantId: string;
    clientTenantId: string;
    collaboratorId: string;
    briefing?: string | null;
  }): Promise<string>;
  pvList(cabinetTenantId: string): Promise<PvReunion[]>;
  addPv(input: {
    cabinetTenantId: string;
    clientTenantId?: string | null;
    at: string;
    titre: string;
    participants?: string | null;
    ordreDuJour?: string | null;
    decisions?: string | null;
  }): Promise<string>;
  pvOuvrir(id: string): Promise<PvReunion | null>;
  /** Ce qu'on ne passe pas reste tel quel. Refusé par la base une fois envoyé (R7). */
  pvEnregistrer(input: {
    id: string;
    titre?: string;
    participants?: string | null;
    decisions?: string | null;
    sections?: PvSection[];
    chiffres?: PvChiffre[];
    ton?: string | null;
    redigeParMalica?: boolean;
  }): Promise<PvReunion>;
  /** Fige le PV, le journalise et prévient le client. */
  pvEnvoyer(id: string): Promise<{ id: string; statut: string; envoyeLe: string | null }>;
  invitations(cabinetTenantId: string): Promise<Invitation[]>;
  /** Les invitations adressées à mon adresse, encore valables. */
  invitationsPourMoi(): Promise<InvitationRecue[]>;
  repondreAInvitation(
    id: string,
    accepte: boolean,
  ): Promise<{ id: string; tenantId: string; role: string; rejoint: boolean }>;
  inviter(input: {
    tenantId: string;
    email: string;
    role: string;
  }): Promise<{ id: string; email: string; role: string; expiresAt: string; deja: boolean }>;
  stats(tenantIds: string[]): Promise<ClientStats[]>;
  notifications(tenantIds: string[]): Promise<Notification[]>;
  markRead(id: string): Promise<void>;
  echeances(tenantIds: string[]): Promise<Echeance[]>;
  /** Dériver le calendrier de chaque dossier depuis le pack ; idempotent. */
  deriverEcheances(tenantIds: string[]): Promise<DerivationEcheances[]>;
  marquerEcheance(id: string, fait: boolean): Promise<{ status: string }>;
  /** Mur de visibilité (R6) : bascule journalisée, refusée après comptabilisation. */
  setPieceVis(pieceId: string, vis: Visibility): Promise<boolean>;
  /**
   * Inscrire la décision de garder la pièce dans l'espace privé.
   *
   * Elle ne change pas la visibilité : elle la CONFIRME. Sans cette
   * confirmation, « personnel » voulait dire à la fois « j'ai décidé » et
   * « je n'ai pas répondu », et l'écran reposait la question à chaque visite.
   *
   * Garder ne ferme rien : la pièce part au cabinet quand son dirigeant le
   * veut. C'est l'inverse qui demande un accord.
   */
  garderPiece(pieceId: string): Promise<{ changed: boolean }>;
  /**
   * Ce que la PME demande au cabinet sur une pièce déjà transmise.
   *
   * Une pièce partie ne revient pas d'elle-même : le cabinet travaille sur ce
   * qu'il a reçu, et une pièce qui disparaît de sa file sans un mot est pire
   * que l'état bloqué qu'on voulait défaire. Deux motifs, un mécanisme.
   */
  demanderSurPiece(pieceId: string, objet: DemandeSurPiece): Promise<{ dejaDemandee: boolean }>;
  /** Le cabinet tranche. Un accord de rappel remet la pièce chez la PME. */
  repondreSurPiece(
    pieceId: string,
    objet: DemandeSurPiece,
    accorde: boolean,
    note?: string | null,
  ): Promise<void>;
  /** Les faits d'une demande, du plus récent au plus ancien. L'état courant est le premier. */
  demandesDUnePiece(pieceId: string): Promise<FaitDeDemande[]>;
}

// ------------------------------------------------------------------ exports
/** Les formats qu'un cabinet peut produire. Le libellé humain est dans le dictionnaire. */
export type FormatExport = "fec" | "csv_ecritures" | "csv_plan";

/** Un exercice qu'on peut exporter, borné par la clôture inscrite sur la fiche. */
export interface ExerciceExportable {
  exercice: number;
  du: string;
  au: string;
  clos: boolean;
  /** Faux quand la fiche ne dit pas la clôture : l'année civile s'applique, et l'écran le dit. */
  clotureConnue: boolean;
  ecritures: number;
}

/** Le fichier produit — le navigateur en fait un téléchargement. */
export interface ExportGenere {
  id: string;
  contenu: string;
  nomDeFichier: string;
  typeMime: string;
  /** En octets, mesurés sur le contenu. */
  taille: number;
  lignes: number;
  /** SHA-256 du contenu, tel que le journal le garde. */
  empreinte: string;
}

export interface ExportRecent {
  id: string;
  clientTenantId: string | null;
  clientNom: string | null;
  format: FormatExport;
  du: string;
  au: string;
  lignes: number;
  taille: number;
  empreinte: string;
  auteur: string | null;
  createdAt: string;
}

export interface ExportsRepository {
  exercices(cabinetTenantId: string, clientTenantId: string | null): Promise<ExerciceExportable[]>;
  /** La taille réelle du fichier qui serait produit : calculée sur le contenu, pas estimée. */
  estimer(
    cabinetTenantId: string,
    clientTenantId: string | null,
    du: string,
    au: string,
    format: FormatExport,
  ): Promise<{ lignes: number; taille: number }>;
  /** Produit, journalise (append-only + audit), rend le contenu. */
  generer(
    cabinetTenantId: string,
    clientTenantId: string | null,
    du: string,
    au: string,
    format: FormatExport,
  ): Promise<ExportGenere>;
  historique(cabinetTenantId: string): Promise<ExportRecent[]>;
}

// ------------------------------------------------------------------ conseil
/** Un article sur lequel une réponse de conseil s'appuie, tel qu'il a été transmis. */
export interface SourceCitee {
  corpus: string;
  numero: string;
  validFrom: string | null;
  validTo: string | null;
  langue: string | null;
}

/**
 * en_attente : Malica a retenu sa réponse et la remet au cabinet ·
 * repondue : elle l'a envoyée seule, au-dessus du seuil, cabinet en copie ·
 * approuvee · corrigee · ecartee : ce que le cabinet en a décidé.
 */
export type StatutArbitrage = "en_attente" | "repondue" | "approuvee" | "corrigee" | "ecartee";
export type DecisionArbitrage = "approuvee" | "corrigee" | "ecartee";

/** Une question de conseil d'un client mandaté, et ce que Malica en a proposé. */
export interface Arbitrage {
  id: string;
  tenantId: string;
  client: string | null;
  cabinetTenantId: string;
  conversationId: string | null;
  messageId: string | null;
  /** L'adresse de la personne qui a demandé, figée à la création. */
  demandeur: string | null;
  question: string;
  reponseProposee: string;
  sources: SourceCitee[];
  /** La certitude déclarée par Malica, 0..1. */
  certitude: number;
  /** Pourquoi elle la remet — dans ses mots. */
  doute: string | null;
  canal: string;
  /** Le sujet en quelques mots, posé à la création : c'est ce qui compte les sujets qui reviennent. */
  theme: string | null;
  /** La langue du client : la réponse du cabinet lui parvient dans celle-là. */
  langue: string;
  statut: StatutArbitrage;
  reponseCabinet: string | null;
  articleCabinet: string | null;
  decideLe: string | null;
  createdAt: string;
}

export interface StatistiquesConseil {
  totaux: {
    enAttente: number;
    repondues: number;
    approuvees: number;
    corrigees: number;
    ecartees: number;
    plusAncienneEnAttente: string | null;
  };
  parClient: Array<{
    tenantId: string;
    client: string | null;
    questions: number;
    enAttente: number;
    repondues: number;
    approuvees: number;
    corrigees: number;
    ecartees: number;
    dernierSujet: string | null;
    derniereLe: string | null;
  }>;
  sujets: Array<{ theme: string; questions: number }>;
}

/** Une édition du corpus : les articles d'un corpus entrés en vigueur le même jour. */
export interface EditionDuCorpus {
  corpus: string;
  nom: string | null;
  famille: string | null;
  validFrom: string;
  articles: number;
  modifiePar: string | null;
  jort: string | null;
  langue: string | null;
}

/** Ce que Malica doit savoir d'un dossier avant de répondre à son client. */
export interface ContexteConseil {
  cabinetId: string | null;
  cabinetNom: string | null;
  seuil: number | null;
  appelantMembre: boolean;
}

export interface ConseilRepository {
  /** La file du cabinet : ce qui attend d'abord. `statut` la restreint. */
  file(cabinetTenantId: string, statut?: StatutArbitrage | null): Promise<Arbitrage[]>;
  lire(id: string): Promise<Arbitrage | null>;
  /**
   * Le geste du cabinet. `message` est ce que le client lira dans son fil,
   * composé dans SA langue ; absent, rien ne part.
   */
  decider(
    id: string,
    decision: DecisionArbitrage,
    reponse?: string | null,
    article?: string | null,
    message?: string | null,
  ): Promise<Arbitrage>;
  contexte(pmeTenantId: string): Promise<ContexteConseil>;
  statistiques(cabinetTenantId: string): Promise<StatistiquesConseil>;
  /** Les éditions du corpus de cette juridiction, la plus récente en tête. */
  veille(jurisdiction: string, limite?: number): Promise<EditionDuCorpus[]>;
  /** Les noms des corpus, pour écrire « code de la TVA » et non son sigle. */
  nomsDesCorpus(codes: string[]): Promise<Record<string, string>>;
}

// ------------------------------------------------- charges par famille (PME)
export interface ChargeFamille {
  code: string;
  label: string;
  ordinal: number;
  isFallback: boolean;
}

export interface AnomalyThresholdRow {
  code: string;
  minPeriods: number;
  deviationRatio: string;
  minAmount: string;
}

export interface PieceArticle {
  pieceId: string;
  ordinal: number;
  designation: string;
  quantity: string | null;
  unitPriceHt: string | null;
  unitPriceTtc: string | null;
  totalHt: string | null;
  familleCode: string;
  familleSource: string;
  period: string;
  documentDate: string | null;
  citationField: string | null;
  /** Une citation par champ : un montant sans citation n'est pas affiché (R2). */
  citationQuantity: string | null;
  citationUnitPriceHt: string | null;
  citationUnitPriceTtc: string | null;
  citationTotalHt: string | null;
}

export interface ChargeQuestionRow {
  id: string;
  period: string;
  familleCode: string;
  observed: string;
  baseline: string;
  deviationRatio: string;
  thresholdCode: string;
  answer: "exceptionnel" | "a_verifier" | null;
  answeredAt: string | null;
  /**
   * Qui a répondu : le dossier lui-même, ou son cabinet.
   *
   * « Exceptionnel » dit par le dirigeant est une déclaration ; dit par
   * l'expert, c'est un avis professionnel. Sans ce mot, l'écran ne peut pas
   * faire la différence, et la réponse arrive anonyme.
   */
  answeredSide: "pme" | "cabinet" | null;
}

/**
 * Ce qui attend sa date, et n'entre donc dans aucun mois.
 *
 * ================================================================= POURQUOI
 *
 * Depuis le 5 octobre 2026, une pièce dont la date n'a pas été lue n'est plus
 * rangée au mois du scan : sa période reste vide (R4, aucun repli implicite).
 *
 * Corriger cela crée un devoir, sinon la correction est pire que le défaut :
 * ces pièces sortaient d'un faux total, elles ne doivent pas tomber dans un
 * silence. Un montant qu'on retire d'un écran doit apparaître ailleurs, nommé,
 * avec le geste qui le débloque — ici : saisir la date.
 */
export interface ChargesEnAttenteDeDate {
  /** Nombre d'articles dont la pièce n'a pas de date lue. */
  articles: number;
  /** Nombre de pièces distinctes concernées : c'est ce que la personne compte. */
  pieces: number;
  /** Total HT en attente, pour que l'écart avec le total du mois s'explique. */
  totalHt: string | null;
}

export interface ChargesRepository {
  /** Les familles de charges du pack, libelle traduit. */
  familles(packId: string, locale?: string): Promise<ChargeFamille[]>;
  anomalyThreshold(packId: string, code: string): Promise<AnomalyThresholdRow | null>;
  articles(tenantId: string, fromPeriod: string, toPeriod: string): Promise<PieceArticle[]>;
  enAttenteDeDate(tenantId: string): Promise<ChargesEnAttenteDeDate>;
  questions(tenantId: string): Promise<ChargeQuestionRow[]>;
  answer(input: {
    tenantId: string;
    period: string;
    familleCode: string;
    observed: string;
    baseline: string;
    deviationRatio: string;
    thresholdCode: string;
    packVersionId: string;
    answer: "exceptionnel" | "a_verifier";
  }): Promise<string>;
}

// ------------------------------------------------------------------ honoraires
/**
 * Un mandat d'honoraires ouvert : mode, fréquence, jour, barème, délai,
 * couverture. Un mandat ne se corrige pas — on le clôt et on en ouvre un
 * autre, daté.
 */
export interface MandatHonoraires {
  id: string;
  clientTenantId: string;
  clientName: string;
  /** forfait | temps | mixte */
  mode: string;
  /** mensuelle | trimestrielle | annuelle */
  frequence: string;
  jourFacturation: number;
  /** Chaîne décimale, ou rien quand le mode ne porte pas de forfait. */
  forfait: string | null;
  tauxHoraire: string | null;
  /** Jours après l'émission ; saisi par le cabinet, jamais supposé. */
  delaiPaiementJours: number;
  /** Les prestations couvertes, telles que le cabinet les nomme. */
  couverture: string[];
  validFrom: string;
  /** La prochaine date d'émission, dérivée en base ; rien si le mandat est clos. */
  prochaine: string | null;
}

/** Une ligne telle que l'expert la saisit : aucun total, la base le déduit. */
export interface LigneHonorairesSaisie {
  libelle: string;
  quantite: string;
  prixUnitaire: string;
}

export interface LigneHonoraires extends LigneHonorairesSaisie {
  id: string;
  ordre: number;
  /** Déduit en base : quantité × prix unitaire. */
  montantHt: string;
}

/**
 * Une facture d'honoraires. Brouillon, elle se réécrit ; émise, elle prend
 * son numéro et se fige — elle s'encaisse, ou s'annule par un avoir.
 */
export interface FactureHonoraires {
  id: string;
  tenantId: string;
  clientTenantId: string;
  clientName: string;
  mandatId: string | null;
  /** H-AAAA-NNNN, attribué à l'émission ; rien pour un brouillon. */
  numero: string | null;
  periodeDu: string;
  periodeAu: string;
  /** brouillon | emise | payee | annulee */
  statut: string;
  /** Le code du taux du pack, et le taux photographié à l'établissement. */
  tauxTvaCode: string;
  tauxTva: string;
  totalHt: string;
  totalTva: string;
  /** Les droits fixes du pack (timbre), et leur nom. */
  droitsFixes: string;
  droitsLibelle: string | null;
  totalTtc: string;
  /** La somme des encaissements, faite en base. */
  encaisse: string;
  devise: string;
  emiseLe: string | null;
  /** Émission + délai du mandat, figée à l'émission. */
  echeanceLe: string | null;
  payeeLe: string | null;
  annuleeLe: string | null;
  /** La facture que cet avoir annule. */
  avoirDe: string | null;
  createdAt: string;
}

export interface EncaissementHonoraires {
  id: string;
  montant: string;
  encaisseLe: string;
  /** virement | cheque | especes | carte | autre */
  moyen: string;
  reference: string | null;
}

export interface EncaissementDuMois extends EncaissementHonoraires {
  factureId: string;
  numero: string | null;
  clientName: string;
}

/** Une mention que le pack exige sur une facture — lue, jamais écrite dans le code. */
export interface MentionDuPack {
  code: string;
  label: string;
  mandatory: boolean;
  legalReference: string | null;
}

export interface FactureHonorairesDossier extends FactureHonoraires {
  cabinet: { name: string; legalId: string | null };
  client: { name: string; legalId: string | null };
  mandat: {
    mode: string;
    frequence: string;
    delaiPaiementJours: number;
    couverture: string[];
    forfait: string | null;
    tauxHoraire: string | null;
  } | null;
  lignes: LigneHonoraires[];
  encaissements: EncaissementHonoraires[];
  mentions: MentionDuPack[];
}

/** La synthèse d'un mois, entièrement sommée en base. */
export interface SyntheseHonoraires {
  mois: string;
  devise: string;
  factureHt: string;
  factureTtc: string;
  nbFactures: number;
  encaisse: string;
  nbEncaissements: number;
  resteDu: string;
  nbOuvertes: number;
  enRetard: string;
  nbRetard: number;
  /** Encaissé du mois sur facturé TTC du mois ; rien quand rien n'est facturé. */
  tauxEncaissement: string | null;
  nbBrouillons: number;
}

export interface HonorairesRepository {
  mandats(cabinetTenantId: string): Promise<MandatHonoraires[]>;
  /** Clôt le mandat ouvert du client, s'il existe, et en ouvre un autre. */
  definirMandat(input: {
    cabinetTenantId: string;
    clientTenantId: string;
    mode: string;
    frequence: string;
    jourFacturation: number;
    forfait: string | null;
    tauxHoraire: string | null;
    delaiPaiementJours: number;
    couverture: string[];
  }): Promise<{ id: string }>;
  cloreMandat(id: string): Promise<{ id: string }>;
  factures(
    cabinetTenantId: string,
    filtres?: { mois?: string | null; statut?: string | null; clientTenantId?: string | null },
  ): Promise<FactureHonoraires[]>;
  encaissements(cabinetTenantId: string, mois: string): Promise<EncaissementDuMois[]>;
  facture(id: string): Promise<FactureHonorairesDossier | null>;
  creerBrouillon(input: {
    cabinetTenantId: string;
    clientTenantId: string;
    periodeDu: string;
    periodeAu: string;
    tauxTvaCode: string;
    lignes: LigneHonorairesSaisie[];
  }): Promise<{ id: string }>;
  modifierBrouillon(input: {
    id: string;
    periodeDu: string;
    periodeAu: string;
    tauxTvaCode: string;
    lignes: LigneHonorairesSaisie[];
  }): Promise<{ id: string }>;
  supprimerBrouillon(id: string): Promise<boolean>;
  /** Numérote, fige, journalise. */
  emettre(id: string): Promise<{ id: string; numero: string }>;
  encaisser(input: {
    factureId: string;
    montant: string;
    encaisseLe: string;
    moyen: string;
    reference: string | null;
  }): Promise<{ id: string; encaisse: string; soldee: boolean }>;
  /** Crée l'avoir négatif et annule la facture. */
  avoir(id: string): Promise<{ id: string; numero: string }>;
  synthese(cabinetTenantId: string, mois: string): Promise<SyntheseHonoraires>;
}

/* ============================================================================
 * Les signalements — ce que la personne envoie volontairement quand quelque
 * chose n'a pas marché. Un geste, avec où, sur quel appareil, quelle version ;
 * jamais une image, un montant, un texte de pièce.
 * ========================================================================= */

export interface SignalementSaisie {
  tenantId?: string | null;
  /** « coque-android/0.3.1 », « web/0.3.1 » — ce que la coque dit d'elle. */
  versionClient: string;
  /** Le navigateur ou l'appareil, tel qu'il se présente. */
  appareil?: string | null;
  /** L'écran d'où le signalement part. */
  ou?: string | null;
  message: string;
  pile?: string | null;
  pieceId?: string | null;
}

export interface SignalementsRepository {
  deposer(saisie: SignalementSaisie): Promise<{ id: string; creeLe: string }>;
}

/**
 * Le journal des pannes survenues sur l'appareil de quelqu'un.
 *
 * Il existe parce qu'une panne qu'on ne peut pas relire n'existe pas : le
 * 13 octobre 2026, « Generer le recu » ne faisait rien, et la raison etait
 * perdue deux fois — un message affiche hors ecran, et un journal qui ne
 * tourne qu'en developpement.
 *
 * On n'y verse QUE des pannes : l'endroit du code, le message, la pile, la
 * version et la plateforme. Aucune charge utile, aucune valeur de piece.
 */
export interface JournalRepository {
  /** Inscrire une panne. Rend l'identifiant de la trace. */
  consigner(input: {
    tenantId: string;
    ou: string;
    message: string;
    pile?: string | null;
    version?: string | null;
    plateforme?: string | null;
  }): Promise<string>;
  /** Les dernieres pannes d'un dossier, de la plus recente. */
  dernieres(tenantId: string, limite?: number): Promise<PanneConsignee[]>;
}

/** Une panne inscrite au journal. */
export interface PanneConsignee {
  id: string;
  /** L'endroit du code qui a signale, tel que l'application le nomme. */
  ou: string;
  message: string;
  version: string | null;
  plateforme: string | null;
  at: string;
}

/** Une ligne de l'ecriture d'un reglement, telle que le Socle la rend. */
export interface LigneDeReglementLue {
  account_code: string;
  libelle: string;
  debit: string;
  credit: string;
}

/**
 * Ce que le Socle propose pour un reglement, ou la raison de son refus.
 *
 * Le refus est une PHRASE, pas un silence : un reglement annule, un « pas
 * encore paye », une piece dont le sens n'est pas tranche. L'ecran la rend
 * telle quelle.
 */
export type PropositionDeReglement =
  | {
      ok: true;
      ecriture: {
        journal: string;
        dateEcriture: string;
        devise: string;
        libelle: string;
        lignes: LigneDeReglementLue[];
      };
    }
  | { ok: false; raison: string };

// ------------------------------------------------------------------ abonnement
/**
 * Le forfait de l'appelant, tel que `public.mon_forfait()` le rend.
 *
 * ==================================================== LES NOMS SONT CEUX DE LA BASE
 *
 * `snake_case`, et aucun renommage : le dépôt d'API relaie la fonction telle
 * quelle (R3), et renommer ici obligerait à traduire deux fois — une fois
 * dans un sens, une fois dans l'autre, avec un écart possible entre les deux.
 *
 * Les `numeric` de PostgreSQL arrivent en CHAÎNES : `prix_mensuel_ht` n'est
 * donc pas un nombre, et ne doit jamais en devenir un ici. Les entiers, eux,
 * peuvent arriver en chaînes selon le pilote — d'où `number | string | null`.
 *
 * `null` partout sauf les lectures : c'est ce que la base rend à un
 * collaborateur, qui ne détient pas la licence. Ce n'est pas une panne, et
 * l'écran doit le dire autrement qu'un zéro.
 */
export interface MonForfait {
  /** `basic` · `solo` · `team` · `premium` — un CODE, jamais traduit. */
  offre: string | null;
  statut: string | null;
  lectures_droit: number | string | null;
  lectures_consommees: number | string | null;
  lectures_restantes: number | string | null;
  organisations: number | string | null;
  sieges_occupes: number | string | null;
  sieges_inclus: number | string | null;
  sieges_max: number | string | null;
  prix_mensuel_ht: string | null;
}

/** Un siège occupé — une personne, sur une organisation de la licence. */
export interface SiegeDeLaLicence {
  user_id: string;
  nom: string | null;
  role: string;
  tenant_id: string;
  organisation: string;
}

/** Une organisation de la licence, et ce qu'elle a consommé ce mois-ci. */
export interface OrganisationDeLaLicence {
  tenant_id: string;
  nom: string;
  lectures_consommees: number | string | null;
}

/**
 * L'abonnement — lu, jamais calculé.
 *
 * Ce port existait côté API depuis le 18 octobre et nulle part côté
 * navigateur : trois écrans redéclaraient chacun son interface et son propre
 * `creerDepotHttp("facturation")`, hors du point de composition unique — donc
 * hors du garde-fou qui confronte les ports au contrat.
 *
 * Aucun plafond ne se décide ici (R3) : `inviterSiege` délègue à la base, qui
 * refuse la place de trop, et le motif revient en CODE.
 */
export interface FacturationRepository {
  /** `null` quand l'appelant n'est rattaché à aucune licence. */
  monForfait(): Promise<MonForfait | null>;
  sieges(): Promise<SiegeDeLaLicence[]>;
  organisations(): Promise<OrganisationDeLaLicence[]>;
  inviterSiege(
    email: string,
    tenantId: string,
  ): Promise<{ id: string; email: string; role: string; expiresAt: string; deja: boolean }>;
  /** `{ libere: false, motif }` tant qu'il reste des pièces à trancher. */
  libererPlace(
    tenantId: string,
    membre: string,
  ): Promise<{ libere: boolean; motif?: string; pieces: number }>;

  /** La grille en vigueur, et ce qui empêcherait d'y passer (un CODE). */
  mesOffres(tenantId?: string): Promise<OffreDeLaGrille[]>;
  /** Propriétaire principal seul ; un refus revient en `forfait_refuse:<code>:…`. */
  changerForfait(
    offre: string,
    tenantId?: string,
  ): Promise<{ change: boolean; paiement: PaiementEnLigne | null }>;

  paliersDeRecharge(): Promise<PalierDeRecharge[]>;
  mesRecharges(): Promise<RechargeDeLaLicence[]>;
  acheterRecharge(
    code: string,
    tenantId?: string,
  ): Promise<RechargeDeLaLicence & { paiement: PaiementEnLigne | null }>;

  /** Les paiements en ligne de la licence (montées, recharges), et leur état. */
  mesPaiements(): Promise<PaiementEnLigne[]>;
  /** `ouvert: false` : aucun prestataire dans cet environnement — l'offre reste ouverte. */
  payerEnLigne(
    paiementId: string,
  ): Promise<{ ouvert: boolean; lien: string | null; paiement: PaiementEnLigne }>;
  /** Le prestataire est interrogé ; ce que dit le navigateur ne compte pas. */
  verifierPaiement(paiementId: string): Promise<PaiementEnLigne>;
  /** Le simulateur du staging seulement ; refusé partout ailleurs. */
  simulerPaiement(paiementId: string, decision: "paye" | "refuse"): Promise<PaiementEnLigne>;
  maRechargeAutomatique(): Promise<RechargeAutomatique | null>;
  reglerRechargeAutomatique(
    active: boolean,
    code: string | null,
    plafondMoisHt: string | null,
    tenantId?: string,
  ): Promise<{ active: boolean; palier: string | null; plafond_mois_ht: string | null } | null>;

  /** Un propriétaire : un dirigeant de plus, sur une place payée. */
  inviterProprietaire(
    email: string,
    tenantId: string,
  ): Promise<{ id: string; email: string; role: string; expiresAt: string; deja: boolean }>;
  /** Le rôle de propriétaire principal passe à un propriétaire de la société. */
  transmettreLicence(tenantId: string, nouveau: string): Promise<{ licence: string | null }>;
}

/** Une offre de la grille, telle que `public.mes_offres()` la rend. */
export interface OffreDeLaGrille {
  code: string;
  libelle: string;
  rang: number;
  prix_mensuel_ht: string;
  lectures_par_organisation: number;
  /** Les lectures que l'offre garantit, sociétés incluses comprises. */
  lectures_incluses: number;
  sieges_inclus: number;
  /** `null` : sans plafond. */
  sieges_max: number | null;
  organisations_incluses: number;
  /** `null` : sans plafond. */
  organisations_max: number | null;
  courant: boolean;
  /** `null` quand rien n'empêche d'y passer ; sinon un CODE. */
  empechement: string | null;
  chiffres: Record<string, unknown> | null;
}

export interface PalierDeRecharge {
  code: string;
  libelle: string;
  prix_ht: string;
  lectures: number;
  validite_mois: number;
  rang: number;
}

export interface RechargeDeLaLicence {
  recharge_id: string;
  recharge_code: string;
  lectures: number;
  prix_ht: string;
  achetee_le: string;
  expire_le: string;
  origine: "achat" | "automatique" | "plateforme";
  restantes: number;
  utilisable: boolean;
  gelee: boolean;
  expiree: boolean;
}

/** Un paiement en ligne — une montée ou une recharge — tel que la base le rend. */
export interface PaiementEnLigne {
  paiement_id: string;
  objet: "montee" | "recharge";
  libelle: string;
  montant_ht: string;
  montant_tva: string;
  /** TVA comprise, sans timbre : le timbre est celui de la facture du mois. */
  montant_ttc: string;
  devise: string;
  etat: "a_payer" | "lien_cree" | "paye" | "refuse";
  prestataire: string | null;
  reference: string | null;
  lien: string | null;
  impute: boolean;
  cree_le: string;
}

/* ============================================================================
 * La tour — ce qu'un opérateur d'ALGORIA règle sans passer par le serveur.
 * Chaque méthode est refusée par la base à qui n'est pas opérateur.
 * ========================================================================== */

/** Une ligne de grille proposée ou en vigueur : les colonnes de `ref.offres`. */
export type LigneDOffre = Record<string, string | number | boolean | null> & {
  code: string;
  rang: number;
};
/** Un palier de recharge proposé ou en vigueur : les colonnes de `ref.recharges`. */
export type LigneDeRecharge = Record<string, string | number | boolean | null> & {
  code: string;
  rang: number;
};

export interface GrilleProposee {
  effective_from: string;
  offres: LigneDOffre[];
  recharges: LigneDeRecharge[];
}

export interface ReglagePaiementDeLaTour {
  prestataire: "aucun" | "simulateur" | "clictopay";
  url_api: string | null;
  url_retour: string | null;
  decide_le: string | null;
  /** Les secrets du compte marchand sont-ils posés sur le serveur ? Jamais leur valeur. */
  secrets_clictopay: boolean;
}

export interface OrganisationEmettrice {
  organisation_id: string;
  nom: string;
  matricule: string | null;
  juridiction: string;
  devise: string;
  valide_des?: string;
}

export interface LicenceVueDeLaTour {
  licence_id: string;
  offre_code: string;
  statut: string;
  organisations: number;
  sieges_occupes: number;
  lectures_droit: number;
  lectures_consommees: number;
  recharges_disponibles: number;
  recharges_gelees: number;
  recharge_automatique: boolean | null;
  prix_mensuel_ht: string;
  societes: string | null;
}

export interface TourRepository {
  suisJePlateforme(): Promise<boolean>;
  grilleEnVigueur(): Promise<GrilleProposee | null>;
  trousDeLaGrille(
    effectiveFrom: string,
    offres: LigneDOffre[],
    recharges: LigneDeRecharge[],
  ): Promise<Array<{ code: string; detail: string }>>;
  publierGrille(
    effectiveFrom: string,
    offres: LigneDOffre[],
    recharges: LigneDeRecharge[],
    motif: string,
  ): Promise<unknown>;
  licences(): Promise<LicenceVueDeLaTour[]>;
  reglagePaiement(): Promise<ReglagePaiementDeLaTour>;
  reglerPaiement(
    prestataire: "aucun" | "simulateur" | "clictopay",
    urlApi: string | null,
    urlRetour: string | null,
    motif: string,
  ): Promise<unknown>;
  emetteur(): Promise<OrganisationEmettrice | null>;
  chercherOrganisations(texte: string): Promise<OrganisationEmettrice[]>;
  designerEmetteur(organisationId: string, valideDes: string): Promise<unknown>;
}

export interface RechargeAutomatique {
  active: boolean;
  recharge_code: string | null;
  plafond_mois_ht: string | null;
  decide_le: string;
}

/* ============================================================================
 * La fabrique de lecteurs — ce que les écrans lisent d'elle, et rien de plus.
 *
 * ============================================================== POURQUOI
 *
 * La fabrique tourne de bout en bout côté serveur depuis le 20 octobre 2026,
 * et aucun écran ne la montrait. Ce port est la frontière de ce que les
 * écrans en voient, et il se limite STRICTEMENT aux méthodes que
 * `contrat/rpc.json` sert sous le dépôt « fabrique » : une méthode de plus
 * ici, et `verticals/malica-office/__tests__/contrat.test.ts` échoue avant
 * l'usage.
 *
 * ======================================================= CE QU'IL N'EXPOSE PAS
 *
 * Aucun réglage de signature, aucune borne, aucun seuil de promotion. Un écran
 * qui les afficherait ferait croire qu'il les arrête — or c'est le référentiel
 * qui les arrête (R4, R10).
 *
 * Et pas `contexteDeDesignation` : cette méthode-là est sur le chemin de la
 * désignation, elle ne rend que les deux états qui tournent, et un écran bâti
 * dessus perd une recette au moment précis où elle vient d'être suspendue.
 * `recettes` est la lecture du REGARD, et les deux ne se confondent pas.
 * ========================================================================= */

/** Les états du cycle de vie d'une recette. Ce sont ceux de `fabrique.etat_t`. */
export type EtatDUneRecette =
  "candidate" | "evaluee" | "observation" | "active" | "suspendue" | "retiree";

/**
 * Une version de recette, dans l'état où elle est.
 *
 * ========================================== POURQUOI PAS `contexteDeDesignation`
 *
 * Celle-là est sur le chemin de la DÉSIGNATION et ne rend que `observation` et
 * `active` — c'est ce qui fait qu'une suspension suffit à renvoyer la pièce
 * suivante vers le modèle. Un écran qui s'en servirait pour montrer la
 * fabrique PERDRAIT la recette au moment où elle vient d'être suspendue :
 * l'expert voit le verdict une fois, puis la carte s'en va.
 *
 * `etat` peut être `null` : une version sans décision inscrite n'a pas d'état,
 * et cela ne se lit pas « candidate ». Une recette en observation s'exécute,
 * on compare, ON NE LA CROIT PAS — l'écran ne la montre donc pas comme une
 * recette en service.
 */
export interface RecetteDeLaFabrique {
  versionId: string;
  recetteId: string;
  /** Le numéro de version. Corriger une recette, c'est en inscrire une autre. */
  rang: number;
  libelle: string;
  /** La signature structurelle du format que cette recette lit. */
  signatureCle: string;
  portee: "organisation" | "mutualisee";
  etat: EtatDUneRecette | null;
  /** Le motif de la dernière décision, tel que celui qui l'a prise l'a écrit. */
  motif: string | null;
  decideLe: string | null;
  /** Combien d'exemples d'apprentissage cette version porte. */
  exemples: number;
  /** Combien de champs elle désigne. `null` si la définition n'en déclare pas. */
  champs: number | null;
}

/** Une décision inscrite sur une version. Elles se lisent toutes, jamais la seule dernière. */
export interface DecisionInscrite {
  etat: EtatDUneRecette;
  motif: string;
  evaluationId: string | null;
  decideLe: string;
}

/** Une dérive constatée. Elle SURVIT à la suspension qu'elle a provoquée. */
export interface DeriveConstatee {
  versionId: string;
  libelle: string;
  rang: number;
  pieceId: string | null;
  nature:
    "abstention_en_hausse" | "montant_faux_accepte" | "correction_humaine" | "signature_changee";
  mesure: unknown;
  constateeLe: string;
}

/** Un exemple qualifié, tel qu'il se lit un par un. Il ne porte AUCUNE valeur (R2). */
export interface ExempleQualifieLu {
  exempleId: string;
  pieceId: string;
  provenance: "validation_humaine" | "correction_humaine" | "import_expert" | "observation";
  qualification:
    | "reconnaissance_ocr"
    | "designation_champ"
    | "normalisation"
    | "document_incomplet"
    | "decision_comptable";
  usage: "apprentissage" | "evaluation";
  /** Calculée en base : une décision comptable ne nourrit aucune recette. */
  nourritUneRecette: boolean;
  /** Combien de champs cet exemple désigne — des `page`/`ordinal`, jamais un montant. */
  champs: number | null;
  note: string | null;
  qualifieLe: string;
}

/**
 * Un format connu du dossier, et ce qui lui manque.
 *
 * `manque` vient du SERVEUR, et c'est voulu : le minimum d'exemples est une
 * borne de forme — à un seul exemple l'ossature commune n'existe pas — et la
 * recopier à l'écran en ferait une seconde vérité. L'écran restitue un compte,
 * il ne le calcule pas.
 */
export interface FormatConnuDuDossier {
  signatureCle: string;
  recetteId: string | null;
  libelle: string | null;
  portee: "organisation" | "mutualisee" | null;
  apprentissage: number;
  evaluation: number;
  manque: number;
  exemples: ExempleQualifieLu[];
}

/** Une pièce qu'une RECETTE a lue — donc sans score, et sans pourcentage à lire. */
export interface PieceLueParRecette {
  pieceId: string;
  versionId: string;
  libelle: string;
  rang: number;
  executeeLe: string;
}

/**
 * Ce qu'une évaluation a mesuré.
 *
 * `mesures` ne porte QUE ce qui a pu être calculé ; `absentes` nomme une par
 * une celles dont le dénominateur était nul, avec la raison en clair. Les
 * deux ensembles sont disjoints, et c'est la seule façon de ne pas confondre
 * « zéro montant faux » avec « aucun montant observé ».
 */
export interface EvaluationDUneVersion {
  evaluationId: string;
  mesures: Record<string, number>;
  absentes: string[];
  exemplesComptes: number;
  ecarts: Array<{ pieceId: string; champ: string; quoi: string; detail: string }>;
  /** Pourquoi cette évaluation ne suffit pas à activer — ou `null`. */
  reserve: string | null;
}

/** Ce qu'une surveillance a constaté depuis la dernière décision. */
export interface SurveillanceDUneVersion {
  etatAvant: EtatDUneRecette | null;
  executions: number;
  abstentions: number;
  /** `null` quand rien ne s'est exécuté : un taux sur zéro n'est pas un taux. */
  tauxAbstention: number | null;
  tolere: number | null;
  derive: "abstention_en_hausse" | "signature_changee" | null;
  suspendue: boolean;
}

/** Une décision à inscrire. La base tient la transition, le seuil et le droit. */
export interface DecisionAInscrire {
  tenantId: string;
  recetteVersionId: string;
  etat: EtatDUneRecette;
  evaluationId?: string;
  motif: string;
}

/** Les états que la file durable DÉRIVE du dernier fait inscrit sur un travail. */
export type EtatDUnTravail =
  "a_faire" | "en_cours" | "abandonne" | "en_panne" | "epuise" | "termine" | "refuse" | "en_erreur";

/**
 * Où en est la lecture d'une pièce — DANS LA BASE, pas dans la mémoire d'un
 * processus.
 *
 * C'est ce qui sépare « le serveur ne lit plus cette pièce » de « cette pièce
 * est lue ». Les deux se ressemblent quand on interroge la mémoire d'un
 * processus qui a redémarré, et l'écran de capture cochait la seconde en
 * ayant constaté la première.
 */
export interface TravailDeLecture {
  travailId: string;
  pieceId: string;
  nature: string;
  etat: EtatDUnTravail;
  tentatives: number;
  dernierFait: string | null;
  dernierMotif: string | null;
  dernierLe: string | null;
  prenable: boolean;
  prenableA: string | null;
}

export interface FabriqueRepository {
  /** TOUTES les recettes du dossier, dans tous leurs états — une suspendue reste visible. */
  recettes(tenantId: string): Promise<RecetteDeLaFabrique[]>;
  /** Toutes les décisions prises sur une version, la dernière en tête. */
  decisions(recetteVersionId: string): Promise<DecisionInscrite[]>;
  /** Les dérives constatées sur le dossier, la plus récente en tête. */
  derives(tenantId: string): Promise<DeriveConstatee[]>;
  /** Les formats du dossier, leurs exemples un par un, et ce qui leur manque. */
  signatures(
    tenantId: string,
  ): Promise<{ minimumPourUneOssature: number; formats: FormatConnuDuDossier[] }>;
  /** Parmi ces pièces, celles qu'une recette a lues. Les autres ont été lues par le modèle. */
  piecesLuesParRecette(pieceIds: string[]): Promise<PieceLueParRecette[]>;
  /** `null` quand le travail n'existe pas, ou que la RLS ne le montre pas. */
  etatDeLaLecture(travailId: string): Promise<TravailDeLecture | null>;
  evaluerUneVersion(tenantId: string, recetteVersionId: string): Promise<EvaluationDUneVersion>;
  /** Le droit de décider est tenu par la base : l'écran propose, elle refuse. */
  promouvoir(decision: DecisionAInscrire): Promise<void>;
  surveillerUneVersion(
    tenantId: string,
    recetteVersionId: string,
  ): Promise<SurveillanceDUneVersion>;
}
