/**
 * Comparer deux signatures, et refuser de choisir — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Classer est facile ; refuser de classer ne l'est pas. Une mesure qui rend
 * toujours un premier candidat se trompe en silence le jour où deux formats
 * voisins sont également plausibles — et ce jour-là, la recette de l'un
 * s'applique à l'autre et rend un résultat plausible et faux, la pire forme
 * d'erreur que ce dépôt nomme.
 *
 * `classerLesCandidats` a donc TROIS sorties, et la troisième est la raison
 * d'être du module : un seul voisin, aucun voisin, ou « je ne sais pas ».
 * Jamais « le premier ».
 *
 * ======================================================== CE QUE ÇA NE DIT PAS
 *
 * Une distance n'est pas une probabilité de justesse. Elle n'est pas calibrée
 * et ne doit jamais s'afficher comme une certitude. Elle ne décide pas non
 * plus qu'une recette s'applique : ce verdict-là appartient à l'interpréteur,
 * en aval, qui a le droit de s'abstenir pour d'autres raisons que celle-ci.
 *
 * ======================================================== OÙ VIVENT LES SEUILS
 *
 * Nulle part ici. Les poids et les deux seuils arrivent par argument, sans
 * valeur par défaut. En exécution ils viennent du paramétrage daté et
 * surchargeable par le cabinet (R10) ; le banc en fournit d'autres et obtient
 * d'autres verdicts sur les mêmes signatures — c'est la preuve exécutable
 * qu'aucun n'est écrit ici (R4).
 */
import type { SignatureDeDocument } from "./signature.ts";

/** Les poids des composantes. Une composante indécidable ne pèse rien. */
export interface ParametresDeDistance {
  poids: {
    ancres: number;
    zones: number;
    relations: number;
    tableau: number;
    pagination: number;
  };
}

export interface ParametresDeClassement {
  /** Au-delà, aucun candidat n'est structurellement voisin. */
  distanceMax: number;
  /** Écart exigé entre le premier et le suivant ; en deçà, c'est l'ambiguïté. */
  ecartMinimal: number;
}

export interface Composante {
  nom: "ancres" | "zones" | "relations" | "tableau" | "pagination";
  /** `null` : rien à comparer de ce côté. La composante sort de la moyenne. */
  distance: number | null;
  poids: number;
}

export interface Ecart {
  /** De 0 (même forme) à 1 (rien de commun). */
  distance: number;
  composantes: Composante[];
}

export interface CandidatDeFormat {
  id: string;
  signature: SignatureDeDocument;
  /**
   * L'ossature du format, quand on la connaît : la comparaison s'y limite, et
   * devient aveugle à ce qui varie d'un exemplaire à l'autre.
   */
  ossature?: readonly string[] | undefined;
}

export type VerdictDeProximite =
  | { sorte: "aucun" }
  | { sorte: "un"; id: string; distance: number }
  /** Rien ne départage ces candidats. On ne choisit pas : on le dit. */
  | { sorte: "ambigu"; exAequo: string[]; distance: number; ecart: number };

export interface Classement {
  candidats: Array<{ id: string; distance: number }>;
  verdict: VerdictDeProximite;
}

/* --------------------------------------------------------- les composantes */

const retenu = (cle: string, ossature: ReadonlySet<string> | null) =>
  ossature === null || ossature.has(cle);

/**
 * Les ancres, comparées en ENSEMBLE — et surtout PAS en multiensemble.
 *
 * C'était un multiensemble, avec la part commune pondérée par les
 * occurrences, et la raison semblait bonne : un libellé vu douze fois d'un
 * côté et une fois de l'autre, ce n'est pas tout à fait la même page. La
 * mutation qui remplaçait ce calcul par un ensemble simple n'a fait tomber
 * AUCUN cas — la justification n'était donc pas éprouvée, et le cas qui
 * l'aurait éprouvée dit l'inverse : une facture de six lignes d'articles a la
 * même forme que la même facture à deux lignes, et le comptage les
 * éloignerait. Le nombre de lignes est une donnée, pas une structure.
 *
 * Les occurrences restent dans la signature, pour le seul usage qui les
 * justifie : écarter des relations les ancres répétées, qui ne désignent
 * rien à elles seules.
 */
