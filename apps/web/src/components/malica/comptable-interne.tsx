/**
 * Le comptable interne d'une société, dans sa carte des Réglages › Sociétés
 * (décision du 12 novembre 2026, 7.2).
 *
 * Une place « Comptable interne » est comprise dans chaque offre, dès Basic,
 * hors des places payantes : la ligne dit qui l'occupe, ou l'invitation qui
 * l'attend. Elle n'envoie rien au comptable : son espace de travail n'existe
 * pas encore (revue de #369).
 */
import { usePlaceComptable } from "@/hooks/use-comptable-interne";
import { useI18n } from "@/i18n";
import { dateEnLettres } from "@/lib/lisible";

export function ComptableInterne({ tenantId }: { tenantId: string }) {
  const { t, locale } = useI18n();
  const p = usePlaceComptable(tenantId).data;
  if (!p) return null;
  const enPlace = p.comptables[0] ?? null;
  const attendue = p.invitations[0] ?? null;
  return (
    <p className="mn">
      {t("pme.reglages.org.comptableInterne")}{" "}
      <b>
        {enPlace
          ? (enPlace.nom ?? t("pme.membres.role.comptable"))
          : attendue
            ? t("pme.reglages.org.comptableInterne.attend", {
                email: attendue.email,
                jour: dateEnLettres(attendue.envoyeeLe.slice(0, 10), locale),
              })
            : t("pme.reglages.org.comptableInterne.aucun")}
      </b>
    </p>
  );
}
