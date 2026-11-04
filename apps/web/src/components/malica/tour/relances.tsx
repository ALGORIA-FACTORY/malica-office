import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/**
 * Les relances d'impayé (23 octobre 2026). Fermées par défaut : rien ne part
 * tant que la tour ne les ouvre pas. La suspension automatique ne s'ouvre
 * qu'avec elles — la base le refuse aussi.
 */
export function ReglerLesRelances() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-relances"],
    queryFn: () => office().tour.reglageRelances(),
  });
  const [actives, setActives] = useState(false);
  const [suspension, setSuspension] = useState(false);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    setActives(reglage.data?.actives ?? false);
    setSuspension(reglage.data?.suspension_automatique ?? false);
  }, [reglage.data]);

  const regler = useMutation({
    mutationFn: () => office().tour.reglerRelances(actives, actives && suspension, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-relances"] });
    },
    onError: echec,
  });

  const r = reglage.data;
  const date = r?.decide_le
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(r.decide_le))
    : "";
  const etat = !r?.actives
    ? t("tour.relances.etat.fermees")
    : r.suspension_automatique
      ? t("tour.relances.etat.suspension", { date })
      : t("tour.relances.etat.ouvertes", { date });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.relances")}</h2>
      <p className={TEXTE}>{t("tour.relances.aide")}</p>
      {reglage.isSuccess ? <p className={TEXTE}>{etat}</p> : null}
      <div className="mt-2 flex flex-col gap-2">
        <label className={`${TEXTE} flex items-center gap-2`}>
          <input type="checkbox" checked={actives} onChange={(e) => setActives(e.target.checked)} />
          {t("tour.relances.actives")}
        </label>
        <label className={`${TEXTE} flex items-center gap-2`}>
          <input
            type="checkbox"
            checked={actives && suspension}
            disabled={!actives}
            onChange={(e) => setSuspension(e.target.checked)}
          />
          {t("tour.relances.suspension")}
        </label>
        <p className={TEXTE}>{t("tour.relances.suspension.aide")}</p>
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={regler.isPending || motif.trim() === "" || !reglage.isSuccess}
          onClick={() => regler.mutate()}
        >
          {t("tour.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
