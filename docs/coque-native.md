# La coque native — ce qui est fait, ce qui reste

## Pourquoi

D'abord le cadrage : VisionKit sur iOS, ML Kit sur Android sont déjà dans le
téléphone du client, entraînés pour cela, et ne coûtent aucun téléchargement —
l'équivalent en JavaScript pèse 15 à 30 Mo.

Puis tout ce qu'un site ne peut pas faire seul : une photo prise sans réseau qui
part toute seule plus tard, une session qui survit à la nuit, le bouton retour,
la barre d'état, le clavier.

## Ce qui est fait

**Le bundle est embarqué.** Une première version affichait le site hébergé
(`server.url`) — une page blanche sans réseau. Le même `apps/web` produit
désormais deux formes : le site (`vite build`) et le bundle de la coque
(`vite build --mode coque-<env>`), une application d'une seule page dont Start
prérend la coquille dans `.output/public/index.html`. Les cibles sont dans
`apps/web/.env.coque-{staging,pilote,prod}` — des adresses publiques, suivies
par git.

**Le transport** (`apps/web/src/lib/transport/`) : en natif, un jeton porteur
et aucun cookie ; un jeton long de trente jours dans le coffre de l'appareil
(`@capacitor/preferences`), qui tourne à chaque usage et fait revivre la
session au démarrage sans mot de passe ; un 426 qui rend l'écran « mettez à
jour ». L'API sait tout cela (`X-Regalica-Client`, `/auth/rafraichir`,
`CLIENT_MIN_VERSION`).

**La file hors ligne** (`apps/web/src/lib/hors-ligne/`) : la pièce est rangée
sur l'appareil avant tout appel (`@capacitor/filesystem`, `Directory.Data`),
puis part en trois pas rejouables. En ligne, rien ne change à l'œil.

**Le pont** (`apps/web/src/capabilities/coque.ts`) : le bouton retour, la
reprise, le réseau, l'écran de lancement — derrière une interface, imports
différés, jamais dans un navigateur. `numerisation.ts` garde le sien pour le
scanner, et la voie native ne recadre plus ce que l'appareil a déjà cadré.

**Le ressenti** : polices embarquées (Inter, IBM Plex Mono, Noto Kufi Arabic —
l'arabe est enfin assigné), `viewport-fit=cover` et la zone sûre sous la barre
basse, la langue lue avant le premier rendu, le bouton retour qui ferme d'abord
ce qui est ouvert par-dessus (`lib/superpositions.ts`), « continuer en
arrière-plan » pendant une lecture, un écran d'attente pendant la préparation.

**Le projet Android** : `android/`, généré par `npx cap add android` et commité.
`capacitor.config.ts` : `webDir` réel, `cleartext: false`, clavier en `body`,
écran de lancement tenu jusqu'au premier rendu.

## Comment construire

```bash
npm run coque:staging        # le bundle contre staging, puis cap sync android
npm run coque:ouvrir         # Android Studio sur android/, si on le veut
```

Sans Android Studio, un APK de débogage se construit depuis `android/` avec
le JDK 21 et le SDK (voir « L'outillage » plus bas) :

```bash
cd android && ./gradlew assemblePiloteDebug -PversionName=0.1.0
# → android/app/build/outputs/apk/pilote/debug/app-pilote-debug.apk
```

Il s'installe sur un téléphone en mode développeur par `adb install`. Le
nom affiché est « Regalica (pilote) » ; l'AAB signé pour Play, lui, ne se
construit qu'en CI (`.github/workflows/android.yml`), avec la clé d'envoi.

Un bundle de coque s'éprouve aussi dans Chrome, sans téléphone :

```bash
cd apps/web && npx vite preview --mode coque-staging
```

Il se comporte alors comme le site (cookie, cadrage de la page) — c'est
`estNatif()` qui décide, pas le mode de build.

## L'outillage

Installé sans droits d'administration, dans l'espace de l'utilisateur :

- le JDK 21 (Temurin) dans `%LOCALAPPDATA%\Regalica\outils\jdk\jdk-21` — le
  chemin ne doit porter ni `+` ni espace, Gradle s'y casse ;
- le SDK dans `%LOCALAPPDATA%\Android\Sdk` : `cmdline-tools/latest`,
  `platform-tools`, `platforms;android-36`, `build-tools;36.0.0` ;
- `android/local.properties` (ignoré par git) avec
  `sdk.dir=C:/Users/<nom>/AppData/Local/Android/Sdk` — en barres obliques :
  le format Java lit une barre inverse comme un échappement.

`JAVA_HOME` pointe sur le JDK au moment de lancer `gradlew`. Le premier APK
(`app-pilote-debug.apk`, 7,3 Mo, 207 fichiers du bundle embarqués) a été
construit le 6 septembre 2026 en 1 min 31.

**`AndroidManifest.xml`** porte la permission caméra, `uses-feature camera
required=false`, `android:allowBackup="false"` (la file ne doit pas être
restaurée sur un autre appareil).

## Ce qui reste

1. **Sur un vrai appareil** — les quatre cas du scanner : un ticket de caisse
   tenu à bout de bras, une facture prise de biais, une carte d'identification
   fiscale, l'abandon sans erreur ; puis le mode avion, l'application tuée
   pendant l'envoi, le retour à chaque écran, l'arabe, la police à 130 %. Le
   protocole est dans `docs/protocole-appareils.md`.
2. **L'émulateur** — une image système « Google APIs » (ML Kit a besoin des
   services Google), pour Maestro en CI.
3. **iOS** — un Mac, Xcode, un compte développeur Apple ; le même code.

## Ce qui reste au détecteur du navigateur

Il ne disparaît pas. C'est la voie de l'aperçu, du poste de bureau, d'une
démonstration, et de tout appareil sans coque installée — chargé à la demande,
jamais dans la coque. Ses seuils sont posés sur des images de synthèse et
**n'ont jamais été mesurés sur de vraies photos** : une vingtaine de clichés
réels permettraient de les régler sur des chiffres plutôt qu'au jugé.
