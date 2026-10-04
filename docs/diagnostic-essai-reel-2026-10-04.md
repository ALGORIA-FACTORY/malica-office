# Diagnostic de l'essai réel du 4 octobre 2026

Trois anomalies, relevées sur un téléphone branché au staging. Ce document dit
pour chacune **ce qui est prouvé**, **ce qui reste à prouver**, et **pourquoi
les tests ne l'ont pas vue**. Aucune correction n'a été apportée.

Méthode : les preuves viennent de la base du staging, du contenu réel de la
pièce déposée, et d'expériences rejouées sur le serveur. Pas de la
documentation, pas d'une lecture de code seule.

---

## Anomalie 3 — la facture n'apparaît pas côté cabinet

**Cause racine, en une phrase.** La pièce est restée en visibilité
`personnel`, et la file du cabinet ne montre que ce qui porte `partage`.

**Preuve.** La pièce du 4 octobre, telle qu'elle est en base :

```
tenant  ALGORIA FACTORY SARL
source  photo        status  lue
vis     personnel    ← ici
```

Et la requête de la file, `apps/api/src/depots/supervision.ts` :

```sql
-- La file du cabinet, c'est ce qui lui a été TRANSMIS : une pièce « chez
-- vous » n'y paraît pas, même pour un compte membre des deux côtés.
where p.vis = 'partage'
```

Le mandat, lui, est **actif** : `identity.engagements`, AUDICORP ↔ ALGORIA
FACTORY, depuis le 4 octobre, sans date de fin. Le cloisonnement fonctionne
comme prévu ; c'est l'étape de transmission qui n'a pas eu lieu.

**Ce n'est donc pas un défaut d'isolement ni de mandat, mais un défaut de
valeur par défaut** — et ta décision É1 le tranche : sous mandat actif, la
pièce part au cabinet par défaut.

**Pourquoi les tests ne l'ont pas vue.** Les épreuves passent `vis = 'partage'`
explicitement quand elles déposent. Elles vérifient donc la file du cabinet
sur un chemin que l'application ne prend pas. Aucune épreuve ne suit la
séquence réelle « je photographie depuis le téléphone, mon cabinet voit ».

---

## Anomalie 2 — Malica ne répond jamais sur le fond

**Cause racine, en une phrase.** La recherche rend à Malica une version
**périmée depuis 21 mois** de l'article qui porte les taux de TVA ; Malica le
voit, répond de mémoire, ne peut citer aucune source valide, et la règle
« sans source, certitude zéro » envoie tout en relecture.

### La preuve, étape par étape

**1. Le modèle a travaillé, et bien.** L'arbitrage en attente contient sa
réponse :

> « Il n'y a pas un taux de TVA unique en Tunisie : tout dépend de ce que vous
> vendez. En 2026, le taux normal est de 19 % ; il s'applique à défaut d'autre
> taux. »

et son doute, qui est l'aveu décisif :

> « La version de l'article 7 que j'ai sous les yeux **court jusqu'au 1er
> janvier 2025** ; les taux de 2026 me viennent du paramétrage… »

Avec `certitude = 0.00` et **`sources = []`**. Jetons consommés : 11 784 → 1 634.

**2. Le corpus contient pourtant la bonne version.** Sur le staging :

```
CTVA art. 7  version 9  du 2026-01-01 au (ouvert)   ← en vigueur
```

**3. Et la recherche rend quand même la mauvaise.** Expérience rejouée sur le
serveur, en lecture seule, avec la question exacte de l'essai :

```
encodage : statut 200 · 1024 dimensions · 691 ms
FRAGMENTS RENDUS : 6
  NC-2018  art. 5        du 2018-01-01 au (ouvert)
  CTVA     art. 7        du 2024-01-01 au 2025-01-01   ← PÉRIMÉE
  NC-2021  art. 5        du 2021-01-01 au (ouvert)
  CTVA     art. 19 bis   du 2024-01-01 au 2025-01-01   ← PÉRIMÉE
  …
```

**4. Pourquoi.** Les neuf versions de l'article 7 ne sont pas dans la même
langue :

| version | langue faisant foi | période               | texte fr | texte ar | fragments |
| ------: | ------------------ | --------------------- | :------: | :------: | --------: |
|   1 à 7 | **fr**             | 2018 → **2025-01-01** |   oui    |   non    | 2 chacune |
|       8 | **ar**             | 2025 → 2026           | **non**  |   oui    |         1 |
|       9 | **ar**             | **2026 → ouvert**     | **non**  |   oui    |         1 |

