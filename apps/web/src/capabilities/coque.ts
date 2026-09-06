/**
 * La coque — ce que l'application sait de l'enveloppe qui la porte.
 *
 * Deux questions, qu'il ne faut jamais confondre :
 *
 *   CIBLE_COQUE   à la compilation : ce bundle est-il celui qu'on embarque dans
 *                 la coque ? Décide de ce qui ENTRE dans le paquet — le coffre,
 *                 les greffons. Le tree-shaking retire l'autre branche.
 *
 *   estNatif()    à l'exécution : ce bundle tourne-t-il DANS la coque, ou dans
 *                 un navigateur ? Décide des comportements — jeton porteur ou
 *                 cookie, scanner de l'appareil ou cadrage de la page.
 *
 * Un bundle de coque ouvert dans Chrome (`vite preview --mode coque-staging`)
 * a CIBLE_COQUE vrai et estNatif() faux : il se comporte comme le web, et
 * c'est ce qui permet de l'éprouver sans téléphone.
 *
 * Même patron que `numerisation.ts` : le monde natif est derrière une
 * interface, jamais un import direct. Les greffons de Capacitor viennent en
 * import différé, au moment où l'on en a besoin, et jamais dans un navigateur.
 */

export const CIBLE_COQUE = import.meta.env["VITE_CIBLE"] === "coque";

/** Vrai dans la coque iOS ou Android ; faux dans un navigateur. */
export function estNatif(): boolean {
  // `Capacitor` n'est posé sur la fenêtre que par la coque native.
  const global = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  return global.Capacitor?.isNativePlatform?.() === true;
}

/**
 * Ce que la coque dit d'elle à l'API : « coque-android/0.1.0 », ou
 * « web/0.1.0 » depuis un navigateur. La version est celle du dépôt, posée
 * au build ; sans elle, « atelier » — que l'API ignore, comme il se doit.
 */
export function versionClient(): string {
  const version = (import.meta.env["VITE_VERSION_CLIENT"] as string | undefined) ?? "0.0.0";
  if (!CIBLE_COQUE) return `web/${version}`;
  const global = globalThis as { Capacitor?: { getPlatform?: () => string } };
  const plateforme = global.Capacitor?.getPlatform?.() ?? "web";
  return `coque-${plateforme}/${version}`;
}

/** Ce que l'application demande à la coque, et rien de plus. */
export interface PontCoque {
  app: {
    /** L'application revient au premier plan — un téléphone déverrouillé. */
    surReprise(rappel: () => void): () => void;
    /** Le bouton retour d'Android. Sans auditeur, la coque quitte. */
    surBoutonRetour(rappel: () => void): () => void;
    quitter(): void;
  };
  reseau: {
    surChangement(rappel: (enLigne: boolean) => void): () => void;
  };
  demarrage: {
    /** Le premier écran est rendu : l'écran de lancement peut tomber. */
    pret(): Promise<void>;
  };
}

/** Un auditeur posé par un greffon dont l'import est différé. */
function auditeurDiffere(
  poser: () => Promise<{ remove: () => Promise<void> } | { remove: () => void }>,
): () => void {
  let retire = false;
  let poignee: { remove: () => Promise<void> | void } | null = null;
  void poser().then((p) => {
    if (retire) void p.remove();
    else poignee = p;
  });
  return () => {
    retire = true;
    void poignee?.remove();
  };
}

function pontNatif(): PontCoque {
  return {
    app: {
      surReprise: (rappel) =>
        auditeurDiffere(async () => {
          const { App } = await import("@capacitor/app");
          return App.addListener("resume", rappel);
        }),
      surBoutonRetour: (rappel) =>
        auditeurDiffere(async () => {
          const { App } = await import("@capacitor/app");
          return App.addListener("backButton", rappel);
        }),
      quitter() {
        void import("@capacitor/app").then(({ App }) => App.exitApp());
      },
    },
    reseau: {
      surChangement: (rappel) =>
        auditeurDiffere(async () => {
          const { Network } = await import("@capacitor/network");
          return Network.addListener("networkStatusChange", (s) => rappel(s.connected));
        }),
    },
    demarrage: {
      async pret() {
        const [{ SplashScreen }, { StatusBar }] = await Promise.all([
          import("@capacitor/splash-screen"),
          import("@capacitor/status-bar"),
        ]);
        // La barre d'état garde sa place : l'écran ne passe pas dessous, et
        // seul le bas — la barre de gestes — reste à gérer par la zone sûre.
        await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
        await SplashScreen.hide();
      },
    },
  };
}

/** Le navigateur : les mêmes gestes, avec ce que la page sait faire. */
function pontNavigateur(): PontCoque {
  return {
    app: {
      surReprise(rappel) {
        const sur = () => {
          if (document.visibilityState === "visible") rappel();
        };
        document.addEventListener("visibilitychange", sur);
        return () => document.removeEventListener("visibilitychange", sur);
      },
      // Pas de bouton retour matériel dans un navigateur : le sien suffit.
      surBoutonRetour: () => () => undefined,
      quitter: () => undefined,
    },
    reseau: {
      surChangement(rappel) {
        const enLigne = () => rappel(true);
        const horsLigne = () => rappel(false);
        window.addEventListener("online", enLigne);
        window.addEventListener("offline", horsLigne);
        return () => {
          window.removeEventListener("online", enLigne);
          window.removeEventListener("offline", horsLigne);
        };
      },
    },
    demarrage: { pret: async () => undefined },
  };
}

let instance: PontCoque | null = null;

export function coque(): PontCoque {
  if (!instance) instance = estNatif() ? pontNatif() : pontNavigateur();
  return instance;
}
