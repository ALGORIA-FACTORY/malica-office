/**
 * La chaîne de compilation, en clair.
 *
 * Elle venait d'un préréglage `@lovable.dev/vite-tanstack-config` : un paquet
 * qui montait ces greffons sans qu'on puisse les voir, en imposant au passage
 * Cloudflare comme cible de déploiement. C'est cette cible — et son absence de
 * canvas — qui avait obligé à écrire un encodeur PNG à la main pour extraire
 * l'image d'un PDF scanné.
 *
 * Ici, chaque greffon est nommé, son ordre est visible, et la cible n'est plus
 * décidée par un tiers.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { dictionnairesParEspace } from "./dictionnaires-par-espace";
import { relaisApi } from "./relais-api";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Les dictionnaires du Socle, que `dictionnairesParEspace` coupe en paquets. */
const SOURCES_DU_SOCLE = join(RACINE, "packages", "socle", "src");
/**
 * La version que le client déclare à l'API — celle du dépôt, une seule pour
 * le site et pour la coque. C'est elle que `CLIENT_MIN_VERSION` compare.
 */
const VERSION = (
  JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8")) as { version: string }
).version;
const CERT = join(RACINE, ".certificats", "certificat.pem");
const CLE = join(RACINE, ".certificats", "cle.pem");

/**
 * Le HTTPS de développement — sur demande, jamais par défaut.
 *
 * ============================================================== POURQUOI
 *
 * La caméra en direct n'existe que sur une page sécurisée : sans HTTPS, un
 * téléphone du réseau ne peut pas cadrer, quel que soit son matériel.
 *
 * ==================================================== POURQUOI PAS TOUJOURS
 *
 * Parce que le certificat est signé par lui-même, et que tout ce qui n'est pas
 * un navigateur humain le refuse : l'aperçu intégré, les sondes, les scripts.
 * L'activer en permanence pour un besoin ponctuel casserait le travail courant
 * — ce qui est arrivé, et c'est ce qui a décidé de ce commutateur.
 *
 *   npm run dev              le poste, en clair. L'aperçu fonctionne.
 *   npm run dev:telephone    HTTPS, pour cadrer depuis un appareil du réseau.
 *
 * Le certificat se fabrique par `node outils/certificat-local.mjs`. Absent, la
 * demande de HTTPS est ignorée plutôt que de bloquer un démarrage.
 */
const https =
  process.env["MALICA_HTTPS"] === "1" && existsSync(CERT) && existsSync(CLE)
    ? { key: readFileSync(CLE), cert: readFileSync(CERT) }
    : undefined;

/*
 * ============================================================ DEUX FORMES
 *
 * Le même code produit le site — rendu côté serveur, pour le cabinet et la
 * PME dans un navigateur — et le bundle de la coque, une application d'une
 * seule page embarquée dans le paquet Android. Le mode Vite décide :
 *
 *   vite build                     le site, comme avant
 *   vite build --mode coque-pilote le bundle, avec `.env.coque-pilote`
 *
 * En mode coque, Start prérend une coquille — l'en-tête, la feuille de style,
 * les scripts, aucun contenu de route — dans `index.html`, et le routeur
 * fait le reste sur l'appareil. Le relais de développement n'y est pas : la
 * coque parle à l'API par l'adresse déclarée, jamais par la même origine.
 */
