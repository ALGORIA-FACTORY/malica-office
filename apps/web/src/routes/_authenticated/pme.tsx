import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Camera, Home as HomeIcon, Lock } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { CIBLE_COQUE } from "@/capabilities/coque";
import { files, type PickedFile } from "@/capabilities/files";
import { BandeauHorsLigne } from "@/components/malica/bandeau-hors-ligne";
import { EntetePme } from "@/components/malica/entete-pme";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { PmeProvider, type CaptureKind } from "@/components/malica/pme-context";
import { QuestionDuType } from "@/components/malica/question-du-type";
import { useFileDAttente } from "@/hooks/use-file-d-attente";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { ouverturesDuForfait } from "@/lib/forfait";
import { visibiliteALaCapture } from "@/lib/visibilite-a-la-capture";
import { readActiveOrgId, writeActiveOrgId } from "@/lib/active-org";
import { vidage } from "@/lib/hors-ligne";
import { FilePleine } from "@/lib/hors-ligne/vidage";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { etiqueterLeDossier } from "@/lib/telemetrie";

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
  /*
   * Y a-t-il un cabinet mandaté ? C'est lui qui décide si la pièce part au
   * cabinet dès la photo — voir `visibiliteALaCapture` et les deux défauts
   * qu'elle arbitre.
   */
  const monCabinet = useQuery({
    queryKey: ["mon-cabinet", org?.id],
    queryFn: () => office().identity.monCabinet(org!.id),
    enabled: Boolean(org?.id),
    staleTime: 10 * 60 * 1000,
  });

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

  /*
   * ======================================= LE FORFAIT, LU UNE FOIS, ET ICI
   *
   * Trois écrans l'appelaient chacun pour soi — accueil, capture, réglages —
   * en redéclarant chacun son interface et son propre dépôt `facturation`,
   * hors du point de composition. Deux clés de cache pour la même donnée,
   * deux allers-retours, et deux règles de dégradation qui ne jugeaient pas
   * le même fait.
   *
   * La clé n'a pas de dossier : la licence appartient à la PERSONNE, et
   * `mon_forfait()` ne rend que celle dont l'appelant est titulaire.
   *
   * `retry: false` : une licence absente n'est pas une panne à réessayer
   * trois fois, et un compteur qui tarde ne doit jamais retenir la capture.
   */
  const forfaitQuery = useQuery({
    queryKey: ["mon-forfait"],
    queryFn: () => office().facturation.monForfait(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const packQuery = useQuery({
    queryKey: ["ref-pack", org?.jurisdiction],
    queryFn: () => office().referential.activePack(org!.jurisdiction),
    enabled: !!org,
  });

  const entityId =
    (entitiesQuery.data ?? []).find((e) => e.isDefault)?.id ?? entitiesQuery.data?.[0]?.id ?? null;

  /*
   * ========================= LA QUESTION SE POSE AVANT LA LECTURE, PAS APRÈS
   *
   * Demandé quatre fois depuis le 10 octobre : « après le scan un écran
   * apparaît pour que l'utilisateur choisisse autre document, achat ou vente,
   * extrait bancaire, gouvernance. Et après le choix Malica lit le document
   * sur cette base. »
   *
   * La capture se coupe donc en deux. Le fichier est choisi d'abord et gardé
   * ICI, en mémoire ; rien n'est envoyé tant que la question n'a pas de
   * réponse. Poser la question après aurait voulu dire lire sur la mauvaise
   * hypothèse, puis corriger — et un extrait bancaire lu avec une invite de
   * facture donne une facture ratée, pas un relevé.
   *
   * Le fichier ne se reprend pas : s'il est là et que la personne ferme la
   * question, il part sans type plutôt que d'être perdu. Une photo refaite
   * est le pire prix qu'on puisse lui demander.
   */
  /*
   * ====================================== PLUSIEURS DOCUMENTS D'UN SEUL COUP
   *
   * 11 octobre 2026 : « et l'upload plusieurs doc pdf ? »
   *
   * L'entrée fichier n'avait pas `multiple` : un document à la fois. Pour
   * qui rattrape un mois de factures, c'est trente allers-retours — et trente
   * occasions d'arrêter en route.
   *
   * Ce qui attend un type est donc une LISTE. Un seul document est une liste
   * d'un élément, et rien d'autre ne change.
   *
   * ================================ ET LA QUESTION NE SE POSE QU'UNE FOIS
   *
   * Dix documents ne font pas dix questions : un lot est presque toujours
   * d'une seule nature — un mois d'achats, un carnet de ventes. La réponse
   * vaut pour le lot, et chaque pièce reste retypable ensuite.
   *
   * Dix questions d'affilée, c'est dix occasions d'abandonner, et la dixième
   * reçoit une réponse au hasard.
   */
  const [aTyper, setATyper] = useState<PickedFile[]>([]);

  const choisir = useMutation({
    mutationFn: async (input: CaptureKind | { pages: Blob[]; dejaCadrees?: boolean }) => {
      if (typeof input === "object") {
        // Plusieurs PAGES d'UNE pièce : à ne pas confondre avec plusieurs
        // pièces. La distinction est dans la capacité, pas ici.
        const une = await files.scanPages(input.pages, { dejaCadree: input.dejaCadrees === true });
        return une ? [une] : [];
      }
      return input === "pdf" ? files.pickPdfs() : files.takePhoto();
    },
    onSuccess: (choisis) => {
      setCaptureError(null);
      if (choisis.length > 0) setATyper(choisis);
    },
    onError: (e: unknown) =>
      setCaptureError(
        e instanceof FilePleine
          ? t("pme.file.pleine")
          : texteDeLErreur(e, "routes/_authenticated/pme", t("common.error")),
      ),
  });

  const capture = useMutation({
    /**
     * Le lot entre pièce par pièce, et chacune a sa propre clé.
     *
     * ============================================= POURQUOI UNE CLÉ CHACUNE
     *
     * La clé d'idempotence identifie UNE pièce. Partagée, le deuxième dépôt
     * serait pris pour un doublon du premier : neuf factures sur dix
     * disparaîtraient sans aucun message.
     */
    mutationFn: async (input: { lot: readonly PickedFile[]; documentKind: string | null }) => {
      if (!org) return [];
      const identifiants: string[] = [];
      for (const picked of input.lot) {
        const id = await deposerUnePiece(picked, input.documentKind);
        if (id) identifiants.push(id);
      }
      return identifiants;
    },
    /*
     * ======================================== OÙ L'ON ARRIVE APRÈS LA PHOTO
     *
     * Sur l'écran de capture, et sur les pièces QU'ON VIENT DE PRENDRE.
     *
     * L'obturateur menait au dossier de la pièce, et la pièce n'était jamais
     * lue : née `personnel`, elle est refusée par B6, et l'écran du dossier
     * n'offrait aucune sortie sans mandat de cabinet. Trente pièces, zéro
     * lue, et une impasse fermée.
     *
     * `/pme/capturer` existait, enregistré, fini, et AUCUN lien du dépôt n'y
     * menait. Il pose la question dans le bon ordre — la destination d'abord,
     * la lecture sur clic explicite ensuite — et c'est le seul écran qui le
     * fasse. L'obturateur y mène donc directement : le geste le plus fréquent
     * du produit ne se paie pas d'un détour, et aucune entrée ne s'ajoute à
     * la barre du bas, qui est dessinée à trois places.
     *
     * Les identifiants voyagent dans l'URL, et c'est le propos : sans eux,
     * l'écran demanderait la destination des trente pièces du dossier pour
     * une seule photo prise.
     */
    onSuccess: async (identifiants) => {
      setCaptureError(null);
      if (!org) return;
      await qc.invalidateQueries({ queryKey: ["pieces", org.id] });
      await qc.invalidateQueries({ queryKey: ["pieces-lues", org.id] });
      await navigate({
        to: "/pme/capturer",
        search: identifiants.length > 0 ? { pieces: identifiants.join(",") } : {},
      });
    },
    onError: (e: unknown) =>
      setCaptureError(
        e instanceof FilePleine
          ? t("pme.file.pleine")
          : texteDeLErreur(e, "routes/_authenticated/pme", t("common.error")),
      ),
  });

  async function deposerUnePiece(picked: PickedFile, documentKind: string | null) {
    if (!org) return null;
    const vis = visibiliteALaCapture({ mandatActif: Boolean(monCabinet.data?.id) });
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
         * ==================================== ELLE NAÎT CHEZ SON DIRIGEANT
         *
         * Ce commentaire disait « sous mandat actif, elle part », et c'est
         * FAUX depuis le 7 octobre 2026 : la fonction rend « personnel »,
         * toujours.
         *
         * Le produit s'est trompé dans les deux sens. Le 4 octobre, rien ne
         * partait et rien à l'écran ne disait qu'un geste manquait. On a
         * alors transmis d'office à la photo, et le 7 une facture rejetée
         * était déjà chez le comptable — partie avant d'être lue, donc
         * avant que son verdict existe.
         *
         * La transmission est depuis une DÉCISION, prise à la fin de la
         * lecture, en deux boutons de même poids. Et le retour d'une pièce
         * transmise demande l'accord du cabinet.
         */
        vis,
        contentType: picked.blob.type || "application/pdf",
        documentKind,
        nomFichier: picked.name,
      },
      picked.blob,
    );
    const element = await vidage().attendre(cle, 4_000);
    return element?.pieceId ?? null;
  }

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
      if (pages.length > 0) choisir.mutate({ pages, dejaCadrees: true });
    })();
  }, [choisir]);

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
    /*
     * `data-surface="pme"` est posé ICI et nulle part ailleurs : un seul
     * `layout` porte le langage, donc une seule ligne décide de la surface.
     * Le cabinet, qui ne passe jamais par ce layout, garde Edition One
     * intact sans qu'on ait eu à l'exclure.
     */
    <div
      data-surface="pme"
      className="pt-safe mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-[calc(5rem+env(safe-area-inset-bottom))] text-foreground"
    >
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
              matricule: org.legalId,
              dossiers: pmeOrgs.map((o) => ({ id: o.id, name: o.name })),
              choisirDossier: selectOrg,
              aUnCabinet,
              capture: (kind) => choisir.mutate(kind),
              ouvrirScanner: ouvrirCapture,
              capturing: capture.isPending || choisir.isPending,
              captureError,
              file,
              forfait: {
                ligne: forfaitQuery.data ?? null,
                enCours: forfaitQuery.isPending,
                illisible: forfaitQuery.isError,
                ouvertures: ouverturesDuForfait(forfaitQuery.data ?? null),
              },
            }}
          >
            <Outlet />
          </PmeProvider>
        )}
      </main>

      {aTyper.length > 0 ? (
        <QuestionDuType
          documents={aTyper.map((p) => p.name)}
          onRepondre={(code) => {
            const lot = aTyper;
            setATyper([]);
            capture.mutate({ lot, documentKind: code });
          }}
          onPasser={() => {
            // Les fichiers sont deja choisis : passer les envoie sans type
            // plutot que de les perdre. Une photo refaite est le pire prix
            // qu'on puisse demander.
            const lot = aTyper;
            setATyper([]);
            capture.mutate({ lot, documentKind: null });
          }}
        />
      ) : null}

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
        <div className="rg-rise pt-safe fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col items-center justify-center bg-background px-11 text-center">
          <MalicaAvatar size={66} alt="Malica" rond />
          <p className="mt-[26px] text-[19px] leading-[1.5] tracking-[-0.01em]">
            {t("pme.capture.preparation")}
          </p>
          <div className="rg-breathe mt-[30px] h-0.5 w-[130px] bg-foreground" />
        </div>
      ) : null}

      {scanning ? (
        <Suspense fallback={null}>
          <CameraScanner
            onCancel={() => setScanning(false)}
            onFallback={() => {
              setScanning(false);
              choisir.mutate("photo");
            }}
            onDone={(pages) => {
              setScanning(false);
              if (pages.length > 0) choisir.mutate({ pages });
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