function ecartDesAncres(
  a: SignatureDeDocument,
  b: SignatureDeDocument,
  ossature: ReadonlySet<string> | null,
): number | null {
  const gauche = new Set(a.ancres.map((x) => x.cle).filter((c) => retenu(c, ossature)));
  const droite = new Set(b.ancres.map((x) => x.cle).filter((c) => retenu(c, ossature)));
  const union = new Set([...gauche, ...droite]);
  if (union.size === 0) return null;
  let communes = 0;
  for (const cle of gauche) if (droite.has(cle)) communes += 1;
  return 1 - communes / union.size;
}

/** Les bandes : une ancre d'entête d'un côté, de pied de l'autre, ce n'est pas la même forme. */
function ecartDesZones(
  a: SignatureDeDocument,
  b: SignatureDeDocument,
  ossature: ReadonlySet<string> | null,
): number | null {
  const droite = new Map(b.ancres.map((x) => [x.cle, x.bandes.join(".")]));
  let communes = 0;
  let discordantes = 0;
  for (const x of a.ancres) {
    if (!retenu(x.cle, ossature)) continue;
    const autre = droite.get(x.cle);
    if (autre === undefined) continue;
    communes += 1;
    if (autre !== x.bandes.join(".")) discordantes += 1;
  }
  return communes === 0 ? null : discordantes / communes;
}

/** Une ancre de la suite d'un document : sa ligne et sa colonne, page comprise. */
interface EnSuite {
  cle: string;
  ligne: string;
  colonne: string;
}

/**
 * La suite de lecture d'un document entier.
 *
 * Les pages s'enchaînent dans l'ordre de leur rang — c'est l'ordre de
 * lecture. Une ancre qui revient sur DEUX pages est écartée : unique dans sa
 * page, elle ne l'est pas dans le document, et dire ce qui la suit reviendrait
 * à choisir laquelle des deux. Les index de ligne et de colonne sont
 * préfixés du rang, sans quoi la ligne 0 de la page 2 serait confondue avec
 * la ligne 0 de la page 1.
 */
function suiteDuDocument(
  signature: SignatureDeDocument,
  ossature: ReadonlySet<string> | null,
): { suite: EnSuite[]; tronquee: boolean } {
  const vues = new Map<string, number>();
  const brute: EnSuite[] = [];
  let tronquee = false;
  for (const page of signature.pages) {
    if (page.lectureTronquee) tronquee = true;
    for (const a of page.lecture) {
      if (!retenu(a.cle, ossature)) continue;
      vues.set(a.cle, (vues.get(a.cle) ?? 0) + 1);
      brute.push({
        cle: a.cle,
        ligne: `${String(page.rang)}:${String(a.ligne)}`,
        colonne: `${String(page.rang)}:${String(a.colonne)}`,
      });
    }
  }
  return { suite: brute.filter((e) => vues.get(e.cle) === 1), tronquee };
}

const lienDe = (x: EnSuite, y: EnSuite) =>
  `${x.cle}>${y.cle}|${String(x.ligne === y.ligne)}|${String(x.colonne === y.colonne)}`;

/**
 * La discordance des suites de lecture, projetées sur les ancres COMMUNES.
 *
 * La projection est ce qui rend la mesure utilisable : une ancre que l'un
 * porte et l'autre pas — un champ facultatif, un mot mal relevé par l'OCR —
 * sort des DEUX suites, et l'ordre des autres n'en est pas dérangé. Sans
 * elle, un mot manquant décalerait toute la chaîne et un exemplaire du même
 * format passerait pour un autre.
 *
 * Une suite tronquée par le plafond rend 1 et non `null` : elle est
 * partielle, on ne sait pas ce qu'elle cache, et une composante absente
 * RAPPROCHE les signatures. Entre se tromper vers la reconnaissance et se
 * tromper vers le refus, le produit a déjà choisi — un refus rend la main au
 * modèle, une reconnaissance fautive rend une lecture prouvée et fausse.
 */
