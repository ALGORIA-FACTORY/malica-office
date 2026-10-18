/**
 * L'interprète déterministe — exécuter une recette sur un plan de jetons.
 *
 * ================================================== LA RÈGLE QUI DÉCIDE TOUT
 *
 * CET INTERPRÈTE NE LIT AUCUNE VALEUR.
 *
 * Il désigne des `page` / `ordinal`, exactement comme le modèle désignateur,
 * et il rend un `ResultatDeRecette` dont les trois formes de champ —
 * `{ designe }`, `{ abstention }`, `{ absent }` — n'ont aucune branche où
 * écrire un montant, un texte ou une date. Ce n'est pas une consigne : c'est
 * le type, et le compilateur refuserait un interprète qui voudrait rendre une
 * valeur.
 *
 * Tout ce qui suit la désignation — `recollerLesMilliers`, la relecture du
 * plan, `normalizeDate`, la citation, les contrôles — est PARTAGÉ avec la
 * chaîne existante. Il n'y a donc pas de second lecteur de montants, et c'est
 * la seule façon connue de ne pas refaire l'amputation du 18 octobre 2026 :
 * une facture arabe sortie VALIDE à 650 000 D là où le papier portait
 * 5 650 000 D, parce qu'une fonction de recollage écrite treize jours plus tôt
 * n'était branchée nulle part.
 *
 * ==================================== LE PLAN REÇU EST LE PLAN DÉJÀ RECOLLÉ
 *
 * `relever()` applique `recollerLesMilliers` AVANT la désignation : le plan
 * que le modèle voit porte « 5 650,000 » d'un seul jeton. L'interprète doit
 * recevoir EXACTEMENT ce plan-là, et pas le relevé brut — sinon il désignerait
 * le second morceau d'une paire, ce qui est très précisément l'amputation.
 * C'est le seul pré-requis qu'il pose à son appelant, et il est éprouvé.
 *
 * ============================================ CE QU'IL NE FAIT PAS NON PLUS
 *
 * Il ne reconnaît pas le format : c'est `interprete-reconnaissance.ts`. Il ne
 * décide pas de rendre la main : c'est l'appelant, qui lit l'abstention. Il
 * n'appelle rien, ne lit aucune base, ne voit aucune pièce.
 *
 * ============================================== R4 — AUCUN SEUIL ICI DEDANS
 *
 * Les deux nombres qui décident — les recouvrements qui disent « même ligne »
 * et « même colonne » — arrivent par `ParametresDeSignature`, sans valeur par
 * défaut, et ce sont CEUX DE LA SIGNATURE : un interprète qui aurait les
 * siens dirait « même ligne » autrement que la reconnaissance qui l'a choisi.
 */
import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import { correspond, formeDuJeton, type SystemeDeChiffres } from "./interprete-texte.ts";
import {
  absent,
  designer,
  sAbstenir,
  type Champ,
  type CodeDAbstention,
  type Recette,
  type ResultatDeChamp,
  type ResultatDeRecette,
  type Selecteur,
  type Tableau,
} from "./recette.ts";
import { boiteDeContenu, type Boite } from "./signature-ancres.ts";
import { serecouvrent } from "./signature-relations.ts";
import type { ParametresDeSignature } from "./signature.ts";

/**
 * Le code d'abstention d'une ambiguïté de cellule.
 *
 * Une colonne de tableau ne déclare que `si_absent` : le langage ne lui donne
 * pas de `si_ambigu`, parce qu'une cellule ambiguë n'est pas un choix de
 * rédaction de recette, c'est un fait. Le mot existe, et il est unique
 * (`ReadFlag`) : « refuser de choisir entre deux jetons est un fait ».
 */
const AMBIGUITE_DE_CELLULE: CodeDAbstention = "DESIGNATION_AMBIGUE";

/* ======================================================= LA RÉSOLUTION === */

/**
 * Ce qu'un sélecteur peut donner.
 *
 * `plage_ouverte` est la quatrième, et elle est là pour un cas précis : une
 * étendue « jusqu'à » dont la borne n'est pas sur la ligne. La recette dit où
 * le champ s'arrête ; si cette borne manque, l'interprète ne sait pas où il
 * s'arrête, et décider à sa place reviendrait à inventer une plage.
 */
