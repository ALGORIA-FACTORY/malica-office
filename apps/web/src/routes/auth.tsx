import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import { EchecAuth } from "@malica/socle/ports/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Malica Office" },
      {
        name: "description",
        content:
          "Accédez à votre espace Malica Office : capture de pièces, écritures proposées par le Socle, supervision par votre cabinet.",
      },
      { property: "og:title", content: "Connexion — Malica Office" },
      {
        property: "og:description",
        content: "Espace réservé aux organisations et à leurs cabinets mandatés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void office()
      .auth.session()
      .then((compte) => {
        if (active && compte) void navigate({ to: "/office", replace: true });
      })
      // L'API peut être injoignable : on laisse alors l'écran de connexion,
      // plutôt que de rejeter une promesse que personne n'attrape.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "signup") {
        // L'inscription ouvre la session dans le même geste : il n'existe pas
        // de vérification par courriel, et faire attendre une confirmation qui
        // n'arrivera jamais serait mentir à l'utilisateur.
        await office().auth.inscription(email, password, displayName || undefined);
      } else {
        await office().auth.connexion(email, password);
      }
      await navigate({ to: "/office", replace: true });
    } catch (err) {
      setError(explain(err, t));
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
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.subtitle")}</p>

        <div className="mt-8 flex border border-border">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              aria-pressed={mode === m}
              className={`flex-1 px-4 py-2 text-xs font-medium uppercase tracking-wide transition-colors ${
                mode === m ? "bg-foreground text-background" : "hover:bg-accent"
              }`}
            >
              {m === "signin" ? t("auth.tab.signin") : t("auth.tab.signup")}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <Field
              label={t("auth.displayName")}
              value={displayName}
              onChange={setDisplayName}
              type="text"
              autoComplete="name"
            />
          )}
          <Field
            label={t("auth.email")}
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="email"
            required
          />
          <Field
            label={t("auth.password")}
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
          />
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground">{t("auth.password.hint")}</p>
          )}

          {error && (
            <p className="border border-signal-stop px-3 py-2 text-xs text-signal-stop">{error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full border border-foreground bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {pending
              ? t("auth.pending")
              : mode === "signin"
                ? t("auth.submit.signin")
                : t("auth.submit.signup")}
          </button>
        </form>

        <Link to="/" className="mt-8 inline-block text-xs text-muted-foreground underline">
          {t("auth.back")}
        </Link>
      </main>
    </div>
  );
}

/**
 * Traduit un échec d'authentification en langage clair.
 *
 * Elle lisait auparavant des messages en anglais du fournisseur — « invalid
 * login », « already registered » — c'est-à-dire qu'elle dépendait de la
 * formulation d'un tiers. Le port expose désormais un motif typé : le jour où
 * un motif s'ajoute, le compilateur le signale.
 *
 * ============================================ NE PAS ACCUSER L'INNOCENT
 *
 * Le motif « reseau » rendait le même message que « identifiants » :
 * « Connexion impossible. Vérifiez vos identifiants. » Quand le service
 * d'authentification est arrêté, on disait donc à la personne de vérifier son
 * mot de passe — un mot de passe juste, qu'elle a alors retapé trois fois.
 *
 * Le port distinguait pourtant les deux cas depuis toujours. C'est l'écran qui
 * les confondait, et cette confusion a coûté du temps réel à des gens qui
 * cherchaient une faute chez eux.
 */
function explain(err: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  if (!(err instanceof EchecAuth)) return t("auth.error.generic");
  switch (err.motif) {
    case "identifiants":
      return t("auth.error.invalidCredentials");
    case "adresse_prise":
      return t("auth.error.userExists");
    case "saisie":
      return t("auth.error.weakPassword");
    case "reseau":
      return t("auth.error.unreachable");
  }
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
      />
    </label>
  );
}
