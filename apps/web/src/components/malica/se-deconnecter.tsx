/**
 * Se déconnecter — UN bouton, partout où un compte est ouvert : le portail,
 * le rail du cabinet, les réglages de la PME.
 *
 * Le bouton ferme la session côté serveur, puis passe par le même chemin que
 * la session qui expire (`signalerLaDeconnexion`) : la racine oublie ce qui
 * était affiché et revient à la porte. Une seule façon de partir, donc une
 * seule façon d'oublier.
 *
 * Le bouton ne porte pas son dessin : chaque espace le lui donne
 * (`className`), puisque le portail, le rail et la PME ont chacun le leur.
 */
import { useMutation } from "@tanstack/react-query";

import { useI18n } from "@/i18n";
import { signalerLaDeconnexion } from "@/lib/transport/etat";
import { office } from "@/verticals/malica-office/composition";

export function SeDeconnecter({ className }: { className?: string }) {
  const { t } = useI18n();
  const partir = useMutation({
    mutationFn: () => office().auth.deconnexion(),
    // Même si le serveur ne répond pas, la personne a demandé à partir :
    // l'écran oublie la session dans tous les cas.
    onSettled: () => signalerLaDeconnexion(),
  });
  return (
    <button
      type="button"
      onClick={() => partir.mutate()}
      disabled={partir.isPending}
      aria-busy={partir.isPending || undefined}
      className={className}
    >
      {t("app.signout")}
    </button>
  );
}
