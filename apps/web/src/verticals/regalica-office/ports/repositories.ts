/**
 * Ports du domaine. Les écrans ne connaissent que ce vocabulaire :
 * aucune requête, aucun nom de table, aucun SQL au-delà de cette frontière.
 */

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

export interface IdentityRepository {
  listMyOrganizations(): Promise<Array<Organization & { role: string }>>;
  listEntities(tenantId: string): Promise<Entity[]>;
  createOrganization(input: NewOrganization): Promise<string>;
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
  taxRates(packId: string, jurisdiction: string): Promise<TaxRate[]>;
  accountMappings(packId: string): Promise<AccountMapping[]>;
  /** Droits et taxes hors TVA du pack (droit de timbre…). */
  fiscalCharges(packId: string): Promise<FiscalCharge[]>;
  /** Paramètres du Socle (décimales, méthode de stock, tolérances) lus au pack. */
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
  /** officiel = verbatim NC 01 ; extension = ouverte par Regalica ; cabinet = la vôtre. */
  origine: "officiel" | "extension" | "cabinet";
  officiel: boolean;
  /** Un compte collectif reçoit des tiers, jamais des sous-comptes. */
  collectif: boolean;
  source: string | null;
}

export interface ParametrageRepository {
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
  vis: "personnel" | "partage";
  storagePath: string;
  createdAt: string;
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
  citations: Citation[];
  tokens: Token[];
}

export interface NewPiece {
  tenantId: string;
  entityId: string | null;
  file: Blob;
  fileName: string;
  source: "photo" | "pdf";
  vis: "personnel" | "partage";
  idempotencyKey: string;
}

export interface CaptureRepository {
  register(input: NewPiece): Promise<string>;
  list(tenantId: string): Promise<Piece[]>;
  dossier(pieceId: string): Promise<PieceDossier>;
  read(pieceId: string): Promise<{ contract: string; citations: number; valid: boolean }>;
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

export interface OfficeRepository {
  propose(input: ProposedEcriture): Promise<string>;
  book(ecritureId: string): Promise<void>;
  ecrituresForPiece(pieceId: string): Promise<Ecriture[]>;
  ecrituresByIds(ids: string[]): Promise<Ecriture[]>;
  bookedExtracts(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<Array<{ pieceId: string; extract: unknown }>>;
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
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string | null;
  at: string;
  motifId: string | null;
  payload: unknown;
}

export interface SupervisionRepository {
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
export type Visibility = "personnel" | "partage";

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

export interface PvReunion {
  id: string;
  clientTenantId: string | null;
  at: string;
  titre: string;
  participants: string | null;
  ordreDuJour: string | null;
  decisions: string | null;
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
  kind: string;
  label: string;
  period: string | null;
  dueDate: string;
  status: string;
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
  stats(tenantIds: string[]): Promise<ClientStats[]>;
  notifications(tenantIds: string[]): Promise<Notification[]>;
  markRead(id: string): Promise<void>;
  echeances(tenantIds: string[]): Promise<Echeance[]>;
  /** Mur de visibilité (R6) : bascule journalisée, refusée après comptabilisation. */
  setPieceVis(pieceId: string, vis: Visibility): Promise<boolean>;
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
}

export interface ChargesRepository {
  familles(packId: string): Promise<ChargeFamille[]>;
  anomalyThreshold(packId: string, code: string): Promise<AnomalyThresholdRow | null>;
  articles(tenantId: string, fromPeriod: string, toPeriod: string): Promise<PieceArticle[]>;
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
