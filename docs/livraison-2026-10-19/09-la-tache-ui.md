# La tâche UI — ce qu'il reste à poser, dans l'ordre

*Écrit le 17 octobre au soir, après que la tâche 0 a posé la livraison.*

L'application PME porte aujourd'hui **13 routes** et le langage visuel
d'Edition One. Toute la conception de l'app du dirigeant — neuf maquettes,
le système de jetons, le câblage écran par écran — est dans ce dossier et
dans la livraison, **et rien n'en est encore dans `apps/web`**.

Ce fichier dit par quoi commencer et à quoi reconnaître que c'est fini.

## Avant de toucher au JSX — lire, dans cet ordre

1. `04-design-systeme.md` — les jetons, relevés à la valeur près sur les
   maquettes, et la décision « deux surfaces, deux langages ».
2. `05-cablage-ecran-par-ecran.md` — quel appel alimente quel élément.
   Toutes les méthodes y ont été confrontées à `contrat/rpc.json` ; il en
   manque exactement sept.
3. Les maquettes elles-mêmes. **Ce ne sont pas du code à copier** : ce sont
   des spécifications exécutables. Les mots comptent, ils ont été arbitrés
   un par un.

## L'ordre, et pourquoi

### 1 — Poser le langage, avant le premier écran

- `design/malica-pme.css` → `apps/web/src/styles-pme.css`, importé après
  `styles.css`.
- `_authenticated/pme.tsx` pose `data-surface="pme"` sur sa racine. **Rien
  d'autre ne le porte** : Edition One reste intact pour le cabinet.
- La coque : `viewport-fit=cover` dans le `<meta viewport>`, sinon les
  `env(safe-area-inset-*)` valent zéro et le bouton principal passe sous la
  barre de gestes de l'iPhone.
- `design/temoin.html` devient une route d'atelier — pas un fichier mort,
  R9 l'interdirait. C'est le contrôle : si un écran s'écarte du langage,
  la page témoin le montre.

Le langage d'abord, sinon la même décision visuelle se reprend douze fois.

### 2 — Reprendre les 13 routes existantes

Elles passent au nouveau langage sans changer une seule donnée. C'est la
tâche la moins risquée, et celle qui rend le reste comparable.

### 3 — Les écrans neufs, un par branche, dans cet ordre de valeur

| | route | source |
|---|---|---|
| 1 | `pme.capturer` | `ecrans/malica-capture.html` — **c'est le produit** |
| 2 | `pme.piece.$pieceId` à compléter | `ecrans/malica-dossier.html` |
| 3 | `pme.list` aux quatre axes | `ecrans/malica-bibliotheque.html` |
| 4 | `pme.malica` | `ecrans/malica-chat.html` — le dépôt `conversations` existe déjà en entier, sans écran |
| 5 | `pme.reglages` : sièges et forfait | `ecrans/malica-parametres.html` |
| 6 | `pme.cabinet` | `ecrans/malica-manquants.html`, écran « Cabinet » |

L'écran de capture d'abord parce que c'est le seul geste que l'utilisateur
fait tous les jours. Tout le reste se consulte ; celui-là se pratique.

## Les sept méthodes à créer au contrat

`facturation.monForfait`, `facturation.sieges`, `facturation.organisations`,
`facturation.inviterSiege`, `facturation.libererPlace`, `cabinet.documents`,
`cabinet.accuserReception`. Le détail est dans `05-cablage-ecran-par-ecran.md`.

`contrat/rpc.json` est gelé et `contrat.test.ts` échoue sur toute divergence :
chaque ajout est délibéré, et se relève avec `contrat/relever.mjs`.

## À quoi on reconnaît que c'est fini

**Mesurable, pas discutable :**

- aucun débordement horizontal à 320, 360, 375, 390, 412, 480, 768, 834,
  1024, 1280, 1440 et 1920 px, sur chaque écran. C'est ce qui a été vérifié
  sur les maquettes ; il n'y a pas de raison d'en demander moins au produit ;
- aucune erreur console ;
- tous les `:hover` sous `@media (hover: hover)`. Au doigt, un survol reste
  collé après le relâchement et l'écran paraît figé ;
- aucune carte à hauteur fixe — Android laisse grossir le texte jusqu'à 200 % ;
- chaque champ a **trois** états, pas deux : la valeur, le vide (« rien ce
  mois-ci ») et l'absence (`null` → « je ne sais pas encore »). Zéro est un
  fait comptable, l'absence n'en est pas un, et les confondre sur l'écran
  d'un dirigeant est la pire chose que ce produit puisse faire ;
- une carte verrouillée par l'offre **dit ce qu'elle ferait et sous quelle
  offre** — elle ne disparaît jamais. Un produit qui cache ce qu'il vend ne
  le vend pas.

## Les quatre interdits du langage

1. Ne jamais teindre une surface en Evergreen. L'accent est une encre et une
   pilule ; un écran vert ne laisse plus voir ce qui est actif.
2. Ne jamais donner de sens comptable au vert. « À comptabiliser » se dit en
   toutes lettres.
3. Ne jamais faire porter une information par la seule couleur.
4. Ne jamais ajouter une troisième ombre. S'il faut distinguer deux plans de
   plus, c'est l'écran qu'il faut couper.
