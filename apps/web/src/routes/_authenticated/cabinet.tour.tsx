/**
 * La tour — le poste de travail d'ALGORIA, dans le SaaS.
 *
 * Décidé le 19 octobre 2026 : la tour vit ICI, pas dans l'application du
 * client. Le rail ne la montre qu'aux opérateurs de la plateforme, et la base
 * refuse chacun de ses gestes à tout autre compte — l'écran le dit au lieu
 * de montrer des blocs vides.
 */
import { createFileRoute } from "@tanstack/react-router";

import { useMalicaPanel } from "@/components/malica/cabinet-context";
import { LaTour } from "@/components/malica/la-tour";
import { MalicaNote, EnTeteCabinet } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/cabinet/tour")({
  head: () => ({
    meta: [
      { title: "La tour — Malica Office" },
      {
        name: "description",
        content:
          "Grille, paiement en ligne, émetteur des factures et licences : réglés par ALGORIA.",
      },
    ],
  }),
  component: CabinetTour,
});

function CabinetTour() {
  const { t, locale } = useI18n();
  useMalicaPanel(<MalicaNote>{t("tour.sous")}</MalicaNote>, [locale]);

  return (
    <div className="space-y-8">
      <EnTeteCabinet
        surtitre={<>ALGORIA Factory</>}
        titre={<>{t("tour.titre")}</>}
        chapeau={<>{t("tour.sous")}</>}
      />
      <LaTour />
    </div>
  );
}
