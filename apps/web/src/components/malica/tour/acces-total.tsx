/**
 * L'accès total — qui l'a, et le geste de l'accorder ou de le retirer (écran de la tour).
 *
 * Écran de l'opérateur ALGORIA : la liste des accès en vigueur (qui, depuis quand, par qui,
 * pour quel motif), l'accord à un compte par son e-mail et le retrait, chacun avec un motif
 * obligatoire. L'écran ne décide rien : la base refuse un compte qui n'est pas opérateur
 * et un motif vide, et journalise chaque décision sous son auteur. Un accès dont le
 * titulaire n'est plus opérateur est signalé inactif.
 */
import type { AccesTotalEnVigueur } from "@malica/socle/ports/repositories";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const CLE = ["tour-acces-total"] as const;

/**
 * L'accès total (décision du dirigeant, 5 novembre 2026) : qui l'a, depuis
 * quand, pourquoi, et qui l'a donné. La tour l'accorde à un opérateur — soi
 * compris —, motif à l'appui, et le retire de même. La base décide de tout :
 * elle refuse un compte qui n'est pas opérateur et un motif vide, et
 * journalise chaque décision sous son auteur.
 */
export function LAccesTotal() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const liste = useQuery({ queryKey: CLE, queryFn: () => office().tour.accesTotal() });
  const [email, setEmail] = useState("");
  const [motif, setMotif] = useState("");

  const accorder = useMutation({
    mutationFn: () => office().tour.accorderAccesTotal(email.trim(), motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setEmail("");
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });

  return (
    <div className={CARTE} data-acces-total>
      <h2 className={TITRE}>{t("tour.menu.acces")}</h2>
      <p className={TEXTE}>{t("tour.acces.aide")}</p>
      {liste.isPending ? <p className={TEXTE}>{t("common.loading")}</p> : null}
      {liste.isSuccess && liste.data.length === 0 ? (
        <p className={TEXTE} data-aucun>
          {t("tour.acces.aucun")}
        </p>
      ) : null}
      {liste.data && liste.data.length > 0 ? (
        <ul className="grid gap-3">
          {liste.data.map((a) => (
            <UnAcces key={a.user_id} acces={a} />
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="off"
          placeholder={t("tour.acces.email")}
          aria-label={t("tour.acces.email")}
          className={`${CHAMP} w-full flex-none`}
        />
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={`${CHAMP} w-full flex-none`}
        />
        <div>
          <button
            type="button"
            data-accorder
            className={BOUTON}
            disabled={accorder.isPending || email.trim() === "" || motif.trim() === ""}
            onClick={() => accorder.mutate()}
          >
            {t("tour.acces.accorder")}
          </button>
        </div>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

function UnAcces({ acces }: { acces: AccesTotalEnVigueur }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const [motif, setMotif] = useState("");
  const retirer = useMutation({
    mutationFn: () => office().tour.retirerAccesTotal(acces.user_id, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(acces.depuis),
  );

  return (
    <li className="space-y-1" data-acces={acces.email}>
      <p className="text-[13px] font-medium">
        {acces.nom ? `${acces.nom} · ` : null}
        <span className="num" dir="ltr">
          {acces.email}
        </span>
      </p>
      <p className={TEXTE}>
        {t("tour.acces.depuis", { date, par: acces.par_email ?? "—", motif: acces.motif })}
      </p>
      {acces.operateur ? null : <p className={ALERTE}>{t("tour.acces.inactif")}</p>}
      <div className="flex flex-wrap gap-2">
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          data-retirer
          className={BOUTON}
          disabled={retirer.isPending || motif.trim() === ""}
          onClick={() => retirer.mutate()}
        >
          {t("tour.acces.retirer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </li>
  );
}
