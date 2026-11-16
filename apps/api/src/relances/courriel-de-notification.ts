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

import { cadreDeCourriel, type Frise, type Signal } from "../courriel/cadre.ts";
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
  /** Ce que l'événement a porté (`notif.envois.donnees`) : numéro, montant, devise… */
  donnees?: Record<string, unknown> | null;
  /** Les jours du recouvrement en vigueur (`recouvrement.*_jours`), pour la frise d'impayé. */
  calendrier?: Record<string, number> | null;
  /** L'adresse à laquelle on peut répondre (« Répondre à ce message »). */
  repondreA?: string | null;
  /** L'objet du gabarit, avec ses jetons (`{{numero}}`) ; absent, l'objet est le titre. */
  sujet?: string | null;
}

/**
 * L'objet : celui du gabarit, ses jetons remplis par les données de l'événement.
 * Un jeton sans valeur, et l'objet redevient le titre : un objet troué ne part pas.
 */
function objet(n: Notification): string {
  if (!n.sujet) return n.titre;
  const rempli = n.sujet.replace(
    /\{\{(\w+)\}\}/g,
    (tout, cle: string) => texte(n.donnees?.[cle]) ?? tout,
  );
  return /\{\{/.test(rempli) ? n.titre : rempli;
}

/** Les paliers de l'impayé, dans l'ordre, et le jour de chacun dans le calendrier. */
const PALIERS = [
  {
    code: "impaye.rappel",
    signal: "attend",
    libelle: "courriel.frise.echue",
    jour: "recouvrement.rappel_jours",
  },
  {
    code: "impaye.relance",
    signal: "attend",
    libelle: "courriel.frise.relance",
    jour: "recouvrement.relance_jours",
  },
  {
    code: "impaye.avis_de_suspension",
    signal: "retard",
    libelle: "courriel.frise.avis",
    jour: "recouvrement.avis_suspension_jours",
  },
  {
    code: "impaye.suspension",
    signal: "retard",
    libelle: "courriel.frise.suspension",
    jour: "recouvrement.suspension_jours",
  },
] as const;

function texte(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;
}

/**
 * La frise d'un impayé (maquettes E33 à E36) : la facture, le reste dû, et les
 * quatre paliers. Sans numéro ni montant, pas de frise : on n'invente rien.
 */
function friseDImpaye(n: Notification, m: (typeof MESSAGES)[Locale]): Frise | null {
  const i = PALIERS.findIndex((p) => p.code === n.code);
  const numero = texte(n.donnees?.["numero"]);
  const reste = texte(n.donnees?.["reste"]);
  const devise = texte(n.donnees?.["devise"]);
  if (i < 0 || !numero || !reste || !devise) return null;
  return {
    reference: `${numero} · ${m["courriel.frise.resteDu"]}`,
    montant: reste,
    devise,
    etapes: PALIERS.map((p, k) => {
      const jours = n.calendrier?.[p.jour];
      return {
        libelle: m[p.libelle],
        jour: typeof jours === "number" ? `J+${jours}` : null,
        atteinte: k <= i,
        signal: p.signal,
        courante: k === i,
      };
    }),
  };
}

/** L'étiquette propre au genre quand la maquette en donne une ; sinon le mot de sa famille. */
function etiquette(code: string, m: (typeof MESSAGES)[Locale]): string {
  const propre = (m as Record<string, string>)[`courriel.etiquette.${code}`];
  return propre ?? m[`courriel.etiquette.${famille(code)}`];
}

/** La raison du pied : propre au genre (« Une facture de votre abonnement reste due. »), sinon la générale. */
function raison(code: string, m: (typeof MESSAGES)[Locale]): string {
  const genre = code.startsWith("impaye.") ? "impaye" : code;
  return (m as Record<string, string>)[`courriel.raison.${genre}`] ?? m["courriel.notif.pied"];
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
    etiquette: { texte: etiquette(n.code, m), signal },
    titre: n.titre,
    // Le corps vient de la base : échappé avant d'entrer dans le HTML.
    paragraphesHtml: [echapper(n.corps)],
    frise: friseDImpaye(n, m),
    action: n.action,
    // E34 : à la relance, on peut répondre plutôt que payer — « on trouve une solution ».
    actionSecondaire:
      n.code === "impaye.relance" && n.repondreA
        ? { libelle: m["courriel.repondre"], url: `mailto:${n.repondreA}` }
        : null,
    signature: parleMalica,
    raison: raison(n.code, m),
  });

  const corpsTexte = [
    n.titre,
    "",
    n.corps,
    ...(n.action ? ["", `${n.action.libelle} :`, n.action.url] : []),
    "",
    m["courriel.notif.pied"],
    parleMalica ? m["courriel.cadre.signature"] : "— Malica Office",
  ].join("\n");

  return { sujet: objet(n), html, texte: corpsTexte };
}
