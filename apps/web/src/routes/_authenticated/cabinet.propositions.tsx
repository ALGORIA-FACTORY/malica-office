/**
 * Propositions du Socle — la validation en masse, par client.
 *
 * ============================================================== POURQUOI
 *
 * L'écran du design : trois lots par confiance de lecture, puis un lot par
 * client avec son écriture en masse (ce qui sera comptabilisé, compte par
 * compte), la liste des pièces à retenir, et la possibilité de forcer
 * l'imputation du lot sur un autre compte — par contre-passation puis
 * réimputation, jamais par modification.
 *
 * Tout est réel : les seuils sont ceux du cabinet (réglés en base, pas dans
 * l'écran), la confiance est celle que le désignateur a rendue et que la
 * base a gardée, l'écriture en masse est l'agrégat exact des écritures du
 * Socle, et chaque geste passe par les méthodes que la revue emploie déjà.
 *
 * ========================= CE QU'UNE PIÈCE LUE PAR UNE RECETTE N'AFFICHE PAS
 *
 * Aucun pourcentage. Une pièce lue par une recette porte
 * `overall_confidence = 1`, parce qu'une recette ne produit AUCUN score : le
 * neutre du minimum est passé explicitement au point d'appel, et il signifie
 * « la désignation n'abaisse rien », jamais « sûr à cent pour cent ». Cet
 * écran l'affichait pourtant « 100 % » sous « Confiance min. » et rangeait la
 * pièce dans les validables d'un geste — un expert aurait validé en masse des
 * pièces présentées comme certaines, sur un chiffre qui ne signifiait rien.
 *
 * Elle dit donc ce qu'elle est : lue par un lecteur spécialisé, dont chaque
 * champ désigné est relu dans le plan de jetons. C'est une information plus
 * forte qu'un score, et elle a son propre lot — qui ne se valide pas d'un
 * geste, parce qu'aucune confiance ne l'y autorise.
 *
 * `fabrique.piecesLuesParRecette` est la seule source de ce fait :
 * `fabrique.executions`, issue `designation`. Une abstention rend la main à la
 * chaîne, la pièce est lue par le modèle, et elle est mesurée comme avant.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { EmptyState, MalicaNote, SectionTitle, EnTeteCabinet } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { initialesDe } from "@/lib/initiales";
import { montant } from "@/lib/lisible";
import { compteDeCharge, ecritureEnMasse, lotDe, type Lot } from "@/lib/propositions";
import { sommeDecimale } from "@malica/socle/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { CompteDuPlan, Ecriture, QueueItem } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/propositions")({
  head: () => ({
    meta: [
      { title: "Propositions du Socle — Malica Office" },
      {
        name: "description",
        content:
          "Les écritures comptabilisées sur les pièces lues, groupées par confiance et par client : validation d'un geste, ou réimputation gouvernée.",
      },
      { property: "og:title", content: "Propositions du Socle — Malica Office" },
      {
        property: "og:description",
        content: "Validation en masse par client, écriture en masse, réimputation gouvernée.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetPropositions,
});

function CabinetPropositions() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  const motifs = useQuery({
    queryKey: ["cab-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });

  const rows = useMemo(
    () => (queue.data ?? []).filter((r) => r.status === "comptabilisee" && r.ecritureId),
    [queue.data],
  );
  const idsEcritures = useMemo(() => rows.map((r) => r.ecritureId!).sort(), [rows]);
  const ecritures = useQuery({
    queryKey: ["cab-ecritures", idsEcritures],
    queryFn: () => office().office.ecrituresByIds(idsEcritures),
    enabled: idsEcritures.length > 0,
  });
  const ecritureDe = useMemo(
    () => new Map((ecritures.data ?? []).map((e) => [e.id, e])),
    [ecritures.data],
  );

  /* ---- lesquelles une RECETTE a lues. Sans ce fait, leur neutre de confiance
          se lirait « 100 % » et le lot se validerait d'un geste. */
  const idsPieces = useMemo(() => rows.map((r) => r.pieceId).sort(), [rows]);
  const parRecette = useQuery({
    queryKey: ["cab-par-recette", idsPieces],
    queryFn: () => office().fabrique.piecesLuesParRecette(idsPieces),
    enabled: idsPieces.length > 0,
  });
  const lecteurDe = useMemo(
    () => new Map((parRecette.data ?? []).map((p) => [p.pieceId, p])),
    [parRecette.data],
  );
  const lueParRecette = (pieceId: string) => lecteurDe.has(pieceId);

  useMalicaPanel(
    <MalicaNote kicker={t("cab.prop.panel.kicker")}>
      {t("cab.prop.panel", { count: rows.length })}
    </MalicaNote>,
    [rows.length, locale],
  );

  /* ---- la sélection */
  const [retenues, setRetenues] = useState<Record<string, boolean>>({});
  const estRetenue = (id: string) => Boolean(retenues[id]);
  const retenir = (ids: string[], valeur: boolean) =>
    setRetenues((r) => {
      const suivant = { ...r };
      for (const id of ids) suivant[id] = valeur;
      return suivant;
    });
  const selection = rows.filter((r) => estRetenue(r.pieceId));

  /* ---- les lots par confiance, selon les seuils du cabinet */
  const seuilLot = reglages.data?.seuilConfianceLot ?? null;
  const seuilRevue = reglages.data?.seuilConfianceRevue ?? null;
  const lots = useMemo(() => {
    const carte: Record<Lot, QueueItem[]> = {
      recette: [],
      haut: [],
      moyen: [],
      bas: [],
      sans: [],
    };
    if (seuilLot === null || seuilRevue === null) return carte;
    for (const r of rows)
      carte[lotDe(r.confiance, seuilLot, seuilRevue, lecteurDe.has(r.pieceId))].push(r);
    return carte;
  }, [rows, seuilLot, seuilRevue, lecteurDe]);

  /* ---- les groupes par client */
  const collabDe = useMemo(() => {
    const parUser = new Map((membres.data ?? []).map((m) => [m.userId, m.email]));
    const carte = new Map<string, string>();
    for (const a of (affectations.data ?? []).filter((x) => x.active)) {
      const email = parUser.get(a.collaboratorId);
      if (email && !carte.has(a.clientTenantId)) carte.set(a.clientTenantId, email);
    }
    return carte;
  }, [membres.data, affectations.data]);
  const groupes = useMemo(() => {
    const carte = new Map<string, QueueItem[]>();
    for (const r of rows) carte.set(r.tenantId, [...(carte.get(r.tenantId) ?? []), r]);
    return [...carte.entries()].map(([tenantId, pieces]) => ({
      tenantId,
      client: pieces[0]!.clientName,
      legalId: (clients.data ?? []).find((c) => c.tenantId === tenantId)?.legalId ?? null,
      collab: collabDe.get(tenantId) ?? null,
      pieces,
    }));
  }, [rows, clients.data, collabDe]);

  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ validees: number; forcees: number } | null>(null);

  /* ---- valider : chaque écriture, par la méthode de la revue */
  const valider = useMutation({
    mutationFn: async (pieces: QueueItem[]) => {
      let n = 0;
      for (const p of pieces) {
        if (!p.ecritureId) continue;
        await office().supervision.review({ ecritureId: p.ecritureId, outcome: "valide" });
        n += 1;
      }
      return n;
    },
    onSuccess: async (n) => {
      setErreur(null);
      setFait({ validees: n, forcees: 0 });
      setRetenues({});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
      ]);
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.propositions", t("common.error"))),
  });

  /* ---- forcer : contre-passer, réimputer, comptabiliser — pièce par pièce */
  const forcer = useMutation({
    mutationFn: async (input: {
      pieces: QueueItem[];
      compte: CompteDuPlan;
      motifId: string;
      note: string | null;
    }) => {
      let n = 0;
      for (const p of input.pieces) {
        const e = p.ecritureId ? ecritureDe.get(p.ecritureId) : undefined;
        if (!e) continue;
        const lignes = e.lines.map((l) => ({
          account_code: l.accountCode.startsWith("6") ? input.compte.code : l.accountCode,
          libelle: l.accountCode.startsWith("6") ? input.compte.libelle : l.libelle,
          debit: l.debit,
          credit: l.credit,
          tax_code: l.taxCode,
        }));
        // Une pièce = une transaction : contre-passation et réimputation
        // passent ensemble, ou rien n'est écrit pour cette pièce.
        await office().office.corrigerLImputation({
          ecritureId: e.id,
          motifId: input.motifId,
          note: input.note,
          libelle: e.libelle,
          lignes,
        });
        n += 1;
      }
      return n;
    },
    onSuccess: async (n) => {
      setErreur(null);
      setFait({ validees: 0, forcees: n });
      setRetenues({});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-ecritures"] }),
      ]);
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.propositions", t("common.error"))),
  });

  const pourcent = (v: number) => Math.round(v * 100);
  const totalDe = (pieces: QueueItem[]) =>
    sommeDecimale(pieces.map((p) => p.montant).filter((m): m is string => m !== null));
  const occupe = valider.isPending || forcer.isPending;

  const cartesDeLot: Array<{ lot: Lot; label: string; note: string; action: string }> =
    seuilLot !== null && seuilRevue !== null
      ? [
          /*
           * Le lot des lectures par recette vient en TÊTE, et son action est
           * d'ouvrir, jamais de retenir : ce qu'on sait d'elles est plus fort
           * qu'un score, mais ce n'est pas une confiance, et rien ne permet de
           * les valider en masse à ce titre.
           */
          {
            lot: "recette",
            label: t("cab.prop.lot.recette"),
            note: t("cab.prop.lot.recette.note"),
            action: t("cab.prop.lot.ouvrir"),
          },
          {
            lot: "haut",
            label: t("cab.prop.lot.haut", { seuil: pourcent(seuilLot) }),
            note: t("cab.prop.lot.haut.note"),
            action: t("cab.prop.lot.retenir"),
          },
          {
            lot: "moyen",
            label: t("cab.prop.lot.moyen", { bas: pourcent(seuilRevue), haut: pourcent(seuilLot) }),
            note: t("cab.prop.lot.moyen.note"),
            action: t("cab.prop.lot.revoir"),
          },
          {
            lot: "bas",
            label: t("cab.prop.lot.bas", { seuil: pourcent(seuilRevue) }),
            note: t("cab.prop.lot.bas.note"),
            action: t("cab.prop.lot.ouvrir"),
          },
          {
            lot: "sans",
            label: t("cab.prop.lot.sans"),
            note: t("cab.prop.lot.sans.note"),
            action: t("cab.prop.lot.ouvrir"),
          },
        ]
      : [];

  return (
    <div className="space-y-8 pb-24">
      <EnTeteCabinet
        surtitre={<>{t("cab.prop.kicker")}</>}
        titre={<>{t("cab.prop.titre")}</>}
        chapeau={<>{t("cab.prop.doctrine")}</>}
      />

      {fait ? (
        <p className="border border-border bg-card px-4 py-3 text-[13px]">
          {fait.validees > 0
            ? t("cab.prop.done", { count: fait.validees })
            : t("cab.prop.forces", { count: fait.forcees })}
        </p>
      ) : null}
      {erreur ? <p className="text-[12.5px] text-signal-warn">{erreur}</p> : null}

      {/* ---- les lots par confiance */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cartesDeLot.map((c) => {
          const pieces = lots[c.lot];
          const premiere = pieces[0] ?? null;
          return (
            <div key={c.lot} className="flex flex-col border border-border bg-card p-4">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {c.label}
              </p>
              <p
                className={cn(
                  "num mt-2 text-[30px] leading-none",
                  pieces.length === 0 ? "text-muted-foreground" : "",
                )}
              >
                {pieces.length}
              </p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">{c.note}</p>
              <div className="mt-3">
                {c.lot === "haut" ? (
                  <button
                    type="button"
                    disabled={pieces.length === 0}
                    onClick={() =>
                      retenir(
                        pieces.map((p) => p.pieceId),
                        true,
                      )
                    }
                    className="border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
                  >
                    {c.action}
                  </button>
                ) : premiere ? (
                  <Link
                    to="/cabinet/piece/$pieceId"
                    params={{ pieceId: premiere.pieceId }}
                    className="inline-block border border-border bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] hover:bg-accent"
                  >
                    {c.action}
                  </Link>
                ) : (
                  <span className="inline-block border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground opacity-50">
                    {c.action}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* La phrase qui remplace le pourcentage, en toutes lettres. Elle ne
          paraît que s'il y a de telles pièces : une doctrine affichée dans le
          vide est du texte de façade. */}
      {lots.recette.length > 0 ? (
        <p className="max-w-[70ch] border border-s-2 border-border border-s-marigold bg-card px-4 py-3 text-[12.5px] leading-[1.55] text-text-2">
          {t("cab.prop.confiance.parRecette.pourquoi")}
        </p>
      ) : null}

      {/* ---- les groupes par client */}
      <section className="space-y-3">
        <SectionTitle
          action={
            <span className="num text-[11px] text-muted-foreground">
              {t("cab.prop.groupes.compte", { clients: groupes.length, pieces: rows.length })}
            </span>
          }
        >
          {t("cab.prop.groupes.titre")}
        </SectionTitle>
        <p className="max-w-[70ch] text-[12.5px] leading-[1.5] text-text-2">
          {t("cab.prop.groupes.doctrine")}
        </p>

        {queue.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : groupes.length === 0 ? (
          <EmptyState>{t("cab.prop.empty")}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {groupes.map((g) => (
              <GroupeClient
                key={g.tenantId}
                groupe={g}
                ouvert={Boolean(ouverts[g.tenantId])}
                basculer={() => setOuverts((o) => ({ ...o, [g.tenantId]: !o[g.tenantId] }))}
                estRetenue={estRetenue}
                retenir={retenir}
                ecritureDe={ecritureDe}
                lueParRecette={lueParRecette}
                motifs={motifs.data ?? []}
                occupe={occupe}
                valider={(pieces) => valider.mutate(pieces)}
                forcer={(input) => forcer.mutate(input)}
                totalDe={totalDe}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- le pied : la sélection, tous clients confondus */}
      {selection.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-foreground bg-background/95 backdrop-blur lg:start-[254px] lg:end-[320px]">
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-9">
            <span className="text-[13px]">
              {t("cab.prop.pied.retenues", { count: selection.length })}
              <span className="num"> · {montant(totalDe(selection), locale)}</span>
            </span>
            <span className="num text-[11px] text-muted-foreground">
              {t("cab.prop.pied.clients", {
                count: new Set(selection.map((s) => s.tenantId)).size,
              })}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setRetenues({})}
              className="text-[11px] font-semibold uppercase tracking-[0.14em] underline"
            >
              {t("cab.prop.pied.deselectionner")}
            </button>
            <button
              type="button"
              disabled={occupe}
              onClick={() => valider.mutate(selection)}
              className="border border-foreground bg-foreground px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
            >
              {occupe ? t("common.loading") : t("cab.prop.pied.comptabiliser")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroupeClient({
  groupe,
  ouvert,
  basculer,
  estRetenue,
  retenir,
  ecritureDe,
  lueParRecette,
  motifs,
  occupe,
  valider,
  forcer,
  totalDe,
  locale,
}: {
  groupe: {
    tenantId: string;
    client: string;
    legalId: string | null;
    collab: string | null;
    pieces: QueueItem[];
  };
  ouvert: boolean;
  basculer: () => void;
  estRetenue: (id: string) => boolean;
  retenir: (ids: string[], valeur: boolean) => void;
  ecritureDe: Map<string, Ecriture>;
  /** Vrai quand une RECETTE a lu cette pièce : alors aucun pourcentage ne s'affiche. */
  lueParRecette: (pieceId: string) => boolean;
  motifs: Array<{ id: string; label: string; requiresNote: boolean }>;
  occupe: boolean;
  valider: (pieces: QueueItem[]) => void;
  forcer: (input: {
    pieces: QueueItem[];
    compte: CompteDuPlan;
    motifId: string;
    note: string | null;
  }) => void;
  totalDe: (pieces: QueueItem[]) => string;
  locale: string;
}) {
  const { t } = useI18n();
  const retenues = groupe.pieces.filter((p) => estRetenue(p.pieceId));
  const toutes = retenues.length === groupe.pieces.length;
  const retenuesOuToutes = retenues.length > 0 ? retenues : groupe.pieces;

  const ecritures = retenuesOuToutes
    .map((p) => (p.ecritureId ? ecritureDe.get(p.ecritureId) : undefined))
    .filter((e): e is Ecriture => e !== undefined);
  const masse = useMemo(() => ecritureEnMasse(ecritures), [ecritures]);
  const totalDebit = sommeDecimale(masse.map((m) => m.debit));
  /*
   * La confiance minimale du lot ne se calcule que sur les pièces qui en ont
   * une. Une pièce lue par une recette porte le NEUTRE du minimum — elle ne
   * mesure rien, et la faire entrer dans ce minimum le relèverait à 1 dès
   * qu'elle est seule, ou le laisserait croire mesuré alors qu'il ne l'est pas.
   */
  const mesurees = groupe.pieces.filter((p) => !lueParRecette(p.pieceId));
  const confiances = mesurees.map((p) => p.confiance).filter((c): c is number => c !== null);
  const confianceMin = confiances.length > 0 ? Math.min(...confiances) : null;
  const toutesParRecette = mesurees.length === 0 && groupe.pieces.length > 0;

  // Le plan de charge du CLIENT, pour le compte de destination — chargé quand
  // le lot s'ouvre, jamais avant.
  const plan = useQuery({
    queryKey: ["plan-charges", groupe.tenantId],
    queryFn: () => office().parametrage.plan(groupe.tenantId, [6]),
    enabled: ouvert,
  });
  const [compte, setCompte] = useState("");
  const [motifId, setMotifId] = useState("");
  const [note, setNote] = useState("");
  const motif = motifs.find((m) => m.id === motifId) ?? null;
  const compteChoisi = (plan.data ?? []).find((c) => c.code === compte) ?? null;
  const pret =
    Boolean(compteChoisi) &&
    Boolean(motif) &&
    retenues.length > 0 &&
    (!motif?.requiresNote || note.trim().length > 0);

  return (
    <li className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-4 px-4 py-3">
        <input
          type="checkbox"
          checked={toutes}
          onChange={(e) =>
            retenir(
              groupe.pieces.map((p) => p.pieceId),
              e.target.checked,
            )
          }
          aria-label={t("cab.prop.groupe.tout", { client: groupe.client })}
          className="h-[13px] w-[13px] accent-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{groupe.client}</p>
          <p className="num mt-0.5 text-[10.5px] text-muted-foreground">
            {groupe.legalId ?? "—"}
            {groupe.collab ? ` · ${initialesDe(groupe.collab)} ${groupe.collab}` : ""}
          </p>
        </div>
        <div className="flex gap-6">
          <Chiffre label={t("cab.prop.groupe.pieces")} valeur={String(groupe.pieces.length)} />
          <Chiffre
            label={t("cab.prop.groupe.total")}
            valeur={montant(totalDe(groupe.pieces), locale)}
          />
          <Chiffre
            label={t("cab.prop.groupe.confiance")}
            valeur={
              confianceMin !== null
                ? `${Math.round(confianceMin * 100)} %`
                : toutesParRecette
                  ? t("cab.prop.confiance.parRecette.lot")
                  : t("cab.prop.confiance.absente")
            }
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={basculer}
            aria-expanded={ouvert}
            className="border border-border bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] hover:bg-accent"
          >
            {ouvert ? t("cab.prop.groupe.fermer") : t("cab.prop.groupe.ouvrir")}
          </button>
          <button
            type="button"
            disabled={occupe}
            onClick={() => valider(retenuesOuToutes)}
            className="border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
          >
            {t("cab.prop.groupe.valider")}
          </button>
        </div>
      </div>

      {ouvert ? (
        <div className="grid gap-6 border-t border-border p-4 xl:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0 space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.16em]">
                  {t("cab.prop.masse.titre")}
                </h3>
                <span className="num text-[10.5px] text-muted-foreground">
                  {ecritures[0] ? `${ecritures[0].journal} · ${ecritures[0].devise}` : ""}
                </span>
              </div>
              <div className="mt-2 overflow-x-auto border border-border">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-foreground text-start text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <th className="px-3 py-2 text-start">{t("cab.prop.masse.compte")}</th>
                      <th className="px-3 py-2 text-end">{t("cab.prop.masse.pieces")}</th>
                      <th className="px-3 py-2 text-end">{t("cab.prop.masse.debit")}</th>
                      <th className="px-3 py-2 text-end">{t("cab.prop.masse.credit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masse.map((m) => (
                      <tr key={m.compte} className="border-b border-border">
                        <td className="px-3 py-2">
                          <span className="num">{m.compte}</span>{" "}
                          <span className="text-muted-foreground">{m.libelle}</span>
                        </td>
                        <td className="num px-3 py-2 text-end">{m.pieces}</td>
                        <td className="num px-3 py-2 text-end">{montant(m.debit, locale)}</td>
                        <td className="num px-3 py-2 text-end">{montant(m.credit, locale)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="px-3 py-2">
                        {t("cab.prop.masse.equilibre", { n: retenuesOuToutes.length })}
                      </td>
                      <td className="num px-3 py-2 text-end">{retenuesOuToutes.length}</td>
                      <td className="num px-3 py-2 text-end">{montant(totalDebit, locale)}</td>
                      <td className="num px-3 py-2 text-end">
                        {montant(sommeDecimale(masse.map((m) => m.credit)), locale)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("cab.prop.masse.listeTitre")}
              </p>
              <ul className="mt-2 divide-y divide-border border border-border">
                {groupe.pieces.map((p) => {
                  const e = p.ecritureId ? ecritureDe.get(p.ecritureId) : undefined;
                  const charge = e ? compteDeCharge(e) : null;
                  return (
                    <li key={p.pieceId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={estRetenue(p.pieceId)}
                        onChange={(ev) => retenir([p.pieceId], ev.target.checked)}
                        aria-label={p.libelle ?? t("cab.queue.unread")}
                        className="h-[13px] w-[13px] accent-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {p.libelle ?? "—"}
                      </span>
                      <span className="num hidden text-[11px] text-muted-foreground md:inline">
                        {charge ? `${charge.accountCode} ${charge.libelle}` : "—"}
                      </span>
                      <span className="num text-[12.5px]">
                        {p.montant ? montant(p.montant, locale) : "—"}
                      </span>
                      {/* Aucun pourcentage sur une lecture par recette : le
                          chiffre existerait, et il ne signifierait rien. */}
                      <span
                        className={cn(
                          "w-24 text-end text-[10.5px] text-muted-foreground",
                          lueParRecette(p.pieceId) ? "" : "num",
                        )}
                      >
                        {lueParRecette(p.pieceId)
                          ? t("cab.prop.confiance.parRecette")
                          : p.confiance === null
                            ? t("cab.prop.confiance.absente")
                            : `${Math.round(p.confiance * 100)} %`}
                      </span>
                      <Link
                        to="/cabinet/piece/$pieceId"
                        params={{ pieceId: p.pieceId }}
                        className="border border-border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
                      >
                        {t("cab.prop.masse.voir")}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="space-y-3 border border-s-2 border-border border-s-marigold bg-background p-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-marigold">
              {t("cab.prop.force.titre")}
            </p>
            <p className="text-[12px] leading-[1.5] text-text-2">{t("cab.prop.force.doctrine")}</p>
            <label className="block">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("cab.prop.force.compte")}
              </span>
              <select
                value={compte}
                onChange={(e) => setCompte(e.target.value)}
                className="mt-1 w-full border border-border bg-card px-2 py-1.5 text-[12.5px]"
              >
                <option value="">{t("cab.prop.force.garder")}</option>
                {(plan.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.libelle}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("cab.prop.force.motif")}
              </span>
              <select
                value={motifId}
                onChange={(e) => setMotifId(e.target.value)}
                className="mt-1 w-full border border-border bg-card px-2 py-1.5 text-[12.5px]"
              >
                <option value="">{t("cab.review.motif.choose")}</option>
                {motifs.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {motif?.requiresNote ? (
              <label className="block">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("cab.prop.force.note")}
                </span>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full border border-border bg-card px-2 py-1.5 text-[12.5px]"
                />
              </label>
            ) : null}
            {!pret ? (
              <p className="text-[11px] text-muted-foreground">{t("cab.prop.force.manque")}</p>
            ) : null}
            <button
              type="button"
              disabled={!pret || occupe}
              onClick={() =>
                compteChoisi &&
                forcer({
                  pieces: retenues,
                  compte: compteChoisi,
                  motifId,
                  note: note.trim() ? note.trim() : null,
                })
              }
              className="border border-foreground bg-foreground px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("cab.prop.force.action")}
            </button>
            <p className="text-[11px] leading-[1.5] text-muted-foreground">
              {t("cab.prop.force.regle")}
            </p>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Chiffre({ label, valeur }: { label: string; valeur: string }) {
  return (
    <span className="text-end">
      <span className="num block text-[15px] font-semibold">{valeur}</span>
      <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
    </span>
  );
}
