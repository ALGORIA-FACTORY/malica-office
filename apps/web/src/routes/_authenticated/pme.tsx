import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Camera, Home as HomeIcon, Lock } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { CIBLE_COQUE } from "@/capabilities/coque";
import { files } from "@/capabilities/files";
import { BandeauHorsLigne } from "@/components/malica/bandeau-hors-ligne";
import { EntetePme } from "@/components/malica/entete-pme";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { PmeProvider, type CaptureKind } from "@/components/malica/pme-context";
import { useFileDAttente } from "@/hooks/use-file-d-attente";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { readActiveOrgId, writeActiveOrgId } from "@/lib/active-org";
import { vidage } from "@/lib/hors-ligne";
import { FilePleine } from "@/lib/hors-ligne/vidage";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { etiqueterLeDossier } from "@/lib/telemetrie";
import { EcranPlein } from "@/components/EcranPlein";

/*
 * Le cadrage du navigateur — détection, redressement, et un modèle qui se
 * télécharge — n'est chargé que si on l'ouvre. Dans la coque, il ne l'est
 * jamais : le scanner de l'appareil prend sa place.
 */
const CameraScanner = lazy(() =>
  import("@/components/malica/CameraScanner").then((m) => ({ default: m.CameraScanner })),
);

export const Route = createFileRoute("/_authenticated/pme")({
  head: () => ({
    meta: [
      { title: "Espace PME — Malica Office" },
      {
        name: "description",
        content:
          "Photographiez une facture, lisez-la avec citation de la zone source, confirmez l'écriture et suivez la TVA de la période.",
      },
      { property: "og:title", content: "Espace PME — Malica Office" },
      {
        property: "og:description",
        content: "Capture citée, écriture proposée par le Socle, TVA de la période.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeLayout,
});

function PmeLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const orgsQuery = useQuery({
    queryKey: ["my-organizations"],
    queryFn: () => office().identity.listMyOrganizations(),
  });
  const pmeOrgs = (orgsQuery.data ?? []).filter((o) => o.kind === "pme");
  const [activeId, setActiveId] = useState<string | null>(() => readActiveOrgId());
  const org = pmeOrgs.find((o) => o.id === activeId) ?? pmeOrgs[0] ?? null;

  // Les plantages se regroupent par dossier — un uuid, jamais un nom.
  useEffect(() => etiqueterLeDossier(org?.id ?? null), [org?.id]);
  // La bascule n'a de sens que si l'on a un cabinet où aller.
  const aUnCabinet = (orgsQuery.data ?? []).some((o) => o.kind === "cabinet");
  const hasCabinet = (orgsQuery.data ?? []).some((o) => o.kind === "cabinet");

  // Garde de rôle : sans appartenance PME, on renvoie au portail plutôt qu'un écran muet.
  useEffect(() => {
    if (orgsQuery.isPending) return;
    // Dans la coque, pas de portail où aller : l'écran dit qu'il n'y a pas de
    // dossier PME, et propose d'en créer un.
    if (pmeOrgs.length === 0 && hasCabinet && !CIBLE_COQUE) void navigate({ to: "/office" });
  }, [orgsQuery.isPending, pmeOrgs.length, hasCabinet, navigate]);

  function selectOrg(id: string) {
    setActiveId(id);
    writeActiveOrgId(id);
    qc.invalidateQueries();
  }

  const entitiesQuery = useQuery({
    queryKey: ["entities", org?.id],
    queryFn: () => office().identity.listEntities(org!.id),
    enabled: !!org,
  });

  const packQuery = useQuery({
    queryKey: ["ref-pack", org?.jurisdiction],
    queryFn: () => office().referential.activePack(org!.jurisdiction),
    enabled: !!org,
  });

  const entityId =
    (entitiesQuery.data ?? []).find((e) => e.isDefault)?.id ?? entitiesQuery.data?.[0]?.id ?? null;

  const capture = useMutation({
    mutationFn: async (input: CaptureKind | { pages: Blob[]; dejaCadrees?: boolean }) => {
      if (!org) return null;
      const picked =
        typeof input === "object"
          ? await files.scanPages(input.pages, { dejaCadree: input.dejaCadrees === true })
          : input === "pdf"
            ? await files.pickPdf()
            : await files.takePhoto();
      if (!picked) return null;
      /*
       * ============================================ RANGÉE AVANT DE PARTIR
       *
       * La pièce va dans la file, sur l'appareil, avant tout appel réseau. En
       * ligne, elle est chez l'API dans la seconde et on l'ouvre. Hors ligne,
       * elle attend dans « Vos documents » et part au retour du réseau — la
       * photo n'est jamais à refaire.
       */
      const cle = await vidage().deposer(
        {
          cle: files.newIdempotencyKey(),
          tenantId: org.id,
          entityId,
          source: picked.source,
          /*
           * ============================================ LA PIÈCE RESTE CHEZ VOUS
           *
           * Elle était marquée « partage » dès la photo : tout ce qui passait
           * devant l'objectif partait au cabinet, sans que personne l'ait
           * décidé. Un reçu personnel, une photo ratée, un document qui n'a rien
           * à voir — tout arrivait chez l'expert-comptable.
           *
           * On capture donc en « personnel ». La transmission est un GESTE, sur
           * l'écran de la pièce, et c'est le dirigeant qui le fait.
           */
          vis: "personnel",
          contentType: picked.blob.type || "application/pdf",
          nomFichier: picked.name,
        },
        picked.blob,
      );
      const element = await vidage().attendre(cle, 4_000);
      return element?.pieceId ?? null;
    },
    onSuccess: async (pieceId) => {
      setCaptureError(null);
      if (!org) return;
      await qc.invalidateQueries({ queryKey: ["pieces", org.id] });
      await qc.invalidateQueries({ queryKey: ["pieces-lues", org.id] });
      // Arrivée chez l'API : on ouvre la pièce, dont la lecture est déjà
      // demandée. Sinon elle attend, visible, dans la liste.
      if (pieceId) await navigate({ to: "/pme/piece/$pieceId", params: { pieceId } });
      else await navigate({ to: "/pme/list" });
    },
    onError: (e: unknown) =>
      setCaptureError(
        e instanceof FilePleine
          ? t("pme.file.pleine")
          : texteDeLErreur(e, "routes/_authenticated/pme", t("common.error")),
      ),
  });

  const file = useFileDAttente(org?.id ?? null);

  /*
   * Ouvrir la capture : le scanner de l'appareil s'il y en a un, le nôtre sinon.
   *
   * VisionKit et ML Kit sont déjà dans le téléphone, entraînés pour cela, et ne
   * coûtent aucun téléchargement. Notre cadrage reste la voie du navigateur :
   * l'aperçu, un poste de bureau, une démonstration.
   *
   * Les deux rendent la même chose — des pages redressées — donc la suite est
   * identique. Un abandon ne rend rien, et ce n'est pas une panne.
   */
  const ouvrirCapture = useCallback(() => {
    const natif = files.scannerDeLAppareil();
    if (!natif) {
      setScanning(true);
      return;
    }
    void (async () => {
      const pages = await natif.capturer();
      // Déjà cadrées par l'appareil : on ne refait pas le travail.
      if (pages.length > 0) capture.mutate({ pages, dejaCadrees: true });
    })();
  }, [capture]);

  // Le scanner de la page se ferme au bouton retour, avant de reculer.
  useSuperposition(
    scanning,
    useCallback(() => setScanning(false), []),
  );

  const navItems = [
    { to: "/pme", icon: HomeIcon, label: t("pme.nav.home"), active: path === "/pme" },
    {
      to: "/pme/coffre",
      icon: Lock,
      label: t("pme.nav.coffre"),
      active: path.startsWith("/pme/coffre"),
    },
  ] as const;

  return (
    <div className="pt-safe mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-[calc(5rem+env(safe-area-inset-bottom))] text-foreground">
      {/*
       * La barre d'état, peinte : sous Android 15 l'écran passe dessous, et ce
       * qui défile s'y verrait. Au-dessus de l'en-tête collé, en dessous des
       * écrans pleins (z-30 et plus), qui peignent la leur avec `pt-safe`.
       */}
      <div
        aria-hidden
        className="h-safe-top fixed inset-x-0 top-0 z-20 mx-auto w-full max-w-md bg-background/95 backdrop-blur"
      />
      <BandeauHorsLigne />
      {path === "/pme" ? null : (
        <header className="top-safe sticky z-10 border-b border-border bg-background/95 px-[22px] py-2.5 backdrop-blur">
          <EntetePme
            dossiers={pmeOrgs.map((o) => ({ id: o.id, name: o.name }))}
            dossierActif={org?.id ?? null}
            choisirDossier={selectOrg}
            aUnCabinet={aUnCabinet}
          />
        </header>
      )}

      <main className="flex min-h-0 flex-1 flex-col px-4 py-5">
        {orgsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !org ? (
          <div className="border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{t("pme.noorg")}</p>
            <Link
              to="/onboarding"
              className="mt-4 inline-block border border-foreground bg-foreground px-4 py-2 text-xs uppercase tracking-wide text-background"
            >
              {t("app.orgs.create")}
            </Link>
          </div>
        ) : (
          <PmeProvider
            value={{
              tenantId: org.id,
              entityId,
              jurisdiction: org.jurisdiction,
              currency: org.currency,
              packId: packQuery.data?.id ?? null,
              orgName: org.name,
              dossiers: pmeOrgs.map((o) => ({ id: o.id, name: o.name })),
              choisirDossier: selectOrg,
              aUnCabinet,
              capture: (kind) => capture.mutate(kind),
              ouvrirScanner: ouvrirCapture,
              capturing: capture.isPending,
              captureError,
              file,
            }}
          >
            <Outlet />
          </PmeProvider>
        )}
      </main>

      <nav
        aria-label={t("pme.nav.aria")}
        className="pb-safe fixed inset-x-0 bottom-0 z-10 mx-auto grid w-full max-w-md grid-cols-3 items-center border-t border-border bg-card"
      >
        <NavItem {...navItems[0]} />
        <div className="flex justify-center py-[11px]">
          <button
            type="button"
            disabled={!org || capture.isPending}
            onClick={ouvrirCapture}
            aria-label={t("pme.nav.add")}
            className="grid h-[58px] w-[58px] place-items-center bg-foreground text-background outline outline-1 outline-line-strong disabled:opacity-50"
          >
            <Camera className="h-[25px] w-[25px]" aria-hidden />
          </button>
        </div>
        <NavItem {...navItems[1]} />
      </nav>

      {/*
       * Entre l'obturateur et l'écran de la pièce, la page se réduit, s'encode,
       * part. Sans rien à l'écran, cinq pages sur un téléphone lent
       * ressemblent à une application figée.
       */}
      {capture.isPending ? (
        <EcranPlein className="rg-rise pt-safe fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-11 text-center">
          <MalicaAvatar size={66} alt="Malica" rond />
          <p className="mt-[26px] text-[19px] leading-[1.5] tracking-[-0.01em]">
            {t("pme.capture.preparation")}
          </p>
          <div className="rg-breathe mt-[30px] h-0.5 w-[130px] bg-foreground" />
        </EcranPlein>
      ) : null}

      {scanning ? (
        <Suspense fallback={null}>
          <CameraScanner
            onCancel={() => setScanning(false)}
            onFallback={() => {
              setScanning(false);
              capture.mutate("photo");
            }}
            onDone={(pages) => {
              setScanning(false);
              if (pages.length > 0) capture.mutate({ pages });
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  active,
}: {
  to: string;
  icon: typeof HomeIcon;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center gap-1 py-3 text-[10px] font-medium uppercase tracking-wider",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
