// Vitest — isolé du pipeline TanStack Start.
// Le socle Office impose une couverture stricte : c'est le cerveau déterministe.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // Les épreuves tournent comme le web et la PWA : le commerce y est ouvert
  // (`__COMMERCE__`, posé par `vite.config.ts` selon la cible).
  define: { __COMMERCE__: "true" },
  test: {
    environment: "node",
    /*
     * ===================== POURQUOI `NODE_ENV` EST ÉPINGLÉ, ET PAS HÉRITÉ
     *
     * Vitest ne pose `NODE_ENV=test` que si la variable est ABSENTE : une
     * valeur déjà présente dans l'environnement est respectée. Sur un poste
     * où `NODE_ENV=production` est posé globalement — mesuré le 18 octobre
     * sur celui du dirigeant — React charge alors son build de PRODUCTION,
     * qui n'expose pas `act`.
     *
     * Les cinq épreuves qui montent un composant échouaient donc sur
     * `React.act is not a function` : un message qui accuse React, alors que
     * ni React ni le code n'avaient rien. Posée à `test`, la même suite passe
     * — vérifié, 5 sur 5. La CI, où la variable est absente, n'a jamais vu le
     * défaut : il ne se montrait que sur le poste.
     *
     * Épinglé ici, le résultat ne dépend plus de l'environnement de qui lance
     * la suite. Une épreuve dont le verdict change selon le poste ne vaut rien.
     */
    env: { NODE_ENV: "test" },
    // `__tests__/` à la racine : le relais du serveur de développement, qui
    // n'est pas dans `src`. Absent d'ici, son épreuve n'était jamais lancée.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
