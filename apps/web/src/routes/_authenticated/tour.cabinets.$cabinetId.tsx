/**
 * Tour › un cabinet (2 novembre 2026, maquette 2).
 *
 * Deux onglets : ses ABONNEMENTS (les PME qu'il sert ou dote, et ses factures
 * consolidées) et sa BIBLIOTHÈQUE (en nombres : la tour compte, elle ne lit
 * pas — la politique des pièces la lui cache, et c'est voulu). « Voir comme le
 * cabinet » montre son propre écran d'abonnements, le même composant que le
 * cabinet, en lecture.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import "@/styles-comptabilite.css";

import { AbonnementsDuCabinet } from "@/components/malica/abonnements-du-cabinet";
import { dateCourte, useClientsDeLaTour } from "@/components/malica/tour/donnees";
import { TableDesPme } from "@/components/malica/tour/table-des-pme";
import {
  BandeauDeChiffres,
  EnTeteDeLaTour,
  FOCUS,
  PastilleDEtat,
  Squelette,
  Vide,
} from "@/components/malica/tour/ui";
import { useI18n } from "@/i18n";
import { cabinetsEtLeursPme, etatDuCabinet, offresEnUneLigne } from "@/lib/clients-de-la-tour";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { ETAT_DE_FACTURE } from "@/lib/paiement";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

type Onglet = "abonnements" | "bibliotheque";

interface Recherche {
  onglet?: Onglet | undefined;
  /** « cabinet » : l'écran du cabinet lui-même, en lecture. */
  vue?: "cabinet" | undefined;
}

export const Route = createFileRoute("/_authenticated/tour/cabinets/$cabinetId")({
  validateSearch: (s: Record<string, unknown>): Recherche => ({
    ...(s["onglet"] === "bibliotheque" ? { onglet: "bibliotheque" as const } : {}),
    ...(s["vue"] === "cabinet" ? { vue: "cabinet" as const } : {}),
  }),
  // Le commerce n'entre pas dans le paquet de la coque (`outils/coque-sans-commerce.mjs`).
  component: __COMMERCE__ ? UnCabinet : () => null,
});

const OU = "routes/_authenticated/tour.cabinets.$cabinetId";