type Resolution =
  | { readonly sorte: "un"; readonly debut: PageToken; readonly fin: PageToken }
  | { readonly sorte: "aucun" }
  | { readonly sorte: "ambigu"; readonly combien: number }
  | { readonly sorte: "plage_ouverte" };

interface Contexte {
  readonly recette: Recette;
  readonly parametres: ParametresDeSignature;
  readonly tokens: readonly PageToken[];
  readonly parPage: Map<number, PageToken[]>;
  readonly rangs: Map<number, number>;
  readonly dernierRang: number;
  readonly boites: Map<number, Boite>;
  /** Mémoire des ancres déjà résolues, et garde contre un graphe circulaire. */
  readonly ancres: Map<string, Resolution>;
  readonly enCours: Set<string>;
}

function contexte(
  recette: Recette,
  tokens: readonly PageToken[],
  parametres: ParametresDeSignature,
): Contexte {
  const parPage = new Map<number, PageToken[]>();
  for (const t of tokens) {
    const vu = parPage.get(t.page);
    if (vu) vu.push(t);
    else parPage.set(t.page, [t]);
  }
  for (const liste of parPage.values()) liste.sort((a, b) => a.ordinal - b.ordinal);

  const numeros = [...parPage.keys()].sort((a, b) => a - b);
  const rangs = new Map<number, number>();
  const boites = new Map<number, Boite>();
  numeros.forEach((numero, index) => {
    rangs.set(numero, index + 1);
    const boite = boiteDeContenu(parPage.get(numero) ?? []);
    if (boite) boites.set(numero, boite);
  });

  return {
    recette,
    parametres,
    tokens,
    parPage,
    rangs,
    dernierRang: numeros.length,
    boites,
    ancres: new Map(),
    enCours: new Set(),
  };
}

const ordreDeLecture = (a: PageToken, b: PageToken) => a.page - b.page || a.ordinal - b.ordinal;

/** Les deux jetons sont-ils sur la même ligne imprimée ? */
function memeLigne(ctx: Contexte, a: PageToken, b: PageToken): boolean {
  return (
    a.page === b.page && serecouvrent(a.y0, a.y1, b.y0, b.y1, ctx.parametres.recouvrementDeLigne)
  );
}

/** Les deux jetons sont-ils dans la même colonne imprimée ? */
function memeColonne(ctx: Contexte, a: PageToken, b: PageToken): boolean {
  return (
    a.page === b.page && serecouvrent(a.x0, a.x1, b.x0, b.x1, ctx.parametres.recouvrementDeColonne)
  );
}

/* ----------------------------------------------------- les candidats ----- */

/** Les jetons qui portent le motif d'une ancre, dans l'ordre de lecture. */
function jetonsDuMotif(ctx: Contexte, selecteur: Selecteur): PageToken[] {
  if (selecteur.depuis.genre !== "ancre") return [];
  const motif = selecteur.depuis.motif;
  const chiffres = ctx.recette.chiffres as SystemeDeChiffres;
  return ctx.tokens.filter((t) => correspond(motif, t.text, chiffres)).sort(ordreDeLecture);
}

/**
 * Les voisins d'une ancre, du plus proche au plus lointain.
 *
 * « Avant » et « après » sont LOGIQUES, le long de l'axe de lecture : en
 * arabe, l'ancre qui précède est celle de droite. Le langage des recettes
 * n'a volontairement pas de direction nommée « gauche », pour que
 * l'ambiguïté ne se tranche pas ici en silence.
 */
