# Le langage visuel de l'application PME

**À dupliquer à la lettre.** Les valeurs ci-dessous ont été relevées sur les
neuf maquettes de `ecrans/`, pas choisies : chaque nombre est celui qui y figure
le plus souvent. `design/malica-pme.css` les porte, prêt à poser dans
`apps/web/src/`. `design/temoin.html` les montre toutes sur une page, et sert
de contrôle : si un écran s'en écarte, la page témoin le montre.

---

## La décision à prendre avant d'écrire une ligne

`apps/web/src/styles.css` porte **Edition One** et sa doctrine est écrite en
clair, ligne 37 :

> *Doctrine : monochrome. Encre, papier, pierre. La couleur est un signal rare.
> **Coins nets (radius 0). Élévation par bordures — jamais par ombres.***

Les sept jetons de rayon y valent `0px`, et le fond est clair
(`oklch(0.985 0.002 90)`).

Les maquettes PME sont sombres, vertes et arrondies. **Un seul point de
doctrine casse réellement : le rayon.** Mesuré sur les neuf écrans : 9 ombres
en tout, dont 7 sont des `inset` — c'est-à-dire des bordures. Deux vraies
ombres portées, pour un menu flottant et une feuille modale, les deux seuls
objets qui passent devant un autre. L'élévation par bordures est donc
respectée, et la couleur reste rare.

**La recommandation : deux surfaces, deux langages.** Edition One reste
intact pour le cabinet — grand écran, dense, devant un plan comptable. La PME
reçoit le sien, sous `[data-surface="pme"]`, et rien ne fuit de l'un à l'autre.
C'est honnête : un outil professionnel sur 27 pouces et une application tenue
à une main dans un entrepôt n'ont aucune raison de se ressembler.

L'alternative — aligner les maquettes sur `radius: 0` — est jouable, mais un
bouton carré de 44 px sous un pouce ne dit pas qu'on peut le toucher. C'est
l'arbitrage de Wissem, pas celui du code.

---

## Les jetons

### Les fonds — quatre plans, pas un de plus

| | valeur | ce que c'est |
|---|---|---|
| `--bg` | `#0A0A0A` | le vide autour |
| `--d0` | `#0B0B0B` | l'écran |
| `--d1` | `#181818` | ce qu'on pose dessus : carte, bulle |
| `--d2` | `#242424` | ce qu'on pose sur la carte : champ, puce |
| `--prive` | `#0B0A0D` | l'espace privé — un cran plus froid, on sait qu'on y est |

Au-delà de quatre plans, personne ne sait plus ce qui est devant quoi.

### Les lignes — c'est elles qui portent l'élévation

`--dl: rgba(255,255,255,.08)` sépare · `--hr: rgba(255,255,255,.07)` effleure.

### L'encre

`--tx: #FFFFFF` ce qu'on lit · `--t2: #A7A7AD` ce qui explique ·
`--t3: #6E6E76` ce qui situe (libellés, unités, dates).

### L'accent — Evergreen

| | valeur | emploi |
|---|---|---|
| `--acc` | `#8FE3B1` | ce sur quoi on appuie, ce qui est actif, ce qui est fait |
| `--acc2` | `#7EE2AE` | pressé |
| `--accs` | `#3A8F54` | sourd — un fond de pastille, une barre |
| `--on-acc` | `#07210F` | ce qui s'écrit dessus |

**L'accent dit « l'interface », jamais « le verdict ».** Un « à comptabiliser »
qui porterait la couleur des boutons ne se distinguerait plus d'un bouton.

### Les quatre signaux — un seul sens chacun, dans toute l'application

| | valeur | veut dire |
|---|---|---|
| `--am` | `#DFC078` | **Amber** — ce qui attend une réponse |
| `--ve` | `#F08D72` | **Vermilion** — refusé, en retard |
| `--az` | `#8CBCE8` | **Azure** — à rapprocher, et l'espace privé |
| `--mg` | `#D97757` | **Marigold** — le plafond, et lui seul |

Une couleur qui veut dire deux choses ne veut plus rien dire. Et aucune
information n'est portée par la seule couleur : chaque puce a son mot écrit à
côté.

### La conversation

`--me: #1B3326` / `--me-tx: #DCEFE3` — la bulle de l'utilisateur est la **seule
surface teintée** de l'application. Malica parle sur `--d1` : celle qui parle le
plus est celle qui se voit le moins.

### Les rayons

`20px` grande carte et bulle · `18px` carte · `16px` carte dense · `12px`
puce · `999px` pilule · `50%` portrait. La bulle de Malica :
`20px 20px 20px 6px` — le coin pointe vers celle qui parle.

### Le texte

Inter 400/500/600/700, IBM Plex Mono pour les chiffres et les comptes. Les
deux sont **déjà embarqués** dans `styles.css` (fontsource, latin + latin-ext +
arabe) : rien à charger.

| classe | taille | emploi |
|---|---|---|
| `.t-label` | `.625rem` mono, `+.14em`, capitales | l'étiquette au-dessus d'un bloc |
| `.t-meta` | `.6875rem` | la date, l'unité, le compte |
| `.t-sub` | `.75rem` | la ligne sous un titre |
| `.t-body` | `.8125rem` / 1.5 | ce que Malica explique |
| `.t-item` | `.875rem` / 600 | le nom d'une ligne de liste |
| `.t-lead` | `.9375rem` / 1.55 | ce que Malica dit |
| `.t-h2` | `1.0625rem` / 600 | un titre de section |
| `.t-h1` | `1.3125rem` / 600 | le titre d'un écran |
| `.chiffre-xl` | `clamp(1.5rem, 7.2vw, 1.9375rem)` | le montant qui compte |

