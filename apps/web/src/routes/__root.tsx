import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { coque, estNatif, versionClient } from "@/capabilities/coque";
import { useApparence } from "@/components/malica/apparence";
import { GardeDeVersion } from "@/components/malica/mise-a-jour-requise";
import { I18nProvider } from "@/i18n";
import { installerJournalAtelier, noterAuJournal } from "@/lib/journal-atelier";
import { rapporterPlantage } from "@/lib/rapport-plantage";
import { fermerLaDerniereSuperposition } from "@/lib/superpositions";
import { CANAL, demarrerLaTelemetrie } from "@/lib/telemetrie";
import { ecouterLaDeconnexion } from "@/lib/transport/etat";

/*
 * La langue et le sens d'écriture, AVANT le premier rendu : lus dans le
 * stockage par un script en tête, pour qu'une personne arabophone ne voie
 * jamais un écran français basculer sous ses yeux. Le fournisseur de
 * traductions, lui, s'accorde après montage — la coquille tolère l'écart.
 */
const LANGUE_AVANT_RENDU =
  '(function(){try{var l=localStorage.getItem("malica.locale");var d=document.documentElement;' +
  'if(l==="ar"){d.lang="ar";d.dir="rtl"}else if(l==="en"){d.lang="en"}}catch(e){}})();';

/*
 * L'apparence, AVANT le premier rendu, et pour la même raison que la langue.
 *
 * Le défaut est le SOMBRE (voir `apparence.ts`), et `useApparence` ne pose la
 * classe `dark` qu'après le montage de React : sans ce script, chaque
 * ouverture montrerait une page blanche le temps de l'hydratation puis
 * basculerait en noir. Un flash blanc sur un téléphone tenu en main le soir,
 * c'est exactement ce que le mode sombre existe pour éviter.
 *
 * Il reproduit `lue()` puis `appliquer()`, et rien d'autre : le même défaut, la
 * même tolérance pour « systeme », la même lecture de `prefers-color-scheme`.
 * Les deux doivent dire la même chose — sinon le flash revient, inversé.
 * `catch` retombe sur le défaut : stockage refusé n'est pas une raison de
 * servir du blanc.
 */
const APPARENCE_AVANT_RENDU =
  "(function(){var d=document.documentElement;try{" +
  'var a=localStorage.getItem("malica.apparence");' +
  'if(a!=="paper"&&a!=="ink"&&a!=="systeme")a="ink";' +
  'if(a==="ink"||(a==="systeme"&&window.matchMedia("(prefers-color-scheme: dark)").matches))' +
  'd.classList.add("dark")}catch(e){d.classList.add("dark")}})();';

/*
 * Comme la frontière d'erreur : ce composant se rend HORS du fournisseur de
 * traductions — il porte ses phrases lui-même, dans les trois langues.
 */
const INTROUVABLE = {
  fr: {
    titre: "Cette page n'existe pas.",
    corps: "L'adresse est peut-être ancienne, ou mal recopiée.",
    accueil: "Revenir à l'accueil",
  },
  en: {
    titre: "This page does not exist.",
    corps: "The address may be old, or mistyped.",
    accueil: "Back home",
  },
  ar: {
    titre: "هذه الصفحة غير موجودة.",
    corps: "ربما يكون العنوان قديمًا أو منسوخًا بشكل خاطئ.",
    accueil: "العودة إلى الرئيسية",
  },
} as const;

