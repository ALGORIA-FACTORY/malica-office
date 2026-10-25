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
import { Search } from "lucide-react";
import { useRef, useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { usePme } from "@/components/malica/pme-context";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois, montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import { usePiecesLues } from "@/hooks/use-pieces-lues";

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

  const lues = usePiecesLues({ enabled: ouvert });
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
      // La pièce elle-même aussi : un retour du cabinet qui demandait ce
      // document se lit désormais « fait » (25 octobre 2026).
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["rattachees", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      ]);
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/rattacher-un-document", t("common.error"))),
  });

  if (!ouvert) return null;

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
  const jour = (iso: string) => jourEtMois(iso, locale);

  return (
    <FeuilleDuBas
      titre={t("pme.rattacher.titre")}
      onFermer={onFermer}
      feuilleRef={feuille}
      disposition="flex flex-col gap-4"
    >
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
    </FeuilleDuBas>
  );
}
