/**
 * La garde des chiffres — aucun chiffre ne sort sans sa source.
 *
 * ================================================================ LA RÈGLE
 *
 * Tout chiffre qu'affiche « Parler à Malica » provient d'un outil appelé dans
 * CE tour (la base, le moteur de TVA du Socle, le corpus cité) et porte sa
 * source. Une phrase qui porte un chiffre qu'aucune source ne porte est
 * RETIRÉE, et elle ne passe jamais à l'écran. C'est la règle de R2, transposée
 * à la conversation : un chiffre se relit dans ce qu'on a montré au modèle,
 * jamais dans ce qu'il écrit. La même règle tient déjà le conseil cité
 * (`conseil/cite.ts`, `adosserLesChiffres`) ; on en reprend la lecture des
 * nombres (`nombresDe`) pour que les deux disent la même chose d'un chiffre.
 *
 * ============================================================ ET LE STREAMING
 *
 * La réponse s'affiche au fil de l'eau, mais une phrase chiffrée ne peut pas
 * partir avant qu'on sache d'où vient son chiffre — la retirer après coup,
 * c'est l'avoir montrée. D'où la règle d'émission, par bloc de texte :
 *
 *   - une phrase COMPLÈTE sans chiffre part aussitôt ;
 *   - dès qu'une phrase porte un chiffre, le bloc est retenu jusqu'à sa fin
 *     (`content_block_stop`), quand ses citations sont toutes arrivées ;
 *   - alors chaque phrase retenue est jugée : elle part avec ses sources, ou
 *     elle est retirée.
 *
 * Claude découpe une réponse citée en blocs courts (un par passage cité) : un
 * bloc retenu l'est le temps d'une phrase ou deux.
 *
 * ======================================== CE QUI ENGAGE, ET CE QUI N'ENGAGE PAS
 *
 * (11 novembre 2026.) Mesurée sur le vrai modèle, la règle « tout chiffre »
 * vidait les réponses générales : « 17 % de 2 450 » sans résultat, une formule
 * de tableur sans la formule, Ibn Khaldoun sans ses dates. R3 interdit à Malica
 * d'émettre une valeur LIANTE ; une année de naissance n'en est pas une.
 *
 * La garde reçoit donc, de la base (`plateforme.assistant_gardes`, réglable,
 * R4), ce qui rend un chiffre liant :
 *   - par le CONTEXTE : la phrase porte une marque (« % », « TND », « taux »,
 *     « facture », « délai »…) — alors tous ses chiffres se jugent ;
 *   - par la FORME : un nombre à décimales, ou un entier à partir d'un seuil
 *     (un montant) — il se juge où qu'il soit.
 * Le reste — une année, un âge, un rang dans une phrase sans marque — passe.
 * Une formule de tableur (« =A2*(1+B2) ») n'est pas un chiffre : ses références
 * de cellules et ses constantes ne se jugent pas.
 *
 * Sans règle remise (`null`), la garde juge TOUT chiffre, comme avant : une
 * configuration incomplète retombe du côté strict, jamais du côté permissif.
 *
 * Pur : aucun réseau, aucune base. `garde.test.ts` l'éprouve phrase par phrase.
 */

import type { SourceDeLAssistant } from "@malica/socle/ports/assistant";

import { nombresDe } from "../conseil/cite.ts";

/** Une source remise au modèle dans ce tour : ce qu'elle est, et tout son texte. */
export interface SourceConnue extends SourceDeLAssistant {
  /** Tout le texte remis au modèle sous cette source : c'est là qu'un chiffre se relit. */
  texte: string;
}

/** Une citation telle que l'API la rend (`search_result_location`). */
export interface CitationRecue {
  type?: string;
  source?: string;
  cited_text?: string;
  search_result_index?: number;
}

/** Ce qui rend un chiffre liant, lu en base (`plateforme.assistant_gardes`). */
export interface RegleDeLaGarde {
  /**
   * Les marques d'une phrase qui engage. Un mot entier (« taux », « ht »), une
   * racine suivie d'un astérisque (« factur* »), ou un signe (« % », « € »).
   * Écrites en minuscules, sans accent.
   */
  marques_liantes: string[];
  /** Un entier à partir de ce seuil se juge toujours : c'est un montant, pas une année. */
  entier_liant_des: number;
}

const sansAccent = (t: string): string =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");

