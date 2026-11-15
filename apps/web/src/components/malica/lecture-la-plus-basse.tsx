/**
 * La lecture la plus basse sous « Toutes les sociétés » (maquette approuvée le 13 novembre
 * 2026, décision du dirigeant : nommée et touchable). Chaque société a sa licence : on ne les
 * additionne pas. Un toucher ouvre la société qui manque de lectures.
 * Sous une société, ou tant qu'aucune lecture n'est connue, le composant ne rend rien.
 */
import { useLaPlusBasseDesLectures } from "@/hooks/use-lectures-des-societes";
import { useI18n } from "@/i18n";

import { usePme } from "./pme-context";

export function LectureLaPlusBasse() {
  const { t } = useI18n();
  const pme = usePme();
  const basse = useLaPlusBasseDesLectures(pme.societeAffichee === null && pme.dossiers.length > 1);
  if (!basse) return null;
  return (
    <button type="button" className="underline" onClick={() => pme.afficherSociete(basse.id)}>
      {t("pme.toutes.lecturePlusBasse", {
        societe: basse.name,
        restantes: String(basse.restantes),
        droit: basse.droit === null ? "—" : String(basse.droit),
      })}
    </button>
  );
}
