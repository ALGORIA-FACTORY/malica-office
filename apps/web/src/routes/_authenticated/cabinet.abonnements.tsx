/**
 * Abonnements — la comptabilité revendeur (règles du 20 octobre 2026).
 *
 * ============================================================== POURQUOI
 *
 * Campagne de validation du 21 octobre 2026, ANO-011 : la base et l'API
 * savaient attribuer un abonnement à un client, le lui faire accepter et
 * facturer le cabinet chaque mois — aucun écran ne le permettait.
 *
 * Trois blocs, dans l'ordre où l'expert en a besoin :
 *   1. proposer une offre à un dossier sous mandat, au prix public du jour
 *      (`offresDuCabinet`) — la société accepte ou refuse dans ses réglages ;
 *   2. ce que le cabinet propose ou couvre, et où en est chaque dossier ;
 *   3. ses factures mensuelles, une ligne par société cliente.
 *
 * Proposer est l'affaire de l'expert : la base refuse tout autre rôle, et
 * l'écran ne propose le formulaire qu'à lui. Le paiement des factures se fait
 * depuis la facture (web et PWA seulement), pas d'ici.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Users } from "lucide-react";

import { COMMERCE } from "@/capabilities/coque";
import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionTitle,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { ETAT_DE_FACTURE } from "@/lib/paiement";
import { cn } from "@/lib/utils";
import { initialesDe } from "@/lib/initiales";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/abonnements")({
  head: () => ({
    meta: [
      { title: "Abonnements des clients — Malica Office" },
      {
        name: "description",
        content:
          "Les abonnements que le cabinet attribue à ses clients, leur état et ses factures mensuelles.",
      },
      { property: "og:title", content: "Abonnements des clients — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Proposer un abonnement, c'est vendre : pas dans l'application Android
  // (`COMMERCE`). La page n'entre pas dans son paquet, et une adresse tapée
  // ramène au cabinet.
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/cabinet" });
  },
  component: COMMERCE ? CabinetAbonnements : () => null,
});

const OU = "routes/_authenticated/cabinet.abonnements";

const STATUT: Record<string, MessageKey> = {
  propose: "cab.abo.statut.propose",
  actif: "cab.abo.statut.actif",
  suspendu: "cab.abo.statut.suspendu",
  termine: "cab.abo.statut.termine",
};
const TON: Record<string, string> = {
  propose: "text-marigold",
  actif: "text-signal-ok",
  suspendu: "text-signal-warn",
  termine: "text-muted-foreground",
};

function CabinetAbonnements() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  useMalicaPanel(<MalicaNote>{t("cab.abo.panel")}</MalicaNote>, [locale]);

  const acces = useQuery({
    queryKey: ["cab-acces", org.id],
    queryFn: () => office().acces.monAcces(org.id),
  });
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const offres = useQuery({
    queryKey: ["cab-abo-offres"],
    queryFn: () => office().facturation.offresDuCabinet(),
  });
  const attribues = useQuery({
    queryKey: ["cab-abo-attribues", org.id],
    queryFn: () => office().facturation.abonnementsDuCabinet(org.id),
  });
  const factures = useQuery({
    queryKey: ["cab-abo-factures", org.id],
    queryFn: () => office().facturation.facturesDuCabinet(org.id),
  });

  const expert = acces.data?.role === "expert";
  // Les rôles qui engagent le cabinet, ceux que `facturation.peut_payer` admet.
  const peutPayer = expert || acces.data?.role === "dirigeant";
  const [refusDePaiement, setRefusDePaiement] = useState<string | null>(null);
  const navigate = useNavigate();
  // La facture du cabinet se paie en ligne (23 octobre 2026) : le reste dû, en
  // entier, depuis la page de choix du moyen, qui vérifie aussi le retour.
  const payerFacture = useMutation({
    mutationFn: (factureId: string) => office().facturation.payerFacture(factureId),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["mes-paiements"] });
      await navigate({ to: "/cabinet/payer/$paiementId", params: { paiementId: p.paiement_id } });
    },
    onError: (e: unknown) => setRefusDePaiement(texteDeLErreur(e, OU, t("common.error"))),
  });
  const actifs = (clients.data ?? []).filter((c) => c.engagementStatus === "actif");
  const [vue, setVue] = useState<"clients" | "factures">("clients");
  const [formulaire, setFormulaire] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [statut, setStatut] = useState<string | null>(null);
  const [client, setClient] = useState("");
  const [offre, setOffre] = useState("");
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  const proposer = useMutation({
    mutationFn: () => office().facturation.proposerAbonnement(org.id, client, offre),
    onSuccess: async () => {
      const nom = actifs.find((c) => c.tenantId === client)?.name ?? "";
      setRetour({ ok: true, texte: t("cab.abo.propose.ok", { client: nom }) });
      setClient("");
      await qc.invalidateQueries({ queryKey: ["cab-abo-attribues", org.id] });
    },
    onError: (e: unknown) =>
      setRetour({ ok: false, texte: texteDeLErreur(e, OU, t("common.error")) }),
  });

  const libelleOffre = (code: string) =>
    (offres.data ?? []).find((o) => o.code === code)?.libelle ?? code;
  const montant = (v: string, devise = org.currency) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: devise,
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(Number(v));
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
          new Date(`${iso.slice(0, 10)}T12:00:00`),
        )
      : "—";

  const lignes = attribues.data ?? [];
  const couverts = lignes.filter((a) => a.statut === "actif").length;
  const enAttente = lignes.filter((a) => a.statut === "propose").length;
  const derniere =
    [...(factures.data ?? [])].sort((a, b) => b.periode.localeCompare(a.periode))[0] ?? null;
  const visibles = lignes.filter(
    (a) =>
      (!statut || a.statut === statut) &&
      a.client_nom.toLocaleLowerCase(locale).includes(recherche.toLocaleLowerCase(locale)),
  );

  return (
    <div className="cab-library space-y-6">
      <header className="cab-library-header">
        <div>
          <p className="cab-eyebrow">{org.name}</p>
          <h1>{t("cab.abo.title")}</h1>
        </div>
        {expert ? (
          <button
            type="button"
            className="cab-button cab-button-primary"
            aria-expanded={formulaire}
            aria-controls="cab-abonnement-formulaire"
            onClick={() => setFormulaire(!formulaire)}
          >
            <span aria-hidden>{formulaire ? "−" : "+"}</span>
            {t("cab.abo.propose.titre")}
          </button>
        ) : null}
      </header>

      <div
        className="cab-summary-grid"
        data-empty={
          attribues.isSuccess && lignes.length === 0 && factures.data?.length === 0 ? "" : undefined
        }
      >
        {[
          {
            key: "actif",
            label: t("cab.abo.kpi.couverts"),
            value: attribues.isPending || attribues.isError ? "—" : String(couverts),
            tone: "green",
            symbol: "↗",
          },
          {
            key: "propose",
            label: t("cab.abo.kpi.attente"),
            value: attribues.isPending || attribues.isError ? "—" : String(enAttente),
            tone: "violet",
            symbol: "◷",
          },
          {
            key: "factures",
            label: t("cab.abo.kpi.derniere"),
            value: derniere ? montant(derniere.montant_ttc, derniere.devise) : "—",
            tone: "peach",
            symbol: "↗",
          },
        ].map((k) => (
          <button
            key={k.key}
            type="button"
            className="cab-summary-card"
            data-color={k.tone}
            aria-pressed={
              k.key === "factures" ? vue === "factures" : vue === "clients" && statut === k.key
            }
            onClick={() => {
              setVue(k.key === "factures" ? "factures" : "clients");
              setStatut(statut === k.key ? null : k.key);
            }}
          >
            <span className="cab-summary-label">{k.label}</span>
            <strong className="cab-summary-value num">{k.value}</strong>
            <span className="cab-summary-symbol" aria-hidden>
              {k.symbol}
            </span>
          </button>
        ))}
      </div>

      {/* 1. Proposer — à l'expert seul */}
      {expert && formulaire ? (
        <section id="cab-abonnement-formulaire" className="cab-surface space-y-3">
          <div className="space-y-3">
            <SectionTitle>{t("cab.abo.propose.titre")}</SectionTitle>
            <p className="max-w-[70ch] text-[12.5px] leading-[1.55] text-muted-foreground">
              {t("cab.abo.propose.regle")}
            </p>
            {clients.isPending || offres.isPending ? (
              <p role="status">{t("common.loading")}</p>
            ) : clients.isError || offres.isError ? (
              <p role="alert" className="text-signal-stop">
                {texteDeLErreur(clients.error ?? offres.error, OU, t("common.error"))}
              </p>
            ) : actifs.length === 0 ? (
              <EmptyState>{t("cab.abo.propose.aucunClient")}</EmptyState>
            ) : (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRetour(null);
                  proposer.mutate();
                }}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t("cab.abo.propose.client")}
                  </span>
                  <select
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    required
                    className="min-w-[16rem] border border-border bg-card px-2.5 py-1.5 text-[12.5px]"
                  >
                    <option value="">{t("cab.abo.propose.choisir")}</option>
                    {actifs.map((c) => (
                      <option key={c.tenantId} value={c.tenantId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t("cab.abo.propose.offre")}
                  </legend>
                  {(offres.data ?? []).map((o) => (
                    <label
                      key={o.code}
                      className={cn(
                        "cursor-pointer border px-3 py-2 text-[12px]",
                        offre === o.code
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card hover:bg-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name="offre"
                        value={o.code}
                        checked={offre === o.code}
                        onChange={() => setOffre(o.code)}
                        className="sr-only"
                      />
                      <span className="block font-semibold">{o.libelle}</span>
                      <span className="num block text-[10.5px] opacity-80">
                        {t("cab.abo.propose.prix", { prix: montant(o.prix_mensuel_ht) })}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button
                  type="submit"
                  disabled={!client || !offre || proposer.isPending}
                  className="h-9 bg-foreground px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
                >
                  {proposer.isPending ? t("common.loading") : t("cab.abo.propose.bouton")}
                </button>
              </form>
            )}
            {retour ? (
              <p
                role={retour.ok ? "status" : "alert"}
                className={cn("text-[12.5px]", retour.ok ? "text-signal-ok" : "text-signal-stop")}
              >
                {retour.texte}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="cab-library-toolbar">
        <nav className="cab-view-switch" aria-label={t("cab.abo.title")}>
          <button
            type="button"
            aria-pressed={vue === "clients"}
            onClick={() => {
              setVue("clients");
              setStatut(null);
            }}
          >
            {t("cab.abo.liste.titre")}
          </button>
          <button
            type="button"
            aria-pressed={vue === "factures"}
            onClick={() => setVue("factures")}
          >
            {t("cab.abo.factures.titre")}
          </button>
        </nav>
        {vue === "clients" ? (
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            aria-label={t("cab.abo.col.client")}
            placeholder={t("cab.abo.col.client")}
            className="cab-library-search"
          />
        ) : null}
      </div>

      {/* 2. Ce que le cabinet propose ou couvre */}
      {vue === "clients" ? (
        <section className="space-y-3">
          <SectionTitle
            action={
              <span className="num text-[11px] text-muted-foreground">
                {t("cab.abo.liste.count", { count: lignes.length })}
              </span>
            }
          >
            {t("cab.abo.liste.titre")}
          </SectionTitle>
          {attribues.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : attribues.error ? (
            <p role="alert" className="text-[12.5px] text-signal-stop">
              {texteDeLErreur(attribues.error, OU, t("common.error"))}
            </p>
          ) : lignes.length === 0 ? (
            <div className="cab-start-panel">
              <span className="cab-start-icon" aria-hidden>
                <Users size={30} strokeWidth={1.6} />
              </span>
              <h3>{t("cab.abo.liste.vide")}</h3>
              {clients.isPending ? (
                <p role="status">{t("common.loading")}</p>
              ) : clients.isError ? (
                <p role="alert">{texteDeLErreur(clients.error, OU, t("common.error"))}</p>
              ) : actifs.length === 0 ? (
                <>
                  <p>{t("cab.abo.propose.aucunClient")}</p>
                  <Link to="/cabinet/clients" className="cab-button cab-button-primary">
                    {t("cab.nav.clients")}
                  </Link>
                </>
              ) : expert ? (
                <button
                  type="button"
                  className="cab-button cab-button-primary"
                  onClick={() => setFormulaire(true)}
                >
                  {t("cab.abo.propose.titre")}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {statut ? (
                <button type="button" className="cab-filter-chip" onClick={() => setStatut(null)}>
                  {STATUT[statut] ? t(STATUT[statut]!) : statut} <span aria-hidden>×</span>
                </button>
              ) : null}
              <ul className="cab-client-grid">
                {visibles.map((a) => (
                  <li key={a.acces_id} className="cab-client-tile">
                    <div className="cab-client-cover" data-status={a.statut}>
                      <span className="cab-client-monogram" aria-hidden>
                        {initialesDe(a.client_nom)}
                      </span>
                      <span className={cn("cab-plan-badge", TON[a.statut] ?? "")}>
                        {STATUT[a.statut] ? t(STATUT[a.statut]!) : a.statut}
                      </span>
                    </div>
                    <Link
                      to="/cabinet/dossier/$clientId"
                      params={{ clientId: a.client_tenant_id }}
                      className="cab-client-title"
                    >
                      {a.client_nom}
                    </Link>
                    <p className="cab-client-plan">{libelleOffre(a.offre_code)}</p>
                    <dl className="cab-client-dates">
                      <div>
                        <dt>{t("cab.abo.col.propose")}</dt>
                        <dd>{date(a.propose_le)}</dd>
                      </div>
                      <div>
                        <dt>{t("cab.abo.col.effet")}</dt>
                        <dd>
                          {date(a.effet_du)}
                          {a.effet_au ? ` → ${date(a.effet_au)}` : ""}
                        </dd>
                      </div>
                    </dl>
                    {a.client_legal_id ? (
                      <p className="cab-client-legal num">{a.client_legal_id}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {visibles.length === 0 ? (
                <EmptyState>{t("cab.abo.liste.count", { count: 0 })}</EmptyState>
              ) : null}
            </>
          )}
        </section>
      ) : (
        /* Les factures restent dans une vue dédiée. */
        <section className="space-y-3">
          <SectionTitle>{t("cab.abo.factures.titre")}</SectionTitle>
          {refusDePaiement ? (
            <p role="alert" className="text-[12.5px] text-signal-stop">
              {refusDePaiement}
            </p>
          ) : null}
          {factures.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : factures.isError ? (
            <p role="alert" className="text-signal-stop">
              {texteDeLErreur(factures.error, OU, t("common.error"))}
            </p>
          ) : (factures.data ?? []).length === 0 ? (
            <EmptyState>{t("cab.abo.factures.vide")}</EmptyState>
          ) : (
            <InkTable
              caption={t("cab.abo.factures.titre")}
              head={[
                t("cab.abo.fac.numero"),
                t("cab.abo.fac.periode"),
                t("cab.abo.fac.societes"),
                t("cab.abo.fac.ttc"),
                t("cab.abo.fac.echeance"),
                t("cab.abo.fac.statut"),
                t("cab.abo.fac.reste"),
              ]}
            >
              {(factures.data ?? []).map((f) => (
                <InkTableRow key={f.id}>
                  <InkCell>
                    <span className="num font-medium">{f.numero}</span>
                  </InkCell>
                  <InkCell>
                    <span className="num">{f.periode.slice(0, 7)}</span>
                  </InkCell>
                  <InkCell numeric>{f.organisations}</InkCell>
                  <InkCell numeric>{montant(f.montant_ttc, f.devise)}</InkCell>
                  <InkCell>
                    <span className="num">{date(f.echeance_le)}</span>
                  </InkCell>
                  <InkCell>
                    <span
                      className={cn(
                        "text-[12px]",
                        f.etat === "en_retard" && "text-signal-warn",
                        f.etat === "payee" && "text-signal-ok",
                      )}
                    >
                      {t(ETAT_DE_FACTURE[f.etat])}
                    </span>
                  </InkCell>
                  <InkCell numeric>
                    {Number(f.reste_du) > 0 &&
                    (f.etat === "a_echoir" || f.etat === "en_retard" || f.etat === "partielle") ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="num">{montant(f.reste_du, f.devise)}</span>
                        {peutPayer ? (
                          <button
                            type="button"
                            className="rounded-md border border-foreground px-2.5 py-1 text-[12px] font-medium hover:bg-foreground hover:text-background disabled:opacity-40"
                            disabled={payerFacture.isPending}
                            onClick={() => payerFacture.mutate(f.id)}
                          >
                            {t("pme.reglages.paiement.payer")}
                          </button>
                        ) : null}
                      </span>
                    ) : (
                      <span className="num text-muted-foreground">—</span>
                    )}
                  </InkCell>
                </InkTableRow>
              ))}
            </InkTable>
          )}
        </section>
      )}
    </div>
  );
}
