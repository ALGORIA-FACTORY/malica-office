import { createFileRoute, Link } from "@tanstack/react-router";

import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { MonEspaceParti } from "@/components/malica/mon-espace-parti";
import { useI18n } from "@/i18n";

/**
 * Son Mon espace, hors des sociétés qu'il a quittées (lot 4) — atteint depuis
 * le compte (portail, réglages, écran sans société), indépendant de toute
 * société : il part avec le compte.
 */
export const Route = createFileRoute("/_authenticated/mon-espace")({
  head: () => ({ meta: [{ title: "Mon espace — Malica Office" }] }),
  component: EcranMonEspace,
});

function EcranMonEspace() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-4">
          <Link to="/office" className="text-sm font-semibold uppercase tracking-[0.18em]">
            {t("brand.name")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-6">
        <MonEspaceParti />
      </main>
    </div>
  );
}
