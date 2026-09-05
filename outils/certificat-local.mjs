/**
 * Un certificat pour le développement, valable aussi depuis le téléphone.
 *
 * ============================================================== POURQUOI
 *
 * La caméra en direct — le cadrage assisté qui vérifie la netteté avant de
 * prendre — n'existe QUE sur une page sécurisée. Les navigateurs la refusent en
 * HTTP, sur tous les appareils. Ouverte depuis un téléphone en
 * `http://192.168.1.192:8080`, l'application ne peut donc pas cadrer.
 *
 * `localhost` fait exception : les navigateurs le considèrent comme sûr. C'est
 * pour cela que tout fonctionne sur le poste et rien sur le téléphone.
 *
 * ============================================ POURQUOI L'ADRESSE IP COMPTE
 *
 * Un certificat ne vaut que pour les noms qu'il déclare. Un certificat émis
 * pour « localhost » présenté sur `192.168.1.192` n'est pas seulement
 * « non approuvé » : il est FAUX, et certains navigateurs refusent alors
 * jusqu'à la possibilité de passer outre.
 *
 * On inscrit donc l'adresse du réseau local dans le certificat, en tant
 * qu'adresse IP — un `DNS:` ne suffirait pas pour une IP.
 *
 * ================================================== CE QU'IL RESTE À FAIRE
 *
 * Le certificat est signé par lui-même : le téléphone affichera un
 * avertissement, une fois, qu'il faut accepter. C'est le prix à payer sans
 * autorité de certification installée sur l'appareil — et c'est sans danger
 * sur votre propre réseau.
 *
 *   node outils/certificat-local.mjs
 *
 * Il se régénère sans risque : les fichiers sont ignorés par git, et rien
 * d'autre n'en dépend.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER = join(RACINE, ".certificats");

/** Les adresses IPv4 de cette machine sur ses réseaux locaux. */
function adressesLocales() {
  const trouvees = [];
  for (const cartes of Object.values(networkInterfaces())) {
    for (const carte of cartes ?? []) {
      if (carte.family !== "IPv4" || carte.internal) continue;
      trouvees.push(carte.address);
    }
  }
  return trouvees;
}

const adresses = adressesLocales();
if (adresses.length === 0) {
  console.error(
    "Aucune adresse de réseau local trouvée. Êtes-vous connecté au Wi-Fi ou au réseau ?",
  );
  process.exit(1);
}

mkdirSync(DOSSIER, { recursive: true });

/*
 * Les noms que le certificat couvre.
 *
 * `localhost` et `127.0.0.1` pour le poste, chaque adresse locale pour les
 * autres appareils. On les écrit dans le fichier de configuration plutôt qu'en
 * ligne de commande : les guillemets d'une ligne de commande Windows abîment
 * les virgules du sujet alternatif, et le certificat sort silencieusement faux.
 */
const noms = [
  "DNS.1 = localhost",
  "IP.1 = 127.0.0.1",
  ...adresses.map((a, i) => `IP.${i + 2} = ${a}`),
].join("\n");

const config = `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no

[dn]
CN = Regalica Office (développement)
O = Regalica Office

[v3]
subjectAltName = @noms
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[noms]
${noms}
`;

const cheminConfig = join(DOSSIER, "openssl.cnf");
const cheminCle = join(DOSSIER, "cle.pem");
const cheminCert = join(DOSSIER, "certificat.pem");
writeFileSync(cheminConfig, config);

try {
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-sha256",
      "-days", "365", "-nodes",
      "-keyout", cheminCle,
      "-out", cheminCert,
      "-config", cheminConfig,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (e) {
  console.error("openssl a refusé :", e instanceof Error ? e.message : String(e));
  console.error("Vérifiez qu'openssl est installé et accessible (openssl version).");
  process.exit(1);
}

if (!existsSync(cheminCert) || !existsSync(cheminCle)) {
  console.error("Le certificat n'a pas été écrit.");
  process.exit(1);
}

console.log("Certificat écrit dans .certificats/\n");
console.log("Il couvre :");
console.log("  localhost, 127.0.0.1");
for (const a of adresses) console.log(`  ${a}`);
console.log("\nRelancez le serveur web. Depuis le téléphone, ouvrez :");
for (const a of adresses) console.log(`  https://${a}:8080`);
console.log(
  "\nLe navigateur avertira que le certificat n'est pas reconnu — c'est attendu :\n" +
    "il est signé par lui-même. Acceptez une fois, et la caméra fonctionnera.",
);
