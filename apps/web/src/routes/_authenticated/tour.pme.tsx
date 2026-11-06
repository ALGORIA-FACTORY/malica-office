/**
 * Tour › PME et leurs abonnements (2 novembre 2026, maquette 5).
 *
 * Toutes les PME, avec ou sans cabinet : le résumé d'abord (quelques chiffres,
 * qui sont aussi les filtres), puis la liste, sa recherche collée en haut. Une
 * ligne ouvre « Gérer ». Le filtre, le cabinet et la PME ouverte vivent dans
 * l'adresse : un lien depuis la fiche d'un cabinet rouvre la même vue.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";

import { FicheDeLaPme } from "@/components/malica/tour/fiche-pme";
import { useClientsDeLaTour } from "@/components/malica/tour/donnees";
import { TableDesPme } from "@/components/malica/tour/table-des-pme";
import {
  BandeauDeChiffres,
  BarreCollante,
  EnTeteDeLaTour,
  FOCUS,
  PuceDeFiltre,
  Squelette,
  Vide,
} from "@/components/malica/tour/ui";
import { useI18n, type MessageKey } from "@/i18n";
import {
  compterParFiltre,
  filtreDeLAdresse,
  FILTRES_PME,
  pmeRetenues,
  type FiltrePme,
} from "@/lib/clients-de-la-tour";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";

interface Recherche {
  filtre?: FiltrePme | undefined;
  cabinet?: string | undefined;
  pme?: string | undefined;
}

export const Route = createFileRoute("/_authenticated/tour/pme")({
  validateSearch: (s: Record<string, unknown>): Recherche => ({
    ...(filtreDeLAdresse(s["filtre"]) !== "tous" ? { filtre: filtreDeLAdresse(s["filtre"]) } : {}),
    ...(typeof s["cabinet"] === "string" ? { cabinet: s["cabinet"] } : {}),
    ...(typeof s["pme"] === "string" ? { pme: s["pme"] } : {}),
  }),
  component: PmeDeLaTour,
});

const LIBELLE_DU_FILTRE: Record<FiltrePme, MessageKey> = {
  tous: "tour.filtre.tous",
  sans_cabinet: "tour.filtre.sans_cabinet",
  impayes: "tour.filtre.impayes",
  au_quota: "tour.filtre.au_quota",
  suspendus: "tour.filtre.suspendus",
};

function PmeDeLaTour() {
  const { t, locale } = useI18n();
  const choix = Route.useSearch();
  const navigate = Route.useNavigate();
  const clients = useClientsDeLaTour();
  const [recherche, setRecherche] = useState("");

  const filtre = choix.filtre ?? "tous";
  const cabinet = choix.cabinet ?? null;
  const toutes = useMemo(() => clients.data?.pme ?? [], [clients.data]);
  const comptes = useMemo(() => compterParFiltre(toutes), [toutes]);
  const lignes = useMemo(
    () => pmeRetenues(toutes, { filtre, cabinet, recherche }),
    [toutes, filtre, cabinet, recherche],
  );
  const ouverte = choix.pme ? (toutes.find((p) => p.id === choix.pme) ?? null) : null;

  const changer = useCallback(
    (suite: Recherche) => void navigate({ search: (s) => ({ ...s, ...suite }), replace: true }),
    [navigate],
  );
  const fermer = useCallback(() => changer({ pme: undefined }), [changer]);
  const n = new Intl.NumberFormat(locale);

  return (
    <div data-tour-pme className="space-y-6">
      <EnTeteDeLaTour surtitre={t("tour.menu.clients")} titre={t("tour.menu.pme")} />

      {clients.isError ? (
        <p role="alert" className="text-[13px] text-etat-stop">
          {texteDeLErreur(clients.error, "routes/_authenticated/tour.pme", t("common.error"))}
        </p>
      ) : null}

      <BandeauDeChiffres
        chiffres={FILTRES_PME.map((f) => ({
          cle: f,
          libelle: t(LIBELLE_DU_FILTRE[f]),
          valeur: clients.isPending ? "—" : n.format(comptes[f]),
          ton: f === "impayes" ? "stop" : f === "au_quota" ? "warn" : undefined,
          actif: filtre === f,
          onClick: () => changer({ filtre: f === "tous" || filtre === f ? undefined : f }),
        }))}
      />

      <div>
        <BarreCollante
          recherche={recherche}
          setRecherche={setRecherche}
          libelle={t("tour.chercher.pme")}
        >
          <select
            value={cabinet ?? ""}
            onChange={(e) => changer({ cabinet: e.target.value || undefined })}
            aria-label={t("tour.filtre.cabinet")}
            className={cn(
              "h-11 max-w-[14rem] border border-border bg-card px-2.5 text-[12.5px]",
              FOCUS,
            )}
          >
            <option value="">{t("tour.filtre.tousCabinets")}</option>
            {(clients.data?.cabinets ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
          {filtre !== "tous" ? (
            <PuceDeFiltre
              libelle={`${t(LIBELLE_DU_FILTRE[filtre])} ×`}
              actif
              onClick={() => changer({ filtre: undefined })}
            />
          ) : null}
        </BarreCollante>

        <div className="pt-2">
          {clients.isPending ? (
            <Squelette />
          ) : toutes.length === 0 ? (
            <Vide titre={t("tour.pme.vide.titre")} texte={t("tour.pme.vide.texte")} />
          ) : lignes.length === 0 ? (
            <Vide titre={t("tour.filtre.rien.titre")} texte={t("tour.filtre.rien.texte")} />
          ) : (
            <>
              <TableDesPme pme={lignes} ouvrir={(p) => changer({ pme: p.id })} />
              <p className="num pt-3 text-[11px] text-muted-foreground">
                {t("tour.decompte", { n: lignes.length, total: toutes.length })}
              </p>
            </>
          )}
        </div>
      </div>

      {ouverte ? <FicheDeLaPme key={ouverte.id} pme={ouverte} fermer={fermer} /> : null}
    </div>
  );
}
