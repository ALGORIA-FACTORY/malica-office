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
npm run coque:ouvrir         # Android Studio sur android/
```

Un bundle de coque s'éprouve aussi dans Chrome, sans téléphone :

```bash
cd apps/web && npx vite preview --mode coque-staging
```

Il se comporte alors comme le site (cookie, cadrage de la page) — c'est
`estNatif()` qui décide, pas le mode de build.

## Ce qui reste, et pourquoi pas ici

Cette machine n'a **ni Java, ni SDK Android** : la coque ne se compile pas ici.

1. **Outillage** — Android Studio (JDK 21, SDK 36, une image système « Google
   APIs » pour l'émulateur : ML Kit a besoin des services Google).
2. **`AndroidManifest.xml`** — la permission caméra, `uses-feature camera
   required=false`, `android:allowBackup="false"` (la file ne doit pas être
   restaurée sur un autre appareil).
3. **Sur un vrai appareil** — les quatre cas du scanner : un ticket de caisse
   tenu à bout de bras, une facture prise de biais, une carte d'identification
   fiscale, l'abandon sans erreur ; puis le mode avion, l'application tuée
   pendant l'envoi, le retour à chaque écran, l'arabe, la police à 130 %.
4. **La mise à jour en vol** (Capgo) et les plantages (Sentry) : la coque les
   attend, ils ne sont pas encore branchés.
5. **iOS** — un Mac, Xcode, un compte développeur Apple ; le même code.

## Ce qui reste au détecteur du navigateur

Il ne disparaît pas. C'est la voie de l'aperçu, du poste de bureau, d'une
démonstration, et de tout appareil sans coque installée — chargé à la demande,
jamais dans la coque. Ses seuils sont posés sur des images de synthèse et
**n'ont jamais été mesurés sur de vraies photos** : une vingtaine de clichés
réels permettraient de les régler sur des chiffres plutôt qu'au jugé.
