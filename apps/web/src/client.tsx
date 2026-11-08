/**
 * L'entrée du navigateur : presque rien, et l'hydratation APRÈS la première
 * image quand le serveur a déjà peint la page.
 *
 * ================================================================ POURQUOI
 *
 * Sur le site, la page arrive rendue par le serveur : elle se lit sans
 * JavaScript. Mais l'entrée importait le moteur (React, le routeur, l'écran —
 * 130 Ko gzippés) et le navigateur l'exécutait AVANT de peindre le texte
 * qu'il avait déjà : premier rendu à 4 s mesuré en 4G lente (audit Lighthouse
 * du 6 novembre 2026). Importé à la demande après la première image, il se
 * télécharge toujours en parallèle, mais la page se peint d'abord, puis
 * l'application se branche dessus (`demarrage-client.tsx`).
 *
 * Quand le serveur n'a rien peint — la coque, où tout se rend sur l'appareil,
 * ou une route `ssr: false` comme `/invitation` —, attendre une image ne
 * ferait que retarder le premier écran : l'application démarre tout de suite.
 *
 * Sur le site, le dictionnaire français (celui du rendu du serveur) part en
 * même temps que le moteur, pas après lui.
 */
const demarrer = () => {
  // Le module du dictionnaire lui-même, pas `i18n/dictionnaires` : celui-ci
  // vit dans le moteur, et le français n'aurait été demandé qu'une fois le
  // moteur arrivé — deux téléchargements à la file au lieu de deux de front.
  // `chargerLaLangue("fr")` retrouvera le module déjà chargé.
  if (import.meta.env.VITE_CIBLE !== "coque") {
    void import("virtual:dictionnaire/fr/base").catch(() => undefined);
  }
  void import("./demarrage-client").then((m) => m.hydrater());
};

const rienDePeint = !document.body.querySelector(":scope > :not(script)");

if (import.meta.env.VITE_CIBLE === "coque" || rienDePeint) {
  demarrer();
} else {
  // Après la peinture de l'image en cours (rAF, puis la tâche suivante) — et,
  // dans un onglet en arrière-plan où rAF ne vient pas, au plus tard 200 ms
  // après : une page ouverte en fond s'hydrate quand même.
  let fait = false;
  const une = () => {
    if (fait) return;
    fait = true;
    demarrer();
  };
  requestAnimationFrame(() => setTimeout(une, 0));
  setTimeout(une, 200);
}
