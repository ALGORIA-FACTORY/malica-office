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
 * `npm run build:coque:<env> -w @regalica/web` (voir `vite.config.ts`), et
 * l'API est jointe par l'adresse déclarée dans `apps/web/.env.coque-<env>`.
 *
 * Les mises à jour du bundle sans repasser par les magasins viendront par la
 * mise à jour en vol ; le magasin ne servira qu'aux greffons natifs.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tn.algoria.regalica",
  appName: "Regalica Office",
  webDir: "apps/web/.output/public",

  server: {
    // Jamais de clair : la coque parle à l'API en HTTPS, ou ne parle pas.
    cleartext: false,
    androidScheme: "https",
  },

  plugins: {
    // Le clavier pousse la page au lieu de la recouvrir : la barre basse et
    // le champ actif remontent ensemble.
    Keyboard: { resize: "body" as never },
    // L'écran de lancement reste jusqu'à ce que l'application dise qu'elle
    // est prête — `coque().demarrage.pret()`, après le premier rendu.
    SplashScreen: { launchAutoHide: false },
  },

  ios: {
    contentInset: "always",
  },
};

export default config;
