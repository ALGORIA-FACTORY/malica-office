import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { usePme } from "@/components/regalica/pme-context";
import { RegalicaAvatar } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { PieceLue } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/coffre")({
  head: () => ({
    meta: [
      { title: "Le Coffre — Regalica Office" },
      {
        name: "description",
        content: "Ce qui part chez votre comptable, et ce qui reste entre vous et Regalica.",
      },
      { property: "og:title", content: "Le Coffre — Regalica Office" },
      {
        property: "og:description",
        content: "Ce qui part chez votre comptable, et ce qui reste entre vous et Regalica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeCoffre,
});

/**
 * Le Coffre et Mon espace — deux onglets, un mur entre eux.
 *
 * ============================================================ CE QUI EST VRAI
 *
 * Le prototype montre, côté comptable, des documents que le cabinet PRODUIT :
 * déclaration déposée, quittance, états financiers, dépôt RNE. Rien de tout
 * cela n'existe encore dans le produit — le cabinet ne dépose aucun document
 * vers la PME.
 *
 * Ce que le mur sépare RÉELLEMENT, c'est la visibilité d'une pièce : partagée
 * avec le cabinet, ou gardée pour soi. C'est le même mur, vu de l'autre côté,
 * et il est déjà tenu par la RLS. L'écran dit donc ce qui est, sans inventer
 * un dépôt qui n'a pas lieu.
 *
 * ============================================================== LE SEUL GESTE
 *
 * Transmettre. Il bascule `vis` de `personnel` à `partage`, par la fonction
 * gouvernée du Socle qui le journalise. Dans l'autre sens aussi — une pièce
 * partagée par erreur se reprend, et le journal garde les deux mouvements.
 */
function PmeCoffre() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<"partage" | "personnel">("partage");

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const basculer = useMutation({
    mutationFn: (p: PieceLue) =>
      office().collab.setPieceVis(p.id, p.vis === "partage" ? "personnel" : "partage"),
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    },
    onError: (e: unknown) => setErreur(e instanceof Error ? e.message : t("common.error")),
  });

  const toutes = pieces.data ?? [];
  const partagees = toutes.filter((p) => p.vis === "partage");
  const privees = toutes.filter((p) => p.vis === "personnel");
  const visibles = onglet === "partage" ? partagees : privees;

  const nomDuCabinet = cabinet.data?.name ?? t("pme.coffre.votreComptable");

  const jour = (p: PieceLue) => {
    const iso = p.dateDocument ?? p.createdAt;
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  };

  /**
   * Une pièce ne se reprend que tant qu'elle n'est pas comptabilisée.
   *
   * Au-delà, le cabinet a bâti une écriture dessus : la retirer de son champ
   * de vision laisserait un fait comptable sans sa preuve. La base l'interdit,
   * et l'écran cesse de le proposer plutôt que de laisser essayer.
   */
  const reprenable = (p: PieceLue) =>
    onglet === "personnel" || p.status === "capturee" || p.status === "lue";

  const bouton = "flex-1 border-0 px-3 py-[11px] text-[11.5px] font-semibold";

  return (
    <div className="rg-rise px-1 pt-2">
      <div className="flex border border-line-strong">
        <button
          type="button"
          onClick={() => setOnglet("personnel")}
          className={cn(
            bouton,
            onglet === "personnel"
              ? "bg-foreground text-background"
              : "bg-transparent text-muted-foreground",
          )}
        >
          {t("pme.coffre.tab.personnel")}
        </button>
        <button
          type="button"
          onClick={() => setOnglet("partage")}
          className={cn(
            bouton,
            onglet === "partage"
              ? "bg-foreground text-background"
              : "bg-transparent text-muted-foreground",
          )}
        >
          {t("pme.coffre.tab.partage")}
        </button>
      </div>

      {onglet === "personnel" ? (
        <div className="mt-[18px] flex gap-3">
          <RegalicaAvatar size={32} alt="Regalica" rond />
          <p className="text-[14px] leading-[1.5] text-text-2">
            {t("pme.prive.confidente", { cabinet: nomDuCabinet })}
          </p>
        </div>
      ) : null}

      <p className="mt-[18px] text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
        {onglet === "partage" ? t("pme.coffre.titre") : t("pme.prive.titre")}
      </p>
      <p className="mt-[5px] text-[13.5px] text-text-2">
        {onglet === "partage"
          ? t("pme.coffre.sous", { cabinet: nomDuCabinet })
          : t("pme.prive.sous")}
      </p>

      {/* La promesse, avec son icône. Elle n'est pas décorative : c'est la
          seule chose que le dirigeant veut savoir avant de déposer. */}
      <p className="mt-3 flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground">
        {onglet === "partage" ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <rect x="5" y="11" width="14" height="9" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        )}
        {onglet === "partage" ? t("pme.coffre.promesse") : t("pme.prive.promesse")}
      </p>

      {erreur ? <p className="mt-3 text-xs text-signal-warn">{erreur}</p> : null}

      {pieces.isPending ? (
        <p className="mt-5 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : visibles.length === 0 ? (
        <p className="mt-4 border border-border bg-card p-4 text-[13.5px] leading-[1.55] text-text-2">
          {onglet === "partage" ? t("pme.coffre.vide") : t("pme.prive.vide")}
        </p>
      ) : (
        <div className="mt-2">
          {visibles.map((p, i) => (
            <div
              key={p.id}
              className={cn(
                "py-3.5",
                i === 0 ? "border-t border-foreground" : "border-t border-border",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <Link
                  to="/pme/piece/$pieceId"
                  params={{ pieceId: p.id }}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-[14.5px] font-medium">
                    {p.emetteur ?? t("pme.list.nonLue")}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-text-2">
                    {jour(p)} ·{" "}
                    {p.total === null
                      ? t(`pme.status.${p.status}` as never)
                      : `${montant(p.total, locale)} ${p.devise ?? pme.currency}`}
                  </span>
                </Link>
                <span className="num flex-none text-[11px] uppercase text-muted-foreground">
                  {onglet === "partage" ? t("pme.coffre.badge") : t("pme.prive.badge")}
                </span>
              </div>

              {/*
               * Le geste, sur la pièce — mais seulement quand il est possible.
               *
               * La base refuse de reprendre une pièce COMPTABILISÉE : « une
               * pièce comptabilisée reste partagée ». C'est juste — le cabinet
               * a bâti une écriture dessus, la retirer laisserait un fait
               * comptable sans sa preuve. On ne propose donc pas le bouton :
               * on dit pourquoi il n'y en a pas.
               */}
              {reprenable(p) ? (
                <button
                  type="button"
                  disabled={basculer.isPending}
                  onClick={() => basculer.mutate(p)}
                  className={cn(
                    "mt-3 h-11 w-full text-[14px] font-semibold disabled:opacity-60",
                    onglet === "personnel"
                      ? "bg-foreground text-background"
                      : "border border-line-strong",
                  )}
                >
                  {onglet === "personnel"
                    ? t("pme.prive.transmettre", { cabinet: nomDuCabinet })
                    : t("pme.coffre.reprendre")}
                </button>
              ) : (
                <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
                  {t("pme.coffre.scellee")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {onglet === "partage" ? (
        <div className="mt-[18px] flex gap-3 pb-6">
          <RegalicaAvatar size={32} alt="Regalica" rond />
          <p className="text-[14px] leading-[1.5] text-text-2">{t("pme.coffre.note")}</p>
        </div>
      ) : (
        <div className="pb-6" />
      )}
    </div>
  );
}
