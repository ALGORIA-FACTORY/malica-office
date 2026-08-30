import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { usePme } from "@/components/regalica/pme-context";
import { DocumentView } from "@/components/regalica/document-view";
import { office } from "@/verticals/regalica-office/composition";
import type { Citation } from "@/verticals/regalica-office/ports/repositories";
import { buildProposal } from "@/verticals/regalica-office/use-cases/propose-ecriture";

export const Route = createFileRoute("/_authenticated/pme/piece/$pieceId")({
  head: () => ({
    meta: [
      { title: "Ma pièce — Regalica Office" },
      {
        name: "description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source avant confirmation.",
      },
      { property: "og:title", content: "Ma pièce — Regalica Office" },
      {
        property: "og:description",
        content:
          "Lecture citée d'une pièce : chaque montant ouvre sa zone source avant confirmation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PieceScreen,
});

interface ExtractArticle {
  designation: string;
  quantity: string | null;
  unit_price_ht: string | null;
  unit_price_ttc: string | null;
  total_ht: string | null;
  tax_code: string | null;
}

interface ExtractPayload {
  issuer?: string;
  document_date?: string;
  document_kind?: string;
  currency?: string;
  lines?: Array<{
    label: string;
    tax_code: string;
    base_ht: string;
    vat_amount: string;
    ttc: string;
  }>;
  articles?: ExtractArticle[];
  other_charges?: Array<{ code: string; label: string; amount: string }>;
  totals?: { base_ht: string; vat: string; ttc: string };
}

/**
 * Écran PME. Le geste cœur : voir la zone source, confirmer en un tap.
 * L'écriture proposée et les signalements de lecture n'apparaissent pas ici :
 * ils appartiennent à la supervision du cabinet.
 */
function PieceScreen() {
  const { pieceId } = Route.useParams();
  const { t } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dossier = useQuery({
    queryKey: ["piece", pieceId],
    queryFn: () => office().capture.dossier(pieceId),
  });

  const ecritures = useQuery({
    queryKey: ["ecritures", pieceId],
    queryFn: () => office().office.ecrituresForPiece(pieceId),
  });

  const refs = useQuery({
    queryKey: ["ref-data", pme.packId],
    queryFn: async () => {
      const packId = pme.packId!;
      const [taxRates, mappings, fiscalCharges] = await Promise.all([
        office().referential.taxRates(packId, pme.jurisdiction),
        office().referential.accountMappings(packId),
        office().referential.fiscalCharges(packId),
      ]);
      return { taxRates, mappings, fiscalCharges };
    },
    enabled: !!pme.packId,
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
      qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] }),
    ]);
  };

  const read = useMutation({
    mutationFn: () => office().capture.read(pieceId),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  const proposalAttempt = useMemo(() => {
    const payload = dossier.data?.extraction?.payload;
    if (!payload || !refs.data) return null;
    try {
      return {
        ok: true as const,
        value: buildProposal({
          pieceId,
          payload,
          taxRates: refs.data.taxRates,
          mappings: refs.data.mappings,
          fiscalCharges: refs.data.fiscalCharges,
          currency: pme.currency,
        }),
      };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
    }
  }, [dossier.data, refs.data, pieceId, pme.currency]);
  const proposal = proposalAttempt?.ok ? proposalAttempt.value : null;

  const booked = (ecritures.data ?? []).find((e) => e.status === "booked");

  /**
   * Un seul geste : la proposition du Socle et sa comptabilisation s'enchaînent.
   * La PME ne compose jamais l'écriture, elle confirme ce qu'elle a vu cité.
   */
  const confirm = useMutation({
    mutationFn: async () => {
      // Une proposition calculable prime toujours sur une proposition ancienne :
      // le Socle a pu changer d'avis (droit du pack, résidu). Le RPC remplace la
      // proposition existante ; une écriture non équilibrée n'est jamais confirmée.
      let ecritureId: string | null = null;
      if (proposal) {
        if (!pme.packId || !proposal.pivot.approvable) throw new Error(t("pme.confirm.review"));
        ecritureId = await office().office.propose({
          pieceId,
          journal: proposal.journal,
          date: proposal.pivot.entry_date,
          libelle: proposal.extract.issuer,
          packVersionId: pme.packId,
          devise: proposal.pivot.currency,
          lignes: proposal.lignes,
        });
      } else {
        // Jamais de repli sur une proposition ancienne : sans calcul du Socle,
        // il n'y a rien à confirmer, et la raison est affichée telle quelle.
        throw new Error(
          proposalAttempt && !proposalAttempt.ok ? proposalAttempt.reason : t("pme.confirm.review"),
        );
      }
      if (!ecritureId) throw new Error(t("pme.confirm.review"));
      await office().office.book(ecritureId);
    },
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  if (dossier.isPending)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!dossier.data) return <p className="text-sm text-signal-warn">{t("common.error")}</p>;

  const { piece, contenu, extraction, citations } = dossier.data;
  // Une citation par champ : la dernière écrite est celle qui fait foi.
  const byField = new Map(citations.map((c) => [c.field, c]));
  const payload = extraction?.payload as ExtractPayload | undefined;
  const confirmable = Boolean(proposal?.pivot.approvable);
  const blockReason = proposalAttempt && !proposalAttempt.ok ? proposalAttempt.reason : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{t("pme.piece.title")}</h1>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t(`pme.status.${piece.status}` as MessageKey)} · {piece.source}
        </span>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          {contenu ? (
            <DocumentView
              contenu={contenu}
              highlight={zoom}
              label={t("pme.piece.title")}
              loadingLabel={t("pme.doc.loading")}
              errorLabel={t("pme.doc.error")}
            />
          ) : (
            <p className="border border-border bg-card p-4 text-xs text-muted-foreground">
              {t("pme.doc.error")}
            </p>
          )}
        </div>

        <div className="space-y-4">
          {!extraction ? (
            <div className="border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">{t("pme.read.none")}</p>
              <button
                type="button"
                disabled={read.isPending}
                onClick={() => read.mutate()}
                className="mt-4 min-h-[48px] w-full border border-foreground bg-foreground px-4 py-3 text-xs uppercase tracking-wide text-background disabled:opacity-60"
              >
                {read.isPending ? t("pme.read.running") : t("pme.read.run")}
              </button>
            </div>
          ) : (
            <dl className="grid gap-px border border-border bg-border text-sm">
              <Field
                label={t("pme.extract.issuer")}
                value={payload?.issuer ?? null}
                citation={byField.get("issuer") ?? null}
                onZoom={setZoom}
                zoomLabel={t("pme.citation.show")}
                missingLabel={t("pme.citation.missing")}
              />
              <Field
                label={t("pme.extract.date")}
                value={payload?.document_date ?? null}
                citation={byField.get("document_date") ?? null}
                onZoom={setZoom}
                zoomLabel={t("pme.citation.show")}
                missingLabel={t("pme.citation.missing")}
                mono
              />
              <div className="bg-card px-4 py-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <Amount
                    label={t("pme.extract.base")}
                    value={payload?.totals?.base_ht ?? null}
                    citation={byField.get("totals.base_ht") ?? null}
                    onZoom={setZoom}
                  />
                  <Amount
                    label={t("pme.extract.vat")}
                    value={payload?.totals?.vat ?? null}
                    citation={byField.get("totals.vat") ?? null}
                    onZoom={setZoom}
                  />
                  <Amount
                    label={t("pme.extract.ttc")}
                    value={payload?.totals?.ttc ?? null}
                    citation={byField.get("totals.ttc") ?? null}
                    onZoom={setZoom}
                  />
                </div>
              </div>
            </dl>
          )}
        </div>
      </section>

      {extraction && !booked ? (
        <section className="border border-border bg-card p-4">
          {confirmable ? (
            <button
              type="button"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
              className="min-h-[48px] w-full border border-foreground bg-foreground px-4 py-3 text-xs uppercase tracking-wide text-background disabled:opacity-50"
            >
              {confirm.isPending ? t("pme.confirm.pending") : t("pme.book.run")}
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {blockReason ?? t("pme.confirm.review")}
            </p>
          )}
        </section>
      ) : null}

      {booked ? (
        <p className="border border-border bg-card p-4 text-sm">{t("pme.book.done")}</p>
      ) : null}

      {error ? <p className="text-xs text-signal-warn">{error}</p> : null}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string | null;
  citation: Citation | null;
  onZoom: (c: Citation | null) => void;
  zoomLabel: string;
  missingLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="text-end">
        <span className={props.mono ? "num" : ""}>{props.value ?? "—"}</span>
        <button
          type="button"
          onClick={() => props.onZoom(props.citation)}
          disabled={!props.citation}
          className="ms-3 min-h-[44px] text-[11px] uppercase tracking-wide text-muted-foreground underline disabled:no-underline"
        >
          {props.citation ? props.zoomLabel : props.missingLabel}
        </button>
      </dd>
    </div>
  );
}

function Amount(props: {
  label: string;
  value: string | null;
  citation: Citation | null;
  onZoom: (c: Citation | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onZoom(props.citation)}
      disabled={!props.citation}
      className="min-h-[48px] min-w-0 border border-border px-3 py-2 text-start disabled:opacity-60"
    >
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <span className="num block break-words">{props.value ?? "—"}</span>
    </button>
  );
}
