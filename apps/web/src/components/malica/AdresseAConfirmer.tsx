/**
 * L'adresse du compte n'est encore que déclarée : on le dit, et on renvoie le
 * lien sur demande.
 *
 * ============================================================== POURQUOI
 *
 * Une invitation ne s'ouvre que pour une adresse PROUVÉE (audit du 23 novembre
 * 2026) : sans cela, quiconque créait un compte avec l'adresse d'un associé
 * invité prenait sa place. Le lien de confirmation part à l'inscription — c'est
 * la seule preuve : le lien d'une invitation n'en est pas une, celui qui invite
 * le reçoit aussi. Tant qu'il n'est pas ouvert, la personne doit savoir
 * pourquoi ses invitations n'apparaissent pas.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

export function AdresseAConfirmer() {
  const { t } = useI18n();
  const [renvoye, setRenvoye] = useState(false);
  const adresse = useQuery({
    queryKey: ["adresse-confirmee"],
    queryFn: () => office().auth.adresseConfirmee(),
    retry: false,
  });
  const renvoyer = useMutation({
    mutationFn: () => office().auth.renvoyerConfirmation(),
    onSuccess: () => setRenvoye(true),
  });

  if (adresse.data !== false) return null;
  return (
    <section
      role="status"
      className="mt-8 border border-s-2 border-border border-s-signal-warn bg-card p-5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {t("adresse.titre")}
      </p>
      <p className="mt-2 max-w-[64ch] text-[14px]">{t("adresse.texte")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={renvoyer.isPending || renvoye}
          onClick={() => renvoyer.mutate()}
          className="border border-border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-60"
        >
          {t("adresse.renvoyer")}
        </button>
        {renvoye ? (
          <span className="text-[12.5px] text-muted-foreground">{t("adresse.renvoye")}</span>
        ) : null}
        {renvoyer.isError ? (
          <span role="alert" className="text-[12.5px] text-signal-stop">
            {t("auth.error.unreachable")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
