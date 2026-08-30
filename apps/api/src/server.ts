/**
 * Le démarrage de l'API.
 *
 * Ce fichier ne connaît qu'une chose : comment mettre l'application à l'écoute,
 * et comment l'arrêter proprement. Les routes vivent dans `app.ts`.
 */

import "dotenv/config";

import { app } from "./app.ts";
import { fermerLePool } from "./db.ts";
import { racine } from "./stockage.ts";

// La configuration se vérifie au démarrage, pas à la première requête. Une
// racine de stockage absente est une panne d'installation : elle doit empêcher
// l'API de démarrer, comme le fait un secret de jetons manquant.
racine();

const port = Number(process.env["PORT"] ?? 3000);
const serveur = app.listen(port, () => {
  console.log(`[api] à l'écoute sur http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    serveur.close(() => {
      void fermerLePool().then(() => process.exit(0));
    });
  });
}
