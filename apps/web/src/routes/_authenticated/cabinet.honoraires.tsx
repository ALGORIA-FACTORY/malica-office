/**
 * Les honoraires du cabinet — facturation, trésorerie, mandats.
 *
 * ============================================================== POURQUOI
 *
 * Ce que chaque mandat doit produire, ce qui est facturé, ce qui est encaissé.
 * Un montant n'est jamais deviné : il vient du barème du mandat ou de la
 * facture émise, et toute somme est faite en base. L'écran lit, filtre,
 * compare des dates ; il n'additionne rien.
 *
 * Trois onglets, un seul état de mois : la facturation du mois, la trésorerie
 * (retards, à échoir, encaissements), et les mandats — mode, fréquence, jour,
 * forfait, taux, délai, couverture. Un mandat ne se corrige pas : on le clôt
 * et on en ouvre un autre, daté.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { Chip, EmptyState, MalicaNote, SectionTitle } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { finDuMois } from "@malica/socle/exercice";
import { montant } from "@/lib/lisible";
import { sommeDecimale } from "@malica/socle/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  FactureHonoraires,
  LigneHonorairesSaisie,
  MandatHonoraires,
} from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/honoraires")({
  head: () => ({
    meta: [
      { title: "Honoraires et mandats — Malica Office" },
      {
        name: "description",
        content:
          "Facturation, trésorerie et mandats d'honoraires du cabinet : chaque montant vient du mandat ou de la facture émise.",
      },
      { property: "og:title", content: "Honoraires et mandats — Malica Office" },
      {
        property: "og:description",
        content:
          "Facturation, trésorerie et mandats d'honoraires du cabinet : chaque montant vient du mandat ou de la facture émise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetHonoraires,
});

const JOUR_MS = 86_400_000;
type Onglet = "facturation" | "tresorerie" | "mandats";
const ONGLETS: Array<{ id: Onglet; cle: MessageKey }> = [
  { id: "facturation", cle: "cab.hono.tab.facturation" },
  { id: "tresorerie", cle: "cab.hono.tab.tresorerie" },
  { id: "mandats", cle: "cab.hono.tab.mandats" },
];
const MODES: Record<string, { cle: MessageKey; hint: MessageKey }> = {
  forfait: { cle: "cab.hono.mode.forfait", hint: "cab.hono.mode.forfait.hint" },
  temps: { cle: "cab.hono.mode.temps", hint: "cab.hono.mode.temps.hint" },
  mixte: { cle: "cab.hono.mode.mixte", hint: "cab.hono.mode.mixte.hint" },
};
const FREQUENCES: Record<string, MessageKey> = {
  mensuelle: "cab.hono.freq.mensuelle",
  trimestrielle: "cab.hono.freq.trimestrielle",
  annuelle: "cab.hono.freq.annuelle",
};
const STATUTS: Record<string, MessageKey> = {
  brouillon: "cab.hono.statut.brouillon",
  emise: "cab.hono.statut.emise",
  payee: "cab.hono.statut.payee",
  annulee: "cab.hono.statut.annulee",
};
const MOYENS: Record<string, MessageKey> = {
  virement: "cab.hono.moyen.virement",
  cheque: "cab.hono.moyen.cheque",
  especes: "cab.hono.moyen.especes",
  carte: "cab.hono.moyen.carte",
  autre: "cab.hono.moyen.autre",
};
const CHAMP =
  "border border-border bg-card px-2.5 py-1.5 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const CHAMP_NUM = cn(CHAMP, "num text-end");
const BOUTON_ENCRE =
  "border border-foreground bg-foreground px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:border-marigold hover:text-foreground disabled:opacity-40";
const BOUTON_PIERRE =
  "border border-border bg-card px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-40";

/** Émise, non soldée, échue — un avoir n'attend aucun règlement : il n'est jamais en retard. */
function enRetard(f: FactureHonoraires, today: string): boolean {
  return f.statut === "emise" && !f.avoirDe && f.echeanceLe !== null && f.echeanceLe < today;
}

function tonDuStatut(f: FactureHonoraires, today: string): string {
  if (f.statut === "payee") return "bg-signal-ok";
  if (f.statut === "annulee") return "bg-muted-foreground";
  if (f.statut === "brouillon") return "bg-foreground";
  return enRetard(f, today) ? "bg-signal-stop" : "bg-marigold";
}

