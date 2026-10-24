import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, FileText, Library, Search } from "lucide-react";
import { useState } from "react";
import { useCabinet } from "@/components/malica/cabinet-context";
import { EmptyState, SignalLight } from "@/components/malica/office-ui";
import { TelechargerDossierComptable } from "@/components/malica/telecharger-dossier-comptable";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { toneForStatus } from "@/lib/file-cabinet";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { ClientSummary } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/bibliotheque")({
  validateSearch: (s: Record<string, unknown>): { client?: string } => ({
    ...(typeof s["client"] === "string" ? { client: s["client"] } : {}),
  }),
  component: Bibliotheque,
});

function Bibliotheque() {
  const { org } = useCabinet();
  const { t } = useI18n();
  const recherche = Route.useSearch();
  const navigate = Route.useNavigate();
  const [periode, setPeriode] = useState("");
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const actifs = (clients.data ?? []).filter((c) => c.engagementStatus === "actif");
  const client = recherche.client ? actifs.find((c) => c.tenantId === recherche.client) : actifs[0];
  const choisir = (id: string) => {
    void navigate({ search: { client: id }, replace: true });
  };
  if (clients.isPending) return <p role="status">{t("common.loading")}</p>;
  if (clients.isError)
    return (
      <p role="alert" className="text-signal-stop">
        {texteDeLErreur(clients.error, "bibliothèque", t("common.error"))}
      </p>
    );
  return (
    <div className="cab-doclib space-y-6">
      <header>
        <p className="cab-doclib-kicker">
          <Library className="h-4 w-4" aria-hidden />
          {org.name}
        </p>
        <h1>{t("cab.biblio.title")}</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">{t("cab.biblio.subtitle")}</p>
      </header>
      <div className="cab-doclib-clients">
        {actifs.slice(0, 3).map((c) => (
          <button
            type="button"
            key={c.tenantId}
            className="cab-doclib-client"
            aria-pressed={c.tenantId === client?.tenantId}
            onClick={() => choisir(c.tenantId)}
          >
            <strong>{c.name}</strong>
            <span>{c.legalId ?? c.jurisdiction}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          {t("cab.biblio.client")}
          <select
            className="mt-1 block w-full border border-border bg-card p-2 text-foreground"
            value={client?.tenantId ?? ""}
            onChange={(e) => choisir(e.target.value)}
          >
            <option value="" disabled>
              {t("cab.biblio.noClient")}
            </option>
            {actifs.map((c) => (
              <option key={c.tenantId} value={c.tenantId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-muted-foreground">
          {t("cab.biblio.period")}
          <input
            type="month"
            className="mt-1 block border border-border bg-card p-2 text-foreground"
            value={periode}
            onChange={(e) => setPeriode(e.target.value)}
          />
        </label>
        {periode ? (
          <button type="button" className="cab-doclib-button" onClick={() => setPeriode("")}>
            {t("cab.biblio.allPeriods")}
          </button>
        ) : null}
      </div>
      {client ? (
        <DocumentsClient
          key={`${client.tenantId}:${periode}`}
          client={client}
          cabinetId={org.id}
          periode={periode}
        />
      ) : (
        <EmptyState>{t("cab.biblio.noClient")}</EmptyState>
      )}
    </div>
  );
}

const FILTRES = ["all", "achats", "ventes", "preuves", "autres"] as const;
function categorie(type: string | null) {
  if (type === "facture_achat" || type === "avoir_achat") return "achats";
  if (type === "facture_vente" || type === "avoir_vente") return "ventes";
  if (type === "justificatif_paiement" || type === "recu_de_paiement") return "preuves";
  return "autres";
}

function DocumentsClient({
  client,
  cabinetId,
  periode,
}: {
  client: ClientSummary;
  cabinetId: string;
  periode: string;
}) {
  const { t, locale } = useI18n();
  const [filtre, setFiltre] = useState<(typeof FILTRES)[number]>("all");
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const documents = useQuery({
    queryKey: ["cab-bibliotheque", cabinetId, client.tenantId, periode],
    queryFn: () => office().supervision.documents(cabinetId, client.tenantId, periode || null),
  });
  const types = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
  });
  const nomType = (type: string | null) =>
    types.data?.find((d) => d.code === type)?.libelle ?? t("cab.biblio.document");
  const lignes = (documents.data ?? []).filter(
    (d) =>
      (filtre === "all" || categorie(d.type) === filtre) &&
      [d.tiers, d.reference, d.type, nomType(d.type)].some((s) =>
        s?.toLocaleLowerCase(locale).includes(recherche.toLocaleLowerCase(locale)),
      ),
  );
  const selectionVisible = lignes.filter((d) => selection.has(d.id)).map((d) => d.id);
  const date = (s: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Tunis",
    }).format(new Date(s));
  if (documents.isPending) return <p role="status">{t("common.loading")}</p>;
  if (documents.isError)
    return (
      <p role="alert" className="text-signal-stop">
        {texteDeLErreur(documents.error, "bibliothèque", t("common.error"))}
      </p>
    );
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[18px] font-medium">{client.name}</h2>
        <TelechargerDossierComptable
          cabinetId={cabinetId}
          clientId={client.tenantId}
          nomClient={client.name}
          pieces={(documents.data ?? []).map((d) => d.id)}
        />
      </div>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <label className="cab-doclib-search">
          <Search className="h-4 w-4" aria-hidden />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t("cab.biblio.search")}
            aria-label={t("cab.biblio.search")}
          />
        </label>
        {selectionVisible.length > 0 ? (
          <TelechargerDossierComptable
            cabinetId={cabinetId}
            clientId={client.tenantId}
            nomClient={client.name}
            pieces={selectionVisible}
            libelle={t("cab.biblio.selection", { n: selectionVisible.length })}
          />
        ) : null}
      </div>
      <div className="cab-doclib-tabs" role="tablist" aria-label={t("cab.biblio.document")}>
        {FILTRES.map((f) => (
          <button
            type="button"
            role="tab"
            aria-selected={filtre === f}
            key={f}
            onClick={() => setFiltre(f)}
          >
            {t(`cab.biblio.${f}` as MessageKey)}
          </button>
        ))}
      </div>
      {lignes.length === 0 ? (
        <EmptyState>{t("cab.biblio.empty")}</EmptyState>
      ) : (
        <ul className="cab-doclib-documents">
          {lignes.map((d) => (
            <li key={d.id}>
              <input
                type="checkbox"
                checked={selection.has(d.id)}
                aria-label={t("cab.biblio.select", { reference: d.reference ?? d.id })}
                onChange={(e) =>
                  setSelection((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(d.id);
                    else next.delete(d.id);
                    return next;
                  })
                }
              />
              <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
              <Link to="/cabinet/piece/$pieceId" params={{ pieceId: d.id }} className="min-w-0">
                <strong>{d.tiers ?? d.reference ?? nomType(d.type)}</strong>
                <span>
                  {d.reference ? `${d.reference} · ` : ""}
                  {nomType(d.type)} · {date(d.recuLe)}
                </span>
              </Link>
              <span className="num text-end text-[12px]">
                {d.montant !== null ? `${montant(d.montant, locale)} ${d.devise}` : "—"}
              </span>
              <span className="cab-doclib-doc-status">
                <SignalLight
                  tone={toneForStatus(d.status)}
                  label={t(`pme.status.${d.status}` as MessageKey)}
                />
              </span>
              <Link
                to="/cabinet/piece/$pieceId"
                params={{ pieceId: d.id }}
                aria-label={t("cab.biblio.open")}
                className="cab-doclib-arrow"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{t("cab.biblio.count", { n: lignes.length })}</span>
        <span>{t("cab.biblio.linked")}</span>
      </div>
    </section>
  );
}
