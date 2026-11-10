import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CadreConnexion } from "@/components/malica/cadre-connexion";
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
    <CadreConnexion>
      <div className="cx-form">
        <div className="cx-head">
          <h1 className="cx-title">{t("auth.reset.title")}</h1>
        </div>

        {secret === "" ? (
          <p role="alert" className="cx-msg cx-err">
            {t("auth.reset.expired")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="cx-form">
            <ChampMotDePasse
              id="cx-nouveau"
              label={t("auth.reset.new")}
              value={motDePasse}
              onChange={setMotDePasse}
              erreur={Boolean(error)}
            />
            <ChampMotDePasse
              id="cx-confirmation"
              label={t("auth.reset.confirm")}
              value={confirmation}
              onChange={setConfirmation}
              erreur={Boolean(error)}
            />
            <p className="cx-hint">{t("auth.password.hint")}</p>

            {error && (
              <p id="cx-erreur" role="alert" className="cx-msg cx-err">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending || !secret}
              aria-busy={pending}
              className="cx-submit"
            >
              <span className="cx-fill" aria-hidden="true" />
              <span className="cx-label">{pending ? t("auth.pending") : t("auth.reset.submit")}</span>
            </button>
          </form>
        )}

        <Link to="/auth" className="cx-link-btn">
          {t("auth.reset.back")}
        </Link>
      </div>
    </CadreConnexion>
  );
}

function ChampMotDePasse({
  id,
  label,
  value,
  onChange,
  erreur,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  erreur: boolean;
}) {
  return (
    <div className="cx-field">
      <label className="cx-lbl" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="cx-input"
        type="password"
        value={value}
        required
        minLength={12}
        autoComplete="new-password"
        aria-invalid={erreur || undefined}
        aria-describedby={erreur ? "cx-erreur" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
