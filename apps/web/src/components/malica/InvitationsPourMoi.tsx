/**
 * Les invitations qui attendent la personne connectée — et sa réponse.
 *
 * ============================================================== POURQUOI
 *
 * Un cabinet invite une adresse. Quand cette adresse se connecte, elle
 * trouve ici l'invitation, avec le rôle réservé, et rejoint le cabinet d'un
 * geste — ou décline. Pas de lien, pas de courriel : le compte est la preuve.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

const ROLES: Record<string, MessageKey> = {
  expert: "cab.rail.role.expert",
  dirigeant: "cab.rail.role.dirigeant",
  collaborateur: "cab.rail.role.collaborateur",
  assistant: "cab.rail.role.assistant",
};

export function InvitationsPourMoi() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const invitations = useQuery({
    queryKey: ["invitations-pour-moi"],
    queryFn: () => office().collab.invitationsPourMoi(),
  });

  const repondre = useMutation({
    mutationFn: (input: { id: string; cabinet: string; accepte: boolean }) =>
      office().collab.repondreAInvitation(input.id, input.accepte),
    onSuccess: async (_r, input) => {
      setErreur(null);
      setMessage(
        input.accepte
          ? t("portal.invitations.rejoint", { cabinet: input.cabinet })
          : t("portal.invitations.decline"),
      );
      // Les organisations de la personne viennent de changer : tout se relit.
      await qc.invalidateQueries();
    },
    onError: (e: unknown) =>
      setErreur(
        texteDeLErreur(e, "components/malica/InvitationsPourMoi", t("portal.invitations.erreur")),
      ),
  });

  const liste = invitations.data ?? [];
  if (liste.length === 0 && !message && !erreur) return null;

  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" }).format(
      new Date(iso),
    );
  const roleLisible = (role: string) => {
    const cle = ROLES[role];
    return cle ? t(cle) : role;
  };

  return (
    <section className="mt-8 border border-s-2 border-border border-s-marigold bg-card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {t("portal.invitations.titre")}
      </p>
      <ul className="mt-3 divide-y divide-border">
        {liste.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">
                {t("portal.invitations.texte", { cabinet: i.cabinet, role: roleLisible(i.role) })}
              </p>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">
                {t("portal.invitations.expire", { date: dateLisible(i.expiresAt) })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ id: i.id, cabinet: i.cabinet, accepte: true })}
                className="border border-foreground bg-foreground px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-background disabled:opacity-40"
              >
                {t("portal.invitations.rejoindre")}
              </button>
              <button
                type="button"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ id: i.id, cabinet: i.cabinet, accepte: false })}
                className="border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
              >
                {t("portal.invitations.decliner")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {message ? <p className="mt-2 text-[12.5px] text-signal-ok">{message}</p> : null}
      {erreur ? (
        <p role="alert" className="mt-2 text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
