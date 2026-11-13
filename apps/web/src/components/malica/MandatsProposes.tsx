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

import type { MandatPropose } from "@malica/socle/ports/repositories";

import { cleMonCabinet } from "@/hooks/use-mon-cabinet";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

import { MalicaAvatar } from "./office-ui";

/**
 * Toutes les sociétés de la personne en un seul appel : une requête par société
 * en faisait 113 à l'ouverture de l'accueil (mesuré le 8 novembre 2026).
 */
export function MandatsProposesDesSocietes({
  societes,
  nommer,
}: {
  societes: readonly { id: string; name: string }[];
  /** Le nom de la société sur chaque carte, quand la personne en a plusieurs. */
  nommer: boolean;
}) {
  const ids = societes.map((s) => s.id);
  const proposes = useQuery({
    queryKey: ["mandats-proposes", ids],
    queryFn: () => office().identity.mandatsProposesDesSocietes(ids),
  });
  return societes.map((s) => (
    <MandatsProposes
      key={s.id}
      liste={proposes.data?.[s.id] ?? []}
      tenantId={s.id}
      societe={nommer ? s.name : undefined}
    />
  ));
}

function MandatsProposes({
  tenantId,
  societe,
  liste,
}: {
  tenantId: string;
  /**
   * Le nom de la société à qui le cabinet propose, quand la personne en a
   * plusieurs : sans en-tête qui la nomme (3 novembre 2026), la carte le dit.
   */
  societe?: string | undefined;
  liste: readonly MandatPropose[];
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Le motif de départ de l'ancienne comptabilité, par proposition (3.2). */
  const [motifs, setMotifs] = useState<Record<string, string>>({});

  const repondre = useMutation({
    mutationFn: (input: { id: string; cabinet: string; accepte: boolean; motif?: string }) =>
      office().identity.repondreAuMandat(input.id, input.accepte, input.motif ?? null),
    onSuccess: async (_r, input) => {
      setErreur(null);
      setMessage(
        input.accepte
          ? t("pme.mandat.accepte", { cabinet: input.cabinet })
          : t("pme.mandat.refuse"),
      );
      await qc.invalidateQueries({ queryKey: ["mandats-proposes"] });
      await qc.invalidateQueries({ queryKey: cleMonCabinet(tenantId) });
      await qc.invalidateQueries({ queryKey: ["mon-mandat", tenantId] });
      // Un mandat vient de naître ou de se refuser : les clients de la comptabilité se relisent.
      await qc.invalidateQueries({ queryKey: ["cab-clients"] });
      await qc.invalidateQueries({ queryKey: ["cab-queue"] });
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/MandatsProposes", t("pme.mandat.erreur"))),
  });

  if (liste.length === 0 && !message && !erreur) return null;

  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long" }).format(new Date(iso));

  return (
    <section className="rg-rise mx-[22px] mb-3 border border-s-2 border-border border-s-marigold bg-card px-3.5 py-3">
      {liste.map((m) => (
        <div key={m.id} className="flex gap-3">
          <MalicaAvatar size={28} alt="Malica" rond />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {societe ? `${t("pme.mandat.kicker")} · ${societe}` : t("pme.mandat.kicker")}
            </p>
            <p className="mt-1 text-[13.5px] leading-[1.5]">
              {t("pme.mandat.texte", { cabinet: m.cabinet })}
            </p>
            <p className="num mt-1 text-[10.5px] text-muted-foreground">
              {dateLisible(m.proposeLe)}
            </p>
            {/*
             * Une autre comptabilité est mandatée : accepter la quitte dans le
             * même geste, sans jour sans comptabilité (3.2). Elle lira le motif.
             */}
            {m.remplace ? (
              <>
                <p className="mt-2 text-[12.5px] leading-[1.5]">
                  {t("pme.mandat.quitter.aide", { ancienne: m.remplace, cabinet: m.cabinet })}
                </p>
                <input
                  value={motifs[m.id] ?? ""}
                  onChange={(e) => setMotifs((x) => ({ ...x, [m.id]: e.target.value }))}
                  placeholder={t("pme.mandat.quitter.motif", { ancienne: m.remplace })}
                  aria-label={t("pme.mandat.quitter.motif", { ancienne: m.remplace })}
                  className="mt-2 h-[42px] w-full border border-border bg-transparent px-3 text-[13px]"
                />
              </>
            ) : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  repondre.isPending || (m.remplace !== null && !(motifs[m.id] ?? "").trim())
                }
                onClick={() =>
                  repondre.mutate({
                    id: m.id,
                    cabinet: m.cabinet,
                    accepte: true,
                    ...(m.remplace ? { motif: (motifs[m.id] ?? "").trim() } : {}),
                  })
                }
                className="border border-foreground bg-foreground px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-background disabled:opacity-40"
              >
                {m.remplace
                  ? t("pme.mandat.accepterEtQuitter", { ancienne: m.remplace })
                  : t("pme.mandat.accepter")}
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
