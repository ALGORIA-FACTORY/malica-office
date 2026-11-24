/**
 * Glisser des fichiers sur l'écran « Ajouter des pièces », ou les coller (⌘V / Ctrl+V), au
 * poste de bureau.
 *
 * Le crochet ne juge rien : il rend les fichiers reçus, et la coque les fait passer par
 * `files.deposer` — les contrôles d'« Importer des images / PDF ». Un collage de TEXTE (dans un
 * champ, ou sans fichier) est laissé au navigateur ; un glisser sans fichier aussi.
 */
import { useEffect, useRef } from "react";

import { useBureau } from "@/hooks/use-bureau";

/** Les fichiers d'un glisser-déposer ou d'un presse-papiers ; aucun s'il n'en porte pas. */
function fichiersDuTransfert(transfert: DataTransfer | null | undefined): File[] {
  return transfert?.files ? [...transfert.files] : [];
}

function porteDesFichiers(transfert: DataTransfer | null | undefined): boolean {
  return [...(transfert?.types ?? [])].includes("Files");
}

export function useDepotDeFichiers(actif: boolean, surFichiers: (fichiers: File[]) => void) {
  const bureau = useBureau();
  const rappel = useRef(surFichiers);
  useEffect(() => {
    rappel.current = surFichiers;
  });

  useEffect(() => {
    if (!actif || !bureau) return;
    // Sans `preventDefault` au survol, le navigateur ouvre le fichier à la place de l'écran.
    const survol = (e: DragEvent) => {
      if (porteDesFichiers(e.dataTransfer)) e.preventDefault();
    };
    const depot = (e: DragEvent) => {
      const fichiers = fichiersDuTransfert(e.dataTransfer);
      if (fichiers.length === 0) return;
      e.preventDefault();
      rappel.current(fichiers);
    };
    const collage = (e: ClipboardEvent) => {
      const fichiers = fichiersDuTransfert(e.clipboardData);
      if (fichiers.length === 0) return;
      e.preventDefault();
      rappel.current(fichiers);
    };
    window.addEventListener("dragover", survol);
    window.addEventListener("drop", depot);
    window.addEventListener("paste", collage);
    return () => {
      window.removeEventListener("dragover", survol);
      window.removeEventListener("drop", depot);
      window.removeEventListener("paste", collage);
    };
  }, [actif, bureau]);
}
