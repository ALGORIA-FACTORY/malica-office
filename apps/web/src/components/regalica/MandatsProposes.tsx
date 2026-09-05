/**
 * Les mandats qu'un cabinet propose à la PME — et sa réponse.
 *
 * ============================================================== POURQUOI
 *
 * Un cabinet propose ; le dirigeant décide. Tant qu'il n'a pas répondu, le
 * mandat n'existe pas : aucune pièce ne part, aucun cabinet ne voit rien.
 * Ce bandeau est le seul endroit où l'on dit oui — et il dit ce que « oui »
 * emporte.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/regalica-office/composition";

import { RegalicaAvatar } from "./office-ui";

export function MandatsProposes({ tenantId }: { tenantId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const proposes = useQuery({
    queryKey: ["mandats-proposes", tenantId],
    queryFn: () => office().identity.mandatsProposes(tenantId),
  });

  const repondre = useMutation({
    mutationFn: (input: { id: string; cabinet: string; accepte: boolean }) =>
      office().identity.repondreAuMandat(input.id, input.accepte),
    onSuccess: async (_r, input) => {
      setErreur(null);
      setMessage(
        input.accepte
          ? t("pme.mandat.accepte", { cabinet: input.cabinet })
          : t("pme.mandat.refuse"),
      );
      await qc.invalidateQueries({ queryKey: ["mandats-proposes", tenantId] });
      await qc.invalidateQueries({ queryKey: ["mon-cabinet", tenantId] });
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/regalica/MandatsProposes", t("pme.mandat.erreur"))),
  });

  const liste = proposes.data ?? [];
  if (liste.length === 0 && !message && !erreur) return null;

  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long" }).format(new Date(iso));

  return (
    <section className="rg-rise mx-[22px] mb-3 border border-s-2 border-border border-s-marigold bg-card px-3.5 py-3">
      {liste.map((m) => (
        <div key={m.id} className="flex gap-3">
          <RegalicaAvatar size={28} alt="Regalica" rond />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("pme.mandat.kicker")}
            </p>
            <p className="mt-1 text-[13.5px] leading-[1.5]">
              {t("pme.mandat.texte", { cabinet: m.cabinet })}
            </p>
            <p className="num mt-1 text-[10.5px] text-muted-foreground">
              {dateLisible(m.proposeLe)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ id: m.id, cabinet: m.cabinet, accepte: true })}
                className="border border-foreground bg-foreground px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-background disabled:opacity-40"
              >
                {t("pme.mandat.accepter")}
              </button>
              <button
                type="button"
                disabled={repondre.isPending}
                onClick={() => repondre.mutate({ id: m.id, cabinet: m.cabinet, accepte: false })}
                className="border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
              >
                {t("pme.mandat.refuser")}
              </button>
            </div>
          </div>
        </div>
      ))}
      {message ? <p className="mt-2 text-[12.5px] text-signal-ok">{message}</p> : null}
      {erreur ? (
        <p role="alert" className="mt-2 text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
