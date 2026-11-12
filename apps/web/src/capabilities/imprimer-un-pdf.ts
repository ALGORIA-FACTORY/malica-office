/**
 * Imprimer un PDF — seul endroit qui sait comment, comme `enregistrer-un-fichier`.
 *
 * ======================================================= DEUX COQUES, UN GESTE
 *
 * Dans le navigateur (et la PWA), le PDF se charge dans un cadre invisible et
 * la boîte d'impression du système s'ouvre dessus. Si le cadre ne peut pas
 * imprimer (un navigateur qui confie les PDF à un lecteur externe), le PDF
 * s'ouvre dans un onglet : la personne l'imprime de là.
 *
 * Dans la coque Android, `window.print` ne fait rien et la coque n'a pas de
 * greffon d'impression. Elle sait en revanche écrire un fichier dans les
 * documents de l'application (`enregistrerUnFichier`) : le PDF y est remis,
 * et son chemin est rendu pour que l'écran dise où l'ouvrir. Un bouton qui
 * semble ne rien faire est pire que pas de bouton.
 */
import { estNatif } from "./coque";
import { enregistrerUnFichier, type FichierRemis } from "./enregistrer-un-fichier";

/** Le cadre de la dernière impression : il vit tant que la boîte peut encore s'ouvrir. */
let cadre: { element: HTMLIFrameElement; url: string } | null = null;

function oublierLeCadre(): void {
  if (!cadre) return;
  cadre.element.remove();
  URL.revokeObjectURL(cadre.url);
  cadre = null;
}

export async function imprimerUnPdf(pdf: Blob, nom: string): Promise<FichierRemis> {
  if (estNatif()) return enregistrerUnFichier(pdf, nom);

  oublierLeCadre();
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const element = document.createElement("iframe");
  element.setAttribute("aria-hidden", "true");
  element.tabIndex = -1;
  // Hors de l'écran, mais rendu : un cadre `display:none` n'imprime pas partout.
  element.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0";
  cadre = { element, url };
  await new Promise<void>((resoudre) => {
    element.addEventListener("load", () => resoudre(), { once: true });
    element.src = url;
    document.body.append(element);
  });
  try {
    const fenetre = element.contentWindow;
    if (!fenetre) throw new Error("cadre sans fenêtre");
    fenetre.focus();
    fenetre.print();
  } catch {
    // Le navigateur n'imprime pas depuis le cadre : le PDF s'ouvre, la personne l'imprime.
    window.open(url, "_blank", "noopener");
  }
  return { chemin: null };
}
