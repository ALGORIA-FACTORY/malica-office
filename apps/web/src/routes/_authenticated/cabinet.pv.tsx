/**
 * Le PV de réunion — rédigé par Regalica, arrêté par le cabinet.
 *
 * ============================================================== POURQUOI
 *
 * Le procès-verbal de restitution est le seul texte qu'un modèle rédige
 * (R3). L'écran le montre tel qu'il est : le texte d'un côté, les chiffres
 * de l'autre — chacun avec le moteur qui l'a produit. Le cabinet peut
 * reprendre le texte tant que le PV est un brouillon ; envoyé, il est figé
 * (R7), et c'est la base qui le refuse, pas l'écran.
 *
 * « Exporter PDF » est l'impression du navigateur, avec une feuille de style
 * qui ne garde que le document. Ce n'est pas un rendu à part.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { EmptyState, RegalicaNote, SectionTitle } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { finDuMois } from "@/lib/exercice";
import { montant } from "@/lib/lisible";
import { pvRediger } from "@/lib/pv.functions";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type {
  CollabRepository,
  PvChiffre,
  PvReunion,
} from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/pv")({
  head: () => ({
    meta: [
      { title: "PV de réunion — Regalica Office" },
      {
        name: "description",
        content:
          "Le procès-verbal de restitution d'un dossier : rédigé par Regalica, chaque chiffre portant le moteur du Socle qui l'a produit.",
      },
      { property: "og:title", content: "PV de réunion — Regalica Office" },
      {
        property: "og:description",
        content: "Le texte est de Regalica ; les chiffres sont du Socle. Envoyé, le PV est figé.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetPv,
});

const CHIFFRES: Record<string, MessageKey> = {
  ca: "cab.pv.chiffre.ca",
  charges: "cab.pv.chiffre.charges",
  resultat: "cab.pv.chiffre.resultat",
  tvaCollectee: "cab.pv.chiffre.tvaCollectee",
  tvaDeductible: "cab.pv.chiffre.tvaDeductible",
  tva: "cab.pv.chiffre.tva",
  pieces: "cab.pv.chiffre.pieces",
  aSuperviser: "cab.pv.chiffre.aSuperviser",
  retournees: "cab.pv.chiffre.retournees",
  echeances: "cab.pv.chiffre.echeances",
};
const SOURCES: Record<string, MessageKey> = {
  pnl: "cab.pv.source.pnl",
  tva: "cab.pv.source.tva",
  file: "cab.pv.source.file",
  calendrier: "cab.pv.source.calendrier",
};
const RAISONS: Record<string, MessageKey> = {
  sans_client: "cab.pv.rediger.sansClient",
  introuvable: "cab.pv.empty",
  envoye: "cab.pv.statut.envoye",
  refuse: "cab.pv.rediger.refuse",
  indisponible: "cab.pv.rediger.indisponible",
};

const BOUTON_ENCRE =
  "border border-foreground bg-foreground px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:text-foreground disabled:opacity-40";
const BOUTON_PIERRE =
  "border border-border bg-card px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-40";
const CHAMP =
  "w-full border border-border bg-background px-3 py-2.5 text-[13.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const ETIQUETTE =
  "block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";

function CabinetPv() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const rediger = useServerFn(pvRediger);

  const [selection, setSelection] = useState<string | null>(null);
  const [filtre, setFiltre] = useState("");
  const [form, setForm] = useState({
    clientTenantId: "",
    at: new Date().toISOString().slice(0, 10),
    presents: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const pvs = useQuery({
    queryKey: ["cab-pv", org.id],
    queryFn: () => office().collab.pvList(org.id),
  });

  const rows = useMemo(() => {
    const tous = pvs.data ?? [];
    return filtre ? tous.filter((p) => p.clientTenantId === filtre) : tous;
  }, [pvs.data, filtre]);
  // Le document ouvert est toujours l'un de ceux que la liste montre : filtrer
  // sur un client ne laisse pas à l'écran le PV d'un autre.
  const pv = rows.find((p) => p.id === selection) ?? null;

  useEffect(() => {
    if (rows[0] && !rows.some((p) => p.id === selection)) setSelection(rows[0].id);
  }, [rows, selection]);

  const nomDe = (id: string | null) =>
    id ? ((clients.data ?? []).find((c) => c.tenantId === id)?.name ?? "") : "";
  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
    );
  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));

  const rafraichir = () => qc.invalidateQueries({ queryKey: ["cab-pv", org.id] });
  const signaler = (e: unknown) => {
    setMessage(null);
    setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.pv", t("common.error")));
  };
  const direLaRaison = (raison: string) => {
    setErreur(null);
    setMessage(t(RAISONS[raison] ?? "common.error"));
  };

  const creer = useMutation({
    mutationFn: async () => {
      const client = nomDe(form.clientTenantId);
      const id = await office().collab.addPv({
        cabinetTenantId: org.id,
        clientTenantId: form.clientTenantId,
        at: form.at,
        titre: t("cab.pv.titre.defaut", { client }),
        participants: form.presents.trim() || null,
      });
      const resultat = await rediger({ data: { pvId: id, locale } });
      return { id, resultat };
    },
    onSuccess: async ({ id, resultat }) => {
      setErreur(null);
      setMessage(null);
      setForm((f) => ({ ...f, presents: "" }));
      await rafraichir();
      setSelection(id);
      if (!resultat.ok) direLaRaison(resultat.raison);
    },
    onError: signaler,
  });

  const rerediger = useMutation({
    mutationFn: (id: string) => rediger({ data: { pvId: id, locale } }),
    onSuccess: async (resultat) => {
      setErreur(null);
      setMessage(null);
      await rafraichir();
      if (!resultat.ok) direLaRaison(resultat.raison);
    },
    onError: signaler,
  });

  const envoyer = useMutation({
    mutationFn: (id: string) => office().collab.pvEnvoyer(id),
    onSuccess: async () => {
      setErreur(null);
      setMessage(null);
      await rafraichir();
    },
    onError: signaler,
  });

  const enregistrer = useMutation({
    mutationFn: (input: Parameters<CollabRepository["pvEnregistrer"]>[0]) =>
      office().collab.pvEnregistrer(input),
    onSuccess: async () => {
      setErreur(null);
      setMessage(null);
      await rafraichir();
    },
    onError: signaler,
  });

  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.pv.panel.kicker")}>
      {pv?.redigeParRegalica ? t("cab.pv.panel.doc") : t("cab.pv.panel", { count: rows.length })}
    </RegalicaNote>,
    [rows.length, pv?.redigeParRegalica, locale],
  );

  const enCours =
    creer.isPending || rerediger.isPending || envoyer.isPending || enregistrer.isPending;
  const jour = pv?.at ?? form.at;
  // Une liste illisible n'est pas une liste vide : la panne se dit.
  const panne = pvs.error ?? clients.error;

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header>
        <p className="num text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {t("cab.pv.kicker", { date: dateCourte(jour) })}
        </p>
        <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
          {t("cab.pv.title")}
        </h1>
        <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.55] text-text-2">
          {t("cab.pv.rediger.lede")}
        </p>
      </header>

      {message ? (
        <p className="border border-s-2 border-border border-s-marigold bg-card px-3 py-2 text-[12.5px]">
          {message}
        </p>
      ) : null}
      {erreur ? (
        <p
          role="alert"
          className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12.5px]"
        >
          {erreur}
        </p>
      ) : null}
      {panne ? (
        <p
          role="alert"
          className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12.5px]"
        >
          {texteDeLErreur(panne, "routes/_authenticated/cabinet.pv", t("common.error"))}
        </p>
      ) : null}

      {/* ---- le document et sa marge */}
      {pv ? (
        <DocumentPv
          pv={pv}
          client={nomDe(pv.clientTenantId)}
          enCours={enCours}
          redaction={rerediger.isPending || creer.isPending}
          dateCourte={dateCourte}
          dateLongue={dateLongue}
          onEnvoyer={() => envoyer.mutate(pv.id)}
          onRerediger={() => rerediger.mutate(pv.id)}
          onEnregistrer={(input) => enregistrer.mutate({ id: pv.id, ...input })}
        />
      ) : null}

      {/* ---- rédiger un PV */}
      <section className="border border-border bg-card p-4 sm:p-5">
        <SectionTitle>{t("cab.pv.rediger")}</SectionTitle>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <label className="block">
            <span className={ETIQUETTE}>{t("cab.pv.client")}</span>
            <select
              value={form.clientTenantId}
              onChange={(e) => setForm((f) => ({ ...f, clientTenantId: e.target.value }))}
              className={cn(CHAMP, "mt-1.5")}
            >
              <option value="">—</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.tenantId} value={c.tenantId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={ETIQUETTE}>{t("cab.pv.date")}</span>
            <input
              type="date"
              value={form.at}
              onChange={(e) => e.target.value && setForm((f) => ({ ...f, at: e.target.value }))}
              className={cn(CHAMP, "num mt-1.5")}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={ETIQUETTE}>{t("cab.pv.presents")}</span>
            <input
              value={form.presents}
              onChange={(e) => setForm((f) => ({ ...f, presents: e.target.value }))}
              className={cn(CHAMP, "mt-1.5")}
            />
            <span className="mt-1.5 block text-[11px] leading-[1.5] text-muted-foreground">
              {t("cab.pv.presents.hint")}
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button
            type="button"
            className={BOUTON_ENCRE}
            disabled={!form.clientTenantId || enCours}
            onClick={() => creer.mutate()}
          >
            {creer.isPending ? t("cab.pv.rediger.encours") : t("cab.pv.rediger.action")}
          </button>
          {!form.clientTenantId ? (
            <span className="text-[12px] text-muted-foreground">
              {t("cab.pv.rediger.sansClient")}
            </span>
          ) : null}
        </div>
      </section>

      {/* ---- la liste */}
      <section className="space-y-3">
        <SectionTitle
          action={
            <label className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("cab.pv.liste.filtre")}
              </span>
              <select
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                aria-label={t("cab.pv.liste.filtre")}
                className="max-w-[240px] border border-border bg-card px-2.5 py-1.5 text-[12px]"
              >
                <option value="">{t("cab.pv.liste.tous")}</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {t("cab.pv.liste.titre")}
        </SectionTitle>
        {pvs.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : pvs.isError ? null : rows.length === 0 ? (
          <EmptyState>{t("cab.pv.empty")}</EmptyState>
        ) : (
          <ul className="divide-y divide-border border border-border bg-card">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelection(row.id)}
                  aria-current={row.id === selection ? "true" : undefined}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-3 px-4 py-3 text-start hover:bg-secondary/60",
                    row.id === selection ? "bg-secondary" : "",
                  )}
                >
                  <span className="min-w-0">
                    <span className="num block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {dateCourte(row.at)}
                      {row.clientTenantId ? ` · ${nomDe(row.clientTenantId)}` : ""}
                    </span>
                    <span className="mt-0.5 block truncate text-[13.5px] font-medium">
                      {row.titre}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    <span
                      aria-hidden
                      className={cn(
                        "inline-block h-[7px] w-[7px]",
                        row.statut === "envoye" ? "bg-signal-ok" : "bg-marigold",
                      )}
                    />
                    {row.statut === "envoye"
                      ? t("cab.pv.statut.envoye")
                      : t("cab.pv.statut.brouillon")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ================================================================ document */

function DocumentPv({
  pv,
  client,
  enCours,
  redaction,
  dateCourte,
  dateLongue,
  onEnvoyer,
  onRerediger,
  onEnregistrer,
}: {
  pv: PvReunion;
  client: string;
  enCours: boolean;
  redaction: boolean;
  dateCourte: (iso: string) => string;
  dateLongue: (iso: string) => string;
  onEnvoyer: () => void;
  onRerediger: () => void;
  onEnregistrer: (input: {
    sections?: PvReunion["sections"];
    decisions?: string | null;
    redigeParRegalica?: boolean;
  }) => void;
}) {
  const { t, locale } = useI18n();
  const brouillon = pv.statut !== "envoye";
  const [reprise, setReprise] = useState(false);
  const [sections, setSections] = useState(pv.sections);
  const [decisions, setDecisions] = useState(pv.decisions ?? "");

  // Le document affiché change : ce qu'on éditait ne le concerne plus.
  useEffect(() => {
    setReprise(false);
    setSections(pv.sections);
    setDecisions(pv.decisions ?? "");
  }, [pv.id, pv.sections, pv.decisions]);

  const finDeMois = finDuMois(pv.at.slice(0, 7));
  const lignesDeDecision = (pv.decisions ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const valeurDe = (c: PvChiffre) =>
    c.genre === "montant" ? `${montant(c.valeur, locale)} ${c.devise ?? ""}`.trim() : c.valeur;
  const libelleDe = (c: PvChiffre) => (CHIFFRES[c.label] ? t(CHIFFRES[c.label]!) : c.label);
  const sourceDe = (c: PvChiffre) => (SOURCES[c.source] ? t(SOURCES[c.source]!) : c.source);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
      {/* ---- le document */}
      <section className="pv-document min-w-0 border border-border bg-card p-5 sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {pv.clientTenantId ? t("cab.pv.doc.kicker", { client }) : t("cab.pv.doc.sansClient")}
        </p>
        <h2 className="mt-3 text-[21px] font-semibold leading-[1.25] tracking-[-0.01em]">
          {t("cab.pv.doc.titre", { date: dateLongue(finDeMois) })}
        </h2>
        <p className="num mt-2.5 text-[11.5px] leading-[1.5] text-text-2">
          {t("cab.pv.doc.presents", { presents: pv.participants ?? "—" })}
        </p>

        {reprise ? (
          <div className="mt-5 space-y-4 border-t border-border pt-4">
            {sections.map((s, i) => (
              <div key={i} className="space-y-2">
                <label className="block">
                  <span className={ETIQUETTE}>{t("cab.pv.section.kicker")}</span>
                  <input
                    value={s.kicker}
                    onChange={(e) =>
                      setSections((liste) =>
                        liste.map((x, k) => (k === i ? { ...x, kicker: e.target.value } : x)),
                      )
                    }
                    className={cn(CHAMP, "mt-1.5")}
                  />
                </label>
                <label className="block">
                  <span className={ETIQUETTE}>{t("cab.pv.section.corps")}</span>
                  <textarea
                    rows={5}
                    value={s.corps}
                    onChange={(e) =>
                      setSections((liste) =>
                        liste.map((x, k) => (k === i ? { ...x, corps: e.target.value } : x)),
                      )
                    }
                    className={cn(CHAMP, "mt-1.5 leading-[1.6]")}
                  />
                </label>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={BOUTON_ENCRE}
                disabled={enCours || sections.some((s) => !s.kicker.trim() || !s.corps.trim())}
                onClick={() => {
                  onEnregistrer({
                    sections: sections.map((s) => ({
                      kicker: s.kicker.trim(),
                      corps: s.corps.trim(),
                    })),
                    redigeParRegalica: false,
                  });
                  setReprise(false);
                }}
              >
                {t("cab.pv.reprendre.enregistrer")}
              </button>
              <button
                type="button"
                className={BOUTON_PIERRE}
                onClick={() => {
                  setSections(pv.sections);
                  setReprise(false);
                }}
              >
                {t("cab.pv.reprendre.annuler")}
              </button>
            </div>
          </div>
        ) : pv.sections.length === 0 ? (
          <p className="mt-5 border-t border-border pt-4 text-[13px] text-muted-foreground">
            {redaction ? t("cab.pv.rediger.encours") : t("cab.pv.sansTexte")}
          </p>
        ) : (
          pv.sections.map((s, i) => (
            <div key={i} className="mt-5 border-t border-border pt-3.5">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {s.kicker}
              </p>
              <p className="mt-2 whitespace-pre-line text-[13.5px] leading-[1.65]">{s.corps}</p>
            </div>
          ))
        )}

        {/* ---- les chiffres et leurs moteurs */}
        <div className="mt-5 border-t border-border pt-3.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.pv.chiffres.titre")}
          </p>
          {pv.chiffres.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">{t("cab.pv.chiffres.vide")}</p>
          ) : (
            <table className="mt-2.5 w-full border-collapse text-[12.5px]">
              <caption className="sr-only">{t("cab.pv.chiffres.titre")}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("cab.pv.col.chiffre")}</th>
                  <th scope="col">{t("cab.pv.col.valeur")}</th>
                  <th scope="col">{t("cab.pv.col.source")}</th>
                </tr>
              </thead>
              <tbody>
                {pv.chiffres.map((c, i) => (
                  <tr key={`${c.label}-${i}`} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 pe-3 text-text-2">{libelleDe(c)}</td>
                    <td className="num py-1.5 text-end font-medium">{valeurDe(c)}</td>
                    <td className="whitespace-nowrap py-1.5 ps-3.5 text-end text-[9px] font-semibold uppercase tracking-[0.14em] text-signal-info">
                      {sourceDe(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ---- la marge */}
      <aside className="flex min-w-0 flex-col gap-3.5">
        {pv.redigeParRegalica ? (
          <div className="border border-s-2 border-border border-s-marigold bg-card p-3.5">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-paper">
              {t("cab.pv.regalica.kicker")}
            </p>
            <p className="mt-2 text-[12.5px] leading-[1.55]">{t("cab.pv.regalica.corps")}</p>
          </div>
        ) : pv.sections.length > 0 ? (
          <div className="border border-s-2 border-border border-s-foreground bg-card p-3.5">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("cab.pv.cabinet.kicker")}
            </p>
            <p className="mt-2 text-[12.5px] leading-[1.55]">{t("cab.pv.cabinet.corps")}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {brouillon ? (
            <button
              type="button"
              className={BOUTON_ENCRE}
              disabled={enCours || pv.sections.length === 0 || !pv.clientTenantId}
              onClick={onEnvoyer}
            >
              {t("cab.pv.envoyer")}
            </button>
          ) : (
            <p className="num border border-signal-ok px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-signal-ok">
              {t("cab.pv.envoye", { date: dateCourte(pv.envoyeLe ?? pv.at) })}
            </p>
          )}
          <button
            type="button"
            className={BOUTON_PIERRE}
            disabled={pv.sections.length === 0}
            onClick={() => window.print()}
          >
            {t("cab.pv.exporter")}
          </button>
          {brouillon ? (
            <>
              <button
                type="button"
                className={BOUTON_PIERRE}
                disabled={enCours || pv.sections.length === 0 || reprise}
                onClick={() => setReprise(true)}
              >
                {t("cab.pv.reprendre")}
              </button>
              <button
                type="button"
                className={BOUTON_PIERRE}
                disabled={enCours || !pv.clientTenantId}
                onClick={onRerediger}
              >
                {redaction ? t("cab.pv.rediger.encours") : t("cab.pv.rerediger")}
              </button>
            </>
          ) : null}
        </div>

        <div className="border border-border bg-card p-3.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.pv.decisions.titre")}
          </p>
          {brouillon ? (
            <>
              <textarea
                rows={4}
                value={decisions}
                onChange={(e) => setDecisions(e.target.value)}
                aria-label={t("cab.pv.decisions.titre")}
                className={cn(CHAMP, "mt-2.5 text-[12.5px] leading-[1.5]")}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={BOUTON_PIERRE}
                  disabled={enCours || decisions === (pv.decisions ?? "")}
                  onClick={() => onEnregistrer({ decisions: decisions.trim() || null })}
                >
                  {t("cab.pv.decisions.enregistrer")}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {t("cab.pv.decisions.hint")}
                </span>
              </div>
            </>
          ) : lignesDeDecision.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">{t("cab.pv.decisions.vide")}</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {lignesDeDecision.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-[1.5]">
                  <span
                    aria-hidden
                    className="mt-[3px] inline-block h-[11px] w-[11px] shrink-0 border border-foreground bg-foreground"
                  />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
