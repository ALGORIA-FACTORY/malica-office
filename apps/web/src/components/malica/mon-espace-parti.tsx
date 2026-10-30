/**
 * Son Mon espace part avec son compte (« Malica sans blocage », lot 4).
 *
 * Un siège qui quitte une société y laisse les pièces de la société ; ses
 * pièces privées restent à lui seul, et cet écran les lui montre hors de toute
 * société : il les télécharge, il les supprime. Il ne les envoie jamais — il
 * n'est plus membre ; la base le refuse aussi (`capture_piece_set_vis`,
 * `piece_envoyer`). L'explication est dans le ⓘ, la ligne dit un nom et deux
 * gestes.
 */
import type { PieceDeMonEspace } from "@malica/socle/ports/repositories";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { enregistrerUnFichier } from "@/capabilities/enregistrer-un-fichier";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { Aide } from "@/components/malica/aide";
import { useI18n } from "@/i18n";
import { extensionDuContenu } from "@/lib/archive-comptable";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/mon-espace-parti";
const CLE = ["mon-espace-hors-societe"] as const;

function useMonEspaceParti() {
  return useQuery({
    queryKey: CLE,
    queryFn: () => office().capture.monEspaceHorsSociete(),
  });
}

/** Le chemin vers cet écran, depuis le compte — seulement s'il y a quelque chose. */
export function LienMonEspaceParti({ className }: { className?: string }) {
  const { t } = useI18n();
  const pieces = useMonEspaceParti();
  const n = pieces.data?.length ?? 0;
  if (n === 0) return null;
  return (
    <Link to="/mon-espace" className={className}>
      {t("monespace.lien", { count: n })}
    </Link>
  );
}

export function MonEspaceParti() {
  const { t } = useI18n();
  const pieces = useMonEspaceParti();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        {t("statut.pme.mon_espace")}
        <Aide titre={t("statut.pme.mon_espace")} paragraphes={[{ texte: t("monespace.aide") }]} />
      </h1>
      <p className="text-sm text-muted-foreground">{t("monespace.sous")}</p>
      {pieces.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : pieces.isError ? (
        <p role="alert" className="text-sm text-signal-warn">
          {texteDeLErreur(pieces.error, OU, t("common.error"))}
        </p>
      ) : (pieces.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("monespace.vide")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(pieces.data ?? []).map((p) => (
            <LigneDeMonEspace key={p.id} piece={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LigneDeMonEspace({ piece }: { piece: PieceDeMonEspace }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [aConfirmer, setAConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [remis, setRemis] = useState<string | null>(null);

  const telecharger = useMutation({
    mutationFn: async () => {
      const octets = await office().capture.apercu(piece.id);
      if (!octets) throw new Error(`contenu absent : ${piece.id}`);
      const nom = `${piece.societe} ${piece.createdAt.slice(0, 10)}.${extensionDuContenu(octets.type)}`;
      return enregistrerUnFichier(octets, nom);
    },
    onMutate: () => setErreur(null),
    onSuccess: ({ chemin }) => setRemis(chemin),
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });
  const supprimer = useMutation({
    mutationFn: async () => {
      // `false` : la pièce n'est plus visible — ce n'est pas un succès.
      if (!(await office().capture.supprimer(piece.id)))
        throw new Error(`suppression sans effet : ${piece.id}`);
    },
    onMutate: () => setErreur(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLE }),
    onError: (e: unknown) => {
      setAConfirmer(false);
      setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });
  const occupe = telecharger.isPending || supprimer.isPending;

  return (
    <li className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="h-14 w-11 shrink-0 overflow-hidden rounded-md">
          <ApercuDePiece pieceId={piece.id} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[15px]">{piece.societe}</b>
          <span className="text-[13px] text-muted-foreground">
            {jourEtMois(piece.createdAt, locale)}
          </span>
        </span>
      </div>
      {aConfirmer ? <p className="text-[13px]">{t("pme.supprimer.sur")}</p> : null}
      {/* Deux gestes de même poids, 48 px, le principal plein d'abord. */}
      <div className="grid grid-cols-2 gap-2.5">
        {aConfirmer ? (
          <>
            <button
              type="button"
              disabled={occupe}
              onClick={() => supprimer.mutate()}
              className="min-h-[48px] rounded-full bg-foreground text-[14px] font-semibold text-background disabled:opacity-40"
            >
              {supprimer.isPending ? t("common.loading") : t("pme.supprimer.oui")}
            </button>
            <button
              type="button"
              disabled={occupe}
              onClick={() => setAConfirmer(false)}
              className="min-h-[48px] rounded-full border border-border text-[14px] font-semibold disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={occupe}
              onClick={() => telecharger.mutate()}
              className="min-h-[48px] rounded-full bg-foreground text-[14px] font-semibold text-background disabled:opacity-40"
            >
              {telecharger.isPending ? t("common.loading") : t("cab.review.telecharger")}
            </button>
            <button
              type="button"
              disabled={occupe}
              onClick={() => setAConfirmer(true)}
              className="min-h-[48px] rounded-full border border-border text-[14px] font-semibold disabled:opacity-40"
            >
              {t("monespace.supprimer")}
            </button>
          </>
        )}
      </div>
      {remis ? <p className="text-[12.5px] text-muted-foreground">{remis}</p> : null}
      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-warn">
          {erreur}
        </p>
      ) : null}
    </li>
  );
}
