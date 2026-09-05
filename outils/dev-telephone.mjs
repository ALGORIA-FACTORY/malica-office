/**
 * Le serveur de développement en HTTPS, pour essayer depuis un téléphone.
 *
 * ============================================================== POURQUOI
 *
 * La caméra en direct — le cadrage qui vérifie la netteté avant de prendre —
 * n'existe que sur une page sécurisée. `localhost` fait exception, ce qui
 * explique que tout fonctionne sur le poste et rien sur le téléphone.
 *
 * ================================================= POURQUOI UN SCRIPT À PART
 *
 * Poser une variable d'environnement avant une commande ne s'écrit pas pareil
 * selon le terminal — `VAR=1 npm run dev` sous bash, `$env:VAR="1"` sous
 * PowerShell, `set VAR=1` sous cmd. Une ligne dans `package.json` marcherait
 * donc chez les uns et pas chez les autres, et l'on passerait une heure à
 * chercher pourquoi le HTTPS ne s'active pas.
 *
 *   npm run dev:telephone
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const CERT = join(RACINE, ".certificats", "certificat.pem");

if (!existsSync(CERT)) {
  console.error("Aucun certificat. Fabriquez-le d'abord :\n");
  console.error("  node outils/certificat-local.mjs\n");
  process.exit(1);
}

/*
 * Un AUTRE port que celui du serveur en clair.
 *
 * C'est ce qui permet aux deux de tourner en même temps : l'aperçu intégré
 * reste sur 8080 en clair — il ne sait pas accepter un certificat auto-signé —
 * pendant qu'on essaie au doigt sur 8443 en HTTPS.
 *
 * Les deux relaient la même API, donc partagent la même session et les mêmes
 * données. Ce qu'on fait sur le téléphone se voit dans l'aperçu.
 */
const PORT = process.env["REGALICA_PORT"] ?? "8443";

const adresses = Object.values(networkInterfaces())
  .flatMap((cartes) => cartes ?? [])
  .filter((c) => c.family === "IPv4" && !c.internal)
  .map((c) => c.address);

console.log("Serveur en HTTPS. Depuis un appareil du même réseau :\n");
for (const a of adresses) console.log(`  https://${a}:${PORT}/pme/fiche`);
console.log(
  "\nLe navigateur avertira que le certificat n'est pas reconnu — c'est attendu :\n" +
    "il est signé par lui-même. « Avancé », puis « Continuer », une seule fois.\n" +
    "\nGardez `npm run dev` dans un autre terminal : l'aperçu reste en clair sur\n" +
    "8080, et les deux partagent la même API — donc la même session.\n",
);

const enfant = spawn("npm", ["run", "dev", "--workspace", "@regalica/web"], {
  cwd: RACINE,
  env: { ...process.env, REGALICA_HTTPS: "1", REGALICA_PORT: PORT },
  stdio: "inherit",
  shell: process.platform === "win32",
});

enfant.on("exit", (code) => process.exit(code ?? 0));
