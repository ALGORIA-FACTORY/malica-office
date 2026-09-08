/**
 * Le conseil — ce que Malica n'ose pas envoyer seule, et le corpus qu'elle cite.
 *
 * ============================================================== POURQUOI
 *
 * Deux registres. « Questions des clients » est la file d'arbitrage : chaque
 * question de conseil qu'un client mandaté a posée, la réponse que Malica
 * propose, ses articles, sa certitude, et son doute — l'expert lève le pouce,
 * écrit la bonne réponse, ou écarte. « Corpus réglementaire » est la même
 * conseillère pour l'expert lui-même : une question libre, une réponse citée,
 * et la veille des éditions du pack.
 *
 * Aucun chiffre n'est calculé ici au-delà d'un compte ou d'un rapport entre
 * deux comptes ; les agrégats viennent de l'API. Le seuil de certitude est un
 * réglage du cabinet, lu et écrit en base — jamais une constante d'écran.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { EmptyState, MalicaAvatar, MalicaNote, SectionTitle } from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { certitudeEnPourcent, messagePourLeClient, nomDeLaSource } from "@malica/socle/conseil";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  Arbitrage,
  DecisionArbitrage,
  StatutArbitrage,
} from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/conseil")({
  head: () => ({
    meta: [
      { title: "Conseil — Malica Office" },
      {
        name: "description",
        content:
          "La file d'arbitrage des questions de conseil des clients, et le corpus réglementaire cité par Malica.",
      },
      { property: "og:title", content: "Conseil — Malica Office" },
      {
        property: "og:description",
        content: "Questions des clients à arbitrer, et réponses citées du corpus juridique.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetConseil,
});

type Onglet = "questions" | "corpus";
type Filtre = "toutes" | StatutArbitrage;

const FILTRES: Array<{ key: Filtre; cle: MessageKey }> = [
  { key: "toutes", cle: "cab.conseil.filtre.toutes" },
  { key: "en_attente", cle: "cab.conseil.filtre.attente" },
  { key: "approuvee", cle: "cab.conseil.filtre.pouce" },
  { key: "corrigee", cle: "cab.conseil.filtre.corrigees" },
  { key: "repondue", cle: "cab.conseil.filtre.seule" },
  { key: "ecartee", cle: "cab.conseil.filtre.ecartees" },
];

const REGLE: Record<StatutArbitrage, MessageKey | null> = {
  en_attente: null,
  repondue: "cab.conseil.regle.repondue",
  approuvee: "cab.conseil.regle.approuvee",
  corrigee: "cab.conseil.regle.corrigee",
  ecartee: "cab.conseil.regle.ecartee",
};

const CANAUX: Record<string, MessageKey> = {
  conversation: "cab.conseil.canal.conversation",
};

/**
 * Les refus codés de la base, traduits. Un second onglet qui décide le même
 * arbitrage reçoit un code, pas une phrase : c'est ici qu'il devient lisible.
 */
const REFUS: Record<string, MessageKey> = {
  "arbitrage.deja_decide": "cab.conseil.erreur.dejaDecide",
  "conseil.reponse_vide": "cab.conseil.erreur.reponseVide",
};

const OU = "routes/_authenticated/cabinet.conseil";

const MINUTE_MS = 60_000;
const HEURE_MS = 60 * MINUTE_MS;
const JOUR_MS = 24 * HEURE_MS;

/** « il y a 3 h », « hier » — la durée dans la langue de la personne, jamais un horodatage brut. */
function depuis(iso: string, locale: string, maintenant: number): string {
  const ecart = new Date(iso).getTime() - maintenant;
  const abs = Math.abs(ecart);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < HEURE_MS) return rtf.format(Math.round(ecart / MINUTE_MS), "minute");
  if (abs < JOUR_MS) return rtf.format(Math.round(ecart / HEURE_MS), "hour");
  return rtf.format(Math.round(ecart / JOUR_MS), "day");
}

