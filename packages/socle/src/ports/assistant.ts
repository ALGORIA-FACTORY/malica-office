/**
 * « Parler à Malica » — ce que l'assistant envoie à l'écran, événement par
 * événement.
 *
 * ================================================================ LE FLUX
 *
 * La route `POST /malica/assistant` répond en `text/event-stream`. Chaque
 * événement est l'un de ceux-ci, sérialisé en JSON sous son nom :
 *
 *   debut        le fil est ouvert
 *   texte        un morceau de la réponse, DÉJÀ GARDÉ : une phrase qui porte un
 *                chiffre ne part qu'une fois sa source établie (voir `retire`)
 *   outil        Malica consulte le dossier : une étape dite en première
 *                personne, traduite par le serveur (« Je regarde vos pièces… »)
 *   retire       des phrases chiffrées sans source ont été retirées — jamais
 *                montrées : seul leur nombre part
 *   proposition  une action qui MODIFIE le dossier, proposée, jamais exécutée :
 *                l'écran montre un bouton, la personne confirme
 *   fin          la réponse entière, ses sources, ses suggestions
 *   erreur       un code que l'écran traduit
 *
 * ============================================================ CE QUI NE PART PAS
 *
 * Rien de la mécanique : ni modèle, ni fournisseur, ni jetons, ni coût, ni
 * durée, ni cache, ni nom d'outil, ni motif de repli, ni identifiant interne
 * autre que ceux du fil et des objets que l'écran ouvre. La mesure d'une
 * réponse reste au serveur, dans le journal des coûts (décision du dirigeant).
 *
 * Quand la réponse doit être relue par le cabinet (une PME sous mandat, une
 * question de conseil qui engage son dossier), RIEN n'en est diffusé : le
 * serveur la retient jusqu'à la conclusion du modèle, ne montre que le message
 * de relecture, et remet la réponse à la file du cabinet.
 *
 * Le Socle ne fait que déclarer ces formes (R1) : l'API les produit, l'écran
 * les lit, et les deux compilent contre la même définition.
 */

/** Une source que l'écran sait ouvrir : une pièce, un article, une échéance… */
export interface SourceDeLAssistant {
  /** La clé stable remise au modèle (`malica:piece:<uuid>`). */
  cle: string;
  genre:
    | "piece"
    | "liste"
    | "tva"
    | "echeance"
    | "ecriture"
    | "tiers"
    | "article"
    | "parametre"
    | "calcul"
    | "question";
  titre: string;
  /** L'identifiant de l'objet ouvert par un clic (pièce, écriture) ; `null` sinon. */
  objetId: string | null;
  /** Pour un article : le texte, l'article et sa version. */
  article?: { corpus: string; numero: string | null; validFrom: string | null } | null;
  /** Pour un article ou un paramètre : le passage remis au modèle, que l'écran déplie. */
  extrait?: string;
}

/** Une action que Malica propose et que seule la personne peut exécuter. */
export interface PropositionDAction {
  id: string;
  action: "envoyer_au_cabinet" | "valider_ecriture";
  pieceId: string;
  /** Ce que la pièce est, en clair (émetteur, date) : la personne sait ce qu'elle confirme. */
  libelle: string;
  /** Pourquoi Malica le propose, dans ses mots. */
  raison: string;
}

/** Une suggestion de suite : une question que la personne peut poser d'un tap. */
export interface SuggestionDeSuite {
  texte: string;
}

/**
 * Un bloc de réponse : une forme que la bulle de Malica sait dessiner, au-delà
 * du texte. Les valeurs viennent d'un MOTEUR ou de la base, composées par le
 * serveur (R3) : le modèle choisit de montrer un bloc, il n'en écrit jamais un
 * chiffre. Ce que le navigateur reçoit est déjà formaté (séparateurs, décimales
 * de la devise) et déjà traduit : l'écran ne calcule rien.
 */
export interface EnTeteDeBloc {
  titre: string;
  /** La période que le bloc couvre, déjà écrite (« Novembre 2026 »). */
  periode: string | null;
  /** Le périmètre : la société, ou « 3 sociétés ». */
  perimetre: string | null;
  /** Ce d'où viennent les chiffres, en clair (« calcul de la TVA, 1 pièce transmise »). */
  source: string;
  /**
   * Où Malica a montré le bloc : le nombre de caractères de sa réponse déjà
   * écrits à ce moment. L'écran le pose là, entre deux paragraphes. Absent
   * (réponse ancienne) : après le texte.
   */
  apres?: number;
  /**
   * Le bloc en lignes et en colonnes, pour l'exporter (Excel, PDF) : les
   * montants y sont en chaînes décimales brutes, pas formatées — un tableur
   * doit pouvoir les additionner.
   */
  feuille?: FeuilleDeBloc;
}

/** Une cellule exportable : du texte, ou un montant en chaîne décimale. */
export type CelluleDeFeuille = { texte: string } | { montant: string };

export interface FeuilleDeBloc {
  entete: string[];
  lignes: CelluleDeFeuille[][];
  totaux?: CelluleDeFeuille[][];
}

export type TonDeBloc = "positif" | "negatif" | "neutre";

export interface ChiffreDeBloc {
  libelle: string;
  valeur: string;
  unite: string | null;
  ton: TonDeBloc;
}

/** Une pièce derrière un chiffre : ce qu'un clic ouvre. */
export interface PieceDUnChiffre {
  id: string;
  /** Ce que la pièce est, en clair : sa date et son montant, déjà écrits. */
  titre: string;
}

