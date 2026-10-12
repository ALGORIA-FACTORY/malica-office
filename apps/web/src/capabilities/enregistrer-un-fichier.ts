/**
 * Donner un fichier à la personne — seul endroit qui sait comment.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « le cabinet peut faire le download de la facture ou
 * n'importe quel document partagé, aussi du reçu de dépense ou revenu ».
 *
 * Les octets étaient déjà là : l'écran du cabinet les charge pour afficher la
 * pièce, et la route `/pieces/:id/contenu` les sert sous RLS. Il manquait
 * seulement de les REMETTRE — un expert qui doit joindre une facture à une
 * déclaration n'avait aucun moyen de la sortir de l'écran.
 *
 * ======================================================= DEUX COQUES, UN GESTE
 *
 * Dans le navigateur, un lien qui se clique tout seul : le navigateur range
 * dans « Téléchargements ». Dans la coque native, il n'y a pas de dossier de
 * téléchargements qu'on puisse ouvrir — le fichier est donc écrit dans les
 * documents de l'application, et le chemin est rendu pour que l'écran puisse
 * le dire. Un bouton qui semble ne rien faire est pire que pas de bouton.
 */
import { estNatif } from "./coque";

export interface FichierRemis {
  /** Où le fichier a été écrit, dans la coque native. Nul dans un navigateur. */
  chemin: string | null;
}

/** Les caractères qu'un système de fichiers refuse, remplacés — pas supprimés. */
function nomSur(nom: string): string {
  const propre = nom.replace(/[\\/:*?"<>|]/g, "-").trim();
  return propre.length > 0 ? propre : "document";
}

export async function enregistrerUnFichier(
  octets: Blob | ArrayBuffer,
  nom: string,
): Promise<FichierRemis> {
  const blob = octets instanceof Blob ? octets : new Blob([octets]);
  const sur = nomSur(nom);

  if (estNatif()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    // Capacitor écrit du base64 : il n'accepte pas un Blob.
    const base64 = await new Promise<string>((resoudre, rejeter) => {
      const lecteur = new FileReader();
      lecteur.onerror = () => rejeter(new Error("fichier.lecture_impossible"));
      lecteur.onload = () => {
        const resultat = String(lecteur.result);
        // « data:application/pdf;base64,XXXX » — on ne garde que la charge.
        resoudre(resultat.slice(resultat.indexOf(",") + 1));
      };
      lecteur.readAsDataURL(blob);
    });
    const { uri } = await Filesystem.writeFile({
      path: sur,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    return { chemin: uri };
  }

  const url = URL.createObjectURL(blob);
  try {
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = sur;
    lien.rel = "noopener";
    document.body.append(lien);
    lien.click();
    lien.remove();
  } finally {
    // Révoquer tout de suite couperait le téléchargement sur certains
    // navigateurs : on laisse le temps au geste de partir.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { chemin: null };
}
