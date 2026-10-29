/**
 * « Combien de factures ? » — après un scan de plusieurs pages.
 *
 * ================================================================= POURQUOI
 *
 * 29 octobre 2026, premier essai sur un vrai téléphone : deux factures de
 * deux fournisseurs, scannées dans le même passage du scanner, sont devenues
 * UNE pièce de deux pages. La lecture n'en a vu qu'une ; la seconde était
 * perdue pour la comptabilité, sans un mot.
 *
 * Le scanner de l'appareil rend des PAGES, pas des factures : rien ne dit où
 * finit l'une et où commence l'autre. C'est donc la personne qui le dit, et
 * on le lui rend facile :
 *
 *   — par défaut, UNE FEUILLE = UNE FACTURE. C'est le cas courant (on
 *     rattrape une pile de tickets et de factures d'une page), et l'erreur
 *     inverse coûte moins cher : une page 2 lue seule finit « à vérifier »,
 *     une facture fondue dans une autre disparaît ;
 *   — un toucher entre deux pages les relie (« Même facture ») ;
 *   — « Tout est une seule facture » pour le contrat de six pages.
 *
 * Le nombre de factures se lit sur le bouton : on sait ce qui va partir
 * avant de l'envoyer.
 */
import { Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePiegeDeFocus } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { regrouper } from "@/lib/regrouper-les-pages";

export function RegrouperLesPages({
  pages,
  onValider,
}: {
  pages: readonly Blob[];
  /** Une liste de factures, chacune sa liste de pages, dans l'ordre du scan. */
  onValider: (factures: Blob[][]) => void;
}) {
  const { t } = useI18n();
  const feuille = useRef<HTMLDivElement | null>(null);
  usePiegeDeFocus(true, feuille);

  const [liees, setLiees] = useState<boolean[]>(() => pages.slice(1).map(() => false));

  // Les vignettes : une adresse par page, rendue à la fermeture.
  const vignettes = useMemo(() => pages.map((p) => URL.createObjectURL(p)), [pages]);
  useEffect(() => () => vignettes.forEach((u) => URL.revokeObjectURL(u)), [vignettes]);

  const factures = regrouper(pages, liees);
  // Le numéro de facture de chaque page, pour l'écrire sous sa vignette.
  const numeros = regrouper(
    pages.map((_, i) => i),
    liees,
  ).flatMap((groupe, k) => groupe.map(() => k + 1));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/40">
      <div
        ref={feuille}
        role="dialog"
        aria-modal="true"
        aria-label={t("pme.agrafe.titre")}
        className="mx-auto flex max-h-[92vh] w-full max-w-md flex-col rounded-t-[28px] border-t border-border bg-background px-[18px] pb-safe pt-3"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border" />
        <p className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em]">
          {t("pme.agrafe.titre")}
        </p>
        <p className="mt-1 text-[14px] text-text-2">{t("pme.agrafe.aide")}</p>

        <ol className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {vignettes.map((url, i) => (
            <li key={url}>
              {i > 0 ? (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    aria-pressed={liees[i - 1]}
                    onClick={() => setLiees((l) => l.map((v, k) => (k === i - 1 ? !v : v)))}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[14px] font-bold aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                  >
                    <Link2 aria-hidden className="h-4 w-4" />
                    {t("pme.agrafe.lier")}
                  </button>
                </div>
              ) : null}
              <div className="flex items-center gap-3 rounded-[18px] border border-border p-2.5">
                <img
                  src={url}
                  alt=""
                  className="h-24 w-[72px] shrink-0 rounded-[10px] border border-border bg-muted object-cover"
                />
                <div className="min-w-0">
                  <p className="text-[16px] font-extrabold">
                    {t("pme.agrafe.facture", { n: numeros[i] ?? i + 1 })}
                  </p>
                  <p className="text-[13px] text-text-2">{t("pme.agrafe.page", { n: i + 1 })}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => setLiees((l) => l.map(() => true))}
          className="mt-3 h-[46px] w-full text-[14px] font-medium text-text-2 underline underline-offset-4"
        >
          {t("pme.agrafe.toutEnUne")}
        </button>
        <button
          type="button"
          onClick={() => onValider(factures.map((f) => [...f]))}
          className="mb-3 mt-1 h-[52px] w-full rounded-full bg-foreground text-[16px] font-extrabold text-background"
        >
          {t("pme.agrafe.continuer", { count: factures.length })}
        </button>
      </div>
    </div>
  );
}
