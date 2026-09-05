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
import { texteDeLErreur } from "@/lib/erreur-lisible";

export const Route = createFileRoute("/_authenticated/pme/coffre")({
  head: () => ({
    meta: [
      { title: "Mon espace — Regalica Office" },
      {
        name: "description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:title", content: "Mon espace — Regalica Office" },
      {
        property: "og:description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeCoffre,
});

/**
 * Mon espace — ce que vous gardez pour vous.
 *
 * ============================================================ CE QUI EST VRAI
 *
 * Le prototype montre, côté comptable, des documents que le cabinet PRODUIT :
 * déclaration déposée, quittance, états financiers, dépôt RNE. Rien de tout
 * cela n'existe encore dans le produit — le cabinet ne dépose aucun document
 * vers la PME.
 *
 * L'écran portait donc, sous le nom « Le Coffre », L'INVERSE de ce que ce nom
 * annonce : la liste des pièces que la PME a transmises AU cabinet. Un coffre
 * qui montre ce qu'on a donné, et non ce qu'on a reçu.
 *
 * Cet onglet est supprimé. Une case vide en attendant le dépôt cabinet → PME
 * serait un titre qui promet, et le produit ne promet pas ce qu'il ne tient
 * pas. Ce qui a été transmis reste visible dans « Vos documents », avec son
 * statut — là où on le cherche vraiment.
 *
 * Reste ce qui EST vrai : le mur de visibilité, tenu par la RLS, et le seul
 * geste que la PME exerce dessus.
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
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/pme.coffre", t("common.error"))),
  });

  // Seules les pièces gardées pour soi. Ce qui est parti chez le cabinet se
  // regarde dans « Vos documents », avec son statut.
  const visibles = (pieces.data ?? []).filter((p) => p.vis === "personnel");

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
  const reprenable = (p: PieceLue) => p.status === "capturee" || p.status === "lue";

  return (
    <div className="rg-rise px-1 pt-2">
      <div className="mt-[18px] flex gap-3">
        <RegalicaAvatar size={32} alt="Regalica" rond />
        <p className="text-[14px] leading-[1.5] text-text-2">
          {t("pme.prive.confidente", { cabinet: nomDuCabinet })}
        </p>
      </div>

      <p className="mt-[18px] text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
        {t("pme.prive.titre")}
      </p>
      <p className="mt-[5px] text-[13.5px] text-text-2">{t("pme.prive.sous")}</p>

      {/* La promesse, avec son icône. Elle n'est pas décorative : c'est la
          seule chose que le dirigeant veut savoir avant de déposer. */}
      <p className="mt-3 flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground">
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
        {t("pme.prive.promesse")}
      </p>

      {erreur ? <p className="mt-3 text-xs text-signal-warn">{erreur}</p> : null}

      {pieces.isPending ? (
        <p className="mt-5 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : visibles.length === 0 ? (
        <p className="mt-4 border border-border bg-card p-4 text-[13.5px] leading-[1.55] text-text-2">
          {t("pme.prive.vide")}
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
                  {/* Le titre suit le STATUT : une pièce lue sans émetteur
                      n'est pas une pièce non lue. Voir pme.list.tsx. */}
                  <span className="block truncate text-[14.5px] font-medium">
                    {p.emetteur ??
                      (p.status === "capturee" ? t("pme.list.nonLue") : t("pme.list.sansEmetteur"))}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-text-2">
                    {jour(p)} ·{" "}
                    {p.total === null
                      ? t(`pme.status.${p.status}` as never)
                      : `${montant(p.total, locale)} ${p.devise ?? pme.currency}`}
                  </span>
                </Link>
                <span className="num flex-none text-[11px] uppercase text-muted-foreground">
                  {t("pme.prive.badge")}
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
                  className="mt-3 h-11 w-full bg-foreground text-[14px] font-semibold text-background disabled:opacity-60"
                >
                  {t("pme.prive.transmettre", { cabinet: nomDuCabinet })}
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

      <div className="pb-6" />
    </div>
  );
}
