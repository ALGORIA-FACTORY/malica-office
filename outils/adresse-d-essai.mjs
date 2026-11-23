/**
 * Prouver l'adresse d'un compte d'essai — le lien de confirmation que personne
 * ne reçoit sur une instance sans courriel (le poste, la CI).
 *
 *   node outils/adresse-d-essai.mjs amine.bouzid@bensalah.tn
 *
 * Depuis l'audit du 23 novembre 2026, une adresse seulement déclarée n'ouvre
 * aucune invitation : il faut le lien de confirmation, ou celui de l'invitation.
 * Les épreuves inscrivent des comptes puis les font rejoindre un cabinet : sur
 * une instance locale, ce script tient lieu du clic sur le lien. Il ne se lance
 * que depuis les épreuves, et seulement contre une instance locale
 * (`estUneInstanceLocale`) — jamais contre un hôte joignable d'Internet.
 */
import pg from "pg";

import { urlDAdministration } from "./base-d-administration.mjs";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage : node outils/adresse-d-essai.mjs <email>");
  process.exit(1);
}
const url = urlDAdministration();
if (!url) {
  console.error("aucune base : DATABASE_URL_ADMIN, ou apps/api/.env");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const r = await client.query(
    `update auth.users set adresse_confirmee_le = now()
      where email = $1 and adresse_confirmee_le is null`,
    [email],
  );
  console.log(
    r.rowCount ? `  adresse d'essai prouvée : ${email}` : `  adresse déjà prouvée : ${email}`,
  );
} finally {
  await client.end();
}
