/**
 * Ouvrir un cabinet et son premier dossier, sur n'importe quel environnement.
 *
 *   node outils/ouvrir-mon-cabinet.mjs http://localhost:3000 moi@exemple.tn '<mot de passe>'
 *   node outils/ouvrir-mon-cabinet.mjs https://staging.… moi@exemple.tn '<mot de passe>' \
 *        --nom "Prénom Nom" --cabinet "AUDICORP:9000001A/A/M/000"
 *
 * Ce que l'outil fait, et pourquoi dans cet ordre : il inscrit le compte (ou s'y
 * connecte), crée le cabinet puis la PME — le créateur est expert de l'un et
 * dirigeant de l'autre —, établit la fiche fiscale de la PME, fait proposer le
 * mandat par le cabinet et l'accepte du côté PME, puis dérive les échéances.
 * Sans fiche complète, `collab.deriverEcheances` répond `fiche.incomplete` et
 * n'en crée aucune : la fiche vient donc avant.
 *
 * TOUT PASSE PAR L'API, jamais par la base : la RLS, les déclencheurs R7 et les
 * fonctions gouvernées sont exercés comme pour un vrai cabinet. C'est aussi ce
 * qui rend l'outil utilisable à distance — `outils/operateur-plateforme.mjs`,
 * lui, exige la base, parce que ce niveau-là ne s'accorde par aucune route.
 *
 * Rejouable : chaque étape regarde d'abord si la chose existe.
 *
 * LE MOT DE PASSE EST UN ARGUMENT, jamais une constante. Trois mots de passe de
 * comptes d'essai vivent déjà en clair dans le dépôt (dette E2/D3) ; un cabinet
 * réel n'en ajoute pas un quatrième.
 *
 * L'identifiant fiscal du cabinet par défaut est un BOUCHE-TROU de la bonne
 * forme (`9000001A/A/M/000`) : remplacez-le par le vrai, avec `--cabinet`.
 */

import { tolererLeCertificatLocal } from "./epreuves/socle.mjs";

const [BASE_BRUTE, EMAIL, MDP, ...RESTE] = process.argv.slice(2);
if (!BASE_BRUTE || !EMAIL || !MDP) {
  console.error(
    "usage : node outils/ouvrir-mon-cabinet.mjs <base> <email> <motDePasse>" +
      ' [--nom "Prénom Nom"] [--cabinet "NOM:MF"] [--pme "NOM:MF"]',
  );
  process.exit(1);
}
const BASE = BASE_BRUTE.replace(/\/+$/, "");

function option(nom, defaut) {
  const i = RESTE.indexOf(`--${nom}`);
  if (i === -1) return defaut;
  const valeur = RESTE[i + 1];
  if (!valeur || valeur.startsWith("--")) {
    console.error(`--${nom} attend une valeur`);
    process.exit(1);
  }
  return valeur;
}

/** « NOM:1234567A/A/M/000 » — le séparateur est le dernier deux-points. */
function organisation(brut, kind) {
  const coupe = brut.lastIndexOf(":");
  if (coupe <= 0 || coupe === brut.length - 1) {
    console.error(`attendu « NOM:IDENTIFIANT FISCAL », reçu : ${brut}`);
    process.exit(1);
  }
  return { kind, name: brut.slice(0, coupe).trim(), legalId: brut.slice(coupe + 1).trim() };
}

const NOM = option("nom", "Développeur");
const CABINET = organisation(option("cabinet", "AUDICORP:9000001A/A/M/000"), "cabinet");
const PME = organisation(option("pme", "ALGORIA FACTORY SARL:1856324K/A/M/000"), "pme");

/* Sur une adresse privée en HTTPS, le certificat est auto-signé : on ne le
 * vérifie pas. Sur un hôte public, il est vrai et se vérifie comme dans un
 * téléphone. La règle vit dans le socle des épreuves, en un seul endroit. */
tolererLeCertificatLocal(BASE);

