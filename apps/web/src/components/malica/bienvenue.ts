/**
 * L'arrivée a-t-elle déjà eu lieu ?
 *
 * ======================================================= POURQUOI PAS EN BASE
 *
 * Parce que la question n'est pas « ce dossier a-t-il été présenté » mais
 * « CETTE PERSONNE, sur CET APPAREIL, a-t-elle déjà vu la présentation ». Un
 * dirigeant qui installe l'application sur un second téléphone la revoit, et
 * c'est juste : il découvre l'écran, pas le dossier.
 *
 * ================================================ ET POURQUOI PAS SEULEMENT
 * ================================================ « ZÉRO PIÈCE »
 *
 * Zéro pièce dit que le dossier est neuf, pas que la présentation a été lue.
 * Sans mémoire du geste, « plus tard » renverrait à l'accueil et la
 * présentation reviendrait au rechargement suivant — un écran dont on ne peut
 * pas sortir.
 *
 * Les deux conditions comptent donc : un dossier vide ET une présentation
 * jamais congédiée.
 */
const CLE = "malica.bienvenue.vue";

export function bienvenueDejaVue(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CLE) === "1";
  } catch {
    // Stockage refusé : on considère l'arrivée faite plutôt que de la
    // rejouer à chaque écran.
    return true;
  }
}

export function marquerBienvenueVue(): void {
  try {
    window.localStorage.setItem(CLE, "1");
  } catch {
    // Sans mémoire, elle reviendra — mais « plus tard » aura quand même
    // ramené à l'accueil.
  }
}
