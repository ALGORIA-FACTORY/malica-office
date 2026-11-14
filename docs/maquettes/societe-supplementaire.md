# Ajouter une société — maquette PROPOSÉE (A3, recette du 13 novembre 2026)

**Statut : écran livré sur demande du dirigeant (« on fait ce qui n'est pas fait »), avec les deux
arbitrages ci-dessous tranchés par défaut** (`docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md`, A3).
La base et l'épreuve : `20261222110000`, `une-societe-de-plus-rejoint-la-licence.test.ts`. L'écran :
`apps/web/src/routes/_authenticated/pme.societe-en-plus.tsx`, qui appelle `identity.createOrganization`.
La ligne d'état est composée côté écran à partir de ce que la base a dit (offre, sociétés incluses, prix de
la grille) : `lib/societe-en-plus.ts`.

## Parcours

1. **Réglages › Mes sociétés › « Ajouter une société »** (web et PWA ; l'Android ne vend rien :
   l'entrée n'y montre ni prix ni offre, comme aujourd'hui).
2. **Écran court dédié** (route propre, plus `/onboarding` générique) : trois champs.
3. **« Voici votre matricule fiscal »** : l'écran existant de fin d'inscription, inchangé.

## Écran 2 — « Ajouter une société »

```
┌──────────────────────────────────────────────┐
│ ←  Ajouter une société                       │
│                                              │
│  Elle rejoint votre abonnement Premium.      │  ← ligne d'état (voir « Messages »)
│                                              │
│  Matricule fiscal                            │
│  [ 1234567/A/M/000            ]              │  ← format et contrôle lus au pack
│  Raison sociale                              │
│  [ ______________________________ ]          │
│  Adresse du siège                            │
│  [ ______________________________ ]          │
│                                              │
│  [ Ajouter la société ]       (Annuler)      │
└──────────────────────────────────────────────┘
```

- Juridiction et devise : celles de la société en cours (le pack), jamais demandées.
- Mode de validation : le défaut du produit, non demandé (c'est le réglage d'une société déjà
  ouverte, pas de son ajout).
- Responsive et RTL : une colonne, boutons pleine largeur sous 480 px, icônes logiques.
- Couleurs : Ink / Paper / gris ; la ligne d'état est neutre, l'erreur de matricule en Vermilion.

## Messages (la ligne d'état dit la vérité avant le geste)

La ligne est calculée par la base à partir de la licence (jamais écrite dans l'écran) :

| Situation | Ligne |
|---|---|
| Dans l'inclus (Premium, 1 sur 2) | « Elle rejoint votre abonnement Premium (2 sociétés sur 2). » |
| Au-delà de l'inclus | « Elle rejoint votre abonnement Premium. Société en plus : {prix} HT par mois. » (prix lu dans `ref.offres`) |
| L'offre ne porte qu'une société | « Votre offre ne comprend qu'une société : la nouvelle aura son propre abonnement. » |
| Android | aucune ligne de prix ni d'offre |

Le compteur « N sur M » de Réglages reste calculé sur les sociétés **de la licence** : avec une
seule licence il affiche « 2 sur 2 » après l'ajout.

## À trancher par le dirigeant

- Au-delà de l'inclus, la société est rattachée **sans second écran de confirmation**, la ligne
  d'état donnant le prix. Faut-il une confirmation explicite (case ou second geste) ?
- Une offre à une société (Basic, Solo, Team) : nouvelle licence Basic comme aujourd'hui, ou
  proposer la montée en Premium d'abord ?
