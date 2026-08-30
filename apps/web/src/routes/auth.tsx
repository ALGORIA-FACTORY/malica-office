import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/regalica/LanguageSwitcher";
import { useI18n } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { isRegalicaDevAccessEnabled } from "@/lib/dev-access";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Regalica Office" },
      {
        name: "description",
        content:
          "Accédez à votre espace Regalica Office : capture de pièces, écritures proposées par le Socle, supervision par votre cabinet.",
      },
      { property: "og:title", content: "Connexion — Regalica Office" },
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isRegalicaDevAccessEnabled()) {
      void navigate({ to: "/office" });
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) void navigate({ to: "/office" });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { display_name: displayName },
          },
        });
        if (err) throw err;
        if (data.session) {
          await navigate({ to: "/office" });
          return;
        }
        setMessage(t("auth.signup.check"));
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        await navigate({ to: "/office" });
      }
    } catch (err) {
      setError(explain(err, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
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
                setMessage(null);
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
          {message && (
            <p className="border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {message}
            </p>
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

/** Traduit les codes d'erreur d'authentification en langage clair. */
function explain(err: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  const raw = err instanceof Error ? err.message.toLowerCase() : "";
  if (raw.includes("weak") || raw.includes("pwned") || raw.includes("password should be"))
    return t("auth.error.weakPassword");
  if (raw.includes("invalid login")) return t("auth.error.invalidCredentials");
  if (raw.includes("already registered") || raw.includes("user already"))
    return t("auth.error.userExists");
  if (raw.includes("not confirmed")) return t("auth.error.notConfirmed");
  return t("auth.error.generic");
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
