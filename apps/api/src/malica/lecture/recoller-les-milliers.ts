/**
 * Recoller un nombre que l'espace des milliers a coupé — au niveau de l'OCR.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, « 2 800,000 » a été lu 2,000. Le plan de jetons découpe
 * sur l'espace, donc le montant EST deux jetons, et la consigne de désignation
 * interdisait d'en citer deux.
 *
 * Cette interdiction est levée depuis le 5 octobre, et le vrai modèle rend
 * désormais la plage. Mais la garantie repose alors sur l'OBÉISSANCE d'un
 * modèle : il suffit qu'il l'oublie une fois, sur une facture un peu
 * différente, pour que le défaut revienne — silencieusement, puisqu'un montant
 * tronqué n'est pas ambigu.
 *
 * Recoller ici rend la garantie STRUCTURELLE : le montant n'est plus jamais
 * coupé dans le plan, donc plus jamais citable à moitié. C'est la différence
 * entre une règle qu'on demande et une règle qui tient.
 *
 * ====================================================== CE QUI REND CELA SÛR
 *
 * Mesuré sur le plan réel de la facture du 4 octobre (177 jetons) :
 *
 *   « 2 » + « 800,000 »        même ligne, écart 0,0081  ← l'espace des milliers
 *   « 800,000 » + « 2 »        même ligne, écart 0,0860  ← la gouttière de colonne
 *   « 220,000 » + « 220,000 »  même ligne, écart 0,0970  ← deux colonnes
 *   « 1 » + « 1 »              lignes différentes        ← deux lignes du tableau
 *
 * L'espace des milliers vaut UNE largeur de caractère ; la gouttière entre
 * colonnes en vaut dix. Un facteur dix sépare le cas à recoller du cas à ne
 * jamais recoller, et c'est ce qui permet une règle géométrique sans arbitrage.
 *
 * ================================================= CE QUE CE MODULE NE FAIT PAS
 *
 * Il ne lit aucun montant et n'en rend aucun : il rend un plan de jetons. La
 * lecture reste dans `montants.ts`, et R2 est intacte — le texte recollé est
 * celui que la pièce IMPRIME, remis d'un seul morceau.
 *
 * Il ne recolle jamais deux nombres qui ne sont pas un groupe de milliers :
 * « 19 » et « 000 » côte à côte sur la même ligne à une largeur de caractère
 * seraient recollés, et c'est voulu — c'est la forme d'un nombre tunisien. En
 * revanche « 2026 » ne peut rien absorber, parce qu'une partie entière de
 * quatre chiffres n'ouvre pas un groupe de milliers.
 */
import type { PageToken } from "./token-plan.ts";

/**
 * Combien de largeurs de caractère séparent encore deux morceaux d'un même
 * nombre.
 *
 * Deux, alors que la mesure donne un : la marge absorbe une OCR qui estime mal
 * la boîte d'un chiffre isolé. Dix sépare du cas voisin, donc deux reste très
 * loin de la gouttière de colonne — on ne gagne rien à serrer davantage, et on
 * perdrait les plans un peu moins propres que celui qu'on a mesuré.
 */
const ECART_MAX_EN_CARACTERES = 2;

/** Au-delà, deux jetons ne sont pas sur la même ligne imprimée. */
const TOLERANCE_DE_LIGNE = 0.006;

/** Ce qui peut OUVRIR un groupe de milliers : une à trois chiffres, et rien d'autre. */
const OUVRE = /^\d{1,3}$/;

/**
 * Un groupe intermédiaire : trois chiffres nus. Il peut encore en absorber un.
 */
const GROUPE = /^\d{3}$/;

