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
jour ». L'API sait tout cela (`X-Malica-Client`, `/auth/rafraichir`,
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
`apps/web/capacitor.config.ts` : `webDir` réel, `cleartext: false`, clavier en
`body`, écran de lancement tenu jusqu'au premier rendu. Le fichier vit dans
`apps/web` et non à la racine : la CLI de Capacitor découvre les greffons
natifs dans les dépendances du package.json d'où elle tourne, et depuis la
racine elle n'en voyait aucun — `capacitor.plugins.json` restait vide, l'APK
n'avait ni scanner, ni coffre, ni file. `npm run coque:sync -w @malica/web`
en enregistre dix.

**La mise à jour en vol et les plantages** : Capgo prend le bundle publié par
`ota.yml` sur le canal de la cible (`VITE_CANAL_OTA`), la coque le dit prête
après le premier écran (`notifyAppReady`, sinon retour au bundle d'avant) ;
Sentry (`lib/telemetrie.ts`) reçoit les plantages de la coque seulement, sans
corps de requête, en-tête, cookie ni console — deux fonctions pures, testées,
tiennent cette promesse. Sans `VITE_SENTRY_DSN`, rien ne part. Un bouton
« Quelque chose n'a pas marché ? » dans les réglages envoie un signalement
volontaire (`app.signalements`), jamais une pièce.

**La fiche Google Play** : l'application `com.algoriafactory.malica` du
compte organisation ALGORIA Factory, version 0.1.0 (1) sur la piste de test
interne, liste « Pilote interne ». Tout ce que Play exige avant une revue est
déclaré, et fidèle au code : politique de confidentialité et adresse de
suppression des données (`/confidentialite`, ancre `#suppression`, contact
`hello@algoria-factory.com`), classification IARC « Everyone / PEGI 3 » avec
l'élément « les utilisateurs interagissent » (les messages avec le cabinet),
sécurité des données (nom, e-mail, identifiants ; pièces financières, photos,
fichiers, messages ; journaux de plantage et diagnostics — collectés, jamais
partagés, chiffrés en transit, supprimables sur demande), public 18 ans et
plus, aucune publicité, aucun identifiant publicitaire, ni application
gouvernementale, financière ou de santé, compte de test pour la revue,
catégorie « Business », tags Business / Finance / Productivity, contact de la
fiche `hello@algoria-factory.com` et `https://algoria-factory.com`. Le nom
provisoire « (unreviewed) » que voient les testeurs internes tombe à la
première version envoyée en revue, c'est-à-dire à la piste de test fermé.

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
nom affiché est « Malica (pilote) » ; l'AAB signé pour Play, lui, ne se
construit qu'en CI (`.github/workflows/android.yml`), avec la clé d'envoi.

Un bundle de coque s'éprouve aussi dans Chrome, sans téléphone :

```bash
cd apps/web && npx vite preview --mode coque-staging
```

Il se comporte alors comme le site (cookie, cadrage de la page) — c'est
`estNatif()` qui décide, pas le mode de build.

## L'outillage

Installé sans droits d'administration, dans l'espace de l'utilisateur :

- le JDK 21 (Temurin) dans `%LOCALAPPDATA%\Malica\outils\jdk\jdk-21` — le
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

## Le piège du greffon rendu par une promesse

Le premier APK s'ouvrait sur un écran blanc. Un greffon Capacitor
(`Preferences`, `App`, `SplashScreen`…) est un Proxy : toute propriété lue
devient un appel natif. Le coffre des jetons rendait `Preferences` comme
valeur d'une promesse ; JavaScript lit alors `.then` pour l'adopter, et la
coque appelait une méthode native « then » qui n'existe pas — avant le
premier écran. Une fonction `async` qui rend le greffon fait la même chose.
Règle : on rend le **module** (`await import("@capacitor/preferences")`),
jamais le greffon ; on prend `.Preferences` au moment de s'en servir.
`lib/transport/__tests__/coffre-preferences.test.ts` tient ce piège avec un
greffon factice qui explose sur `.then`.

Pour reproduire ce genre de défaut sans téléphone : servir `.output/public`
en statique et charger la page dans Chromium avec un `window.Capacitor`
factice (`isNativePlatform: () => true`) posé avant tout script — les
chemins natifs s'exécutent, et la console dit ce qui casse.

## Ce qui reste

1. **Sur un vrai appareil** — les quatre cas du scanner : un ticket de caisse
   tenu à bout de bras, une facture prise de biais, une carte d'identification
   fiscale, l'abandon sans erreur ; puis le mode avion, l'application tuée
   pendant l'envoi, le retour à chaque écran, l'arabe, la police à 130 %. Le
   protocole est dans `docs/protocole-appareils.md`.
2. **L'émulateur** — une image système « Google APIs » (ML Kit a besoin des
   services Google), pour Maestro en CI.
3. **iOS** — un Mac, Xcode, un compte développeur Apple ; le même code.
4. **Google Play, la suite** — les captures tablette 10 pouces sur la fiche
   (`android/play/`, à téléverser à la main : le navigateur de l'automate ne
   sait pas déposer un fichier) ; la piste de test fermé « Pilote » avec le
   cabinet et les PME, qui déclenche la première revue ; un projet Sentry.
5. **Mises à jour en vol, sans le magasin** — fait le 7 septembre 2026 :
   compte Capgo au nom de w.barouni@algoria-factory.com, app
   `com.algoriafactory.malica`, canaux `staging`, `pilote` et `production`
   que l'appareil choisit lui-même (`VITE_CANAL_OTA` de sa cible). Une
   étiquette `web-v<version>` publie le bundle web sur le canal ; la version
   du bundle est celle du dépôt, sans suffixe, parce que la coque refuse tout
   bundle sous sa version native et qu'en semver « 0.1.1-2 » est sous
   « 0.1.1 ». Chaque mise à jour en vol est donc une version : on monte
   package.json, on étiquette, la coque l'a au lancement suivant. La clé
   d'API est le secret `CAPGO_CLE` ; sur le poste, `%LOCALAPPDATA%Malicacapgo.token`.
6. **Google Play, sans clé** — fait le 7 septembre 2026 : `android.yml` publie
   seul par identité fédérée. Le projet Google Cloud `malica-office` porte
   le compte de service `publication-play`, invité dans Play Console avec le
   seul droit « Release apps to testing tracks », et un pool d'identité
   `github` dont le fournisseur OIDC `github-actions` n'accepte que le dépôt
   `wbarouni/malica-office`. Le workflow échange son jeton OIDC contre un
   accès d'une heure : aucune clé n'existe, nulle part. Les deux variables de
   dépôt `PLAY_FOURNISSEUR_IDENTITE` et `PLAY_COMPTE_DE_SERVICE` suffisent.

## Ce qui reste au détecteur du navigateur

Il ne disparaît pas. C'est la voie de l'aperçu, du poste de bureau, d'une
démonstration, et de tout appareil sans coque installée — chargé à la demande,
jamais dans la coque. Ses seuils sont posés sur des images de synthèse et
**n'ont jamais été mesurés sur de vraies photos** : une vingtaine de clichés
réels permettraient de les régler sur des chiffres plutôt qu'au jugé.
