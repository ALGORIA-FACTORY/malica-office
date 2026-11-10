/**
 * Les blocs d'une réponse, composés par le SERVEUR.
 *
 * ================================================================= POURQUOI ICI
 *
 * Un chiffre qui s'affiche en grand, dans un tableau ou dans une tuile, est un
 * chiffre liant : il vient d'un moteur du Socle ou de la base (R3), jamais du
 * modèle. Le modèle ne fait que DÉSIGNER ce qu'il veut montrer
 * (`afficher_visuel`, par la clé d'une source qu'un outil vient de lui rendre) ;
 * le serveur compose le bloc à partir des données de cet outil, formate les
 * montants à la précision de la devise et traduit les libellés (R12). L'écran
 * ne calcule rien, ne reformate rien, et le même bloc sert quelle que soit la
 * machine qui répond.
 *
 * Ces fonctions sont pures : elles reçoivent des valeurs et rendent des valeurs.
 */

import type { BlocDeReponse, ChiffreDeBloc } from "@malica/socle/ports/assistant";
import { texte } from "@malica/socle/conseil";

/** Les nombres s'écrivent à l'occidentale en arabe aussi (usage tunisien). */
const LOCALE_DES_NOMBRES: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  ar: "ar-TN-u-nu-latn",
};

/** Un montant à la précision de la devise : « 1 800,000 » en français, « 1,800.000 » en anglais. */
export function montant(valeur: number | string, decimales: number, langue: string): string {
  const n = typeof valeur === "string" ? Number(valeur) : valeur;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(LOCALE_DES_NOMBRES[langue] ?? "fr-FR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n);
}

/** « novembre 2026 » : le mois d'une période AAAA-MM, dans la langue de la personne. */
export function moisEnClair(periode: string, langue: string): string {
  const [a, m] = periode.split("-").map(Number);
  if (!a || !m) return periode;
  const nom = new Intl.DateTimeFormat(LOCALE_DES_NOMBRES[langue] ?? "fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, 1)));
  return nom.charAt(0).toLocaleUpperCase(langue === "ar" ? "ar" : langue) + nom.slice(1);
}

/** « 28/10/2026 » : un jour AAAA-MM-JJ, écrit à l'usage de la langue ; tel quel s'il est illisible. */
export function jourEnClair(jour: string, langue: string): string {
  const [a, m, j] = jour.split("-").map(Number);
  if (!a || !m || !j) return jour;
  return new Intl.DateTimeFormat(LOCALE_DES_NOMBRES[langue] ?? "fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, j)));
}

/** Ce que le moteur de TVA rend, réduit à ce que le bloc lit. */
export interface TvaDuMois {
  period: string;
  /** Le code de la devise du dossier. */
  currency: string;
  totals: { collectee: string; deductible: string; solde: string };
}

export function blocDeLaTva(
  tva: TvaDuMois,
  /** Les décimales de la devise, lues au référentiel (R4). */
  dec: number,
  piecesPrisesEnCompte: number,
  perimetre: string | null,
  langue: string,
): BlocDeReponse {
  const solde = Number(tva.totals.solde);
  const chiffre = (cle: Parameters<typeof texte>[1], v: string, ton: ChiffreDeBloc["ton"]) => ({
    libelle: texte(langue, cle),
    valeur: montant(v, dec, langue),
    unite: tva.currency,
    ton,
  });
  // Un crédit est la bonne nouvelle d'un dossier ; une TVA à payer se dit sans la colorer.
  const enCredit = solde < 0;
  return {
    type: "reponse_cle",
    titre: texte(langue, "pme.bloc.tva.titre"),
    periode: moisEnClair(tva.period, langue),
    perimetre,
    source: texte(langue, "pme.bloc.tva.source", { n: piecesPrisesEnCompte }),
    cle: {
      libelle: texte(langue, enCredit ? "pme.bloc.tva.credit" : "pme.bloc.tva.apayer"),
      valeur: montant(Math.abs(solde), dec, langue),
      unite: tva.currency,
      ton: enCredit ? "positif" : "neutre",
    },
    details: [
      chiffre("pme.bloc.tva.collectee", tva.totals.collectee, "neutre"),
      chiffre("pme.bloc.tva.deductible", tva.totals.deductible, "neutre"),
    ],
  };
}

export interface EcheanceDuCalendrier {
  label: string;
  dueDate: string;
  status: string;
}

/** Le calendrier fiscal d'un dossier : une ligne par échéance, l'état dit par le serveur. */
export function blocDesEcheances(
  echeances: readonly EcheanceDuCalendrier[],
  aujourdhui: string,
  perimetre: string | null,
  langue: string,
): BlocDeReponse {
  const etat = (e: EcheanceDuCalendrier) =>
    e.status === "fait"
      ? "pme.bloc.ech.faite"
      : e.dueDate < aujourdhui
        ? "pme.bloc.ech.retard"
        : "pme.bloc.ech.afaire";
  return {
    type: "tableau",
    titre: texte(langue, "pme.bloc.ech.titre"),
    periode: null,
    perimetre,
    source: texte(langue, "pme.bloc.ech.source"),
    colonnes: [
      { id: "echeance", libelle: texte(langue, "pme.bloc.ech.echeance"), numerique: false },
      { id: "limite", libelle: texte(langue, "pme.bloc.ech.limite"), numerique: false },
      { id: "etat", libelle: texte(langue, "pme.bloc.ech.etat"), numerique: false },
    ],
    lignes: echeances.map((e) => ({
      echeance: e.label,
      limite: jourEnClair(e.dueDate, langue),
      etat: texte(langue, etat(e)),
    })),
    total: null,
  };
}
