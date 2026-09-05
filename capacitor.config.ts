/**
 * La coque native — iOS et Android.
 *
 * ============================================================== POURQUOI
 *
 * Une seule raison, et elle suffit : le scanner de documents de l'appareil.
 * VisionKit sur iOS, ML Kit sur Android. Ce sont les meilleurs cadrages qui
 * existent, ils sont déjà installés sur le téléphone du client, et les appeler
 * ne coûte aucun téléchargement.
 *
 * L'équivalent en JavaScript — OpenCV compilé pour le navigateur — pèse 15 Mo,
 * et 30 Mo emballé dans une bibliothèque de scan. Sur le forfait mobile d'une
 * PME tunisienne, c'est une taxe prélevée à la première photo, et un code qu'il
 * faudrait jeter le jour où cette coque existe.
 *
 * Tout le reste de l'application est inchangé : `numerisation.ts` rend `null`
 * hors de la coque, et l'écran cadre lui-même. Voir `apps/web/src/capabilities`.
 *
 * ==================================================== CE QUI RESTE À FAIRE
 *
 * Voir `docs/coque-native.md`. Cette machine n'a ni Java, ni SDK Android, et
 * iOS demande un Mac : la coque ne peut pas être compilée ici.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tn.algoria.regalica",
  appName: "Regalica Office",

  /*
   * ================================================= POURQUOI UN SERVEUR DISTANT
   *
   * L'application web est rendue côté serveur (TanStack Start + nitro) : il n'y
   * a pas de dossier de fichiers statiques à embarquer. Deux voies existent, et
   * celle-ci est la bonne pour un produit en service :
   *
   *   `server.url`   la coque affiche l'application hébergée. Une seule version
   *                  en ligne, mise à jour sans repasser par les magasins, et
   *                  les greffons natifs restent disponibles.
   *
   *   `webDir`       l'application est figée dans le paquet. Il faudrait alors
   *                  la reconstruire en mode statique, et chaque correction
   *                  demanderait une nouvelle soumission à Apple et Google.
   *
   * `webDir` reste déclaré parce que Capacitor l'exige, même inutilisé.
   */
  webDir: "apps/web/.output/public",

  server: {
    /*
     * ============================================== AUCUNE ADRESSE PAR DÉFAUT
     *
     * Il y avait ici, en repli, l'adresse LAN du poste de développement —
     * « 192.168.1.192 ». Une production qui oublie la variable aurait pointé,
     * en silence, sur une adresse morte : l'application se serait ouverte sur
     * une page blanche sans que rien ne dise pourquoi.
     *
     * Une adresse manquante est une erreur de configuration, et une erreur de
     * configuration doit arrêter la construction, pas la laisser passer avec
     * une valeur qui n'est vraie que chez une seule personne.
     *
     *   développement   REGALICA_COQUE_URL=https://<adresse-du-poste>:8443
     *   production      REGALICA_COQUE_URL=https://<domaine-du-service>
     */
    url: (() => {
      const declaree = process.env["REGALICA_COQUE_URL"];
      if (!declaree) {
        throw new Error(
          "REGALICA_COQUE_URL absente : l'adresse servie par la coque doit être déclarée",
        );
      }
      return declaree;
    })(),
    // Le certificat de développement est signé par lui-même. Cette tolérance
    // ne doit JAMAIS être vraie dans un paquet livré : elle accepterait
    // n'importe quel certificat, donc n'importe quel intermédiaire.
    cleartext: false,
    androidScheme: "https",
  },

  ios: {
    contentInset: "always",
  },
};

export default config;