/** La même durée, sans le « il y a » : « 3 heures », « 2 jours ». */
function duree(iso: string, locale: string, maintenant: number): string {
  const abs = Math.abs(maintenant - new Date(iso).getTime());
  const unite: Intl.RelativeTimeFormatUnit =
    abs < HEURE_MS ? "minute" : abs < JOUR_MS ? "hour" : "day";
  const n = Math.max(
    1,
    Math.round(abs / (unite === "minute" ? MINUTE_MS : unite === "hour" ? HEURE_MS : JOUR_MS)),
  );
  const parties = new Intl.RelativeTimeFormat(locale, { numeric: "always" }).formatToParts(
    n,
    unite,
  );
  return parties
    .filter((p) => p.type === "integer" || (p.type === "literal" && p.value.trim().length > 0))
    .map((p) => p.value)
    .join("")
    .trim();
}

function CabinetConseil() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const [onglet, setOnglet] = useState<Onglet>("questions");

  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });

  useMalicaPanel(<MalicaNote>{t("cab.conseil.panel")}</MalicaNote>, [locale]);

  const classeOnglet = (actif: boolean) =>
    cn(
      "whitespace-nowrap border-b-2 py-2.5 text-[12.5px]",
      actif
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  const kickerCorpus = pack.data
    ? t("cab.conseil.corpus.kicker", {
        juridiction: org.jurisdiction,
        pack: pack.data.version,
      })
    : t("cab.conseil.corpus.kicker.sansPack", { juridiction: org.jurisdiction });

  return (
    <div className="space-y-8">
      <header className="border-b border-foreground">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {onglet === "questions" ? t("cab.conseil.kicker") : kickerCorpus}
        </p>
        <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
          {onglet === "questions" ? t("cab.conseil.h1") : t("cab.conseil.corpus.h1")}
        </h1>
        <p className="mt-3 max-w-[64ch] text-[13.5px] leading-[1.55] text-text-2">
          {onglet === "questions" ? t("cab.conseil.lede") : t("cab.conseil.corpus.lede")}
        </p>
        <nav className="mt-6 flex gap-5 overflow-x-auto" aria-label={t("cab.conseil.title")}>
          <button
            type="button"
            className={classeOnglet(onglet === "questions")}
            aria-current={onglet === "questions" ? "page" : undefined}
            onClick={() => setOnglet("questions")}
          >
            {t("cab.conseil.tab.questions")}
          </button>
          <button
            type="button"
            className={classeOnglet(onglet === "corpus")}
            aria-current={onglet === "corpus" ? "page" : undefined}
            onClick={() => setOnglet("corpus")}
          >
            {t("cab.conseil.tab.corpus")}
          </button>
        </nav>
      </header>

      {onglet === "questions" ? <QuestionsDesClients /> : <CorpusReglementaire />}
    </div>
  );
}

/* ================================================== questions des clients */

