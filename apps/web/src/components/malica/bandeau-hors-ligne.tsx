/**
 * Le bandeau hors ligne — une ligne, en haut, tant que le réseau manque.
 *
 * Il ne bloque rien : la photo reste possible, la file la gardera. Il dit
 * seulement ce qui va se passer, pour que le dirigeant ne croie pas à une
 * panne quand sa pièce n'apparaît pas tout de suite.
 */
import { useReseau } from "@/hooks/use-reseau";
import { useI18n } from "@/i18n";

export function BandeauHorsLigne() {
  const { t } = useI18n();
  const { enLigne } = useReseau();
  if (enLigne) return null;
  return (
    <p
      aria-live="polite"
      className="border-b border-border bg-card px-[22px] py-1.5 text-center text-[11px] text-text-2"
    >
      {t("pme.horsLigne.bandeau")}
    </p>
  );
}
