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
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { COMMERCE } from "@/capabilities/coque";
import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import {
  EmptyState,
  EnTeteCabinet,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionTitle,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
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
/** Les états d'une facture d'abonnement (`facturation.factures.statut`). */
const STATUT_FACTURE: Record<string, MessageKey> = {
  emise: "cab.abo.fac.statut.emise",
  payee: "cab.abo.fac.statut.payee",
  partielle: "cab.abo.fac.statut.partielle",
  annulee: "cab.abo.fac.statut.annulee",
  irrecouvrable: "cab.abo.fac.statut.irrecouvrable",
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
  const actifs = (clients.data ?? []).filter((c) => c.engagementStatus === "actif");
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
  const derniere = (factures.data ?? [])[0] ?? null;

  return (
    <div className="space-y-8">
      <EnTeteCabinet
        surtitre={<>{t("cab.abo.kicker")}</>}
        titre={<>{t("cab.abo.title")}</>}
        chapeau={<>{t("cab.abo.lede")}</>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { key: "couverts", label: t("cab.abo.kpi.couverts"), value: String(couverts), tone: "" },
          {
            key: "attente",
            label: t("cab.abo.kpi.attente"),
            value: String(enAttente),
            tone: enAttente ? "text-marigold" : "",
          },
          {
            key: "facture",
            label: t("cab.abo.kpi.derniere"),
            value: derniere ? montant(derniere.montant_ttc, derniere.devise) : "—",
            tone: "",
          },
        ].map((k) => (
          <div key={k.key} className="border border-border bg-card px-4 py-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {k.label}
            </p>
            <p className={cn("num mt-1.5 text-[28px] leading-none", k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* 1. Proposer — à l'expert seul */}
      {expert ? (
        <section className="space-y-3">
          <SectionTitle>{t("cab.abo.propose.titre")}</SectionTitle>
          <p className="max-w-[70ch] text-[12.5px] leading-[1.55] text-muted-foreground">
            {t("cab.abo.propose.regle")}
          </p>
          {actifs.length === 0 ? (
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
        </section>
      ) : null}

      {/* 2. Ce que le cabinet propose ou couvre */}
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
          <EmptyState>{t("cab.abo.liste.vide")}</EmptyState>
        ) : (
          <InkTable
            caption={t("cab.abo.liste.titre")}
            head={[
              t("cab.abo.col.client"),
              t("cab.abo.col.offre"),
              t("cab.abo.col.statut"),
              t("cab.abo.col.propose"),
              t("cab.abo.col.effet"),
            ]}
          >
            {lignes.map((a) => (
              <InkTableRow key={a.acces_id}>
                <InkCell>
                  <Link
                    to="/cabinet/dossier/$clientId"
                    params={{ clientId: a.client_tenant_id }}
                    className="block font-medium hover:underline"
                  >
                    {a.client_nom}
                  </Link>
                  <span className="num block text-[10.5px] text-muted-foreground">
                    {a.client_legal_id ?? "—"}
                  </span>
                </InkCell>
                <InkCell>{libelleOffre(a.offre_code)}</InkCell>
                <InkCell>
                  <span className={cn("text-[12px] font-medium", TON[a.statut] ?? "")}>
                    {STATUT[a.statut] ? t(STATUT[a.statut]!) : a.statut}
                  </span>
                </InkCell>
                <InkCell>
                  <span className="num">{date(a.propose_le)}</span>
                </InkCell>
                <InkCell>
                  <span className="num">
                    {a.effet_du ? date(a.effet_du) : "—"}
                    {a.effet_au ? ` → ${date(a.effet_au)}` : ""}
                  </span>
                </InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>

      {/* 3. Les factures du cabinet */}
      <section className="space-y-3">
        <SectionTitle>{t("cab.abo.factures.titre")}</SectionTitle>
        {factures.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
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
                  <span className="text-[12px]">
                    {STATUT_FACTURE[f.statut] ? t(STATUT_FACTURE[f.statut]!) : f.statut}
                  </span>
                </InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>
    </div>
  );
}
