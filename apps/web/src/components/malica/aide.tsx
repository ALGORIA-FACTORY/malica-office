/**
 * ⓘ — l'explication d'un bloc, à la demande.
 *
 * ================================================================= POURQUOI
 *
 * 23 octobre 2026, Wissem, sur « Mon espace » : « trop d'écriture dans
 * l'écran, on doit simplifier — sans rien perdre ». Les écrans portaient une
 * phrase d'explication sous chaque titre et chaque ligne ; on en lit au mieux
 * une sur cinq. La phrase ne disparaît pas : elle passe ici, derrière un ⓘ à
 * côté du titre, et s'ouvre dans une feuille quand on la veut.
 *
 * Un seul composant pour tous les écrans : même geste, même dessin, même
 * accessibilité (la feuille se ferme au retour d'Android et à `Échap`, et le
 * focus revient au ⓘ).
 *
 * La feuille est rendue dans `document.body` : un écran qui s'anime par
 * `transform` (`.rg-rise`) devient le cadre de tout `position: fixed` qu'il
 * contient, et la feuille s'ouvrait alors dans la colonne, sous la barre
 * basse. Mesuré le 23 octobre sur « Mon espace ».
 */
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";

/** Un paragraphe de la feuille ; `titre` le nomme quand la feuille en porte plusieurs. */
export interface ParagrapheDAide {
  titre?: string;
  texte: ReactNode;
}

export function Aide({ titre, paragraphes }: { titre: string; paragraphes: ParagrapheDAide[] }) {
  const { t } = useI18n();
  const [ouverte, setOuverte] = useState(false);
  const feuille = useRef<HTMLDivElement | null>(null);
  useSuperposition(ouverte, () => setOuverte(false), feuille);

  return (
    <>
      <button
        type="button"
        onClick={() => setOuverte(true)}
        aria-label={`${t("common.aide")} — ${titre}`}
        aria-haspopup="dialog"
        className="ms-2 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-line-strong align-middle text-[12px] font-semibold leading-none text-muted-foreground hover:text-foreground"
      >
        i
      </button>
      {ouverte && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex flex-col justify-end bg-foreground/40"
              onClick={(e) => {
                if (e.target === e.currentTarget) setOuverte(false);
              }}
            >
              <div
                ref={feuille}
                role="dialog"
                aria-modal="true"
                aria-label={titre}
                className="mx-auto max-h-[80vh] w-full max-w-md overflow-y-auto border-t border-border bg-background px-[22px] pb-safe pt-5 text-start"
              >
                <p className="text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">
                  {titre}
                </p>
                <div className="mt-3 grid gap-3">
                  {paragraphes.map((p, i) => (
                    <div key={i}>
                      {p.titre ? <p className="text-[14px] font-semibold">{p.titre}</p> : null}
                      <p className="text-[14px] leading-[1.5] text-muted-foreground">{p.texte}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOuverte(false)}
                  className="mt-4 h-[46px] w-full text-[14px] font-medium text-text-2 underline underline-offset-4"
                >
                  {t("common.fermer")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
