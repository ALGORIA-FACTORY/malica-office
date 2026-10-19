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
import { MalicaNote } from "@/components/malica/office-ui";
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
      <header className="border-b border-foreground pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          ALGORIA Factory
        </p>
        <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
          {t("tour.titre")}
        </h1>
        <p className="mt-3 max-w-[60ch] text-[13px] text-muted-foreground">{t("tour.sous")}</p>
      </header>
      <LaTour />
    </div>
  );
}
