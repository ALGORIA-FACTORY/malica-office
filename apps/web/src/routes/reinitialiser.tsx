import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import { EchecAuth } from "@malica/socle/ports/auth";

/**
 * Le nouveau mot de passe, depuis le lien reçu par courriel.
 *
 * Le secret voyage dans le FRAGMENT de l'adresse : il n'atteint jamais un
 * serveur par la barre d'adresse. On le lit, puis on l'efface de l'historique
 * — un lien recopié depuis l'onglet ne doit pas le porter.
 */
export const Route = createFileRoute("/reinitialiser")({
  head: () => ({ meta: [{ title: "Nouveau mot de passe — Malica Office" }] }),
  component: Reinitialiser,
});

function Reinitialiser() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [secret, setSecret] = useState<string | null>(null);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lu = window.location.hash.replace(/^#/, "");
    setSecret(lu.length >= 16 ? lu : "");
    if (lu) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!secret) return;
    if (motDePasse !== confirmation) {
      setError(t("auth.reset.mismatch"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await office().auth.reinitialiser(secret, motDePasse);
      await navigate({ to: "/office", replace: true });
    } catch (err) {
      if (err instanceof EchecAuth && err.motif === "lien_expire")
        setError(t("auth.reset.expired"));
      else if (err instanceof EchecAuth && err.motif === "saisie")
        setError(t("auth.error.weakPassword"));
      else if (err instanceof EchecAuth && err.motif === "reseau")
        setError(t("auth.error.unreachable"));
      else setError(t("auth.error.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pt-safe min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-sm font-semibold uppercase tracking-[0.18em]">
            {t("brand.name")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.reset.title")}</h1>

        {secret === "" ? (
          <p className="mt-6 border border-signal-stop px-3 py-2 text-xs text-signal-stop">
            {t("auth.reset.expired")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <ChampMotDePasse
              label={t("auth.reset.new")}
              value={motDePasse}
              onChange={setMotDePasse}
            />
            <ChampMotDePasse
              label={t("auth.reset.confirm")}
              value={confirmation}
              onChange={setConfirmation}
            />
            <p className="text-xs text-muted-foreground">{t("auth.password.hint")}</p>

            {error && (
              <p className="border border-signal-stop px-3 py-2 text-xs text-signal-stop">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending || !secret}
              className="w-full border border-foreground bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
            >
              {pending ? t("auth.pending") : t("auth.reset.submit")}
            </button>
          </form>
        )}

        <Link to="/auth" className="mt-8 inline-block text-xs text-muted-foreground underline">
          {t("auth.reset.back")}
        </Link>
      </main>
    </div>
  );
}

function ChampMotDePasse({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="password"
        value={value}
        required
        minLength={12}
        autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
      />
    </label>
  );
}
