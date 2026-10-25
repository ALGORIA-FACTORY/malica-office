/**
 * La feuille qui monte du bas — un seul cadre pour toutes les feuilles de la
 * PME : « Ajouter un règlement », « Rattacher un document », et les gestes
 * d'une pièce qui en accompagne une autre.
 *
 * Rendue dans `document.body`, comme l'aide ⓘ : un écran animé par
 * `transform` deviendrait le cadre du `position: fixed`.
 *
 * Elle ne tient ni la pile du bouton retour ni le focus : l'écran qui l'ouvre
 * appelle `useSuperposition(ouverte, fermer, feuilleRef)`, parce que c'est lui
 * qui sait quand elle est ouverte — et certaines restent ouvertes sans être
 * montrées (« Ajouter » sur une pièce soldée).
 */
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/i18n";

export function FeuilleDuBas({
  titre,
  onFermer,
  feuilleRef,
  disposition,
  croix = true,
  children,
}: {
  titre: string;
  onFermer: () => void;
  feuilleRef: RefObject<HTMLDivElement | null>;
  /** La disposition du contenu : `grid gap-5 overflow-y-auto`, `flex flex-col gap-4`… */
  disposition: string;
  /** La croix de fermeture ; sans elle, la feuille porte son propre « Annuler ». */
  croix?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-foreground/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div
        ref={feuilleRef}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className={`mx-auto max-h-[88vh] w-full max-w-md rounded-t-[28px] border-t border-border bg-background px-[20px] pb-safe pt-3 text-start ${disposition}`}
      >
        <span aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[21px] font-semibold leading-[1.2] tracking-[-0.02em]">{titre}</p>
          {croix ? (
            <button
              type="button"
              onClick={onFermer}
              aria-label={t("common.fermer")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted"
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
