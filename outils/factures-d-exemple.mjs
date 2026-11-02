/**
 * Les factures d'exemple — ce que le dirigeant regarde avant la première
 * vraie facture.
 *
 *   DATABASE_URL=… DATABASE_URL_ADMIN=… \
 *     node --experimental-strip-types outils/factures-d-exemple.mjs
 *
 * Sur une base LOCALE seulement (l'outil refuse toute autre adresse), dans une
 * transaction qu'il annule : une facture fictive est émise par le vrai chemin
 * (`scenario-d-exemple.ts`), puis rendue en français, en anglais et en arabe,
 * et son avoir en français. Les PDF s'écrivent dans docs/facturation/exemples.
 * Rien ne reste en base.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
if (!ADMIN) throw new Error("DATABASE_URL_ADMIN absente");
const hote = new URL(ADMIN).searchParams.get("host") ?? new URL(ADMIN).hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(hote) && !hote.startsWith("/")) {
  throw new Error(`base non locale (${hote}) : les exemples ne s'émettent que sur un poste`);
}

const { emettreUneFactureDExemple } = await import(
  "../apps/api/src/facturation/document/scenario-d-exemple.ts"
);
const { rendreLaFacture } = await import("../apps/api/src/facturation/document/rendu.ts");

const SORTIE = new URL("../docs/facturation/exemples/", import.meta.url);
mkdirSync(SORTIE, { recursive: true });

const pool = new pg.Pool({ connectionString: ADMIN, max: 1 });
const db = await pool.connect();
try {
  await db.query("begin");
  const exemple = await emettreUneFactureDExemple(db);
  const lien = "https://app.malica.example/pme/reglages";
  for (const [langue, quoi] of [
    ["fr", "facture"],
    ["en", "facture"],
    ["ar", "facture"],
    ["fr", "avoir"],
  ]) {
    const document = await exemple.documents(langue, quoi);
    const pdf = rendreLaFacture(document, { lienPaiement: lien });
    const nom = `${quoi}-exemple-${langue}.pdf`;
    writeFileSync(new URL(nom, SORTIE), pdf);
    console.log(`docs/facturation/exemples/${nom} — ${document.facture.numero}, ${pdf.length} octets`);
  }
} finally {
  await db.query("rollback");
  db.release();
  await pool.end();
}
