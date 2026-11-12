/**
 * Clients — la page unique de la comptabilité (8 novembre 2026).
 *
 * ============================================================== POURQUOI
 *
 * Le dirigeant d'ALGORIA l'a demandé : « client, mandat, honoraires,
 * abonnement et facturation, et leur édition, dans une seule page — il ne faut
 * pas s'éparpiller ». Les pages « Honoraires » et « Abonnements des clients »
 * n'existent plus : leurs gestes vivent ici.
 *
 *  - Vue Clients : une ligne par société, regroupées par propriétaire
 *    principal ; des filtres comptés disent ce qui reste à faire ; cocher
 *    plusieurs lignes ouvre les actions en lot ; « Ouvrir » ouvre la fiche à
 *    cinq onglets (société et fiche fiscale, propriétaire et places, mandat et
 *    honoraires, abonnement, factures).
 *  - Vue Facturation : les honoraires à émettre et à encaisser, et la facture
 *    Malica que la comptabilité règle.
 *  - Importer une liste, ou ajouter un client : trois champs suffisent ; rien
 *    n'est facturé tant que le dirigeant n'a pas rejoint (A2).
 *
 * Tout vient de l'API ; chaque geste passe par une porte de la base.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { COMMERCE } from "@/capabilities/coque";
import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import {
  CHAMP,
  FicheClient,
  NouveauClient,
  type OngletFiche,
} from "@/components/malica/clients/fiche-client";
import { ImportClients } from "@/components/malica/clients/import-clients";
import { HonorairesDeLaComptabilite } from "@/components/malica/honoraires-de-la-comptabilite";
import { MalicaNote } from "@/components/malica/office-ui";
import { useMonAcces } from "@/hooks/use-mon-acces";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import {
  correspond,
  couverturesParLicence,
  ficheComplete,
  FILTRES,
  regrouperParProprietaire,
  type FiltreClients,
  type LigneClient,
} from "@/lib/etat-des-clients";
import { montant } from "@/lib/lisible";
import { useNotesDHonoraires } from "@/lib/notes-d-honoraires";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { ClientSummary } from "@malica/socle/ports/repositories";

type Vue = "clients" | "facturation";

interface Recherche {
  vue?: "facturation";
  client?: string;
  onglet?: OngletFiche;
}

/** La facture Malica : un module du web seulement (`COMMERCE`). */
const FacturesMalica = __COMMERCE__
  ? lazy(() =>
      import("@/components/malica/clients/abonnement-du-client").then((m) => ({
        default: m.FacturesMalica,
      })),
    )
  : null;

const ONGLETS: readonly OngletFiche[] = ["societe", "acces", "mandat", "abo", "factures"];