/**
 * Le DERNIER groupe : trois chiffres ET des décimales, éventuellement suivis
 * d'une ponctuation fermante.
 *
 * ========================== POURQUOI LES DÉCIMALES SONT EXIGÉES
 *
 * Mesuré, et c'est la découverte du prototype. La règle géométrique seule a
 * recollé, sur la vraie facture :
 *
 *   « 98 » + « 456 » + « 123 »   le NUMÉRO DE TÉLÉPHONE de l'émetteur
 *   « 04 » + « 012 »             le début d'un NUMÉRO DE COMPTE
 *
 * Un téléphone tunisien et un montant tunisien ont exactement la même forme :
 * des groupes de trois chiffres séparés par une espace, sur une ligne, à une
 * largeur de caractère. Aucune géométrie ne les distingue, parce qu'il n'y a
 * rien à distinguer — la différence est de SENS, pas de forme.
 *
 * Exiger les décimales sur le dernier groupe les sépare, et sans dictionnaire :
 * un montant tunisien s'imprime avec ses trois millimes (« 2 800,000 »), un
 * téléphone jamais.
 *
 * ================================================ CE QUE CETTE EXIGENCE COÛTE
 *
 * « 2 800 » ou « 1 234 560 », imprimés sans décimales, ne sont plus recollés
 * ici. Ce n'est pas une perte sèche : cette forme est précisément celle que le
 * produit traite déjà comme AMBIGUË — « 1 234 560 » vaut 1 234,560 D ou
 * 1 234 560 D, et c'est le droit de timbre qui tranche l'échelle. Elle reste
 * donc couverte par la plage que le modèle désigne et par le solveur, qui
 * posent une question plutôt que de choisir.
 *
 * Autrement dit : on rend structurelle la garantie sur la forme NORMALE, et on
 * laisse la forme douteuse au dispositif qui sait douter. Recoller un
 * téléphone en montant serait une valeur FABRIQUÉE — ce que R2 interdit
 * absolument, et bien pire que de laisser un montant en deux morceaux.
 *
 * La ponctuation fermante est admise à dessein : « (base 3 020,000) » donne
 * « 3 » + « 020,000) ». Recoller rend « 3 020,000) », que le lecteur de
 * montants REFUSE — alors que « 3 » seul se lisait 3,000 sans un mot. Entre un
 * refus et une valeur fausse silencieuse, R2 choisit le refus : lui au moins
 * pose une question à l'écran.
 */
const DERNIER_GROUPE = /^\d{3}[.,]\d+[)\].,;:]?$/;

function largeurDeCaractere(t: PageToken): number {
  return (t.x1 - t.x0) / Math.max(t.text.length, 1);
}

function colle(gauche: PageToken, droite: PageToken): boolean {
  if (gauche.page !== droite.page) return false;
  if (Math.abs(gauche.y0 - droite.y0) > TOLERANCE_DE_LIGNE) return false;
  const ecart = droite.x0 - gauche.x1;
  // Un écart négatif veut dire que la droite est AVANT : un retour à la ligne
  // que la tolérance verticale n'a pas vu, ou deux colonnes mal ordonnées.
  if (ecart < 0) return false;
  return ecart <= ECART_MAX_EN_CARACTERES * largeurDeCaractere(gauche);
}

/**
 * Rend un plan où les nombres coupés par l'espace des milliers sont d'un seul
 * morceau. Les ordinaux des jetons conservés ne changent PAS : les jetons
 * absorbés disparaissent, et leur ordinal avec eux.
 *
 * Ne pas renuméroter est un choix. Renuméroter déplacerait tous les ordinaux
 * suivants, donc invaliderait toute désignation déjà enregistrée — y compris
 * celles du jeu d'or, qui sont la mesure de référence. Les trous ne gênent
 * personne : rien n'exige que les ordinaux se suivent.
 */
export function recollerLesMilliers(tokens: readonly PageToken[]): PageToken[] {
  const ordre = [...tokens].sort((a, b) => a.page - b.page || a.ordinal - b.ordinal);
  const sortie: PageToken[] = [];

  for (let i = 0; i < ordre.length; i++) {
    const premier = ordre[i]!;
    if (!OUVRE.test(premier.text)) {
      sortie.push(premier);
      continue;
    }

    const morceaux: PageToken[] = [premier];
    let j = i + 1;
    let fini = false;
    while (j < ordre.length) {
      const suivant = ordre[j]!;
      const intermediaire = GROUPE.test(suivant.text);
      const dernier = DERNIER_GROUPE.test(suivant.text);
      if (!intermediaire && !dernier) break;
      if (!colle(morceaux[morceaux.length - 1]!, suivant)) break;
      morceaux.push(suivant);
      j++;
      // Les décimales closent le nombre : « 1 » + « 234 » + « 560,000 » tient,
      // « 1 234,560 » + « 999 » non.
      if (dernier) {
        fini = true;
        break;
      }
    }

    /*
     * Sans décimales, on ne recolle PAS — c'est ce qui sépare un montant d'un
     * numéro de téléphone, qui a exactement la même forme. Voir
     * `DERNIER_GROUPE`.
     */
    if (!fini || morceaux.length === 1) {
      sortie.push(premier);
      continue;
    }

    const dernier = morceaux[morceaux.length - 1]!;
    sortie.push({
      ...premier,
      // L'espace est conservée dans le texte : c'est ce que la pièce imprime,
      // et `candidatsMontant` sait que l'espace sépare les milliers.
      text: morceaux.map((m) => m.text).join(" "),
      x1: dernier.x1,
      y0: Math.min(...morceaux.map((m) => m.y0)),
      y1: Math.max(...morceaux.map((m) => m.y1)),
      ...(morceaux.some((m) => typeof m.confidence === "number")
        ? {
            // La confiance du morceau le MOINS sûr : un nombre ne vaut pas
            // mieux que sa partie la plus douteuse.
            confidence: Math.min(
              ...morceaux.map((m) => (typeof m.confidence === "number" ? m.confidence : 1)),
            ),
          }
        : {}),
    });
    i = j - 1;
  }

  return sortie;
}

