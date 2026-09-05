import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/regalica/LanguageSwitcher";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import type { OrgKind, ValidationMode } from "@regalica/socle/ports/repositories";
import { texteDeLErreur } from "@/lib/erreur-lisible";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Créer une organisation — Regalica Office" },
      {
        name: "description",
        content:
          "Créez votre organisation Regalica Office : nature PME ou cabinet, mode de validation, établissement principal.",
      },
      { property: "og:title", content: "Créer une organisation — Regalica Office" },
      {
        property: "og:description",
        content: "Nature, mode de validation et établissement principal de votre organisation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Onboarding,
});

function Onboarding() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<OrgKind>("pme");
  const [name, setName] = useState("");
  const [legalId, setLegalId] = useState("");
  const [mode, setMode] = useState<ValidationMode>("mandate");
  const [entityName, setEntityName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");

  // Les juridictions viennent du référentiel : une option s'affiche parce qu'un
  // pack est en vigueur, jamais parce qu'un code l'a écrite. Le jour où un pack
  // français est semé, la France apparaît ici sans qu'on touche à cet écran.
  const juridictions = useQuery({
    queryKey: ["juridictions"],
    queryFn: () => office().referential.juridictions(),
  });

  // Une seule juridiction disponible : elle est choisie d'office. Ce n'est pas
  // un défaut en dur — c'est le référentiel qui n'en propose qu'une.
  const choisie =
    jurisdiction || (juridictions.data?.length === 1 ? juridictions.data[0]!.jurisdiction : "");
  const devise = juridictions.data?.find((j) => j.jurisdiction === choisie)?.currency ?? "";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (!choisie || !devise) throw new Error(t("onboarding.jurisdiction.required"));
      await office().identity.createOrganization({
        kind,
        name: name.trim(),
        legalId: legalId.trim() || null,
        jurisdiction: choisie,
        // La devise n'est pas demandée : elle appartient au pack de la
        // juridiction. Laisser l'utilisateur en choisir une autre reviendrait à
        // tenir une comptabilité tunisienne en euros.
        currency: devise,
        validationMode: mode,
        defaultEntityName: entityName,
      });
      await queryClient.invalidateQueries();
      await navigate({ to: "/office" });
    } catch (err) {
      setError(texteDeLErreur(err, "routes/_authenticated/onboarding", t("onboarding.error")));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/office" className="text-sm font-semibold uppercase tracking-[0.18em]">
            {t("brand.name")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.kind")}
            </legend>
            <div className="mt-2 grid gap-px border border-border bg-border sm:grid-cols-2">
              {(["pme", "cabinet"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`bg-card p-4 text-start text-sm transition-colors ${
                    kind === k ? "bg-foreground text-background" : "hover:bg-accent"
                  }`}
                >
                  {k === "pme" ? t("onboarding.kind.pme") : t("onboarding.kind.cabinet")}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.jurisdiction")}
            </span>
            <select
              value={choisie}
              onChange={(e) => setJurisdiction(e.target.value)}
              required
              disabled={juridictions.isPending}
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
            >
              <option value="" disabled>
                {t("onboarding.jurisdiction.choose")}
              </option>
              {(juridictions.data ?? []).map((j) => (
                <option key={j.jurisdiction} value={j.jurisdiction}>
                  {j.jurisdiction} — {j.currency}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("onboarding.jurisdiction.help")}
            </span>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.name")}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.legalId")}
            </span>
            <input
              value={legalId}
              onChange={(e) => setLegalId(e.target.value)}
              className="num mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.entity")}
            </span>
            <input
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              placeholder={name}
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </label>

          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.mode")}
            </legend>
            <div className="mt-2 grid gap-px border border-border bg-border">
              {(["mandate", "autonome"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`bg-card p-4 text-start text-sm transition-colors ${
                    mode === m ? "bg-foreground text-background" : "hover:bg-accent"
                  }`}
                >
                  {m === "mandate" ? t("onboarding.mode.mandate") : t("onboarding.mode.autonome")}
                </button>
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="border border-signal-stop px-3 py-2 text-xs text-signal-stop">{error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full border border-foreground bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {pending ? t("auth.pending") : t("onboarding.submit")}
          </button>
        </form>
      </main>
    </div>
  );
}
