/**
 * Le courriel d'une notification — les 35 genres d'événement et les relances
 * d'impayé, dans le cadre commun (`courriel/cadre.ts`, maquettes du 13 novembre).
 *
 * Fonction pure. Le titre et le corps sont ceux que la base a rendus depuis le
 * gabarit `email` du genre, dans la langue de la personne. Le ton du gabarit
 * devient le signal de l'étiquette. Tous les autres textes (étiquette, pied,
 * frise, lien de secours, signature) viennent de `notif.libelles_courriel`,
 * dans la même langue : le code n'en écrit aucun.
 */
import { LOCALES, type Locale } from "@malica/socle/messages";

import { cadreDeCourriel, type Frise, type Signal } from "../courriel/cadre.ts";
import { echapper } from "../courriel/charte.ts";
import { libelle, libelleSiPresent, type Libelles } from "../courriel/libelles.ts";

/** Une ligne de la carte du genre, telle que la file la rend (`notif.cartes_courriel`). */
export interface LigneDeCarte {
  genre: "passage" | "montant" | "ligne";
  /** Clés de `notif.libelles_courriel` ; leurs jetons viennent des données de l'événement. */
  libelle: string;
  valeur: string;
}

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

/** Un palier de l'impayé, tel que la file le rend (`notif.paliers_impaye`). */
export interface Palier {
  code: string;
  signal: "attend" | "retard";
  /** Le jour du palier, tiré du calendrier de recouvrement en vigueur. */
  jour: number | null;
  /** À ce palier, on peut répondre plutôt que payer (E34). */
  repondre: boolean;
}

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
  /** Les textes du cadre, dans la langue du message. */
  libelles: Libelles;
  /** Ce que l'événement a porté (`notif.envois.donnees`) : numéro, montant, devise… */
  donnees?: Record<string, unknown> | null;
  /** Les paliers de l'impayé, dans l'ordre ; absents pour les autres genres. */
  frise?: readonly Palier[] | null;
  /** L'adresse à laquelle on peut répondre (« Répondre à ce message »). */
  repondreA?: string | null;
  /** L'objet du gabarit, avec ses jetons (`{{numero}}`) ; absent, l'objet est le titre. */
  sujet?: string | null;
  /** La carte du genre (offre, droits, montant) ; absente pour la plupart des genres. */
  carte?: readonly LigneDeCarte[] | null;
}

/** Les noms que le corps met en gras, s'ils y paraissent (maquettes : « **Mejri Expertise** a monté… »). */
const NOMS = ["cabinet", "client", "societe", "invitant", "offre"] as const;

/** Remplit les jetons depuis les données ; `null` si l'un manque — la ligne ne s'affiche pas. */
function rempli(texte: string, donnees: Record<string, unknown> | null | undefined): string | null {
  let manque = false;
  const r = texte.replace(/\{\{(\w+)\}\}/g, (_, cle: string) => {
    const v = valeur(donnees?.[cle]);
    if (v === null) manque = true;
    return v ?? "";
  });
  return manque ? null : r;
}

function valeur(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;
}

/** La carte : le passage d'une offre à l'autre, la somme, puis les lignes — chacune si ses jetons existent. */
function carteDuGenre(n: Notification, l: Libelles) {
  let passage: { de: string; a: string } | null = null;
  let montant: { valeur: string; unite: string } | null = null;
  const donnees: { libelle: string; valeur: string }[] = [];
  for (const c of n.carte ?? []) {
    const gauche = rempli(libelle(l, c.libelle), n.donnees);
    const droite = rempli(libelle(l, c.valeur), n.donnees);
    if (gauche === null || droite === null) continue;
    if (c.genre === "passage") passage = { de: gauche, a: droite };
    else if (c.genre === "montant") montant = { valeur: droite, unite: gauche };
    else donnees.push({ libelle: gauche, valeur: droite });
  }
  return { passage, montant, donnees };
}

/** Le corps, échappé, les noms de l'événement en gras. */
function corpsHtml(n: Notification): string {
  let html = echapper(n.corps);
  const noms = NOMS.map((k) => valeur(n.donnees?.[k]))
    .filter((v): v is string => v !== null)
    .sort((a, b) => b.length - a.length);
  for (const nom of new Set(noms)) {
    const e = echapper(nom);
    html = html.split(e).join(`<strong class="m-tx" style="font-weight:600;">${e}</strong>`);
  }
  // En français, la ponctuation double ne commence jamais une ligne : espace insécable.
  return n.locale === "fr" ? html.replace(/ ([:;?!])/g, "&nbsp;$1") : html;
}

