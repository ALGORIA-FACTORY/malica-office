/**
 * Le courriel d'une notification — les 35 genres d'événement et les relances
 * d'impayé, dans le cadre commun (`courriel/cadre.ts`, maquettes du 13 novembre).
 *
 * Fonction pure. Le titre et le corps sont ceux que la base a rendus depuis le
 * gabarit `email` du genre, dans la langue de la personne. Le ton du gabarit
 * (succès, alerte, erreur, en cours, neutre) devient le signal de l'étiquette ;
 * le mot de l'étiquette dit la famille du genre (mandat, pièce, abonnement…).
 * L'habillage vient du dictionnaire du Socle, dans la même langue : rien n'est
 * écrit ici en français, et un courriel arabe se lit de droite à gauche.
 */
import { LOCALES, MESSAGES, type Locale } from "@malica/socle/messages";

import { cadreDeCourriel, type Signal } from "../courriel/cadre.ts";
import { echapper } from "../courriel/charte.ts";

/** Le ton d'un gabarit, tel que la base le garde. */
export const TONS = ["neutre", "succes", "erreur", "alerte", "en_cours"] as const;
type Ton = (typeof TONS)[number];

const SIGNAL_DU_TON: Record<Ton, Signal> = {
  succes: "fait",
  alerte: "attend",
  erreur: "retard",
  en_cours: "info",
  neutre: "neutre",
};

/** Les familles qui ont leur mot d'étiquette ; les autres portent « Malica ». */
const FAMILLES = ["acces", "conseil", "mandat", "piece", "place", "impaye"] as const;
type Famille = (typeof FAMILLES)[number];

export interface Notification {
  locale: string;
  /** Le genre de l'événement (`mandat.accepte`, `impaye.rappel`…). */
  code: string;
  titre: string;
  corps: string;
  action: { libelle: string; url: string } | null;
  ton: string;
  /** La société que l'événement concerne, s'il en concerne une. */
  organisation: string | null;
  /** L'adresse publique de l'appli (repère, lien des réglages). */
  urlPublique: string;
}

function langue(locale: string): Locale {
  return (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : "fr";
}

function tonConnu(ton: string): Ton {
  // Pas de repli : un ton inconnu est une erreur de gabarit, la base le refuse déjà.
  if ((TONS as readonly string[]).includes(ton)) return ton as Ton;
  throw new Error(`ton de courriel inconnu : ${ton}`);
}

function famille(code: string): Famille | "autre" {
  const f = code.split(".")[0] ?? "";
  return (FAMILLES as readonly string[]).includes(f) ? (f as Famille) : "autre";
}

export function courrielDeNotification(n: Notification): {
  sujet: string;
  html: string;
  texte: string;
} {
  const loc = langue(n.locale);
  const m = MESSAGES[loc];
  const signal = SIGNAL_DU_TON[tonConnu(n.ton)];
  // C'est Malica qui parle à la première personne dans les relances d'impayé.
  const parleMalica = n.code.startsWith("impaye.");

  const html = cadreDeCourriel({
    locale: loc,
    urlPublique: n.urlPublique,
    apercu: n.corps,
    organisation: n.organisation,
    etiquette: { texte: m[`courriel.etiquette.${famille(n.code)}`], signal },
    titre: n.titre,
    // Le corps vient de la base : échappé avant d'entrer dans le HTML.
    paragraphesHtml: [echapper(n.corps)],
    action: n.action,
    signature: parleMalica,
    raison: m["courriel.notif.pied"],
  });

  const texte = [
    n.titre,
    "",
    n.corps,
    ...(n.action ? ["", `${n.action.libelle} :`, n.action.url] : []),
    "",
    m["courriel.notif.pied"],
    parleMalica ? m["courriel.cadre.signature"] : "— Malica Office",
  ].join("\n");

  return { sujet: n.titre, html, texte };
}
