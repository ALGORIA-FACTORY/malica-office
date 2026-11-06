/**
 * Tour › Cabinets (2 novembre 2026, maquette 1).
 *
 * Tous les cabinets : les offres de leurs PME (« Team ×3 · Solo ×1 »), le
 * nombre de PME, les abonnements actifs, les pièces transmises ce mois, et
 * l'état de leurs factures consolidées. Une ligne ouvre le cabinet.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { useClientsDeLaTour } from "@/components/malica/tour/donnees";
import {
  BandeauDeChiffres,
  BarreCollante,
  EnTeteDeLaTour,
  FOCUS,
  PastilleDEtat,
  Squelette,
  Vide,
} from "@/components/malica/tour/ui";
import { useI18n } from "@/i18n";
import {
  cabinetsEtLeursPme,
  correspond,
  etatDuCabinet,
  offresEnUneLigne,
} from "@/lib/clients-de-la-tour";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tour/cabinets/")({
  component: LesCabinets,
});

const COLONNES =
  "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_4.5rem_4.5rem_5.5rem_7.5rem_1rem] md:items-center md:gap-4";

function LesCabinets() {
  const { t, locale } = useI18n();
  const clients = useClientsDeLaTour();
  const [recherche, setRecherche] = useState("");
  const tous = useMemo(
    () => cabinetsEtLeursPme(clients.data?.cabinets ?? [], clients.data?.pme ?? []),
    [clients.data],
  );
  const lignes = tous.filter((c) => correspond(recherche, c.cabinet.nom, c.cabinet.matricule));
  const n = new Intl.NumberFormat(locale);
  const somme = (f: (c: (typeof tous)[number]) => number) => tous.reduce((s, c) => s + f(c), 0);
  const vide = clients.isPending ? "—" : null;

  return (
    <div data-tour-cabinets className="space-y-6">
      <EnTeteDeLaTour surtitre={t("tour.menu.clients")} titre={t("tour.menu.cabinets")} />

      {clients.isError ? (
        <p role="alert" className="text-[13px] text-etat-stop">
          {texteDeLErreur(clients.error, "routes/_authenticated/tour.cabinets", t("common.error"))}
        </p>
      ) : null}

      <BandeauDeChiffres
        chiffres={[
          {
            cle: "cabinets",
            libelle: t("tour.menu.cabinets"),
            valeur: vide ?? n.format(tous.length),
          },
          {
            cle: "pme",
            libelle: t("tour.kpi.pme"),
            valeur: vide ?? n.format(somme((c) => c.pme.length)),
          },
          {
            cle: "actifs",
            libelle: t("tour.kpi.actifs"),
            valeur: vide ?? n.format(somme((c) => c.actifs)),
          },
          {
            cle: "mois",
            libelle: t("tour.kpi.transmisMois"),
            valeur: vide ?? n.format(somme((c) => c.transmisMois)),
          },
          {
            cle: "impayes",
            libelle: t("tour.filtre.impayes"),
            valeur:
              vide ?? n.format(tous.filter((c) => etatDuCabinet(c.cabinet) === "impaye").length),
            ton: "stop",
          },
        ]}
      />

      <div>
        <BarreCollante
          recherche={recherche}
          setRecherche={setRecherche}
          libelle={t("tour.chercher.cabinet")}
        />
        <div className="pt-2">
          {clients.isPending ? (
            <Squelette />
          ) : tous.length === 0 ? (
            <Vide titre={t("tour.cabinets.vide.titre")} texte={t("tour.cabinets.vide.texte")} />
          ) : lignes.length === 0 ? (
            <Vide titre={t("tour.filtre.rien.titre")} texte={t("tour.filtre.rien.texte")} />
          ) : (
            <>
              <div
                aria-hidden
                className={cn(
                  "hidden border-b border-border pb-2 text-[11px] text-muted-foreground",
                  COLONNES,
                )}
              >
                <span>{t("tour.col.cabinet")}</span>
                <span>{t("tour.col.offres")}</span>
                <span className="text-end">{t("tour.col.nbPme")}</span>
                <span className="text-end">{t("tour.col.actifs")}</span>
                <span className="text-end">{t("tour.col.mois")}</span>
                <span className="text-end">{t("tour.col.etat")}</span>
                <span />
              </div>
              <ul aria-label={t("tour.menu.cabinets")} className="divide-y divide-border">
                {lignes.map((c) => (
                  <li key={c.cabinet.id} data-cabinet={c.cabinet.id}>
                    <Link
                      to="/tour/cabinets/$cabinetId"
                      params={{ cabinetId: c.cabinet.id }}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3.5 hover:bg-accent/60 md:py-3",
                        COLONNES,
                        FOCUS,
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium">
                          {c.cabinet.nom}
                        </span>
                        <span className="num block truncate text-[11px] text-muted-foreground">
                          <bdi>{c.cabinet.matricule ?? c.cabinet.juridiction}</bdi>
                        </span>
                      </span>
                      <span className="col-start-2 row-start-1 md:hidden">
                        <PastilleDEtat etat={etatDuCabinet(c.cabinet)} />
                      </span>
                      <span className="col-span-2 min-w-0 truncate text-[12.5px] text-muted-foreground md:col-span-1 md:text-foreground">
                        {c.offres.length ? offresEnUneLigne(c.offres) : t("tour.sansOffre")}
                      </span>
                      <span className="num col-span-2 text-[12px] text-muted-foreground md:hidden">
                        {t("tour.cabinet.ligne", {
                          pme: c.pme.length,
                          actifs: c.actifs,
                          mois: c.transmisMois,
                        })}
                      </span>
                      <span className="num hidden text-end text-[13px] md:block">
                        {n.format(c.pme.length)}
                      </span>
                      <span className="num hidden text-end text-[13px] md:block">
                        {n.format(c.actifs)}
                      </span>
                      <span className="num hidden text-end text-[13px] md:block">
                        {n.format(c.transmisMois)}
                      </span>
                      <span className="hidden md:flex md:justify-end">
                        <PastilleDEtat etat={etatDuCabinet(c.cabinet)} />
                      </span>
                      <ChevronRight
                        size={14}
                        aria-hidden
                        className="hidden text-muted-foreground md:block rtl:rotate-180"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
