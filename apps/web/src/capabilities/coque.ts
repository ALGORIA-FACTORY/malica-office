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

// Forme pointée : Vite la remplace à la compilation (`src/env.d.ts`).
export const CIBLE_COQUE = import.meta.env.VITE_CIBLE === "coque";

/**
 * LE COMMERCE — le seul interrupteur de tout ce qui vend.
 *
 * Prix, offres, recharges, paiement, acceptation d'un abonnement proposé :
 * rien de cela n'entre dans le bundle de la coque (règles de Google Play sur
 * les biens numériques — décision du 22 octobre 2026). C'est une constante de
 * COMPILATION, pas un test d'exécution : le tree-shaking retire la branche du
 * paquet, et la CI vérifie que le bundle de la coque n'en garde aucune trace
 * (`outils/coque-sans-commerce.mjs`). Le serveur tient la même règle pour une
 * coque qui l'oublierait (`METHODES_COMMERCIALES`, `@malica/socle/commerce`).
 */
export const COMMERCE = !CIBLE_COQUE;

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
  misesAJour: {
    /**
     * Le canal de mise à jour en vol de cette cible (staging, pilote,
     * production). La coque y prend le bundle web publié par `ota.yml` sans
     * repasser par le magasin.
     */
    suivreLeCanal(canal: string): Promise<void>;
  };
  versions: {
    /**
     * L'application native que l'appareil fait tourner — celle du magasin —
     * et son numéro de construction. Les écrans, eux, disent leur version par
     * `versionClient()` : en vol, ils sont souvent plus récents que l'app.
     */
    native(): Promise<{ version: string; build: string } | null>;
  };
  apparence: {
    /**
     * L'application vient de passer en sombre ou en clair : les icônes de la
     * barre d'état (heure, batterie) suivent, sinon elles disparaissent sur
     * un fond de la même couleur. La coque suit le thème du téléphone par
     * défaut ; c'est l'application qui a le dernier mot (`apparence.ts`).
     */
    appliquer(sombre: boolean): void;
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
        /*
         * Capgo : l'application a démarré et rendu. Sans ce signal dans les
         * dix secondes, la coque tient le bundle pour cassé et revient au
         * précédent au prochain lancement — c'est le filet de la mise à jour
         * en vol, et il ne se tend qu'ici, après le premier écran.
         */
        void import("@capgo/capacitor-updater")
          .then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady())
          .catch(() => undefined);
        const [{ SplashScreen }, { StatusBar }] = await Promise.all([
          import("@capacitor/splash-screen"),
          import("@capacitor/status-bar"),
        ]);
        /*
         * Avant Android 15, la barre d'état garde sa place : l'écran ne passe
         * pas dessous. Depuis Android 15, l'écran va jusqu'aux bords quoi
         * qu'on demande — cet appel n'y fait rien — et c'est la page qui
         * réserve la zone sûre du haut (`pt-safe`, `styles.css`).
         */
        await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
        await SplashScreen.hide();
      },
    },
    versions: {
      async native() {
        const { App } = await import("@capacitor/app");
        // Un objet neuf, jamais le greffon ni sa réponse telle quelle.
        const info = await App.getInfo();
        return { version: info.version, build: info.build };
      },
    },
    apparence: {
      appliquer(sombre) {
        void import("@capacitor/status-bar")
          .then(({ StatusBar, Style }) =>
            StatusBar.setStyle({ style: sombre ? Style.Dark : Style.Light }),
          )
          .catch(() => undefined);
      },
    },
    misesAJour: {
      async suivreLeCanal(canal) {
        const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
        const actuel = await CapacitorUpdater.getChannel().catch(() => null);
        if (actuel?.channel === canal) return;
        await CapacitorUpdater.setChannel({ channel: canal, triggerAutoUpdate: true });
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
    // Pas de mise à jour en vol dans un navigateur : il recharge la page.
    misesAJour: { suivreLeCanal: async () => undefined },
    // Pas d'application native autour d'un navigateur.
    versions: { native: async () => null },
    // Le navigateur peint sa propre barre ; `color-scheme` suffit.
    apparence: { appliquer: () => undefined },
  };
}

let instance: PontCoque | null = null;

export function coque(): PontCoque {
  if (!instance) instance = estNatif() ? pontNatif() : pontNavigateur();
  return instance;
}
