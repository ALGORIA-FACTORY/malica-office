/**
 * La coque native — iOS et Android.
 *
 * ============================================================== POURQUOI
 *
 * D'abord pour le scanner de documents de l'appareil : VisionKit sur iOS,
 * ML Kit sur Android — les meilleurs cadrages qui existent, déjà installés
 * sur le téléphone du client, sans un octet à télécharger. L'équivalent en
 * JavaScript pèse 15 à 30 Mo : une taxe à la première photo sur le forfait
 * d'une PME tunisienne.
 *
 * Puis pour tout ce qu'un site ne peut pas faire seul : une photo prise sans
 * réseau qui part toute seule plus tard, une session qui survit à la nuit, le
 * bouton retour, la barre d'état, le clavier.
 *
 * ============================================= LE BUNDLE EST EMBARQUÉ
 *
 * Une première version affichait le site hébergé (`server.url`) : une seule
 * version en ligne, mise à jour sans les magasins. C'était simple, et c'était
 * une page blanche sans réseau — le contraire de ce qu'on demande à cette
 * application. Le bundle est donc DANS le paquet, construit en mode SPA par
 * `npm run build:coque:<env> -w @malica/web` (voir `vite.config.ts`), et
 * l'API est jointe par l'adresse déclarée dans `apps/web/.env.coque-<env>`.
 *
 * Les mises à jour du bundle sans repasser par les magasins partent par la
 * mise à jour en vol (Capgo) ; le magasin ne sert qu'aux greffons natifs.
 *
 * ============================================= POURQUOI LE FICHIER EST ICI
 *
 * La CLI de Capacitor découvre les greffons natifs dans les dépendances du
 * package.json du dossier où elle tourne. Posé à la racine de l'espace de
 * travail, ce fichier ne voyait aucun greffon — `capacitor.plugins.json`
 * restait vide, et le scanner, le coffre, la file, tout ce qui est natif
 * n'était pas dans l'APK. Les greffons sont des dépendances de `apps/web`,
 * parce que c'est le web qui les appelle ; la configuration vit donc ici, et
 * `android/` reste à la racine, désigné par son chemin.
 *
 *   npm run coque:sync -w @malica/web      cap sync android
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.algoriafactory.malica",
  appName: "Malica Office",
  webDir: ".output/public",
  android: { path: "../../android" },

  server: {
    /*
     * Jamais de clair : la coque parle à l'API en HTTPS, ou ne parle pas.
     * Une seule exception, l'émulateur de la CI (MALICA_COQUE_EMULATEUR=1
     * au moment de `cap sync`) : l'API de la machine hôte est en clair sur
     * 10.0.2.2, et la page doit l'être aussi pour qu'un contenu mixte ne
     * bloque pas l'appel. La saveur Gradle `emulateur` est la seule dont le
     * manifeste l'autorise.
     */
    cleartext: process.env["MALICA_COQUE_EMULATEUR"] === "1",
    androidScheme: process.env["MALICA_COQUE_EMULATEUR"] === "1" ? "http" : "https",
  },

  plugins: {
    /*
     * ============ LES ICÔNES DES BARRES SYSTÈME, EN CLAIR ET POUR TOUJOURS
     *
     * Relevé dans la source du greffon livré — `SystemBars.java`,
     * `getStyleForTheme()` : sans style déclaré, il lit le MODE DU TÉLÉPHONE.
     * Hors mode sombre, il rend `LIGHT`, ce qui appelle
     * `setAppearanceLightStatusBars(true)` — autrement dit des icônes NOIRES.
     *
     * Or la coque Android est l'application du dirigeant de PME, et son socle
     * est `#0A0A0A` en permanence : elle n'a pas de variante claire. Chez tout
     * utilisateur dont le téléphone est en mode clair — la majorité —, l'heure,
     * le réseau et la batterie étaient donc noirs sur presque noir. Invisibles.
     *
     * `DARK` ne veut pas dire « barre sombre » : dans ce greffon il veut dire
     * « contenu sombre dessous », donc icônes CLAIRES. C'est ce qu'il faut.
     * `bar` vide côté natif, le réglage couvre la barre d'état ET la barre
     * gestuelle.
     *
     * Ce réglage est cuit dans les actifs natifs au `cap sync` : il part par le
     * magasin, pas par la mise à jour en vol.
     */
    SystemBars: { style: "DARK" },
    // Le clavier pousse la page au lieu de la recouvrir : la barre basse et
    // le champ actif remontent ensemble.
    Keyboard: { resize: "body" as never },
    // L'écran de lancement reste jusqu'à ce que l'application dise qu'elle
    // est prête — `coque().demarrage.pret()`, après le premier rendu.
    SplashScreen: { launchAutoHide: false },
    /*
     * La mise à jour en vol (Capgo) : le bundle web publié par `ota.yml` sur
     * le canal de la cible est pris au prochain démarrage. `notifyAppReady()`
     * est appelé après le premier écran ; sans lui, la coque revient au bundle
     * d'avant. Une mise à jour par le magasin remet le bundle embarqué
     * (`resetWhenUpdate`) : c'est lui qui porte les greffons natifs neufs.
     */
    CapacitorUpdater: {
      autoUpdate: true,
      resetWhenUpdate: true,
      appReadyTimeout: 10_000,
    },
  },

  ios: {
    contentInset: "always",
  },
};

export default config;