function ecartDesRelations(
  a: SignatureDeDocument,
  b: SignatureDeDocument,
  ossature: ReadonlySet<string> | null,
): number | null {
  const gauche = suiteDuDocument(a, ossature);
  const droite = suiteDuDocument(b, ossature);
  const communes = new Set(
    gauche.suite.map((e) => e.cle).filter((c) => droite.suite.some((e) => e.cle === c)),
  );
  const sg = gauche.suite.filter((e) => communes.has(e.cle));
  const sd = droite.suite.filter((e) => communes.has(e.cle));
  if (sg.length < 2) return null;
  if (gauche.tronquee || droite.tronquee) return 1;

  const liensDroite = new Set<string>();
  for (let i = 0; i + 1 < sd.length; i += 1) liensDroite.add(lienDe(sd[i]!, sd[i + 1]!));
  let contredits = 0;
  for (let i = 0; i + 1 < sg.length; i += 1)
    if (!liensDroite.has(lienDe(sg[i]!, sg[i + 1]!))) contredits += 1;
  return contredits / (sg.length - 1);
}

/** Les colonnes du document, dans l'ordre de leur première apparition. */
function colonnesDuDocument(signature: SignatureDeDocument): string[] {
  const vues: string[] = [];
  for (const page of signature.pages)
    for (const c of [...page.colonnes].sort((x, y) => x.rang - y.rang))
      if (!vues.includes(c.colonne)) vues.push(c.colonne);
  return vues;
}

/**
 * Le tableau : quelles colonnes, et dans quel ordre.
 *
 * Les deux comptent, et séparément. « Prix unitaire HT » contre « prix
 * unitaire TTC » est un changement de colonnes ; deux mêmes colonnes
 * inversées est un changement d'ordre, et il suffit à rendre une recette
 * fausse sans rien changer aux libellés.
 */
function ecartDuTableau(a: SignatureDeDocument, b: SignatureDeDocument): number | null {
  const gauche = colonnesDuDocument(a);
  const droite = colonnesDuDocument(b);
  if (gauche.length === 0 && droite.length === 0) return null;

  const union = new Set([...gauche, ...droite]);
  const communes = gauche.filter((c) => droite.includes(c));
  const parPresence = 1 - communes.length / union.size;

  let couples = 0;
  let inversions = 0;
  for (let i = 0; i < communes.length; i += 1) {
    for (let j = i + 1; j < communes.length; j += 1) {
      couples += 1;
      const ordreDroite =
        droite.indexOf(communes[i]!) < droite.indexOf(communes[j]!) ? "avant" : "apres";
      if (ordreDroite !== "avant") inversions += 1;
    }
  }
  return couples === 0 ? parPresence : (parPresence + inversions / couples) / 2;
}

function ecartDeLaPagination(a: SignatureDeDocument, b: SignatureDeDocument): number | null {
  const g = a.pages.length;
  const d = b.pages.length;
  const plus = Math.max(g, d);
  return plus === 0 ? null : Math.abs(g - d) / plus;
}

/* ------------------------------------------------------------- la distance */

/**
 * La distance entre deux signatures, de 0 à 1.
 *
 * Deux signatures de versions différentes ne se comparent pas : la forme a
 * changé, et une distance calculée entre deux formes différentes serait un
 * nombre sans signification. On rend 1 — le plus loin possible — plutôt qu'un
 * zéro accidentel.
 *
 * Quand AUCUNE composante n'est décidable, la distance vaut 1 elle aussi :
 * ne rien pouvoir comparer n'est pas se ressembler.
 */
