import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import type { OrganisationEmettrice } from "@malica/socle/ports/repositories";

import { BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

export function DesignerLEmetteur() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const emetteur = useQuery({
    queryKey: ["tour-emetteur"],
    queryFn: () => office().tour.emetteur(),
  });
  const [texte, setTexte] = useState("");
  const [depuis, setDepuis] = useState(new Date().toISOString().slice(0, 10));
  const trouvees = useQuery({
    queryKey: ["tour-organisations", texte],
    queryFn: () => office().tour.chercherOrganisations(texte),
    enabled: texte.trim().length >= 2,
  });

  /*
   * Recette du 20 octobre 2026 : un clic désignait l'émetteur des factures de
   * la plateforme, sans motif. Désormais : choisir, motiver, confirmer — et
   * l'émetteur en vigueur ne se propose pas à lui-même.
   */
  const [choisie, setChoisie] = useState<OrganisationEmettrice | null>(null);
  const [motif, setMotif] = useState("");
  const designer = useMutation({
    mutationFn: (o: OrganisationEmettrice) =>
      office().tour.designerEmetteur(o.organisation_id, depuis, motif.trim()),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setChoisie(null);
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-emetteur"] });
    },
    onError: echec,
  });

  const e = emetteur.data;
  const candidates = (trouvees.data ?? []).filter(
    (o) => !e || o.organisation_id !== e.organisation_id,
  );
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.emetteur")}</h2>
      <p className={TEXTE}>
        {e
          ? t("tour.emetteur.actuel", {
              nom: e.nom,
              matricule: e.matricule ?? "—",
              date: e.valide_des
                ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
                    new Date(`${e.valide_des}T00:00:00Z`),
                  )
                : "—",
            })
          : t("tour.emetteur.aucun")}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <input
          value={texte}
          onChange={(ev) => setTexte(ev.target.value)}
          placeholder={t("tour.emetteur.chercher")}
          aria-label={t("tour.emetteur.chercher")}
          className={CHAMP}
        />
        <label className={TEXTE}>
          {t("tour.emetteur.depuis")}{" "}
          <input
            type="date"
            value={depuis}
            onChange={(ev) => setDepuis(ev.target.value)}
            className={CHAMP}
          />
        </label>
        {choisie === null
          ? candidates.map((o) => (
              <button
                key={o.organisation_id}
                type="button"
                className={BOUTON}
                onClick={() => setChoisie(o)}
              >
                {t("tour.emetteur.designer", { nom: `${o.nom} · ${o.matricule ?? "—"}` })}
              </button>
            ))
          : null}
        {choisie ? (
          <>
            <p className={TEXTE}>
              {t("tour.emetteur.confirmer", {
                nom: `${choisie.nom} · ${choisie.matricule ?? "—"}`,
              })}
            </p>
            <input
              value={motif}
              onChange={(ev) => setMotif(ev.target.value)}
              placeholder={t("common.motif")}
              aria-label={t("common.motif")}
              className={CHAMP}
            />
            <button
              type="button"
              className={BOUTON}
              disabled={designer.isPending || motif.trim() === ""}
              onClick={() => designer.mutate(choisie)}
            >
              {t("tour.enregistrer")}
            </button>
            <button
              type="button"
              className={BOUTON}
              disabled={designer.isPending}
              onClick={() => {
                setChoisie(null);
                setMotif("");
              }}
            >
              {t("common.cancel")}
            </button>
          </>
        ) : null}
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