/**
 * L'objet : celui du gabarit, ses jetons remplis par les données de l'événement.
 * Un jeton sans valeur, et l'objet redevient le titre : un objet troué ne part pas.
 */
function objet(n: Notification): string {
  if (!n.sujet) return n.titre;
  const rempli = n.sujet.replace(
    /\{\{(\w+)\}\}/g,
    (tout, cle: string) => valeur(n.donnees?.[cle]) ?? tout,
  );
  return /\{\{/.test(rempli) ? n.titre : rempli;
}

/** La carte de l'impayé : la facture, le reste dû, et où l'on en est des paliers. */
function friseDImpaye(n: Notification, l: Libelles): Frise | null {
  const paliers = n.frise ?? [];
  const i = paliers.findIndex((p) => p.code === n.code);
  const numero = valeur(n.donnees?.["numero"]);
  const reste = valeur(n.donnees?.["reste"]);
  const devise = valeur(n.donnees?.["devise"]);
  if (i < 0 || !numero || !reste || !devise) return null;
  return {
    reference: `${numero} · ${libelle(l, "frise.resteDu")}`,
    montant: reste,
    devise,
    etapes: paliers.map((p, k) => ({
      libelle: libelle(l, `frise.${p.code}`),
      jour: typeof p.jour === "number" ? `J+${p.jour}` : null,
      atteinte: k <= i,
      signal: p.signal,
      courante: k === i,
    })),
  };
}

/** Le texte le plus propre : celui du genre, sinon celui de sa famille, sinon le général. */
function propre(l: Libelles, prefixe: string, code: string, general: string): string {
  const famille = code.split(".")[0] ?? "";
  return (
    libelleSiPresent(l, `${prefixe}.${code}`) ??
    libelleSiPresent(l, `${prefixe}.${famille}`) ??
    libelle(l, general)
  );
}

function langue(locale: string): Locale {
  return (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : "fr";
}

function tonConnu(ton: string): Ton {
  // Pas de repli : un ton inconnu est une erreur de gabarit, la base le refuse déjà.
  if ((TONS as readonly string[]).includes(ton)) return ton as Ton;
  throw new Error(`ton de courriel inconnu : ${ton}`);
}

export function courrielDeNotification(n: Notification): {
  sujet: string;
  html: string;
  texte: string;
} {
  const loc = langue(n.locale);
  const l = n.libelles;
  const signal = SIGNAL_DU_TON[tonConnu(n.ton)];
  const palier = n.frise?.find((p) => p.code === n.code) ?? null;
  // Dans les relances d'impayé, c'est Malica qui parle à la première personne : elle signe.
  const parleMalica = palier !== null;
  // La raison et l'aperçu propres au genre, remplis par l'événement ; un jeton manque, le général.
  const raison =
    rempli(propre(l, "raison", n.code, "cadre.raison"), n.donnees) ?? libelle(l, "cadre.raison");
  const apercuPropre = libelleSiPresent(l, `apercu.${n.code}`);
  const apercu = (apercuPropre && rempli(apercuPropre, n.donnees)) ?? n.corps;
  const carte = carteDuGenre(n, l);

  const html = cadreDeCourriel({
    locale: loc,
    libelles: l,
    urlPublique: n.urlPublique,
    apercu,
    organisation: n.organisation,
    etiquette: { texte: propre(l, "etiquette", n.code, "etiquette.autre"), signal },
    titre: n.titre,
    // Le corps vient de la base : échappé avant d'entrer dans le HTML.
    paragraphesHtml: [corpsHtml(n)],
    frise: friseDImpaye(n, l),
    passage: carte.passage,
    montant: carte.montant,
    donnees: carte.donnees,
    action: n.action,
    actionSecondaire:
      palier?.repondre && n.repondreA
        ? { libelle: libelle(l, "cadre.repondre"), url: `mailto:${n.repondreA}` }
        : null,
    signature: parleMalica,
    raison,
  });

  const corpsTexte = [
    n.titre,
    "",
    n.corps,
    ...(n.action ? ["", n.action.libelle, n.action.url] : []),
    "",
    raison,
    libelle(l, parleMalica ? "cadre.signature" : "cadre.signatureTexte"),
  ].join("\n");

  return { sujet: objet(n), html, texte: corpsTexte };
}
