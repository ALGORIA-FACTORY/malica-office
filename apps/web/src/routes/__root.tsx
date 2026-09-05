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
import { useApparence } from "@/components/regalica/apparence";
import { I18nProvider } from "@/i18n";
import { installerJournalAtelier, noterAuJournal } from "@/lib/journal-atelier";

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
        <p className="text-sm text-muted-foreground">Ouverture de Regalica Office…</p>
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
    const rangee = window.localStorage.getItem("regalica.locale");
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
   */
  useEffect(() => {
    console.error(error);
    noterAuJournal("frontière d'erreur", error);
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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Regalica Office" },
      {
        name: "description",
        content:
          "Suite comptable augmentée : lecture citée des pièces, écritures déterministes, supervision par expert-comptable.",
      },
      { name: "author", content: "Algoria Factory" },
      { property: "og:title", content: "Regalica Office" },
      {
        property: "og:description",
        content: "Comptabilité augmentée, chiffre gouverné. Système Comptable Tunisien.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Kufi+Arabic:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr">
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
  // À la racine : le thème vaut pour toute l'application, cabinet compris, et
  // il survit à la navigation. Le poser sur l'écran des réglages ne l'aurait
  // tenu que le temps d'y rester.
  useApparence();

  // En developpement seulement : rapporte la PILE d une erreur au poste de
  // l atelier. Sans elle, un defaut propre a un appareil ne livre que son
  // texte, et l on corrige a l aveugle.
  useEffect(() => installerJournalAtelier(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </I18nProvider>
    </QueryClientProvider>
  );
}
