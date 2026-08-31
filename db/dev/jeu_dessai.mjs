/**
 * Le jeu d'essai du développeur : un cabinet, deux dossiers, de quoi voir.
 *
 * ========================================================== POURQUOI PAR L'API
 *
 * Tout passe par `/rpc` et `/pieces/:id/contenu`, sous une vraie session. Rien
 * n'est inséré par-dessous.
 *
 * Ce n'est pas de la coquetterie : un jeu d'essai posé en superutilisateur
 * contourne la RLS, les déclencheurs et les fonctions gouvernées — il produit
 * des données qu'aucun utilisateur n'aurait pu créer, et l'écran finit par
 * afficher un état impossible. Ici, si le produit refuse, le jeu d'essai
 * échoue : c'est exactement ce qu'on veut savoir.
 *
 * ========================================================== CE QU'IL CRÉE
 *
 *   un compte              dev@regalica.local
 *   un cabinet             CABINET REGALICA
 *   deux dossiers          DREAM OPTIC · ATLAS DISTRIBUTION
 *   deux mandats           le cabinet suit les deux
 *   des tiers              clients, fournisseurs, une banque
 *   des pièces             avec leurs octets, visibles dans la visionneuse
 *   des écritures          proposées et comptabilisées
 *
 * Rejouable : les clés d'idempotence et les codes de tiers sont stables, donc
 * une seconde exécution ne duplique rien.
 *
 *   node db/dev/jeu_dessai.mjs
 */

const API = process.env["REGALICA_API_URL"] ?? "http://localhost:3000";
const EMAIL = "dev@regalica.local";
const MOTDEPASSE = "DeveloppeurRegalica2026!";

let cookie = "";

async function appelerBrut(chemin, options = {}) {
  const reponse = await fetch(`${API}${chemin}`, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const posee = reponse.headers.get("set-cookie");
  if (posee) cookie = posee.split(";")[0];
  return reponse;
}

async function rpc(depot, methode, args = []) {
  const reponse = await appelerBrut("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depot, methode, args }),
  });
  const corps = await reponse.json();
  if (!reponse.ok) throw new Error(`${depot}.${methode} → ${corps.erreur ?? reponse.status}`);
  return corps.resultat;
}

/** Un PDF minuscule mais valide : la visionneuse reconnaît « %PDF- ». */
function pdf(titre) {
  const contenu = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 90>>stream
BT /F1 18 Tf 60 760 Td (${titre}) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return new TextEncoder().encode(contenu);
}

async function ouvrirSession() {
  const inscription = await appelerBrut("/auth/inscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, motDePasse: MOTDEPASSE, nom: "Développeur" }),
  });
  if (inscription.ok) {
    console.log(`  compte créé      ${EMAIL}`);
    return;
  }
  // 409 : le compte existe déjà, c'est le cas normal d'une seconde exécution.
  const connexion = await appelerBrut("/auth/connexion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, motDePasse: MOTDEPASSE }),
  });
  if (!connexion.ok) {
    throw new Error(
      `impossible d'ouvrir une session pour ${EMAIL} : le compte existe avec un autre mot de passe`,
    );
  }
  console.log(`  session ouverte  ${EMAIL}`);
}

/** Retrouve une organisation par son nom, ou la crée. */
async function organisation(kind, name, validationMode) {
  const miennes = await rpc("identite", "listMyOrganizations");
  const trouvee = miennes.find((o) => o.name === name && o.kind === kind);
  if (trouvee) return trouvee.id;
  return rpc("identite", "createOrganization", [
    {
      kind,
      name,
      validationMode,
      jurisdiction: "TN",
      currency: "TND",
      defaultEntityName: "Siège",
    },
  ]);
}

async function tiers(dossier, nature, code, raisonSociale, compteCollectif, matricule) {
  const existants = await rpc("tiers", "lister", [dossier, nature]);
  if (existants.some((t) => t.code === code)) return;
  await rpc("tiers", "creer", [
    {
      tenantId: dossier,
      nature,
      code,
      raisonSociale,
      compteCollectif,
      identifiantFiscal: matricule,
    },
  ]);
}