function QuestionsDesClients() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [filtre, setFiltre] = useState<Filtre>("toutes");
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [texte, setTexte] = useState("");
  const [article, setArticle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const maintenant = Date.now();

  const file = useQuery({
    queryKey: ["cab-conseil-file", org.id],
    queryFn: () => office().conseil.file(org.id),
  });
  const stats = useQuery({
    queryKey: ["cab-conseil-stats", org.id],
    queryFn: () => office().conseil.statistiques(org.id),
  });
  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });
  const codes = useMemo(
    () => [...new Set((file.data ?? []).flatMap((a) => a.sources.map((s) => s.corpus)))].sort(),
    [file.data],
  );
  const noms = useQuery({
    queryKey: ["corpus-noms", codes],
    queryFn: () => office().conseil.nomsDesCorpus(codes),
    enabled: codes.length > 0,
  });
  const nomsConnus = useMemo(() => noms.data ?? {}, [noms.data]);

  const rafraichir = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["cab-conseil-file", org.id] }),
      qc.invalidateQueries({ queryKey: ["cab-conseil-stats", org.id] }),
    ]);

  const decider = useMutation({
    mutationFn: (input: {
      arbitrage: Arbitrage;
      decision: DecisionArbitrage;
      reponse?: string | null;
      article?: string | null;
    }) =>
      office().conseil.decider(
        input.arbitrage.id,
        input.decision,
        input.reponse ?? null,
        input.article ?? null,
        messagePourLeClient(
          input.arbitrage,
          input.decision,
          input.reponse ?? null,
          input.article ?? null,
          nomsConnus,
        ),
      ),
    onSuccess: async () => {
      setErreur(null);
      setEnEdition(null);
      setTexte("");
      setArticle("");
      await rafraichir();
    },
    onError: (e: unknown) => {
      const code = e instanceof Error ? REFUS[e.message] : undefined;
      setErreur(code ? t(code) : texteDeLErreur(e, OU, t("common.error")));
    },
  });

  const seuil = reglages.data?.seuilCertitudeConseil ?? null;
  const tous = useMemo(() => file.data ?? [], [file.data]);
  const visibles = filtre === "toutes" ? tous : tous.filter((a) => a.statut === filtre);
  const compte = (f: Filtre) =>
    f === "toutes" ? tous.length : tous.filter((a) => a.statut === f).length;

  const totaux = stats.data?.totaux;
  const arbitrees = (totaux?.approuvees ?? 0) + (totaux?.corrigees ?? 0);
  const justesse = arbitrees > 0 ? Math.round(((totaux?.approuvees ?? 0) / arbitrees) * 100) : null;

  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(iso),
    );

  const commencerCorrection = (a: Arbitrage) => {
    setEnEdition(a.id);
    setTexte(a.reponseProposee);
    setArticle("");
  };

  if (file.isPending || stats.isPending || reglages.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  // Une lecture qui échoue se dit : une file vide et une file illisible ne
  // sont pas la même chose, et l'expert doit savoir laquelle il a sous les yeux.
  const panne = file.error ?? stats.error ?? reglages.error;
  if (panne) {
    return (
      <p role="alert" className="text-[12.5px] text-signal-stop">
        {texteDeLErreur(panne, OU, t("common.error"))}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {/* ---- les chiffres */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            key: "attente",
            label: t("cab.conseil.kpi.attente"),
            value: String(totaux?.enAttente ?? 0),
            ctx: totaux?.plusAncienneEnAttente
              ? t("cab.conseil.kpi.attente.ctx", {
                  duree: duree(totaux.plusAncienneEnAttente, locale, maintenant),
                })
              : t("cab.conseil.kpi.attente.vide"),
            tone: (totaux?.enAttente ?? 0) > 0 ? "text-marigold-on-paper" : "",
          },
          {
            key: "pouce",
            label: t("cab.conseil.kpi.pouce"),
            value: String(totaux?.approuvees ?? 0),
            ctx: t("cab.conseil.kpi.pouce.ctx"),
            tone: "text-signal-ok",
          },
          {
            key: "corrigees",
            label: t("cab.conseil.kpi.corrigees"),
            value: String(totaux?.corrigees ?? 0),
            ctx: t("cab.conseil.kpi.corrigees.ctx"),
            tone: "text-marigold-on-paper",
          },
          {
            key: "justesse",
            label: t("cab.conseil.kpi.justesse"),
            value: justesse === null ? "—" : `${justesse} %`,
            ctx:
              justesse === null
                ? t("cab.conseil.kpi.justesse.sans")
                : t("cab.conseil.kpi.justesse.ctx", { count: arbitrees }),
            tone: "",
          },
        ].map((k) => (
          <div key={k.key} className="border border-border bg-card px-4 py-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {k.label}
            </p>
            <p className={cn("num mt-1.5 text-[28px] leading-none", k.tone)}>{k.value}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{k.ctx}</p>
          </div>
        ))}
      </div>

      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ---- la file */}
        <section className="min-w-0 space-y-3">
          <SectionTitle
            action={
              <span className="num text-[10.5px] text-muted-foreground">
                {t("cab.conseil.file.compte", { n: visibles.length, total: tous.length })}
              </span>
            }
          >
            {t("cab.conseil.file.titre")}
          </SectionTitle>

          <div className="flex flex-wrap items-center gap-1.5">
            {FILTRES.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltre(f.key)}
                aria-pressed={filtre === f.key}
                className={cn(
                  "border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                  filtre === f.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:bg-accent",
                )}
              >
                {t(f.cle)}
                <span className="num ms-1.5 opacity-60">{compte(f.key)}</span>
              </button>
            ))}
          </div>

          {visibles.length === 0 ? (
            <EmptyState>{t("cab.conseil.file.vide")}</EmptyState>
          ) : (
            <ul className="space-y-3">
              {visibles.map((a) => {
                const pct = certitudeEnPourcent(a.certitude);
                const auDessus = seuil !== null && a.certitude >= seuil;
                const tonBarre = auDessus ? "bg-signal-ok" : "bg-marigold";
                const tonTexte = auDessus ? "text-signal-ok" : "text-marigold-on-paper";
                const attend = a.statut === "en_attente";
                const regle = REGLE[a.statut];
                const edite = enEdition === a.id;
                return (
                  <li
                    key={a.id}
                    className={cn(
                      "border border-s-2 bg-card",
                      attend ? "border-foreground" : "border-border",
                      auDessus ? "border-s-signal-ok" : "border-s-marigold",
                    )}
                  >
                    <div className="border-b border-border px-4 py-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2.5">
                          <span
                            aria-hidden
                            className={cn("inline-block h-[7px] w-[7px]", tonBarre)}
                          />
                          <Link
                            to="/cabinet/dossier/$clientId"
                            params={{ clientId: a.tenantId }}
                            className="text-[14px] font-semibold tracking-[-0.012em] hover:underline"
                          >
                            {a.client ?? "—"}
                          </Link>
                          <span className="num text-[10.5px] text-muted-foreground">
                            {a.demandeur ?? t("cab.conseil.demandeur.inconnu")}
                          </span>
                        </span>
                        <span
                          className="num text-[10.5px] text-muted-foreground"
                          title={dateCourte(a.createdAt)}
                        >
                          {depuis(a.createdAt, locale, maintenant)}
                        </span>
                      </div>
                      <p className="mt-3 max-w-[70ch] text-[15.5px] font-medium leading-[1.5] tracking-[-0.01em]">
                        « {a.question} »
                      </p>
                      <p className="mt-2 text-[11.5px] text-muted-foreground">
                        {CANAUX[a.canal] ? t(CANAUX[a.canal]!) : a.canal}
                      </p>
                    </div>

                    <div className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <MalicaAvatar size={34} alt={t("brand.name")} rond />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-paper">
                              {t("cab.conseil.reponse.proposee")}
                            </span>
                            <span className="inline-flex items-center gap-2">
                              <span aria-hidden className="block h-1 w-[52px] bg-secondary">
                                <span
                                  className={cn("block h-1", tonBarre)}
                                  style={{ width: `${pct}%` }}
                                />
                              </span>
                              <span className={cn("num text-[11px]", tonTexte)}>
                                {t("cab.conseil.certitude", { pct })}
                              </span>
                            </span>
                          </div>
                          <p className="mt-2.5 max-w-[74ch] whitespace-pre-wrap text-[14px] leading-[1.7]">
                            {a.reponseProposee}
                          </p>
                          <ul className="mt-3 flex flex-wrap gap-1.5">
                            {a.sources.length === 0 ? (
                              <li className="border border-border bg-secondary/40 px-2 py-1.5 text-[10.5px] text-muted-foreground">
                                {t("cab.conseil.sources.aucune")}
                              </li>
                            ) : (
                              a.sources.map((s) => (
                                <li
                                  key={`${s.corpus}-${s.numero}`}
                                  className="num border border-border bg-secondary/40 px-2 py-1.5 text-[10.5px] text-signal-info"
                                  title={s.validFrom ?? undefined}
                                >
                                  {nomDeLaSource(s, nomsConnus, locale)}
                                </li>
                              ))
                            )}
                          </ul>
                          <p
                            className={cn(
                              "mt-3.5 max-w-[70ch] border-s-2 ps-3 text-[12.5px] leading-[1.6] text-text-2",
                              auDessus ? "border-signal-ok" : "border-marigold",
                            )}
                          >
                            <span className={cn("font-semibold", tonTexte)}>
                              {a.statut === "repondue"
                                ? t("cab.conseil.doute.seule")
                                : t("cab.conseil.doute.titre")}
                            </span>
                            {a.doute ??
                              (a.statut === "repondue"
                                ? t("cab.conseil.doute.auDessus")
                                : t("cab.conseil.doute.absent"))}
                          </p>
                        </div>
                      </div>

                      {(attend || a.statut === "repondue") && !edite ? (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                          <button
                            type="button"
                            disabled={decider.isPending}
                            onClick={() => decider.mutate({ arbitrage: a, decision: "approuvee" })}
                            className="border border-foreground bg-foreground px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-signal-ok hover:border-signal-ok disabled:opacity-40"
                          >
                            {attend ? t("cab.conseil.approuver") : t("cab.conseil.approuver.apres")}
                          </button>
                          <button
                            type="button"
                            disabled={decider.isPending}
                            onClick={() => commencerCorrection(a)}
                            className="border border-border bg-card px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-40"
                          >
                            {t("cab.conseil.corriger")}
                          </button>
                          {attend ? (
                            <button
                              type="button"
                              disabled={decider.isPending}
                              onClick={() => decider.mutate({ arbitrage: a, decision: "ecartee" })}
                              className="border border-border bg-card px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] hover:border-signal-stop hover:text-signal-stop disabled:opacity-40"
                            >
                              {t("cab.conseil.ecarter")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {edite ? (
                        <div className="mt-4 border-t border-foreground pt-4">
                          <label className="block">
                            <span className="block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              {t("cab.conseil.correction.titre")}
                            </span>
                            <textarea
                              rows={5}
                              value={texte}
                              onChange={(e) => setTexte(e.target.value)}
                              placeholder={t("cab.conseil.correction.placeholder")}
                              className="mt-2 w-full resize-y border border-border bg-secondary/40 px-3 py-2.5 text-[13.5px] leading-[1.65] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </label>
                          <label className="mt-3 block">
                            <span className="block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              {t("cab.conseil.correction.article")}
                            </span>
                            <input
                              value={article}
                              onChange={(e) => setArticle(e.target.value)}
                              placeholder={t("cab.conseil.correction.article.placeholder")}
                              className="num mt-2 w-full border border-border bg-secondary/40 px-3 py-2.5 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </label>
                          <div className="mt-3.5 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={decider.isPending || texte.trim() === ""}
                              onClick={() =>
                                decider.mutate({
                                  arbitrage: a,
                                  decision: "corrigee",
                                  reponse: texte.trim(),
                                  article: article.trim() || null,
                                })
                              }
                              className="border border-foreground bg-foreground px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:text-foreground disabled:opacity-40"
                            >
                              {t("cab.conseil.correction.envoyer")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEnEdition(null)}
                              className="border border-border bg-card px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {regle && !edite ? (
                        <div
                          className={cn(
                            "mt-4 flex flex-wrap items-center gap-3 border bg-secondary/40 px-3.5 py-3",
                            a.statut === "approuvee"
                              ? "border-signal-ok"
                              : a.statut === "corrigee"
                                ? "border-marigold"
                                : "border-border",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "inline-block h-[7px] w-[7px]",
                              a.statut === "approuvee"
                                ? "bg-signal-ok"
                                : a.statut === "corrigee"
                                  ? "bg-marigold"
                                  : "bg-border",
                            )}
                          />
                          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5]">
                            {t(regle)}
                            {a.decideLe ? (
                              <span className="num ms-2 text-[10.5px] text-muted-foreground">
                                {t("cab.conseil.regle.le", { date: dateCourte(a.decideLe) })}
                              </span>
                            ) : null}
                          </span>
                          {a.statut === "corrigee" && a.reponseCabinet ? (
                            <p className="basis-full whitespace-pre-wrap text-[12.5px] leading-[1.6] text-text-2">
                              {a.reponseCabinet}
                              {a.articleCabinet ? (
                                <span className="num mt-1 block text-[11px] text-signal-info">
                                  {a.articleCabinet}
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---- la colonne de droite */}
        <aside className="min-w-0 space-y-5">
          <StatistiquesParClient justesseDuCabinet={justesse} />
          <SujetsQuiReviennent />
          <SeuilDeCertitude file={tous} />
        </aside>
      </div>
    </div>
  );
}

function StatistiquesParClient({ justesseDuCabinet }: { justesseDuCabinet: number | null }) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const stats = useQuery({
    queryKey: ["cab-conseil-stats", org.id],
    queryFn: () => office().conseil.statistiques(org.id),
  });
  const lignes = stats.data?.parClient ?? [];

  return (
    <section className="space-y-0">
      <SectionTitle
        action={
          <Link
            to="/cabinet/pilotage"
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline"
          >
            {t("cab.nav.pilotage")}
          </Link>
        }
      >
        {t("cab.conseil.stats.titre")}
      </SectionTitle>
      {lignes.length === 0 ? (
        <p className="border border-t-0 border-border bg-card px-4 py-4 text-[12.5px] text-muted-foreground">
          {t("cab.conseil.stats.vide")}
        </p>
      ) : (
        <ul className="divide-y divide-border border border-t-0 border-border bg-card">
          {lignes.map((c) => {
            const arbitrees = c.approuvees + c.corrigees;
            const taux = arbitrees > 0 ? Math.round((c.approuvees / arbitrees) * 100) : null;
            const ton =
              taux === null || justesseDuCabinet === null
                ? "text-muted-foreground"
                : taux >= justesseDuCabinet
                  ? "text-signal-ok"
                  : "text-marigold-on-paper";
            const barre =
              taux === null || justesseDuCabinet === null
                ? "bg-border"
                : taux >= justesseDuCabinet
                  ? "bg-signal-ok"
                  : "bg-marigold";
            return (
              <li key={c.tenantId} className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    to="/cabinet/dossier/$clientId"
                    params={{ clientId: c.tenantId }}
                    className="min-w-0 text-[13.5px] font-semibold tracking-[-0.01em] hover:underline"
                  >
                    {c.client ?? "—"}
                  </Link>
                  <span className={cn("num text-[13px]", ton)}>
                    {taux === null ? "—" : `${taux} %`}
                  </span>
                </div>
                <span aria-hidden className="mt-2 block h-[5px] bg-secondary">
                  <span className={cn("block h-[5px]", barre)} style={{ width: `${taux ?? 0}%` }} />
                </span>
                <div className="num mt-2.5 flex flex-wrap gap-3.5 text-[10.5px]">
                  <span className="text-muted-foreground">
                    {t("cab.conseil.stats.questions", { count: c.questions })}
                  </span>
                  <span className="text-signal-ok">
                    {t("cab.conseil.stats.pouce", { count: c.approuvees })}
                  </span>
                  <span className="text-marigold-on-paper">
                    {t("cab.conseil.stats.corrigees", { count: c.corrigees })}
                  </span>
                </div>
                {c.dernierSujet ? (
                  <p className="mt-2 text-[11px] leading-[1.5] text-muted-foreground">
                    {t("cab.conseil.stats.sujet", { sujet: c.dernierSujet })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SujetsQuiReviennent() {
  const { t } = useI18n();
  const { org } = useCabinet();
  const stats = useQuery({
    queryKey: ["cab-conseil-stats", org.id],
    queryFn: () => office().conseil.statistiques(org.id),
  });
  const sujets = stats.data?.sujets ?? [];
  const max = Math.max(1, ...sujets.map((s) => s.questions));
  const total = (stats.data?.parClient ?? []).reduce((n, c) => n + c.questions, 0);
  const premier = sujets[0];

  return (
    <section className="border border-border bg-card p-4">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {t("cab.conseil.sujets.titre")}
      </p>
      {sujets.length === 0 ? (
        <p className="mt-3 text-[12px] leading-[1.6] text-muted-foreground">
          {t("cab.conseil.sujets.vide")}
        </p>
      ) : (
        <>
          <ul className="mt-3.5 space-y-3">
            {sujets.map((s) => (
              <li key={s.theme}>
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="text-[12.5px]">{s.theme}</span>
                  <span className="num text-[11.5px] text-muted-foreground">{s.questions}</span>
                </div>
                <span aria-hidden className="mt-1.5 block h-1 bg-secondary">
                  <span
                    className="block h-1 bg-foreground"
                    style={{ width: `${Math.round((s.questions / max) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
          {premier && total > 0 ? (
            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-[1.6] text-muted-foreground">
              {t("cab.conseil.sujets.note", {
                pct: Math.round((premier.questions / total) * 100),
                sujet: premier.theme,
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function SeuilDeCertitude({ file }: { file: Arbitrage[] }) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });
  const [pct, setPct] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (reglages.data && pct === null) {
      setPct(certitudeEnPourcent(reglages.data.seuilCertitudeConseil));
    }
  }, [reglages.data, pct]);

  const enregistrer = useMutation({
    mutationFn: (valeur: number) => {
      const r = reglages.data;
      if (!r) throw new Error("reglages.illisibles");
      return office().parametrage.definirReglagesCabinet({
        tenantId: org.id,
        seuilConfianceLot: r.seuilConfianceLot,
        seuilConfianceRevue: r.seuilConfianceRevue,
        doubleValidationAuDela: r.doubleValidationAuDela,
        propositionsProactives: r.propositionsProactives,
        capaciteDossiers: r.capaciteDossiers,
        ton: r.ton,
        seuilCertitudeConseil: valeur / 100,
      });
    },
    onSuccess: async () => {
      setErreur(null);
      setMessage(t("cab.conseil.seuil.enregistre"));
      await qc.invalidateQueries({ queryKey: ["cab-reglages", org.id] });
    },
    onError: (e: unknown) => {
      setMessage(null);
      setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });

  const valeur = pct ?? 0;
  const remises = file.filter((a) => a.certitude < valeur / 100).length;
  const enregistre = reglages.data
    ? certitudeEnPourcent(reglages.data.seuilCertitudeConseil)
    : null;

  return (
    <section className="border border-s-2 border-border border-s-marigold bg-card p-4">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-paper">
        {t("cab.conseil.seuil.titre")}
      </p>
      <p className="mt-2.5 text-[12.5px] leading-[1.6]">
        {t("cab.conseil.seuil.texte", { pct: valeur })}
      </p>
      <div className="mt-3.5 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={valeur}
          disabled={pct === null || enregistrer.isPending}
          aria-label={t("cab.conseil.seuil.aria")}
          onChange={(e) => setPct(Number(e.target.value))}
          onMouseUp={() => {
            if (pct !== null && pct !== enregistre) enregistrer.mutate(pct);
          }}
          onTouchEnd={() => {
            if (pct !== null && pct !== enregistre) enregistrer.mutate(pct);
          }}
          onKeyUp={() => {
            if (pct !== null && pct !== enregistre) enregistrer.mutate(pct);
          }}
          className="flex-1 accent-marigold"
        />
        <span className="num whitespace-nowrap text-[13px]">{valeur} %</span>
      </div>
      <p className="mt-3 text-[11px] leading-[1.55] text-muted-foreground">
        {file.length === 0
          ? t("cab.conseil.seuil.hint.vide")
          : t("cab.conseil.seuil.hint", { count: remises, total: file.length })}
      </p>
      {message ? <p className="mt-2 text-[11.5px] text-signal-ok">{message}</p> : null}
      {erreur ? (
        <p role="alert" className="mt-2 text-[11.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}

/* ================================================== corpus réglementaire */

function CorpusReglementaire() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const [question, setQuestion] = useState("");
  const maintenant = Date.now();

  const reponse = useMutation({
    mutationFn: (q: string) =>
      office().malica.repondreAuCabinet({ tenantId: org.id, question: q, locale }),
  });
  const veille = useQuery({
    queryKey: ["cab-conseil-veille", org.jurisdiction],
    queryFn: () => office().conseil.veille(org.jurisdiction),
  });

  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  const version = (s: { validFrom: string | null; validTo: string | null }) =>
    s.validFrom
      ? s.validTo
        ? t("cab.conseil.corpus.version.entre", {
            debut: dateLongue(s.validFrom),
            fin: dateLongue(s.validTo),
          })
        : t("cab.conseil.corpus.version.depuis", { date: dateLongue(s.validFrom) })
      : t("cab.conseil.corpus.version.inconnue");

  const demander = () => {
    const q = question.trim();
    if (q.length < 3 || reponse.isPending) return;
    reponse.mutate(q);
  };

  const r = reponse.data;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className="min-w-0 border border-border bg-card p-4">
        <div className="flex items-center gap-2.5 border border-border bg-secondary/40 px-3 py-2.5">
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
            className="shrink-0 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                demander();
              }
            }}
            placeholder={t("cab.conseil.corpus.placeholder")}
            aria-label={t("cab.conseil.corpus.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={demander}
            disabled={reponse.isPending || question.trim().length < 3}
            className="border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
          >
            {t("cab.conseil.corpus.demander")}
          </button>
        </div>

        {reponse.isPending ? (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            {t("cab.conseil.corpus.attente")}
          </p>
        ) : reponse.isError ? (
          <p role="alert" className="mt-4 text-[12.5px] text-signal-stop">
            {texteDeLErreur(reponse.error, OU, t("malica.chat.error"))}
          </p>
        ) : r ? (
          <>
            <div className="mt-4 border-s-2 border-marigold ps-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-paper">
                  {t("cab.conseil.corpus.reponse")}
                </p>
                {r.sources.length > 0 ? (
                  <span className="num text-[11px] text-muted-foreground">
                    {t("cab.conseil.certitude", { pct: certitudeEnPourcent(r.certitude) })}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-[64ch] whitespace-pre-wrap text-[14.5px] leading-[1.7]">
                {r.reponse}
              </p>
              {r.doute ? (
                <p className="mt-2.5 max-w-[64ch] text-[12px] leading-[1.6] text-text-2">
                  {r.doute}
                </p>
              ) : null}
            </div>
            {r.sources.length === 0 ? (
              <p className="mt-4 border border-border bg-secondary/40 px-3 py-2.5 text-[12px] text-muted-foreground">
                {t("cab.conseil.corpus.sansSource")}
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border border border-border">
                {r.sources.map((s) => (
                  <li
                    key={`${s.corpus}-${s.numero}`}
                    className="flex flex-wrap items-baseline justify-between gap-2.5 bg-card px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {s.nom ?? s.corpus}
                        {s.nature ? (
                          <span className="ms-2 text-[11px] font-normal text-muted-foreground">
                            {s.nature}
                          </span>
                        ) : null}
                      </span>
                      <span className="num mt-0.5 block text-[11px] text-signal-info">
                        {t("cab.conseil.corpus.article", { numero: s.numero })}
                      </span>
                    </span>
                    <span className="num whitespace-nowrap text-[10.5px] text-muted-foreground">
                      {version(s)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {r.signale.length > 0 ? (
              <ul className="mt-3 border-s-2 border-signal-warn ps-3 text-[11px] text-muted-foreground">
                {r.signale.map((d, k) => (
                  <li key={k}>{d}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-[12.5px] text-muted-foreground">{t("cab.conseil.corpus.vide")}</p>
        )}
      </section>

      <aside className="min-w-0 space-y-3.5">
        <section className="border border-border bg-card p-4">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.conseil.veille.titre")}
          </p>
          {veille.isPending ? (
            <p className="mt-3 text-[12px] text-muted-foreground">{t("common.loading")}</p>
          ) : veille.isError ? (
            <p role="alert" className="mt-3 text-[12px] text-signal-stop">
              {texteDeLErreur(veille.error, OU, t("common.error"))}
            </p>
          ) : (veille.data ?? []).length === 0 ? (
            <p className="mt-3 text-[12px] leading-[1.6] text-muted-foreground">
              {t("cab.conseil.veille.vide")}
            </p>
          ) : (
            <ul className="mt-3.5 space-y-3.5">
              {(veille.data ?? []).map((e) => {
                const aVenir = new Date(`${e.validFrom}T00:00:00Z`).getTime() > maintenant;
                return (
                  <li key={`${e.corpus}-${e.validFrom}`} className="border-t border-border pt-3">
                    <span
                      className={cn(
                        "num block text-[10.5px]",
                        aVenir ? "text-marigold-on-paper" : "text-muted-foreground",
                      )}
                    >
                      {dateLongue(e.validFrom)}
                    </span>
                    <span className="mt-1.5 block text-[13px] font-medium leading-[1.45]">
                      {t("cab.conseil.veille.edition", {
                        corpus: e.nom ?? e.corpus,
                        count: e.articles,
                      })}
                    </span>
                    <span className="mt-1 block text-[11.5px] leading-[1.55] text-muted-foreground">
                      {aVenir
                        ? t("cab.conseil.veille.note.avenir", { date: dateLongue(e.validFrom) })
                        : t("cab.conseil.veille.note.envigueur", { date: dateLongue(e.validFrom) })}
                      {e.modifiePar
                        ? ` ${t("cab.conseil.veille.note.modifie", { texte: e.modifiePar })}`
                        : e.jort
                          ? ` ${t("cab.conseil.veille.note.jort", { jort: e.jort })}`
                          : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="border border-s-2 border-border border-s-marigold bg-card p-4">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-paper">
            {t("cab.conseil.refus.titre")}
          </p>
          <p className="mt-2 text-[13px] leading-[1.6]">{t("cab.conseil.refus.texte")}</p>
        </section>
      </aside>
    </div>
  );
}
