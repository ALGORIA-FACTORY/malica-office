import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { DocumentView } from "@/components/regalica/document-view";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionTitle,
  SignalLight,
  StickyActions,
} from "@/components/regalica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import type { Citation } from "@/verticals/regalica-office/ports/repositories";

import { toneForStatus } from "./cabinet.index";

export const Route = createFileRoute("/_authenticated/cabinet/piece/$pieceId")({
  head: () => ({
    meta: [
      { title: "Revue d'une pièce — Regalica Office" },
      { name: "description", content: "Pièce à gauche, écriture proposée à droite : citations, verdict, comptabilisation ou retour motivé." },
      { property: "og:title", content: "Revue d'une pièce — Regalica Office" },
      { property: "og:description", content: "Pièce à gauche, écriture proposée à droite : citations, verdict, comptabilisation ou retour motivé." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetReview,
});

function CabinetReview() {
  const { pieceId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const [zoom, setZoom] = useState<Citation | null>(null);
  const [motifId, setMotifId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"valide" | "retourne" | null>(null);

  const dossier = useQuery({
    queryKey: ["piece", pieceId],
    queryFn: () => office().capture.dossier(pieceId),
  });

  const ecritures = useQuery({
    queryKey: ["ecritures", pieceId],
    queryFn: () => office().office.ecrituresForPiece(pieceId),
  });

  const motifs = useQuery({
    queryKey: ["rejet-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });

  const audit = useQuery({
    queryKey: ["piece-audit", pieceId],
    queryFn: () => office().supervision.auditForPiece(pieceId),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.regalica.review")}</RegalicaNote>, [locale]);

  const selectedMotif = useMemo(
    () => (motifs.data ?? []).find((m) => m.id === motifId) ?? null,
    [motifs.data, motifId],
  );

  const review = useMutation({
    mutationFn: (outcome: "valide" | "retourne") =>
      office().supervision.review({
        ecritureId: booked!.id,
        outcome,
        motifId: outcome === "retourne" ? motifId : null,
        note: note.trim() ? note.trim() : null,
      }),
    onSuccess: async (_data, outcome) => {
      setError(null);
      setDone(outcome);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
        qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece-audit", pieceId] }),
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
      ]);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  if (dossier.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!dossier.data) return <EmptyState>{t("cab.review.nodoc")}</EmptyState>;

  const { piece, fileUrl, extraction, citations } = dossier.data;
  const articles =
    ((extraction?.payload as { articles?: Array<{
      designation: string;
      quantity: string | null;
      unit_price_ht: string | null;
      unit_price_ttc: string | null;
      total_ht: string | null;
    }> } | undefined)?.articles) ?? [];
  const byField = new Map(citations.map((c) => [c.field, c]));
  const all = ecritures.data ?? [];
  const booked = all.find((e) => e.status === "booked") ?? null;
  const reversal = all.find((e) => e.libelle.startsWith("Contre-passation")) ?? null;

  const noteMissing = Boolean(selectedMotif?.requiresNote) && note.trim().length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("cab.review.title")}</h1>
        <div className="flex items-center gap-4">
          <SignalLight
            tone={toneForStatus(piece.status)}
            label={t(`pme.status.${piece.status}` as MessageKey)}
          />
          <Link to="/cabinet" className="text-[11px] uppercase tracking-wide underline">
            {t("cab.review.back")}
          </Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <SectionTitle>{t("cab.review.document")}</SectionTitle>
          {fileUrl ? (
            <DocumentView
              fileUrl={fileUrl}
              highlight={zoom}
              label={t("cab.review.document")}
              loadingLabel={t("pme.doc.loading")}
              errorLabel={t("pme.doc.error")}
            />
          ) : (
            <p className="border border-border bg-card p-3 text-xs text-muted-foreground">
              {t("cab.review.nodoc")}
            </p>
          )}

          {articles.length > 0 ? (
            <>
              <SectionTitle>{t("pme.extract.articles")}</SectionTitle>
              <InkTable
                caption={t("pme.extract.articles")}
                head={[
                  t("pme.extract.designation"),
                  t("pme.extract.qty"),
                  t("pme.extract.pu_ht"),
                  t("pme.extract.pu_ttc"),
                  t("pme.extract.base"),
                ]}
              >
                {articles.map((article, index) => (
                  <InkTableRow key={index}>
                    <InkCell>{article.designation}</InkCell>
                    <InkCell numeric>{article.quantity ?? "—"}</InkCell>
                    <InkCell numeric>{article.unit_price_ht ?? "—"}</InkCell>
                    <InkCell numeric>{article.unit_price_ttc ?? "—"}</InkCell>
                    <InkCell numeric>{article.total_ht ?? "—"}</InkCell>
                  </InkTableRow>
                ))}
              </InkTable>
            </>
          ) : null}

          <SectionTitle>{t("cab.review.citations")}</SectionTitle>
          {citations.length === 0 ? (
            <EmptyState>{t("pme.read.none")}</EmptyState>
          ) : (
            <ul className="grid gap-px border border-border bg-border">
              {citations.map((citation) => (
                <li key={`${citation.field}-${citation.page}`} className="bg-card">
                  <button
                    type="button"
                    onClick={() => setZoom(citation)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-start hover:bg-accent"
                  >
                    <span className="num text-[12px]">{citation.field}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {citation.zone ?? `p.${citation.page}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {extraction && extraction.flags.length > 0 ? (
            <div className="border border-s-2 border-border border-s-signal-warn bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-signal-warn">
                {t("pme.read.flags")}
              </p>
              <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                {extraction.flags.map((flag, index) => (
                  <li key={index} className="num">
                    {flag.field} — {flag.code}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <SectionTitle>{t("cab.review.ecriture")}</SectionTitle>
          {!booked ? (
            <EmptyState>{t("cab.review.noecriture")}</EmptyState>
          ) : (
            <>
              <p className="num text-[11px] uppercase tracking-wide text-muted-foreground">
                {booked.journal} · {booked.dateEcriture} · {booked.devise}
              </p>
              <InkTable
                caption={t("cab.review.ecriture")}
                head={[
                  t("pme.journal.account"),
                  t("pme.journal.debit"),
                  t("pme.journal.credit"),
                ]}
              >
                {booked.lines.map((line) => (
                  <InkTableRow key={line.ordinal}>
                    <InkCell>
                      <span className="num">{line.accountCode}</span>{" "}
                      <span className="text-muted-foreground">{line.libelle}</span>
                    </InkCell>
                    <InkCell numeric>{line.debit}</InkCell>
                    <InkCell numeric>{line.credit}</InkCell>
                  </InkTableRow>
                ))}
              </InkTable>

              {reversal ? (
                <div className="border border-s-2 border-border border-s-signal-stop bg-card p-3 text-[12px]">
                  <p className="font-medium">{reversal.libelle}</p>
                  <p className="num mt-1 text-muted-foreground">{reversal.dateEcriture}</p>
                </div>
              ) : null}

              {done ? (
                <p className="border border-border bg-card px-3 py-3 text-[13px]">
                  {done === "valide" ? t("cab.review.done.valide") : t("cab.review.done.retourne")}
                </p>
              ) : (
                <div className="space-y-3 border border-border bg-card p-3">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("cab.review.motif")}
                    </span>
                    <select
                      value={motifId}
                      onChange={(e) => setMotifId(e.target.value)}
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[13px]"
                    >
                      <option value="">{t("cab.review.motif.choose")}</option>
                      {(motifs.data ?? []).map((motif) => (
                        <option key={motif.id} value={motif.id}>
                          {motif.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t("cab.review.note")}
                    </span>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[13px]"
                    />
                  </label>

                  {noteMissing ? (
                    <p className="text-[11px] text-signal-warn">{t("cab.review.note.required")}</p>
                  ) : null}

                  <StickyActions>
                    <ActionButton
                      variant="ink"
                      disabled={review.isPending}
                      onClick={() => review.mutate("valide")}
                    >
                      {t("cab.review.validate")}
                    </ActionButton>
                    <ActionButton
                      disabled={review.isPending || !motifId || noteMissing}
                      onClick={() => review.mutate("retourne")}
                    >
                      {t("cab.review.return")}
                    </ActionButton>
                  </StickyActions>
                </div>
              )}
            </>
          )}

          <SectionTitle>{t("cab.review.audit")}</SectionTitle>
          {(audit.data ?? []).length === 0 ? (
            <EmptyState>{t("cab.review.audit.empty")}</EmptyState>
          ) : (
            <ul className="grid gap-px border border-border bg-border text-[12px]">
              {(audit.data ?? []).map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 bg-card px-3 py-2">
                  <span className="num">{entry.action}</span>
                  <span className="num text-muted-foreground">{entry.at.slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {error ? <p className="num text-[12px] text-signal-warn">{error}</p> : null}
    </div>
  );
}
