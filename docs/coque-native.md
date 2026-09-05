# La coque native — ce qui est fait, ce qui reste

## Pourquoi

Le cadrage. Rien d'autre.

Le détecteur écrit dans `apps/web/src/capabilities/scanner.ts` trouve la
silhouette d'un document, en extrait quatre coins et redresse la perspective. Il
est honnête et il est éprouvé. Il ne sera jamais aussi bon que ce qu'Apple et
Google embarquent : un scanner de documents entraîné, avec correction en direct,
rattrapage des coins au doigt, et nettoyage des ombres et des doigts sur la
feuille.

Ces deux scanners sont **déjà dans le téléphone du client** et ne coûtent aucun
téléchargement.

| Voie | Android + iOS | Poids ajouté |
| --- | --- | --- |
| `@capgo/capacitor-document-scanner` (retenu) | oui, natif | **0 Mo** |
| `@techstark/opencv-js` | oui, navigateur | 14,7 Mo |
| `jscanify` (OpenCV emballé) | oui, navigateur | 30,4 Mo |

## Ce qui est fait

- **`apps/web/src/capabilities/numerisation.ts`** — le module qui décide QUI
  cadre. Il rend `null` hors de la coque native, et l'écran cadre alors
  lui-même. Le pont vers Capacitor est une interface, donc le module est
  éprouvé sans coque : 7 épreuves.
- **`files.scannerDeLAppareil()`** — la seule porte d'entrée. Les écrans ne
  connaissent pas Capacitor.
- **`apps/web/src/routes/_authenticated/pme.tsx`** — le bouton de capture
  essaie le scanner de l'appareil, puis retombe sur le nôtre.
- **`capacitor.config.ts`** — la configuration, commentée.
- **Dépendances installées** : `@capacitor/core`, `@capgo/capacitor-document-scanner`.

Rien de tout cela ne change le comportement dans un navigateur : les deux
chemins rendent la même chose — des pages déjà redressées.

## Ce qui reste, et pourquoi pas ici

Cette machine n'a **ni Java, ni SDK Android**, et iOS demande **un Mac avec
Xcode**. La coque ne peut donc pas être compilée ici. Les étapes :

### 1. Outillage

- **Android** : Android Studio (il installe le SDK et le JDK).
- **iOS** : un Mac, Xcode, et un compte développeur Apple.

### 2. Créer les projets natifs

```bash
npm install -D @capacitor/cli && npm install @capacitor/android @capacitor/ios
```

```bash
npx cap add android
```

```bash
npx cap sync
```

`npx cap add ios` se fait sur le Mac, ensuite.

### 3. L'adresse servie par la coque

`capacitor.config.ts` lit `REGALICA_COQUE_URL`. En développement, l'adresse du
poste en HTTPS ; en production, le domaine du service.

Avant toute soumission aux magasins : vérifier que `cleartext` est `false` et
que l'URL est bien celle de production.

### 4. Les autorisations

- **Android** — `android/app/src/main/AndroidManifest.xml` : la caméra.
- **iOS** — `Info.plist` : `NSCameraUsageDescription`, rédigée en clair pour le
  client (« Pour photographier vos factures et vos reçus »), parce qu'Apple la
  lit et que le client la lit aussi.

### 5. Vérifier sur un vrai appareil

Le scanner natif ne peut être vu que sur un téléphone. À observer :

- un **ticket de caisse** tenu à bout de bras — le cas qui échouait ;
- une **facture prise de biais** — la perspective doit être redressée ;
- une **carte d'identification fiscale** ;
- l'**abandon** de la capture : il ne doit afficher aucune erreur.

## Ce qui reste au détecteur du navigateur

Il ne disparaît pas. C'est la voie de l'aperçu, du poste de bureau, d'une
démonstration, et de tout appareil sans coque installée. Ses seuils —
`PETIT_COTE_MIN_PX`, `RESSEMBLANCE_MIN`, `SHARPNESS_MIN` — sont posés sur des
images de synthèse et **n'ont jamais été mesurés sur de vraies photos**. Une
série d'une vingtaine de clichés réels permettrait de les régler sur des
chiffres plutôt qu'au jugé.
