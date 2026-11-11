/**
 * Ma photo de profil — le geste, dans la carte du compte.
 *
 * Choisir un fichier suffit : le serveur le recadre en carré et le ré-encode
 * (voir `apps/api/src/photo-de-profil.ts`). L'écran ne recadre rien, ne garde
 * rien : il pose, il ôte, puis recharge ce que les pastilles liront.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { oterMaPhoto, poserMaPhoto } from "@/lib/photo-de-profil";

const OU = "components/malica/ma-photo";

/** Les formats que le serveur lit ; le sélecteur de l'appareil n'en propose pas d'autres. */
const FORMATS = "image/jpeg,image/png,image/webp";

export function MaPhoto({ aUnePhoto }: { aUnePhoto: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const champ = useRef<HTMLInputElement>(null);
  const [retour, setRetour] = useState<{ texte: string; erreur: boolean } | null>(null);

  const apres = async (texte: string) => {
    setRetour({ texte, erreur: false });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["photos-de-profil"] }),
      qc.invalidateQueries({ queryKey: ["photo-de-profil"] }),
    ]);
  };
  const echec = (e: unknown) =>
    setRetour({ texte: texteDeLErreur(e, OU, t("common.error")), erreur: true });

  const poser = useMutation({
    mutationFn: (fichier: File) => poserMaPhoto(fichier),
    onSuccess: () => apres(t("pme.reglages.photo.enregistree")),
    onError: echec,
  });
  const oter = useMutation({
    mutationFn: () => oterMaPhoto(),
    onSuccess: () => apres(t("pme.reglages.photo.retiree")),
    onError: echec,
  });
  const occupe = poser.isPending || oter.isPending;

  return (
    <div className="mt-3 grid gap-2">
      <input
        ref={champ}
        type="file"
        accept={FORMATS}
        hidden
        aria-label={t("pme.reglages.photo.etiquette")}
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          // Le même fichier choisi deux fois de suite doit se redéclencher.
          e.target.value = "";
          if (fichier) {
            setRetour(null);
            poser.mutate(fichier);
          }
        }}
      />
      <button
        type="button"
        className="btn btn-sec"
        disabled={occupe}
        onClick={() => champ.current?.click()}
      >
        {t(aUnePhoto ? "pme.reglages.photo.changer" : "pme.reglages.photo.ajouter")}
      </button>
      {aUnePhoto ? (
        <button
          type="button"
          className="btn btn-sec"
          disabled={occupe}
          onClick={() => oter.mutate()}
        >
          {t("pme.reglages.photo.retirer")}
        </button>
      ) : null}
      {retour ? (
        <p className="t-body" role={retour.erreur ? "alert" : "status"} aria-live="polite">
          {retour.texte}
        </p>
      ) : null}
    </div>
  );
}
