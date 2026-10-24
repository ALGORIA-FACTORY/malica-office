/**
 * « Rattacher un document » — choisir, dans la bibliothèque, la pièce qui
 * accompagne celle-ci : un bon de livraison, un avoir, un devis.
 *
 * ================================================================= POURQUOI
 *
 * 23 octobre 2026, Wissem : « est-ce que je peux rattacher après la lecture de
 * la pièce ? » Seules les pièces nées d'une autre (reçu, talon) y étaient
 * liées. Option A validée le 24 octobre : rattacher, détacher, voir la chaîne.
 *
 * La liste vient de la lecture que la bibliothèque a déjà faite
 * (`capture.listAvecLecture`, même clé) : ouvrir la feuille ne coûte aucune
 * requête de plus. Les règles — même dossier, pas d'espace privé, pas de
 * doublon — sont tenues par la base (`piece_rattacher`) ; la feuille ne fait
 * qu'écarter ce qui serait refusé, pour ne pas le proposer.
 *
 * Rendue dans `document.body`, comme l'aide ⓘ et la feuille de règlement.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

export function RattacherUnDocument({
  pieceId,
  dejaLiees,
  ouvert,
  onFermer,
}: {
  pieceId: string;
  /** Les pièces déjà liées (nées de celle-ci ou rattachées) : on ne les repropose pas. */
  dejaLiees: ReadonlySet<string>;
  ouvert: boolean;
  onFermer: () => void;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [cherche, setCherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const feuille = useRef<HTMLDivElement | null>(null);
  useSuperposition(ouvert, onFermer, feuille);

  const lues = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
    enabled: ouvert,
  });
  const typesDoc = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
    enabled: ouvert,
  });
  const nomDuType = (code: string | null) =>
    (typesDoc.data ?? []).find((x) => x.code === code)?.libelle ?? null;

  const rattacher = useMutation({
    mutationFn: (autreId: string) => office().capture.rattacher(pieceId, autreId),
    onSuccess: async () => {
      setErreur(null);
      setCherche("");
      onFermer();
      await qc.invalidateQueries({ queryKey: ["rattachees", pieceId] });
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/rattacher-un-document", t("common.error"))),
  });

  if (!ouvert || typeof document === "undefined") return null;

  const motif = cherche.trim().toLocaleLowerCase(locale);
  const candidates = (lues.data ?? [])
    .filter((p) => p.id !== pieceId && !dejaLiees.has(p.id) && p.vis !== "personnel")
    .filter(
      (p) =>
        motif === "" ||
        (p.emetteur ?? "").toLocaleLowerCase(locale).includes(motif) ||
        (nomDuType(p.typeDeDocument) ?? "").toLocaleLowerCase(locale).includes(motif),
    )
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
    );

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-foreground/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div
        ref={feuille}
        role="dialog"
        aria-modal="true"
        aria-label={t("pme.rattacher.titre")}
        className="mx-auto flex max-h-[88vh] w-full max-w-md flex-col gap-4 rounded-t-[28px] border-t border-border bg-background px-[20px] pb-safe pt-3 text-start"
      >
        <span aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[21px] font-semibold leading-[1.2] tracking-[-0.02em]">
            {t("pme.rattacher.titre")}
          </p>
          <button
            type="button"
            onClick={onFermer}
            aria-label={t("common.fermer")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <label className="flex min-h-[48px] items-center gap-2 rounded-[14px] border border-border bg-card px-3">
          <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("pme.rattacher.chercher")}</span>
          <input
            type="search"
            value={cherche}
            onChange={(e) => setCherche(e.target.value)}
            placeholder={t("pme.rattacher.chercher")}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
        {erreur ? (
          <p role="alert" className="text-[13px] text-signal-warn">
            {erreur}
          </p>
        ) : null}
        <div className="-mx-1 grid gap-1 overflow-y-auto pb-4">
          {lues.isPending ? (
            <p role="status" className="px-1 text-[14px] text-text-2">
              {t("common.loading")}
            </p>
          ) : candidates.length === 0 ? (
            <p className="px-1 text-[14px] text-text-2">{t("pme.rattacher.aucun")}</p>
          ) : (
            candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={rattacher.isPending}
                onClick={() => rattacher.mutate(p.id)}
                className="flex min-h-[64px] w-full items-center gap-3 rounded-[14px] px-1 py-2 text-start hover:bg-accent disabled:opacity-40"
              >
                <span className="h-[52px] w-[40px] shrink-0 overflow-hidden rounded-[6px] bg-muted">
                  <ApercuDePiece pieceId={p.id} className="mini" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">
                    {p.emetteur ?? t("pme.capture.pieceNonLue")}
                  </span>
                  <span className="truncate text-[12.5px] text-text-2">
                    {[nomDuType(p.typeDeDocument), jour(p.dateDocument ?? p.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {p.total ? (
                  <span className="num shrink-0 text-[14px]">{montant(p.total, locale)}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