export const Route = createFileRoute("/_authenticated/cabinet/clients")({
  head: () => ({
    meta: [
      { title: "Clients de la comptabilité — Malica Office" },
      {
        name: "description",
        content:
          "Les clients de la comptabilité sur une seule page : fiche fiscale, dirigeant et places, mandat et honoraires, abonnement et facturation.",
      },
      { property: "og:title", content: "Clients de la comptabilité — Malica Office" },
      {
        property: "og:description",
        content:
          "Les clients de la comptabilité sur une seule page : fiche fiscale, dirigeant et places, mandat et honoraires, abonnement et facturation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Recherche => ({
    ...(s["vue"] === "facturation" ? { vue: "facturation" as const } : {}),
    ...(typeof s["client"] === "string" ? { client: s["client"] } : {}),
    ...(ONGLETS.includes(s["onglet"] as OngletFiche) ? { onglet: s["onglet"] as OngletFiche } : {}),
  }),
  component: CabinetClients,
});

const FILTRE_CLE: Record<FiltreClients, MessageKey> = {
  tous: "cab.cli.filtre.tous",
  relancer: "cab.cli.filtre.relancer",
  fiche: "cab.cli.filtre.fiche",
  sansmandat: "cab.cli.filtre.sansmandat",
  sansabo: "cab.cli.filtre.sansabo",
};

/** Les états d'un mandat qui ne donnent plus accès au dossier. */
const MANDAT_CLOS = new Set(["termine", "refuse"]);

function CabinetClients() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const recherche = Route.useSearch();
  const navigate = useNavigate({ from: "/cabinet/clients" });
  // Les notes d'honoraires s'allument à la tour (éteintes le 12 novembre 2026) :
  // sans elles, la vue Facturation ne porte que la facture de Malica — et rien
  // du tout dans l'application installée, où elle disparaît donc.
  const notes = useNotesDHonoraires();
  const aUneFacturation = notes.ouvertes || FacturesMalica !== null;
  const vue: Vue = recherche.vue === "facturation" && aUneFacturation ? "facturation" : "clients";

  const acces = useMonAcces(org.id);
  const expert = acces.data?.role === "expert";

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const etats = useQuery({
    queryKey: ["cab-etat-clients", org.id],
    queryFn: () => office().identity.etatDesClients(org.id),
  });
  const mandats = useQuery({
    queryKey: ["cab-hono-mandats", org.id],
    queryFn: () => office().honoraires.mandats(org.id),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  // Les noms des offres, sans prix : les prix restent dans le module du web.
  const offres = useQuery({
    queryKey: ["catalogue-offres"],
    queryFn: () => office().facturation.catalogueDesOffres(),
  });
  const regimes = useQuery({
    queryKey: ["regimes", org.jurisdiction],
    queryFn: () => office().identity.regimesDisponibles(org.jurisdiction),
  });

  useMalicaPanel(<MalicaNote>{t("cab.cli.panel")}</MalicaNote>, [locale]);

  const actifs = useMemo(
    () => (clients.data ?? []).filter((c) => !MANDAT_CLOS.has(c.engagementStatus)),
    [clients.data],
  );
  const termines = useMemo(
    () => (clients.data ?? []).filter((c) => MANDAT_CLOS.has(c.engagementStatus)),
    [clients.data],
  );
  const fiches = useQueries({
    queries: actifs.map((c) => ({
      queryKey: ["fiche", c.tenantId],
      queryFn: () => office().identity.ficheCourante(c.tenantId),
    })),
  });

  const lignes: LigneClient[] = useMemo(() => {
    const etatDe = new Map((etats.data ?? []).map((e) => [e.tenantId, e]));
    const mandatDe = new Map((mandats.data ?? []).map((m) => [m.clientTenantId, m]));
    return couverturesParLicence(
      actifs.map((c, i) => ({
        client: c,
        etat: etatDe.get(c.tenantId),
        fiche: fiches[i]?.isSuccess ? (fiches[i]!.data ?? null) : undefined,
        mandat: mandatDe.get(c.tenantId),
      })),
    );
  }, [actifs, etats.data, mandats.data, fiches]);

  const collabDe = useMemo(() => {
    // Le collaborateur se nomme ; son adresse seulement à défaut (4.4).
    const parUser = new Map((membres.data ?? []).map((m) => [m.userId, m.nom ?? m.email]));
    const carte = new Map<string, string>();
    for (const a of (affectations.data ?? []).filter((x) => x.active)) {
      const email = parUser.get(a.collaboratorId);
      if (email && !carte.has(a.clientTenantId)) carte.set(a.clientTenantId, email);
    }
    return carte;
  }, [membres.data, affectations.data]);

  const [filtre, setFiltre] = useState<FiltreClients>("tous");
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [nouveau, setNouveau] = useState(false);
  const [importer, setImporter] = useState(false);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annoncer = (texte: string) => {
    setAnnonce(texte);
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => setAnnonce(null), 3200);
  };
  useEffect(
    () => () => {
      if (minuterie.current) clearTimeout(minuterie.current);
    },
    [],
  );

  const visibles = lignes.filter((l) => correspond(l, filtre));
  const groupes = regrouperParProprietaire(visibles);
  const ouvert = recherche.client
    ? lignes.find((l) => l.client.tenantId === recherche.client)
    : undefined;

  const ouvrir = (tenantId: string, onglet?: OngletFiche) =>
    void navigate({
      search: (s: Recherche) => ({ ...s, client: tenantId, ...(onglet ? { onglet } : {}) }),
    });
  const fermerFiche = () =>
    void navigate({ search: (s: Recherche) => ({ ...(s.vue ? { vue: s.vue } : {}) }) });
  const allerVue = (v: Vue) =>
    void navigate({ search: v === "facturation" ? { vue: "facturation" as const } : {} });

  const libelleOffre = (code: string | null) =>
    (offres.data ?? []).find((o) => o.code === code)?.libelle ?? code ?? "";
  const libelleRegime = (code: string | null | undefined) =>
    (regimes.data ?? []).find((r) => r.axe === "imposition" && r.code === code)?.libelle ??
    code ??
    "";

  const sources = [clients, etats, mandats];
  const panne = sources.find((s) => s.error)?.error;
  const chargement = sources.some((s) => s.isPending);
  const premierJour = !chargement && !panne && actifs.length === 0;

  return (
    <div className="cab-library space-y-5">
      {/* ---- l'en-tête */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">{t("cab.cli.kicker")}</p>
          <h1 className="text-[30px] font-bold tracking-[-0.02em]">{t("cab.cli.titre")}</h1>
        </div>
        {expert && !premierJour ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setImporter(true)}
              className="cab-button cab-button-secondary"
            >
              {t("cab.cli.importer")}
            </button>
            <button
              type="button"
              onClick={() => setNouveau(true)}
              className="cab-button cab-button-primary"
            >
              {t("cab.cli.ajouter")}
            </button>
          </div>
        ) : null}
      </header>

      {panne ? (
        <div role="alert" className="rounded-xl border border-border bg-card p-4">
          <p>{texteDeLErreur(panne, "cabinet.clients", t("common.error"))}</p>
          <button
            type="button"
            className="mt-2 min-h-[44px] underline"
            onClick={() => {
              for (const s of sources) void s.refetch();
            }}
          >
            {t("doc.retry")}
          </button>
        </div>
      ) : chargement ? (
        <p role="status">{t("common.loading")}</p>
      ) : premierJour ? (
        <PremierJour
          expert={expert}
          importer={() => setImporter(true)}
          ajouter={() => setNouveau(true)}
        />
      ) : (
        <>
          {/* ---- les deux vues */}
          <div
            role="tablist"
            className={cn("flex gap-1 border-b border-border", !aUneFacturation && "hidden")}
          >
            {(["clients", "facturation"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={vue === v}
                onClick={() => allerVue(v)}
                className={cn(
                  "-mb-px h-10 border-b-2 px-3 text-[14px]",
                  vue === v
                    ? "border-foreground font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t(v === "clients" ? "cab.cli.vue.clients" : "cab.cli.vue.facturation")}
              </button>
            ))}
          </div>

          {vue === "clients" ? (
            <div className="cab-entre space-y-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("cab.cli.filtres")}>
                {FILTRES.map((f) => {
                  const n = lignes.filter((l) => correspond(l, f)).length;
                  const on = filtre === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFiltre(f)}
                      className={cn(
                        "h-8 rounded-full border px-3 text-[12.5px] transition-colors",
                        on
                          ? "border-foreground bg-foreground text-background"
                          : f !== "tous" && n > 0
                            ? "border-border bg-card text-marigold"
                            : "border-border bg-card text-text-2",
                      )}
                    >
                      {t(FILTRE_CLE[f])}{" "}
                      <span className="num ms-1 text-[11px] opacity-80">{n}</span>
                    </button>
                  );
                })}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="hidden grid-cols-[34px_2fr_1.6fr_1.1fr_1.3fr_1.6fr_84px] gap-2 border-b border-border bg-[#fafbfa] px-4 py-2.5 text-[11.5px] text-muted-foreground lg:grid">
                  <span />
                  <span>{t("cab.cli.col.societe")}</span>
                  <span>{t("cab.cli.col.dirigeant")}</span>
                  <span>{t("cab.cli.col.fiche")}</span>
                  <span>{t("cab.cli.col.mandat")}</span>
                  <span>{t("cab.cli.col.abo")}</span>
                  <span />
                </div>
                {groupes.map((g) => (
                  <div key={g.licenceId ?? g.lignes[0]!.client.tenantId}>
                    {g.licenceId ? (
                      <div className="flex flex-wrap justify-between gap-2 border-b border-[#eef0f3] bg-[#f4f8f5] px-4 py-2 text-[12px] lg:ps-[58px]">
                        <span>
                          <strong>{g.titulaire ?? "—"}</strong> · {t("cab.cli.groupe.proprietaire")}
                        </span>
                        <span className="text-muted-foreground">
                          {t("cab.cli.groupe.detail", {
                            offre: libelleOffre(g.lignes[0]!.etat?.forfaitOffre ?? null),
                            societes: g.lignes[0]!.etat?.organisations ?? g.lignes.length,
                            places: `${g.lignes[0]!.etat?.siegesOccupes ?? 0} / ${g.lignes[0]!.etat?.siegesInclus ?? 0}`,
                          })}
                        </span>
                      </div>
                    ) : null}
                    {g.lignes.map((l) => (
                      <Ligne
                        key={l.client.tenantId}
                        l={l}
                        collab={collabDe.get(l.client.tenantId) ?? null}
                        regime={libelleRegime(l.fiche?.regimeImposition)}
                        offre={libelleOffre(l.etat?.accesOffre ?? null)}
                        libelleOffre={libelleOffre}
                        coche={choisis.has(l.client.tenantId)}
                        cocher={() => {
                          const s = new Set(choisis);
                          if (s.has(l.client.tenantId)) s.delete(l.client.tenantId);
                          else s.add(l.client.tenantId);
                          setChoisis(s);
                        }}
                        ouvrir={(o) => ouvrir(l.client.tenantId, o)}
                        expert={expert}
                      />
                    ))}
                  </div>
                ))}
                {visibles.length === 0 ? (
                  <p className="p-7 text-center text-[13px] text-muted-foreground">
                    {t("cab.cli.filtre.vide")}
                  </p>
                ) : null}
              </div>

              {termines.length > 0 ? <Termines termines={termines} /> : null}
            </div>
          ) : (
            <div className="cab-entre space-y-8">
              {notes.ouvertes ? <HonorairesDeLaComptabilite /> : null}
              {FacturesMalica ? (
                <section className="space-y-2">
                  <h2 className="text-[17px] font-semibold">{t("cab.cli.malica.titre")}</h2>
                  <p className="max-w-[70ch] text-[12.5px] text-muted-foreground">
                    {t("cab.cli.malica.lede")}
                  </p>
                  <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
                    <FacturesMalica />
                  </Suspense>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}

      {/* ---- les actions en lot */}
      {expert && choisis.size > 0 && !ouvert && !importer && !nouveau ? (
        <BarreDeLot
          choisis={lignes.filter((l) => choisis.has(l.client.tenantId))}
          offres={offres.data ?? []}
          membres={membres.data ?? []}
          vider={() => setChoisis(new Set())}
          annoncer={annoncer}
        />
      ) : null}

      {ouvert ? (
        <FicheClient
          key={ouvert.client.tenantId}
          client={ouvert.client}
          etat={ouvert.etat}
          mandat={ouvert.mandat}
          offres={offres.data ?? []}
          expert={expert}
          ongletInitial={
            recherche.onglet ??
            (ouvert.fiche !== undefined && !ficheComplete(ouvert.fiche) ? "societe" : "abo")
          }
          fermer={fermerFiche}
          annoncer={annoncer}
          parLaLicence={ouvert.parLaLicence ?? null}
          societesDeLaLicence={
            ouvert.etat?.licenceId
              ? lignes
                  .filter((x) => x.etat?.licenceId === ouvert.etat?.licenceId)
                  .map((x) => x.client.name)
              : []
          }
        />
      ) : null}
      {nouveau ? (
        <NouveauClient
          fermer={() => setNouveau(false)}
          ouvrir={(id, onglet) => {
            setNouveau(false);
            ouvrir(id, onglet);
          }}
          annoncer={annoncer}
        />
      ) : null}
      {importer ? (
        <ImportClients
          fermer={() => setImporter(false)}
          offres={offres.data ?? []}
          commerce={COMMERCE}
        />
      ) : null}

      {annonce ? (
        <div
          role="status"
          className="cab-monte fixed bottom-6 start-6 z-[60] max-w-[min(520px,calc(100vw-48px))] rounded-xl bg-[#17231c] px-4 py-3 text-[13px] text-white shadow-[0_12px_32px_rgba(16,24,40,0.25)]"
        >
          {annonce}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- le premier jour */

function PremierJour({
  expert,
  importer,
  ajouter,
}: {
  expert: boolean;
  importer: () => void;
  ajouter: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="cab-entre flex flex-col items-center gap-5 py-12 text-center">
      <span className="cab-pop flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e8f6ed]">
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#168b50"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .6 3.2 2.4 3.5 5.2" />
        </svg>
      </span>
      <h2 className="text-[28px] font-bold tracking-[-0.02em]">{t("cab.cli.vide.titre")}</h2>
      <p className="max-w-[560px] text-[15px] leading-[1.5] text-muted-foreground">
        {t("cab.cli.vide.lede")}
      </p>
      {expert ? (
        <div className="grid w-full max-w-[760px] gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={importer}
            className="cab-pulse flex flex-col gap-1.5 rounded-2xl border border-[#c9e2d3] bg-card p-5 text-start hover:border-[#168b50]"
          >
            <span className="text-[16px] font-bold">{t("cab.cli.importer")}</span>
            <span className="text-[13px] leading-[1.45] text-muted-foreground">
              {t("cab.cli.vide.importer")}
            </span>
          </button>
          <button
            type="button"
            onClick={ajouter}
            className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-5 text-start hover:border-text-2"
          >
            <span className="text-[16px] font-bold">{t("cab.cli.ajouter")}</span>
            <span className="text-[13px] leading-[1.45] text-muted-foreground">
              {t("cab.cli.vide.ajouter")}
            </span>
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("cab.cli.reserve.expert")}</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- une ligne */

function Ligne({
  l,
  collab,
  regime,
  offre,
  libelleOffre,
  coche,
  cocher,
  ouvrir,
  expert,
}: {
  l: LigneClient;
  collab: string | null;
  regime: string;
  offre: string;
  libelleOffre: (code: string | null) => string;
  coche: boolean;
  cocher: () => void;
  ouvrir: (onglet?: OngletFiche) => void;
  expert: boolean;
}) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const { client, etat, fiche, mandat } = l;
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso))
      : "";

  const dirigeant = etat?.dirigeantPresent
    ? {
        texte: etat.titulaireNom ?? t("cab.cli.dir.present"),
        sous: t("cab.cli.dir.rejoint"),
        ton: "",
      }
    : etat?.invitationEmail
      ? {
          texte: t("cab.cli.dir.invite"),
          sous: etat.invitationExpiree
            ? t("cab.cli.dir.expiree")
            : t("cab.cli.dir.envoyee", { date: date(etat.invitationEnvoyee) }),
          ton: "text-marigold",
        }
      : { texte: t("cab.cli.dir.personne"), sous: t("cab.cli.dir.inviter"), ton: "text-marigold" };
  const ficheTexte =
    fiche === undefined
      ? "…"
      : ficheComplete(fiche)
        ? regime || t("cab.cli.fiche.complete")
        : t("cab.cli.fiche.completer");
  const mandatTexte = mandat
    ? mandat.forfait
      ? t("cab.cli.mandat.forfait", {
          montant: `${montant(mandat.forfait, locale)} ${org.currency}`,
        })
      : t("cab.cli.mandat.temps", {
          montant: `${montant(mandat.tauxHoraire ?? "0", locale)} ${org.currency}`,
        })
    : t("cab.cli.mandat.aucun");
  const abo = l.parLaLicence
    ? {
        texte: t("cab.cli.abo.ligne.licence", { offre: libelleOffre(l.parLaLicence) }),
        sous: t("cab.cli.abo.ligne.licence.sous"),
        ton: "",
      }
    : !etat?.accesStatut
      ? {
          texte: t("cab.cli.abo.ligne.aucun"),
          sous: t("cab.cli.abo.ligne.proposer"),
          ton: "text-muted-foreground",
        }
      : etat.accesStatut === "propose"
        ? {
            texte: t("cab.cli.abo.ligne.propose", { offre }),
            sous: etat.dirigeantPresent
              ? t("cab.cli.abo.ligne.reponse")
              : t("cab.cli.abo.ligne.rien"),
            ton: "text-marigold",
          }
        : {
            texte: t("cab.cli.abo.ligne.paye", { offre }),
            sous: etat.descenteOffre
              ? t("cab.cli.abo.ligne.descente")
              : (etat.siegesInclus ?? 0) === 0
                ? t("cab.cli.places.seul")
                : t("cab.cli.abo.ligne.places", {
                    places: `${etat.siegesOccupes ?? 0} / ${etat.siegesInclus ?? 0}`,
                  }),
            ton: "",
          };

  return (
    <div className="cab-ligne grid grid-cols-[34px_1fr_auto] items-center gap-x-2 gap-y-1 border-b border-[#eef0f3] px-4 py-3 text-[13px] lg:grid-cols-[34px_2fr_1.6fr_1.1fr_1.3fr_1.6fr_84px]">
      {expert ? (
        <input
          type="checkbox"
          checked={coche}
          onChange={cocher}
          aria-label={t("cab.cli.choisir", { client: client.name })}
          className="h-4 w-4 accent-[#17231c]"
        />
      ) : (
        <span />
      )}
      <span className="min-w-0">
        <button
          type="button"
          onClick={() => ouvrir()}
          className="block truncate text-start font-semibold hover:underline"
        >
          {client.name}
        </button>
        <span className="num block text-[11px] text-muted-foreground">
          {client.legalId ?? "—"}
          {client.aTraiter ? (
            <span className="text-marigold">
              {/* Un séparateur écrit, pas une marge : lu ou copié, le compte
                  se collait au matricule (« …/0001 à superviser »). */}
              {" · "}
              {t("cab.cli.a.superviser", { count: client.aTraiter })}
            </span>
          ) : null}
          {client.engagementStatus === "propose" ? (
            <span className="text-[#3d5a99]">
              {" · "}
              {t("cab.cli.mandat.demande")}
            </span>
          ) : null}
        </span>
      </span>
      <button
        type="button"
        onClick={() => ouvrir()}
        className="row-span-1 h-8 rounded-lg border border-border bg-card px-3 text-[12.5px] hover:bg-accent lg:order-last"
      >
        {t("cab.cli.ouvrir")}
      </button>
      <button
        type="button"
        onClick={() => ouvrir("acces")}
        className="col-start-2 col-end-4 min-w-0 text-start lg:col-auto"
      >
        <span className={cn("block truncate", dirigeant.ton)}>{dirigeant.texte}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {dirigeant.sous}
          {collab ? ` · ${collab}` : ""}
        </span>
      </button>
      <button
        type="button"
        onClick={() => ouvrir("societe")}
        className={cn(
          "col-start-2 col-end-4 truncate text-start lg:col-auto",
          fiche !== undefined && !ficheComplete(fiche) && "font-medium text-marigold",
        )}
      >
        {ficheTexte}
      </button>
      <button
        type="button"
        onClick={() => ouvrir("mandat")}
        className={cn(
          "col-start-2 col-end-4 truncate text-start lg:col-auto",
          !mandat && "text-muted-foreground",
        )}
      >
        {mandatTexte}
      </button>
      <button
        type="button"
        onClick={() => ouvrir("abo")}
        className="col-start-2 col-end-4 min-w-0 text-start lg:col-auto"
      >
        <span className={cn("block truncate", abo.ton)}>{abo.texte}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{abo.sous}</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------- les mandats clos */

function Termines({ termines }: { termines: readonly ClientSummary[] }) {
  const { t, locale } = useI18n();
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
          new Date(`${iso.slice(0, 10)}T00:00:00Z`),
        )
      : "—";
  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">
        {t("cab.clients.termines.titre")}{" "}
        <span className="num ms-1 text-muted-foreground">{termines.length}</span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {termines.map((c) => (
          <li
            key={`${c.tenantId}:${c.mandatDepuis ?? ""}`}
            className="flex flex-wrap justify-between gap-2 px-4 py-3"
          >
            <span className="text-[13px] font-medium">{c.name}</span>
            <span className="num text-[11px] text-muted-foreground">
              {c.engagementStatus === "refuse"
                ? t("cab.clients.termines.refuse")
                : t("cab.clients.termines.periode", {
                    debut: date(c.mandatDepuis),
                    fin: date(c.mandatJusquau),
                  })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* --------------------------------------------------------- la barre de lot */

type GesteDeLot = "collab" | "mandat" | "abo" | "relancer";

function BarreDeLot({
  choisis,
  offres,
  membres,
  vider,
  annoncer,
}: {
  choisis: readonly LigneClient[];
  offres: ReadonlyArray<{ code: string; libelle: string }>;
  membres: ReadonlyArray<{ userId: string; email: string }>;
  vider: () => void;
  annoncer: (texte: string) => void;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [geste, setGeste] = useState<GesteDeLot | null>(null);
  const [valeur, setValeur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const appliquer = useMutation({
    mutationFn: async () => {
      let faits = 0;
      let passes = 0;
      for (const l of choisis) {
        const id = l.client.tenantId;
        if (geste === "collab") {
          await office().collab.assign({
            cabinetTenantId: org.id,
            clientTenantId: id,
            collaboratorId: valeur,
          });
          faits++;
        } else if (geste === "mandat") {
          await office().honoraires.definirMandat({
            cabinetTenantId: org.id,
            clientTenantId: id,
            mode: "forfait",
            frequence: "mensuelle",
            jourFacturation: l.mandat?.jourFacturation ?? 1,
            forfait: valeur,
            tauxHoraire: null,
            delaiPaiementJours: l.mandat?.delaiPaiementJours ?? 30,
            couverture: l.mandat?.couverture ?? [],
          });
          faits++;
        } else if (geste === "abo") {
          if (l.etat?.accesStatut || !__COMMERCE__) passes++;
          else {
            const { proposerAbonnement } = await import("@/components/malica/clients/proposer");
            await proposerAbonnement(org.id, id, valeur);
            faits++;
          }
        } else if (geste === "relancer") {
          if (l.etat?.dirigeantPresent || !l.etat?.invitationEmail) passes++;
          else {
            await office().identity.inviterContact(id, l.etat.invitationEmail);
            faits++;
          }
        }
      }
      return { faits, passes };
    },
    onSuccess: async ({ faits, passes }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cab-etat-clients", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-hono-mandats", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-assignments", org.id] }),
      ]);
      annoncer(t("cab.cli.lot.ok", { faits, passes }));
      setGeste(null);
      setValeur("");
      vider();
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, "cabinet.clients.lot", t("common.error"))),
  });

  const GESTES: Array<{ id: GesteDeLot; cle: MessageKey }> = [
    { id: "collab", cle: "cab.cli.lot.collab" },
    { id: "mandat", cle: "cab.cli.lot.mandat" },
    ...(COMMERCE ? [{ id: "abo" as const, cle: "cab.cli.lot.abo" as MessageKey }] : []),
    { id: "relancer", cle: "cab.cli.lot.relancer" },
  ];
  const pret = geste === "relancer" || valeur !== "";

  return (
    <div className="cab-monte fixed bottom-6 start-1/2 z-40 w-[min(960px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl bg-[#17231c] p-3 text-[13px] text-white shadow-[0_12px_32px_rgba(16,24,40,0.25)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-1.5">{t("cab.cli.lot.choisis", { count: choisis.length })}</span>
        {GESTES.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={geste === g.id}
            onClick={() => {
              setGeste(geste === g.id ? null : g.id);
              setValeur("");
              setErreur(null);
            }}
            className={cn(
              "h-8 rounded-lg border px-3 text-[12.5px]",
              geste === g.id
                ? "border-white bg-white text-[#17231c]"
                : "border-[#3c4a42] hover:border-white",
            )}
          >
            {t(g.cle)}
          </button>
        ))}
        <button
          type="button"
          onClick={vider}
          aria-label={t("cab.cli.lot.vider")}
          className="ms-auto h-8 w-8 rounded-lg text-[16px] text-[#c4c8cf] hover:text-white"
        >
          ×
        </button>
      </div>
      {geste ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#3c4a42] pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pret && !appliquer.isPending) appliquer.mutate();
          }}
        >
          {geste === "collab" ? (
            <select
              aria-label={t("cab.cli.lot.collab")}
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              className={cn(CHAMP, "mt-0 max-w-[280px] text-foreground")}
            >
              <option value="">{t("cab.cli.lot.collab.choisir")}</option>
              {membres.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.email}
                </option>
              ))}
            </select>
          ) : geste === "mandat" ? (
            <input
              type="number"
              min={0}
              step="0.001"
              aria-label={t("cab.cli.lot.mandat.montant")}
              placeholder={t("cab.cli.lot.mandat.montant")}
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              className={cn(CHAMP, "num mt-0 max-w-[220px] text-foreground")}
            />
          ) : geste === "abo" ? (
            <select
              aria-label={t("cab.cli.lot.abo")}
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              className={cn(CHAMP, "mt-0 max-w-[240px] text-foreground")}
            >
              <option value="">{t("cab.cli.lot.abo.choisir")}</option>
              {offres.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.libelle}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[#c4c8cf]">{t("cab.cli.lot.relancer.lede")}</span>
          )}
          <span className="text-[12px] text-[#c4c8cf]">
            {t(`cab.cli.lot.${geste}.note` as MessageKey)}
          </span>
          <button
            type="submit"
            disabled={!pret || appliquer.isPending}
            className="ms-auto h-9 rounded-lg bg-white px-4 font-semibold text-[#17231c] disabled:opacity-40"
          >
            {t("cab.cli.lot.appliquer", { count: choisis.length })}
          </button>
          {erreur ? (
            <p role="alert" className="w-full text-[12.5px] text-[#ffb4a8]">
              {erreur}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