function voisins(
  ctx: Contexte,
  ancre: PageToken,
  direction: "avant" | "apres" | "dessus" | "dessous",
  droiteAGauche: boolean,
  ecartMax: number | undefined,
): PageToken[] {
  const horizontale = direction === "avant" || direction === "apres";
  const mesures: Array<{ jeton: PageToken; ecart: number }> = [];

  for (const t of ctx.parPage.get(ancre.page) ?? []) {
    if (t.ordinal === ancre.ordinal) continue;
    if (horizontale) {
      if (!memeLigne(ctx, ancre, t)) continue;
      const aval = droiteAGauche ? t.x1 <= ancre.x0 : t.x0 >= ancre.x1;
      const amont = droiteAGauche ? t.x0 >= ancre.x1 : t.x1 <= ancre.x0;
      const retenu = direction === "apres" ? aval : amont;
      if (!retenu) continue;
      const ecart =
        direction === "apres"
          ? droiteAGauche
            ? ancre.x0 - t.x1
            : t.x0 - ancre.x1
          : droiteAGauche
            ? t.x0 - ancre.x1
            : ancre.x0 - t.x1;
      mesures.push({ jeton: t, ecart });
    } else {
      if (!memeColonne(ctx, ancre, t)) continue;
      const dessous = t.y0 >= ancre.y1;
      const dessus = t.y1 <= ancre.y0;
      if (direction === "dessous" ? !dessous : !dessus) continue;
      mesures.push({
        jeton: t,
        ecart: direction === "dessous" ? t.y0 - ancre.y1 : ancre.y0 - t.y1,
      });
    }
  }

  return mesures
    .filter((m) => ecartMax === undefined || m.ecart <= ecartMax)
    .sort((a, b) => a.ecart - b.ecart || ordreDeLecture(a.jeton, b.jeton))
    .map((m) => m.jeton);
}

/* ----------------------------------------------------- les contraintes --- */

function dansLaZone(ctx: Contexte, jeton: PageToken, nom: string): boolean {
  const zone = ctx.recette.zones[nom];
  const boite = ctx.boites.get(jeton.page);
  if (!zone || !boite) return false;
  const largeur = boite.x1 - boite.x0;
  const hauteur = boite.y1 - boite.y0;
  const u = largeur > 0 ? ((jeton.x0 + jeton.x1) / 2 - boite.x0) / largeur : 0;
  const v = hauteur > 0 ? ((jeton.y0 + jeton.y1) / 2 - boite.y0) / hauteur : 0;
  return u >= zone.x0 && u <= zone.x1 && v >= zone.y0 && v <= zone.y1;
}

function satisfaitLesContraintes(ctx: Contexte, jeton: PageToken, selecteur: Selecteur): boolean {
  const chiffres = ctx.recette.chiffres as SystemeDeChiffres;
  for (const c of selecteur.ou) {
    if (c.genre === "forme") {
      if (formeDuJeton(jeton.text, chiffres) !== c.forme) return false;
    } else if (c.genre === "zone") {
      if (!dansLaZone(ctx, jeton, c.zone)) return false;
    } else if (c.genre === "meme_ligne" || c.genre === "meme_colonne") {
      const autre = resoudreLAncre(ctx, c.que);
      if (autre.sorte !== "un") return false;
      const ok =
        c.genre === "meme_ligne"
          ? memeLigne(ctx, autre.debut, jeton)
          : memeColonne(ctx, autre.debut, jeton);
      if (!ok) return false;
    } else {
      const rang = ctx.rangs.get(jeton.page);
      if (rang === undefined) return false;
      if (c.page === "premiere" && rang !== 1) return false;
      if (c.page === "derniere" && rang !== ctx.dernierRang) return false;
      if (c.page === "numero" && rang !== c.numero) return false;
    }
  }
  return true;
}

/* --------------------------------------------------------- l'étendue ---- */

/**
 * La suite CONTIGUË d'un jeton sur sa ligne.
 *
 * Contiguë au sens des ordinaux : la chaîne existante concatène des jetons
 * voisins dans le plan, elle ne complète jamais un mot absent. Une plage qui
 * sauterait un ordinal ferait dire à la citation autre chose que ce que la
 * pièce imprime.
 */
function suiteContigue(ctx: Contexte, debut: PageToken): PageToken[] {
  const page = ctx.parPage.get(debut.page) ?? [];
  const suite: PageToken[] = [];
  let attendu = debut.ordinal + 1;
  for (const t of page) {
    if (t.ordinal !== attendu) continue;
    if (!memeLigne(ctx, debut, t)) break;
    suite.push(t);
    attendu += 1;
  }
  return suite;
}

