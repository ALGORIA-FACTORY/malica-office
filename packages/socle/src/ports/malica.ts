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
    /**
     * Les valeurs RETENUES ne vérifient pas une équation de la facture.
     *
     * Posé le 5 octobre 2026, après qu'un montant coupé par l'espace des
     * milliers soit sorti en production sans aucun avertissement. Un montant
     * tronqué n'est pas ambigu — « 2 » a une lecture unique — donc il
     * franchissait tous les drapeaux, qui visaient tous l'ambiguïté. Celui-ci
     * ne juge pas la lecture d'un champ : il juge si la facture BOUCLE.
     */
    | "ARITHMETIQUE_INCOHERENTE"
    /**
     * Le montant cité a un voisin COLLÉ qui lui manque : il est amputé.
     *
     * Posé le 18 octobre 2026. Une facture arabe lue par la chaîne réelle est
     * sortie `extract.v1` VALIDE avec 650,000 D là où le papier porte
     * 5 650,000 D — le désignateur n'ayant cité que le second jeton de la
     * paire, sur les trois totaux à la fois. 650 000 + 73 500 + 1 000 =
     * 724 500 au millime : une amputation SYSTÉMATIQUE passe toutes les
     * équations, donc `ARITHMETIQUE_INCOHERENTE` ne pouvait rien y voir. Et
     * « 650,000 » n'est pas ambigu non plus — il a une lecture unique — donc
     * `SEPARATEUR_AMBIGU` non plus.
     *
     * Ce drapeau ne juge ni la lecture ni l'équation : il juge la PLAGE
     * citée, contre la contiguïté du plan de jetons. Il rend le montant
     * `null`, donc la pièce est partielle et rien ne peut s'écrire.
     */
    | "MONTANT_PEUT_ETRE_AMPUTE"
    /**
     * Plusieurs jetons satisfont la règle, et rien ne les départage.
     *
     * Posé le 18 octobre 2026, avec la fabrique de lecteurs. Un lecteur
     * spécialisé désigne par une règle, pas par un jugement : quand deux jetons
     * répondent également à cette règle, il n'a aucun moyen de choisir, et
     * choisir quand même serait un tirage au sort présenté comme une lecture.
     *
     * Aucun drapeau existant ne disait cela. `TOKEN_NOT_FOUND` dit le
     * CONTRAIRE de ce qui s'est passé — il y en avait trop, pas zéro — et
     * `SEPARATEUR_AMBIGU` juge la lecture d'un texte, pas le choix d'un jeton.
     * Les écrire l'un pour l'autre rendait « aucun candidat » et « deux
     * candidats » indiscernables au tableau de mesures, alors que le premier
     * dit qu'un format a changé et le second qu'une règle est trop large.
     *
     * C'est le signal de DÉRIVE d'une recette : il doit pouvoir la suspendre.
     */
    | "DESIGNATION_AMBIGUE"
    /**
     * Le sens de la pièce — achat ou vente — ne se tranche pas sans risque.
     *
     * Posé le 5 octobre 2026. Un modèle avait rendu « vente » sur un achat,
     * avec les deux matricules inversés : faux, et cohérent dans son inversion,
     * donc invisible au contrôle du destinataire. Le sens se déduit désormais de
     * la position du matricule du dossier, et ce drapeau porte les cas où la
     * déduction refuse de choisir.
     */
    | "SENS_A_CONFIRMER"
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
  /** Le verdict de la pièce, jugée après la lecture (3B). Facultatif : absent avant le 18 sept. 2026. */
  verdict?: string;
  /** Chaque organe de la lecture, journalisé ou non (et pourquoi). */
  journal?: Array<{ agent: string; model: string; journalise: boolean; raison?: string }>;
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
