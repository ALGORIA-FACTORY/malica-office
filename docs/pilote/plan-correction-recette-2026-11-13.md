# Plan de correction de la recette du 13 novembre 2026 (staging 0.2.110)

**Objet.** Trier les constats de la recette (lots A à G) entre vrai, faux et à reproduire, puis ordonner les corrections jusqu'à une version figée pour le pilote.
**Méthode.** Quatre lectures indépendantes du code à `c0206f30` (rien exécuté). Une affirmation exécutée l'emporte sur une affirmation lue (AGENTS.md) : toute ligne « à reproduire » exige une transaction ou un clic en vrai avant correction.
**Contraintes.** Gel de `main` du 12 au 15 novembre (seules entrent la PR 0.2.111 et les correctifs bloquants). Pas de déploiement du 25 au 28 novembre. Tag pilote sur un commit vert 48 h sur staging. J0 visé : 1er décembre.

## 1. Verdicts

Légende : C = confirmé par lecture ; I = infirmé ; R = à reproduire ; D = décision produit (pas un défaut) ; taille S/M/L.

### Lot A (bloquants)
| Réf | Verdict | Cause lue | Taille |
|---|---|---|---|
| A1 | C | `/impressions` absent du matcher `@api` ; `Caddyfile.test.mjs` compare à `relais-api.ts`, pas à `app.ts` | S |
| A2 | C | la demande est une ligne `identity.invitations`, pas un engagement ; `listClients` ne lit que `engagements_v` | M |
| A3 | C (société, compteur) / D (280) | `create_organization` crée une licence Basic neuve ; 280 = 140 × 2 sociétés incluses, décision du 19/10 | M |
| A4 | C | `forfait_changer` effet immédiat, aucune descente programmée | L |
| A5 | C ×3 | notifications lisibles par tout cabinet engagé ; pièce retournée lue par la nouvelle ; `piece_retour` signe avec le mandat actif | L / M |
| A6 | C | `mandat_repondre(false)` pose `termine` ; sélecteurs sans filtre actif/archive | S |
| A7 | **R** | la PR #361 (datation) est dans 0.2.110 ; or l'écriture vue était datée du 13/11 et absente du cumul : la date n'explique pas | ? |

### Lot B (argent)
B1 C (L) · B2 C (M) · B3 C (M) · B4 carte C / prorata R (M) · B5 D · B6 alerte C / facturation R (S+M) · B7 C (S) · B8 D · B9 C (M, dont un `3` décimales codé en dur : R4).
Trou d'épreuves : aucun test de prorata sur 28/29/30/31 jours en montée mensuelle, ni de facturation de `acces_arreter`, ni de descente programmée.

### Lot C
C1 C (M) · C2 C (S) · C3 C (S/M) · C4 partiel (S) · C5 C (S) · C6 C (S, « — / — » R) · C7 partiel (S) · C8 C (M) · C9 transfert C : rien n'existe (M/L) ; « — TND » C (S) · C10 motif C (S) ; **collage I** ; **« Accepter » après refus I à HEAD** (migration `20261216090100`, vérifier qu'elle est sur staging).

### Lot D
D1 C : mêmes mots pour trois objets (mandat d'honoraires, clients actifs, affectations) + cache 30 s (S) · D2 C (M) · D3 C (S) · D4 C (S) · D5 C (S) · D6 C (S libellés, M « accepté ») · D7 **I** comme décrit : alias manquant (S) · D8 D (le doc le prévoit) · D9 R (S) · D10 C (S).

### Lots E, F
E : C, quasi rien ne part (3 appelants seulement : invitations, mot de passe oublié, relances d'impayé). Taille M/L.
F : C, absent entièrement. Taille L. Route `/pme/cabinet` fausse dans `20261019130000` (S).

### Lot G
G1 R (3 hypothèses : OCR injoignable, file de lecture bloquée, pièce refusée en amont ; aucune supervision de lecture) · G2 C (M) · G3 C (M ; bundle embarqué + OTA `web-v*`, pas de contrôle de parité) · G4 attend #372 et décision de maquette · G5 statut C (M) / export PME C absent (L) · G6 C ×3 (M) · G7 R, doublon avant lecture impossible par construction (avertir après lecture) · G8 C (S/M) · G9 **I** dans le dépôt · G10 nom/fiche/journal C, date arabe R · G11 C (S) · G12 C (S) · G13 voir E.

### Trouvé en passant
`docker/env/api.env` contient un `JWT_SECRET` en clair, commité : rotation et retrait (porte 6 du diagnostic du 12/11).

## 2. Décisions à prendre (par Wissem Barouni, hors conversation)
1. Premium = 280 lectures, occupées ou non : on garde (D) ou on change.
2. Effet au paiement pour l'engagement annuel et les recharges (B5) : on garde le comportement actuel ou on change.
3. Montant couru de la comptabilité avant la 1re facture (B8) : voulu ou à ajouter.
4. « Mandat et honoraires » masqué tant que les notes sont éteintes (D8).
5. Méthode d'amortissement du matériel informatique : à valider par l'expert (ANO fiscale).
6. Comptable interne (G4) : option (a) console limitée à sa société ou (b) droits côté PME.
7. Accepter/Refuser la prise en charge par le dirigeant (E21).
8. Périmètre : A4, B1, E, F, export PME, transfert de propriétaire : avant ou après le pilote.

## 3. Vagues et lots

**Vague 1 : bloquants, compatibles avec le gel (branche par lot, fusion seulement sur « fusionne la #… »).**
- L1 Mandats et succession : A2, A5, A6, D1, G8 (comptes cabinet). Épreuve en rôle non superutilisateur : mandat refusé, succession, notification d'un autre cabinet.
- L2 Privé et capture : G2, G8 (comptes PME), G5 statut, G6, D10. Épreuve RLS : aucune pièce privée visible d'un autre compte ; une pièce privée abandonnée reste non lue.
- L3 Exploitation et lecture : A1 + épreuve de parité `app.ts` / Caddyfile, G1 (alerte de supervision + épreuve transmise → proposée), G3 (parité APK/web + flux Maestro), JWT_SECRET.
- L4 Argent, socle : A3, B3, B7, B9, B2, B6 + épreuves jour par jour (28 à 31 jours, TVA 19 %, timbre seulement mensuel/annuel). A4 et B1 en vague 2.

**Vague 2 : candidat pilote (0.2.112), après le gel.** A7 après reproduction, A4, B1, B4, C1 à C10, D2 à D10, G10 à G12, route push, libellés manquants, e-mails de sécurité et de facture.

**Après le pilote.** E complet (maquettes E01 à E45), F complet, export PME de G5, transfert de propriétaire, G4 selon décision.

## 4. Règles communes à chaque lot
Zéro hardcoding (base, `ref.labels`, jetons), zéro doublon (réutiliser l'existant), jamais « cabinet » à l'écran, l'Android ne vend rien, code et commits en anglais, CI verte (typecheck, lint, knip, `npm test`), épreuve exécutée sous RLS réelle, clic réel sur staging avant de déclarer fait. Une PR par lot, jamais fusionnée sans l'ordre du dirigeant. Chaque équipe : un architecte, un expert base/RLS, un QA, plus l'expert du domaine du lot.

## 5. Ce qui n'a pas été vérifié
Tout rendu visuel, les données de staging, A7, G1, G7, D9, la date arabe, la facturation de `acces_arreter`, et la présence de la migration `20261216090100` sur staging.
