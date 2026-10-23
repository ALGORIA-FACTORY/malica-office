/**
 * La mise en route du cabinet — quatre étapes, rejouables.
 *
 * ============================================================== POURQUOI
 *
 * Un cabinet qui vient de s'inscrire doit pouvoir travailler le jour même
 * (R10). Le parcours le prend par la main : qui il est, qui travaille avec
 * lui, quels dossiers il suit, ce qu'il délègue à Malica. Rien ici n'est
 * propre à cet écran : chaque étape lit et écrit ce que les réglages, les
 * membres et les mandats portent déjà. On peut le rejouer sans rien casser.
 *
 * Aucune valeur par défaut n'est écrite ici : le seuil vient de la base, et
 * l'écran dit quand c'est encore le défaut de Malica, pas celui du cabinet.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { EmptyState, MalicaNote, EnTeteCabinet } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/mise-en-route")({
  head: () => ({
    meta: [
      { title: "Mise en route — Malica Office" },
      {
        name: "description",
        content:
          "Les quatre étapes de mise en route d'un cabinet : le cabinet, l'équipe, les premiers mandats, le seuil de délégation.",
      },
      { property: "og:title", content: "Mise en route — Malica Office" },
      {
        property: "og:description",
        content: "Le cabinet, l'équipe, les premiers mandats, le seuil de délégation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { etape?: 2 } =>
    search["etape"] === 2 || search["etape"] === "2" ? { etape: 2 } : {},
  component: MiseEnRoute,
});

type Etape = 1 | 2 | 3 | 4;
const ETAPES: Etape[] = [1, 2, 3, 4];
const ROLES_INVITABLES = ["collaborateur", "expert", "assistant"];
const ROLES: Record<string, MessageKey> = {
  expert: "cab.onb.role.expert",
  collaborateur: "cab.onb.role.collaborateur",
  assistant: "cab.onb.role.assistant",
  dirigeant: "cab.onb.role.dirigeant",
};
const MANDATS: Record<string, MessageKey> = {
  propose: "cab.onb.mandat.propose",
  actif: "cab.onb.mandat.actif",
  suspendu: "cab.onb.mandat.suspendu",
  termine: "cab.onb.mandat.termine",
};

const BOUTON_ENCRE =
  "border border-foreground bg-foreground px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:text-foreground disabled:opacity-40";
const BOUTON_PIERRE =
  "border border-border bg-card px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-40";
const CHAMP =
  "mt-1.5 w-full border border-border bg-background px-3 py-2.5 text-[13.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const ETIQUETTE =
  "block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const INDICE = "mt-1.5 block text-[11px] leading-[1.5] text-muted-foreground";

function MiseEnRoute() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const recherche = Route.useSearch();
  const [etape, setEtape] = useState<Etape>(recherche.etape ?? 1);

  const avancement = useQuery({
    queryKey: ["cab-mise-en-route", org.id],
    queryFn: () => office().parametrage.miseEnRoute(org.id),
  });
  const termineeLe = avancement.data?.termineeLe ?? null;

  useMalicaPanel(<MalicaNote>{t("cab.onb.panel")}</MalicaNote>, [locale]);

  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));

  const titre: Record<Etape, MessageKey> = {
    1: "cab.onb.1.titre",
    2: "cab.onb.2.titre",
    3: "cab.onb.3.titre",
    4: "cab.onb.4.titre",
  };
  const suivante = () => setEtape((e) => (e < 4 ? ((e + 1) as Etape) : e));
  const precedente = () => setEtape((e) => (e > 1 ? ((e - 1) as Etape) : e));

  return (
    <div className="cab-library cab-onboarding grid gap-6 xl:grid-cols-[1fr_260px]">
      <section className="min-w-0 space-y-5">
        <EnTeteCabinet
          surtitre={<>{t("cab.onb.kicker", { n: etape })}</>}
          titre={<>{t(titre[etape])}</>}
        >
          {termineeLe ? (
            <p className="mt-3 border border-s-2 border-border border-s-signal-ok bg-card px-3 py-2 text-[12px]">
              {t("cab.onb.terminee", { date: dateLongue(termineeLe) })}
            </p>
          ) : null}
          <Panne erreur={avancement.error} />
        </EnTeteCabinet>

        <div className="flex gap-0.5" aria-hidden>
          {ETAPES.map((e) => (
            <span
              key={e}
              className={cn("h-[3px] flex-1", e <= etape ? "bg-foreground" : "bg-border")}
            />
          ))}
        </div>

        <div className="cab-surface">
          {etape === 1 ? <LeCabinet /> : null}
          {etape === 2 ? <LEquipe /> : null}
          {etape === 3 ? <LesMandats /> : null}
          {etape === 4 ? <LeSeuil /> : null}

          <div className="mt-5 flex flex-wrap gap-2.5 border-t border-border pt-4">
            {etape < 4 ? (
              <button type="button" className={BOUTON_ENCRE} onClick={suivante}>
                {t("cab.onb.suivant")}
              </button>
            ) : (
              <Terminer />
            )}
            <button
              type="button"
              className={BOUTON_PIERRE}
              disabled={etape === 1}
              onClick={precedente}
            >
              {t("cab.onb.precedent")}
            </button>
          </div>
        </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-3.5">
        <div className="cab-surface">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.onb.etapes")}
          </p>
          <ol className="relative mt-3.5">
            <span
              aria-hidden
              className="absolute bottom-2 top-2 w-px bg-border"
              style={{ insetInlineStart: "5px" }}
            />
            {ETAPES.map((e) => {
              const etat = e < etape || termineeLe ? "fait" : e === etape ? "encours" : "avenir";
              return (
                <li key={e} className="relative py-1.5" style={{ paddingInlineStart: "24px" }}>
                  <button
                    type="button"
                    onClick={() => setEtape(e)}
                    className="block w-full text-start"
                    aria-current={e === etape ? "step" : undefined}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-[11px] h-[11px] w-[11px] border",
                        etat === "fait"
                          ? "border-foreground bg-foreground"
                          : etat === "encours"
                            ? "border-foreground bg-background"
                            : "border-border bg-background",
                      )}
                      style={{ insetInlineStart: 0 }}
                    />
                    <span
                      className={cn(
                        "block text-[12.5px]",
                        e === etape ? "font-semibold" : "",
                        etat === "avenir" ? "text-muted-foreground" : "",
                      )}
                    >
                      {t(titre[e])}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}

/* ============================================================ 1. le cabinet */

