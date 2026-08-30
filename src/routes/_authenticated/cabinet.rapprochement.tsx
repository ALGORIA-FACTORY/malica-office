import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { ClientPicker } from "@/components/regalica/ClientPicker";
import {
  ActionButton,
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionTitle,
} from "@/components/regalica/office-ui";
import { currentPeriod, monthBounds } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import { computeRapprochement } from "@/verticals/regalica-office/socle/engines/banque/rapprochement";

export const Route = createFileRoute("/_authenticated/cabinet/rapprochement")({
  head: () => ({
    meta: [
      { title: "Rapprochement bancaire — Regalica Office" },
      { name: "description", content: "Lettrage des lignes bancaires avec les écritures, délettrage motivé et journal complet." },
      { property: "og:title", content: "Rapprochement bancaire — Regalica Office" },
      { property: "og:description", content: "Lettrage des lignes bancaires avec les écritures, délettrage motivé et journal complet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetRapprochement,
});

/** Clé d'idempotence d'une ligne de relevé : zéro doublon à l'import. */
function importKey(compteId: string, at: string, label: string, montant: string, reference: string | null) {
  return [compteId, at, label.trim().toUpperCase(), montant, (reference ?? "").trim().toUpperCase()].join("|");
}

function parseCsv(
  compteId: string,
  raw: string,
): Array<{ at: string; label: string; montant: string; reference: string | null; idempotencyKey: string }> {
  const out: Array<{
    at: string;
    label: string;
    montant: string;
    reference: string | null;
    idempotencyKey: string;
  }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const cols = row.split(/[;\t]/).map((c) => c.trim());
    if (cols.length < 3) continue;
    const at = cols[0] ?? "";
    const label = cols[1] ?? "";
    const reference = cols[3] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) continue;
    // Le montant reste une chaîne : aucun calcul monétaire hors du Socle.
    const amount = (cols[2] ?? "").replace(/\s/g, "").replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(amount)) continue;
    const ref = reference.length > 0 ? reference : null;
    out.push({
      at,
      label,
      montant: amount,
      reference: ref,
      idempotencyKey: importKey(compteId, at, label, amount, ref),
    });
  }
  return out;
}

function CabinetRapprochement() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [compteId, setCompteId] = useState<string | null>(null);
  const [period, setPeriod] = useState(currentPeriod);
  const [csv, setCsv] = useState("");
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unmatch, setUnmatch] = useState<{ ligneId: string; motifId: string; note: string } | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const rows = clients.data ?? [];
  const client = rows.find((c) => c.tenantId === tenantId) ?? rows[0] ?? null;

  const pack = useQuery({
    queryKey: ["pack", client?.jurisdiction],
    queryFn: () => office().referential.activePack(client!.jurisdiction),
    enabled: !!client,
  });
  const params = useQuery({
    queryKey: ["socle-params", pack.data?.id],
    queryFn: () => office().referential.socleParams(pack.data!.id),
    enabled: !!pack.data,
  });
  const motifs = useQuery({
    queryKey: ["motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });
  const comptes = useQuery({
    queryKey: ["banque-comptes", client?.tenantId],
    queryFn: () => office().banque.listAccounts(client!.tenantId),
    enabled: !!client,
  });
  const compteRows = comptes.data ?? [];
  const compte = compteRows.find((c) => c.id === compteId) ?? compteRows[0] ?? null;

  const lignes = useQuery({
    queryKey: ["banque-lignes", client?.tenantId, compte?.id],
    queryFn: () => office().banque.lines(client!.tenantId, compte!.id),
    enabled: !!client && !!compte,
  });

  const { from, to } = monthBounds(period);
  const bookLines = useQuery({
    queryKey: ["banque-book", client?.tenantId, compte?.accountCode, from, to],
    queryFn: () =>
      office().banque.bookLines({
        tenantId: client!.tenantId,
        accountCode: compte!.accountCode,
        from,
        to,
      }),
    enabled: !!client && !!compte,
  });
  const etat = useQuery({
    queryKey: ["banque-etat", client?.tenantId],
    queryFn: () => office().banque.etat(client!.tenantId),
    enabled: !!client,
  });
  const journal = useQuery({
    queryKey: ["banque-journal", client?.tenantId],
    queryFn: () => office().banque.lettrages(client!.tenantId),
    enabled: !!client,
  });
  const audit = useQuery({
    queryKey: ["banque-audit", client?.tenantId],
    queryFn: () => office().banque.audit(client!.tenantId),
    enabled: !!client,
  });

  /** L'appariement est déterministe : le Socle décide, l'écran ne fait que montrer. */
  const result = useMemo(() => {
    if (!params.data || !client || !compte || !lignes.data || !bookLines.data) return null;
    const bank = lignes.data
      .filter((l) => l.status === "ouverte")
      .map((l) => ({
        id: l.id,
        at: l.at,
        label: l.label,
        montant: l.montant,
        reference: l.reference,
      }));
    const book = bookLines.data
      .filter((b) => !b.lettree)
      .map((b) => ({ id: b.id, at: b.at, label: b.label, montant: b.montant, reference: b.reference }));
    if (bank.length === 0 || book.length === 0) return null;
    return computeRapprochement(
      {
        currency: compte.devise || client.currency,
        decimals: params.data.moneyDecimals,
        toleranceJours: params.data.rapprochementToleranceJours,
        toleranceMontant: params.data.rapprochementToleranceMontant,
      },
      bank,
      book,
    );
  }, [params.data, client, compte, lignes.data, bookLines.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["banque-lignes", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-book", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-etat", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-journal", client?.tenantId] });
    void qc.invalidateQueries({ queryKey: ["banque-audit", client?.tenantId] });
  };

  const importer = useMutation({
    mutationFn: async () => {
      if (!client || !compte) return { added: 0, skipped: 0 };
      const parsed = parseCsv(compte.id, csv);
      // Dédoublonnage local puis clé d'idempotence en base : deux murs, zéro doublon.
      const seen = new Set<string>();
      const unique = parsed.filter((l) => {
        if (seen.has(l.idempotencyKey)) return false;
        seen.add(l.idempotencyKey);
        return true;
      });
      const added = await office().banque.importLines({
        tenantId: client.tenantId,
        compteId: compte.id,
        batchId: crypto.randomUUID(),
        lines: unique,
      });
      return { added, skipped: parsed.length - added };
    },
    onSuccess: (r) => {
      setError(null);
      setCsv("");
      setImportInfo(t("cab.banque.imported", { added: r.added, skipped: r.skipped }));
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const lettrer = useMutation({
    mutationFn: async (paire: {
      bank_id: string;
      book_id: string;
      score: number;
      ecart_montant: string;
      ecart_jours: number;
      reference_exacte: boolean;
    }) => {
      if (!pack.data) return;
      await office().banque.lettrer({
        ligneId: paire.bank_id,
        ecritureId: paire.book_id,
        score: paire.score,
        ecartMontant: paire.ecart_montant,
        ecartJours: paire.ecart_jours,
        referenceExacte: paire.reference_exacte,
        packVersionId: pack.data.id,
      });
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const delettrer = useMutation({
    mutationFn: async (input: { ligneId: string; motifId: string; note: string }) => {
      await office().banque.delettrer({
        ligneId: input.ligneId,
        motifId: input.motifId,
        note: input.note.trim() ? input.note.trim() : null,
      });
    },
    onSuccess: () => {
      setError(null);
      setUnmatch(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const ignorer = useMutation({
    mutationFn: (ligneId: string) => office().banque.setLineStatus(ligneId, "ignoree"),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.banque.voice")}</RegalicaNote>, [locale]);

  const bookById = new Map((bookLines.data ?? []).map((b) => [b.id, b]));
  const bankById = new Map((lignes.data ?? []).map((b) => [b.id, b]));
  const motifRows = motifs.data ?? [];
  const motifById = new Map(motifRows.map((m) => [m.id, m]));
  const actifs = (etat.data ?? []).filter((e) => e.active);

  function EcritureRef({ id }: { id: string }) {
    const book = bookById.get(id);
    if (book?.pieceId) {
      return (
        <Link
          to="/cabinet/piece/$pieceId"
          params={{ pieceId: book.pieceId }}
          className="underline decoration-dotted underline-offset-4"
          title={t("cab.banque.openpiece")}
        >
          {book.label || id}
        </Link>
      );
    }
    return <span>{book?.label ?? id}</span>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t("cab.banque.title")}</h1>

      {rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <ClientPicker
              label={t("cab.queue.client")}
              clients={rows}
              value={client?.tenantId ?? null}
              onChange={(id) => {
                setTenantId(id);
                setCompteId(null);
                setImportInfo(null);
                setError(null);
              }}
            />
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
              <span className="text-muted-foreground">{t("cab.banque.account")}</span>
              <select
                value={compte?.id ?? ""}
                onChange={(e) => setCompteId(e.target.value)}
                className="border border-border bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
              >
                {compteRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
              <span className="text-muted-foreground">{t("pme.tva.period")}</span>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="num border border-border bg-card px-2 py-2 text-[13px] font-normal tracking-normal"
              />
            </label>
          </div>

          {error ? (
            <p className="border border-border bg-card px-3 py-2 text-[13px]" role="alert">
              {error}
            </p>
          ) : null}

          {compteRows.length === 0 ? (
            <EmptyState>{t("cab.banque.noaccount")}</EmptyState>
          ) : (
            <>
              {/* ---------------------------------------------------- import */}
              <SectionTitle>{t("cab.banque.import")}</SectionTitle>
              <div className="space-y-2 border border-border bg-card p-4">
                <p className="text-[12px] text-muted-foreground">{t("cab.banque.csvhint")}</p>
                <textarea
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  aria-label={t("cab.banque.import")}
                  className="num w-full border border-border bg-background p-2 text-[12px]"
                  placeholder="2026-02-03;VIR STEG FACTURE FEV;-236.000;F2026-014"
                />
                <div className="flex items-center gap-3">
                  <ActionButton
                    variant="ink"
                    disabled={importer.isPending || csv.trim().length === 0}
                    onClick={() => importer.mutate()}
                  >
                    {t("cab.banque.importrun")}
                  </ActionButton>
                  {importInfo ? (
                    <span className="num text-[12px] text-muted-foreground">{importInfo}</span>
                  ) : null}
                </div>
              </div>

              {/* --------------------------------------------- propositions */}
              <SectionTitle>{t("cab.banque.suggest")}</SectionTitle>
              {!result || result.paires.length === 0 ? (
                <EmptyState>{t("cab.banque.nopair")}</EmptyState>
              ) : (
                <InkTable
                  caption={t("cab.banque.suggest")}
                  head={[
                    t("cab.banque.line"),
                    t("cab.banque.book"),
                    t("cab.banque.score"),
                    t("cab.banque.ecart"),
                    t("cab.banque.days"),
                    "",
                  ]}
                >
                  {result.paires.map((p) => {
                    const bank = bankById.get(p.bank_id);
                    const book = bookById.get(p.book_id);
                    return (
                      <InkTableRow key={`${p.bank_id}-${p.book_id}`}>
                        <InkCell>
                          <span className="block">{bank?.label ?? p.bank_id}</span>
                          <span className="num text-[11px] text-muted-foreground">
                            {bank?.at} · {bank?.montant}
                          </span>
                        </InkCell>
                        <InkCell>
                          <span className="block">
                            <EcritureRef id={p.book_id} />
                          </span>
                          <span className="num text-[11px] text-muted-foreground">
                            {book?.at} · {book?.montant} · {book?.journal}
                          </span>
                        </InkCell>
                        <InkCell numeric>{p.score}</InkCell>
                        <InkCell numeric>{p.ecart_montant}</InkCell>
                        <InkCell numeric>{p.ecart_jours}</InkCell>
                        <InkCell>
                          <ActionButton
                            variant="ink"
                            disabled={lettrer.isPending}
                            onClick={() => lettrer.mutate(p)}
                          >
                            {t("cab.banque.match")}
                          </ActionButton>
                        </InkCell>
                      </InkTableRow>
                    );
                  })}
                </InkTable>
              )}

              {/* ------------------------------------------ lettrages actifs */}
              <SectionTitle>{t("cab.banque.matched")}</SectionTitle>
              {actifs.length === 0 ? (
                <EmptyState>{t("cab.banque.nomatched")}</EmptyState>
              ) : (
                <InkTable
                  caption={t("cab.banque.matched")}
                  head={[
                    t("cab.banque.line"),
                    t("cab.banque.book"),
                    t("cab.banque.score"),
                    t("cab.banque.ecart"),
                    "",
                  ]}
                >
                  {actifs.map((e) => {
                    const bank = bankById.get(e.ligneId);
                    const open = unmatch?.ligneId === e.ligneId;
                    const motif = open ? motifById.get(unmatch!.motifId) : undefined;
                    return (
                      <InkTableRow key={e.ligneId}>
                        <InkCell>
                          <span className="block">{bank?.label ?? e.ligneId}</span>
                          <span className="num text-[11px] text-muted-foreground">
                            {bank?.at} · {bank?.montant}
                          </span>
                        </InkCell>
                        <InkCell>
                          <EcritureRef id={e.ecritureId} />
                        </InkCell>
                        <InkCell numeric>{e.score}</InkCell>
                        <InkCell numeric>{e.ecartMontant}</InkCell>
                        <InkCell>
                          {open ? (
                            <div className="space-y-2">
                              <select
                                aria-label={t("cab.banque.motif")}
                                value={unmatch!.motifId}
                                onChange={(ev) =>
                                  setUnmatch({ ...unmatch!, motifId: ev.target.value })
                                }
                                className="w-full border border-border bg-card px-2 py-1 text-[12px]"
                              >
                                <option value="">—</option>
                                {motifRows.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                              {motif?.requiresNote ? (
                                <input
                                  aria-label={t("cab.banque.note")}
                                  value={unmatch!.note}
                                  onChange={(ev) => setUnmatch({ ...unmatch!, note: ev.target.value })}
                                  className="w-full border border-border bg-card px-2 py-1 text-[12px]"
                                  placeholder={t("cab.banque.note")}
                                />
                              ) : null}
                              <div className="flex gap-2">
                                <ActionButton
                                  variant="ink"
                                  disabled={
                                    delettrer.isPending ||
                                    !unmatch!.motifId ||
                                    (!!motif?.requiresNote && unmatch!.note.trim().length === 0)
                                  }
                                  onClick={() => delettrer.mutate(unmatch!)}
                                >
                                  {t("cab.banque.unmatch")}
                                </ActionButton>
                                <ActionButton onClick={() => setUnmatch(null)}>
                                  {t("common.cancel")}
                                </ActionButton>
                              </div>
                            </div>
                          ) : (
                            <ActionButton
                              onClick={() => setUnmatch({ ligneId: e.ligneId, motifId: "", note: "" })}
                            >
                              {t("cab.banque.unmatch")}
                            </ActionButton>
                          )}
                        </InkCell>
                      </InkTableRow>
                    );
                  })}
                </InkTable>
              )}

              {/* ------------------------------------------ lignes du relevé */}
              <SectionTitle>{t("cab.banque.lines")}</SectionTitle>
              {lignes.isPending ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : (lignes.data ?? []).length === 0 ? (
                <EmptyState>{t("cab.banque.nolines")}</EmptyState>
              ) : (
                <InkTable
                  caption={t("cab.banque.lines")}
                  head={[
                    t("cab.stocks.date"),
                    t("cab.banque.label"),
                    t("cab.banque.amount"),
                    t("cab.banque.reference"),
                    t("cab.banque.status"),
                    "",
                  ]}
                >
                  {(lignes.data ?? []).map((l) => (
                    <InkTableRow key={l.id}>
                      <InkCell numeric>{l.at}</InkCell>
                      <InkCell>{l.label}</InkCell>
                      <InkCell numeric>{l.montant}</InkCell>
                      <InkCell numeric>{l.reference ?? "—"}</InkCell>
                      <InkCell>{t(`cab.banque.status.${l.status}`)}</InkCell>
                      <InkCell>
                        {l.status === "ouverte" ? (
                          <ActionButton
                            disabled={ignorer.isPending}
                            onClick={() => ignorer.mutate(l.id)}
                          >
                            {t("cab.banque.ignore")}
                          </ActionButton>
                        ) : null}
                      </InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
              )}

              {/* ------------------------------------ écritures du compte */}
              <SectionTitle>{t("cab.banque.booklines")}</SectionTitle>
              {(bookLines.data ?? []).length === 0 ? (
                <EmptyState>{t("cab.banque.nobook")}</EmptyState>
              ) : (
                <InkTable
                  caption={t("cab.banque.booklines")}
                  head={[
                    t("cab.stocks.date"),
                    t("cab.banque.label"),
                    t("cab.banque.amount"),
                    t("cab.banque.piece"),
                    t("cab.banque.status"),
                  ]}
                >
                  {(bookLines.data ?? []).map((b) => (
                    <InkTableRow key={b.id}>
                      <InkCell numeric>{b.at}</InkCell>
                      <InkCell>
                        <EcritureRef id={b.id} />
                      </InkCell>
                      <InkCell numeric>{b.montant}</InkCell>
                      <InkCell>
                        {b.pieceId ? (
                          <Link
                            to="/cabinet/piece/$pieceId"
                            params={{ pieceId: b.pieceId }}
                            className="underline decoration-dotted underline-offset-4"
                          >
                            {t("cab.banque.openpiece")}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </InkCell>
                      <InkCell>
                        {b.lettree ? (
                          <span className="border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
                            {t("cab.banque.lettree")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
              )}

              {result ? (
                <p className="num text-[11px] text-muted-foreground">
                  {t("cab.banque.totals", {
                    bank: result.totals.bank,
                    book: result.totals.book,
                    ecart: result.totals.ecart,
                    currency: result.currency,
                  })}
                </p>
              ) : null}

              {/* -------------------------------- journal des lettrages */}
              <SectionTitle>{t("cab.banque.journal")}</SectionTitle>
              {(journal.data ?? []).length === 0 ? (
                <EmptyState>{t("cab.banque.nojournal")}</EmptyState>
              ) : (
                <InkTable
                  caption={t("cab.banque.journal")}
                  head={[
                    t("cab.banque.when"),
                    t("cab.banque.action"),
                    t("cab.banque.line"),
                    t("cab.banque.book"),
                    t("cab.banque.motif"),
                    t("cab.banque.note"),
                  ]}
                >
                  {(journal.data ?? []).map((l) => (
                    <InkTableRow key={l.id}>
                      <InkCell numeric>{l.createdAt.slice(0, 19).replace("T", " ")}</InkCell>
                      <InkCell>{t(`cab.banque.action.${l.action}`)}</InkCell>
                      <InkCell>{bankById.get(l.ligneId)?.label ?? l.ligneId}</InkCell>
                      <InkCell>
                        <EcritureRef id={l.ecritureId} />
                      </InkCell>
                      <InkCell>{l.motifId ? (motifById.get(l.motifId)?.label ?? l.motifId) : "—"}</InkCell>
                      <InkCell>{l.note ?? "—"}</InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
              )}

              {/* ------------------------------------------- piste d'audit */}
              <SectionTitle>{t("cab.banque.audit")}</SectionTitle>
              {(audit.data ?? []).length === 0 ? (
                <EmptyState>{t("cab.banque.noaudit")}</EmptyState>
              ) : (
                <InkTable
                  caption={t("cab.banque.audit")}
                  head={[t("cab.banque.when"), t("cab.banque.action"), t("cab.banque.note")]}
                >
                  {(audit.data ?? []).map((a) => (
                    <InkTableRow key={a.id}>
                      <InkCell numeric>{a.at.slice(0, 19).replace("T", " ")}</InkCell>
                      <InkCell>{a.action}</InkCell>
                      <InkCell>
                        <span className="num text-[11px] text-muted-foreground">
                          {JSON.stringify(a.payload)}
                        </span>
                      </InkCell>
                    </InkTableRow>
                  ))}
                </InkTable>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
