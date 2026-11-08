/**
 * « Parler à Malica » — ce que l'assistant envoie à l'écran, événement par
 * événement.
 *
 * ================================================================ LE FLUX
 *
 * La route `POST /malica/assistant` répond en `text/event-stream`. Chaque
 * événement est l'un de ceux-ci, sérialisé en JSON sous son nom :
 *
 *   debut        le fil est ouvert, le modèle choisi
 *   texte        un morceau de la réponse, DÉJÀ GARDÉ : une phrase qui porte un
 *                chiffre ne part qu'une fois sa source établie (voir `retire`)
 *   outil        Malica consulte le dossier (« Je regarde vos pièces… »)
 *   retire       une phrase chiffrée sans source a été retirée — jamais montrée
 *   proposition  une action qui MODIFIE le dossier, proposée, jamais exécutée :
 *                l'écran montre un bouton, la personne confirme
 *   fin          la réponse entière, ses sources, ses suggestions, sa mesure
 *   erreur       un code que l'écran traduit
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

export interface MesureDeLaReponse {
  modele: string | null;
  /** Le modèle de repli a répondu (`deepseek`), ou l'on s'est arrêté (`arret`). */
  repli: "deepseek" | "arret" | null;
  latencePremierMotMs: number | null;
  latenceTotaleMs: number;
  /** Au tarif de la base (R8) ; `null` si un tarif manque. */
  coutUsd: number | null;
  outils: string[];
  iterations: number;
}

export interface FinDeLaReponse {
  conversationId: string;
  messageId: string | null;
  titre: string | null;
  reponse: string;
  sources: SourceDeLAssistant[];
  propositions: PropositionDAction[];
  suggestions: SuggestionDeSuite[];
  /** Les phrases retirées faute de source : jamais montrées, comptées. */
  chiffresRetires: string[];
  mesure: MesureDeLaReponse;
}

export type EvenementDeLAssistant =
  | { type: "debut"; conversationId: string; modele: string | null }
  | { type: "texte"; texte: string }
  | { type: "outil"; nom: string; etat: "debut" | "fin" }
  | { type: "retire"; phrase: string }
  | { type: "proposition"; proposition: PropositionDAction }
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
