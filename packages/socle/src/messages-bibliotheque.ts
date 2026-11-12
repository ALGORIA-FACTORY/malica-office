/**
 * Les messages français de la bibliothèque et de la retenue — la source des clés.
 *
 * Textes de l'écran du cabinet qui réunit les documents et les écritures de chaque
 * client (`cab.biblio.*`) et de la déclaration de retenue à la source sur un règlement
 * (`cab.retenue.*`). Ce fichier définit les clés : `MessagesDeLaBibliotheque` en est
 * déduit, et les versions anglaise et arabe doivent le suivre clé pour clé. Fusionné
 * dans le dictionnaire français (`messages-fr`). Ces textes disent aussi ce que le
 * contrôle ne prouve pas : les contrôles affichés ne valent pas validation fiscale.
 */
export const frBibliotheque = {
  "cab.retenue.irBase": "Assiette de la retenue IR",
  "cab.retenue.qualify": "Traitement du règlement",
  "cab.retenue.withholding": "Retenue à la source",
  "cab.retenue.noWithholding": "Sans retenue — paiement total ou partiel",
  "cab.retenue.grossSettled": "Part brute réglée",
  "cab.retenue.vatSettled": "TVA de cette part",
  "cab.retenue.taxEvidence": "Certificat ou justification fiscale",
  "cab.retenue.preview": "Vérifier l’écriture",
  "cab.retenue.declarer": "Déclarer une retenue",
  "cab.retenue.edit": "Modifier le traitement",
  "cab.retenue.unconfirmed": "Traitement fiscal non tracé sur cette écriture : à vérifier.",
  "cab.retenue.sansObjet": "Aucune retenue à la source à constater sur ce règlement.",
  "cab.retenue.montantIllisible":
    "Montant illisible : chiffres, espaces de milliers et une seule virgule décimale.",

  "cab.biblio.title": "Bibliothèque",
  "cab.biblio.subtitle": "Les documents et les écritures de chaque client, réunis.",
  "cab.biblio.client": "Client",
  "cab.biblio.search": "Tiers, référence, document…",
  "cab.biblio.autres": "Autres documents",
  "cab.biblio.empty": "Aucun document transmis dans cette vue.",
  "cab.biblio.noClient": "Choisissez un client pour ouvrir sa bibliothèque.",
  "cab.archive.badge": "Mandat terminé · lecture seule",
  "cab.archive.notice":
    "Le mandat a pris fin le {date}. Vous gardez en archive ce que vous avez pris en charge jusqu’à ce jour : la pièce et ses écritures se lisent et se téléchargent, sans modification.",
  "cab.archive.biblio":
    "Mandat terminé : cette bibliothèque ne montre que les pièces que vous avez prises en charge, en lecture seule.",
  "cab.biblio.download": "Télécharger le dossier",
  "cab.biblio.selection": "Télécharger la sélection ({n})",
  "cab.biblio.select": "Sélectionner {reference}",
  "cab.biblio.count": "{n} documents",
  "cab.biblio.linked": "Les justificatifs et documents liés autorisés sont inclus.",
  "cab.biblio.operation": "Dossier de l’opération",
  "cab.biblio.prepare": "Préparer le téléchargement",
  "cab.biblio.cancel": "Annuler",
  "cab.biblio.archiveHint":
    "L’archive contient les originaux, un index et les écritures avec leur statut. Les propositions restent identifiées comme telles.",
  "cab.biblio.progress": "Préparation : {n} / {total} documents",
  "cab.biblio.saved": "Archive téléchargée.",
  "cab.biblio.error": "Le téléchargement n’a pas abouti. Aucun dossier incomplet n’a été remis.",
  "cab.biblio.tooLarge":
    "Ce dossier dépasse la taille d’une archive ZIP (4 Go). Réduisez la période ou la sélection.",
  "cab.biblio.missing":
    "Un document est indisponible ou n’est plus autorisé. Actualisez le dossier.",
  "cab.biblio.entries": "Écritures",
  "cab.biblio.fiscal": "Contrôles",
  "cab.biblio.checksHint":
    "Ces contrôles proviennent de la dernière analyse. Ils ne constituent pas une validation fiscale exhaustive : TVA, retenues, timbre, FODEC et autres obligations applicables restent à vérifier par l’expert.",
  "cab.biblio.noChecks": "Aucune analyse disponible. La conformité n’est pas établie.",
  "cab.biblio.staleChecks":
    "La pièce a été relue depuis cette analyse. Ces résultats doivent être actualisés avant validation.",
  "cab.biblio.checksError": "Les contrôles sont indisponibles. Réessayez avant de valider.",
  "cab.biblio.accountUnknown": "Intitulé du compte indisponible",
  "cab.biblio.document": "Document",
  "cab.biblio.retour": "Revenir",
  "cab.biblio.ttc": "{devise} TTC",
  "cab.biblio.ttcASaisir": "TTC à saisir",
  "cab.biblio.aSaisir": "À saisir",
  "cab.biblio.ttcNonLu": "le montant TTC n’a pas été lu",
  "cab.biblio.etat.aValider": "À valider",
  "cab.biblio.etat.chezLeClient": "Chez le client",
  "cab.biblio.etat.pret": "Validé",
  "cab.biblio.pieces#one": "{count} pièce",
  "cab.biblio.pieces": "{count} pièces",
  "cab.biblio.pieces#other": "{count} pièces",
  "cab.biblio.trou": "{du} → {au}",
  "cab.biblio.aucunePiece": "aucune pièce reçue",
  "cab.biblio.compteur.aValider": "à valider",
  "cab.biblio.compteur.moisSansPiece": "mois sans pièce",
  "cab.biblio.compteur.moisPrets": "mois prêts",
  "cab.biblio.compteur.moisPrets#one": "mois prêt",
  "cab.biblio.compteur.moisPrets#other": "mois prêts",
  "cab.biblio.regles": "Contrôlé par règles",
  "cab.biblio.reglesDetail":
    "Règles appliquées : les mois sans pièce entre la première et la dernière pièce, l’état de validation de chaque pièce. Aucune analyse par l’IA.",
  "cab.biblio.attente#one": "{qui} : à valider",
  "cab.biblio.attente": "{count} pièces à valider : {qui}",
  "cab.biblio.attente#other": "{count} pièces à valider : {qui}",
  "cab.biblio.ouvrir": "Ouvrir {qui}",
  "cab.biblio.absents": "Absents ce mois :",
  "cab.biblio.telechargerMois": "Télécharger {mois}",
  "cab.biblio.telechargerTypeDuMois": "Télécharger {type} — {mois}",
  "cab.biblio.telechargerPiece": "Télécharger cette pièce",
  "cab.biblio.toutCocher": "Tout cocher",
  "cab.biblio.toutTelecharger": "Tout télécharger ({n})",
  "cab.biblio.volumineux": "Ce dossier est volumineux : ouvrez un mois pour voir ses pièces.",
} as const;

export type MessagesDeLaBibliotheque = Record<keyof typeof frBibliotheque, string>;
