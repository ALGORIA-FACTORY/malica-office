import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { usePme } from "@/components/malica/pme-context";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/regler")({
  head: () => ({
    meta: [
      { title: "À régler — Malica Office" },
      { name: "description", content: "Ce que votre comptable vous a retourné, et pourquoi." },
      { property: "og:title", content: "À régler — Malica Office" },
      {
        property: "og:description",
        content: "Ce que votre comptable vous a retourné, et pourquoi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ARegler,
});

interface RetourPayload {
  piece_id?: string;
  motif_id?: string;
  note?: string | null;
}

/**
 * À régler ensemble — la récupération d'erreur.
 *
 * ====================================================== POURQUOI « ENSEMBLE »
 *
 * Une pièce retournée n'est pas une faute du dirigeant. Le prototype le dit
 * dans son titre — « à régler ENSEMBLE » — et dans sa dernière phrase :
 * « aucune urgence ». C'est un écran de réparation, et le ton compte autant
 * que le contenu : un dirigeant qui se sent pris en défaut cesse de
 * photographier ses factures, et le produit meurt là.
 *
 * ============================================================== D'OÙ ÇA VIENT
 *
 * De la notification, et de rien d'autre. Quand le cabinet retourne une
 * pièce, `socle_ecriture_review` inscrit `piece.retournee` avec le motif
 * gouverné et la note. C'est le canal côté PME — le journal d'audit, lui,
 * appartient au cabinet.
 *
 * Le motif est traduit par `ref.rejet_motifs`, que la PME peut lire : elle
 * voit donc le MÊME libellé que l'expert a choisi, pas une paraphrase.
 */
function ARegler() {
  const { t, locale } = useI18n();
  const pme = usePme();

  const notifs = useQuery({
    queryKey: ["notifications", pme.tenantId],
    queryFn: () => office().collab.notifications([pme.tenantId]),
  });

  const motifs = useQuery({
    queryKey: ["rejet-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });

  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const nomDuCabinet = cabinet.data?.name ?? t("pme.coffre.votreComptable");

  // Seules les pièces ENCORE retournées : une pièce reprise puis
  // recomptabilisée ne doit plus figurer ici, même si sa notification reste.
  const enAttente = (pieces.data ?? []).filter((p) => p.status === "retournee");

  const retours = (notifs.data ?? [])
    .filter((n) => n.kind === "piece.retournee")
    .map((n) => ({ notif: n, charge: (n.payload ?? {}) as RetourPayload }))
    .filter((r) => enAttente.some((p) => p.id === r.charge.piece_id));

  const libelleDuMotif = (id: string | undefined) =>
    (motifs.data ?? []).find((m) => m.id === id)?.label ?? t("pme.regler.motifInconnu");

  const emetteur = (pieceId: string | undefined) =>
    // Une pièce en attente de règlement a forcément été lue : le repli
    // « pas encore lue » y serait faux à tous les coups.
    enAttente.find((p) => p.id === pieceId)?.emetteur ?? t("pme.list.sansEmetteur");

  return (
    <div className="rg-rise flex min-h-0 flex-1 flex-col px-1 pt-2">
      <div className="flex-1">
        <Link to="/pme" className="text-[13px] font-medium text-text-2">
          ‹ {t("pme.regler.retour")}
        </Link>

        {notifs.isPending || pieces.isPending ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : retours.length === 0 ? (
          <>
            <p className="mt-3.5 text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
              {t("pme.regler.rien.titre")}
            </p>
            <div className="mt-3 flex gap-3">
              <MalicaAvatar size={32} alt="Malica" rond />
              <p className="text-[14.5px] leading-[1.5] text-text-2">
                {t("pme.regler.rien.sous", { cabinet: nomDuCabinet })}
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-signal-warn">
              {t("pme.regler.titre", { count: retours.length })}
            </p>

            {retours.map(({ notif, charge }) => (
              <div
                key={notif.id}
                className="mt-2.5 border border-border border-s-[3px] border-s-signal-warn bg-card p-4"
              >
                <div className="flex gap-3">
                  <MalicaAvatar size={32} alt="Malica" rond />
                  <p className="min-w-0 flex-1 text-[15px] leading-[1.5]">
                    {t("pme.regler.demande", {
                      cabinet: nomDuCabinet,
                      emetteur: emetteur(charge.piece_id),
                    })}
                  </p>
                </div>

                {/* La note du cabinet, telle qu'il l'a écrite. */}
                {charge.note ? (
                  <p className="mt-3.5 border-t border-border pt-3 text-[14px] leading-[1.5] text-text-2">
                    « {charge.note} »
                  </p>
                ) : null}

                {/*
                 * Le motif est GOUVERNÉ : il vient de `ref.rejet_motifs`, pas
                 * d'un texte libre. Le dirigeant lit donc le même mot que
                 * l'expert a choisi.
                 */}
                <p className="mt-3 border-t border-border pt-3 text-[13px] text-text-2">
                  {t("pme.regler.motif")}{" "}
                  <b className="font-semibold text-foreground">{libelleDuMotif(charge.motif_id)}</b>
                </p>

                <div className="mt-3.5 flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={pme.ouvrirScanner}
                    className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background"
                  >
                    {t("pme.regler.reprendre")}
                  </button>
                  {charge.piece_id ? (
                    <Link
                      to="/pme/piece/$pieceId"
                      params={{ pieceId: charge.piece_id }}
                      className="grid h-[50px] w-full place-items-center text-[16px] font-medium"
                    >
                      {t("pme.regler.voir")}
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}

            {/* Le ton, à la fin : aucune urgence. C'est la moitié de l'écran. */}
            <p className="mt-4 text-[13px] leading-[1.6] text-muted-foreground">
              {t("pme.regler.rassure")}
            </p>
          </>
        )}
      </div>

      <div className="pb-6" />
    </div>
  );
}
