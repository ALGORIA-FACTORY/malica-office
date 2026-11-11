/**
 * Les messages anglais de la bibliothèque et de la retenue — le même écran, en anglais.
 *
 * Traduction des clés `cab.retenue.*` et `cab.biblio.*` du cabinet : le type
 * `MessagesDeLaBibliotheque` exige exactement les clés du français, donc une clé
 * oubliée ici ne compile pas. Fusionné dans le dictionnaire anglais (`messages-en`).
 */
import type { MessagesDeLaBibliotheque } from "./messages-bibliotheque.ts";

export const enBibliotheque: MessagesDeLaBibliotheque = {
  "cab.retenue.irBase": "Income tax withholding base",
  "cab.retenue.qualify": "Payment treatment",
  "cab.retenue.withholding": "Withholding tax",
  "cab.retenue.noWithholding": "No withholding — full or partial payment",
  "cab.retenue.grossSettled": "Gross amount settled",
  "cab.retenue.vatSettled": "VAT in this amount",
  "cab.retenue.taxEvidence": "Certificate or tax justification",
  "cab.retenue.preview": "Check entry",
  "cab.retenue.declarer": "Declare a withholding",
  "cab.retenue.edit": "Edit treatment",
  "cab.retenue.unconfirmed": "Tax treatment is not recorded for this entry: review required.",
  "cab.retenue.sansObjet": "No withholding tax to record on this payment.",
  "cab.retenue.montantIllisible":
    "Unreadable amount: digits, thousands spaces and a single decimal separator.",

  "cab.biblio.title": "Library",
  "cab.biblio.subtitle": "Each client's documents and entries, together.",
  "cab.biblio.client": "Client",
  "cab.biblio.search": "Counterparty, reference, document…",
  "cab.biblio.autres": "Other documents",
  "cab.biblio.empty": "No shared documents in this view.",
  "cab.biblio.noClient": "Select a client to open their library.",
  "cab.biblio.download": "Download file",
  "cab.biblio.selection": "Download selection ({n})",
  "cab.biblio.select": "Select {reference}",
  "cab.biblio.count": "{n} documents",
  "cab.biblio.linked": "Authorized linked documents and payment evidence are included.",
  "cab.biblio.operation": "Operation file",
  "cab.biblio.prepare": "Prepare download",
  "cab.biblio.cancel": "Cancel",
  "cab.biblio.archiveHint":
    "The archive includes originals, an index and entries with their status. Proposed entries remain identified as proposed.",
  "cab.biblio.progress": "Preparing: {n} / {total} documents",
  "cab.biblio.saved": "Archive downloaded.",
  "cab.biblio.error": "Download failed. No incomplete file was delivered.",
  "cab.biblio.tooLarge":
    "This file exceeds the size of a ZIP archive (4 GB). Narrow the period or selection.",
  "cab.biblio.missing": "A document is unavailable or no longer authorized. Refresh the file.",
  "cab.biblio.entries": "Entries",
  "cab.biblio.fiscal": "Checks",
  "cab.biblio.checksHint":
    "These checks come from the latest analysis. They are not a comprehensive tax validation: VAT, withholding, stamp duty, FODEC and other applicable obligations still require expert review.",
  "cab.biblio.noChecks": "No analysis available. Compliance has not been established.",
  "cab.biblio.staleChecks":
    "The document was read again after this analysis. Refresh the checks before validation.",
  "cab.biblio.checksError": "Checks are unavailable. Retry before validating.",
  "cab.biblio.accountUnknown": "Account name unavailable",
  "cab.biblio.document": "Document",
  "cab.biblio.retour": "Back",
  "cab.biblio.ttc": "{devise} incl. tax",
  "cab.biblio.ttcASaisir": "Total to enter",
  "cab.biblio.aSaisir": "To enter",
  "cab.biblio.ttcNonLu": "the total was not read",
  "cab.biblio.etat.aValider": "To validate",
  "cab.biblio.etat.chezLeClient": "With the client",
  "cab.biblio.etat.pret": "Validated",
  "cab.biblio.pieces#one": "{count} document",
  "cab.biblio.pieces": "{count} documents",
  "cab.biblio.pieces#other": "{count} documents",
  "cab.biblio.trou": "{du} → {au}",
  "cab.biblio.aucunePiece": "no document received",
  "cab.biblio.compteur.aValider": "to validate",
  "cab.biblio.compteur.moisSansPiece": "months without documents",
  "cab.biblio.compteur.moisPrets": "months ready",
  "cab.biblio.compteur.moisPrets#one": "month ready",
  "cab.biblio.compteur.moisPrets#other": "months ready",
  "cab.biblio.regles": "Checked by rules",
  "cab.biblio.reglesDetail":
    "Rules applied: months without documents between the first and the last one, the validation state of each document. No AI analysis.",
  "cab.biblio.attente#one": "{qui}: to validate",
  "cab.biblio.attente": "{count} documents to validate: {qui}",
  "cab.biblio.attente#other": "{count} documents to validate: {qui}",
  "cab.biblio.ouvrir": "Open {qui}",
  "cab.biblio.absents": "Missing this month:",
  "cab.biblio.telechargerMois": "Download {mois}",
  "cab.biblio.telechargerTypeDuMois": "Download {type} — {mois}",
  "cab.biblio.telechargerPiece": "Download this document",
  "cab.biblio.toutCocher": "Select all",
  "cab.biblio.toutTelecharger": "Download all ({n})",
  "cab.biblio.volumineux": "This file is large: open a month to see its documents.",
};
