/**
 * La carte « Fonctions du produit » de la tour — allumer ou éteindre une fonction.
 *
 * Écran réservé aux opérateurs d'ALGORIA. Pour chaque fonction que la tour
 * tient (aujourd'hui les notes d'honoraires, livrées éteintes le 12 novembre
 * 2026), l'opérateur voit si elle est allumée, depuis quand, qui l'a décidé et
 * pourquoi. Allumer ou éteindre exige un motif, tracé avec la décision ; la
 * précédente reste au registre. Les données viennent de `office().tour` : la
 * base décide, et refuse à qui n'est pas opérateur (R3).
 */
import type { EtatDUneFonction, FonctionDuProduit } from "@malica/socle/ports/repositories";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { CLE_DES_NOTES_D_HONORAIRES } from "@/lib/notes-d-honoraires";
import { office } from "@/verticals/malica-office/composition";

import { BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/** Ce que chaque fonction dit d'elle-même, et la lecture de l'écran qu'elle commande. */
const FONCTIONS: ReadonlyArray<{
  code: FonctionDuProduit;
  titre: MessageKey;
  aide: MessageKey;
  lecture: readonly string[];
}> = [
  {
    code: "notes_honoraires",
    titre: "tour.fonctions.notes_honoraires",
    aide: "tour.fonctions.notes_honoraires.aide",
    lecture: CLE_DES_NOTES_D_HONORAIRES,
  },
];

export function LesFonctionsDuProduit() {
  const { t } = useI18n();
  const etat = useQuery({
    queryKey: ["tour-fonctions"],
    queryFn: () => office().tour.fonctions(),
  });

  return (
    <div className={CARTE} data-fonctions>
      <h2 className={TITRE}>{t("tour.fonctions")}</h2>
      <p className={TEXTE}>{t("tour.fonctions.aide")}</p>
      {etat.isPending ? <p className={TEXTE}>{t("common.loading")}</p> : null}
      {FONCTIONS.map((f) => (
        <UneFonction
          key={f.code}
          fonction={f}
          etat={etat.data?.[f.code] ?? null}
          charge={etat.isSuccess}
        />
      ))}
    </div>
  );
}

function UneFonction({
  fonction,
  etat,
  charge,
}: {
  fonction: (typeof FONCTIONS)[number];
  etat: EtatDUneFonction | null;
  charge: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const [motif, setMotif] = useState("");

  const allumee = etat?.actif === true;
  const pret = charge && motif.trim() !== "";

  const regler = useMutation({
    mutationFn: (actif: boolean) => office().tour.reglerFonction(fonction.code, actif, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-fonctions"] });
      await qc.invalidateQueries({ queryKey: fonction.lecture });
    },
    onError: echec,
  });

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  const qui = etat?.decide_par_nom ?? etat?.decide_par_email ?? null;

  return (
    <section className="mt-4 border-t border-border pt-4" data-fonction={fonction.code}>
      <h3 className={TITRE}>{t(fonction.titre)}</h3>
      <p className={TEXTE}>{t(fonction.aide)}</p>
      {etat ? (
        <>
          <p className={`${TEXTE} ${allumee ? "text-signal-ok" : ""}`} data-etat>
            {t(allumee ? "tour.fonctions.etat.allumee" : "tour.fonctions.etat.eteinte", {
              date: date(etat.decide_le),
            })}
          </p>
          <p className={TEXTE} data-par>
            {qui ? t("tour.facturation.par", { qui }) : t("tour.facturation.parLaLivraison")}
          </p>
          <p className={TEXTE} data-motif>
            {t("tour.facturation.motif", { motif: etat.motif })}
          </p>
        </>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={`${CHAMP} w-full flex-none`}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-basculer
            className={BOUTON}
            disabled={regler.isPending || !pret}
            onClick={() => regler.mutate(!allumee)}
          >
            {t(allumee ? "tour.fonctions.eteindre" : "tour.fonctions.allumer")}
          </button>
        </div>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </section>
  );
}
