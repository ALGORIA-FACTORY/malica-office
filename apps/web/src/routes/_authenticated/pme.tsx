import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Camera, Home as HomeIcon, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { files } from "@/capabilities/files";
import { CameraScanner } from "@/components/regalica/CameraScanner";
import { LanguageSwitcher } from "@/components/regalica/LanguageSwitcher";
import { PmeProvider, type CaptureKind } from "@/components/regalica/pme-context";
import { useI18n } from "@/i18n";
import { readActiveOrgId, writeActiveOrgId } from "@/lib/active-org";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/pme")({
  head: () => ({
    meta: [
      { title: "Espace PME — Regalica Office" },
      {
        name: "description",
        content:
          "Photographiez une facture, lisez-la avec citation de la zone source, confirmez l'écriture et suivez la TVA de la période.",
      },
      { property: "og:title", content: "Espace PME — Regalica Office" },
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
  // La bascule n'a de sens que si l'on a un cabinet où aller.
  const aUnCabinet = (orgsQuery.data ?? []).some((o) => o.kind === "cabinet");
  const hasCabinet = (orgsQuery.data ?? []).some((o) => o.kind === "cabinet");

  // Garde de rôle : sans appartenance PME, on renvoie au portail plutôt qu'un écran muet.
  useEffect(() => {
    if (orgsQuery.isPending) return;
    if (pmeOrgs.length === 0 && hasCabinet) void navigate({ to: "/office" });
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
    mutationFn: async (input: CaptureKind | { pages: Blob[] }) => {
      if (!org) return null;
      const picked =
        typeof input === "object"
          ? await files.scanPages(input.pages)
          : input === "pdf"
            ? await files.pickPdf()
            : await files.takePhoto();
      if (!picked) return null;
      return office().capture.register({
        tenantId: org.id,
        entityId,
        file: picked.blob,
        fileName: picked.name,
        source: picked.source,
        vis: "partage",
        idempotencyKey: files.newIdempotencyKey(),
      });
    },
    onSuccess: async (pieceId) => {
      setCaptureError(null);
      if (!org) return;
      await qc.invalidateQueries({ queryKey: ["pieces", org.id] });
      if (pieceId) await navigate({ to: "/pme/piece/$pieceId", params: { pieceId } });
    },
    onError: (e: unknown) => setCaptureError(e instanceof Error ? e.message : t("common.error")),
  });

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
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-20 text-foreground">
      {path === "/pme" ? null : (
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex items-center justify-end gap-2 px-4 py-2">
            {pmeOrgs.length > 1 ? (
              <select
                aria-label={t("pme.org.switch")}
                value={org?.id ?? ""}
                onChange={(e) => selectOrg(e.target.value)}
                className="me-auto min-w-0 max-w-[104px] truncate border border-border bg-transparent px-1.5 py-1 text-[10px] uppercase tracking-wide focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {pmeOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : null}
            <LanguageSwitcher />
            {aUnCabinet ? (
              <Link
                to="/office"
                className="whitespace-nowrap border border-border px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-accent"
              >
                {t("portal.switch")}
              </Link>
            ) : null}
          </div>
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
              capturing: capture.isPending,
              captureError,
            }}
          >
            <Outlet />
          </PmeProvider>
        )}
      </main>

      <nav
        aria-label={t("pme.nav.aria")}
        className="fixed inset-x-0 bottom-0 z-10 mx-auto grid w-full max-w-md grid-cols-3 items-center border-t border-border bg-card"
      >
        <NavItem {...navItems[0]} />
        <div className="flex justify-center py-[11px]">
          <button
            type="button"
            disabled={!org || capture.isPending}
            onClick={() => setScanning(true)}
            aria-label={t("pme.nav.add")}
            className="grid h-[58px] w-[58px] place-items-center bg-foreground text-background outline outline-1 outline-line-strong disabled:opacity-50"
          >
            <Camera className="h-[25px] w-[25px]" aria-hidden />
          </button>
        </div>
        <NavItem {...navItems[1]} />
      </nav>

      {scanning ? (
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