function etendre(ctx: Contexte, debut: PageToken, selecteur: Selecteur): Resolution {
  const etendue = selecteur.etendre;
  if (!etendue) return { sorte: "un", debut, fin: debut };
  const suite = suiteContigue(ctx, debut);

  if (etendue.genre === "jusqu_a_fin_de_ligne") {
    return { sorte: "un", debut, fin: suite[suite.length - 1] ?? debut };
  }
  if (etendue.genre === "jetons") {
    const combien = Math.min(etendue.nombre - 1, suite.length);
    return { sorte: "un", debut, fin: combien <= 0 ? debut : suite[combien - 1]! };
  }
  const chiffres = ctx.recette.chiffres as SystemeDeChiffres;
  const borne = suite.findIndex((t) => correspond(etendue.motif, t.text, chiffres));
  if (borne < 0) return { sorte: "plage_ouverte" };
  return { sorte: "un", debut, fin: suite[borne]! };
}

/* ------------------------------------------------------ le sélecteur ---- */

function candidats(ctx: Contexte, selecteur: Selecteur): PageToken[] | Resolution {
  const source = selecteur.depuis;
  if (source.genre === "ancre") return jetonsDuMotif(ctx, selecteur);
  if (source.genre === "voisin") {
    const ancre = resoudreLAncre(ctx, source.de);
    if (ancre.sorte !== "un") return ancre;
    const sens = source.sens ?? ctx.recette.sens_de_lecture;
    return voisins(ctx, ancre.fin, source.direction, sens === "rtl", source.ecart_max);
  }
  return cellules(ctx, source.tableau, source.colonne);
}

function resoudre(ctx: Contexte, selecteur: Selecteur): Resolution {
  const bruts = candidats(ctx, selecteur);
  if (!Array.isArray(bruts)) return bruts;

  const retenus = bruts.filter((t) => satisfaitLesContraintes(ctx, t, selecteur));
  if (retenus.length === 0) return { sorte: "aucun" };

  const choix = selecteur.prendre;
  if (choix.genre === "unique" && retenus.length > 1) {
    return { sorte: "ambigu", combien: retenus.length };
  }
  const jeton =
    choix.genre === "dernier"
      ? retenus[retenus.length - 1]
      : choix.genre === "nieme"
        ? retenus[choix.rang - 1]
        : retenus[0];
  if (!jeton) return { sorte: "aucun" };
  return etendre(ctx, jeton, selecteur);
}

function resoudreLAncre(ctx: Contexte, nom: string): Resolution {
  const memoire = ctx.ancres.get(nom);
  if (memoire) return memoire;
  const selecteur = ctx.recette.ancres[nom];
  if (!selecteur || ctx.enCours.has(nom)) return { sorte: "aucun" };
  ctx.enCours.add(nom);
  const resolution = resoudre(ctx, selecteur);
  ctx.enCours.delete(nom);
  ctx.ancres.set(nom, resolution);
  return resolution;
}

/** Toutes les occurrences d'une ancre, sans la trancher par `prendre`. */
function occurrencesDeLAncre(ctx: Contexte, nom: string): PageToken[] {
  const selecteur = ctx.recette.ancres[nom];
  if (!selecteur) return [];
  const bruts = candidats(ctx, selecteur);
  if (!Array.isArray(bruts)) return [];
  return bruts.filter((t) => satisfaitLesContraintes(ctx, t, selecteur));
}

/* =========================================================== LES CHAMPS == */

/** La seule fabrique de désignation : une plage de jetons, jamais une valeur. */
function reference(debut: PageToken, fin: PageToken): ResultatDeChamp {
  const ref: TokenRef = {
    page: debut.page,
    ordinal: debut.ordinal,
    ...(fin.ordinal === debut.ordinal ? {} : { ordinalEnd: fin.ordinal }),
  };
  return designer(ref);
}

function versResultat(resolution: Resolution, champ: Champ, quoi: string): ResultatDeChamp {
  if (resolution.sorte === "un") return reference(resolution.debut, resolution.fin);
  if (resolution.sorte === "ambigu") {
    return sAbstenir(
      champ.si_ambigu,
      `${quoi} : ${String(resolution.combien)} jetons satisfont la règle, et rien ne les départage`,
    );
  }
  if (resolution.sorte === "plage_ouverte") {
    return sAbstenir(champ.si_absent, `${quoi} : la borne de plage n'est pas sur la ligne`);
  }
  return champ.facultatif
    ? absent()
    : sAbstenir(champ.si_absent, `${quoi} : aucun jeton ne satisfait la règle`);
}

