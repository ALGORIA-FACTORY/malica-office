// Vitest — le Socle s'éprouve seul, sans alias ni DOM : il ne connaît pas le monde.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