async function piece(dossier, marque, titre) {
  const enregistree = await rpc("capture", "enregistrer", [
    {
      tenantId: dossier,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `jeu-dessai:${marque}`,
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  const depot = await appelerBrut(`/pieces/${enregistree.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf(titre),
  });
  if (!depot.ok) throw new Error(`dépôt de la pièce ${marque} : ${depot.status}`);
  return enregistree.id;
}

async function ecriture(pieceId, packId, journal, libelle, lignes, comptabiliser) {
  const id = await rpc("office", "propose", [
    {
      pieceId,
      journal,
      date: new Date().toISOString().slice(0, 10),
      libelle,
      packVersionId: packId,
      lignes,
      devise: "TND",
    },
  ]);
  if (comptabiliser) await rpc("office", "book", [id]);
  return id;
}

async function main() {
  console.log("Jeu d'essai Regalica Office\n");

  await ouvrirSession();

  const pack = await rpc("referentiel", "activePack", ["TN"]);
  if (!pack) throw new Error("aucun pack tunisien en vigueur : chargez les migrations d'abord");

  const cabinet = await organisation("cabinet", "CABINET REGALICA", "mandate");
  const optic = await organisation("pme", "DREAM OPTIC", "mandate");
  const atlas = await organisation("pme", "ATLAS DISTRIBUTION", "autonome");
  console.log(`  cabinet          CABINET REGALICA`);
  console.log(`  dossiers         DREAM OPTIC · ATLAS DISTRIBUTION`);

  for (const pme of [optic, atlas]) {
    await rpc("identite", "creerMandat", [
      { pmeOrgId: pme, cabinetOrgId: cabinet, status: "actif" },
    ]);
  }
  console.log(`  mandats          2 actifs`);

  // Les comptes collectifs viennent du plan, jamais d'une constante ici.
  await tiers(optic, "client", "PHARMA01", "PHARMACIE CENTRALE", "411", "1234567/A/M/000");
  await tiers(optic, "client", "OPTIQ02", "OPTIQUE DU LAC", "411", "2345678/B/N/000");
  await tiers(optic, "fournisseur", "VERRES01", "VERRES DE TUNISIE", "401", "3456789/C/P/000");
  await tiers(atlas, "fournisseur", "GROSSI01", "GROSSISTE DU SUD", "401", "4567890/D/Q/000");
  await tiers(atlas, "client", "SUPER01", "SUPERETTE EL MENZAH", "411", "5678901/E/R/000");
  console.log(`  tiers            5`);

  const p1 = await piece(optic, "optic-achat-1", "Facture VERRES DE TUNISIE");
  const p2 = await piece(optic, "optic-vente-1", "Facture PHARMACIE CENTRALE");
  const p3 = await piece(atlas, "atlas-achat-1", "Facture GROSSISTE DU SUD");
  console.log(`  pièces           3, avec leurs octets`);

  // Deux lignes équilibrées : la RPC refuse tout déséquilibre, et c'est bien.
  const achat = (ht, tva) => [
    { ordinal: 1, account_code: "607", libelle: "Achats de marchandises", debit: ht, credit: 0 },
    { ordinal: 2, account_code: "43661", libelle: "TVA déductible", debit: tva, credit: 0 },
    {
      ordinal: 3,
      account_code: "401",
      libelle: "Fournisseur",
      debit: 0,
      credit: (Number(ht) + Number(tva)).toFixed(3),
    },
  ];
  const vente = (ht, tva) => [
    {
      ordinal: 1,
      account_code: "411",
      libelle: "Client",
      debit: (Number(ht) + Number(tva)).toFixed(3),
      credit: 0,
    },
    { ordinal: 2, account_code: "707", libelle: "Ventes de marchandises", debit: 0, credit: ht },
    { ordinal: 3, account_code: "43671", libelle: "TVA collectée", debit: 0, credit: tva },
  ];

  await ecriture(
    p1,
    pack.id,
    "ACH",
    "Facture VERRES DE TUNISIE",
    achat("1200.000", "228.000"),
    true,
  );
  await ecriture(
    p2,
    pack.id,
    "VTE",
    "Facture PHARMACIE CENTRALE",
    vente("2500.000", "475.000"),
    true,
  );
  await ecriture(
    p3,
    pack.id,
    "ACH",
    "Facture GROSSISTE DU SUD",
    achat("860.000", "163.400"),
    false,
  );
  console.log(`  écritures        3 — deux comptabilisées, une en proposition`);

  console.log(`\nOuvrez http://localhost:8080 et connectez-vous :`);
  console.log(`  ${EMAIL}`);
  console.log(`  ${MOTDEPASSE}`);
}

main().catch((e) => {
  console.error(`\néchec : ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
