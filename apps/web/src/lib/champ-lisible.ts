/**
 * Nommer en clair ce que la lecture a produit.
 *
 * ============================================================== POURQUOI
 *
 * Une citation porte un CHEMIN dans l'extraction — « articles[3].designation »,
 * « totals.base_ht » —, un signalement porte un CODE, une entrée d'audit
 * porte une ACTION. Ce sont des noms de machine ; l'écran du cabinet les
 * affichait tels quels. Aucun texte technique n'atteint une personne : ce
 * module traduit chacun, et sait retrouver la valeur derrière un chemin.
 *
 * Pur, sans React : la traduction reçoit `t` en paramètre.
 */
import type { MessageKey } from "@/i18n";

import { montant } from "./lisible";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Le libellé d'une feuille de chemin, hors indice. */
const FEUILLES: Record<string, MessageKey> = {
  issuer: "pme.extract.issuer",
  document_date: "pme.extract.date",
  document_kind: "cab.champ.sens",
  currency: "cab.champ.devise",
  base_ht: "pme.extract.base",
  vat_amount: "pme.extract.vat",
  vat: "pme.extract.vat",
  ttc: "pme.extract.ttc",
  designation: "pme.extract.designation",
  quantity: "pme.extract.qty",
  unit_price_ht: "pme.extract.pu_ht",
  unit_price_ttc: "pme.extract.pu_ttc",
  total_ht: "cab.champ.total_ht",
  tax_code: "cab.champ.tax_code",
  matricule_fiscal: "cab.champ.matricule",
  numero: "cab.champ.numero",
  amount: "pme.extract.charges",
  label: "pme.extract.designation",
  code: "cab.champ.tax_code",
};

/** Le préfixe d'un chemin indexé : « Article 4 », « Ligne TVA 1 », « Droit 1 ». */
const FAMILLES: Record<string, MessageKey> = {
  articles: "cab.champ.article",
  lines: "cab.champ.ligne",
  other_charges: "cab.champ.droit",
};

/**
 * « articles[3].designation » → « Article 4 · Désignation ».
 * Un chemin inconnu rend sa dernière feuille, jamais le chemin brut.
 */
export function libelleDuChamp(chemin: string, t: T): string {
  const morceaux = chemin.split(".");
  const parties: string[] = [];
  for (const m of morceaux) {
    const indexe = /^([a-z_]+)\[(\d+)\]$/.exec(m);
    if (indexe) {
      const famille = FAMILLES[indexe[1]!];
      const n = Number(indexe[2]) + 1;
      parties.push(famille ? t(famille, { n }) : `${indexe[1]} ${n}`);
      continue;
    }
    if (m === "totals" || m === "references") continue;
    const feuille = FEUILLES[m];
    parties.push(feuille ? t(feuille) : m.replaceAll("_", " "));
  }
  return parties.join(" · ");
}

/** La valeur derrière un chemin, dans le payload de l'extraction. Texte, ou rien. */
export function valeurDuChamp(payload: unknown, chemin: string): string | null {
  let courant: unknown = payload;
  for (const m of chemin.split(".")) {
    if (courant === null || typeof courant !== "object") return null;
    const indexe = /^([a-z_]+)\[(\d+)\]$/.exec(m);
    if (indexe) {
      const liste = (courant as Record<string, unknown>)[indexe[1]!];
      courant = Array.isArray(liste) ? liste[Number(indexe[2])] : undefined;
    } else {
      courant = (courant as Record<string, unknown>)[m];
    }
  }
  if (courant === null || courant === undefined) return null;
  if (typeof courant === "string" || typeof courant === "number") return String(courant);
  return null;
}

/** Les feuilles qui portent un montant : elles se lisent avec les séparateurs de la langue. */
const MONTANTS = new Set([
  "base_ht",
  "vat_amount",
  "vat",
  "ttc",
  "unit_price_ht",
  "unit_price_ttc",
  "total_ht",
  "amount",
]);

/**
 * La valeur d'un champ, mise en forme pour la personne : un montant avec
 * les séparateurs de sa langue, une date au format de sa langue, le reste
 * tel quel. Une valeur qui ne se lit pas comme un nombre reste un texte.
 */
