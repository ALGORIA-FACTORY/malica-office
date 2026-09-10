/**
 * Le port de Malica — la couche agentique, vue par les écrans.
 *
 * ============================================================== POURQUOI
 *
 * R3 : Malica appelle, ne calcule pas. Tout ce qui passe par ce port fait
 * parler un modèle — l'œil qui relève une pièce, le désignateur qui choisit
 * des tokens, le raisonneur qui répond, la rédaction d'un PV. Ces gestes
 * vivent dans l'API, où sont les clés, et non dans `/rpc` : un appel de
 * modèle dure des secondes ou des minutes, et `/rpc` s'exécute dans une
 * transaction que la base coupe après dix secondes d'inactivité.
 *
 * Ce fichier ne porte que des types. Les valeurs qu'ils décrivent viennent
 * des moteurs du Socle ou des tokens relus dans le plan — jamais d'un modèle
 * seul (R2).
 */
import type { Locale } from "../messages.ts";
import type { PvReunion, SourceCitee } from "./repositories.ts";

/* ------------------------------------------------------------- le relevé */

export interface PageToken {
  page: number;
  ordinal: number;
  text: string;
  /** Coordonnées normalisées 0..1 dans la page. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence?: number | null;
}

export interface TokenRef {
  page: number;
  ordinal: number;
  /**
   * Fin de plage, pour un champ textuel porté par plusieurs tokens contigus
   * (« DREAM OPTIC SARL »). La valeur reste relue dans le plan : on ne fait que
   * concaténer des tokens existants, jamais compléter un mot absent.
   */
  ordinalEnd?: number;
}

