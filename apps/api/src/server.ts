/**
 * Le démarrage de l'API.
 *
 * Ce fichier ne connaît qu'une chose : comment mettre l'application à l'écoute,
 * et comment l'arrêter proprement. Les routes vivent dans `app.ts`.
 */

import "dotenv/config";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

import { app } from "./app.ts";
import { fermerLePool } from "./db.ts";
import { racine } from "./stockage.ts";

/*
 * Laisser à la seconde famille d'adresses le temps de répondre.
 *
 * `dashscope-intl.aliyuncs.com` — l'œil — publie des adresses IPv4 ET IPv6. Sur
 * un poste derrière Tailscale, les IPv6 sont du NAT64 (`64:ff9b::`) et marchent,
 * tandis que la route IPv4 ne répond pas. Node essaie les deux (`autoSelectFamily`
 * est actif par défaut) mais n'accorde que 250 ms à la première avant de tenter
 * la suivante : trop peu ici, et l'appel remontait « fetch failed ».
 *
 * Mesuré le 4 octobre 2026 sur ce poste : 250 ms → ETIMEDOUT ; 500 ms → la
 * connexion aboutit en 1,4 s. C'est de là que venait la consigne « bun, pas
 * node » des outils du corpus : non pas deux moteurs différents, un quart de
 * seconde.
 *
 * Le réglage ne force AUCUNE famille — il allonge seulement la patience. Une
 * machine sans IPv6 se connecte en IPv4 du premier coup et ne le voit jamais ;
 * une machine sans IPv4 vers cet hôte bascule au lieu d'échouer.
 */
setDefaultAutoSelectFamilyAttemptTimeout(Number(process.env["RESEAU_DELAI_FAMILLE_MS"] ?? 1000));

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
