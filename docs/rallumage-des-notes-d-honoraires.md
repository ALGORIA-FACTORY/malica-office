# Rallumer les notes d'honoraires — la fiche

**État au 12 novembre 2026 : éteintes.** Décision du dirigeant (recette du
11 novembre 2026, point 7.4) : la note d'honoraires est éteinte, sans rien
supprimer, et sera rallumée dans une version **postérieure à la mise en
production**. Cette fiche dit ce qui est éteint, comment on rallume, et ce qui
doit être fait **avant** de rallumer. Rien de ce qui suit n'est codé.

## L'interrupteur

- Où : la tour, **Plateforme › Fonctions du produit › Notes d'honoraires**.
- En base : `plateforme.reglages_fonctions`, fonction `notes_honoraires` —
  une ligne par décision, datée, motivée, en ajout seul (migration
  `20261213090000_la_note_d_honoraires_s_eteint_a_la_tour.sql`). La dernière
  décision vaut. Livré **éteint**, en staging comme en production.
- L'écran lit `honoraires.notesOuvertes` (`plateforme.fonction_ouverte`) ; le
  serveur lit la même décision dans chaque porte
  (`app.notes_d_honoraires_requises`). Rien n'est en dur.
- Rallumer : un opérateur d'ALGORIA clique « Allumer », avec un motif. Aucun
  déploiement, aucune migration.

## Ce qui est éteint

Côté comptabilité :

- Clients › Facturation : le bloc « Honoraires et mandats », le bouton
  « Nouvelle facture », la liste des factures d'honoraires, la vue
  « Trésorerie » des honoraires ;
- la fiche client : l'onglet « Factures » ;
- l'adresse `/cabinet/facture/$factureId` (elle ramène à la page Clients) ;
- au serveur : créer, modifier ou supprimer un brouillon, émettre, encaisser,
  annuler par un avoir. Le refus est `refus.honoraires.notes_eteintes` —
  « Les notes d'honoraires arrivent dans une prochaine version. » (fr, en, ar).

## Ce qui ne s'éteint pas

- Le mandat et son forfait (onglet « Mandat et honoraires ») : ils disent ce
  que la comptabilité facture, hors de Malica.
- « Ce que vous réglez à Malica » et la facture mensuelle de Malica à la
  comptabilité.
- Les exports et les écritures.

## Rien n'a été supprimé

Les tables (`collab.factures_honoraires`, ses lignes, les encaissements), les
migrations, le code des écrans, les clés de traduction et les épreuves
restent. Une note déjà émise (H-2026-0001 sur le staging) reste en base, avec
sa numérotation, et se relit dès le rallumage. Les épreuves qui jouent les
notes (`outils/epreuves/honoraires.mjs`, `outils/jeu-de-donnees.mjs`) allument
l'interrupteur par la tour dans leur préparation.

## À faire avant de rallumer (version suivante)

Chaque point est à concevoir, maquetter si l'écran change, coder et éprouver.
Les points marqués INCERTAIN demandent une vérification juridique ou fiscale
avant tout code : le texte cité ici est celui de la demande du dirigeant, il
n'a pas été relu à la source.

1. **La note arrive chez la PME** (recette, point 2.8). Envoi par e-mail
   (Brevo, expéditeur `hello@algoria-factory.com`, la note en PDF) **et**
   dépôt dans « Votre comptabilité › Ses documents », avec une alerte côté
   PME. Aujourd'hui la note ne quitte pas l'espace de la comptabilité, et
   aucun moteur ne produit son PDF.
2. **Le nom : « Note d'honoraires »**, et non « Facture d'honoraires », à
   l'écran, dans le PDF et dans l'e-mail. Référence donnée par le dirigeant :
   Code de la TVA, art. 18. INCERTAIN — à confirmer à la source (mentions
   obligatoires d'une note d'honoraires, numérotation).
3. **La retenue à la source due par la PME** figure sur la note : son taux et
   son montant viennent du pack de juridiction (R4), jamais du code. INCERTAIN
   — taux et seuil applicables aux honoraires à confirmer par le conseil
   fiscal d'ALGORIA avant de les poser en base.
4. **Une confirmation avant d'émettre** (recette, point 1.9). « Émettre »
   attribue aujourd'hui un numéro définitif d'un seul clic. La confirmation
   dit le numéro qui sera attribué, le client et le TTC.
5. **La désignation du forfait visible dès le brouillon** (recette, point
   1.9). Aujourd'hui la ligne de forfait du brouillon n'a pas de désignation ;
   elle n'apparaît qu'après l'émission.
6. **La facture électronique.** Question ouverte par le dirigeant : loi de
   finances 2026, art. 53. INCERTAIN — savoir si une note d'honoraires émise
   depuis Malica entre dans l'obligation, à quelle date, et par quel canal
   agréé ; à trancher avec le conseil d'ALGORIA avant de rallumer.

## Comment vérifier, le jour du rallumage

- `apps/api/src/la-note-d-honoraires-s-eteint-a-la-tour.test.ts` : éteinte, le
  serveur refuse et le mandat se règle ; allumée, la note se crée, s'émet,
  et reste lisible une fois l'interrupteur recoupé.
- `apps/web/src/components/malica/__tests__/les-notes-d-honoraires-s-eteignent.test.tsx` :
  éteinte, l'écran ne montre rien ; allumée, tout revient.
- `outils/epreuves/honoraires.mjs` : le parcours complet, par HTTP.
