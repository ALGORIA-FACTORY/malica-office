/**
 * La grille de Mon espace : de grandes miniatures, rangées par mois, chacune
 * avec son rond de choix (maquette « Malica sans blocage », écran « Mon
 * espace », 28 octobre 2026 ; spec §5).
 *
 * Une seule grille pour deux écrans : Mon espace dans la société
 * (`pme.coffre.tsx`) et Mon espace des sociétés quittées (`mon-espace.tsx`).
 * Chaque écran dit ce qu'est un papier (titre, ligne, état) et ce que fait le
 * toucher ; la grille tient le rangement, les deux cibles de 44 points, le
 * choix. Le compte et la question avant d'effacer sont aussi les mêmes. Le
 * dessin vit dans `styles-pme.css`, sous `[data-ecran="coffre"]`.
 */
import { useRef, type ReactNode } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** Les papiers par mois `AAAA-MM`, dans l'ordre reçu (le plus récent d'abord). */
function parMois<T>(papiers: readonly T[], moisDe: (p: T) => string) {
  const mois: { mois: string; papiers: T[] }[] = [];
  for (const p of papiers) {
    const m = moisDe(p);
    const dernier = mois[mois.length - 1];
    if (dernier?.mois === m) dernier.papiers.push(p);
    else mois.push({ mois: m, papiers: [p] });
  }
  return mois;
}

interface ProprietesDeLaGrille<T extends { id: string }> {
  /** Triés du plus récent au plus ancien. */
  papiers: readonly T[];
  /** Le mois d'un papier, `AAAA-MM`. */
  moisDe: (p: T) => string;
  titreDe: (p: T) => string;
  /** La ligne sous le titre : le jour, le montant… */
  ligneDe: (p: T) => string;
  /** Ce que la tuile dit en plus (l'état de lecture). */
  enPlus?: (p: T) => ReactNode;
  /** Toucher le papier l'ouvre ; sans écran où l'ouvrir, le toucher le choisit. */
  ouvrir?: (p: T) => void;
  choisis: readonly string[];
  basculer: (id: string) => void;
  occupe: boolean;
}

export function GrilleDesMois<T extends { id: string }>({
  papiers,
  moisDe,
  titreDe,
  ligneDe,
  enPlus,
  ouvrir,
  choisis,
  basculer,
  occupe,
}: ProprietesDeLaGrille<T>) {
  const { t, locale } = useI18n();
  const anneeCourante = String(new Date().getUTCFullYear());
  const nomDuMois = (mois: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "long",
      ...(mois.startsWith(anneeCourante) ? {} : { year: "numeric" }),
      timeZone: "UTC",
    }).format(new Date(`${mois}-01T00:00:00Z`));

  return (
    <>
      {parMois(papiers, moisDe).map(({ mois, papiers: duMois }) => (
        <section key={mois} className="mois" aria-label={nomDuMois(mois)}>
          <h2>{nomDuMois(mois)}</h2>
          <div className="grille">
            {duMois.map((p) => {
              const choisi = choisis.includes(p.id);
              const titre = titreDe(p);
              return (
                <div key={p.id} className={cn("tuile", choisi && "on")}>
                  <button
                    type="button"
                    className="ouvrir"
                    // Sans écran où l'ouvrir, la tuile se choisit : elle le dit.
                    aria-pressed={ouvrir ? undefined : choisi}
                    disabled={ouvrir ? undefined : occupe}
                    onClick={() => (ouvrir ? ouvrir(p) : basculer(p.id))}
                  >
                    <ApercuDePiece pieceId={p.id} />
                    <b>{titre}</b>
                    <span className="dt">{ligneDe(p)}</span>
                    {enPlus?.(p)}
                  </button>
                  <button
                    type="button"
                    className="choix"
                    aria-pressed={choisi}
                    aria-label={t("pme.coffre.choisir", { piece: titre })}
                    disabled={occupe}
                    onClick={() => basculer(p.id)}
                  >
                    <span aria-hidden>
                      <svg viewBox="0 0 24 24" className="g">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/** « Mon espace · N papiers ». */
export function CompteDesPapiers({ n }: { n: number }) {
  const { t } = useI18n();
  if (n === 0) return null;
  return (
    <span className="compte" role="status">
      <i aria-hidden />
      {t("pme.coffre.compte", { count: n })}
    </span>
  );
}

/** Effacer les papiers choisis : la question, puis deux gestes de 48 px. */
export function ConfirmerLaSuppression({
  n,
  enCours,
  oui,
  fermer,
}: {
  n: number;
  enCours: boolean;
  oui: () => void;
  fermer: () => void;
}) {
  const { t } = useI18n();
  const feuille = useRef<HTMLDivElement | null>(null);
  useSuperposition(true, fermer, feuille);
  return (
    <FeuilleDuBas
      titre={t("pme.coffre.supprimer.titre", { count: n })}
      onFermer={fermer}
      feuilleRef={feuille}
      disposition="flex flex-col gap-4 pb-6"
      croix={false}
    >
      <p className="text-[15px] text-text-2">{t("pme.coffre.supprimer.sur", { count: n })}</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={enCours}
          onClick={oui}
          className="min-h-[48px] rounded-full bg-foreground text-[15px] font-semibold text-background disabled:opacity-40"
        >
          {enCours ? t("common.loading") : t("pme.supprimer.oui")}
        </button>
        <button
          type="button"
          onClick={fermer}
          className="min-h-[48px] rounded-full border border-line-strong text-[15px] font-semibold"
        >
          {t("common.cancel")}
        </button>
      </div>
    </FeuilleDuBas>
  );
}
