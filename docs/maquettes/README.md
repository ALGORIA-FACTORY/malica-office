# Maquettes Malica Office — référence visuelle

Ces fichiers sont la **source de vérité visuelle** du produit. Ils ne sont pas
compilés par l'application : on s'y réfère, on en extrait le vocabulaire, on ne
les importe pas.

## Fichiers

| Fichier           | Surface                     | Écrans                                                             |
| ----------------- | --------------------------- | ------------------------------------------------------------------ |
| `malica.html`     | PME mobile 392×846          | 20 (accueil → restitution, thème Ink, arabe RTL, espace personnel) |
| `comptable.html`  | Cabinet 2 colonnes 1320×836 | 7 — **itération antérieure, dépassée**                             |
| `comptable2.html` | Cabinet 3 colonnes 1460×880 | 9 (onboarding → arabe RTL)                                         |
| `comptable3.html` | Cabinet 3 colonnes 1460×880 | 16 (rapprochement → client 360)                                    |

**Référence cabinet = `comptable2.html` + `comptable3.html`** : grille
nav 218px / centre / **panneau Malica 300px** permanent à droite.
`comptable.html` est conservé pour l'historique uniquement.

`apercus/` contient les rendus PNG, dont trois planches d'ensemble.

Second lot (cabinet) : `06_integrations_api`, `07_dashboard_patronne_enrichi`,
`08_responsive_tablette_mobile`, `09_arabe_rtl`, `10_rapprochement_bancaire`,
`11_echeances_cabinet`, `12_pv_reunion`, `13_restitution_deux_bords`.
Rappel doctrine : rapprochement bancaire et conseil réglementaire sont
maquettés mais **non prioritaires** — références de conception, pas de backlog.

Troisième lot (cabinet) : `14_notifications`, `15_reglages_cabinet`,
`16_client_360`, `17_ecriture_piece_cote_a_cote`,
`18_un_client_plan_de_travail`, `19_affectation_clients`,
`20_conseil_reglementaire`. `17` est la référence de l'écran côte-à-côte
pièce/écriture (étape 4 : citations à bbox, feu, comptabiliser / retourner).

Ouvrir un fichier directement dans un navigateur : `assets/rg_mark.svg` est
présent, le sigle s'affiche.

## Tokens exacts

```
--bg  #FAFAFA   papier
--sf  #FFFFFF   surface
--sf2 #F4F4F5   surface enfoncée
--ink #0A0A0A   encre
--t2  #48484A   texte secondaire
--t3  #9A9AA0   texte tertiaire
--ln  #E8E8EC   ligne
--lns #D8D8DD   ligne soutenue
```

Thème Ink : `--bg #0A0A0A`, `--sf #161618`, `--sf2 #1C1C1E`, `--ink #FAFAFA`,
`--t2 #C7C7CC`, `--t3 #7C7C82`, `--ln #262628`, `--lns #3A3A3C`.

Signaux — **réservés au verdict de conformité, jamais décoratifs** :

```
--ev #245A36   feu vert
--am #8A6510   feu ambre
--ve #A03819   feu rouge
--az #2968A5   information
--mg #C45E3F   accent de restitution
```

Typographie : Inter (texte), IBM Plex Mono (chiffres, comptes, `tabular-nums`),
IBM Plex Sans Arabic (AR).

Invariants : `border-radius: 0` partout, **aucune `box-shadow`**, élévation
uniquement par bordures 1px.

## Sigle

`public/rg-mark.svg` — utilisé via `src/components/malica/rg-mark.tsx`, en
masque CSS sur `currentColor`. Ne jamais le colorier en dur.
