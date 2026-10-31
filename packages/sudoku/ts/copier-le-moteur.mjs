// Pose le moteur compilé à côté de son chargeur : `ts/index.ts` le lit là.
// Le .wasm n'est pas versionné — la CI et l'image de l'API le construisent.
import { copyFileSync } from "node:fs";

copyFileSync(
  new URL("../target/wasm32-unknown-unknown/release/malica_sudoku.wasm", import.meta.url),
  new URL("../malica_sudoku.wasm", import.meta.url),
);