function UnCabinet() {
  const { t, locale } = useI18n();
  const { cabinetId } = Route.useParams();
  const choix = Route.useSearch();
  const navigate = Route.useNavigate();
  const clients = useClientsDeLaTour();
  const fiche = useMemo(
    () =>
      cabinetsEtLeursPme(clients.data?.cabinets ?? [], clients.data?.pme ?? []).find(
        (c) => c.cabinet.id === cabinetId,
      ) ?? null,
    [clients.data, cabinetId],
  );
  const onglet: Onglet = choix.onglet ?? "abonnements";
  const commeLeCabinet = choix.vue === "cabinet";
  const n = new Intl.NumberFormat(locale);

  const retour = (
    <Link
      to="/tour/cabinets"
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground",
        FOCUS,
      )}
    >
      <ArrowLeft size={14} aria-hidden className="rtl:rotate-180" />
      {t("tour.menu.cabinets")}
    </Link>
  );

  if (clients.isPending) return <Squelette />;
  if (clients.isError)
    return (
      <p role="alert" className="text-[13px] text-etat-stop">
        {texteDeLErreur(clients.error, OU, t("common.error"))}
      </p>
    );
  if (!fiche)
    return (
      <div className="space-y-4">
        {retour}
        <Vide titre={t("tour.cabinet.introuvable")} texte={t("tour.cabinet.introuvable.texte")} />
      </div>
    );

  const { cabinet } = fiche;
  const aller = (suite: Recherche) => void navigate({ search: suite, replace: true });

  return (
    <div data-tour-cabinet={cabinet.id} className="space-y-6">
      <div className="-mt-2">{retour}</div>
      <EnTeteDeLaTour
        surtitre={
          <span className="num">
            <bdi>{[cabinet.matricule, cabinet.juridiction].filter(Boolean).join(" · ")}</bdi>
          </span>
        }
        titre={cabinet.nom}
        action={
          onglet === "abonnements" ? (
            <button
              type="button"
              aria-pressed={commeLeCabinet}
              onClick={() => aller({ vue: commeLeCabinet ? undefined : "cabinet" })}
              className={cn(
                "h-11 border border-foreground px-4 text-[13px] font-medium",
                FOCUS,
                commeLeCabinet ? "bg-card text-foreground" : "bg-foreground text-background",
              )}
            >
              {t(commeLeCabinet ? "tour.cabinet.vueTour" : "tour.cabinet.voirComme")}
            </button>
          ) : undefined
        }
      />

      <BandeauDeChiffres
        chiffres={[
          { cle: "pme", libelle: t("tour.kpi.pme"), valeur: n.format(fiche.pme.length) },
          { cle: "actifs", libelle: t("tour.kpi.actifs"), valeur: n.format(fiche.actifs) },
          {
            cle: "mois",
            libelle: t("tour.kpi.transmisMois"),
            valeur: n.format(fiche.transmisMois),
          },
          {
            cle: "reste",
            libelle: t("tour.fiche.reste"),
            valeur:
              Number(cabinet.reste_du) > 0
                ? `${montant(cabinet.reste_du, locale)} ${cabinet.devise}`
                : "0",
            ton: etatDuCabinet(cabinet) === "impaye" ? "stop" : undefined,
          },
        ]}
      />

      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-muted-foreground">
        <PastilleDEtat etat={etatDuCabinet(cabinet)} />
        {cabinet.echeance_le ? (
          <span className="num">
            {t("tour.echeanceLe", { date: dateCourte(cabinet.echeance_le, locale) })}
          </span>
        ) : null}
        {fiche.offres.length ? <span>{offresEnUneLigne(fiche.offres)}</span> : null}
      </p>

      <div role="tablist" aria-label={cabinet.nom} className="flex gap-6 border-b border-border">
        {(
          [
            ["abonnements", "tour.onglet.abonnements"],
            ["bibliotheque", "tour.onglet.bibliotheque"],
          ] as const
        ).map(([cle, libelle]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => aller({ onglet: cle === "abonnements" ? undefined : cle })}
            className={cn(
              "-mb-px h-11 border-b-2 text-[13px]",
              FOCUS,
              onglet === cle
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(libelle)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {onglet === "bibliotheque" ? (
          <Bibliotheque fiche={fiche} />
        ) : commeLeCabinet ? (
          <section
            aria-label={t("tour.cabinet.voirComme")}
            data-vue-du-cabinet
            className="cabinet-workspace border border-dashed border-border p-4 sm:p-6"
            data-surface="comptabilite"
          >
            <p className="mb-4 text-[11.5px] text-muted-foreground">{t("tour.cabinet.lecture")}</p>
            <AbonnementsDuCabinet
              cabinet={{ id: cabinet.id, name: cabinet.nom, currency: cabinet.devise }}
              lecture
            />
          </section>
        ) : (
          <Abonnements fiche={fiche} />
        )}
      </div>
    </div>
  );
}

type Fiche = NonNullable<ReturnType<typeof cabinetsEtLeursPme>[number]>;

/** Les PME du cabinet et ses factures consolidées. */
function Abonnements({ fiche }: { fiche: Fiche }) {
  const { t, locale } = useI18n();
  const navigate = Route.useNavigate();
  const factures = useQuery({
    queryKey: ["cab-abo-factures", fiche.cabinet.id],
    queryFn: () => office().facturation.facturesDuCabinet(fiche.cabinet.id),
  });
  return (
    <div className="space-y-8">
      <section aria-labelledby="pme-du-cabinet" className="space-y-2">
        <h2 id="pme-du-cabinet" className="text-[14px] font-semibold">
          {t("tour.menu.pme")}
        </h2>
        {fiche.pme.length === 0 ? (
          <Vide titre={t("tour.cabinet.sansPme.titre")} texte={t("tour.cabinet.sansPme.texte")} />
        ) : (
          <TableDesPme
            pme={fiche.pme}
            sansCabinet
            ouvrir={(p) =>
              void navigate({
                to: "/tour/pme",
                search: { cabinet: fiche.cabinet.id, pme: p.id },
              })
            }
          />
        )}
      </section>

      <section aria-labelledby="factures-du-cabinet" className="space-y-2">
        <h2 id="factures-du-cabinet" className="text-[14px] font-semibold">
          {t("tour.cabinet.factures")}
        </h2>
        {factures.isPending ? (
          <Squelette lignes={3} />
        ) : factures.isError ? (
          <p role="alert" className="text-[13px] text-etat-stop">
            {texteDeLErreur(factures.error, OU, t("common.error"))}
          </p>
        ) : (factures.data ?? []).length === 0 ? (
          <Vide titre={t("cab.abo.factures.vide")} texte={t("tour.cabinet.factures.vide")} />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {(factures.data ?? []).map((f) => (
              <li
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_8rem]"
              >
                <span className="min-w-0">
                  <span className="num block truncate text-[13px] font-medium">{f.numero}</span>
                  <span className="num block text-[11px] text-muted-foreground">
                    {f.periode.slice(0, 7)} · {t("tour.cabinet.societes", { n: f.organisations })}
                  </span>
                </span>
                <span className="num hidden text-[12px] text-muted-foreground sm:block">
                  {dateCourte(f.echeance_le, locale)}
                </span>
                <span className="num text-end text-[13px]">
                  {montant(f.montant_ttc, locale)} {f.devise}
                </span>
                <span
                  className={cn(
                    "col-span-2 text-[12px] sm:col-span-1 sm:text-end",
                    f.etat === "en_retard" && "text-etat-stop",
                    f.etat === "payee" && "text-etat-ok",
                    (f.etat === "a_echoir" || f.etat === "partielle") && "text-etat-warn",
                  )}
                >
                  {t(ETAT_DE_FACTURE[f.etat])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** La bibliothèque du cabinet, en nombres : par PME, ses documents et son dernier dépôt. */
function Bibliotheque({ fiche }: { fiche: Fiche }) {
  const { t, locale } = useI18n();
  const n = new Intl.NumberFormat(locale);
  const total = fiche.pme.reduce((s, p) => s + p.documents, 0);
  if (fiche.pme.length === 0)
    return <Vide titre={t("tour.cabinet.sansPme.titre")} texte={t("tour.cabinet.sansPme.texte")} />;
  return (
    <section data-bibliotheque-du-cabinet className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t("tour.biblio.regle")}</p>
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_8rem] gap-x-4 pb-1 text-[11px] text-muted-foreground sm:grid"
      >
        <span>{t("tour.col.pme")}</span>
        <span className="text-end">{t("tour.col.documents")}</span>
        <span className="text-end">{t("tour.col.mois")}</span>
        <span className="text-end">{t("tour.col.dernierDepot")}</span>
      </div>
      <ul className="divide-y divide-border border-y border-border">
        {fiche.pme.map((p) => (
          <li key={p.id}>
            <Link
              to="/tour/pme"
              search={{ cabinet: fiche.cabinet.id, pme: p.id }}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 hover:bg-accent/60 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem]",
                FOCUS,
              )}
            >
              <span className="min-w-0 truncate text-[13.5px] font-medium">{p.nom}</span>
              <span className="num text-end text-[13px]">
                {n.format(p.documents)}
                <span className="text-[11px] text-muted-foreground sm:hidden">
                  {" "}
                  {t("tour.col.documents")}
                </span>
              </span>
              <span className="num col-span-2 text-[12px] text-muted-foreground sm:col-span-1 sm:text-end sm:text-[13px] sm:text-foreground">
                <span className="sm:hidden">{t("tour.col.mois")} </span>
                {n.format(p.transmis_mois)}
              </span>
              <span className="num hidden text-end text-[12px] text-muted-foreground sm:block">
                {dateCourte(p.dernier_depot_le, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="num text-[11px] text-muted-foreground">
        {t("tour.biblio.total", { n: total })}
      </p>
    </section>
  );
}