/* ========================================================= LES TABLEAUX == */

/** Les lignes imprimées d'un ensemble de jetons, de haut en bas. */
function lignesImprimees(ctx: Contexte, jetons: readonly PageToken[]): PageToken[][] {
  const restants = [...jetons].sort((a, b) => a.y0 - b.y0 || a.ordinal - b.ordinal);
  const lignes: PageToken[][] = [];
  for (const t of restants) {
    const ligne = lignes.find((l) => l.some((autre) => memeLigne(ctx, autre, t)));
    if (ligne) ligne.push(t);
    else lignes.push([t]);
  }
  for (const l of lignes) l.sort((a, b) => a.ordinal - b.ordinal);
  return lignes;
}

interface LigneDeTableau {
  readonly page: number;
  readonly jetons: readonly PageToken[];
  /** L'en-tête qui gouverne cette ligne : c'est lui qui porte les colonnes. */
  readonly entete: PageToken;
}

function pagesRetenues(ctx: Contexte, pages: Tableau["pages"]): Set<number> {
  const numeros = [...ctx.parPage.keys()].sort((a, b) => a - b);
  if (pages === "toutes" || pages === "numero") return new Set(numeros);
  const choisi = pages === "premiere" ? numeros[0] : numeros[numeros.length - 1];
  return new Set(choisi === undefined ? [] : [choisi]);
}

/**
 * Les lignes d'un tableau, page après page.
 *
 * Deux cas que le plan exige et qui ne se confondent pas : l'en-tête RÉIMPRIMÉ
 * en haut de chaque page, et le tableau qui CONTINUE page suivante sans que la
 * première se close. Le second est le cas dangereux — sans lui, la moitié des
 * lignes d'une facture de deux pages disparaîtrait en silence.
 */
function lignesDuTableau(ctx: Contexte, tableau: Tableau): LigneDeTableau[] {
  const entetes = occurrencesDeLAncre(ctx, tableau.entete).sort(ordreDeLecture);
  if (entetes.length === 0) return [];
  const fins = tableau.fin === undefined ? [] : occurrencesDeLAncre(ctx, tableau.fin);
  const retenues = pagesRetenues(ctx, tableau.pages);

  const parPage = new Map<number, PageToken>();
  for (const e of entetes) if (!parPage.has(e.page)) parPage.set(e.page, e);

  const premier = entetes[0]!;
  const gouvernantes: Array<{ page: number; entete: PageToken }> = [];
  for (const numero of [...ctx.parPage.keys()].sort((a, b) => a - b)) {
    if (!retenues.has(numero)) continue;
    const propre = parPage.get(numero);
    if (propre && (tableau.entete_repete || numero === premier.page)) {
      gouvernantes.push({ page: numero, entete: propre });
    } else if (tableau.continue_sur_pages_suivantes && numero > premier.page) {
      gouvernantes.push({ page: numero, entete: premier });
    }
  }

  const sortie: LigneDeTableau[] = [];
  for (const { page, entete } of gouvernantes) {
    const jetonsDeLaPage = ctx.parPage.get(page) ?? [];
    const propre = parPage.get(page);
    // Sur une page de continuation, le tableau part du haut : il n'y a pas
    // d'en-tête à franchir, seulement le bord de la boîte de contenu.
    const bas = propre ? Math.max(...ligneDe(ctx, propre).map((t) => t.y1)) : 0;
    const fin = fins.filter((f) => f.page === page && f.y0 >= bas).sort((a, b) => a.y0 - b.y0)[0];
    const plafond = fin ? fin.y0 : Infinity;

    const dedans = jetonsDeLaPage.filter((t) => t.y0 >= bas && t.y1 <= plafond);
    for (const ligne of lignesImprimees(ctx, dedans)) {
      sortie.push({ page, jetons: ligne, entete });
    }
  }
  return sortie;
}

