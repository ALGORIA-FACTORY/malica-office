/**
 * La file du cabinet en piles (maquette « Malica Comptabilité », approuvée le
 * 8 novembre 2026). Relevé sur staging : 109 lignes à plat, 41,6 écrans à
 * faire défiler sur un téléphone de 320 px. Une pile dit ce qu'il y a à faire,
 * et s'ouvre par client et fournisseur. Le détail d'un groupe se déplie.
 */
import type { QueueItem } from "@malica/socle/ports/repositories";
import { MOTIF_LONGUEUR_MAX } from "@malica/socle/circuit";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { TelechargerDossierComptable } from "@/components/malica/telecharger-dossier-comptable";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import {
  groupesDeLaPile,
  joursDAttente,
  pileDe,
  PILES,
  type PileDeLaFile,
} from "@/lib/file-cabinet";
import { initialesDe } from "@/lib/initiales";
import { montant } from "@/lib/lisible";
import { MOT_CABINET } from "@/lib/statut";
import { office } from "@/verticals/malica-office/composition";

const TITRE: Record<PileDeLaFile, MessageKey> = {
  demandes: "cab.pile.demandes",
  pretes: "cab.pile.pretes",
  a_completer: "cab.pile.a_completer",
  retournees: "cab.pile.retournees",
  lecture: "cab.pile.lecture",
  prises: "cab.pile.prises",
};
const AIDE: Record<PileDeLaFile, MessageKey> = {
  demandes: "cab.pile.demandes.aide",
  pretes: "cab.pile.pretes.aide",
  a_completer: "cab.pile.a_completer.aide",
  retournees: "cab.pile.retournees.aide",
  lecture: "cab.pile.lecture.aide",
  prises: "cab.pile.prises.aide",
};