/** Un point d'un graphique : son étiquette, sa valeur écrite, et sa hauteur. */
export interface PointDeGraphique {
  etiquette: string;
  /** La valeur, déjà formatée ; `null` quand la période n'a rien. */
  valeur: string | null;
  /**
   * La hauteur du point, de 0 à 1, rapportée au plus grand point du graphique :
   * le serveur la calcule, l'écran la dessine sans relire aucun montant.
   */
  part: number;
}

export type BlocDeReponse =
  | (EnTeteDeBloc & {
      type: "reponse_cle";
      /** Le chiffre qui répond, en grand ; les autres, dessous, le composent. */
      cle: ChiffreDeBloc;
      details: ChiffreDeBloc[];
    })
  | (EnTeteDeBloc & {
      type: "tableau";
      colonnes: Array<{ id: string; libelle: string; numerique: boolean }>;
      lignes: Array<Record<string, string>>;
      /** La ligne de total, quand le tableau en a une. */
      total: Record<string, string> | null;
      /**
       * Pour chaque colonne qui se trie : les lignes dans l'ordre croissant (par
       * leur indice). L'écran réordonne, il ne compare aucune valeur lui-même —
       * « 1 090,504 » ne se trie pas comme un texte. Absent : pas de tri.
       */
      ordres?: Record<string, number[]>;
      /**
       * Les pièces derrière chaque ligne, alignées sur `lignes` : un clic sur la
       * ligne les déplie. `null` pour une ligne sans pièce à ouvrir.
       */
      pieces?: Array<PieceDUnChiffre[] | null>;
    })
  | (EnTeteDeBloc & {
      type: "graphique";
      /** Des barres groupées par période, ou une courbe quand les périodes sont nombreuses. */
      forme: "barres" | "courbe";
      /** L'unité des valeurs (la devise), dite une fois. */
      unite: string | null;
      series: Array<{ nom: string; ton: TonDeBloc; points: PointDeGraphique[] }>;
    })
  | (EnTeteDeBloc & {
      /**
       * Une carte de chaleur : des lignes (les sociétés), des colonnes (les mois).
       * La teinte de chaque case est sa `part`, de 0 à 1, rapportée à la plus
       * forte case de la carte ; une case sans valeur reste vide.
       */
      type: "carte";
      unite: string | null;
      colonnes: string[];
      lignes: Array<{
        libelle: string;
        cellules: Array<{ valeur: string | null; part: number }>;
        /** Le total de la ligne, déjà écrit. */
        total: string;
      }>;
    })
  | (EnTeteDeBloc & {
      /** De ce qui entre à ce qui reste : chaque étape part d'où la précédente s'arrête. */
      type: "cascade";
      unite: string | null;
      etapes: Array<{
        libelle: string;
        valeur: string;
        ton: TonDeBloc;
        /** Où la barre commence et finit, de 0 à 1 : le serveur les calcule. */
        debut: number;
        fin: number;
      }>;
    });

export interface FinDeLaReponse {
  conversationId: string;
  messageId: string | null;
  titre: string | null;
  reponse: string;
  sources: SourceDeLAssistant[];
  propositions: PropositionDAction[];
  suggestions: SuggestionDeSuite[];
  /** Les blocs que la réponse montrait (chiffre clé, tableau, graphique), rangés avec elle. */
  blocs: BlocDeReponse[];
  /** Le nombre de phrases retirées faute de source : jamais montrées, comptées. */
  chiffresRetires: number;
  /** Le modèle de secours a répondu : sa réponse ne porte pas de citations. */
  sansCitations: boolean;
}

export type EvenementDeLAssistant =
  | { type: "debut"; conversationId: string }
  | { type: "texte"; texte: string }
  /** L'étape, déjà traduite ; un outil inconnu n'en a pas, et rien ne part. */
  | { type: "outil"; etiquette: string; etat: "debut" | "fin" }
  | { type: "retire"; nombre: number }
  | { type: "proposition"; proposition: PropositionDAction }
  /** Un bloc entier, composé par le serveur : jamais un morceau. */
  | { type: "bloc"; bloc: BlocDeReponse }
  | { type: "fin"; fin: FinDeLaReponse }
  | { type: "erreur"; erreur: string };

/** Ce que l'écran envoie. Le fil voyage par son identifiant, jamais par son contenu. */
export interface QuestionALAssistant {
  tenantId: string;
  question: string;
  locale: "fr" | "en" | "ar";
  conversationId: string | null;
  /** Les pièces jointes, DÉJÀ déposées et confiées à la lecture Malica (R2). */
  pieceIds: string[];
  /**
   * La personne regarde « Toutes les sociétés » : Malica peut alors comparer
   * SES sociétés. Le serveur décide lesquelles — celles dont elle est membre —,
   * jamais l'écran ni le modèle. Absent : la société ouverte, elle seule.
   */
  toutesLesSocietes?: boolean;
}

/**
 * Découpe un tampon de flux SSE en événements de l'assistant. Rend les
 * événements complets et ce qui reste à compléter par le morceau suivant —
 * un octet peut arriver coupé n'importe où. Pur : l'écran l'appelle sur ce que
 * le réseau lui donne.
 */
export function decouperLeFlux(tampon: string): {
  evenements: EvenementDeLAssistant[];
  reste: string;
} {
  const evenements: EvenementDeLAssistant[] = [];
  const blocs = tampon.split(/\r?\n\r?\n/);
  const reste = blocs.pop() ?? "";
  for (const bloc of blocs) {
    const donnees = bloc
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!donnees) continue;
    try {
      evenements.push(JSON.parse(donnees) as EvenementDeLAssistant);
    } catch {
      // Une ligne illisible ne casse pas la conversation.
    }
  }
  return { evenements, reste };
}
