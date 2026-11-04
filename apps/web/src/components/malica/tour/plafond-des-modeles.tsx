import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/**
 * Le plafond de dépense des modèles, par organisation et par mois (ANO-029).
 * Au-delà, le conseil de Malica refuse jusqu'au mois suivant ; le plafond
 * propre d'une organisation peut l'abaisser, jamais le relever.
 */
export function ReglerLePlafondIa() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({ queryKey: ["tour-ia"], queryFn: () => office().tour.reglageIa() });
  const [plafond, setPlafond] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (reglage.data) setPlafond(String(reglage.data.plafond_usd_par_org_mois));
  }, [reglage.data]);

  const valide = /^\d+(\.\d{1,4})?$/.test(plafond.trim());
  const regler = useMutation({
    mutationFn: () => office().tour.reglerIa(plafond.trim(), motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-ia"] });
    },
    onError: echec,
  });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.ia")}</h2>
      <p className={TEXTE}>{t("tour.ia.aide")}</p>
      {reglage.data?.decide_le ? (
        <p className={TEXTE}>
          {t("tour.ia.enVigueur", {
            plafond: String(reglage.data.plafond_usd_par_org_mois),
            date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
              new Date(reglage.data.decide_le),
            ),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          {t("tour.ia.plafond")}
          <input
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
            inputMode="decimal"
            aria-label={t("tour.ia.plafond")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!valide ? <p className={ALERTE}>{t("tour.ia.plafond.borne")}</p> : null}
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
          disabled={regler.isPending || motif.trim() === "" || !valide}
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