/** La marque telle qu'elle se cherche : un mot, une racine, ou un signe trouvé tel quel. */
function chercheurDeMarque(marque: string): ((phrase: string) => boolean) | null {
  const m = sansAccent(marque.trim());
  if (!m) return null;
  const racine = m.endsWith("*");
  const corps = racine ? m.slice(0, -1) : m;
  if (!corps) return null;
  // Latin : aux bornes du mot. Tout autre signe ou écriture (« % », arabe, où
  // l'article se colle au mot) : la simple présence.
  if (!/^[a-z0-9' -]+$/.test(corps)) return (phrase) => phrase.includes(corps);
  const motif = corps.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![a-z0-9])${motif}${racine ? "" : "(?![a-z0-9])"}`);
  return (phrase) => re.test(phrase);
}

/**
 * Une formule de tableur n'affirme aucun chiffre : une ligne qui commence par
 * « = » et nomme une cellule, ou un passage entre accents graves qui en nomme
 * une (« `1+B2` », le morceau qu'on explique) ou n'est que l'unité ou le
 * « pour cent » d'une formule (« `1` », « `/100` »). Hors formule, une
 * référence de cellule (« A2 », « $B$4 ») non plus.
 */
/** Une cellule de tableur nommée entre accents graves : « `B2` », « `$B$2` », « `A2 = 1 000` ». */
const CELLULE_NOMMEE = /`[^`\n]*\$?\b[A-Za-z]{1,3}\$?\d{1,7}\b[^`\n]*`/;

/** La puce ou le numéro qui ouvre une ligne de liste, avec son espace. */
const PUCE = /^[ \t]*(?:[-*•]|\d{1,2}[.)])[ \t]+/;

function sansFormules(texte: string): string {
  const cellule = /\$?[A-Za-z]{1,3}\$?\d{1,7}\b/;
  return texte
    .replace(/`([^`\n]*)`/g, (tout, code: string) =>
      cellule.test(code) || /^[\s()+*/=-]*(?:1|100)[\s()+*/=-]*$/.test(code) ? " " : tout,
    )
    .replace(/^[ \t]*=.*$/gm, (ligne) => (cellule.test(ligne) ? " " : ligne))
    .replace(/(?<![\p{L}\d])\$?[A-Za-z]{1,3}\$?\d{1,7}(?![\p{L}\d.,])/gu, " ");
}

/** « 1234.500 » et « 1234.5 » sont le même montant écrit à deux précisions. */
function canonique(n: string): string {
  return n.includes(".") ? n.replace(/0+$/, "").replace(/\.$/, "") : n;
}

/**
 * Le texte d'une phrase, débarrassé de ce que le markdown y met et qui n'est
 * pas un chiffre : le numéro d'une liste ordonnée (« 1. »), les dièses d'un
 * titre, l'emphase.
 */
function sansBalisage(phrase: string): string {
  return phrase
    .replace(/^\s*\d{1,2}[.)]\s+/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "");
}

/** Les nombres d'un texte, sous leur forme comparable. */
export function chiffresDe(texte: string): string[] {
  return [...new Set(nombresDe(sansBalisage(texte)).map(canonique))];
}

/**
 * Les phrases d'un texte, séparateurs compris (recollées, elles rendent le
 * texte à l'identique). Une fin de phrase est un point final, un point
 * d'exclamation ou d'interrogation (latin ou arabe) suivi d'un blanc, ou un
 * saut de ligne. « art. 49 », « n° 12 », « 1.5 » ne coupent pas.
 */
export function phrasesDe(texte: string): string[] {
  const morceaux: string[] = [];
  const fin = /(?<!\b(?:art|al|n°|cf|M|Mme|ex|p))[.!?؟](?=\s)|\n/gu;
  let debut = 0;
  for (const m of texte.matchAll(fin)) {
    let i = m.index + m[0].length;
    // Les blancs qui suivent appartiennent à la phrase qui se termine.
    while (i < texte.length && /[ \t]/.test(texte[i]!)) i += 1;
    if (i > debut) morceaux.push(texte.slice(debut, i));
    debut = i;
  }
  if (debut < texte.length) morceaux.push(texte.slice(debut));
  return morceaux;
}

/** La dernière fin de phrase complète d'un tampon : tout ce qui précède peut être jugé. */
function finDeLaDernierePhrase(texte: string): number {
  const morceaux = phrasesDe(texte);
  if (morceaux.length === 0) return 0;
  const dernier = morceaux[morceaux.length - 1]!;
  const complet = /([.!?؟]\s+|\n)$/u.test(dernier);
  return complet ? texte.length : texte.length - dernier.length;
}

/**
 * Un nombre immédiatement suivi d'une unité de taux ou de durée. Les unités
 * viennent de la base (`plateforme.assistant_relectures.unites_marquables`) ;
 * un mot se borne à ses limites, un signe (« % ») se lit tel quel.
 */
function chercheurDeMarquables(unites: readonly string[]): RegExp | null {
  const formes = unites
    .map((u) => u.trim())
    .filter((u) => u !== "")
    .map((u) => {
      const sur = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /^[\p{L}\p{M}' ]+$/u.test(u) ? `${sur}(?![\\p{L}\\p{M}])` : sur;
    });
  if (formes.length === 0) return null;
  return new RegExp(
    `\\d[\\d\\s\u00a0\u202f]*(?:[.,]\\d+)?[\\s\u00a0\u202f]*(?:${formes.join("|")})`,
    "giu",
  );
}

export interface Jugement {
  /** Ce qui part à l'écran maintenant. */
  aEmettre: string;
  /** Les phrases retirées : un de leurs chiffres n'avait aucune source. */
  retirees: string[];
}

export class GardeDesChiffres {
  /** Dans l'ordre où le modèle les a reçues : l'index est le `search_result_index`. */
  private readonly sources: SourceConnue[] = [];
  private readonly chiffresDeLaQuestion: Set<string>;
  private readonly citees = new Map<string, SourceConnue>();
  private readonly retireesDuTour: string[] = [];
  private readonly marqueesDuTour: string[] = [];
  /** La marque d'un chiffre sans source ; `null` : la phrase est retirée. */
  private marque: string | null = null;
  /** Reconnaît « un nombre suivi d'une unité de taux ou de durée » ; `null` : rien ne se marque. */
  private marquable: RegExp | null = null;
  /** Les noms de la mécanique (outils) : une phrase qui en porte un ne part pas. */
  private tus: string[] = [];
  private readonly tuesDuTour: string[] = [];
  private emis = "";
  private aSeparer = false;

  // Le bloc de texte en cours.
  private tampon = "";
  private emisDuBloc = 0;
  private retenu = false;
  private citationsDuBloc: Array<{ source: SourceConnue; extrait: string }> = [];

  private readonly marques: Array<(phrase: string) => boolean>;
  private readonly entierLiantDes: number | null;

  constructor(question: string, regle: RegleDeLaGarde | null = null) {
    // Ce que la personne a écrit elle-même n'est pas une invention de Malica :
    // « ma facture 2417 » se répète sans outil.
    this.chiffresDeLaQuestion = new Set(chiffresDe(question));
    this.marques = (regle?.marques_liantes ?? [])
      .map(chercheurDeMarque)
      .filter((c): c is (phrase: string) => boolean => c !== null);
    // Sans règle complète : tout chiffre se juge.
    this.entierLiantDes =
      regle && this.marques.length > 0 && Number.isFinite(regle.entier_liant_des)
        ? regle.entier_liant_des
        : null;
  }

  /** Les chiffres d'une phrase qui doivent trouver une source (voir l'en-tête). */
  private aJuger(phrase: string): string[] {
    if (this.entierLiantDes === null) return chiffresDe(phrase);
    // Une phrase qui nomme une cellule entre accents graves parle du tableur :
    // ses nombres sont des valeurs à saisir ou un exemple (« saisissez le taux
    // dans `B2`, en pourcentage (10 %) ou en décimale (0,10) »), pas un chiffre
    // du dossier ni du droit. Mesuré le 11 novembre 2026 : ces phrases-là
    // tombaient, et l'explication d'une formule sortait amputée.
    if (CELLULE_NOMMEE.test(phrase)) return [];
    const chiffres = chiffresDe(sansFormules(phrase));
    if (chiffres.length === 0) return chiffres;
    const cherchee = sansAccent(phrase);
    if (this.marques.some((trouve) => trouve(cherchee))) return chiffres;
    const seuil = this.entierLiantDes;
    return chiffres.filter((n) => n.includes(".") || Number(n) >= seuil);
  }

  /**
   * Les noms que la personne ne doit jamais lire — ceux des outils. Mesuré le
   * 11 novembre 2026 : le modèle a écrit en clair « Calling afficher_visuel on
   * that source is what they're asking for ». Une phrase qui porte l'un de ces
   * noms est du raisonnement échappé : elle est tue, sans être comptée parmi
   * les chiffres retirés.
   */
  taire(noms: readonly string[]): void {
    // Seuls les identifiants : « calculer » est aussi un mot de tous les jours.
    this.tus = noms.map((n) => n.trim().toLowerCase()).filter((n) => n.includes("_"));
  }

  private estTue(phrase: string): boolean {
    if (this.tus.length === 0) return false;
    // « afficher\_visuel » : le soulignement échappé du markdown ne cache pas le nom.
    const p = phrase.toLowerCase().replaceAll("\\", "");
    if (!this.tus.some((n) => p.includes(n))) return false;
    this.tuesDuTour.push(phrase.replace(/\s+/g, " ").trim());
    return true;
  }

  /** Les phrases tues parce qu'elles nommaient la mécanique. */
  tues(): string[] {
    return [...this.tuesDuTour];
  }

  /**
   * À partir d'ici, une phrase au chiffre liant sans source n'est plus retirée :
   * elle part avec cette marque (« non vérifié »). L'agent ne l'appelle que
   * lorsque le corpus, consulté dans ce tour, n'a pas répondu (M-9).
   */
  marquerSansSource(marque: string, unites: readonly string[]): void {
    this.marque = marque.trim() || null;
    this.marquable = chercheurDeMarquables(unites);
  }

  /**
   * La phrase peut-elle partir marquée ? Seulement si, une fois ôtés ses taux
   * et ses durées (« 19 % », « 28 jours »), il ne lui reste aucun chiffre sans
   * source. Un montant du dossier ou le résultat d'un calcul fait de tête
   * restent donc retirés (R2, R3) : la marque ne couvre que ce que le dirigeant
   * a admis le 11 novembre 2026 — un taux, un délai.
   */
  private peutPartirMarquee(phrase: string): boolean {
    if (!this.marque || !this.marquable) return false;
    const reste = phrase.replace(this.marquable, " ");
    if (reste === phrase) return false;
    return this.aJuger(reste).every(
      (n) =>
        this.chiffresDeLaQuestion.has(n) ||
        this.sources.some((s) => chiffresDe(`${s.titre}\n${s.texte}`).includes(n)),
    );
  }

  /** Une source remise au modèle ; rend son `search_result_index`. */
  ajouterSource(source: SourceConnue): number {
    this.sources.push(source);
    return this.sources.length - 1;
  }

  /** Les sources de ce tour, dans l'ordre. */
  toutesLesSources(): readonly SourceConnue[] {
    return this.sources;
  }

  ouvrirBloc(): void {
    this.tampon = "";
    this.emisDuBloc = 0;
    this.retenu = false;
    this.citationsDuBloc = [];
  }

  /**
   * Une citation du bloc en cours. Elle tient si son index désigne une source
   * remise ET si sa clé est celle de cette source — sinon elle tombe (la même
   * relecture que `lireLaReponseCitee`).
   */
  recevoirCitation(c: CitationRecue): boolean {
    const i = c.search_result_index;
    const source = typeof i === "number" && Number.isInteger(i) ? this.sources[i] : undefined;
    if (c.type !== "search_result_location" || !source || c.source !== source.cle) return false;
    this.citationsDuBloc.push({ source, extrait: c.cited_text ?? "" });
    return true;
  }

  /** Un morceau de texte du bloc ; rend ce qui peut partir maintenant. */
  recevoirTexte(delta: string): string {
    this.tampon += delta;
    if (this.retenu) return "";
    const jusqua = finDeLaDernierePhrase(this.tampon);
    if (jusqua <= this.emisDuBloc) return "";
    let sortie = "";
    let position = this.emisDuBloc;
    for (const phrase of phrasesDe(this.tampon.slice(this.emisDuBloc, jusqua))) {
      if (this.aJuger(phrase).length > 0) {
        // Une phrase au chiffre liant : tout le reste du bloc attend ses citations.
        this.retenu = true;
        break;
      }
      if (!this.estTue(phrase)) sortie += phrase;
      position += phrase.length;
    }
    this.emisDuBloc = position;
    return this.sortir(sortie);
  }

  /** La fin du bloc : ce qui restait est jugé, phrase par phrase. */
  fermerBloc(): Jugement {
    const reste = this.tampon.slice(this.emisDuBloc);
    const jugement = this.juger(reste, this.citationsDuBloc);
    this.ouvrirBloc();
    return { ...jugement, aEmettre: this.sortir(jugement.aEmettre) };
  }

  /**
   * Juger un texte entier d'un coup — la réponse d'un modèle de repli, qui
   * n'arrive pas en flux. Mêmes règles, sans citations de bloc.
   */
  jugerTout(texte: string): Jugement {
    const jugement = this.juger(texte, []);
    return { ...jugement, aEmettre: this.sortir(jugement.aEmettre) };
  }

  private juger(
    texte: string,
    citations: ReadonlyArray<{ source: SourceConnue; extrait: string }>,
  ): Jugement {
    let aEmettre = "";
    const retirees: string[] = [];
    for (const s of citations) this.citees.set(s.source.cle, s.source);
    /*
     * RECOUDRE CE QU'UNE PHRASE RETIRÉE LAISSE. Mesuré le 11 novembre 2026 : une
     * phrase retirée seule dans son paragraphe laissait deux lignes vides de
     * trop, et une phrase retirée en tête d'une puce emportait la puce — la
     * suite de la ligne restait sans son tiret (« Négociez donnant-donnant. »
     * au milieu d'une liste). Après un retrait en début de ligne, les sauts de
     * ligne qui suivent tombent donc avec lui ; et la puce d'une phrase retirée
     * passe à la phrase qui la suit sur la même ligne.
     */
    let sautsATaire = false;
    let puceEnAttente = "";
    const garder = (phrase: string): void => {
      aEmettre += puceEnAttente + phrase;
      puceEnAttente = "";
      sautsATaire = false;
    };
    const retirer = (phrase: string): void => {
      retirees.push(phrase.replace(/\s+/g, " ").trim());
      const dit = this.emis + aEmettre;
      const enDebutDeLigne = dit === "" || /\n[ \t]*$/.test(dit);
      puceEnAttente = enDebutDeLigne ? (PUCE.exec(phrase)?.[0] ?? "") : "";
      sautsATaire = enDebutDeLigne;
    };
    for (const phrase of phrasesDe(texte)) {
      if (this.estTue(phrase)) continue;
      if (phrase.trim() === "") {
        // Un saut de ligne : il clôt la ligne de la puce, et ne s'ajoute pas au trou.
        puceEnAttente = "";
        if (!sautsATaire) aEmettre += phrase;
        continue;
      }
      const chiffres = this.aJuger(phrase);
      if (chiffres.length === 0) {
        garder(phrase);
        continue;
      }
      const porteuses = new Map<string, SourceConnue>();
      let toutPorte = true;
      for (const n of chiffres) {
        if (this.chiffresDeLaQuestion.has(n)) continue;
        // D'abord ce que le bloc cite : la source la plus précise.
        const citee = citations.find((c) => chiffresDe(c.extrait).includes(n));
        if (citee) {
          porteuses.set(citee.source.cle, citee.source);
          continue;
        }
        // Puis toute source remise dans ce tour, titre compris.
        const remise = this.sources.find((s) => chiffresDe(`${s.titre}\n${s.texte}`).includes(n));
        if (remise) {
          porteuses.set(remise.cle, remise);
          continue;
        }
        toutPorte = false;
        break;
      }
      if (toutPorte) {
        garder(phrase);
        for (const s of porteuses.values()) this.citees.set(s.cle, s);
      } else if (this.marque && this.peutPartirMarquee(phrase)) {
        const corps = phrase.trimEnd();
        // Le modèle l'écrit parfois lui-même, malgré la consigne (« 18 % (non
        // vérifié) », relevé le 11 novembre 2026) : la marque ne se dit qu'une fois.
        const motsDeLaMarque = sansAccent(this.marque.replace(/[_*()]/g, "").trim());
        const dejaDite = motsDeLaMarque !== "" && sansAccent(corps).includes(motsDeLaMarque);
        garder(dejaDite ? phrase : `${corps} ${this.marque}${phrase.slice(corps.length)}`);
        this.marqueesDuTour.push(corps.replace(/\s+/g, " ").trim());
      } else {
        retirer(phrase);
      }
    }
    this.retireesDuTour.push(...retirees);
    return { aEmettre, retirees };
  }

  /**
   * Un tour nouveau de la boucle d'outils commence : son premier mot montré
   * sera précédé d'un saut de paragraphe, pour que la phrase d'annonce
   * (« Je regarde vos pièces. ») et la réponse ne se collent pas.
   */
  nouveauTour(): void {
    this.aSeparer = this.emis.trim() !== "" && !/\s$/.test(this.emis);
  }

  /** Ce qui part : le saut de paragraphe dû, puis le texte ; compté dans ce qui a été dit. */
  private sortir(texte: string): string {
    if (!texte) return "";
    const sortie = this.aSeparer ? `\n\n${texte}` : texte;
    this.aSeparer = false;
    this.emis += sortie;
    return sortie;
  }

  /** La réponse telle que la personne l'a lue. */
  texteEmis(): string {
    return this.emis.trim();
  }

  /** Les sources effectivement citées ou portant un chiffre de la réponse. */
  sourcesCitees(): SourceConnue[] {
    return [...this.citees.values()];
  }

  retirees(): string[] {
    return [...this.retireesDuTour];
  }

  /** Les phrases parties avec la marque « non vérifié ». */
  marquees(): string[] {
    return [...this.marqueesDuTour];
  }
}
