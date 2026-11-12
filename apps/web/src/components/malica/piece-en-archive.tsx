/**
 * La pièce d'un mandat terminé, chez la comptabilité qui l'a prise en charge
 * (recette du 11 novembre 2026, 1.6).
 *
 * Règle 10 du 16 octobre : la comptabilité qui a travaillé garde son archive,
 * en lecture seule. L'écran montre donc la pièce, la laisse télécharger, et
 * ses écritures telles qu'elles ont été inscrites — sans « Modifier », sans
 * « Retourner », sans aucun geste : la base les refuserait tous (R6).
 *
 * Ce qui se lit ici est borné par la base, pas par l'écran : la pièce et les
 * écritures prises en charge avant la fin du mandat, rien d'après.
 */
import type { Ecriture } from "@malica/socle/ports/repositories";
import { Download } from "lucide-react";
import type { ReactNode } from "react";

import { DocumentView } from "@/components/malica/document-view";
import { useI18n } from "@/i18n";
import { dateEnChiffres, montant } from "@/lib/lisible";

export function PieceEnArchive({
  retour,
  mandatClosLe,
  contenu,
  ecritures,
  telechargement,
  onTelecharger,
  enregistreSous,
}: {
  /** Le bouton de retour de l'écran, tel qu'il est partout ailleurs. */
  retour: ReactNode;
  /** Le dernier jour du mandat, AAAA-MM-JJ. */
  mandatClosLe: string;
  contenu: ArrayBuffer | null;
  ecritures: readonly Ecriture[];
  telechargement: boolean;
  onTelecharger: () => void;
  /** Dans la coque native : où le fichier a été écrit. */
  enregistreSous: string | null;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
        {retour}
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          {t("cab.archive.badge")}
        </h1>
      </header>
      <div
        role="status"
        className="border border-s-[3px] border-border bg-card p-4 text-[13px] leading-snug"
      >
        <p>{t("cab.archive.notice", { date: dateEnChiffres(mandatClosLe, locale) })}</p>
        {contenu ? (
          <button
            type="button"
            onClick={onTelecharger}
            disabled={telechargement}
            className="mt-3 inline-flex h-9 items-center gap-2 border border-border px-3 text-[13px] font-medium hover:bg-accent disabled:opacity-40"
          >
            <Download className="h-4 w-4" aria-hidden />
            {telechargement ? t("common.loading") : t("cab.review.telecharger")}
          </button>
        ) : null}
        {enregistreSous ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {t("cab.review.enregistre", { chemin: enregistreSous })}
          </p>
        ) : null}
      </div>
      {contenu ? (
        <DocumentView contenu={contenu} highlight={null} label={t("cab.review.document")} />
      ) : null}
      <section aria-label={t("cab.archive.ecritures")} className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {t("cab.archive.ecritures")}
        </h2>
        {ecritures.map((e) => (
          <EcritureEnLectureSeule key={e.id} ecriture={e} />
        ))}
      </section>
    </div>
  );
}

/**
 * Une écriture telle qu'elle a été inscrite, sans aucun geste : l'archive
 * d'un mandat terminé (1.6), et l'écriture de la comptabilité précédente chez
 * la nouvelle (7.3).
 */
export function EcritureEnLectureSeule({ ecriture }: { ecriture: Ecriture }) {
  const { t, locale } = useI18n();
  return (
    <div className="border border-border bg-card">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-[13px]">
        <span className="num text-muted-foreground">{ecriture.journal}</span>
        <span className="num" dir="ltr">
          {dateEnChiffres(ecriture.dateEcriture, locale)}
        </span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{ecriture.libelle}</span>
      </p>
      <ul className="divide-y divide-border">
        {ecriture.lines.map((l, i) => {
          const auCredit = Number(l.credit) > 0;
          return (
            <li
              key={i}
              className="flex min-h-[44px] items-center gap-3 py-2 pe-3"
              style={{ paddingInlineStart: auCredit ? 32 : 14 }}
            >
              <span className="num w-[52px] shrink-0 text-[13px] text-muted-foreground">
                {l.accountCode}
              </span>
              <span className="min-w-0 flex-1 text-[14px] leading-tight [overflow-wrap:anywhere]">
                {l.libelle}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t(auCredit ? "cab.ecriture.credit_court" : "cab.ecriture.debit_court")}
              </span>
              <span className="num w-[92px] shrink-0 text-end text-[14px] font-medium" dir="ltr">
                {montant(auCredit ? l.credit : l.debit, locale)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