function LeCabinet() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [nom, setNom] = useState(org.name);
  const [identifiant, setIdentifiant] = useState(org.legalId ?? "");
  const [juridiction, setJuridiction] = useState(org.jurisdiction);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const juridictions = useQuery({
    queryKey: ["juridictions"],
    queryFn: () => office().referential.juridictions(),
  });

  const enregistrer = useMutation({
    mutationFn: () =>
      office().identity.definirOrganisation({
        tenantId: org.id,
        name: nom.trim(),
        legalId: identifiant.trim() || null,
        jurisdiction: juridiction,
      }),
    onSuccess: async () => {
      setErreur(null);
      setMessage(t("cab.onb.enregistre"));
      // Le nom du cabinet vit dans la coquille : tout ce qui le lit se relit.
      await qc.invalidateQueries();
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(
        texteDeLErreur(e, "routes/_authenticated/cabinet.mise-en-route", t("common.error")),
      );
    },
  });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={ETIQUETTE}>{t("cab.onb.1.nom")}</span>
        <input value={nom} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        <span className={INDICE}>{t("cab.onb.1.nom.hint")}</span>
      </label>
      <label className="block">
        <span className={ETIQUETTE}>{t("cab.onb.1.identifiant")}</span>
        <input
          value={identifiant}
          onChange={(e) => setIdentifiant(e.target.value)}
          className={cn(CHAMP, "num")}
        />
        <span className={INDICE}>{t("cab.onb.1.identifiant.hint")}</span>
      </label>
      <label className="block">
        <span className={ETIQUETTE}>{t("cab.onb.1.juridiction")}</span>
        <select
          value={juridiction}
          onChange={(e) => setJuridiction(e.target.value)}
          disabled={juridictions.isPending}
          className={CHAMP}
        >
          {(juridictions.data ?? []).map((j) => (
            <option key={j.jurisdiction} value={j.jurisdiction}>
              {j.jurisdiction} — {j.currency}
            </option>
          ))}
        </select>
        <span className={INDICE}>{t("cab.onb.1.juridiction.hint")}</span>
      </label>
      <Panne erreur={juridictions.error} />
      <Retour message={message} erreur={erreur}>
        <button
          type="button"
          className={BOUTON_PIERRE}
          disabled={enregistrer.isPending || !nom.trim() || !juridiction}
          onClick={() => enregistrer.mutate()}
        >
          {t("cab.onb.1.enregistrer")}
        </button>
      </Retour>
    </div>
  );
}

/* ============================================================== 2. l'équipe */