export interface FieldCitation extends TokenRef {
  field: string;
  zone?: string | null;
  /**
   * Champ confié à l'interface : sans ambiguïté, la citation dit quelle valeur
   * l'écran affiche et à quel titre. La relecture d'un audit n'a plus à deviner
   * quel libellé portait ce token.
   */
  ui_field?: string | null;
  ui_role?: "montant" | "texte" | "date" | null;
  /** Coordonnées normalisées du token cité, telles que surlignées par l'UI. */
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface ReadFlag {
  field: string;
  code:
    | "MISSING_CITATION"
    | "TOKEN_NOT_FOUND"
    | "VALUE_NOT_A_NUMBER"
    /** Le texte porte plusieurs lectures admissibles et rien ne les départage. */
    | "SEPARATEUR_AMBIGU"
    /** Le texte était ambigu ; l’arithmétique de la facture a tranché. */
    | "DECIDE_PAR_ARITHMETIQUE"
    | "DATE_UNREADABLE"
    | "DERIVED_BY_SOCLE";
  detail?: string;
}

/* ------------------------------------------------------ lire une pièce */

export interface LectureDePiece {
  pieceId: string;
  contract: string;
  citations: number;
  flags: Array<{ field: string; code: string; detail?: string }>;
  valid: boolean;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface EtatDeLecture {
  enCours: boolean;
  depuisMs: number | null;
}

/* --------------------------------------------- lire la carte fiscale */

/**
 * Ce que la carte dit — ou ne dit pas. Chaque champ peut être nul : un
 * champ absent est une information, pas un trou à combler.
 */
export interface CarteLue {
  contract: string;
  raison_sociale: string | null;
  matricule_fiscal: string | null;
  adresse: string | null;
  activite: string | null;
  debut_activite: string | null;
  etablissement: string | null;
  regime_imposition: string | null;
  regime_tva: string | null;
  cloture_exercice: string | null;
  field_confidence: Record<string, number>;
}

export interface LectureDeCarte {
  contract: string;
  carte: CarteLue;
  citations: FieldCitation[];
  flags: ReadFlag[];
  valid: boolean;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

/* ------------------------------------------------------- les contrôles */

export type Suite = "retirer" | "completer" | "signaler";

export interface Verdict {
  /** Le contrôle qui a cédé. Sert de clé de comptage dans la banque de cas. */
  code:
    | "article_non_fourni"
    | "edition_perimee"
    | "edition_plus_recente"
    | "statut_non_en_vigueur"
    | "portee_non_dite"
    | "chiffre_sans_source"
    | "lecture_incertaine";
  suite: Suite;
  /** Ce qu'on a trouvé, en clair. Va au journal, et au cabinet. */
  detail: string;
}

/* ------------------------------------------------- demander à Malica */

export interface QuestionAMalica {
  tenantId: string;
  pieceId?: string | null;
  question: string;
  locale: Locale;
  mode?: "reasoner" | "chat";
  /**
   * Le fil où ranger l'échange. Absent : Malica en ouvre un neuf et rend
   * son identifiant. L'historique se relit en base à partir de cet
   * identifiant, et la RLS décide de ce que la personne a le droit d'y relire.
   */
  conversationId?: string | null;
}

export interface ReponseDeMalica {
  answer: string;
  reasoning: string | null;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  runId: string | null;
  /** Le fil où cet échange a été rangé — neuf ou repris. */
  conversationId: string;
  /** L'identifiant du message rangé — ce que le cabinet juge. */
  messageId: string | null;
  /**
   * Ce que les contrôles ont trouvé. Le client n'en voit rien ; le cabinet
   * voit les « signaler », qui portent sur NOTRE corpus et non sur sa réponse.
   */
  controles: Verdict[];
  /** Son titre, si Malica vient de le nommer. */
  titre: string | null;
  /**
   * La réponse a-t-elle été retenue pour le cabinet ? Alors `answer` est la
   * phrase qui le dit au client, pas la réponse elle-même.
   */
  retenue: boolean;
  /** Ce que la question était, vue par Malica : conseil ou lecture du dossier. */
  conseil: {
    conseil: boolean;
    theme: string | null;
    certitude: number;
    sources: SourceCitee[];
    doute: string | null;
  } | null;
}

/* ------------------------------------------- répondre à l'expert-comptable */

/** Une source de la réponse à l'expert, avec de quoi la nommer et la peser. */
export interface SourceDuCorpus extends SourceCitee {
  nom: string | null;
  nature: string | null;
  statut: string | null;
}

export interface ReponseAuCabinet {
  reponse: string;
  certitude: number;
  theme: string | null;
  sources: SourceDuCorpus[];
  doute: string | null;
  /** Ce que les contrôles signalent sur NOTRE corpus — l'expert le voit. */
  signale: string[];
  model: string;
  latencyMs: number;
}

/* --------------------------------------------------------- rédiger */

export interface Fait {
  /** Ce que le nombre mesure, dans la langue de la personne. */
  label: string;
  /** La valeur, telle que le moteur l'a rendue (montant, date, compte). */
  valeur: string;
  /** Le moteur qui l'a produite — la citation du texte. */
  source: string;
}

export interface Briefing {
  texte: string;
  faits: Fait[];
}

export type RaisonDEchec = "introuvable" | "envoye" | "sans_client" | "refuse" | "indisponible";

export type ResultatRedaction =
  { ok: true; pv: PvReunion } | { ok: false; raison: RaisonDEchec; pv: PvReunion | null };

/* ------------------------------------------------------------- le port */

export interface MalicaPort {
  /**
   * Lire une pièce — ou rejoindre la lecture qui tourne déjà pour elle. La
   * requête peut mourir en route ; la lecture, non : un second appel attend
   * le même résultat.
   */
  lirePiece(pieceId: string): Promise<LectureDePiece>;
  /**
   * Une lecture est-elle en cours pour cette pièce ? Sert à l'écran qui
   * revient après une coupure : attendre, plutôt qu'annoncer une panne ou
   * relancer la lecture.
   */
  etatDeLecture(pieceId: string): Promise<EtatDeLecture>;
  /**
   * Lancer la lecture sans l'attendre : ce que la file hors ligne demande
   * après avoir déposé les octets. Le dossier dira quand c'est lu.
   */
  demanderLaLecture(pieceId: string): Promise<void>;
  /** L'œil lit la carte d'identification fiscale ; l'écran propose, l'expert arrête (R10). */
  lireCarte(input: { jurisdiction: string; fichier: Blob }): Promise<LectureDeCarte>;
  demander(question: QuestionAMalica): Promise<ReponseDeMalica>;
  /** La question libre de l'expert au corpus — même moteur, sans dossier ni arbitrage. */
  repondreAuCabinet(input: {
    tenantId: string;
    question: string;
    locale: Locale;
  }): Promise<ReponseAuCabinet>;
  redigerLePv(input: { pvId: string; locale: Locale }): Promise<ResultatRedaction>;
  /** Le briefing de transfert d'un dossier, depuis les faits que les moteurs rendent. */
  redigerLeBriefing(input: {
    cabinetId: string;
    clientId: string;
    collaborateur: string;
    langue: string;
  }): Promise<Briefing>;
}