Les versions 2025 et 2026 n'ont été ingérées **qu'en arabe**. Or la requête
fait `distinct on (article_id, langue_faisant_foi)` : elle rend **une version
par langue** — la dernière française, qui s'arrête en 2025, et la dernière
arabe, qui est à jour. Une question posée en français fait naturellement
gagner le fragment français… donc le texte périmé.

**5. Ce que la règle en fait.** `conseil.ts` :

```ts
const certitude = d.conseil ? (sources.length === 0 ? 0 : d.certitude) : 1;
```

Une source non retrouvée dans les fragments transmis tombe. Zéro source →
certitude zéro, mécaniquement, quelle que soit la qualité de la réponse. Puis
`ask.ts:471` : `retenue = certitude < seuil du cabinet` → arbitrage.

**6. Et un amplificateur, à corriger en même temps.** `ask.ts:347` :

```ts
try {
  fragments = await chercherDansLeDroit(api, input.question);
  droit = enTexte(fragments);
} catch {
  droit = ""; // ← l'échec est avalé : ni journal, ni trace
}
```

Le jour où la recherche tombe vraiment — encodeur injoignable, délai dépassé —
le produit se comporte exactement comme si le corpus était vide, **et personne
ne l'apprend**. Ce n'est pas la cause d'aujourd'hui (j'ai vérifié : l'encodage
répond 200 en 691 ms depuis le serveur, et les clés sont présentes dans le
conteneur), mais c'est la même panne en puissance, invisible.

### Deux causes, deux corrections

|               |                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Donnée**    | les versions 2025 et 2026 de CTVA art. 7 (et des articles voisins) n'existent qu'en arabe — le corpus français s'arrête en 2024       |
| **Recherche** | `distinct on (article_id, langue)` rend la dernière version **par langue**, sans vérifier qu'elle est en vigueur quand `jour` est nul |

La seconde est la plus grave : elle fait passer un texte périmé pour le droit
applicable. Un conseil fiscal fondé sur un article abrogé est pire qu'un
silence.

**Pourquoi les tests ne l'ont pas vue.** Les tests du conseil sont des tests
unitaires avec des fragments fabriqués : ils vérifient que la règle « sans
source, certitude zéro » s'applique, et elle s'applique parfaitement. Aucun
test n'interroge le **vrai corpus** pour vérifier que l'article rendu est
**en vigueur à la date demandée**. C'est précisément le genre de vérité que
`legal.sondages` (12 101 questions à réponse connue) pourrait tenir, et ne
tient pas encore sur ce point.

---

## Anomalie 1 — aperçu noir, puis écran d'erreur

Cette anomalie en contient **trois**, qu'il faut séparer.

### 1a. L'archive est en niveaux de gris — prouvé par la mesure

J'ai récupéré ta pièce et je l'ai décodée :

|                        |                                                                   |
| ---------------------- | ----------------------------------------------------------------- |
| Format                 | PDF 1.7, 1 page, 1 image JPEG (`DCTDecode`), espace **DeviceRGB** |
| Dimensions             | 1287 × 1800 px · **182 Ko**                                       |
| Moyenne RVB            | 244, 244, 244                                                     |
| **Saturation moyenne** | **0** — gris pur dans un conteneur RVB                            |

La cause est nommée et assumée dans le code, `apps/web/src/capabilities/scanner.ts` :

> « Passage en niveaux de gris avec étirement de dynamique : le texte gagne en
> contraste, les plans de chrominance du JPEG deviennent plats — la page pèse
> deux à trois fois moins pour une lisibilité supérieure. »

Réglages : `MAX_SIDE = 1800`, `PAGE_BYTES_BUDGET = 190 000`,
`JPEG_QUALITY` de 0,78 à 0,42. C'est un choix délibéré, contraire à ta règle.

### 1b. L'aperçu après la prise montre cette image grise — prouvé par le code

L'écran de relecture affiche `apercu.url`, c'est-à-dire la page **déjà
traitée** (`CameraScanner.tsx`, écran `apercu`). Tu ne vois donc pas ta
facture telle que l'objectif l'a vue, mais telle que l'OCR la veut.

### 1c. L'aperçu **vivant** de la caméra noir — hypothèse, non prouvée

Ce que je peux affirmer : le `<video>` est posé sur un fond `#0A0A0A`
(quasi noir), **sans attribut `autoPlay`**, et la lecture est lancée à la main
avec son erreur avalée :

