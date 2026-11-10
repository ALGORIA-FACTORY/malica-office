import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CadreConnexion } from "@/components/malica/cadre-connexion";
import { useI18n } from "@/i18n";
import { lireSuite, type SuiteApresConnexion } from "@/lib/suite-apres-connexion";
import { office } from "@/verticals/malica-office/composition";
import { EchecAuth } from "@malica/socle/ports/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Malica Office" },
      {
        name: "description",
        content:
          "Accédez à votre espace Malica Office : capture de pièces, écritures proposées par le Socle, supervision par votre comptabilité.",
      },
      { property: "og:title", content: "Connexion — Malica Office" },
      {
        property: "og:description",
        content: "Espace réservé aux organisations et à leur comptabilité mandatée.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): SuiteApresConnexion => lireSuite(search),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { suite, mode: modeInitial } = Route.useSearch();
  const destination = suite ?? "/office";
  const [mode, setMode] = useState<Mode>(modeInitial ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lienDemande, setLienDemande] = useState(false);
  const [voir, setVoir] = useState(false);
  const [majuscules, setMajuscules] = useState(false);

  useEffect(() => {
    let active = true;
    void office()
      .auth.session()
      .then((compte) => {
        if (active && compte) void navigate({ to: destination, replace: true });
      })
      // L'API peut être injoignable : on laisse alors l'écran de connexion,
      // plutôt que de rejeter une promesse que personne n'attrape.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate, destination]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "forgot") {
        // La réponse est la même que l'adresse existe ou non : on ne navigue
        // nulle part, on dit seulement où regarder.
        await office().auth.motDePasseOublie(email);
        setLienDemande(true);
        return;
      }
      if (mode === "signup") {
        // L'inscription ouvre la session dans le même geste : il n'existe pas
        // de vérification par courriel, et faire attendre une confirmation qui
        // n'arrivera jamais serait mentir à l'utilisateur.
        await office().auth.inscription(email, password, displayName || undefined);
      } else {
        await office().auth.connexion(email, password);
      }
      // La session lue avant l'inscription est en cache, et elle dit
      // « personne » : sans ceci, la page d'invitation où l'on revient
      // redemandait de créer un accès qu'on venait de créer (recette du
      // 8 novembre 2026). On l'oublie, la page suivante la relit.
      queryClient.removeQueries({ queryKey: ["compte"] });
      await navigate({ to: destination, replace: true });
    } catch (err) {
      setError(explain(err, t));
    } finally {
      setPending(false);
    }
  }

  const invalide = error ? true : undefined;
  const titre = mode === "forgot" ? t("auth.forgot.link") : t("auth.title");

  return (
    <CadreConnexion>
      <form onSubmit={onSubmit} className="cx-form">
        <div className="cx-head">
          <h1 className="cx-title">{titre}</h1>
          <p className="cx-sub">{mode === "forgot" ? t("auth.forgot.hint") : t("auth.subtitle")}</p>
        </div>

        {mode !== "forgot" && (
          <div className="cx-seg">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setLienDemande(false);
                }}
                aria-pressed={mode === m}
              >
                {m === "signin" ? t("auth.tab.signin") : t("auth.tab.signup")}
              </button>
            ))}
          </div>
        )}

        {lienDemande && (
          <p role="status" className="cx-msg cx-ok">
            {t("auth.forgot.sent")}
          </p>
        )}

        {mode === "signup" && (
          <div className="cx-field">
            <label className="cx-lbl" htmlFor="cx-nom">
              {t("auth.displayName")}
            </label>
            <input
              id="cx-nom"
              className="cx-input"
              type="text"
              value={displayName}
              autoComplete="name"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        )}
        <div className="cx-field">
          <label className="cx-lbl" htmlFor="cx-email">
            {t("auth.email")}
          </label>
          <input
            id="cx-email"
            className="cx-input"
            type="email"
            value={email}
            required
            autoFocus
            autoComplete="email"
            aria-invalid={invalide}
            aria-describedby={error ? "cx-erreur" : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode !== "forgot" && (
          <div className="cx-field">
            <div className="cx-lbl-row">
              <label className="cx-lbl" htmlFor="cx-mdp">
                {t("auth.password")}
              </label>
              {mode === "signin" && (
                <button
                  type="button"
                  className="cx-link-btn"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setLienDemande(false);
                  }}
                >
                  {t("auth.forgot.link")}
                </button>
              )}
            </div>
            <span className="cx-pwd">
              <input
                id="cx-mdp"
                className="cx-input"
                type={voir ? "text" : "password"}
                value={password}
                required
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                aria-invalid={invalide}
                aria-describedby={error ? "cx-erreur" : undefined}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setMajuscules(e.getModifierState("CapsLock"))}
                onBlur={() => setMajuscules(false)}
              />
              <button
                type="button"
                className="cx-eye"
                aria-pressed={voir}
                aria-label={voir ? t("auth.password.hide") : t("auth.password.show")}
                onClick={() => setVoir((v) => !v)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {voir && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </span>
            {majuscules && (
              <p role="status" className="cx-msg cx-warn">
                {t("auth.caps")}
              </p>
            )}
            {mode === "signup" && <p className="cx-hint">{t("auth.password.hint")}</p>}
          </div>
        )}

        {error && (
          <p id="cx-erreur" role="alert" className="cx-msg cx-err">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} aria-busy={pending} className="cx-submit">
          <span className="cx-fill" aria-hidden="true" />
          <span className="cx-label">
            {pending
              ? t("auth.pending")
              : mode === "signin"
                ? t("auth.submit.signin")
                : mode === "forgot"
                  ? t("auth.forgot.submit")
                  : t("auth.submit.signup")}
            {!pending && (
              <svg
                className="cx-flip"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </span>
        </button>

        {mode === "forgot" && (
          <button
            type="button"
            className="cx-link-btn"
            onClick={() => {
              setMode("signin");
              setError(null);
              setLienDemande(false);
            }}
          >
            {t("auth.reset.back")}
          </button>
        )}
      </form>
    </CadreConnexion>
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
    case "lien_expire":
      return t("auth.reset.expired");
  }
}
