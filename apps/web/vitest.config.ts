// Vitest — isolé du pipeline TanStack Start.
// Le socle Office impose une couverture stricte : c'est le cerveau déterministe.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // `__tests__/` à la racine : le relais du serveur de développement, qui
    // n'est pas dans `src`. Absent d'ici, son épreuve n'était jamais lancée.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
