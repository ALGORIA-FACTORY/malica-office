/**
 * La carte « Licences » de la tour — l'état de chaque licence, en lecture seule.
 *
 * Écran réservé aux opérateurs d'ALGORIA (la tour). Une ligne par licence : la ou les
 * sociétés concernées, l'offre, le statut, les lectures consommées sur le droit, les
 * sièges occupés et les recharges disponibles. Tout vient de `office().tour.licences()`
 * et s'affiche tel quel : l'écran ne recalcule aucun droit et n'offre aucun geste.
 */
import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { CARTE, TEXTE, TITRE } from "./commun";

export function LesLicences() {
  const { t } = useI18n();
  const licences = useQuery({
    queryKey: ["tour-licences"],
    queryFn: () => office().tour.licences(),
  });
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.licences")}</h2>
      {(licences.data ?? []).map((l) => (
        <p key={l.licence_id} className={TEXTE} data-licence={l.licence_id}>
          <b>{l.societes ?? "—"}</b>
          <br />
          {t("tour.licences.ligne", {
            offre: l.offre_code,
            statut: l.statut,
            lectures: l.lectures_consommees,
            droit: l.lectures_droit,
            sieges: l.sieges_occupes,
            recharges: l.recharges_disponibles,
          })}
        </p>
      ))}
    </div>
  );
}
