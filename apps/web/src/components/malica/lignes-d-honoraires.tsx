/**
 * Les lignes d'un brouillon d'honoraires, éditables — et les deux classes de
 * champ que l'écran des honoraires partage avec elles.
 *
 * Elles vivaient dans `routes/_authenticated/cabinet.honoraires.tsx`,
 * exportées pour l'écran d'une facture. Une fonction exportée par un fichier
 * de route reste dans la partie que le routeur charge d'emblée : elle partait
 * avec la vitrine. Ici, elle ne suit que les deux écrans qui l'emploient.
 */
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import type { LigneHonorairesSaisie } from "@malica/socle/ports/repositories";

export const CHAMP =
  "border border-border bg-card px-2.5 py-1.5 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
export const CHAMP_NUM = cn(CHAMP, "num text-end");

/** Les lignes d'un brouillon, telles que l'expert les saisit. Les totaux viennent de la base. */
export function LignesEditables({
  lignes,
  onChange,
  onSet,
  devise,
  totaux,
}: {
  lignes: LigneHonorairesSaisie[];
  onChange: (i: number, patch: Partial<LigneHonorairesSaisie>) => void;
  onSet: (lignes: LigneHonorairesSaisie[]) => void;
  devise: string;
  /** Les montants HT calculés en base, par ligne, quand ils existent. */
  totaux?: string[] | undefined;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="overflow-x-auto border border-border">
      <table className="min-w-full border-collapse text-[12.5px]">
        <caption className="sr-only">{t("cab.hono.lignes.caption")}</caption>
        <thead>
          <tr className="border-b border-border">
            {[
              t("cab.hono.col.prestation"),
              t("cab.hono.col.quantite"),
              t("cab.hono.col.pu"),
              t("cab.hono.col.ht"),
              "",
            ].map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                  i === 0 ? "text-start" : "text-end",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-border">
              <td className="px-3 py-1.5">
                <input
                  value={l.libelle}
                  onChange={(e) => onChange(i, { libelle: e.target.value })}
                  aria-label={t("cab.hono.col.prestation")}
                  className={cn(CHAMP, "w-full min-w-[220px]")}
                />
              </td>
              <td className="px-3 py-1.5">
                <input
                  type="number"
                  step="0.001"
                  value={l.quantite}
                  onChange={(e) => onChange(i, { quantite: e.target.value })}
                  aria-label={t("cab.hono.col.quantite")}
                  className={cn(CHAMP_NUM, "w-[90px]")}
                />
              </td>
              <td className="px-3 py-1.5">
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={l.prixUnitaire}
                  onChange={(e) => onChange(i, { prixUnitaire: e.target.value })}
                  aria-label={t("cab.hono.col.pu")}
                  className={cn(CHAMP_NUM, "w-[130px]")}
                />
              </td>
              <td className="num whitespace-nowrap px-3 py-1.5 text-end">
                {totaux?.[i] !== undefined ? `${montant(totaux[i]!, locale)} ${devise}` : "—"}
              </td>
              <td className="px-3 py-1.5 text-end">
                <button
                  type="button"
                  onClick={() => onSet(lignes.filter((_, j) => j !== i))}
                  aria-label={t("cab.hono.ligne.retirer")}
                  title={t("cab.hono.ligne.retirer")}
                  className="h-6 w-6 border border-border text-[13px] leading-none text-muted-foreground hover:border-signal-stop hover:text-signal-stop"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          {lignes.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-3 text-[12px] text-muted-foreground">
                {t("cab.hono.lignes.vide")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="border-t border-border bg-background px-3 py-2">
        <button
          type="button"
          onClick={() => onSet([...lignes, { libelle: "", quantite: "1", prixUnitaire: "" }])}
          className="border border-dashed border-border px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          + {t("cab.hono.ligne.ajouter")}
        </button>
      </div>
    </div>
  );
}