let cookie = "";
async function appel(chemin, opts = {}) {
  const r = await fetch(`${BASE}${chemin}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const poses = r.headers.getSetCookie?.() ?? [];
  if (poses.length) cookie = poses.map((c) => c.split(";")[0]).join("; ");
  return r;
}

async function rpc(depot, methode, args = []) {
  const r = await appel("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depot, methode, args }),
  });
  const corps = await r.text();
  if (!r.ok) throw new Error(`${depot}.${methode} : ${r.status} ${corps.slice(0, 300)}`);
  return JSON.parse(corps).resultat;
}

const dit = (s) => process.stdout.write(`  ${s}\n`);
const json = { "Content-Type": "application/json" };

/* ---------------------------------------------------------------- le compte */
const inscription = await appel("/auth/inscription", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ email: EMAIL, motDePasse: MDP, nom: NOM }),
});
if (inscription.status === 201) {
  dit(`compte créé : ${EMAIL}`);
} else {
  const connexion = await appel("/auth/connexion", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: EMAIL, motDePasse: MDP }),
  });
  if (connexion.status !== 200) {
    throw new Error(`connexion refusée pour ${EMAIL} : ${connexion.status}`);
  }
  dit(`compte existant, connecté : ${EMAIL}`);
}

/* ------------------------------------------------------------ le paramétrage */
const pack = await rpc("referentiel", "activePack", ["TN"]);
dit(`pack : ${pack.jurisdiction} ${pack.version} · devise ${pack.currency}`);

const regimes = await rpc("identite", "regimesDisponibles", ["TN"]);
const formes = await rpc("identite", "formesDisponibles", ["TN"]);
/** Un code du référentiel, ou rien — jamais une valeur inventée (R11). */
const duReferentiel = (liste, axe, prefere) =>
  liste.find((x) => x.axe === axe && x.code === prefere)?.code ?? null;

const mesOrgs = () => rpc("identite", "listMyOrganizations");

/* ------------------------------------------------------------- les deux orgs */
async function ouvrir(spec) {
  const deja = (await mesOrgs()).find((o) => o.kind === spec.kind && o.legalId === spec.legalId);
  if (deja) {
    dit(`${spec.name} existe déjà — ${deja.kind}`);
    return deja;
  }
  const id = await rpc("identite", "createOrganization", [
    {
      ...spec,
      jurisdiction: "TN",
      currency: pack.currency,
      // « mandate » : le dossier est tenu par un cabinet, pas en autonomie.
      ...(spec.kind === "pme" ? { validationMode: "mandate", defaultEntityName: "Siège" } : {}),
    },
  ]);
  const org = (await mesOrgs()).find((o) => o.id === id);
  dit(`${spec.name} créée — ${org.kind} · ${org.legalId}`);
  return org;
}
const cabinet = await ouvrir(CABINET);
const pme = await ouvrir(PME);

/* -------------------------------------------------------- la fiche de la PME */
/* La fiche est datée et ne se chevauche pas (contrainte `fiches_sans
 * _chevauchement`) : une fiche incomplète ne se réécrit pas, elle se remplace
 * par une version qui commence aujourd'hui. */
const avant = await rpc("identite", "ficheCourante", [pme.id]);
if (!avant?.formeJuridique) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  await rpc("identite", "etablirFiche", [
    {
      tenantId: pme.id,
      regimeImposition: duReferentiel(regimes, "imposition", "reel"),
      regimeTva: duReferentiel(regimes, "tva", "assujetti"),
      secteur: "services",
      debutActivite: "2024-01-01",
      clotureExercice: "12-31",
      formeJuridique: duReferentiel(formes, "forme", "morale"),
      modeDepot: duReferentiel(formes, "mode", "electronique"),
      source: "saisie",
      validFrom: avant ? aujourdhui : "2024-01-01",
    },
  ]);
}
const fiche = await rpc("identite", "ficheCourante", [pme.id]);
dit(
  `fiche fiscale : ${fiche?.regimeImposition} · ${fiche?.regimeTva} · ` +
    `${fiche?.formeJuridique ?? "forme absente"} · ${fiche?.modeDepot ?? "mode absent"}`,
);

/* ------------------------------------------- le mandat du cabinet sur la PME */
const clients = await rpc("supervision", "listClients", [cabinet.id]);
if (clients.some((c) => c.id === pme.id)) {
  dit("le mandat est déjà actif");
} else {
  const deja = (await rpc("identite", "mandatsProposes", [pme.id])).find(
    (p) => p.cabinetTenantId === cabinet.id,
  );
  if (!deja) await rpc("identite", "proposerMandat", [cabinet.id, PME.legalId]);
  const propose = (await rpc("identite", "mandatsProposes", [pme.id])).find(
    (p) => p.cabinetTenantId === cabinet.id,
  );
  if (propose) {
    await rpc("identite", "repondreAuMandat", [propose.id, true]);
    dit(`mandat proposé par ${cabinet.name}, accepté par ${pme.name}`);
  }
}

/* ------------------------------------------------------------------ échéances */
const derive = await rpc("collab", "deriverEcheances", [[pme.id]]);
const premier = Array.isArray(derive) ? derive[0] : null;
dit(`échéances : ${premier?.raison ?? `${premier?.generees ?? 0} dérivée(s)`}`);

/* --------------------------------------------------------------------- verdict */
process.stdout.write("\n");
for (const o of await mesOrgs()) dit(`${o.kind.padEnd(8)} ${o.name} — rôle ${o.role ?? "?"}`);
const vus = await rpc("supervision", "listClients", [cabinet.id]);
dit(`${cabinet.name} voit ${vus.length} client(s) : ${vus.map((c) => c.name).join(", ")}`);