function CabinetHonoraires() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const today = new Date().toISOString().slice(0, 10);
  const [mois, setMois] = useState(today.slice(0, 7));
  const [onglet, setOnglet] = useState<Onglet>("facturation");

  const synthese = useQuery({
    queryKey: ["cab-hono-synthese", org.id, mois],
    queryFn: () => office().honoraires.synthese(org.id, mois),
  });

  useMalicaPanel(<MalicaNote>{t("cab.hono.panel")}</MalicaNote>, [locale]);

  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  const moisLong = (ym: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${ym}-01T00:00:00Z`),
    );
  const jours = (iso: string) =>
    Math.round(
      (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / JOUR_MS,
    );
  const compteADate = (iso: string) => {
    const d = jours(iso);
    if (d === 0) return t("cab.echeances.jour");
    return d < 0 ? t("cab.echeances.jplus", { days: -d }) : t("cab.echeances.jmoins", { days: d });
  };
  const somme = (valeur: string, devise: string) => `${montant(valeur, locale)} ${devise}`;

  const s = synthese.data;
  const devise = s?.devise || org.currency;
  const kpis = [
    {
      key: "facture",
      label: t("cab.hono.kpi.facture"),
      value: s ? montant(s.factureHt, locale) : "—",
      context: s ? t("cab.hono.kpi.facture.ctx", { count: s.nbFactures, devise }) : "",
      tone: "",
    },
    {
      key: "encaisse",
      label: t("cab.hono.kpi.encaisse"),
      value: s ? montant(s.encaisse, locale) : "—",
      context: s ? t("cab.hono.kpi.encaisse.ctx", { count: s.nbEncaissements, devise }) : "",
      tone: "text-signal-ok",
    },
    {
      key: "reste",
      label: t("cab.hono.kpi.reste"),
      value: s ? montant(s.resteDu, locale) : "—",
      context: s ? t("cab.hono.kpi.reste.ctx", { count: s.nbOuvertes, devise }) : "",
      tone: "text-marigold",
    },
    {
      key: "retard",
      label: t("cab.hono.kpi.retard"),
      value: s ? montant(s.enRetard, locale) : "—",
      context: s ? t("cab.hono.kpi.retard.ctx", { count: s.nbRetard, devise }) : "",
      tone: s && s.nbRetard > 0 ? "text-signal-stop" : "",
    },
  ];

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="border-b border-foreground pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {t("cab.hono.kicker", { cabinet: org.name, exercice: mois.slice(0, 4) })}
            </p>
            <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
              {t("cab.hono.title")}
            </h1>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.55] text-text-2">
              {t("cab.hono.lede")}
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("cab.dos.mois")}
            </span>
            <input
              type="month"
              value={mois}
              onChange={(e) => e.target.value && setMois(e.target.value)}
              aria-label={t("cab.dos.mois")}
              className={cn(CHAMP, "num")}
            />
          </label>
        </div>
      </header>

      {/* ---- les chiffres du mois */}
      <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.key} className="bg-card px-4 py-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {k.label}
            </p>
            <p
              className={cn("num mt-3 text-[26px] font-medium leading-none tracking-tight", k.tone)}
            >
              {k.value}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">{k.context}</p>
          </div>
        ))}
      </div>
      {s ? (
        <p className="num -mt-4 text-[11px] text-muted-foreground">
          {s.tauxEncaissement === null
            ? t("cab.hono.taux.aucun", { mois: moisLong(mois) })
            : t("cab.hono.taux", {
                mois: moisLong(mois),
                taux: new Intl.NumberFormat(locale, {
                  style: "percent",
                  maximumFractionDigits: 1,
                }).format(Number(s.tauxEncaissement)),
              })}
        </p>
      ) : null}

      {/* ---- les onglets */}
      <nav aria-label={t("cab.hono.title")} className="flex flex-wrap gap-1 border-b border-border">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOnglet(o.id)}
            aria-current={onglet === o.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]",
              onglet === o.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(o.cle)}
          </button>
        ))}
      </nav>

      {onglet === "facturation" ? (
        <Facturation
          mois={mois}
          today={today}
          dateLongue={dateLongue}
          compteADate={compteADate}
          somme={somme}
          moisLong={moisLong}
        />
      ) : onglet === "tresorerie" ? (
        <Tresorerie
          mois={mois}
          today={today}
          dateLongue={dateLongue}
          compteADate={compteADate}
          somme={somme}
          moisLong={moisLong}
        />
      ) : (
        <Mandats dateLongue={dateLongue} compteADate={compteADate} somme={somme} />
      )}
    </div>
  );
}

interface Outils {
  mois: string;
  today: string;
  dateLongue: (iso: string) => string;
  compteADate: (iso: string) => string;
  somme: (valeur: string, devise: string) => string;
  moisLong: (ym: string) => string;
}

/* ------------------------------------------------------------ facturation */
function Facturation({ mois, today, dateLongue, compteADate, somme, moisLong }: Outils) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const [filtre, setFiltre] = useState<string>("");
  const [nouvelle, setNouvelle] = useState(false);

  const factures = useQuery({
    queryKey: ["cab-hono-factures", org.id, mois],
    queryFn: () => office().honoraires.factures(org.id, { mois }),
  });
  const rows = useMemo(() => factures.data ?? [], [factures.data]);
  const comptes = useMemo(() => {
    const c: Record<string, number> = { "": rows.length };
    for (const f of rows) c[f.statut] = (c[f.statut] ?? 0) + 1;
    return c;
  }, [rows]);
  const visibles = filtre ? rows.filter((f) => f.statut === filtre) : rows;

  return (
    <section className="space-y-3">
      <SectionTitle
        action={
          <button type="button" onClick={() => setNouvelle((v) => !v)} className={BOUTON_ENCRE}>
            {nouvelle ? t("common.cancel") : t("cab.hono.nouvelle")}
          </button>
        }
      >
        {t("cab.hono.factures.titre", { mois: moisLong(mois) })}
      </SectionTitle>

      {nouvelle ? <NouvelleFacture mois={mois} onCree={() => setNouvelle(false)} /> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {["", "brouillon", "emise", "payee", "annulee"].map((k) => (
          <Chip key={k} active={filtre === k} onClick={() => setFiltre(k)}>
            {k ? t(STATUTS[k]!) : t("cab.hono.filtre.toutes")}
            <span className="num ms-1.5 opacity-60">{comptes[k] ?? 0}</span>
          </Chip>
        ))}
      </div>

      {factures.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : visibles.length === 0 ? (
        <EmptyState>{t("cab.hono.factures.vide")}</EmptyState>
      ) : (
        <TableFactures
          rows={visibles}
          today={today}
          dateLongue={dateLongue}
          compteADate={compteADate}
          somme={somme}
        />
      )}
    </section>
  );
}

function TableFactures({
  rows,
  today,
  dateLongue,
  compteADate,
  somme,
}: {
  rows: FactureHonoraires[];
  today: string;
  dateLongue: (iso: string) => string;
  compteADate: (iso: string) => string;
  somme: (valeur: string, devise: string) => string;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="min-w-full border-collapse text-[12.5px]">
        <caption className="sr-only">{t("cab.hono.factures.caption")}</caption>
        <thead>
          <tr className="border-b border-foreground">
            {[
              t("cab.hono.col.facture"),
              t("cab.hono.col.periode"),
              t("cab.hono.col.ttc"),
              t("cab.hono.col.echeance"),
              t("cab.hono.col.etat"),
            ].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                  i === 2 || i === 3 ? "text-end" : "text-start",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id} className="border-b border-border hover:bg-secondary/60">
              <td className="whitespace-nowrap px-3 py-2">
                <Link
                  to="/cabinet/facture/$factureId"
                  params={{ factureId: f.id }}
                  className="block"
                >
                  <span className="num block text-[12.5px] text-signal-info underline underline-offset-2">
                    {f.numero ?? t("cab.hono.statut.brouillon")}
                  </span>
                  <span className="mt-0.5 block text-[13px] font-medium">{f.clientName}</span>
                </Link>
              </td>
              <td className="px-3 py-2">
                <span className="num block text-[11px] text-muted-foreground">
                  {dateLongue(f.periodeDu)} → {dateLongue(f.periodeAu)}
                </span>
                {f.avoirDe ? (
                  <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                    {t("cab.hono.avoir.de")}
                  </span>
                ) : null}
              </td>
              <td
                className={cn(
                  "num whitespace-nowrap px-3 py-2 text-end text-[13px]",
                  f.statut === "payee" || f.statut === "annulee" ? "text-muted-foreground" : "",
                )}
              >
                {somme(f.totalTtc, f.devise)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-end">
                {f.echeanceLe ? (
                  <>
                    <span className="num block text-[12px]">{dateLongue(f.echeanceLe)}</span>
                    {f.statut === "emise" && !f.avoirDe ? (
                      <span
                        className={cn(
                          "mt-0.5 block text-[10px] font-semibold tracking-[0.06em]",
                          enRetard(f, today) ? "text-signal-stop" : "text-muted-foreground",
                        )}
                      >
                        {compteADate(f.echeanceLe)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn("inline-block h-[7px] w-[7px]", tonDuStatut(f, today))}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">
                    {enRetard(f, today)
                      ? t("cab.hono.statut.retard")
                      : t(STATUTS[f.statut] ?? "cab.hono.statut.brouillon")}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un brouillon : le client, la période, le taux du pack, les lignes — rien n'est calculé ici. */
function NouvelleFacture({ mois, onCree }: { mois: string; onCree: () => void }) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  // Seul un mandat actif se facture : la base refuse les autres, autant ne pas les proposer.
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
    select: (liste) => liste.filter((c) => c.engagementStatus === "actif"),
  });
  const mandats = useQuery({
    queryKey: ["cab-hono-mandats", org.id],
    queryFn: () => office().honoraires.mandats(org.id),
  });
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  const taux = useQuery({
    queryKey: ["ref-taux", pack.data?.id, org.jurisdiction],
    queryFn: () => office().referential.taxRates(pack.data!.id, org.jurisdiction, locale),
    enabled: Boolean(pack.data),
  });
  const tauxEnVigueur = (taux.data ?? []).filter(
    (r) => r.validFrom <= today && (!r.validTo || r.validTo >= today),
  );

  const [client, setClient] = useState("");
  const [du, setDu] = useState(`${mois}-01`);
  const [au, setAu] = useState(finDuMois(mois));
  const [code, setCode] = useState("");
  const [lignes, setLignes] = useState<LigneHonorairesSaisie[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!code && tauxEnVigueur.length > 0) setCode(tauxEnVigueur[0]!.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taux.data]);

  // Le mandat du client propose sa ligne de forfait ; l'expert la garde ou non.
  const mandat = (mandats.data ?? []).find((m) => m.clientTenantId === client) ?? null;
  useEffect(() => {
    if (mandat?.forfait) {
      setLignes([
        {
          libelle:
            mandat.couverture.length > 0
              ? t("cab.hono.ligne.forfait.couvre", { couverture: mandat.couverture.join(" · ") })
              : t("cab.hono.ligne.forfait"),
          quantite: "1",
          prixUnitaire: mandat.forfait,
        },
      ]);
    } else {
      setLignes([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, mandats.data]);

  const creer = useMutation({
    mutationFn: () =>
      office().honoraires.creerBrouillon({
        cabinetTenantId: org.id,
        clientTenantId: client,
        periodeDu: du,
        periodeAu: au,
        tauxTvaCode: code,
        lignes,
      }),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ["cab-hono-factures"] });
      void qc.invalidateQueries({ queryKey: ["cab-hono-synthese"] });
      onCree();
      void navigate({ to: "/cabinet/facture/$factureId", params: { factureId: id } });
    },
    onError: (e) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.honoraires", t("common.error"))),
  });

  const modifierLigne = (i: number, patch: Partial<LigneHonorairesSaisie>) =>
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(null);
        creer.mutate();
      }}
      className="space-y-4 border border-foreground bg-card p-4"
    >
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {t("cab.hono.nouvelle.titre")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.queue.client")}</span>
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            required
            className={cn(CHAMP, "mt-1.5 w-full")}
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
          <span className={ETIQUETTE}>{t("cab.hono.periode.du")}</span>
          <input
            type="date"
            value={du}
            onChange={(e) => setDu(e.target.value)}
            required
            className={cn(CHAMP, "num mt-1.5 w-full")}
          />
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.hono.periode.au")}</span>
          <input
            type="date"
            value={au}
            onChange={(e) => setAu(e.target.value)}
            required
            className={cn(CHAMP, "num mt-1.5 w-full")}
          />
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.hono.tva")}</span>
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            className={cn(CHAMP, "mt-1.5 w-full")}
          >
            {tauxEnVigueur.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          {pack.isFetched && !pack.data ? (
            <span className="mt-1 block text-[11px] text-signal-stop">
              {t("cab.settings.packActif.absent")}
            </span>
          ) : null}
        </label>
      </div>

      <LignesEditables
        lignes={lignes}
        onChange={modifierLigne}
        onSet={setLignes}
        devise={org.currency}
      />

      {mandat ? (
        <p className="text-[11.5px] text-muted-foreground">
          {t("cab.hono.nouvelle.mandat", {
            mode: t(MODES[mandat.mode]?.cle ?? "cab.hono.mode.forfait"),
            frequence: t(FREQUENCES[mandat.frequence] ?? "cab.hono.freq.mensuelle"),
            delai: mandat.delaiPaiementJours,
          })}
        </p>
      ) : client ? (
        <p className="text-[11.5px] text-marigold">{t("cab.hono.nouvelle.sansMandat")}</p>
      ) : null}

      {erreur ? <p className="text-[12px] text-signal-stop">{erreur}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!client || !code || creer.isPending}
          className={BOUTON_ENCRE}
        >
          {t("cab.hono.nouvelle.creer")}
        </button>
        <span className="self-center text-[11px] text-muted-foreground">
          {t("cab.hono.nouvelle.note")}
        </span>
      </div>
    </form>
  );
}

const ETIQUETTE =
  "block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";

/** Les lignes d'un brouillon, telles que l'expert les saisit. Les totaux viennent de la base. */
export function LignesEditables({
  lignes,
  onChange,
  onSet,
  devise,
  totaux,
}: {
  lignes: LigneHonorairesSaisie[];
  onChange: (i: number, patch: Partial<LigneHonorairesSaisie>) => void;
  onSet: (lignes: LigneHonorairesSaisie[]) => void;
  devise: string;
  /** Les montants HT calculés en base, par ligne, quand ils existent. */
  totaux?: string[] | undefined;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="overflow-x-auto border border-border">
      <table className="min-w-full border-collapse text-[12.5px]">
        <caption className="sr-only">{t("cab.hono.lignes.caption")}</caption>
        <thead>
          <tr className="border-b border-border">
            {[
              t("cab.hono.col.prestation"),
              t("cab.hono.col.quantite"),
              t("cab.hono.col.pu"),
              t("cab.hono.col.ht"),
              "",
            ].map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                  i === 0 ? "text-start" : "text-end",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-border">
              <td className="px-3 py-1.5">
                <input
                  value={l.libelle}
                  onChange={(e) => onChange(i, { libelle: e.target.value })}
                  aria-label={t("cab.hono.col.prestation")}
                  className={cn(CHAMP, "w-full min-w-[220px]")}
                />
              </td>
              <td className="px-3 py-1.5">
                <input
                  type="number"
                  step="0.001"
                  value={l.quantite}
                  onChange={(e) => onChange(i, { quantite: e.target.value })}
                  aria-label={t("cab.hono.col.quantite")}
                  className={cn(CHAMP_NUM, "w-[90px]")}
                />
              </td>
              <td className="px-3 py-1.5">
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={l.prixUnitaire}
                  onChange={(e) => onChange(i, { prixUnitaire: e.target.value })}
                  aria-label={t("cab.hono.col.pu")}
                  className={cn(CHAMP_NUM, "w-[130px]")}
                />
              </td>
              <td className="num whitespace-nowrap px-3 py-1.5 text-end">
                {totaux?.[i] !== undefined ? `${montant(totaux[i]!, locale)} ${devise}` : "—"}
              </td>
              <td className="px-3 py-1.5 text-end">
                <button
                  type="button"
                  onClick={() => onSet(lignes.filter((_, j) => j !== i))}
                  aria-label={t("cab.hono.ligne.retirer")}
                  title={t("cab.hono.ligne.retirer")}
                  className="h-6 w-6 border border-border text-[13px] leading-none text-muted-foreground hover:border-signal-stop hover:text-signal-stop"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          {lignes.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-3 text-[12px] text-muted-foreground">
                {t("cab.hono.lignes.vide")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="border-t border-border bg-background px-3 py-2">
        <button
          type="button"
          onClick={() => onSet([...lignes, { libelle: "", quantite: "1", prixUnitaire: "" }])}
          className="border border-dashed border-border px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          + {t("cab.hono.ligne.ajouter")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ trésorerie */
function Tresorerie({ mois, today, dateLongue, compteADate, somme, moisLong }: Outils) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const emises = useQuery({
    queryKey: ["cab-hono-factures", org.id, "emise"],
    queryFn: () => office().honoraires.factures(org.id, { statut: "emise" }),
  });
  const encaissements = useQuery({
    queryKey: ["cab-hono-encaissements", org.id, mois],
    queryFn: () => office().honoraires.encaissements(org.id, mois),
  });
  const ouvertes = (emises.data ?? []).filter((f) => !f.avoirDe);
  const retards = ouvertes.filter((f) => f.echeanceLe !== null && f.echeanceLe < today);
  const aEchoir = ouvertes.filter((f) => f.echeanceLe === null || f.echeanceLe >= today);
  const reste = (f: FactureHonoraires) => sommeDecimale([f.totalTtc, `-${f.encaisse}`]);

  // Une fonction de rendu, pas un composant : définie dans le rendu, elle
  // serait remontée à chaque passage.
  const liste = (titre: string, rows: FactureHonoraires[], vide: string) => (
    <section className="space-y-3">
      <SectionTitle
        action={<span className="num text-[10.5px] text-muted-foreground">{rows.length}</span>}
      >
        {titre}
      </SectionTitle>
      {emises.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState>{vide}</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="min-w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-foreground">
                {[
                  t("cab.hono.col.facture"),
                  t("cab.hono.col.ttc"),
                  t("cab.hono.col.encaisse"),
                  t("cab.hono.col.reste"),
                  t("cab.hono.col.echeance"),
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                      i === 0 ? "text-start" : "text-end",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-border hover:bg-secondary/60">
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      to="/cabinet/facture/$factureId"
                      params={{ factureId: f.id }}
                      className="block"
                    >
                      <span className="num block text-[12.5px] text-signal-info underline underline-offset-2">
                        {f.numero}
                      </span>
                      <span className="mt-0.5 block text-[13px] font-medium">{f.clientName}</span>
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-end">
                    {somme(f.totalTtc, f.devise)}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-end text-signal-ok">
                    {somme(f.encaisse, f.devise)}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-end font-medium">
                    {somme(reste(f), f.devise)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-end">
                    {f.echeanceLe ? (
                      <>
                        <span className="num block text-[12px]">{dateLongue(f.echeanceLe)}</span>
                        <span
                          className={cn(
                            "mt-0.5 block text-[10px] font-semibold tracking-[0.06em]",
                            f.echeanceLe < today ? "text-signal-stop" : "text-muted-foreground",
                          )}
                        >
                          {compteADate(f.echeanceLe)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      {liste(t("cab.hono.retards.titre"), retards, t("cab.hono.retards.vide"))}
      {liste(t("cab.hono.aEchoir.titre"), aEchoir, t("cab.hono.aEchoir.vide"))}

      <section className="space-y-3">
        <SectionTitle
          action={
            <span className="num text-[10.5px] text-muted-foreground">
              {(encaissements.data ?? []).length}
            </span>
          }
        >
          {t("cab.hono.encaissements.titre", { mois: moisLong(mois) })}
        </SectionTitle>
        {encaissements.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (encaissements.data ?? []).length === 0 ? (
          <EmptyState>{t("cab.hono.encaissements.vide")}</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-border bg-card">
            <table className="min-w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-foreground">
                  {[
                    t("cab.hono.col.date"),
                    t("cab.hono.col.facture"),
                    t("cab.hono.col.moyen"),
                    t("cab.hono.col.montant"),
                  ].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                        i === 3 ? "text-end" : "text-start",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(encaissements.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-border">
                    <td className="num whitespace-nowrap px-3 py-2">{dateLongue(e.encaisseLe)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        to="/cabinet/facture/$factureId"
                        params={{ factureId: e.factureId }}
                        className="hover:underline"
                      >
                        <span className="num text-signal-info">{e.numero}</span> · {e.clientName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {t(MOYENS[e.moyen] ?? "cab.hono.moyen.autre")}
                      {e.reference ? (
                        <span className="num ms-2 text-[11px] text-muted-foreground">
                          {e.reference}
                        </span>
                      ) : null}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2 text-end text-signal-ok">
                      {somme(e.montant, org.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ mandats */
function Mandats({
  dateLongue,
  compteADate,
  somme,
}: Pick<Outils, "dateLongue" | "compteADate" | "somme">) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const [client, setClient] = useState("");

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const mandats = useQuery({
    queryKey: ["cab-hono-mandats", org.id],
    queryFn: () => office().honoraires.mandats(org.id),
  });
  const parClient = useMemo(() => {
    const m = new Map<string, MandatHonoraires>();
    for (const x of mandats.data ?? []) m.set(x.clientTenantId, x);
    return m;
  }, [mandats.data]);

  useEffect(() => {
    if (!client && (clients.data ?? []).length > 0) setClient(clients.data![0]!.tenantId);
  }, [clients.data, client]);

  const choisi = (clients.data ?? []).find((c) => c.tenantId === client) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
      <aside className="min-w-0">
        <SectionTitle
          action={
            <span className="num text-[10.5px] text-muted-foreground">
              {t("cab.hono.mandats.compte", {
                count: (mandats.data ?? []).length,
                total: (clients.data ?? []).length,
              })}
            </span>
          }
        >
          {t("cab.hono.mandats.titre")}
        </SectionTitle>
        {clients.isPending ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (clients.data ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState>{t("cab.clients.empty")}</EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-px border border-border bg-border">
            {(clients.data ?? []).map((c) => {
              const m = parClient.get(c.tenantId);
              const actif = c.tenantId === client;
              return (
                <li key={c.tenantId} className="relative bg-card">
                  <button
                    type="button"
                    onClick={() => setClient(c.tenantId)}
                    aria-current={actif ? "true" : undefined}
                    className="block w-full px-4 py-3 text-start hover:bg-secondary/60"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 start-0 w-[2px]",
                        actif ? "bg-foreground" : "bg-transparent",
                      )}
                    />
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn("text-[13.5px]", actif ? "font-semibold" : "font-medium")}
                      >
                        {c.name}
                      </span>
                      <span className="num whitespace-nowrap text-[12px]">
                        {m?.forfait
                          ? somme(m.forfait, org.currency)
                          : m?.tauxHoraire
                            ? t("cab.hono.temps.unite", {
                                montant: somme(m.tauxHoraire, org.currency),
                              })
                            : "—"}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {m
                          ? t(MODES[m.mode]?.cle ?? "cab.hono.mode.forfait")
                          : t("cab.hono.mandat.aucun")}
                      </span>
                      <span className="num text-[10px] text-muted-foreground">
                        {m ? t(FREQUENCES[m.frequence] ?? "cab.hono.freq.mensuelle") : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {choisi ? (
        <FormulaireMandat
          key={choisi.tenantId}
          clientTenantId={choisi.tenantId}
          clientName={choisi.name}
          mandat={parClient.get(choisi.tenantId) ?? null}
          dateLongue={dateLongue}
          compteADate={compteADate}
          somme={somme}
        />
      ) : null}
    </div>
  );
}

function FormulaireMandat({
  clientTenantId,
  clientName,
  mandat,
  dateLongue,
  compteADate,
  somme,
}: {
  clientTenantId: string;
  clientName: string;
  mandat: MandatHonoraires | null;
  dateLongue: (iso: string) => string;
  compteADate: (iso: string) => string;
  somme: (valeur: string, devise: string) => string;
}) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [mode, setMode] = useState(mandat?.mode ?? "forfait");
  const [frequence, setFrequence] = useState(mandat?.frequence ?? "mensuelle");
  const [jour, setJour] = useState(String(mandat?.jourFacturation ?? 1));
  const [forfait, setForfait] = useState(mandat?.forfait ?? "");
  const [tauxHoraire, setTauxHoraire] = useState(mandat?.tauxHoraire ?? "");
  const [delai, setDelai] = useState(mandat ? String(mandat.delaiPaiementJours) : "");
  const [couverture, setCouverture] = useState<string[]>(mandat?.couverture ?? []);
  const [nouvelle, setNouvelle] = useState("");
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ["cab-hono-mandats"] });
  };
  const definir = useMutation({
    mutationFn: () =>
      office().honoraires.definirMandat({
        cabinetTenantId: org.id,
        clientTenantId,
        mode,
        frequence,
        jourFacturation: Number(jour),
        forfait: mode === "temps" ? null : forfait || null,
        tauxHoraire: mode === "forfait" ? null : tauxHoraire || null,
        delaiPaiementJours: Number(delai),
        // La couverture dit ce que le forfait couvre : sans forfait, elle ne dit rien.
        couverture: mode === "temps" ? [] : couverture,
      }),
    onSuccess: () => {
      setEnregistre(true);
      rafraichir();
    },
    onError: (e) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.honoraires", t("common.error"))),
  });
  const clore = useMutation({
    mutationFn: () => office().honoraires.cloreMandat(mandat!.id),
    onSuccess: () => {
      setConfirmer(false);
      rafraichir();
    },
    onError: (e) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.honoraires", t("common.error"))),
  });

  const avecForfait = mode === "forfait" || mode === "mixte";
  const avecTaux = mode === "temps" || mode === "mixte";
  const ajouterCouverture = () => {
    const v = nouvelle.trim();
    if (v && !couverture.includes(v)) setCouverture([...couverture, v]);
    setNouvelle("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(null);
        setEnregistre(false);
        definir.mutate();
      }}
      className="min-w-0 space-y-4"
    >
      <div className="border border-foreground bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-[21px] font-semibold leading-tight tracking-[-0.02em]">
              {clientName}
            </h2>
            <p className="num mt-1.5 text-[11px] text-muted-foreground">
              {mandat
                ? t("cab.hono.mandat.depuis", { date: dateLongue(mandat.validFrom) })
                : t("cab.hono.mandat.aucun.lede")}
              {mandat?.prochaine
                ? ` · ${t("cab.hono.mandat.prochaine", { date: dateLongue(mandat.prochaine) })} (${compteADate(mandat.prochaine)})`
                : ""}
            </p>
          </div>
          {mandat ? (
            <button
              type="button"
              onClick={() => setConfirmer(true)}
              className="border border-border bg-card px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:border-signal-stop hover:text-signal-stop"
            >
              {t("cab.hono.mandat.resilier")}
            </button>
          ) : null}
        </div>

        {confirmer && mandat ? (
          <div className="border-b border-border border-s-2 border-s-signal-stop bg-signal-soft p-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-signal-stop">
              {t("cab.hono.mandat.resilier")}
            </p>
            <p className="mt-2 max-w-[64ch] text-[13px] leading-[1.6] text-text-2">
              {t("cab.hono.mandat.resilier.lede")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={clore.isPending}
                onClick={() => clore.mutate()}
                className="border border-signal-stop bg-signal-stop px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
              >
                {t("cab.hono.mandat.resilier.confirmer", { client: clientName })}
              </button>
              <button type="button" onClick={() => setConfirmer(false)} className={BOUTON_PIERRE}>
                {t("cab.hono.mandat.garder")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="p-4">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.hono.mode")}
          </p>
          <div className="mt-3 grid gap-px border border-border bg-border sm:grid-cols-3">
            {Object.entries(MODES).map(([code, m]) => {
              const on = mode === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setMode(code)}
                  aria-pressed={on}
                  className={cn(
                    "p-4 text-start",
                    on ? "bg-foreground text-background" : "bg-card hover:bg-secondary/60",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "h-[11px] w-[11px] border",
                        on ? "border-background bg-marigold" : "border-border bg-card",
                      )}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
                      {t(m.cle)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-2 block text-[11.5px] leading-[1.55]",
                      on ? "text-background/70" : "text-muted-foreground",
                    )}
                  >
                    {t(m.hint)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={ETIQUETTE}>{t("cab.hono.frequence")}</span>
              <select
                value={frequence}
                onChange={(e) => setFrequence(e.target.value)}
                className={cn(CHAMP, "mt-1.5 w-full")}
              >
                {Object.entries(FREQUENCES).map(([code, cle]) => (
                  <option key={code} value={code}>
                    {t(cle)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={ETIQUETTE}>{t("cab.hono.jour")}</span>
              <select
                value={jour}
                onChange={(e) => setJour(e.target.value)}
                className={cn(CHAMP, "num mt-1.5 w-full")}
              >
                {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((j) => (
                  <option key={j} value={j}>
                    {t("cab.hono.jour.le", { jour: j })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={ETIQUETTE}>{t("cab.hono.delai")}</span>
              <span className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  required
                  value={delai}
                  onChange={(e) => setDelai(e.target.value)}
                  aria-label={t("cab.hono.delai")}
                  className={cn(CHAMP_NUM, "w-[90px]")}
                />
                <span className="text-[11px] text-muted-foreground">
                  {t("cab.hono.delai.jours")}
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {avecForfait || avecTaux ? (
        <div className="border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.16em]">
              {avecForfait ? t("cab.hono.forfait.titre") : t("cab.hono.temps.titre")}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {avecForfait ? t("cab.hono.forfait.lede") : t("cab.hono.temps.lede")}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-5">
            {avecForfait ? (
              <label className="block">
                <span className={ETIQUETTE}>{t("cab.hono.forfait.montant")}</span>
                <span className="mt-2 flex items-baseline gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    required
                    value={forfait}
                    onChange={(e) => setForfait(e.target.value)}
                    aria-label={t("cab.hono.forfait.montant")}
                    className={cn(CHAMP_NUM, "w-[190px] text-[20px]")}
                  />
                  <span className="num text-[12px] text-muted-foreground">{org.currency}</span>
                </span>
              </label>
            ) : null}
            {avecTaux ? (
              <label className="block">
                <span className={ETIQUETTE}>{t("cab.hono.temps.taux")}</span>
                <span className="mt-2 flex items-baseline gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    required
                    value={tauxHoraire}
                    onChange={(e) => setTauxHoraire(e.target.value)}
                    aria-label={t("cab.hono.temps.taux")}
                    className={cn(CHAMP_NUM, "w-[190px] text-[20px]")}
                  />
                  <span className="num text-[12px] text-muted-foreground">
                    {t("cab.hono.temps.unite", { montant: org.currency })}
                  </span>
                </span>
              </label>
            ) : null}
            {avecForfait ? (
              <div className="min-w-0 flex-1 border-s border-border ps-5">
                <p className={ETIQUETTE}>{t("cab.hono.couverture")}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {couverture.map((c) => (
                    <li key={c}>
                      <button
                        type="button"
                        onClick={() => setCouverture(couverture.filter((x) => x !== c))}
                        title={t("cab.hono.ligne.retirer")}
                        className="inline-flex items-center gap-2 border border-foreground bg-foreground px-2.5 py-1.5 text-[11.5px] text-background"
                      >
                        <span aria-hidden className="h-2 w-2 bg-marigold" />
                        {c}
                        <span aria-hidden>×</span>
                      </button>
                    </li>
                  ))}
                  <li className="flex items-center gap-1">
                    <input
                      value={nouvelle}
                      onChange={(e) => setNouvelle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          ajouterCouverture();
                        }
                      }}
                      placeholder={t("cab.hono.couverture.ajouter")}
                      aria-label={t("cab.hono.couverture.ajouter")}
                      className={cn(CHAMP, "w-[200px]")}
                    />
                    <button type="button" onClick={ajouterCouverture} className={BOUTON_PIERRE}>
                      +
                    </button>
                  </li>
                </ul>
                <p className="mt-2 text-[11px] leading-[1.55] text-muted-foreground">
                  {t("cab.hono.couverture.note")}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border border-foreground bg-foreground p-4 text-background">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold-on-ink">
          {t("cab.hono.mandat.resume.titre", { client: clientName })}
        </p>
        <p className="mt-2 max-w-[60ch] text-[13px] leading-[1.65] text-background/70">
          {avecForfait && forfait
            ? t("cab.hono.mandat.resume.forfait", {
                montant: somme(forfait, org.currency),
                frequence: t(FREQUENCES[frequence] ?? "cab.hono.freq.mensuelle"),
                jour,
              })
            : ""}{" "}
          {avecTaux && tauxHoraire
            ? t("cab.hono.mandat.resume.temps", { montant: somme(tauxHoraire, org.currency) })
            : ""}{" "}
          {delai ? t("cab.hono.mandat.resume.delai", { count: Number(delai) }) : ""}
        </p>
        {erreur ? <p className="mt-3 text-[12px] text-marigold-on-ink">{erreur}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-background/20 pt-4">
          <button
            type="submit"
            disabled={definir.isPending}
            className="border border-background bg-background px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground hover:bg-marigold hover:border-marigold disabled:opacity-40"
          >
            {t("cab.hono.mandat.enregistrer")}
          </button>
          <span className="text-[11px] text-background/60">
            {enregistre ? t("cab.hono.mandat.enregistre") : t("cab.hono.mandat.note")}
          </span>
        </div>
      </div>
    </form>
  );
}
