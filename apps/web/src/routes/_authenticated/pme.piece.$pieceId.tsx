import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const [montrerPiece, setPiece] = useState(false);
  const [montrerDetail, setDetail] = useState(false);

  // Qui reçoit la pièce. Sans mandat, elle reste au dossier — et l'écran le
  // dit autrement plutôt que d'inventer un destinataire.
  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const navigate = useNavigate();
  const navigateList = () => navigate({ to: "/pme/list" });

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

  /**
   * Le parcours de la pièce, étape par étape.
   *
   * L'ordre est le NÔTRE : une pièce est comptabilisée avant d'être vue par
   * le cabinet. Reprendre l'ordre de la maquette aurait dessiné un circuit
   * qui n'existe pas dans le produit.
   */
  const rang: Record<string, number> = {
    capturee: 1,
    lue: 2,
    proposee: 3,
    comptabilisee: 4,
    supervisee: 5,
    retournee: 3,
  };
  const atteint = rang[piece.status] ?? 1;
  const etapes = (
    [
      ["recue", 1],
      ["lue", 2],
      ["confirmee", 3],
      ["comptee", 4],
      ["vue", 5],
      ["declaree", 6],
    ] as const
  ).map(([cle, seuil]) => ({
    cle,
    label: t(`pme.parcours.${cle}` as MessageKey),
    // « Déclarée » n'a pas encore d'état dans le produit : elle reste en
    // attente plutôt que de laisser croire que le parcours s'arrête avant.
    etat: seuil > atteint ? "attente" : seuil === atteint ? "courante" : "faite",
  }));

  /** Les articles relevés sur la pièce. Le contrat les porte ; l'écran les montre. */
  const articles = payload?.articles ?? [];

  /** Le numéro porté par le document, s'il en porte un. */
  const reference = payload?.references
    ? (Object.values(payload.references).find((v) => v && v.trim().length > 0) ?? null)
    : null;
  const blockReason = proposalAttempt && !proposalAttempt.ok ? proposalAttempt.reason : null;

  /**
   * Trois lignes, chacune pointant sa source.
   *
   * Le prototype ne montre ni base ni TTC dans le détail : l'émetteur, la
   * date, et LA TVA — parce que c'est la seule des trois qui soit de l'argent
   * pour le dirigeant. Le total, lui, est déjà encadré au-dessus.
   */
  const lignesCitees: Array<{ cle: string; label: string; valeur: string | null; champ: string }> =
    [
      {
        cle: "issuer",
        label: t("pme.extract.issuer"),
        valeur: payload?.issuer ?? null,
        champ: "issuer",
      },
      {
        cle: "date",
        label: t("pme.extract.date"),
        valeur: jourLisible(payload?.document_date),
        champ: "document_date",
      },
      {
        cle: "tva",
        label:
          payload?.document_kind === "facture_vente"
            ? t("pme.verifie.tvaCollectee")
            : t("pme.verifie.tvaRecuperee"),
        valeur: lisible(payload?.totals?.vat),
        champ: "totals.vat",
      },
    ];

  const voirLaSource = (champ: string) => {
    const c = byField.get(champ);
    if (!c) return;
    setZoom(c);
    setPiece(true);
  };

  /* ============================================================== JE LIS
   *
   * Plein écran, sans la barre basse : le prototype la retire pendant la
   * lecture et pendant le soulagement. Ce sont les deux seuls moments où le
   * produit demande qu'on ne fasse rien d'autre.
   *
   * Une barre de progression mentirait — la lecture n'a pas d'étapes connues
   * d'avance. Un souffle dit la vérité : je travaille, et je ne sais pas
   * encore pour combien de temps.
   */
  if (read.isPending) {
    return (
      <div className="rg-rise fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-11 text-center">
        <RegalicaAvatar size={66} alt="Regalica" rond />
        <p className="mt-[26px] text-[19px] leading-[1.5] tracking-[-0.01em]">
          {t("pme.lecture.titre")}
        </p>
        <p className="mt-2 text-[14px] leading-[1.6] text-text-2">{t("pme.lecture.sous")}</p>
        <div className="rg-breathe mt-[30px] h-0.5 w-[130px] bg-foreground" />
        {/*
         * Le prototype annonce « Relevé · 312 mots situés ». On ne l'affiche
         * que lorsqu'un relevé existe déjà — à la relecture d'une pièce. En
         * première lecture le compte n'existe pas encore, et l'inventer
         * contredirait la phrase juste au-dessus.
         */}
        {dossier.data && dossier.data.tokens.length > 0 ? (
          <p className="mt-[26px] font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("pme.lecture.releve", { mots: dossier.data.tokens.length })}
          </p>
        ) : null}
      </div>
    );
  }

  /* ========================================================== C'EST RÉGLÉ
   *
   * Le pic de soulagement, plein écran lui aussi, et il n'arrive qu'UNE fois
   * — à la confirmation. Rouvrir une facture comptabilisée trois jours plus
   * tard ne rejoue pas la coche : on fête la confirmation, pas l'état.
   */
  if (regle) {
    return (
      <div className="rg-rise fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-10 text-center">
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
        <p className="mt-5 text-[27px] font-semibold tracking-[-0.03em]">{t("pme.regle.titre")}</p>
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
        <button
          type="button"
          onClick={() => setRegle(false)}
          className="mt-[34px] border-b border-line-strong pb-[3px] text-[13px] font-medium text-muted-foreground"
        >
          {t("pme.regle.voir")}
        </button>
      </div>
    );
  }

  /* ============================================================ LA PIÈCE
   *
   * La visionneuse n'occupe plus la moitié de l'écran en permanence : le
   * prototype ne la montre nulle part dans le parcours. Elle s'ouvre par
   * « Voir la facture », ou par une source citée — et c'est alors la zone
   * exacte qui s'affiche, ce qui est tout l'intérêt.
   */
  if (montrerPiece) {
    return (
      <div className="fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-3">
          <button
            type="button"
            onClick={() => setPiece(false)}
            className="text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          {zoom ? (
            <span className="num ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
              {zoom.field}
            </span>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-[22px]">
          {contenu ? (
            <DocumentView contenu={contenu} highlight={zoom} label={t("pme.piece.title")} />
          ) : (
            <p className="border border-border bg-card p-4 text-xs text-muted-foreground">
              {t("pme.doc.error")}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ====================================================== LE DÉTAIL DES LIGNES
   *
   * Ce que le dirigeant reconnaît. Il se souvient d'avoir acheté trois cents
   * ramettes, pas d'un total hors taxe — et c'est en relisant les
   * désignations et les prix unitaires qu'il repère une erreur de lecture que
   * les totaux, eux, ne trahissent pas.
   *
   * Les articles viennent du contrat de lecture, jamais d'une saisie.
   */
  if (montrerDetail) {
    return (
      <div className="fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-3">
          <button
            type="button"
            onClick={() => setDetail(false)}
            className="text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          <span className="num ms-auto text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("pme.detail.compte", { count: articles.length })}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-[22px] py-4">
          <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {t("pme.detail.titre")}
          </p>
          {articles.length === 0 ? (
            <p className="mt-4 border border-border bg-card p-4 text-[13.5px] leading-[1.55] text-text-2">
              {t("pme.detail.aucun")}
            </p>
          ) : (
            <div className="mt-4">
              {articles.map((a, i) => (
                <div key={i} className="border-t border-border py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-medium">{a.designation}</span>
                    <span className="num flex-none text-[13.5px] font-medium">
                      {lisible(a.total_ht ?? undefined) ?? "—"}
                    </span>
                  </div>
                  <p className="num mt-1 text-[11.5px] text-muted-foreground">
                    {a.quantity ? t("pme.detail.qte", { q: a.quantity }) : t("pme.detail.sansQte")}
                    {a.unit_price_ht
                      ? " · " + t("pme.detail.pu", { pu: lisible(a.unit_price_ht) ?? "—" })
                      : ""}
                    {a.tax_code ? " · " + a.tax_code : ""}
                  </p>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-foreground py-3">
                <span className="text-[13.5px] font-semibold">{t("pme.extract.base")}</span>
                <span className="num text-[13.5px] font-semibold">
                  {lisible(payload?.totals?.base_ht) ?? "—"}
                </span>
              </div>
            </div>
          )}
          <p className="mt-4 text-[11.5px] leading-[1.5] text-muted-foreground">
            {t("pme.detail.provenance")}
          </p>
        </div>
      </div>
    );
  }

  /* ========================================================= PAS ENCORE LUE */
  if (!extraction) {
    return (
      <div className="rg-rise flex flex-col gap-4 px-1 pt-2">
        <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.piece.title")}
        </p>
        <p className="text-[13.5px] leading-[1.55] text-text-2">{t("pme.read.none")}</p>
        <button
          type="button"
          onClick={() => read.mutate()}
          className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background"
        >
          {t("pme.read.run")}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPiece(true)}
            className="h-[48px] border border-border text-[14px] font-medium"
          >
            {t("pme.piece.voir")}
          </button>
          <button
            type="button"
            onClick={() => setDetail(true)}
            className="h-[48px] border border-border text-[14px] font-medium"
          >
            {t("pme.detail.voir")}
          </button>
        </div>
        {error ? <p className="text-xs text-signal-warn">{error}</p> : null}
      </div>
    );
  }

  /* ============================================== JE VÉRIFIE  /  LA PIÈCE LUE
   *
   * Une seule colonne, comme le prototype. Avant confirmation c'est une
   * question ; après, c'est le parcours de la pièce en une ligne.
   */
  return (
    <div className="rg-rise flex flex-col gap-0 px-1 pt-2">
      {booked ? (
        <>
          <button
            type="button"
            onClick={() => void navigateList()}
            className="self-start text-[13px] font-medium text-text-2"
          >
            ‹ {t("pme.piece.retour")}
          </button>
          <p className="mt-3 text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
            {payload?.issuer ?? t("pme.piece.title")}
          </p>
          <p className="num mt-[5px] text-[13.5px] font-medium text-text-2">
            {reference ? reference + " · " : ""}
            {lisible(payload?.totals?.ttc) ?? "—"} {payload?.currency ?? pme.currency}
          </p>
          <Parcours etapes={etapes} />
        </>
      ) : (
        <p className="text-[25px] font-semibold leading-[1.15] tracking-[-0.025em]">
          {t("pme.verifie.titre.1")}
          <br />
          {t("pme.verifie.titre.2")}
        </p>
      )}

      {/* Ce que la lecture a relevé, brut, tel que la pièce le dit. */}
      <div className="mt-4 border border-border bg-card">
        <div className="border-b border-border px-4 py-3.5 font-mono text-[11px] leading-[1.85] text-text-2">
          {payload?.issuer ?? "—"}
          {reference ? " · " + reference : ""}
          <br />
          {t("pme.extract.base")} {lisible(payload?.totals?.base_ht) ?? "—"}
          <br />
          {t("pme.extract.vat")} {lisible(payload?.totals?.vat) ?? "—"}
        </div>
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 py-3.5">
          <span className="text-[13px] font-semibold">{t("pme.verifie.total")}</span>
          <span className="num border border-foreground px-2.5 py-[3px] text-[17px] font-medium">
            {lisible(payload?.totals?.ttc) ?? "—"}
          </span>
        </div>
      </div>

      <div className="mt-[22px] flex items-baseline justify-between gap-3 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {booked ? t("pme.piece.jaiLu") : t("pme.verifie.source")}
        </p>
        {articles.length > 0 ? (
          <button
            type="button"
            onClick={() => setDetail(true)}
            className="border-b border-dotted border-current text-[11px] font-medium text-signal-info"
          >
            {t("pme.detail.voir")}
          </button>
        ) : null}
      </div>

      {lignesCitees.map((l) => (
        <div
          key={l.cle}
          className="flex items-center justify-between gap-3 border-t border-border py-[11px]"
        >
          <span className="text-[13.5px] text-text-2">{l.label}</span>
          <span className="num text-[13.5px] font-medium">
            {l.valeur ?? "—"}
            {byField.get(l.champ) ? (
              <button
                type="button"
                onClick={() => voirLaSource(l.champ)}
                className="ms-2 border-b border-dotted border-current text-[11px] font-medium text-signal-info"
              >
                {t("pme.citation.source")}
              </button>
            ) : null}
          </span>
        </div>
      ))}

      {booked ? (
        <div className="flex items-center justify-between gap-3 border-t border-foreground py-3">
          <span className="text-[13.5px] font-semibold">{t("pme.piece.classee")}</span>
          <span className="text-[13.5px]">{classement}</span>
        </div>
      ) : null}

      {/* Sa question, pas un ordre : c'est le dirigeant qui tranche. */}
      {!booked ? (
        <div className="mt-5 flex gap-3">
          <RegalicaAvatar size={32} alt="Regalica" rond />
          <p className="text-[15px] leading-[1.5]">
            {payload?.totals?.ttc
              ? t("pme.verifie.question", {
                  montant: lisible(payload.totals.ttc) ?? "",
                  devise: payload.currency ?? pme.currency,
                })
              : t("pme.verifie.question.sansTotal")}
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-signal-warn">{error}</p> : null}

      <div className="mt-6 flex flex-col gap-0.5 pb-2">
        {booked ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPiece(true)}
              className="h-12 bg-foreground text-[14px] font-semibold text-background"
            >
              {t("pme.piece.voir")}
            </button>
            <button
              type="button"
              onClick={() => setDetail(true)}
              className="h-12 border border-foreground text-[14px] font-semibold"
            >
              {t("pme.detail.voir")}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={confirm.isPending || !confirmable}
              onClick={() => confirm.mutate()}
              className="h-[54px] w-full bg-foreground text-[16px] font-semibold text-background disabled:opacity-50"
            >
              {confirm.isPending ? t("pme.confirm.pending") : t("pme.verifie.oui")}
            </button>
            {/*
             * « Corriger » reprend la PHOTO, comme le prototype. Relancer la
             * lecture serait de toute façon refusé : R7 interdit d'effacer un
             * relevé, et c'est par là que commence `capture_read_persist`.
             */}
            <button
              type="button"
              onClick={pme.ouvrirScanner}
              className="h-[50px] w-full text-[16px] font-medium"
            >
              {t("pme.verifie.corriger")}
            </button>
            {!confirmable ? (
              <p className="pt-2 text-center text-[12.5px] text-signal-warn">
                {blockReason ?? t("pme.confirm.review")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Le parcours d'une pièce, en une ligne.
 *
 * Les six étapes sont celles du prototype, dans NOTRE ordre : chez nous une
 * pièce est comptabilisée avant d'être vue par le cabinet, pas l'inverse.
 * Garder l'ordre de la maquette aurait dessiné un circuit qui n'existe pas.
 *
 * « Déclarée » reste toujours en attente : rien dans le produit ne marque
 * encore qu'une pièce est partie avec une déclaration. Une étape grise qui
 * dit « pas encore » vaut mieux qu'une étape absente qui laisse croire que le
 * parcours s'arrête là.
 */
function Parcours({ etapes }: { etapes: Array<{ cle: string; label: string; etat: string }> }) {
  return (
    <div className="relative mt-[22px] grid grid-cols-6 items-start">
      <span aria-hidden className="absolute inset-x-[8%] top-[5px] h-px bg-line-strong" />
      {etapes.map((e) => (
        <span key={e.cle} className="relative flex flex-col items-center gap-2">
          <span
            aria-hidden
            className={
              e.etat === "courante"
                ? "h-[13px] w-[13px] -mt-px bg-marigold"
                : e.etat === "faite"
                  ? "h-[11px] w-[11px] bg-foreground"
                  : "h-[11px] w-[11px] border-[1.5px] border-line-strong bg-background"
            }
          />
          <span
            className={
              "text-center text-[8.5px] font-semibold uppercase tracking-[0.06em] " +
              (e.etat === "courante"
                ? "text-marigold"
                : e.etat === "faite"
                  ? ""
                  : "text-muted-foreground")
            }
          >
            {e.label}
          </span>
        </span>
      ))}
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