export function valeurLisible(chemin: string, valeur: string, locale: string): string {
  const feuille = chemin.split(".").pop() ?? chemin;
  if (MONTANTS.has(feuille) && /^-?\d+(\.\d+)?$/.test(valeur)) {
    return montant(valeur, locale);
  }
  if (feuille === "document_date" && /^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${valeur}T00:00:00Z`));
  }
  return valeur;
}

/** Ce qu'un code de signalement veut dire. */
export function libelleDuCode(code: string, t: T): string {
  /*
   * ====================================== QUATRE CODES SUR UNE DOUZAINE ÉMISE
   *
   * 11 octobre 2026 : l'écran du cabinet montrait neuf lignes dont sept
   * disaient exactement « Signalement de lecture. ». Cette table ne
   * connaissait que quatre codes, et le repli JETAIT le code — donc la seule
   * information qui restait.
   *
   * Un panneau qui répète sept fois la même phrase vide apprend à ne plus le
   * lire. Les codes réellement émis par la chaîne y sont maintenant tous.
   */
  const CODES: Record<string, MessageKey> = {
    "direction.incertaine": "cab.code.direction",
    tronque: "cab.code.tronque",
    SEPARATEUR_AMBIGU: "cab.code.separateur",
    DECIDE_PAR_ARITHMETIQUE: "cab.code.arithmetique",
    DERIVED_BY_SOCLE: "cab.code.derive",
    MISSING_CITATION: "cab.code.sansCitation",
    TOKEN_NOT_FOUND: "cab.code.jetonIntrouvable",
    VALUE_NOT_A_NUMBER: "cab.code.pasUnNombre",
    DATE_UNREADABLE: "cab.code.dateIllisible",
    SENS_A_CONFIRMER: "cab.code.sensAConfirmer",
  };
  return t(CODES[code] ?? "cab.code.autre");
}

/** Ce qu'une action de la piste d'audit veut dire. */
export function libelleDeLAction(action: string, t: T): string {
  const ACTIONS: Record<string, MessageKey> = {
    "piece.captured": "cab.notif.kind.piece.captured",
    "piece.read": "cab.notif.kind.piece.read",
    "piece.partagee": "cab.notif.kind.piece.partagee",
    "piece.validee": "cab.notif.kind.piece.validee",
    "piece.retournee": "cab.notif.kind.piece.retournee",
    "piece.precisee": "cab.notif.kind.piece.precisee",
    "piece.vis_changed": "cab.notif.kind.piece.vis_changed",
    "piece.articles_projected": "cab.notif.kind.piece.articles_projected",
    "echeance.faite": "cab.journal.echeance.faite",
    "echeance.rouverte": "cab.journal.echeance.rouverte",
    "conseil.retenu": "cab.journal.conseil.retenu",
    "conseil.repondu": "cab.journal.conseil.repondu",
    "conseil.approuve": "cab.journal.conseil.approuve",
    "conseil.corrige": "cab.journal.conseil.corrige",
    "conseil.ecarte": "cab.journal.conseil.ecarte",
    "cabinet.reglages": "cab.journal.cabinet.reglages",
    "engagement.accepte": "cab.journal.engagement.accepte",
    "engagement.refuse": "cab.journal.engagement.refuse",
    "membre.rejoint": "cab.journal.membre.rejoint",
    "membre.decline": "cab.journal.membre.decline",
    "cabinet.obligation_reglee": "cab.journal.cabinet.obligation_reglee",
    "cabinet.obligation_propre": "cab.journal.cabinet.obligation_propre",
    "honoraires.mandat_defini": "cab.journal.honoraires.mandat_defini",
    "honoraires.mandat_clos": "cab.journal.honoraires.mandat_clos",
    "honoraires.brouillon_cree": "cab.journal.honoraires.brouillon_cree",
    "honoraires.facture_emise": "cab.journal.honoraires.facture_emise",
    "honoraires.encaissement": "cab.journal.honoraires.encaissement",
    "honoraires.avoir": "cab.journal.honoraires.avoir",
    "cabinet.mise_en_route": "cab.journal.cabinet.mise_en_route",
    "pv.envoye": "cab.journal.pv.envoye",
    "engagement.propose": "cab.journal.engagement.propose",
    "membre.invite": "cab.journal.membre.invite",
    "organization.updated": "cab.journal.organization.updated",
    "extract.v1": "cab.audit.extract",
    "ecriture.proposed": "cab.notif.kind.ecriture.proposed",
    "ecriture.booked": "cab.notif.kind.ecriture.booked",
    "ecriture.validee": "cab.notif.kind.ecriture.validee",
    "ecriture.retournee": "cab.notif.kind.ecriture.retournee",
  };
  return t(ACTIONS[action] ?? "cab.audit.autre");
}
