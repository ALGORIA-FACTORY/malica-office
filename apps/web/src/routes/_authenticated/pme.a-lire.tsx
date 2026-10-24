import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { piecesALire } from "@/lib/a-lire";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/a-lire")({
  head: () => ({
    meta: [{ title: "À lire — Malica Office" }],
  }),
  component: ALire,
});

/**
 * À lire — choisir, parmi les pièces prises et pas encore lues, celles qu'on
 * fait lire maintenant.
 *
 * 24 octobre 2026, parcours validé par Wissem : « la lecture peut être faite
 * immédiatement lors du scan ou ultérieurement, et pour plusieurs documents
 * sélectionnés ». Le « plus tard » existait, mais rien ne retrouvait les pièces
 * remises : elles sont ici, cochées d'office (décocher est plus court que
 * cocher), et « Lire les N » rouvre le parcours à « Pour qui ? » — la question
 * qui précède toute lecture (B6).
 *
 * Les pièces viennent de la lecture que la bibliothèque a déjà faite
 * (`capture.listAvecLecture`, même clé). « À lire » = prise, ni lue, ni gardée
 * pour soi, ni refusée.
 */
function ALire() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  /** Les pièces DÉCOCHÉES : tout est coché tant qu'on n'a rien retiré. */
  const [retirees, setRetirees] = useState<ReadonlySet<string>>(new Set());

  const lues = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const aLire = piecesALire(lues.data ?? []);
  const choisies = aLire.filter((p) => !retirees.has(p.id));
  const toutes = choisies.length === aLire.length;
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(iso),
    );
  const basculer = (id: string) =>
    setRetirees((r) => {
      const n = new Set(r);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div data-ecran="alire" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="tete">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <svg viewBox="0 0 24 24" className="g fl" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <h1>
          {choisies.length === 0
            ? t("pme.aLire.titre")
            : t("pme.aLire.choisies", { count: choisies.length })}
        </h1>
        {aLire.length > 0 ? (
          <button
            type="button"
            className="tout"
            onClick={() => setRetirees(toutes ? new Set(aLire.map((p) => p.id)) : new Set())}
          >
            {toutes ? t("pme.aLire.aucune") : t("pme.aLire.toutes")}
          </button>
        ) : null}
      </div>

      <div className="pad">
        {lues.isPending ? (
          <p className="vide">{t("common.loading")}</p>
        ) : aLire.length === 0 ? (
          <p className="vide">{t("pme.aLire.vide")}</p>
        ) : (
          <div className="liste">
            {aLire.map((p) => {
              const cochee = !retirees.has(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={cochee}
                  className={cochee ? "on" : undefined}
                  onClick={() => basculer(p.id)}
                >
                  <span className="case" aria-hidden>
                    <svg viewBox="0 0 24 24" className="g">
                      <path d="M4.5 12.5l4.5 4.5 10-10" />
                    </svg>
                  </span>
                  <ApercuDePiece pieceId={p.id} className="mini" />
                  <span className="bd">
                    <b>{p.emetteur ?? t("pme.capture.pieceNonLue")}</b>
                    <span>{t("pme.aLire.prise", { jour: jour(p.createdAt) })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {aLire.length > 0 ? (
        <div className="bas">
          <button
            type="button"
            className="pr"
            disabled={choisies.length === 0}
            onClick={() =>
              void navigate({
                to: "/pme/capturer",
                search: { pieces: choisies.map((p) => p.id).join(","), depart: "destination" },
              })
            }
          >
            {choisies.length === 0
              ? t("pme.aLire.auMoinsUne")
              : t("pme.capture.choix.lireCourt", { count: choisies.length })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
