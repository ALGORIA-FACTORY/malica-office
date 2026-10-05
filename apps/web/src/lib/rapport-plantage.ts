/**
 * Rapporter un plantage — à notre serveur, et expurgé.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, l'application installée a planté sur un téléphone et n'a
 * laissé AUCUNE trace. Le journal d'atelier (`journal-atelier.ts`) n'existe
 * qu'en développement ; Sentry demande un DSN qui n'est pas posé ; le serveur
 * n'a rien vu. Diagnostiquer revenait à deviner — et trois corrections à
 * l'aveugle avaient déjà échoué en septembre pour la même raison.
 *
 * Ce module ferme ce trou, et seulement celui-là : il envoie au SERVEUR DU
 * PRODUIT ce qu'il faut pour retrouver la ligne de code, et rien d'autre.
 *
 * ========================================================= CE QUI NE PART PAS
 *
 * Une pièce est un document de client. Un message d'erreur ou une pile
 * d'appels peut en porter un morceau : une adresse, un matricule fiscal, un
 * montant, un jeton, voire une image en ligne. `expurger` ne fait donc pas
 * confiance à ce qu'on lui donne — elle retire AVANT l'envoi, et le test
 * `__tests__/rapport-plantage.test.ts` dit ce qui ne doit jamais passer.
 *
 * La règle est plus sévère que nécessaire, exprès : un numéro de ligne perdu
 * coûte une minute d'enquête, un montant de facture parti ne se rattrape pas.
 *
 * ===================================================== CE QUI N'EST PAS FAIT
 *
 * Un plantage SANS session ne peut pas être écrit : `app.signalements` exige
 * un auteur. C'est une limite connue, pas un oubli — l'écran de connexion est
 * la seule surface concernée, et elle ne lit aucune donnée de client.
 */
import { appeler } from "@/verticals/malica-office/adapters/http/rpc";

/** Ce qu'on met à la place de ce qu'on retire. */
const MARQUE = "[retiré]";

/** La taille au-delà de laquelle une pile n'apprend plus rien. */
const TAILLE_MAX = 4000;

/*
 * L'ordre compte : les motifs les plus spécifiques d'abord, pour que la
 * marque laissée soit la plus parlante. Un jeton retiré en tant que jeton
 * vaut mieux qu'un jeton retiré en tant que « longue suite de caractères ».
 */
const MOTIFS: ReadonlyArray<readonly [RegExp, string]> = [
  // Une image ou un fichier en ligne : jamais.
  [/data:[^\s,;]*[;,][^\s"')]+/gi, MARQUE],
  // La requête d'une adresse porte des identifiants ; le chemin, non.
  [/\?[^\s"')]+/g, `?${MARQUE}`],
  // Une adresse de courriel nomme une personne.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MARQUE],
  /*
   * Le matricule fiscal tunisien : 1876543W/A/M/000.
   *
   * La lettre de clé après les sept chiffres est FACULTATIVE dans ce motif, et
   * c'est délibéré : elle est obligatoire dans la vraie forme, mais le motif
   * doit aussi couvrir ce que des fiches anciennes ou abîmées portent.
   *
   * Elle manquait, et la fuite est restée invisible jusqu'au 5 octobre 2026 :
   * le motif reconnaissait la forme tronquée des fixtures du dépôt et PAS
   * celle que portent les vraies pièces. Le matricule d'un vrai client partait
   * donc en clair dans un rapport de plantage — le contraire exact de ce que
   * ce module promet. Des fixtures mal formées avaient rendu le test complice.
   */
  [/\d{7}\s*[A-Za-z]?\s*\/\s*[A-Za-z]\s*\/\s*[A-Za-z]\s*\/\s*\d{3}/g, MARQUE],
  // Un jeton de session : trois segments séparés par des points.
  [/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MARQUE],
  // Une empreinte ou un blob encodé.
  [/[A-Za-z0-9+/]{40,}={0,2}/g, MARQUE],
  // Un montant, un numéro de téléphone, un identifiant. Six chiffres : au
  // dessous, ce sont les lignes et colonnes d'une pile, qui ne nomment rien.
  [/\d{6,}/g, MARQUE],
];

/**
 * Retirer d'un texte tout ce qui pourrait désigner une personne, une société,
 * une somme ou un secret. Fonction pure : elle se teste, et c'est elle qui
 * tient la promesse — pas une case cochée dans une console.
 */
/*
 * Une position dans un fichier — « :12:150823 » — ne nomme personne, et c'est
 * elle qui dit OÙ le code a cassé. La règle des six chiffres l'avait prise
 * pour un montant au premier vrai plantage remonté. On la met donc à l'abri
 * le temps du nettoyage, puis on la rend.
 */
const POSITION = /:\d{1,7}:\d{1,7}(?=[)\s]|$)/g;
const ABRI = "\u0000position\u0000";

export function expurger(texte: string | null | undefined): string {
  if (texte === null || texte === undefined) return "";
  const positions: string[] = [];
  let sorti = String(texte).replace(POSITION, (p) => {
    positions.push(p);
    return ABRI;
  });
  for (const [motif, remplacement] of MOTIFS) sorti = sorti.replace(motif, remplacement);
  let i = 0;
  sorti = sorti
    .split(ABRI)
    .reduce((acc, bout, k) => (k === 0 ? bout : acc + (positions[i++] ?? "") + bout), "");
  return sorti.slice(0, TAILLE_MAX);
}

/** Ce qu'on a déjà rapporté : une boucle de rendu ne doit pas noyer le journal. */
const dejaVu = new Set<string>();

/**
 * Envoyer le rapport. Ne lève jamais : un rapport perdu ne doit pas aggraver
 * la panne qu'il décrit, et surtout pas remplacer l'écran d'erreur par un
 * autre.
 */
export async function rapporterPlantage(entree: {
  ou: string;
  message: unknown;
  pile?: string | null | undefined;
  versionClient: string;
  appareil?: string | undefined;
}): Promise<void> {
  const message = expurger(
    entree.message instanceof Error ? entree.message.message : String(entree.message ?? ""),
  ).slice(0, 2000);
  if (message.trim().length === 0) return;

  const empreinte = `${entree.ou}|${message}`;
  if (dejaVu.has(empreinte)) return;
  dejaVu.add(empreinte);

  try {
    await appeler("signalements", "deposer", [
      {
        origine: "plantage",
        ou: expurger(entree.ou).slice(0, 200),
        message,
        pile: expurger(entree.pile) || null,
        versionClient: entree.versionClient.slice(0, 120),
        appareil: entree.appareil?.slice(0, 300) ?? null,
      },
    ]);
  } catch {
    // Volontairement muet. L'écran d'erreur est déjà affiché ; échouer ici ne
    // doit rien changer pour la personne qui le regarde.
  }
}