export function distanceEntreSignatures(
  a: SignatureDeDocument,
  b: SignatureDeDocument,
  parametres: ParametresDeDistance,
  ossature?: readonly string[],
): Ecart {
  const filtre = ossature === undefined ? null : new Set(ossature);
  const composantes: Composante[] = [
    { nom: "ancres", distance: ecartDesAncres(a, b, filtre), poids: parametres.poids.ancres },
    { nom: "zones", distance: ecartDesZones(a, b, filtre), poids: parametres.poids.zones },
    {
      nom: "relations",
      distance: ecartDesRelations(a, b, filtre),
      poids: parametres.poids.relations,
    },
    { nom: "tableau", distance: ecartDuTableau(a, b), poids: parametres.poids.tableau },
    {
      nom: "pagination",
      distance: ecartDeLaPagination(a, b),
      poids: parametres.poids.pagination,
    },
  ];

  if (a.version !== b.version) return { distance: 1, composantes };

  let somme = 0;
  let poids = 0;
  for (const c of composantes) {
    if (c.distance === null || c.poids <= 0) continue;
    somme += c.distance * c.poids;
    poids += c.poids;
  }
  return { distance: poids === 0 ? 1 : somme / poids, composantes };
}

/**
 * L'ossature : les ancres que TOUS les exemplaires partagent.
 *
 * C'est le second temps, et c'est lui qui règle ce qu'une page seule ne peut
 * pas régler. Rien, dans un document unique, ne distingue le nom de
 * l'émetteur — qui est de la structure — de celui du client, qui est une
 * valeur : les deux sont alphabétiques et tous deux posés à côté d'un
 * libellé. Deux exemplaires suffisent à faire tomber le second.
 */
export function ossatureCommune(signatures: readonly SignatureDeDocument[]): string[] {
  if (signatures.length === 0) return [];
  const [premiere, ...suite] = signatures as [SignatureDeDocument, ...SignatureDeDocument[]];
  let garde = premiere.ancres.map((a) => a.cle);
  for (const autre of suite) {
    const siennes = new Set(autre.ancres.map((a) => a.cle));
    garde = garde.filter((cle) => siennes.has(cle));
  }
  return garde.sort();
}

/**
 * Classe des formats candidats autour d'un sujet, et dit quand il hésite.
 *
 * L'ambiguïté n'est pas un cas d'erreur : c'est une réponse. Elle survient
 * dès que le deuxième candidat est trop près du premier, et elle rend TOUS
 * les ex æquo — à charge de l'aval de s'abstenir, de demander, ou de
 * retomber sur la désignation par le modèle.
 */
export function classerLesCandidats(
  sujet: SignatureDeDocument,
  candidats: readonly CandidatDeFormat[],
  distance: ParametresDeDistance,
  classement: ParametresDeClassement,
): Classement {
  const mesures = candidats
    .map((c) => ({
      id: c.id,
      distance: distanceEntreSignatures(sujet, c.signature, distance, c.ossature).distance,
    }))
    .sort((x, y) => x.distance - y.distance || (x.id < y.id ? -1 : 1));

  const premier = mesures[0];
  if (!premier || premier.distance > classement.distanceMax) {
    return { candidats: mesures, verdict: { sorte: "aucun" } };
  }

  const exAequo = mesures.filter(
    (m) =>
      m.distance - premier.distance < classement.ecartMinimal &&
      m.distance <= classement.distanceMax,
  );
  if (exAequo.length > 1) {
    const second = exAequo[1]!;
    return {
      candidats: mesures,
      verdict: {
        sorte: "ambigu",
        exAequo: exAequo.map((m) => m.id),
        distance: premier.distance,
        ecart: second.distance - premier.distance,
      },
    };
  }
  return {
    candidats: mesures,
    verdict: { sorte: "un", id: premier.id, distance: premier.distance },
  };
}
