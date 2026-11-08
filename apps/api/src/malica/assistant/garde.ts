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
  private emis = "";
  private aSeparer = false;

  // Le bloc de texte en cours.
  private tampon = "";
  private emisDuBloc = 0;
  private retenu = false;
  private citationsDuBloc: Array<{ source: SourceConnue; extrait: string }> = [];

  constructor(question: string) {
    // Ce que la personne a écrit elle-même n'est pas une invention de Malica :
    // « ma facture 2417 » se répète sans outil.
    this.chiffresDeLaQuestion = new Set(chiffresDe(question));
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
      if (chiffresDe(phrase).length > 0) {
        // Une phrase chiffrée : tout le reste du bloc attend ses citations.
        this.retenu = true;
        break;
      }
      sortie += phrase;
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
    for (const phrase of phrasesDe(texte)) {
      const chiffres = chiffresDe(phrase);
      if (chiffres.length === 0) {
        aEmettre += phrase;
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
        aEmettre += phrase;
        for (const s of porteuses.values()) this.citees.set(s.cle, s);
      } else {
        retirees.push(phrase.replace(/\s+/g, " ").trim());
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
}
