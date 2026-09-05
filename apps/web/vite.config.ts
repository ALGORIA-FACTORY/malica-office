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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { relaisApi } from "./relais-api";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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
  process.env["REGALICA_HTTPS"] === "1" && existsSync(CERT) && existsSync(CLE)
    ? { key: readFileSync(CLE), cert: readFileSync(CERT) }
    : undefined;

export default defineConfig({
  define: { "import.meta.env.VITE_VERSION_CLIENT": JSON.stringify(VERSION) },

  // L'ordre compte : Tailwind avant le compilateur de routes, nitro après lui.
  plugins: [
    // Avant tout le reste : le relais doit voir la requête avant la chaîne de
    // rendu, qui répondrait sinon par la page 404 de l'application.
    relaisApi(),
    tailwindcss(),
    // `server.entry` renvoie l'entrée serveur vers src/server.ts, qui enveloppe
    // les erreurs de rendu côté serveur.
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    nitro(),
  ],

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
    port: Number(process.env["REGALICA_PORT"] ?? 8080),
    strictPort: true,
    host: true,
    ...(https ? { https } : {}),
  },
});
