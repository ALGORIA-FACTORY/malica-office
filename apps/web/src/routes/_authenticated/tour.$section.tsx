/**
 * Une section de réglage de la tour : la grille, le paiement, l'émetteur, les
 * relances, le calendrier, les licences, la relecture de nuit, le plafond des
 * modèles, le compte de service. Chaque carte est celle de l'ancienne page
 * unique, déplacée telle quelle (`components/malica/tour/`). Une adresse qui
 * ne nomme aucune section ramène aux cabinets : jamais une page vide.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

import { estUneSection } from "@/components/malica/tour/cles-des-sections";
import { SECTIONS } from "@/components/malica/tour/sections";
import { EnTeteDeLaTour } from "@/components/malica/tour/ui";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/tour/$section")({
  beforeLoad: ({ params }) => {
    if (!estUneSection(params.section)) throw redirect({ to: "/tour/cabinets", replace: true });
  },
  component: SectionDeLaTour,
});

function SectionDeLaTour() {
  const { t } = useI18n();
  const { section } = Route.useParams();
  if (!estUneSection(section)) return null;
  const s = SECTIONS[section];
  return (
    <div data-tour-section={section} className="space-y-6">
      <EnTeteDeLaTour surtitre={t("tour.sous")} titre={t(s.libelle)} />
      <div className="grid gap-6">
        {s.cartes.map((Carte, i) => (
          <Carte key={i} />
        ))}
      </div>
    </div>
  );
}