/** Tous les jetons de la ligne imprimée qui porte ce jeton. */
function ligneDe(ctx: Contexte, jeton: PageToken): PageToken[] {
  return (ctx.parPage.get(jeton.page) ?? []).filter((t) => memeLigne(ctx, jeton, t));
}

/**
 * L'en-tête d'une colonne : l'occurrence de son ancre QUI EST SUR LA LIGNE
 * d'en-tête du tableau.
 *
 * Sans cette restriction, la colonne « Total » d'un tableau de facture
 * prendrait le « Total » du pied — imprimé trois fois, plus bas, et dans une
 * autre colonne. C'est le piège ordinaire d'une facture, pas son cas limite.
 */
function enteteDeColonne(ctx: Contexte, nomAncre: string, entete: PageToken): PageToken | null {
  const occurrences = occurrencesDeLAncre(ctx, nomAncre);
  return occurrences.find((t) => memeLigne(ctx, entete, t)) ?? null;
}

/**
 * La cellule d'une colonne dans une ligne : la suite contiguë des jetons de
 * la ligne qui tombent sous l'en-tête de la colonne.
 *
 * Deux jetons contigus sous la même colonne sont DÉSIGNÉS ENSEMBLE, par une
 * plage. C'est la leçon du 18 octobre : n'en citer qu'un ampute le montant, et
 * un montant amputé n'est ni ambigu ni incohérent — il passe tous les
 * contrôles. Deux groupes SÉPARÉS, eux, ne se recollent pas : on ne choisit
 * pas, on le dit.
 */
function cellule(ctx: Contexte, ligne: readonly PageToken[], tete: PageToken): PageToken[][] {
  /*
   * Le recouvrement est jugé SANS la page, ici et seulement ici : sur une
   * page de continuation, l'en-tête gouvernant est resté sur la page
   * précédente, et exiger la même page ferait disparaître toutes les lignes
   * de la suite du tableau — en silence, ce qui est la forme d'erreur que ce
   * dépôt refuse. Les colonnes d'une facture tiennent aux mêmes abscisses
   * d'une page à l'autre ; c'est ce qu'on suppose, et c'est écrit.
   */
  const dedans = ligne
    .filter((t) => serecouvrent(tete.x0, tete.x1, t.x0, t.x1, ctx.parametres.recouvrementDeColonne))
    .sort((a, b) => a.ordinal - b.ordinal);
  const groupes: PageToken[][] = [];
  for (const t of dedans) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier[dernier.length - 1]!.ordinal === t.ordinal - 1) dernier.push(t);
    else groupes.push([t]);
  }
  return groupes;
}

/**
 * Les jetons d'une colonne, TOUTES LIGNES CONFONDUES.
 *
 * Un sélecteur qui part d'une cellule ne nomme pas de ligne — le langage ne
 * lui en donne pas le moyen —, donc il voit la colonne entière. Avec
 * `prendre: unique`, un tableau de plusieurs lignes le rend donc AMBIGU, et
 * c'est la bonne réponse : « la cellule de la colonne Total » ne désigne rien
 * tant qu'on n'a pas dit laquelle.
 */
function cellules(ctx: Contexte, nomTableau: string, nomColonne: string): PageToken[] {
  const tableau = ctx.recette.tableaux[nomTableau];
  const colonne = tableau?.colonnes[nomColonne];
  if (!tableau || !colonne) return [];

  const sortie: PageToken[] = [];
  for (const ligne of lignesDuTableau(ctx, tableau)) {
    const tete = enteteDeColonne(ctx, colonne.entete, ligne.entete);
    if (!tete) continue;
    for (const groupe of cellule(ctx, ligne.jetons, tete)) sortie.push(...groupe);
  }
  return sortie.sort(ordreDeLecture);
}

/**
 * Le résultat d'une cellule, sans fabriquer de champ fictif.
 *
 * Une colonne ne déclare que `si_absent` : son ambiguïté se dit en
 * `DESIGNATION_AMBIGUE`, le seul mot du vocabulaire fermé qui dise « il y en
 * avait trop », là où `TOKEN_NOT_FOUND` dirait le contraire de ce qui s'est
 * passé.
 */
