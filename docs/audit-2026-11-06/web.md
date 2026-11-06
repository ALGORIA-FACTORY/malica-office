# Audit web / PWA — mesures du 6 novembre 2026

Branche `audit/web`, base `eb004c1c` (mission-production-ready). Aucun code
produit modifié. Toutes les mesures sont rejouables : scripts et sorties brutes
dans `captures-web/` (`script-*.mjs.txt`, renommés en `.txt` pour que knip ne
les compte pas comme fichiers morts).

**Périmètre mesuré** : le build de production du site (`VITE_API_URL=/ npm run
build -w @malica/web`, servi par `node .output/server/index.mjs`), sans API.
Écrans atteignables sans session : `/`, `/auth`, `/confidentialite`,
`/invitation`, `/reinitialiser`, et `/pme`, `/cabinet` (qui affichent l'écran
« Pas de connexion » faute d'API). **Les écrans authentifiés PME, cabinet et
tour ne sont pas mesurés au rendu** : il faut une session et l'API, et la base
`malica_test` était réservée à un autre agent. Les constats qui les concernent
viennent du code et des feuilles de style.

Note de méthode : sous Git Bash, `VITE_API_URL="/"` est réécrit par MSYS en
`C:/Program Files/Git/` ; le premier build mesuré appelait donc
`file:///C:/Program Files/Git/auth/session`. Le build retenu est fait sous
PowerShell. À savoir pour quiconque construit l'image à la main sous Windows.

---

## 1. Lighthouse mobile

Commande : `npx lighthouse@12.8.2 <url> --only-categories=performance,accessibility,best-practices,seo --chrome-flags=--headless=new`
(émulation mobile par défaut : Moto G Power, 4G lente simulée, CPU ×4).
Deux passes : **brute** (le serveur nitro seul, sans compression) et
**gzip** (un relais `script-gzip-proxy.mjs.txt` qui reproduit le `encode zstd
gzip` de `infra/caddy/Caddyfile` — c'est la condition de production).

| Écran (gzip, ≈ production) | Perf   | A11y | Bonnes pratiques | SEO | FCP   | LCP   | CLS       |
| -------------------------- | ------ | ---- | ---------------- | --- | ----- | ----- | --------- |
| `/`                        | **77** | 100  | 100              | 100 | 4,1 s | 4,1 s | 0,001     |
| `/auth`                    | **74** | 100  | 96               | 100 | 4,4 s | 4,4 s | 0         |
| `/confidentialite`         | **64** | 100  | 100              | 100 | 4,4 s | 4,4 s | **0,211** |
| `/invitation`              | **75** | 100  | 96               | 63  | 4,1 s | 4,4 s | 0         |
| `/reinitialiser`           | **73** | 100  | 100              | 100 | 4,1 s | 4,8 s | 0,003     |
| `/pme` (sans API)          | **73** | 100  | 96               | 100 | 3,5 s | 5,1 s | 0         |
| `/cabinet` (sans API)      | **74** | 100  | 96               | 100 | 3,8 s | 4,8 s | 0         |

Sans compression (serveur nitro nu) : 57 / 57 / 55 / 58 / 57 / 58 / 57, FCP ≈ 8 s.

- **Objectif ≥ 95 : non atteint en performance, sur tous les écrans.** A11y,
  bonnes pratiques et SEO sont au plafond ou presque.
- Les 96 en bonnes pratiques viennent de l'erreur console `EchecAuth: service
d'authentification injoignable` — artefact de la mesure sans API.
- Le SEO 63 de `/invitation` est le `noindex` voulu (`routes/invitation.tsx:16`).
- Un 100 en accessibilité Lighthouse ne vaut que pour le sous-ensemble axe
  automatisé, niveau AA : voir §3, qui mesure AAA.

**Audits qui coûtent les points** (passe gzip, `/`) :

| Audit                               | Mesure                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| render-blocking                     | `styles-*.css` 35 Ko gz (232 Ko brut) + `index-*.css` 5 Ko : 1 050 ms estimés                                                           |
| network-dependency-tree             | 46 requêtes, 573 Ko transférés avant interactivité, dont ≈ 30 `modulepreload` JS                                                        |
| unused-javascript                   | `index-*.js` 120 Ko gz, **47 % inutilisé** sur l'accueil                                                                                |
| polices                             | 11 fichiers woff2 chargés sur une page française : Inter latin **et** latin-ext ×3 graisses, Plex Mono ×2, **Noto Kufi Arabic** (44 Ko) |
| layout-shift (`/confidentialite`)   | 0,09 à 0,21 selon la passe : bascule de police Inter sur la section « Ce que nous collectons »                                          |
| uses-text-compression (passe brute) | 795–862 Ko économisables — couvert par Caddy en production, pas par nitro                                                               |

---

## 2. Bundle

`npm run build:coque:staging -w @malica/web && node scripts/budget-bundle.mjs` :

```
OK  JavaScript initial (gzip) : 250 Ko / 350 Ko  (27 fichiers)
OK  bundle entier (gzip) : 2459 Ko / 3072 Ko  (.output\public)
```

Premier écran (coque), les plus gros : `index` 104 Ko gz, `i18n` 70 Ko gz (le
dictionnaire **français** entier, chargé pour tous, y compris un arabophone qui
charge ensuite `messages-ar` 75 Ko), `Match` 15 Ko, `extract.v1` 13 Ko,
`decimal` 13 Ko.

Bundle entier par type (gz) : JS 1 421 Ko, **woff 514 Ko**, woff2 395 Ko,
webp 62 Ko, CSS 39 Ko. Plus gros fichiers : `pdf.worker` 370 Ko, `pdf` 144 Ko,
`esm` (Sentry) 100 Ko + `spotlight` (cœur Sentry, malgré son nom) 53 Ko — tous
paresseux.

- `knip` : propre. `npm ls` : un seul `react@19.2.8`, un seul routeur. Aucune
  dépendance morte ni doublon détecté.
- Avertissement de build `INEFFECTIVE_DYNAMIC_IMPORT` : `capabilities/scanner.ts`
  est importé dynamiquement par `cadrage.ts` et `CameraScanner.tsx` mais
  statiquement par `files.ts` et `recu-pdf.ts` — l'import dynamique ne découpe
  rien.

---

## 3. Accessibilité

### 3a. Contraste des jetons (calculé depuis les variables CSS)

Script `script-contrast-tokens.mjs.txt` : lit `styles.css`, `styles-comptabilite.css`,
`styles-pme.css` (lecture seule), convertit oklch → sRGB, compose les alphas,
et croise chaque jeton de texte avec chaque surface. 1 086 paires ; **445 sous
7:1, 121 sous 4,5:1**. Détail : `captures-web/contraste-jetons.txt` et
`contraste-jetons-toutes-paires.json`. Extrait (texte sur fond de page / sur
fond sourd) :

| Thème                                                    | Jeton                                          | Sur fond                  | Sur sourd       | Verdict AAA                                 |
| -------------------------------------------------------- | ---------------------------------------------- | ------------------------- | --------------- | ------------------------------------------- |
| Edition One clair                                        | `--muted-foreground`                           | 5,51                      | 4,89            | échoue (574 usages `text-muted-foreground`) |
| Edition One clair                                        | `--signal-warn`                                | **3,57**                  | **3,17**        | échoue même AA (60 usages)                  |
| Edition One clair                                        | `--marigold`                                   | **3,03**                  | **2,69**        | échoue même AA (31 usages)                  |
| Edition One clair                                        | `--signal-ok` / `--signal-info`                | 5,46 / 5,73               | 4,85 / 5,09     | échoue                                      |
| Edition One sombre (défaut)                              | `--muted-foreground`                           | 6,74                      | 5,55            | échoue                                      |
| Edition One sombre                                       | `--destructive` / `--signal-stop`              | 4,53 / 4,91               | **3,73 / 4,05** | échoue, AA aussi sur sourd                  |
| Edition One sombre                                       | `--destructive-foreground` sur `--destructive` | 4,53                      | —               | échoue                                      |
| Cabinet (clair, `color-scheme: light`, aussi en `.dark`) | `--muted-foreground` #667085                   | 4,64                      | **4,35**        | échoue AA sur `--muted`                     |
| Cabinet                                                  | `--signal-warn` / `--marigold`                 | 4,77 / 4,73               | **4,47 / 4,43** | échoue AA sur sourd                         |
| PME clair                                                | `--t3`                                         | 5,78                      | 4,96            | échoue                                      |
| PME clair                                                | `--az` / `--am` / `--ve` / `--mg`              | 5,28 / 5,87 / 5,97 / 5,81 | 4,54–5,13       | échoue                                      |
| PME clair                                                | `--marigold` (pont)                            | **3,16**                  | **2,71**        | échoue AA                                   |
| PME sombre (défaut)                                      | `--t3`                                         | 6,10                      | 4,78            | échoue                                      |
| PME sombre                                               | `--mg`                                         | 6,34                      | 4,97            | échoue                                      |

Au rendu (Playwright, contraste effectif texte/fond calculé élément par
élément, `mesures-playwright.json`) : sur les écrans publics, seuls passent sous
7:1 `text-muted-foreground` (6,73 sombre, 5,50 clair) et l'erreur de
`/reinitialiser` en `text-signal-stop` sombre (**4,93:1**, 12 px).

**Correctif universel** : abaisser/relever la luminance des jetons secondaires
jusqu'à 7:1 sur le fond **sourd** (pas seulement sur le fond de page) :
`--muted-foreground` clair ≈ oklch(0.40), sombre ≈ oklch(0.76) ; `--signal-*`
et `--marigold` clairs ≈ L 0.42–0.45 ; `--signal-stop`/`--destructive` sombres ≈
L 0.72. Cabinet : `--muted-foreground` → `--text-2` (#475467 tient 7,17 sur le
fond). **Les jetons PME (`--t3`, `--az`, `--am`, `--ve`, `--mg`, `--marigold`
du pont) vivent dans `styles-pme.css` : à remettre au propriétaire.**

### 3b. Visibilité du focus

Tabulation Playwright (8 pressions par écran, `outline`/`box-shadow` calculés) :

- **`/auth` (et `/reinitialiser`, `onboarding.tsx:133-180`,
  `OuvrirDossier.tsx:249`)** : les champs portent `outline-none
focus:border-foreground` (`routes/auth.tsx:264`, `routes/reinitialiser.tsx:136`).
  Mesuré : `outline: none`, aucune ombre ; le seul signe est une bordure de
  1 px qui change de teinte. Conforme 2.4.7 au mieux, **échoue 2.4.13 (AAA,
  2 px d'épaisseur)**. Correctif : retirer `outline-none` et laisser une règle
  `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }`
  globale dans `styles.css`, comme le font déjà le cabinet et la PME.
- **`styles.css:448-451`** : `* { box-shadow: none !important }` en couche
  `base`. Un `!important` de couche antérieure l'emporte sur les utilitaires :
  les **20 `focus(-visible):ring-*` de 8 fichiers** (cabinet.conseil, .pv,
  .reglages, .honoraires, .mise-en-route, .facture, document-view,
  integrations-panel) sont neutralisés. Masqué aujourd'hui par
  `.cabinet-workspace :focus-visible { outline }`, non couché ; le jour où un
  de ces composants sort du cabinet, il n'a plus de focus. Correctif : passer
  ces anneaux en `outline`, ou exclure `:focus-visible` de la règle.

### 3c. Cibles tactiles (< 44 × 44 px, mesuré à 360 px)

Sur tous les écrans publics : sélecteur de langue FR/EN/العربية **31×24,
33×24, 50×24** ; `/auth` : onglets Connexion/Créer **155×32**, champs
**312×38**, « Mot de passe oublié ? » **124×16**, « Retour à l'accueil »
**98×16**, logo **142×20** ; accueil en arabe : « الدخول » **72×34** ;
`/confidentialite` : liens `mailto` 188×19.
Correctif : `min-h-11` (44 px) sur `LanguageSwitcher`, les onglets et les
champs d'`auth`/`reinitialiser`/`onboarding` ; zone de toucher élargie
(`py-3 -my-3`) pour les liens texte.

### 3d. Repères et libellés

Aucun contrôle sans nom accessible. `header`/`main`/`h1` présents partout ;
`/confidentialite` porte **deux `h1`** (un par langue, les deux rendus) ;
`/invitation` n'a ni `header` ni `nav` ; l'écran « Pas de connexion » de
`/pme`/`/cabinet` n'a **aucun repère** (ni `main` ni titre).

### 3e. RTL arabe

- Code : **un seul** utilitaire physique dans tout le TSX
  (`cabinet.echeances.tsx:259`, `-translate-x-1/2` avec `insetInlineStart` :
  en RTL le repère est décalé d'une largeur entière — mettre
  `rtl:translate-x-1/2`), contre 144 utilitaires logiques. `styles.css` et
  `styles-comptabilite.css` : zéro propriété physique. `styles-pme.css:464`
  (`padding-left`/`border-left` du « + ») est une décision écrite (1er
  novembre) — rien à faire.
- Icônes directionnelles non retournées : `ArrowRight` ×5
  (`cabinet.index.tsx:278,331,343,429,473`), `ChevronRight/Left` ×4
  (`cabinet.tsx:594,638,1013`, `cabinet.bibliotheque.tsx:275`). Seul
  `cabinet.journal.tsx` porte `rtl:-scale-x-100`. Correctif : la même classe.
- Rendu (`captures-web/*-ar-*.png`) : `/auth` et l'accueil basculent
  correctement. **`/confidentialite` en arabe** : l'article français
  (`routes/confidentialite.tsx:43`, `lang="fr"` sans `dir`) hérite du
  `dir="rtl"` ; la ponctuation part en tête de ligne (« .appartenez »).
  Correctif : `dir="ltr"` sur cet article. La date « Mise à jour : … »
  (`:38`) reste en français dans les trois langues.

---

## 4. Responsive (360, 390, 768, 1280 px)

`script-pw-audit.mjs.txt`, 56 captures pleine page dans `captures-web/`
(`<écran>-<langue>-<thème>-<largeur>.png`). **Aucun débordement horizontal** :
`scrollWidth` = largeur de la fenêtre partout, aucun élément hors cadre, aucun
texte tronqué (le seul « clipped » est le `sr-only` voulu). À 360 px, l'en-tête
de l'accueil se serre : la devise « Comptabilité augmentée, chiffre gouverné »
passe sur quatre lignes entre la marque et le sélecteur de langue
(`accueil-fr-clair-360.png`) — à masquer sous 400 px.

---

## 5. Texte technique qui peut atteindre l'écran

Règle produit : aucune erreur technique à l'écran. `lib/erreur-lisible.ts`
(`texteDeLErreur`) l'applique bien et la plupart des écrans l'emploient. Restent
(grep `\.message` rendu en JSX) :

| Gravité | Lieu                                                               | Ce qui s'affiche                                                                                                                   |
| ------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Haute   | `components/malica/MalicaChat.tsx:428`                             | `mutation.error.message` brut                                                                                                      |
| Haute   | `routes/_authenticated/pme.malica.tsx:460`                         | `question.error.message` brut                                                                                                      |
| Haute   | `components/malica/OuvrirDossier.tsx:90` (rendu `:114`, `:163`)    | `e.message` ou `String(e)` brut, ouverture et invitation de dossier                                                                |
| Haute   | `routes/invitation.tsx:171`                                        | `accepter.error.message` brut, écran public                                                                                        |
| Moyenne | `lib/erreur-lisible.ts:71-75` → `direUnRefus`                      | un refus 4xx qui n'est pas une clé du dictionnaire est « rendu tel quel » : un message de base ou de pilote en 4xx atteint l'écran |
| Basse   | `lib/erreur-lisible.ts` n'est pas branché sur l'écran de connexion | `auth.tsx:224` dit bien une phrase prévue, mais n'inscrit rien au journal                                                          |
| Basse   | `lib/error-page.ts`                                                | page d'erreur serveur en anglais seul, hors marque (system-ui, gris, coins arrondis)                                               |

Correctif universel : remplacer ces quatre rendus par `texteDeLErreur(e, OU,
t(...))`, et faire de « non-clé » un cas journalisé qui rend le défaut. La
page serveur reprend les trois langues de `SECOURS` (`__root.tsx`).

---

## 6. Couleurs et polices hors marque

Marque : Ink, Paper, Evergreen, Vermilion, Amber, Azure ; Inter et IBM Plex Mono.

- **Cabinet entier** (`styles-comptabilite.css:204-232`) : palette ardoise
  (#182230, #667085, #475467, #344054, #edf0f3 — gris bleutés d'un kit
  générique), et **≈ 130 littéraux hex hors du bloc de jetons** dans la même
  feuille (#ffffff ×16, #667085 ×10, #168b50, #24603e, #17231c, #d0a040…).
- `cabinet.pilotage.tsx:685,822` : **violet #8470d5, rose #bb5272, orange
  #d98745, bleu-vert #4a8ea8**, vert #168b50 — aucune n'est de la marque.
- `CameraScanner.tsx` : 45 littéraux (#C7C7CC, #9A9AA0, #3A3A3C, #161618 — gris
  iOS ; #E3B75C, #7EC492, #E08163) ; `invitation.tsx` : 20 littéraux.
- `document-view.tsx:370` `#b45309`, `error-page.ts` (#fafafa, #111, #4b5563,
  #d1d5db, police system-ui).
- `--marigold` (styles.css:140, cabinet, pont PME) : couleur hors des six de la marque.
- Polices : seule `Noto Kufi Arabic` sort du couple — nécessaire pour l'arabe,
  à inscrire dans la charte plutôt qu'à retirer.

Correctif : tout littéral vers un jeton nommé de `styles.css` ; la palette du
cabinet réalignée sur Ink/Paper (+ Evergreen pour l'accent) ; les séries de
`pilotage` tirées des six couleurs fonctionnelles et de leurs fonds sourds.

---

## 7. PWA / coque

- `__root.tsx:235` `theme-color` **#FFFFFF** et `public/manifest.webmanifest`
  `theme_color`/`background_color` **#FFFFFF**, alors que le thème par défaut
  est **sombre** (`APPARENCE_AVANT_RENDU`) : barre d'état blanche au-dessus
  d'un écran noir, et écran de lancement blanc avant un écran noir — le flash
  que le script de tête existe pour éviter. Correctif : deux `<meta
name="theme-color" media="(prefers-color-scheme: …)">` et un
  `background_color` Ink, puis mise à jour par `apparence.ts`.

---

## Classement et correctifs

| #   | Gravité | Constat                                                                                                                                              | Correctif universel                                                                                                                                                                                                                                                                                  | styles-pme ?                              |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | **P1**  | Perf mobile 64–77 (gzip), 55–58 sans compression ; FCP ≈ 4 s                                                                                         | sortir `@import "./styles-pme.css"` de `styles.css` vers la route PME, et la feuille cabinet vers le cabinet (232 Ko bruts bloquants sur l'accueil) ; ne précharger que Inter latin 400/600 ; dictionnaire `i18n` chargé par langue au lieu du français embarqué ; découper `index` (47 % inutilisé) | non (on déplace l'import, pas la feuille) |
| 2   | **P1**  | 4 rendus de `error.message` brut + refus 4xx « tels quels »                                                                                          | `texteDeLErreur` partout ; non-clé → journal + défaut                                                                                                                                                                                                                                                | non                                       |
| 3   | **P2**  | Contraste AAA : 445/1 086 paires < 7:1, dont 121 < 4,5:1 (`--signal-warn`, `--marigold` clairs ; muted cabinet sur sourd ; stop/destructive sombres) | réétalonner les jetons sur le fond sourd                                                                                                                                                                                                                                                             | **oui pour les jetons PME**               |
| 4   | **P2**  | Cibles < 44 px sur tous les écrans publics (sélecteur de langue 24 px)                                                                               | `min-h-11` sur les composants partagés                                                                                                                                                                                                                                                               | non                                       |
| 5   | **P2**  | Focus des champs publics = bordure 1 px ; `box-shadow:none !important` tue 20 anneaux                                                                | `:focus-visible` outline 2 px global ; anneaux → outline                                                                                                                                                                                                                                             | non                                       |
| 6   | **P2**  | RTL : `/confidentialite` français en RTL ; 9 icônes non retournées ; un `translate-x` physique                                                       | `dir="ltr"`, `rtl:-scale-x-100`, `rtl:translate-x-1/2`                                                                                                                                                                                                                                               | non                                       |
| 7   | **P3**  | Palette cabinet et pilotage hors marque, ≈ 200 littéraux                                                                                             | jetons nommés                                                                                                                                                                                                                                                                                        | non                                       |
| 8   | **P3**  | `theme-color` et manifeste blancs sur thème sombre par défaut                                                                                        | méta par schéma                                                                                                                                                                                                                                                                                      | non                                       |
| 9   | **P3**  | 514 Ko gz de `.woff` hérités dans le bundle Capgo (21 %), jamais lus par la WebView                                                                  | importer les CSS fontsource woff2 seuls, ou filtrer `*.woff` au build de coque                                                                                                                                                                                                                       | non                                       |
| 10  | **P3**  | CLS 0,09–0,21 sur `/confidentialite` (bascule de police)                                                                                             | `size-adjust` sur la police de repli, ou préchargement d'Inter 400                                                                                                                                                                                                                                   | non                                       |
| 11  | **P3**  | Import dynamique inefficace de `scanner.ts` ; écran « Pas de connexion » sans repère ; deux `h1`                                                     | nettoyage                                                                                                                                                                                                                                                                                            | non                                       |

Ce qui reste à mesurer : les écrans authentifiés (PME, cabinet, tour) avec
une API et une session de test, aux mêmes quatre largeurs et en arabe.