Interlettrage : `-.034em` sur les grands nombres, `-.018em` sur les titres,
`-.012em` sur le corps. Un grand nombre en espacement normal paraît se
disperser.

**Le séparateur de milliers n'est jamais une espace.** En monospace, toutes les
espaces ont la chasse d'un caractère : « 2 400,000 » s'écarte comme deux
nombres. Le formateur émet `<span class="mil"></span>`, large de `.26em`.

### Le mouvement

`.18s`, partout, pour tout. Plus vite paraît nerveux, plus lent paraît cassé.
Et `prefers-reduced-motion` a le dernier mot.

---

## Les quatre tailles

Rien n'est caché en rapetissant, rien n'est ajouté en grandissant : c'est la
même application, posée autrement.

| | ce qui change |
|---|---|
| **< 400 px** — iPhone SE, Android 360, les 320 qui traînent | gouttière à `1rem`, grands nombres en `clamp`, mots longs coupables |
| **400 – 767** — le téléphone courant | gouttière `1.25rem`, colonne 440, barre du bas dans le flux |
| **768 – 1023** — tablette, téléphone pivoté | colonne plafonnée à `30rem` + filets latéraux ; au-delà de ~75 caractères l'œil perd la ligne suivante |
| **≥ 1024** — desktop | **la barre du bas devient un rail à gauche**, collant. Grille `15rem / 32rem / 1fr` |

Une barre d'onglets collée en bas d'un écran de 27 pouces est un portage, pas
un produit. Et la colonne de contenu se place **sous le rail**, pas au centre
mathématique : centrée sur 2560 px, elle oblige à traverser l'écran du regard
pour aller du menu au contenu.

> **Vérifié** à 320, 360, 375, 390, 412, 480, 768, 834, 1024, 1280, 1440 et
> 1920 px : aucun débordement horizontal, aucune erreur console.

### Ce qui ne dépend pas de la taille

- **Les encoches.** `env(safe-area-inset-*)` sur les quatre côtés. La coque
  Capacitor **doit** porter `viewport-fit=cover` dans son `<meta viewport>` —
  sans lui ces variables valent zéro et le bouton principal passe sous la barre
  de gestes de l'iPhone.
- **La hauteur.** `100dvh` avec repli `100vh` : sur mobile, `100vh` inclut la
  barre d'URL rétractée et coupe le bas de l'écran.
- **Le survol n'existe pas au doigt.** Tous les `:hover` sont sous
  `@media (hover: hover) and (pointer: fine)`. Sans cette garde, l'état reste
  collé après le relâchement sur Android et l'écran paraît figé.
- **Les cibles.** 44 px minimum pour un bouton (Apple), 56 px pour un onglet de
  navigation, 34 px pour une pilule de filtre. Plus `touch-action: manipulation`
  et `-webkit-tap-highlight-color: transparent`.
- **Le texte grossit.** Android va jusqu'à 200 %, iOS aussi avec Dynamic Type.
  Tout est en `rem`, donc tout suit — **et aucune carte ne porte de hauteur
  fixe**. Aucune ne doit en recevoir.
- **Le focus clavier** est visible et ne se retire jamais : claviers Bluetooth
  sur tablette, et desktop.
- **L'impression.** Un dirigeant imprime un dossier pour son classeur. Fond
  blanc, encre noire, navigation et boutons retirés.

---

## Les primitives

Celles que les neuf écrans partagent, relevées par fréquence d'emploi. Elles
existent parce qu'elles portent une règle, pas une apparence — le reste
s'écrit en utilitaires Tailwind.

| classe | règle qu'elle porte |
|---|---|
| `.app` | la colonne, les encoches, la hauteur dynamique |
| `.pad` | la gouttière, encoches latérales comprises |
| `.sec` | un titre de section et son compte à droite |
| `.card` | la surface posée ; `[data-verrou]` la montre en pointillé **sans la cacher** |
| `.seg` | le sélecteur en pilules — plans, axes, onglets |
| `.btn` / `.btn-sec` / `.btn-sup` | une seule action principale par écran |
| `.nav` | dans le flux sur téléphone, rail à gauche sur desktop |
| `.malica` / `.moi` / `.sig` | la conversation, et le portrait **une fois par fil** |
| `.etat[data-k]` | la puce + le mot : fait, attente, refus, rapprochement |
| `.bar[data-k]` | la progression ; `plafond` est le seul marigold |
| `.manque` | pointillé + anneau ambre : ce qui attend |
| `.menu` / `.sheet` | les deux seuls objets qui portent une ombre portée |
| `.chiffre` | mono, tabulaire, resserré, séparateur `.mil` |

### Les quatre interdits

1. **Ne jamais teindre une surface en Evergreen.** L'accent est une encre et
   une pilule. Un écran vert ne laisse plus voir ce qui est actif.
2. **Ne jamais donner de sens comptable au vert.** « À comptabiliser » se dit
   en toutes lettres.
3. **Ne jamais faire porter une information par la seule couleur.**
4. **Ne jamais ajouter une troisième ombre.** S'il faut distinguer deux plans de
   plus, c'est l'écran qu'il faut couper.

---

## Comment poser tout ça dans le dépôt

1. `design/malica-pme.css` → `apps/web/src/styles-pme.css`, importé après
   `styles.css`.
2. Le `layout` `_authenticated/pme.tsx` pose `data-surface="pme"` sur son
   élément racine. Rien d'autre ne le porte.
3. `index.html` de la coque : `viewport-fit=cover` dans le `<meta viewport>`.
4. `design/temoin.html` → une route d'atelier (ou un Storybook). Elle n'entre
   pas dans le bundle de production, et **R9 l'interdirait si elle n'était
   importée nulle part** : la monter en route d'atelier, pas en fichier mort.
