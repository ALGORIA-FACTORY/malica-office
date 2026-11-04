/**
 * Les PME et leurs abonnements, en lignes : la liste de la tour et l'onglet
 * « Abonnements » d'un cabinet lisent la même table. Une ligne s'ouvre d'un
 * geste (clic, Entrée) sur la fiche « Gérer ».
 *
 * Large : six colonnes alignées, chiffres en mono. Étroit (téléphone) : la
 * même ligne se replie en trois lignes de texte, sans défilement horizontal.
 */
import type { PmeDeLaTour } from "@malica/socle/ports/repositories";

import { useI18n } from "@/i18n";
import { etatDeLaPme } from "@/lib/clients-de-la-tour";
import { cn } from "@/lib/utils";

import { dateCourte } from "./donnees";
import { Consommation, FOCUS, PastilleDEtat } from "./ui";

const COLONNES =
  "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_8rem_7rem_7.5rem] md:items-center md:gap-4";

export function TableDesPme({
  pme,
  ouvrir,
  sansCabinet = false,
}: {
  pme: readonly PmeDeLaTour[];
  ouvrir: (p: PmeDeLaTour) => void;
  /** La colonne du cabinet n'a pas d'objet dans la fiche d'un cabinet. */
  sansCabinet?: boolean;
}) {
  const { t, locale } = useI18n();
  /*
   * Ce que « Sans facture » et une échéance « — » veulent dire, sous la table,
   * seulement quand une ligne les montre (4 novembre 2026 : toutes les lignes
   * les portaient, sans un mot). Ce n'est pas une lecture manquée : l'état et
   * l'échéance viennent de `facturation.encours_v` (`tour.clients`). « Sans
   * facture », c'est aucune facture émise pour la licence (ou toutes
   * annulées) ; l'échéance est la plus proche d'une facture encore due PORTÉE
   * PAR LA LICENCE — celle qu'un cabinet consolide reste à sa fiche.
   */
  const legende = [
    pme.some((p) => etatDeLaPme(p) === "sans_facture") ? t("tour.legende.sansFacture") : null,
    pme.some((p) => p.licence_id && !p.echeance_le) ? t("tour.legende.echeance") : null,
  ].filter(Boolean);
  return (
    <div data-table-pme>
      <div
        aria-hidden
        className={cn(
          "hidden border-b border-border pb-2 text-[11px] text-muted-foreground",
          COLONNES,
        )}
      >
        <span>{t("tour.col.pme")}</span>
        <span>{sansCabinet ? "" : t("tour.col.cabinet")}</span>
        <span>{t("tour.col.offre")}</span>
        <span>{t("tour.col.lectures")}</span>
        <span>{t("tour.col.echeance")}</span>
        <span className="md:text-end">{t("tour.col.etat")}</span>
      </div>
      <ul aria-label={t("tour.menu.pme")} className="divide-y divide-border">
        {pme.map((p) => (
          <li key={p.id} data-pme={p.id}>
            <button
              type="button"
              onClick={() => ouvrir(p)}
              className={cn(
                "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3.5 text-start hover:bg-accent/60 md:py-3",
                COLONNES,
                FOCUS,
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">{p.nom}</span>
                <span className="num block truncate text-[11px] text-muted-foreground">
                  <bdi>{p.matricule ?? "—"}</bdi>
                </span>
              </span>
              <span className="col-start-2 row-start-1 md:hidden">
                <PastilleDEtat etat={etatDeLaPme(p)} />
              </span>
              <span className="col-span-2 min-w-0 truncate text-[12.5px] text-muted-foreground md:col-span-1">
                {sansCabinet ? null : (p.cabinet_nom ?? t("tour.direct"))}
                <span className="md:hidden">
                  {sansCabinet ? "" : " · "}
                  {p.offre_libelle ?? t("tour.sansOffre")}
                </span>
              </span>
              <span className="hidden truncate text-[12.5px] md:block">
                {p.offre_libelle ?? <span className="text-muted-foreground">—</span>}
              </span>
              <span className="col-span-2 flex items-end gap-4 md:col-span-1 md:block">
                <Consommation lues={p.lectures_consommees} droit={p.lectures_droit} />
                <span className="num text-[12px] text-muted-foreground md:hidden">
                  {p.echeance_le
                    ? t("tour.echeanceLe", { date: dateCourte(p.echeance_le, locale) })
                    : ""}
                </span>
              </span>
              <span className="num hidden text-[12.5px] md:block">
                {dateCourte(p.echeance_le, locale)}
              </span>
              <span className="hidden md:flex md:justify-end">
                <PastilleDEtat etat={etatDeLaPme(p)} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {legende.length > 0 ? (
        <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          {legende.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
