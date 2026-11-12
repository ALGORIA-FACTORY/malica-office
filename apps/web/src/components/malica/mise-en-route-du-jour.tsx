/**
 * La mise en route, sur Aujourd'hui (8 novembre 2026) : trois cases qui ne
 * saisissent rien, chacune ouvre la page où le geste se fait déjà. L'écran
 * « Mise en route » en quatre étapes est retiré : il doublait Réglages et
 * Clients. La carte s'efface d'elle-même quand l'équipe et les clients sont là.
 *
 * Ses trois gestes — inviter l'équipe, ajouter des clients, proposer leurs
 * abonnements — sont ceux de l'expert : la base les refuse aux autres. Un
 * collaborateur ne voit donc pas la carte (recette du 11 novembre 2026, 4.6) :
 * on ne lui montre que ce qu'il peut faire.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { COMMERCE } from "@/capabilities/coque";
import { useCabinet } from "@/components/malica/cabinet-context";
import { useMonAcces } from "@/hooks/use-mon-acces";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

export function MiseEnRouteDuJour() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const acces = useMonAcces(org.id);
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const invitations = useQuery({
    queryKey: ["cab-invitations", org.id],
    queryFn: () => office().collab.invitations(org.id),
  });
  const etats = useQuery({
    queryKey: ["cab-etat-clients", org.id],
    queryFn: () => office().identity.etatDesClients(org.id),
  });
  if (acces.data?.role !== "expert") return null;
  if (membres.isPending || invitations.isPending || etats.isPending) return null;
  if (membres.isError || invitations.isError || etats.isError) return null;

  const enAttente = (invitations.data ?? []).filter(
    (i) => !i.acceptedAt && i.expiresAt > new Date().toISOString(),
  ).length;
  const equipe = (membres.data ?? []).length > 1 || enAttente > 0;
  const clients = etats.data ?? [];
  const rejoints = clients.filter((c) => c.dirigeantPresent).length;
  const abonnements = clients.some((c) => c.accesStatut);
  if (equipe && clients.length > 0) return null;

  const cases = [
    {
      fait: equipe,
      titre: t("cab.mer.equipe"),
      detail: equipe
        ? t("cab.mer.equipe.fait", {
            count: Math.max((membres.data ?? []).length - 1, 0) + enAttente,
          })
        : t("cab.mer.equipe.lede"),
      lien: (
        <Link to="/cabinet/reglages" className="font-semibold hover:text-[#168b50]">
          {t("cab.mer.equipe.lien")} →
        </Link>
      ),
    },
    {
      fait: clients.length > 0,
      titre: t("cab.mer.clients"),
      detail:
        clients.length > 0
          ? // Deux nombres, deux accords : « 1 dossier · 1 dirigeant a rejoint ».
            `${t("cab.mer.clients.fait", { count: clients.length })} · ${t(
              "cab.mer.clients.rejoints",
              { count: rejoints },
            )}`
          : t("cab.mer.clients.lede"),
      lien: (
        <Link to="/cabinet/clients" className="font-semibold hover:text-[#168b50]">
          {t("cab.nav.clients")} →
        </Link>
      ),
    },
    ...(COMMERCE
      ? [
          {
            fait: abonnements,
            titre: t("cab.mer.abo"),
            detail: t("cab.mer.abo.lede"),
            lien: (
              <Link to="/cabinet/clients" className="font-semibold hover:text-[#168b50]">
                {t("cab.nav.clients")} →
              </Link>
            ),
          },
        ]
      : []),
  ];

  return (
    <section
      className="cab-entre rounded-2xl border border-[#c9e2d3] bg-card p-5"
      aria-labelledby="mer-titre"
    >
      <h2 id="mer-titre" className="text-[17px] font-semibold">
        {t("cab.mer.titre")}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{t("cab.mer.lede")}</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {cases.map((c) => (
          <li
            key={c.titre}
            className={cn(
              "flex gap-3 rounded-xl border p-4 text-[13px]",
              c.fait ? "border-[#c9e2d3] bg-[#f4f8f5]" : "border-border",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                c.fait ? "border-[#168b50] bg-[#168b50] text-white" : "border-[#c4c8cf]",
              )}
            >
              {c.fait ? "✓" : ""}
            </span>
            <span className="min-w-0 space-y-1">
              <strong className="block">
                {c.titre}
                <span className="sr-only">
                  {" "}
                  — {c.fait ? t("cab.mer.fait") : t("cab.mer.a_faire")}
                </span>
              </strong>
              <span className="block text-muted-foreground">{c.detail}</span>
              <span className="block">{c.lien}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
