/*
 * Le service worker de Malica Office (ANO-033, campagne du 21 octobre 2026).
 *
 * Il ne met RIEN en cache de l'application : une version servie depuis un
 * cache après un déploiement est une version fausse, et les pièces vivent
 * déjà dans la file hors ligne de l'appareil (IndexedDB). Il fait deux
 * choses, et seulement deux :
 *
 *   - rendre l'application installable (écran d'accueil, plein écran) ;
 *   - quand une PAGE ne peut pas se charger faute de réseau, montrer une page
 *     qui le dit, au lieu de l'écran d'erreur du navigateur.
 *
 * L'API n'est jamais interceptée : ses refus et ses réponses passent tels
 * quels.
 */
const HORS_LIGNE = "/hors-ligne.html";
const CACHE = "malica-hors-ligne-v1";

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(HORS_LIGNE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evenement) => {
  if (evenement.request.mode !== "navigate") return;
  evenement.respondWith(
    fetch(evenement.request).catch(() =>
      caches.match(HORS_LIGNE).then((r) => r ?? Response.error()),
    ),
  );
});