function resultatDeCellule(
  ctx: Contexte,
  nomColonne: string,
  colonne: Tableau["colonnes"][string],
  ligne: LigneDeTableau,
): ResultatDeChamp {
  const tete = enteteDeColonne(ctx, colonne.entete, ligne.entete);
  if (!tete) {
    return colonne.facultatif
      ? absent()
      : sAbstenir(colonne.si_absent, `colonne ${nomColonne} : en-tête introuvable`);
  }
  const groupes = cellule(ctx, ligne.jetons, tete);
  if (groupes.length === 0) {
    return colonne.facultatif
      ? absent()
      : sAbstenir(colonne.si_absent, `colonne ${nomColonne} : cellule vide`);
  }
  if (groupes.length > 1) {
    return sAbstenir(
      AMBIGUITE_DE_CELLULE,
      `colonne ${nomColonne} : ${String(groupes.length)} groupes de jetons dans la cellule`,
    );
  }
  const groupe = groupes[0]!;
  const debut = groupe[0]!;
  if (colonne.etendre) {
    const etendue = etendre(ctx, debut, {
      depuis: { genre: "ancre", motif: { genre: "forme", forme: "mot" } },
      ou: [],
      prendre: { genre: "premier" },
      etendre: colonne.etendre,
    });
    if (etendue.sorte === "plage_ouverte") {
      return sAbstenir(colonne.si_absent, `colonne ${nomColonne} : la borne de plage est absente`);
    }
    if (etendue.sorte === "un") return reference(etendue.debut, etendue.fin);
  }
  return reference(debut, groupe[groupe.length - 1]!);
}

function interpreterLeTableau(
  ctx: Contexte,
  tableau: Tableau,
): Array<Record<string, ResultatDeChamp>> {
  const sortie: Array<Record<string, ResultatDeChamp>> = [];
  for (const ligne of lignesDuTableau(ctx, tableau)) {
    const enregistrement: Record<string, ResultatDeChamp> = {};
    let porteuse = false;
    for (const [nomColonne, colonne] of Object.entries(tableau.colonnes)) {
      const resultat = resultatDeCellule(ctx, nomColonne, colonne, ligne);
      enregistrement[nomColonne] = resultat;
      if ("designe" in resultat || "abstention" in resultat) porteuse = true;
    }
    if (porteuse) sortie.push(enregistrement);
  }
  return sortie;
}

/* ========================================================= L'INTERPRÈTE == */

/**
 * Interprète une recette sur un plan de jetons.
 *
 * Le plan attendu est celui que la chaîne donne au désignateur, donc DÉJÀ
 * passé par `recollerLesMilliers`. Rien n'est lu : chaque champ sort désigné,
 * abstenu, ou absent.
 *
 * Les références libres de la pièce sortent dans `champs`, sous la clé
 * `references.<nom>` — les clés du contrat sont déjà pointées
 * (`totals.base_ht`), donc la convention existe et aucune collision n'est
 * possible avec un champ du contrat.
 */
export function interpreter(
  recette: Recette,
  plan: readonly PageToken[],
  parametres: ParametresDeSignature,
): ResultatDeRecette {
  const ctx = contexte(recette, plan, parametres);

  const champs: Record<string, ResultatDeChamp> = {};
  for (const [nom, champ] of Object.entries(recette.champs)) {
    champs[nom] = versResultat(resoudre(ctx, champ.designation), champ, `champ ${nom}`);
  }
  for (const [nom, champ] of Object.entries(recette.references)) {
    champs[`references.${nom}`] = versResultat(
      resoudre(ctx, champ.designation),
      champ,
      `référence ${nom}`,
    );
  }

  let lignes: Array<Record<string, ResultatDeChamp>> = [];
  let articles: Array<Record<string, ResultatDeChamp>> = [];
  for (const tableau of Object.values(recette.tableaux)) {
    const produites = interpreterLeTableau(ctx, tableau);
    if (tableau.destination === "lignes") lignes = [...lignes, ...produites];
    else articles = [...articles, ...produites];
  }

  return { version: recette.version, champs, lignes, articles };
}