export default defineConfig(({ mode }) => {
  const coque = mode.startsWith("coque-");
  return {
    define: {
      "import.meta.env.VITE_VERSION_CLIENT": JSON.stringify(VERSION),
      // Le commerce, plié AVANT le graphe des modules : `capabilities/coque.ts`.
      __COMMERCE__: JSON.stringify(!coque),
    },

    // L'ordre compte : Tailwind avant le compilateur de routes, nitro après lui.
    plugins: [
      // Avant tout le reste : le relais doit voir la requête avant la chaîne de
      // rendu, qui répondrait sinon par la page 404 de l'application.
      ...(coque ? [] : [relaisApi()]),
      // Les dictionnaires en deux paquets par langue, base et espaces.
      dictionnairesParEspace(SOURCES_DU_SOCLE),
      tailwindcss(),
      // `server.entry` renvoie l'entrée serveur vers src/server.ts, qui enveloppe
      // les erreurs de rendu côté serveur.
      tanstackStart({
        server: { entry: "server" },
        ...(coque
          ? { spa: { enabled: true, maskPath: "/", prerender: { outputPath: "/index" } } }
          : {}),
      }),
      viteReact(),
      nitro(),
      /*
       * L'aperçu du build — et le prérendu de la coquille, qui le lance le temps
       * du build — écoute sur 4177. Start lui demandait un port libre (0), et
       * le greffon de nitro lit `config.preview.port || 3000` : zéro est faux,
       * et 3000 est le port de l'API. Le relancement de l'aperçu ne transmet
       * pas le mode, donc ce greffon vaut pour tous les modes, après nitro.
       */
      /*
       * La coque ne vend rien (règles de Google Play, 22 octobre 2026) : les
       * logos des moyens de paiement (`public/paiement/`) servent la page de
       * choix du web et de la PWA, et n'ont rien à faire dans le paquet
       * Android. `outils/coque-sans-commerce.mjs` vérifie qu'ils n'y sont pas.
       */
      ...(coque
        ? [
            {
              name: "malica:coque-sans-logos-de-paiement",
              apply: "build" as const,
              closeBundle: {
                order: "post" as const,
                sequential: true,
                handler() {
                  rmSync(new URL("./.output/public/paiement", import.meta.url), {
                    recursive: true,
                    force: true,
                  });
                },
              },
            },
          ]
        : []),
      {
        name: "malica:port-de-l-apercu",
        enforce: "post" as const,
        config: () => ({ preview: { port: 4177, strictPort: false } }),
      },
    ],

    /*
     * Le socle du navigateur — React, le routeur, React Query, et ce que
     * l'application en tire d'emblée (la racine, l'arbre des routes, les
     * gardes) — en UN fichier.
     *
     * Rolldown découpait ces modules en une douzaine de fichiers de quelques
     * centaines d'octets (`useRouter`, `jsx-runtime`, `matchContext`…), parce
     * que l'entrée et les écrans paresseux les partagent. Tous sont chargés
     * au premier écran de toute façon : douze requêtes au lieu d'une, et sur
     * un téléphone en 4G chaque requête coûte un aller-retour (mesuré :
     * 30 fichiers préchargés sur l'accueil, audit web du 6 novembre 2026 ;
     * 3 désormais). Le groupe tire les dépendances de ses modules, donc ce
     * que le démarrage de Start importe de l'application ; les écrans, eux,
     * restent découpés et paresseux.
     */
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  /*
                   * L'aide au préchargement de Vite, à part : le socle tire ses
                   * dépendances avec lui, elle comprise, et l'entrée — qui
                   * s'en sert pour importer le socle APRÈS la première image
                   * (`client.tsx`) — n'aurait rien pu importer sans le charger.
                   */
                  { name: "prechargement", test: /preload-helper/, priority: 2 },
                  {
                    name: "socle-du-navigateur",
                    priority: 1,
                    test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|seroval|seroval-plugins|@tanstack[\\/](react-router|router-core|history|store|react-store|react-query|query-core|start-client-core|react-start-client|react-start))[\\/]/,
                  },
                ],
              },
            },
          },
        },
      },
    },

    resolve: {
      // Résolution native des alias du tsconfig — Vite la fournit désormais, le
      // greffon vite-tsconfig-paths n'a plus lieu d'être.
      tsconfigPaths: true,
      // React et le routeur doivent exister en un seul exemplaire : deux copies
      // donnent des erreurs de contexte impossibles à lire.
      dedupe: ["react", "react-dom", "@tanstack/react-router"],
    },

    server: {
      /*
       * 8080 par défaut, et strictement : l'aperçu et les scripts pointent
       * dessus, et une bascule silencieuse sur un autre port ferait croire à une
       * application morte.
       *
       * L'instance HTTPS pour le téléphone en prend un autre — c'est ce qui
       * permet aux DEUX de tourner ensemble : on garde l'aperçu en clair sur
       * 8080 pendant qu'on essaie au doigt sur 8443.
       */
      // MALICA_PORT pour le poste ; PORT quand un outil assigne le port lui-même.
      port: Number(process.env["MALICA_PORT"] ?? process.env["PORT"] ?? 8080),
      strictPort: true,
      host: true,
      /*
       * Playwright écrit ses traces et captures sous `e2e/sortie` PENDANT les
       * parcours ; Vite y voyait des fichiers qui changent et rechargeait la
       * page en plein test (« element was detached from the DOM »). Les
       * sorties ne sont pas du code : on ne les regarde pas.
       */
      watch: { ignored: ["**/e2e/sortie/**", "**/e2e/sortie-rapport/**"] },
      ...(https ? { https } : {}),
    },
  };
});
