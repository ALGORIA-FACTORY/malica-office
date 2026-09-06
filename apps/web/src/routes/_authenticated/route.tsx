import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";

import { useI18n } from "@/i18n";
import { EchecAuth } from "@regalica/socle/ports/auth";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // `session()` ne touche pas la base : elle ne fait que lire le jeton. Cette
    // garde s'exécute à chaque navigation, elle doit rester gratuite.
    const compte = await office().auth.session();
    if (!compte) throw redirect({ to: "/auth" });
    return { user: compte };
  },
  // La garde attend le réseau : sur un téléphone, ce peut être dix secondes
  // avant que l'hôte soit déclaré injoignable. Une page vide pendant ce temps
  // ressemble à une panne ; une ligne dit ce qui se passe.
  pendingMs: 300,
  pendingComponent: Ouverture,
  errorComponent: Refus,
  component: () => <Outlet />,
});

function Ouverture() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    </div>
  );
}

/**
 * Un réseau absent n'est pas une panne de l'application : on le dit, et on
 * propose de réessayer. Tout autre échec remonte à la frontière de la racine.
 */
function Refus({ error }: { error: Error }) {
  const { t } = useI18n();
  const router = useRouter();
  if (!(error instanceof EchecAuth) || error.motif !== "reseau") throw error;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="max-w-md text-center">
        <p className="text-sm text-muted-foreground">{t("common.horsLigne")}</p>
        <button
          type="button"
          onClick={() => void router.invalidate()}
          className="mt-6 inline-flex min-h-[44px] items-center justify-center bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t("common.reessayer")}
        </button>
      </div>
    </div>
  );
}