/**
 * ================================================= LE GARDE DE L'AMPUTATION
 *
 * Le recollage ci-dessus ferme la forme NORMALE d'un montant tunisien, celle
 * qui porte ses millimes. Il en laisse volontairement une ouverte — « 1 234
 * 560 » sans décimales, qu'on ne recolle pas parce qu'un numéro de téléphone
 * a exactement la même forme (voir `DERNIER_GROUPE`) — et il ne peut rien
 * pour un plan dont les boîtes sont trop abîmées pour qu'il s'applique.
 *
 * Ce garde regarde l'autre bout de la chaîne : non plus le plan, mais la
 * PLAGE que le désignateur a citée. Si le jeton immédiatement collé à cette
 * plage est le morceau manquant d'un même nombre, la plage est amputée.
 *
 * ============================================== POURQUOI IL FAUT UN GARDE
 *
 * Mesuré le 18 octobre 2026 : une facture arabe lue par la chaîne réelle est
 * sortie `extract.v1` VALIDE avec 650,000 D là où le papier porte 5 650,000 D
 * — le désignateur ayant cité le SECOND jeton de la paire sur les trois
 * totaux à la fois. Et 650 000 + 73 500 + 1 000 = 724 500, au millime :
 * retrancher les milliers de chaque terme d'une somme les retranche aussi de
 * la somme. Une amputation SYSTÉMATIQUE passe toutes les équations, et c'est
 * le cas normal quand la cause est une consigne mal suivie.
 *
 * Un montant amputé n'est pas ambigu non plus — « 650,000 » a une lecture
 * unique — donc il franchissait aussi tous les drapeaux, qui visaient
 * l'ambiguïté. Le seul invariant qu'il viole est la contiguïté du plan.
 *
 * ================================================ CE QU'IL COÛTE, ET L'ARBITRAGE
 *
 * Il crie parfois à tort : deux colonnes anormalement serrées, un nombre de
 * trois chiffres collé à un montant. La borne est géométrique et la même que
 * celle du recollage — deux largeurs de caractère, là où une gouttière de
 * colonne en vaut dix — donc le cas est rare, mais il existe.
 *
 * Il penche du côté du doute, délibérément : un faux positif coûte une
 * question posée à la personne (valeur `null`, drapeau, contrat partiel, donc
 * aucune écriture) ; un faux négatif coûte une comptabilité fausse de six
 * mille dinars. Ce n'est pas un arbitrage serré.
 */
export interface Amputation {
  /** De quel côté le morceau manque : avant la plage citée, ou après. */
  cote: "gauche" | "droite";
  /** Le jeton que la citation aurait dû englober. */
  voisin: PageToken;
}

/** Un jeton qui peut CONTINUER un nombre : un groupe de milliers. */
const CONTINUE = (texte: string): boolean => GROUPE.test(texte) || DERNIER_GROUPE.test(texte);

export function plageAmputee(
  tokens: readonly PageToken[],
  plage: readonly PageToken[],
): Amputation | null {
  const premier = plage[0];
  const dernier = plage[plage.length - 1];
  if (!premier || !dernier) return null;

  const horsPlage = (t: PageToken): boolean =>
    !plage.some((p) => p.page === t.page && p.ordinal === t.ordinal);

  // À GAUCHE : la forme mesurée le 18 octobre. On cite « 650,000 », et « 5 »
  // est collé juste avant — le montant imprimé est « 5 650,000 ».
  if (CONTINUE(premier.text)) {
    const voisin = tokens.find((t) => horsPlage(t) && OUVRE.test(t.text) && colle(t, premier));
    if (voisin) return { cote: "gauche", voisin };
  }

  // À DROITE : la forme du 4 octobre. On cite « 2 », et « 800,000 » est collé
  // juste après. Le dernier jeton d'une plage close par ses décimales ne peut
  // rien absorber de plus — « 1 234,560 » + « 999 » n'est pas un nombre.
  if (
    !DERNIER_GROUPE.test(dernier.text) &&
    (OUVRE.test(dernier.text) || GROUPE.test(dernier.text))
  ) {
    const voisin = tokens.find((t) => horsPlage(t) && CONTINUE(t.text) && colle(dernier, t));
    if (voisin) return { cote: "droite", voisin };
  }

  return null;
}
