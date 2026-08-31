import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { usePme } from "@/components/regalica/pme-context";
import { DocumentView } from "@/components/regalica/document-view";
import { RegalicaAvatar } from "@/components/regalica/office-ui";
import { montant } from "@/lib/lisible";
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
  references?: Record<string, string>;
  totals?: { base_ht: string; vat: string; ttc: string };
}

/**
 * Écran PME. Le geste cœur : voir la zone source, confirmer en un tap.
 * L'écriture proposée et les signalements de lecture n'apparaissent pas ici :
 * ils appartiennent à la supervision du cabinet.
 */
function PieceScreen() {
  const { pieceId } = Route.useParams();
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Le soulagement n'arrive qu'une fois.
   *
   * Il est porté par un état d'écran, pas par le statut de la pièce : rouvrir
   * une facture comptabilisée trois jours plus tard ne doit pas rejouer la
   * coche. On fête la confirmation, pas la comptabilisation.
   */
  const [regle, setRegle] = useState(false);

  // Qui reçoit la pièce. Sans mandat, elle reste au dossier — et l'écran le
  // dit autrement plutôt que d'inventer un destinataire.
  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

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
          libelle: proposal.libelle,
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
      setRegle(true);
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

  /** Un montant du Socle, dans la langue du lecteur — ou rien s'il n'y en a pas. */
  const lisible = (valeur: string | undefined) =>
    valeur === undefined ? null : montant(valeur, locale);

  /** « 2026-08-31 » se lit mal ; « 31/08/2026 » se lit. */
  const jourLisible = (iso: string | undefined) => {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  /**
   * « Classé dans … » — le libellé du compte principal que le Socle a retenu.
   *
   * Pas une catégorie d'écran : la première ligne de l'écriture proposée, donc
   * exactement ce qui sera comptabilisé. Dire autre chose ici serait promettre
   * un classement que le grand livre ne confirmerait pas.
   */
  const classement = proposal?.lignes[0]?.libelle ?? t("pme.regle.classe.inconnu");

  /** La TVA du document, telle que la lecture l'a relevée. */
  const tvaDuDoc = payload?.totals?.vat ? montant(payload.totals.vat, locale) : null;

  /** Le numéro porté par le document, s'il en porte un. */
  const reference = payload?.references
    ? (Object.values(payload.references).find((v) => v && v.trim().length > 0) ?? null)
    : null;
  const blockReason = proposalAttempt && !proposalAttempt.ok ? proposalAttempt.reason : null;

  /* ============================================================ JE LIS
   *
   * L'attente habitée. Une barre de progression mentirait — la lecture n'a
   * pas d'étapes connues d'avance — alors qu'un souffle dit la vérité :
   * je travaille, et je ne sais pas encore pour combien de temps.
   */
  if (read.isPending) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-11 text-center">
        <RegalicaAvatar size={66} alt="Regalica" rond />
        <p className="mt-[26px] text-[19px] leading-[1.5] tracking-[-0.01em]">
          {t("pme.lecture.titre")}
        </p>
        <p className="mt-2 text-[14px] leading-[1.6] text-text-2">{t("pme.lecture.sous")}</p>
        <div className="rg-breathe mt-[30px] h-0.5 w-[130px] bg-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ========================================================= C'EST RÉGLÉ
       *
       * Le pic de soulagement, et il n'arrive qu'UNE fois — à la
       * confirmation. Rouvrir une pièce déjà comptabilisée ne rejoue pas la
       * coche : ce serait fêter deux fois la même chose.
       */}
      {regle ? (
        <section className="flex flex-col items-center px-10 py-6 text-center">
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M4 12.5l5 5L20 6.5" strokeDasharray="34" className="rg-draw" />
          </svg>
          <p className="mt-5 text-[27px] font-semibold tracking-[-0.03em]">
            {t("pme.regle.titre")}
          </p>
          <p className="mt-2.5 max-w-[280px] text-[15px] leading-[1.55] text-text-2">
            {cabinet.data
              ? t("pme.regle.classe.cabinet", { classe: classement, cabinet: cabinet.data.name })
              : t("pme.regle.classe", { classe: classement })}
          </p>
          {tvaDuDoc ? (
            <span className="mt-6 inline-flex items-center gap-2 border border-signal-ok px-3.5 py-2 text-[13px] font-semibold text-signal-ok">
              <span aria-hidden className="h-[5px] w-[5px] bg-current" />
              {payload?.document_kind === "facture_vente"
                ? t("pme.regle.tva.collectee", { montant: tvaDuDoc, devise: pme.currency })
                : t("pme.regle.tva.recuperable", { montant: tvaDuDoc, devise: pme.currency })}
            </span>
          ) : null}
          <Link
            to="/pme/list"
            className="mt-[34px] border-b border-line-strong pb-[3px] text-[13px] font-medium text-muted-foreground"
          >
            {t("pme.regle.voir")}
          </Link>
        </section>
      ) : null}

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{t("pme.piece.title")}</h1>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t(`pme.status.${piece.status}` as MessageKey)} · {piece.source}
        </span>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          {contenu ? (
            <DocumentView contenu={contenu} highlight={zoom} label={t("pme.piece.title")} />
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
                onClick={() => read.mutate()}
                className="mt-4 min-h-[48px] w-full border border-foreground bg-foreground px-4 py-3 text-xs uppercase tracking-wide text-background"
              >
                {t("pme.read.run")}
              </button>
            </div>
          ) : (
            <>
              {/* ===================================================== JE VÉRIFIE
               *
               * Le total d'abord, encadré : c'est la seule chose sur laquelle
               * on demande un avis. Les champs en dessous pointent chacun
               * vers leur zone sur la pièce — la confiance citée vaut mieux
               * qu'un « faites-moi confiance ».
               */}
              {!booked ? (
                <p className="text-[25px] font-semibold leading-[1.15] tracking-[-0.025em]">
                  {t("pme.verifie.titre")}
                </p>
              ) : null}

              <div className="border border-border bg-card">
                <div className="border-b border-border px-4 py-3.5 font-mono text-[11px] leading-[1.85] text-text-2">
                  {payload?.issuer ?? "—"}
                  {reference ? ` · ${reference}` : ""}
                  <br />
                  {t("pme.extract.base")} {lisible(payload?.totals?.base_ht) ?? "—"}
                  <br />
                  {t("pme.extract.vat")} {lisible(payload?.totals?.vat) ?? "—"}
                </div>
                <div className="flex items-center justify-between gap-3 bg-secondary px-4 py-3.5">
                  <span className="text-[13px] font-semibold">{t("pme.verifie.total")}</span>
                  <span className="num border border-foreground px-2.5 py-[3px] text-[17px] font-medium">
                    {payload?.totals?.ttc ? montant(payload.totals.ttc, locale) : "—"}
                  </span>
                </div>
              </div>

              <p className="pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("pme.verifie.source")}
              </p>

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
                  value={jourLisible(payload?.document_date)}
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
                      value={lisible(payload?.totals?.base_ht)}
                      citation={byField.get("totals.base_ht") ?? null}
                      onZoom={setZoom}
                    />
                    <Amount
                      label={t("pme.extract.vat")}
                      value={lisible(payload?.totals?.vat)}
                      citation={byField.get("totals.vat") ?? null}
                      onZoom={setZoom}
                    />
                    <Amount
                      label={t("pme.extract.ttc")}
                      value={lisible(payload?.totals?.ttc)}
                      citation={byField.get("totals.ttc") ?? null}
                      onZoom={setZoom}
                    />
                  </div>
                </div>
              </dl>

              {/* Sa question, pas un ordre : c'est le dirigeant qui tranche. */}
              {!booked ? (
                <div className="flex gap-3 pt-1">
                  <RegalicaAvatar size={32} alt="Regalica" rond />
                  <p className="text-[15px] leading-[1.5]">
                    {payload?.totals?.ttc
                      ? t("pme.verifie.question", {
                          montant: montant(payload.totals.ttc, locale),
                          devise: payload.currency ?? pme.currency,
                        })
                      : t("pme.verifie.question.sansTotal")}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {extraction && !booked ? (
        <section className="flex flex-col gap-0.5">
          <button
            type="button"
            disabled={confirm.isPending || !confirmable}
            onClick={() => confirm.mutate()}
            className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background disabled:opacity-50"
          >
            {confirm.isPending ? t("pme.confirm.pending") : t("pme.verifie.oui")}
          </button>
          <button
            type="button"
            onClick={() => read.mutate()}
            className="h-[50px] w-full text-[16px] font-medium"
          >
            {t("pme.verifie.corriger")}
          </button>
          {!confirmable ? (
            <p className="pt-2 text-center text-[12.5px] text-signal-warn">
              {blockReason ?? t("pme.confirm.review")}
            </p>
          ) : null}
        </section>
      ) : null}

      {booked && !regle ? (
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
