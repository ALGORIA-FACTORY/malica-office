/**
 * La création d'une organisation — nature, comptabilité, juridiction, établissement.
 *
 * Écran du premier pas : la personne dit si elle ouvre une PME ou un cabinet, donne le nom
 * et l'identifiant légal, donne s'il le veut l'e-mail de sa comptabilité, et l'adresse du siège.
 *
 * Les juridictions proposées viennent du référentiel (R5, R8) : une option s'affiche parce
 * qu'un pack est en vigueur, jamais parce qu'un code l'a écrite. La devise n'est pas
 * demandée : elle appartient au pack de la juridiction, pour ne pas tenir une comptabilité
 * dans une monnaie qui n'est pas la sienne. À la création, on retourne au choix d'espace.
 *
 * Une PME peut inviter sa comptabilité dès cet écran (décision du 22 novembre 2026) : l'e-mail
 * est facultatif, et l'invitation part par le même envoi que Réglages › Sociétés, une fois la
 * société créée. Si l'invitation échoue, la société reste créée : renvoyer le formulaire ne
 * retente que l'invitation, jamais une seconde société.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { AdresseAConfirmer } from "@/components/malica/AdresseAConfirmer";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import type { OrgKind } from "@malica/socle/ports/repositories";
import { texteDeLErreur } from "@/lib/erreur-lisible";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Créer une organisation — Malica Office" },
      {
        name: "description",
        content:
          "Créez votre organisation Malica Office : nature PME ou comptabilité, e-mail de votre comptabilité, établissement principal.",
      },
      { property: "og:title", content: "Créer une organisation — Malica Office" },
      {
        property: "og:description",
        content: "Nature, comptabilité et établissement principal de votre organisation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Depuis une invitation à tenir la comptabilité d'une société, l'écran s'ouvre
  // déjà sur « comptabilité » : la personne revient ensuite à l'invitation.
  validateSearch: (search: Record<string, unknown>): { nature?: "cabinet" } =>
    search["nature"] === "cabinet" ? { nature: "cabinet" } : {},
  component: Onboarding,
});

function Onboarding() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { nature } = Route.useSearch();
  const [kind, setKind] = useState<OrgKind>(nature ?? "pme");
  const [name, setName] = useState("");
  const [legalId, setLegalId] = useState("");
  const [adresse, setAdresse] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [emailComptabilite, setEmailComptabilite] = useState("");
  /** La société déjà créée par un envoi précédent dont seule l'invitation a échoué. */
  const [creee, setCreee] = useState<string | null>(null);

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
      const tenantId =
        creee ??
        (await office().identity.createOrganization({
          kind,
          name: name.trim(),
          legalId: legalId.trim() || null,
          jurisdiction: choisie,
          // La devise n'est pas demandée : elle appartient au pack de la
          // juridiction. Laisser l'utilisateur en choisir une autre reviendrait à
          // tenir une comptabilité tunisienne en euros.
          currency: devise,
          // Une seule question sur la comptabilité : son e-mail (le dirigeant, 23 novembre
          // 2026 — « Mode de validation » la reposait). Le mode reste « mandate », le défaut
          // de la base : sans comptabilité engagée la société tient seule ses livres
          // (`app.livres_tenus_par_le_cabinet`), et la comptabilité invitée plus tard,
          // dans Réglages › Sociétés, les tient dès que le mandat est actif.
          validationMode: "mandate",
          // L'établissement principal porte la raison sociale ; ce qu'on tape ici
          // est l'adresse du siège, et elle va sur la société (4.2).
          adresse: adresse.trim() || null,
        }));
      setCreee(tenantId);
      const invitee = kind === "pme" ? emailComptabilite.trim() : "";
      if (invitee) await office().identity.inviterMaComptabilite(tenantId, invitee);
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
        <div className="flex w-full items-center justify-between px-4 py-4 sm:px-6 lg:px-9">
          <Link to="/office" className="text-sm font-semibold uppercase tracking-[0.18em]">
            {t("brand.name")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="w-full px-4 py-8 sm:px-6 lg:px-9 lg:py-12">
        <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
        {/* Invité par un cabinet ou une société ? L'invitation attend l'adresse confirmée. */}
        <AdresseAConfirmer />

        <form onSubmit={onSubmit} className="mt-8 grid items-start gap-6 lg:grid-cols-2">
          <fieldset className="lg:col-span-2">
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("onboarding.kind")}
            </legend>
            <div className="mt-2 grid gap-px border border-border bg-border sm:grid-cols-2">
              {(["pme", "cabinet"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  disabled={creee !== null}
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

          {kind === "pme" ? (
            <label className="block lg:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("onboarding.comptabilite")}
              </span>
              <input
                type="email"
                value={emailComptabilite}
                onChange={(e) => setEmailComptabilite(e.target.value)}
                autoComplete="email"
                inputMode="email"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("onboarding.comptabilite.help")}
              </span>
            </label>
          ) : null}

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
                  {/* Le pays et la monnaie en mots, dans la langue de la
                      personne (Intl) : « TN — TND » était du jargon (4.1). */}
                  {t("onboarding.jurisdiction.option", {
                    pays: nomDuPays(j.jurisdiction, locale),
                    devise: nomDeLaDevise(j.currency, locale),
                  })}
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
              {t("onboarding.adresse")}
            </span>
            <input
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              autoComplete="street-address"
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </label>

          {error && (
            <p className="border border-signal-stop px-3 py-2 text-xs text-signal-stop lg:col-span-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full border border-foreground bg-foreground px-4 py-3 text-sm font-medium text-background transition-colors hover:bg-background hover:text-foreground disabled:opacity-50 lg:col-span-2 lg:justify-self-start lg:px-10"
          >
            {pending
              ? t("auth.pending")
              : creee
                ? t("onboarding.comptabilite.reessayer")
                : t("onboarding.submit")}
          </button>
        </form>
      </main>
    </div>
  );
}

/** Le nom du pays d'un code de juridiction, ou le code s'il n'en a pas. */
function nomDuPays(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Le nom de la monnaie d'un code ISO, ou le code s'il n'en a pas. */
function nomDeLaDevise(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
