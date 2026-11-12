/**
 * Le comptable interne d'une société, dans sa carte des Réglages › Sociétés
 * (décision du 12 novembre 2026, 7.2).
 *
 * Une place « Comptable interne » est comprise dans chaque offre, dès Basic,
 * hors des places payantes : la carte dit qui l'occupe, ou l'invitation qui
 * l'attend, et le propriétaire y invite son comptable salarié. Aucun prix :
 * la place est comprise, elle s'offre aussi depuis l'application Android.
 *
 * La base décide : elle refuse la place de trop et l'appelant qui n'est pas
 * propriétaire (`comptable_interne_inviter`) ; l'écran montre le refus.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { clePlaceComptable, usePlaceComptable } from "@/hooks/use-comptable-interne";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnLettres } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

export function ComptableInterne({
  tenantId,
  proprietaire,
}: {
  tenantId: string;
  /** Le propriétaire de la société invite ; les autres lisent. */
  proprietaire: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const place = usePlaceComptable(tenantId);
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState<string | null>(null);

  const inviter = useMutation({
    mutationFn: () => office().facturation.inviterComptableInterne(email.trim(), tenantId),
    onSuccess: async (r) => {
      setErreur(null);
      setEnvoyee(r.email);
      setEmail("");
      await qc.invalidateQueries({ queryKey: clePlaceComptable(tenantId) });
    },
    onError: (e: unknown) => {
      setEnvoyee(null);
      setErreur(texteDeLErreur(e, "components/malica/comptable-interne", t("common.error")));
    },
  });

  const p = place.data;
  if (!p) return null;
  const enPlace = p.comptables[0] ?? null;
  const attendue = p.invitations[0] ?? null;
  const libre = p.engagees < p.incluses;

  return (
    <>
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
      {proprietaire && libre ? (
        <div className="invite">
          <label className="champ">
            <span className="lb">{t("pme.comptableInterne.adresse")}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("pme.membres.adresse")}
            />
          </label>
          <p className="mn">{t("pme.comptableInterne.place")}</p>
          <button
            type="button"
            className="btn"
            onClick={() => inviter.mutate()}
            disabled={inviter.isPending || email.trim().length === 0}
          >
            {t("pme.comptableInterne.inviter")}
          </button>
        </div>
      ) : null}
      {erreur ? <p className="warn">{erreur}</p> : null}
      {envoyee ? (
        <p className="ok" aria-live="polite">
          {t("pme.membres.envoyee", { email: envoyee })}
        </p>
      ) : null}
    </>
  );
}
