/**
 * Rejuger les pièces aux règles du jour, pour l'exploitation.
 *
 * ===================================================================== USAGE
 *
 *   DATABASE_URL=<base de l'API> node --experimental-strip-types \
 *     outils/rejuger-les-pieces.mjs --compte <courriel> [--tenant <uuid>] [--essai]
 *
 *   --compte  la personne au nom de qui l'on rejuge : l'expert du cabinet qui
 *             tient les dossiers, ou le dirigeant d'un dossier autonome. Ses
 *             droits sont ceux de l'application, RLS et affectation comprises :
 *             l'outil ne rejuge que ce qu'elle rejugerait en ouvrant ses pièces.
 *   --tenant  un seul dossier ; sans lui, tous ceux que ce compte supervise.
 *   --essai   tout se joue, rien ne s'écrit : l'outil dit ce qui changerait.
 *
 * ===================================================================== POURQUOI
 *
 * Le chemin passe par `office.rejugerLesPieces`, sous l'identité du compte —
 * jamais par un rôle privilégié (R6) : DATABASE_URL est la connexion de l'API,
 * pas celle d'administration. Rejouer l'outil n'ajoute rien : une analyse ne
 * s'écrit que si le jugement change. L'URL n'est jamais affichée.
 */
import pg from "pg";

import { fermerLePool, fermerLePoolDuJournal, sousIdentite } from "../apps/api/src/db.ts";
import { arreterLeJournal, tracerUnTravail } from "../apps/api/src/observabilite/journal.ts";
import { executerRpc } from "../apps/api/src/rpc.ts";

const USAGE =
  "usage : node --experimental-strip-types outils/rejuger-les-pieces.mjs " +
  "--compte <courriel> [--tenant <uuid>] [--essai]";

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  if (i === -1) return null;
  const valeur = args[i + 1]?.trim();
  if (!valeur || valeur.startsWith("--")) {
    console.error(`${nom} attend une valeur\n${USAGE}`);
    process.exit(1);
  }
  return valeur;
};
const courriel = option("--compte");
const tenant = option("--tenant");
const essai = args.includes("--essai");
if (!courriel) {
  console.error(USAGE);
  process.exit(1);
}
if (!process.env["DATABASE_URL"]) {
  console.error("DATABASE_URL absente : la base de l'API.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
await client.connect();
let compte;
try {
  compte = (await client.query("select id from auth.users where email = $1", [courriel])).rows[0];
} finally {
  await client.end();
}
if (!compte) {
  console.error(`compte inconnu : ${courriel}`);
  process.exit(1);
}

const total = { rejugees: 0, changees: 0, proposables: 0, enEchec: 0, nonProposables: {} };
let regles = "";
let apres = null;
try {
  do {
    // Chaque page du rejeu est une tâche tracée : l'audit qu'elle écrit y est référencé.
    const bilan = await tracerUnTravail(
      "rejuger_les_pieces",
      null,
      () =>
        sousIdentite(compte.id, (db) =>
          executerRpc(db, {
            depot: "office",
            methode: "rejugerLesPieces",
            args: [tenant, apres, essai],
          }),
        ),
      {
        tenant,
        juger: (b) => ({
          issue: b.enEchec > 0 ? "erreur" : "ok",
          resultat: `${essai ? "essai_" : ""}rejugees_${b.rejugees}_changees_${b.changees}`,
        }),
      },
    );
    regles = bilan.regles;
    for (const c of bilan.changements)
      console.log(
        `${essai ? "changerait" : "rejugée"}  ${c.pieceId}  dossier ${c.tenantId}  ` +
          (c.proposable ? "proposable" : "sans proposition"),
      );
    for (const cle of ["rejugees", "changees", "proposables", "enEchec"]) total[cle] += bilan[cle];
    for (const [raison, n] of Object.entries(bilan.nonProposables))
      total.nonProposables[raison] = (total.nonProposables[raison] ?? 0) + n;
    apres = bilan.suite;
  } while (apres);
} finally {
  await fermerLePool();
  // Les tâches tracées partent avant la sortie ; sans fichier d'attente, une base absente est une perte comptée.
  await arreterLeJournal();
  await fermerLePoolDuJournal();
}

console.log(
  `\n${essai ? "ESSAI — rien n'a été écrit. " : ""}Règles ${regles} : ` +
    `${total.rejugees} rejugée(s), ${total.changees} changée(s), ` +
    `${total.proposables} proposable(s), ${total.enEchec} en échec${essai ? "" : " (journal des pannes)"}.`,
);
for (const [raison, n] of Object.entries(total.nonProposables).sort((a, b) => b[1] - a[1]))
  console.log(`  sans proposition — ${raison} : ${n}`);
if (total.enEchec > 0) process.exitCode = 2;