function NotFoundComponent() {
  const router = useRouter();
  const langue = langueDeSecours();
  const path = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (path === "/index") void router.navigate({ to: "/", replace: true });
  }, [path, router]);

  if (path === "/index") {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
        <p className="text-sm text-muted-foreground">Ouverture de Malica Office…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{INTROUVABLE[langue].titre}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{INTROUVABLE[langue].corps}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {INTROUVABLE[langue].accueil}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Ce qui s'affiche quand un écran ne peut pas se rendre.
 *
 * ================================================== POURQUOI PAS `useI18n` ICI
 *
 * Cette frontière REMPLACE l'arbre qui vient d'échouer — et le fournisseur de
 * traductions est dans cet arbre. L'appeler ici marcherait tant que la panne
 * vient d'ailleurs, et planterait le jour où c'est lui qui tombe : l'écran
 * d'erreur ne doit jamais pouvoir échouer à son tour.
 *
 * On lit donc la langue là où elle est rangée, et l'on porte les trois phrases
 * dont on a besoin. Trois phrases dupliquées valent mieux qu'un écran de
 * secours qui dépend de ce qu'il secourt.
 */
const SECOURS = {
  fr: {
    titre: "Cet écran n'a pas pu s'afficher.",
    corps: "Ce n'est pas votre faute. Réessayez, ou revenez à l'accueil.",
    reessayer: "Réessayer",
    accueil: "Revenir à l'accueil",
  },
  en: {
    titre: "This screen could not be displayed.",
    corps: "It is not your fault. Try again, or go back home.",
    reessayer: "Try again",
    accueil: "Back home",
  },
  ar: {
    titre: "تعذّر عرض هذه الشاشة.",
    corps: "ليس خطأك. أعد المحاولة أو عد إلى الصفحة الرئيسية.",
    reessayer: "أعد المحاولة",
    accueil: "العودة إلى الرئيسية",
  },
} as const;

function langueDeSecours(): keyof typeof SECOURS {
  try {
    const rangee = window.localStorage.getItem("malica.locale");
    if (rangee === "en" || rangee === "ar" || rangee === "fr") return rangee;
  } catch {
    // Stockage inaccessible — navigation privée, réglage du navigateur.
  }
  return "fr";
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const mots = SECOURS[langueDeSecours()];

  /*
   * ============================================ CE QU'ON N'AFFICHE PLUS JAMAIS
   *
   * Le message d'origine ne va PAS à l'écran. Un utilisateur a vu
   * « Cannot transfer object of unsupported type. » en anglais au milieu d'une
   * interface française : le texte d'un moteur, qui ne lui apprend rien et
   * qu'il ne peut pas corriger.
   *
   * Il part au journal de l'atelier, avec sa pile d'appels. Rien n'est perdu —
   * ce que l'utilisateur ne voit plus, le poste de développement le reçoit.
   *
   * ============================================== ET DEPUIS L'APPLICATION LIVRÉE
   *
   * Le journal d'atelier n'existe qu'en développement. Le 4 octobre 2026, un
   * plantage sur un téléphone n'a donc laissé AUCUNE trace, et le diagnostic
   * s'est arrêté là. `rapporterPlantage` ferme ce trou : le même message et la
   * même pile partent vers notre serveur, expurgés de tout ce qui pourrait
   * nommer une personne, une société, une somme ou un secret.
   */
  useEffect(() => {
    console.error(error);
    noterAuJournal("frontière d'erreur", error);
    void rapporterPlantage({
      ou: "frontière d'erreur",
      message: error,
      pile: error.stack,
      versionClient: versionClient(),
      appareil: typeof navigator === "undefined" ? undefined : navigator.userAgent,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{mots.titre}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{mots.corps}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {mots.reessayer}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {mots.accueil}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // `viewport-fit=cover` : l'écran va jusqu'aux bords, et la zone sûre —
      // la barre de gestes d'Android — se gère par `env(safe-area-inset-*)`.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Malica Office" },
      {
        name: "description",
        content:
          "Suite comptable augmentée : lecture citée des pièces, écritures déterministes, supervision par expert-comptable.",
      },
      { name: "author", content: "Algoria Factory" },
      { name: "theme-color", content: "#FFFFFF" },
      { property: "og:title", content: "Malica Office" },
      {
        property: "og:description",
        content: "Comptabilité augmentée, chiffre gouverné. Système Comptable Tunisien.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      // Les polices sont embarquées avec la feuille de style : rien ne se
      // charge depuis un tiers, et l'arabe s'affiche hors ligne aussi.
      {
        rel: "stylesheet",
        href: appCss,
      },
      /*
       * L'icône porte la marque ALGORIA, et elle vient du kit.
       *
       * 11 octobre 2026 : « le favicon de lovable doit être supprimé et
       * remplacé par algoria ». L'onglet affichait encore l'icône de l'outil
       * qui a servi à démarrer le projet — sur un produit qu'un dirigeant
       * ouvre devant son comptable, c'est la marque de quelqu'un d'autre.
       *
       * Deux fichiers et non un : `favicon.ico` porte trois tailles pour
       * l'onglet, et l'icône Apple manquait — sans elle, un raccourci ajouté
       * depuis Safari prend une capture de la page.
       */
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      // L'application s'installe depuis le navigateur (ANO-033) : le manifeste
      // dit son nom, ses icônes et qu'elle s'ouvre en plein écran.
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
    scripts: [{ children: LANGUE_AVANT_RENDU }, { children: APPARENCE_AVANT_RENDU }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // Les scripts en tête ont pu changer la langue et poser `dark` avant
    // l'hydratation : l'écart sur ces attributs et sur `class` est voulu.
    <html lang="fr" dir="ltr" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  // À la racine : le thème vaut pour toute l'application, cabinet compris, et
  // il survit à la navigation. Le poser sur l'écran des réglages ne l'aurait
  // tenu que le temps d'y rester.
  useApparence();

  // En developpement seulement : rapporte la PILE d une erreur au poste de
  // l atelier. Sans elle, un defaut propre a un appareil ne livre que son
  // texte, et l on corrige a l aveugle.
  useEffect(() => installerJournalAtelier(), []);

  // Le service worker de l'application installable (ANO-033) : en production,
  // dans le navigateur seulement. La coque Android a ses propres mises à
  // jour (« en vol ») et n'en veut pas.
  useEffect(() => {
    if (!import.meta.env.PROD || estNatif() || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((e: unknown) => {
      console.warn("service worker non enregistré", e);
    });
  }, []);

  // Le transport a vu la session finir — un jeton long refusé, deux 401 de
  // suite. Ce qui était affiché appartenait à cette session : on l'oublie,
  // et l'on revient à la porte.
  useEffect(
    () =>
      ecouterLaDeconnexion(() => {
        queryClient.clear();
        void router.navigate({ to: "/auth", replace: true });
      }),
    [queryClient, router],
  );

  /*
   * Le bouton retour d'Android : d'abord ce qui est ouvert par-dessus, puis
   * l'historique, puis — depuis un accueil — quitter. Sans cet auditeur, la
   * coque reculait à travers les superpositions et sortait de la pièce.
   */
  useEffect(
    () =>
      coque().app.surBoutonRetour(() => {
        if (fermerLaDerniereSuperposition()) return;
        if (router.history.canGoBack()) {
          router.history.back();
          return;
        }
        const chemin = router.state.location.pathname;
        if (chemin === "/pme" || chemin === "/office" || chemin === "/") coque().app.quitter();
        else void router.navigate({ to: "/pme", replace: true });
      }),
    [router],
  );

  /*
   * Le clavier des tablettes et du bureau : `Échap` ferme ce qui est ouvert
   * par-dessus, exactement comme le bouton retour d'Android. Même pile, deux
   * portes.
   *
   * Mesuré avant : panneau de Malica ouvert, `Échap` pressé, panneau toujours
   * là. Le cabinet avait son écouteur, la PME non — donc sur une tablette
   * avec clavier, on entrait dans le fil de Malica et on n'en sortait plus
   * sans souris.
   */
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fermerLaDerniereSuperposition()) e.preventDefault();
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  // Les plantages de la coque partent chez Sentry — dans la coque seulement,
  // et jamais un document (voir `lib/telemetrie.ts`).
  useEffect(() => {
    void demarrerLaTelemetrie();
  }, []);

  // Le premier écran est là : l'écran de lancement peut tomber, et la coque
  // s'inscrit sur le canal de mise à jour en vol de sa cible.
  useEffect(() => {
    void coque().demarrage.pret();
    void coque()
      .misesAJour.suivreLeCanal(CANAL)
      .catch((raison) => noterAuJournal("canal de mise à jour", raison));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <GardeDeVersion>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </GardeDeVersion>
      </I18nProvider>
    </QueryClientProvider>
  );
}
