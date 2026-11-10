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

import type {
  BlocDeReponse,
  ChiffreDeBloc,
  PieceDUnChiffre,
  PointDeGraphique,
} from "@malica/socle/ports/assistant";
import { texte } from "@malica/socle/conseil";
import type { AchatsParFournisseur } from "@malica/socle/engines/achats/par-fournisseur";
import type { PiecesParMois } from "@malica/socle/engines/pieces/par-mois";
import { sommeDecimale } from "@malica/socle/somme-decimale";

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

/** Au-delà de ce nombre de lignes, le reste se regroupe : un tableau se lit, il ne se parcourt pas. */
const LIGNES_DU_CLASSEMENT = 12;

/**
 * Le classement des achats par fournisseur, tel que le moteur du Socle l'a
 * sommé. Les fournisseurs au-delà des douze premiers sont regroupés en une
 * ligne — leur somme est celle du moteur, pas une soustraction.
 */
/** Au-delà de ce nombre, les pièces d'une ligne ne se listent plus : on dit combien il en reste. */
const PIECES_PAR_LIGNE = 20;

/** Les indices des lignes, rangés par une clé : l'ordre croissant d'une colonne. */
function ordre<T>(lignes: readonly T[], comparer: (a: T, b: T) => number): number[] {
  return lignes.map((_, i) => i).sort((i, j) => comparer(lignes[i]!, lignes[j]!) || i - j);
}

export function blocDesAchats(
  achats: AchatsParFournisseur,
  dec: number,
  periode: string | null,
  perimetre: string | null,
  langue: string,
  /** Ce que chaque pièce est, par sa référence : l'outil le sait, le moteur non. */
  titres: ReadonlyMap<string, string> = new Map(),
): BlocDeReponse {
  const tete = achats.lignes.slice(0, LIGNES_DU_CLASSEMENT);
  const reste = achats.lignes.slice(LIGNES_DU_CLASSEMENT);
  const ligne = (fournisseur: string, total: string, pieces: number) => ({
    fournisseur,
    montant: montant(total, dec, langue),
    pieces: String(pieces),
  });
  const totalDuReste = sommeDecimale(
    reste.map((l) => l.total),
    dec,
  );
  // Ce que le tri compare : le nom, la somme et le nombre — jamais le texte formaté.
  const cles = [
    ...tete.map((l) => ({ nom: l.fournisseur, somme: Number(l.total), n: l.pieces })),
    ...(reste.length > 0
      ? [{ nom: "", somme: Number(totalDuReste), n: reste.reduce((n, l) => n + l.pieces, 0) }]
      : []),
  ];
  const piecesDe = (refs: readonly string[]): PieceDUnChiffre[] | null => {
    const connues = refs.flatMap((id) => {
      const titre = titres.get(id);
      return titre ? [{ id, titre }] : [];
    });
    return connues.length > 0 ? connues.slice(0, PIECES_PAR_LIGNE) : null;
  };
  return {
    type: "tableau",
    titre: texte(langue, "pme.bloc.achats.titre"),
    periode: periode ?? texte(langue, "pme.bloc.achats.toutes"),
    perimetre,
    source: texte(langue, "pme.bloc.achats.source", { n: achats.pieces }),
    colonnes: [
      {
        id: "fournisseur",
        libelle: texte(langue, "pme.bloc.achats.fournisseur"),
        numerique: false,
      },
      {
        id: "montant",
        libelle: `${texte(langue, "pme.bloc.achats.montant")} (${achats.devise})`,
        numerique: true,
      },
      { id: "pieces", libelle: texte(langue, "pme.bloc.achats.pieces"), numerique: true },
    ],
    lignes: [
      ...tete.map((l) => ligne(l.fournisseur, l.total, l.pieces)),
      ...(reste.length > 0
        ? [
            ligne(
              texte(langue, "pme.bloc.achats.autres", { n: reste.length }),
              totalDuReste,
              reste.reduce((n, l) => n + l.pieces, 0),
            ),
          ]
        : []),
    ],
    ordres: {
      // « Autres fournisseurs » (nom vide) reste en dernier quand on trie par nom.
      fournisseur: ordre(cles, (a, b) =>
        a.nom === "" || b.nom === ""
          ? Number(a.nom === "") - Number(b.nom === "")
          : a.nom.localeCompare(b.nom, langue),
      ),
      montant: ordre(cles, (a, b) => a.somme - b.somme),
      pieces: ordre(cles, (a, b) => a.n - b.n),
    },
    pieces: [...tete.map((l) => piecesDe(l.refs)), ...(reste.length > 0 ? [null] : [])],
    total: ligne(texte(langue, "pme.bloc.achats.total"), achats.total, achats.pieces),
  };
}

/** « nov. 26 » : un mois AAAA-MM, court, pour l'axe d'un graphique. */
function moisCourt(periode: string, langue: string): string {
  const [a, m] = periode.split("-").map(Number);
  if (!a || !m) return periode;
  return new Intl.DateTimeFormat(LOCALE_DES_NOMBRES[langue] ?? "fr-FR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, 1)));
}

/**
 * Les achats et les ventes mois par mois, en barres. La hauteur de chaque barre
 * est rapportée à la plus haute des deux séries : l'écran la dessine telle
 * quelle. Un mois sans pièce n'a ni valeur ni barre.
 */
export function blocDesMois(
  parMois: PiecesParMois,
  dec: number,
  perimetre: string | null,
  langue: string,
): BlocDeReponse {
  const max = Math.max(
    0,
    ...parMois.mois.flatMap((m) => [Number(m.achats ?? 0), Number(m.ventes ?? 0)]),
  );
  const point = (mois: string, somme: string | null): PointDeGraphique => ({
    etiquette: moisCourt(mois, langue),
    valeur: somme === null ? null : montant(somme, dec, langue),
    part: somme === null || max === 0 ? 0 : Math.round((Number(somme) / max) * 1000) / 1000,
  });
  const premier = parMois.mois[0]?.mois;
  const dernier = parMois.mois.at(-1)?.mois;
  const comptees = parMois.mois.reduce((n, m) => n + m.piecesAchats + m.piecesVentes, 0);
  return {
    type: "graphique",
    forme: "barres",
    titre: texte(langue, "pme.bloc.mois.titre"),
    periode:
      premier && dernier
        ? premier === dernier
          ? moisEnClair(premier, langue)
          : `${moisEnClair(premier, langue)} – ${moisEnClair(dernier, langue)}`
        : null,
    perimetre,
    source: texte(langue, "pme.bloc.mois.source", { n: comptees }),
    unite: parMois.devise,
    series: [
      {
        nom: texte(langue, "pme.bloc.mois.ventes"),
        ton: "positif",
        points: parMois.mois.map((m) => point(m.mois, m.ventes)),
      },
      {
        nom: texte(langue, "pme.bloc.mois.achats"),
        ton: "neutre",
        points: parMois.mois.map((m) => point(m.mois, m.achats)),
      },
    ],
  };
}
