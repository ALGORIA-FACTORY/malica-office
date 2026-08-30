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
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // L'ordre compte : Tailwind avant le compilateur de routes, nitro après lui.
  plugins: [
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
    // Port figé : l'aperçu et les scripts pointent dessus. Une bascule
    // silencieuse sur un autre port ferait croire à une application morte.
    port: 8080,
    strictPort: true,
    host: true,
  },
});
