/**
 * « Une nouvelle photo a remplacé celle-ci » — l'avis d'une version précédente.
 *
 * Une photo reprise (« Reprendre la photo ») ne s'efface jamais : elle reste,
 * gelée, derrière celle qui la remplace, et rien ne se fait plus sur elle. Un
 * lien ancien (une notification, un historique) peut pourtant y mener. L'écran
 * le dit alors, et mène à la photo qui fait foi — la dernière de la chaîne, en
 * un geste, même après A → B → C.
 *
 * Un seul avis pour les deux côtés, la PME et le cabinet : même phrase, même
 * geste. Chaque écran ne fournit que son habit (`className`).
 */
import { useI18n } from "@/i18n";

export function VersionPrecedente({
  onVoir,
  className,
}: {
  onVoir: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={className} role="status">
      <i aria-hidden />
      <div>
        <p>{t("piece.versionPrecedente.remplacee")}</p>
        <button type="button" onClick={onVoir}>
          {t("piece.versionPrecedente.voir")}
        </button>
      </div>
    </div>
  );
}