function LEquipe() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLES_INVITABLES[0]!);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const invitations = useQuery({
    queryKey: ["cab-invitations", org.id],
    queryFn: () => office().collab.invitations(org.id),
  });

  const inviter = useMutation({
    mutationFn: () => office().collab.inviter({ tenantId: org.id, email: email.trim(), role }),
    onSuccess: async (r) => {
      setErreur(null);
      setMessage(t(r.deja ? "cab.onb.2.deja" : "cab.onb.2.invitee", { email: r.email }));
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["cab-invitations", org.id] });
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(
        texteDeLErreur(e, "routes/_authenticated/cabinet.mise-en-route", t("common.error")),
      );
    },
  });

  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(iso),
    );
  const roleDe = (r: string) => (ROLES[r] ? t(ROLES[r]!) : r);
  const enAttente = (invitations.data ?? []).filter(
    (i) => !i.acceptedAt && i.expiresAt > new Date().toISOString(),
  );

  return (
    <div className="cab-team space-y-5">
      <Panne erreur={membres.error ?? invitations.error} />
      <div>
        <p className={ETIQUETTE}>{t("cab.onb.2.membres")}</p>
        <ul className="cab-team-list mt-2">
          {(membres.data ?? []).map((m) => (
            <li key={m.userId} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="cab-team-person">
                <span className="cab-team-avatar" aria-hidden>
                  {m.email.slice(0, 2).toLocaleUpperCase(locale)}
                </span>
                <span className="min-w-0 truncate text-[13px]">{m.email}</span>
              </span>
              <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {roleDe(m.role)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <form
        id="cab-inviter-equipe"
        onSubmit={(e) => {
          e.preventDefault();
          if (!inviter.isPending) inviter.mutate();
        }}
        className="grid gap-4 sm:grid-cols-[1.6fr_1fr]"
      >
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.onb.2.email")}</span>
          <input
            type="email"
            required
            autoComplete="email"
            disabled={inviter.isPending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={CHAMP}
          />
          <span className={INDICE}>{t("cab.onb.2.email.hint")}</span>
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.onb.2.role")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={CHAMP}>
            {ROLES_INVITABLES.map((r) => (
              <option key={r} value={r}>
                {roleDe(r)}
              </option>
            ))}
          </select>
        </label>
      </form>
      <Retour message={message} erreur={erreur}>
        <button
          type="submit"
          form="cab-inviter-equipe"
          className="cab-button cab-button-primary"
          disabled={inviter.isPending || !email.trim()}
        >
          {t("cab.onb.2.inviter")}
        </button>
      </Retour>

      <div>
        <p className={ETIQUETTE}>{t("cab.onb.2.invitations")}</p>
        {invitations.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : enAttente.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted-foreground">{t("cab.onb.2.aucune")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border border border-border">
            {enAttente.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-[13px]">
                  {i.email}
                  <span className="ms-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {roleDe(i.role)}
                  </span>
                </span>
                <span className="num shrink-0 text-[10.5px] text-muted-foreground">
                  {t("cab.onb.2.expire", { date: dateCourte(i.expiresAt) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ============================================================ 3. les mandats */

function LesMandats() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [identifiant, setIdentifiant] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const statutDe = (s: string) => (MANDATS[s] ? t(MANDATS[s]!) : s);

  const proposer = useMutation({
    mutationFn: () => office().identity.proposerMandat(org.id, identifiant.trim()),
    onSuccess: async (r) => {
      setErreur(null);
      setMessage(
        r.deja
          ? t("cab.onb.3.deja", { pme: r.pmeName, status: statutDe(r.status) })
          : t("cab.onb.3.propose", { pme: r.pmeName }),
      );
      setIdentifiant("");
      await qc.invalidateQueries({ queryKey: ["cab-clients", org.id] });
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(
        texteDeLErreur(e, "routes/_authenticated/cabinet.mise-en-route", t("common.error")),
      );
    },
  });

  return (
    <div className="space-y-5">
      <label className="block">
        <span className={ETIQUETTE}>{t("cab.onb.3.identifiant")}</span>
        <input
          value={identifiant}
          onChange={(e) => setIdentifiant(e.target.value)}
          className={cn(CHAMP, "num")}
        />
        <span className={INDICE}>{t("cab.onb.3.identifiant.hint")}</span>
      </label>
      <Retour message={message} erreur={erreur}>
        <button
          type="button"
          className={BOUTON_PIERRE}
          disabled={proposer.isPending || !identifiant.trim()}
          onClick={() => proposer.mutate()}
        >
          {t("cab.onb.3.proposer")}
        </button>
      </Retour>

      <div>
        <p className={ETIQUETTE}>{t("cab.onb.3.mandats")}</p>
        {clients.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : clients.isError ? (
          <Panne erreur={clients.error} />
        ) : (clients.data ?? []).length === 0 ? (
          <EmptyState>{t("cab.onb.3.aucun")}</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-border border border-border">
            {(clients.data ?? []).map((c) => (
              <li key={c.tenantId} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <Link
                    to="/cabinet/dossier/$clientId"
                    params={{ clientId: c.tenantId }}
                    className="block truncate text-[13px] hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.legalId ? (
                    <span className="num block text-[10.5px] text-muted-foreground">
                      {c.legalId}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-[7px] w-[7px]",
                      c.engagementStatus === "actif"
                        ? "bg-signal-ok"
                        : c.engagementStatus === "propose"
                          ? "bg-marigold"
                          : "bg-border",
                    )}
                  />
                  {statutDe(c.engagementStatus)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ============================================================== 4. le seuil */

function LeSeuil() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [seuil, setSeuil] = useState("");
  const [seme, setSeme] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });

  useEffect(() => {
    if (!reglages.data || seme) return;
    setSeuil(String(Math.round(reglages.data.seuilConfianceLot * 100)));
    setSeme(true);
  }, [reglages.data, seme]);

  // On ne passe que ce qu'on a lu : les autres réglages restent tels quels.
  const enregistrer = useMutation({
    mutationFn: () => {
      const r = reglages.data!;
      return office().parametrage.definirReglagesCabinet({
        tenantId: org.id,
        seuilConfianceLot: Number(seuil) / 100,
        seuilConfianceRevue: r.seuilConfianceRevue,
        doubleValidationAuDela: r.doubleValidationAuDela,
        propositionsProactives: r.propositionsProactives,
        capaciteDossiers: r.capaciteDossiers,
        ton: r.ton,
        seuilCertitudeConseil: r.seuilCertitudeConseil,
      });
    },
    onSuccess: async () => {
      setErreur(null);
      setMessage(t("cab.onb.enregistre"));
      await qc.invalidateQueries({ queryKey: ["cab-reglages", org.id] });
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(
        texteDeLErreur(e, "routes/_authenticated/cabinet.mise-en-route", t("common.error")),
      );
    },
  });

  if (reglages.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (reglages.isError) return <Panne erreur={reglages.error} />;

  return (
    <div className="space-y-4">
      {reglages.data && !reglages.data.regle ? (
        <p className="border border-s-2 border-border border-s-marigold bg-background px-3 py-2 text-[12.5px]">
          {t("cab.onb.4.defaut")}
        </p>
      ) : null}
      <label className="block">
        <span className={ETIQUETTE}>{t("cab.onb.4.seuil")}</span>
        <span className="mt-1.5 flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={seuil}
            onChange={(e) => setSeuil(e.target.value)}
            aria-label={t("cab.onb.4.seuil")}
            className="num w-[96px] border border-border bg-background px-3 py-2.5 text-end text-[13.5px]"
          />
          <span className="text-[12px] text-muted-foreground">%</span>
        </span>
        <span className={INDICE}>{t("cab.onb.4.seuil.hint")}</span>
      </label>
      <Retour message={message} erreur={erreur}>
        <button
          type="button"
          className={BOUTON_PIERRE}
          disabled={enregistrer.isPending || seuil === "" || !reglages.data}
          onClick={() => enregistrer.mutate()}
        >
          {t("cab.onb.4.enregistrer")}
        </button>
      </Retour>
    </div>
  );
}

/* ================================================================= terminer */

function Terminer() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);

  const terminer = useMutation({
    mutationFn: () => office().parametrage.terminerMiseEnRoute(org.id),
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["cab-mise-en-route", org.id] });
    },
    onError: (e: unknown) =>
      setErreur(
        texteDeLErreur(e, "routes/_authenticated/cabinet.mise-en-route", t("common.error")),
      ),
  });

  return (
    <>
      <button
        type="button"
        className={BOUTON_ENCRE}
        disabled={terminer.isPending}
        onClick={() => terminer.mutate()}
      >
        {t("cab.onb.terminer")}
      </button>
      {erreur ? (
        <span role="alert" className="self-center text-[12.5px] text-signal-stop">
          {erreur}
        </span>
      ) : null}
    </>
  );
}

/** Une lecture qui échoue se dit : une liste vide et une liste illisible ne sont pas la même chose. */
function Panne({ erreur }: { erreur: unknown }) {
  const { t } = useI18n();
  if (!erreur) return null;
  return (
    <p role="alert" className="mt-2 text-[12.5px] text-signal-stop">
      {texteDeLErreur(erreur, "routes/_authenticated/cabinet.mise-en-route", t("common.error"))}
    </p>
  );
}

function Retour({
  message,
  erreur,
  children,
}: {
  message: string | null;
  erreur: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {children}
      {message ? <span className="text-[12.5px] text-signal-ok">{message}</span> : null}
      {erreur ? (
        <span role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </span>
      ) : null}
    </div>
  );
}
