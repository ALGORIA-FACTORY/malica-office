/**
 * Abonnements — la comptabilité revendeur (règles du 20 octobre 2026).
 *
 * L'écran vit dans `components/malica/abonnements-du-cabinet.tsx` depuis le
 * 2 novembre 2026 : la tour montre le même, en lecture. Cette route le pose
 * dans la coquille du cabinet, avec la parole de Malica.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AbonnementsDuCabinet } from "@/components/malica/abonnements-du-cabinet";
import { COMMERCE } from "@/capabilities/coque";
import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { MalicaNote } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/cabinet/abonnements")({
  head: () => ({
    meta: [
      { title: "Abonnements des clients — Malica Office" },
      {
        name: "description",
        content:
          "Les abonnements que le cabinet attribue à ses clients, leur état et ses factures mensuelles.",
      },
      { property: "og:title", content: "Abonnements des clients — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Proposer un abonnement, c'est vendre : pas dans l'application Android
  // (`COMMERCE`). La page n'entre pas dans son paquet, et une adresse tapée
  // ramène au cabinet.
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/cabinet" });
  },
  component: COMMERCE ? CabinetAbonnements : () => null,
});

function CabinetAbonnements() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  useMalicaPanel(<MalicaNote>{t("cab.abo.panel")}</MalicaNote>, [locale]);
  return <AbonnementsDuCabinet cabinet={org} />;
}
