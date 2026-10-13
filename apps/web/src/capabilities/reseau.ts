/**
 * Le réseau : une seule source de vérité, lue de la coque quand il y en a une.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 12 octobre 2026, parcours Maestro sur émulateur. Trois flux sur six
 * échouent, dont celui du mode avion, et l'arbre d'écran capturé en mode avion
 * montre l'accueil normal — SANS bandeau.
 *
 * Le bandeau et la file d'attente lisaient tous deux `navigator.onLine`. Or,
 * dans une WebView Android, `navigator.onLine` NE BASCULE PAS en mode avion :
 * Chromium embarqué garde sa valeur optimiste, et les événements `offline` ne
 * sont pas délivrés. Le pont qui sait, lui, existait depuis septembre —
 * `coque().reseau`, bâti sur `@capacitor/network`, déclaré dans les
 * dépendances — et personne ne l'importait.
 *
 * C'est le motif récurrent de ce dépôt — l'outil construit, le consommateur
 * absent — et il tombait ici sur la promesse centrale du produit : « vos
 * photos partiront au retour du réseau ». Sur un téléphone en mode avion,
 * aucun bandeau ne le disait, et la file tentait d'envoyer.
 *
 * ========================================== POURQUOI UN MODULE, ET NON UN HOOK
 *
 * Deux consommateurs, deux natures : le bandeau est un composant React, la
 * file d'attente une fermeture sans React. Un hook n'aurait servi que le
 * premier, et c'est ainsi que la file a gardé sa propre lecture — deux
 * vérités qui ont fini par diverger.
 *
 * La vérité vit donc ici, en un seul exemplaire, et les deux la lisent. Le
 * hook `useReseau` n'est plus qu'une vue React sur ce module.
 *
 * ============================================= CE QUE CE MODULE NE PROMET PAS
 *
 * « Hors ligne » est une certitude ; « en ligne » est un espoir. Un Wi-Fi sans
 * internet se déclare connecté, et le pont de la coque n'en sait pas plus. On
 * ne promet donc rien de plus que ce que l'appareil sait — c'est assez pour un
 * bandeau et pour décider d'un essai d'envoi, qui réessaiera.
 */
import { coque, estNatif } from "./coque";

/** Les auditeurs de l'application. Un seul abonnement au pont les sert tous. */
const auditeurs = new Set<(enLigne: boolean) => void>();

/**
 * Le dernier état connu.
 *
 * Il part de `navigator.onLine` — vrai côté serveur, où l'on ne sait pas — et
 * la coque le corrige dès que `preparerLeReseau` a parlé au pont.
 */
let enLigne = typeof navigator === "undefined" ? true : navigator.onLine;

let desabonner: (() => void) | null = null;
let preparation: Promise<void> | null = null;

function poser(valeur: boolean): void {
  if (valeur === enLigne) return;
  enLigne = valeur;
  for (const auditeur of auditeurs) auditeur(valeur);
}

/**
 * S'abonner à la vérité, et la lire au démarrage.
 *
 * Les deux comptent. Un auditeur seul laisserait l'application lancée alors
 * que le téléphone est DÉJÀ hors ligne se croire en ligne jusqu'au premier
 * changement — le cas du dirigeant qui photographie dans un sous-sol.
 */
function preparer(): Promise<void> {
  if (preparation) return preparation;
  preparation = (async () => {
    if (!estNatif()) {
      // Dans un navigateur, les événements de la fenêtre sont la seule source,
      // et ils fonctionnent.
      const surEnLigne = () => poser(true);
      const surHorsLigne = () => poser(false);
      window.addEventListener("online", surEnLigne);
      window.addEventListener("offline", surHorsLigne);
      desabonner = () => {
        window.removeEventListener("online", surEnLigne);
        window.removeEventListener("offline", surHorsLigne);
      };
      poser(navigator.onLine);
      return;
    }
    const pont = coque().reseau;
    desabonner = pont.surChangement(poser);
    // L'état courant, et non le prochain changement.
    poser(await pont.etat());
  })();
  return preparation;
}

/** L'état connu du réseau, sans attendre. Jamais `null` : on part optimiste. */
export function estEnLigne(): boolean {
  void preparer();
  return enLigne;
}

/**
 * Être prévenu des changements. Rend de quoi se désabonner.
 *
 * L'abonnement au pont de la coque est unique, quel que soit le nombre de
 * lecteurs : un abonnement par lecteur multiplierait les auditeurs natifs
 * pour une seule vérité.
 */
export function surChangementDuReseau(auditeur: (enLigne: boolean) => void): () => void {
  void preparer();
  auditeurs.add(auditeur);
  return () => {
    auditeurs.delete(auditeur);
  };
}

/**
 * Attendre que la première lecture du pont soit faite.
 *
 * Utile aux épreuves, et à qui doit décider sur un état sûr plutôt que sur
 * l'optimisme du démarrage.
 */
export function pretAEtreLu(): Promise<void> {
  return preparer();
}

/*
 * Pas de `relacher()` : une première version en exportait un, que personne
 * n'appelait — ni l'application, qui vit aussi longtemps que la coque, ni les
 * épreuves, qui rechargent le module. R9 : rien de mort dans le dépôt, et un
 * export « au cas où » est du mort qui se défend bien.
 *
 * `desabonner` reste tenu pour que le jour où une coque se ferme vraiment, il
 * y ait un seul endroit à appeler — et il sera écrit à ce moment-là.
 */