```tsx
<video ref={brancherVideo} playsInline muted className="absolute inset-0 …" />
```

```ts
void el.play().catch(() => undefined);
```

Si `play()` est refusé — ce qui arrive dans une WebView Android —, l'élément
reste vide et l'on voit le fond : **noir**. C'est le mécanisme le plus
probable, et il est cohérent avec le reste (la permission caméra, si elle
avait manqué, aurait affiché un écran de motif et non du noir).

**Mais je ne peux pas le prouver d'ici**, et je ne vais pas corriger une
hypothèse : la pièce a bien été capturée et lue, donc des images ont été
saisies à un moment. Il manque une observation sur l'appareil.

### 1d. Le plantage — aucune trace, et c'est un défaut en soi

L'écran « Cet écran n'a pas pu s'afficher » est la frontière d'erreur de
`__root.tsx`. Elle rattrape, elle n'enregistre pas. Et les deux canaux qui
pourraient porter la pile sont fermés :

- `journal-atelier` est conditionné à `import.meta.env.DEV` — « rien de tout
  ceci n'existe dans le paquet livré » ;
- Sentry ne démarre qu'avec un `VITE_SENTRY_DSN` dans `.env.coque-staging`,
  fichier dont la lecture m'est refusée par le garde-fou.

Côté serveur, **aucune erreur** dans les journaux de l'API sur la période.

**Donc : dans l'application installée, un plantage client ne laisse aucune
trace nulle part.** C'est le défaut qui bloque le diagnostic de tous les
autres, et ta règle le dit déjà : « l'écran d'erreur générique reste, mais
l'erreur est journalisée avec son contexte ».

### Pourquoi les tests n'ont rien vu

Trois raisons, toutes structurelles :

1. **Les épreuves déposent des octets, elles ne scannent pas.** Tout le
   parcours caméra — permission, flux, redressement, mise en gris — vit dans le
   navigateur et n'est exercé par aucune épreuve : `epreuve-bout-en-bout`
   envoie un PDF déjà fait.
2. **D27 ferme l'autre voie.** Dans la WebView, un contenu apparu après un
   geste n'entre pas dans l'arbre d'accessibilité que lit Maestro. L'épreuve
   sur émulateur ne peut pas juger un aperçu de caméra ; trois de ses six flux
   échouent pour cette seule raison.
3. **Aucun test ne mesure la couleur.** Le test de rendu du scanner vérifie
   des comportements, jamais la saturation de l'image produite. Une chaîne qui
   rend du gris passe tous les tests.

---

## Ce qu'il me faut de toi

1. **Une observation sur l'appareil**, pour 1c et 1d. Le moyen le plus court :
   branche ton téléphone sur le serveur de développement du poste
   (`https://192.168.1.192:8443`) et refais le scan. Là, `journal-atelier` est
   actif : la pile d'appels arrive dans mes journaux, avec le fichier et la
   ligne. Dix minutes, et on arrête de supposer.
2. **Sentry** : y a-t-il un DSN configuré pour la coque staging ? Si oui, le
   plantage y est déjà et il me suffit de l'y lire. Si non, c'est à décider —
   sans lui, aucun plantage du pilote ne sera jamais observable.
3. **Le corpus français** : les versions 2025 et 2026 du Code de la TVA n'ont
   été ingérées qu'en arabe. Est-ce que tu disposes des éditions françaises
   correspondantes, ou faut-il traiter l'arabe comme faisant foi et traduire à
   l'affichage ? La réponse change la correction.

---

## Ordre que je propose, une fois ton accord

Conforme au tien — 1, 3, 2, puis 4 — avec une inversion mineure et une
addition, pour une raison précise :

1. **1d d'abord** (journaliser le plantage dans le paquet livré). Sans lui, je
   corrige à l'aveugle, et le mois dernier trois corrections à l'aveugle ont
   échoué — c'est écrit dans `journal-atelier.ts`.
2. **1a et 1b** : deux fichiers, archive couleur et copie grise interne.
3. **3** : transmission par défaut sous mandat actif, avec le statut visible.
4. **2** : la recherche ne rend que du droit en vigueur, et l'échec de la
   recherche cesse d'être muet.
5. **4** : PDF/A couleur, tableau de calibrage sur de vraies factures.

Chaque correction avec son épreuve qui suit le chemin réel du téléphone, et
son test rouge d'abord.