/** Une pièce de la file : sa page, ce qu'elle est, où elle en est, depuis quand. */
function LigneDePiece({
  piece,
  titre,
  client,
  cabinetId,
}: {
  piece: QueueItem;
  titre: string;
  client: string;
  cabinetId: string;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const objet = piece.demandeEnAttente ?? null;
  const repondre = useMutation({
    mutationFn: (accorde: boolean) =>
      office().collab.repondreSurPiece(
        piece.pieceId,
        objet!,
        accorde,
        accorde ? null : motif.trim(),
      ),
    onMutate: () => setErreur(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cab-queue", cabinetId] }),
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/file-en-piles", t("common.error"))),
  });
  const m = piece.montant ?? piece.montantLu;
  const jours = joursDAttente(piece.envoyeeLe);
  return (
    <div>
      <Link
        to="/cabinet/piece/$pieceId"
        params={{ pieceId: piece.pieceId }}
        className="flex min-h-[60px] items-center gap-3 px-4 py-2 hover:bg-accent"
      >
        <ApercuDePiece pieceId={piece.pieceId} className="vignette shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] [overflow-wrap:anywhere]">{titre}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span>{client}</span>
            <span>{t(MOT_CABINET[piece.statut])}</span>
            <span>
              {jours === 0 ? t("cab.queue.age.today") : t("cab.queue.age.days", { n: jours })}
            </span>
            {piece.collaborateur ? (
              <span className="num" title={piece.collaborateur}>
                {initialesDe(piece.collaborateur)}
              </span>
            ) : null}
          </span>
        </span>
        {objet ? (
          <span className="rounded-full bg-signal-warn px-2 py-0.5 text-[12px] font-medium text-background">
            {t(objet === "rappel" ? "cab.file.demande.rappel" : "cab.file.demande.suppression")}
          </span>
        ) : piece.doublonDe ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[12px]">
            {t("cab.pile.doublon")}
          </span>
        ) : null}
        <span className="num text-[13px]" dir="ltr">
          {m ? montant(m, locale) : ""}
        </span>
      </Link>
      {objet ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <button
            type="button"
            disabled={repondre.isPending}
            onClick={() => repondre.mutate(true)}
            className="min-h-[44px] rounded-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40"
          >
            {t("cab.demande.accorder")}
          </button>
          {refus ? (
            <>
              <input
                autoFocus
                value={motif}
                maxLength={MOTIF_LONGUEUR_MAX}
                onChange={(e) => setMotif(e.target.value)}
                aria-label={t("cab.demande.motif")}
                placeholder={t("cab.demande.motif")}
                className="min-h-[44px] min-w-[200px] flex-1 rounded-lg border border-border bg-background px-3 text-[14px]"
              />
              <button
                type="button"
                disabled={repondre.isPending || motif.trim().length === 0}
                onClick={() => repondre.mutate(false)}
                className="min-h-[44px] rounded-full border border-foreground px-4 text-[14px] font-medium disabled:opacity-40"
              >
                {t("cab.demande.refuser")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setRefus(true)}
              className="min-h-[44px] rounded-full border border-border px-4 text-[14px]"
            >
              {t("cab.demande.refuser")}
            </button>
          )}
          {erreur ? (
            <p role="alert" className="w-full text-[12.5px] text-signal-stop">
              {erreur}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FileEnPiles({ rows, cabinetId }: { rows: QueueItem[]; cabinetId: string }) {
  const { t } = useI18n();
  const piles = useMemo(
    () =>
      PILES.map((code) => ({ code, pieces: rows.filter((r) => pileDe(r) === code) })).filter(
        (p) => p.pieces.length > 0,
      ),
    [rows],
  );
  // La première pile utile s'ouvre : c'est le travail du moment.
  const [ouverte, setOuverte] = useState<PileDeLaFile | null | undefined>(undefined);
  const active = ouverte === undefined ? (piles[0]?.code ?? null) : ouverte;
  const [groupe, setGroupe] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      {piles.map(({ code, pieces }, i) => {
        const estOuverte = active === code;
        const doublons = pieces.filter((p) => p.doublonDe !== null).length;
        return (
          <section
            key={code}
            className="cab-monte overflow-hidden rounded-[14px] border border-border bg-card"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="relative flex min-h-[64px] items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                aria-expanded={estOuverte}
                onClick={() => setOuverte(estOuverte ? null : code)}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3.5 text-start"
              >
                <span className="num min-w-[46px] text-[26px] font-medium" data-pile={code}>
                  {pieces.length}
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold">{t(TITRE[code])}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {code === "a_completer" && doublons > 0
                      ? t("cab.pile.dont_doublons", { count: doublons })
                      : t(AIDE[code])}
                  </span>
                </span>
                {/* Le chevron est DANS le bouton : c'est lui qu'on vise. */}
                <ChevronDown
                  aria-hidden
                  className={
                    estOuverte
                      ? "ms-auto h-5 w-5 shrink-0 rotate-180 text-muted-foreground transition-transform"
                      : "ms-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform"
                  }
                />
              </button>
              {code === "pretes" ? (
                <Link
                  to="/cabinet/propositions"
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-foreground px-4 text-[14px] font-semibold text-background"
                >
                  {t("cab.pile.valider")}
                </Link>
              ) : null}
              {code === "lecture" ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
                  <span className="cab-lit block h-0.5 w-[30%] bg-foreground" />
                </span>
              ) : null}
            </div>
            {estOuverte ? (
              <ul className="cab-monte border-t border-border">
                {groupesDeLaPile(pieces).map((g) => {
                  const cle = `${code}|${g.cle}`;
                  const plie = g.pieces.length > 1 && groupe !== cle;
                  return (
                    <li key={g.cle} className="border-b border-border last:border-b-0">
                      {g.pieces.length > 1 ? (
                        <div className="flex items-center gap-1 pe-2">
                          <button
                            type="button"
                            aria-expanded={!plie}
                            onClick={() => setGroupe(plie ? cle : null)}
                            className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-4 py-2 text-start hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] [overflow-wrap:anywhere]">
                                {g.tiers ?? t("cab.pile.sans_tiers")}
                              </span>
                              <span className="block text-[12px] text-muted-foreground">
                                {g.client}
                              </span>
                            </span>
                            <span className="num text-[13px] text-muted-foreground">
                              {g.pieces.length}
                            </span>
                          </button>
                          <TelechargerDossierComptable
                            compact
                            cabinetId={cabinetId}
                            clientId={g.pieces[0]!.tenantId}
                            nomClient={g.client}
                            pieces={g.pieces.map((p) => p.pieceId)}
                            libelle={t("cab.pile.telecharger", { count: g.pieces.length })}
                          />
                        </div>
                      ) : null}
                      {plie
                        ? null
                        : g.pieces.map((p) => (
                            <LigneDePiece
                              key={p.pieceId}
                              piece={p}
                              client={g.client}
                              cabinetId={cabinetId}
                              titre={
                                g.pieces.length > 1
                                  ? (p.libelle ?? t("cab.queue.sansEcriture"))
                                  : (g.tiers ?? p.libelle ?? t("cab.pile.sans_tiers"))
                              }
                            />
                          ))}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
