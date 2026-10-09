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
 *   un compte              dev@malica.local
 *   un cabinet             CABINET MALICA
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

// C'est ce script qui CRÉE le compte de développement, et les épreuves qui s'y
// connectent. Les deux lisent donc la même déclaration, dans le socle des
// épreuves : deux copies d'un mot de passe, c'est une copie qu'on oubliera de
// changer.
import { COMPTE_DEV } from "../../outils/epreuves/socle.mjs";

const API = process.env["MALICA_API_URL"] ?? "http://localhost:3000";
const EMAIL = COMPTE_DEV.email;

/**
 * Le jour du dépôt — le dernier jour du mois EN COURS.
 *
 * Une date figée vieillit : le 1er septembre, un jeu d'essai daté d'août
 * ouvre sur des écrans vides — pas parce que le câblage est faux, mais parce
 * que le mois a tourné. La marque d'idempotence porte le même mois : rejouer
 * le jeu ne duplique rien DANS le mois, et le mois suivant repart propre.
 */
const AUJOURDHUI = new Date();
const MOIS = AUJOURDHUI.toISOString().slice(0, 7);
const LE_JOUR = new Date(Date.UTC(AUJOURDHUI.getUTCFullYear(), AUJOURDHUI.getUTCMonth() + 1, 0))
  .toISOString()
  .slice(0, 10);
const MOTDEPASSE = COMPTE_DEV.motDePasse;

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

/**
 * Un PDF réellement valide.
 *
 * La première version n'avait ni table `xref` ni `startxref` : pdf.js la
 * refusait, et la visionneuse affichait « Document illisible ». Un PDF n'est
 * pas un texte qui commence par %PDF- — c'est un fichier indexé, et l'index
 * porte l'offset EN OCTETS de chaque objet.
 *
 * D'où la construction par morceaux : on encode au fur et à mesure et on note
 * la position de chaque objet. Écrire le fichier comme une chaîne puis compter
 * les caractères donnerait des offsets faux dès le premier accent.
 */
function pdf(titre, lignes) {
  const enc = new TextEncoder();
  const morceaux = [];
  let position = 0;
  const offsets = [0];

  const ajouter = (texte) => {
    const octets = enc.encode(texte);
    morceaux.push(octets);
    position += octets.length;
  };
  const objet = (n, corps) => {
    offsets[n] = position;
    ajouter(`${n} 0 obj\n${corps}\nendobj\n`);
  };

  // Le texte de la page. Helvetica n'a pas d'accents en encodage standard :
  // on reste en ASCII, ce qui suffit pour un jeu d'essai.
  const flux =
    "BT /F1 14 Tf 60 780 Td (" +
    titre.replace(/[()\\]/g, "") +
    ") Tj ET\n" +
    lignes
      .map((l, i) => `BT /F1 10 Tf 60 ${740 - i * 18} Td (${l.replace(/[()\\]/g, "")}) Tj ET`)
      .join("\n");

  ajouter("%PDF-1.4\n");
  objet(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objet(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objet(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  );
  objet(4, `<< /Length ${enc.encode(flux).length} >>\nstream\n${flux}\nendstream`);
  objet(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const debutXref = position;
  const entree = (o) => String(o).padStart(10, "0") + " 00000 n \n";
  ajouter("xref\n0 6\n0000000000 65535 f \n");
  for (let n = 1; n <= 5; n += 1) ajouter(entree(offsets[n]));
  ajouter(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`);

  const total = morceaux.reduce((n, m) => n + m.length, 0);
  const fichier = new Uint8Array(total);
  let curseur = 0;
  for (const m of morceaux) {
    fichier.set(m, curseur);
    curseur += m.length;
  }
  return fichier;
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

/**
 * Retrouve une organisation par son nom, ou la crée.
 *
 * Le matricule fiscal n'est pas un ornement : c'est lui qui dit si une facture
 * est un achat ou une vente. Le meme document est une vente pour son emetteur
 * et un achat pour son destinataire ; seule la comparaison du matricule du
 * dossier avec ceux portes par la piece tranche. Sans lui, la lecture classe
 * toute facture en vente, et une facture d'achat part au journal des ventes,
 * en produits, avec de la TVA collectee au lieu de deductible.
 */
async function organisation(kind, name, validationMode, legalId) {
  const miennes = await rpc("identite", "listMyOrganizations");
  const trouvee = miennes.find((o) => o.name === name && o.kind === kind);
  if (trouvee) return trouvee.id;
  return rpc("identite", "createOrganization", [
    {
      kind,
      name,
      validationMode,
      legalId,
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

async function piece(dossier, marque, titre, lignes) {
  const enregistree = await rpc("capture", "enregistrer", [
    {
      tenantId: dossier,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `jeu-dessai:${MOIS}:${marque}`,
      contentType: "application/pdf",
      pageCount: 1,
    },
  ]);
  const depot = await appelerBrut(`/pieces/${enregistree.id}/contenu`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf(titre, lignes),
  });
  if (!depot.ok) throw new Error(`dépôt de la pièce ${marque} : ${depot.status}`);
  return enregistree.id;
}

/**
 * Le plan du cabinet, lu une fois.
 *
 * Le jeu d'essai écrivait ses libellés de ligne à la main — « Fournisseur »,
 * « TVA déductible ». Deux d'entre eux ne correspondaient à aucun compte : le
 * 43661 n'existe pas en NC 01, la TVA déductible s'y appelle 4366. On écrivait
 * donc des écritures sur un compte que personne ne peut nommer.
 *
 * Le produit importe le libellé du plan ; le jeu d'essai fait pareil. S'il
 * cite un compte absent, il échoue au lieu de produire une donnée impossible.
 */
let PLAN = null;

async function libelleDuCompte(cabinetId, code) {
  PLAN ??= new Map(
    (await rpc("parametrage", "plan", [cabinetId, null])).map((c) => [c.code, c.libelle]),
  );
  const libelle = PLAN.get(code);
  if (!libelle) throw new Error(`compte ${code} absent du plan comptable`);
  return libelle;
}

/** Complète chaque ligne avec le libellé que le plan donne à son compte. */
async function selonLePlan(cabinetId, lignes) {
  return Promise.all(
    lignes.map(async (l) => ({ ...l, libelle: await libelleDuCompte(cabinetId, l.account_code) })),
  );
}

/**
 * Une écriture, une seule fois.
 *
 * Le fichier annonçait « rejouable : une seconde exécution ne duplique rien ».
 * C'était vrai des pièces et des tiers, faux des écritures : chaque exécution
 * en empilait une de plus, et l'écran de revue en choisissait une au hasard
 * parmi cinq. Une écriture comptabilisée ne se supprime pas — il faut donc ne
 * pas la créer deux fois.
 *
 * `propose` remplace une proposition existante ; c'est comptabiliser qui grave.
 * On ne repasse donc que si la pièce ne porte encore aucune écriture gravée.
 */
/**
 * La lecture citée d'une pièce.
 *
 * Le jeu d'essai s'arrêtait au dépôt des octets : aucune pièce n'était lue.
 * Conséquence, l'écran de revue disait « Pièce non encore lue », la
 * visionneuse n'avait aucune zone à surligner, et l'accueil PME affichait
 * « — » pour la TVA parce que `bookedExtracts` ne rendait rien. Le jeu
 * d'essai montrait un produit amputé de sa moitié la plus visible.
 *
 * On ne simule pas le lecteur : on appelle la MÊME RPC que lui,
 * `capture.persisterLecture`, avec un extrait conforme au contrat. Si le
 * contrat change, le jeu d'essai casse — c'est le but.
 *
 * Les boîtes des jetons suivent la mise en page du PDF généré plus haut :
 * titre à y=780, lignes à 740 − 18i, sur une page A4 de 595 × 842. Le
 * repère du PDF part d'en bas, celui de la visionneuse d'en haut : d'où le
 * 1 − y/842.
 */
async function lecture(pieceId, packId, titre, lignes, extrait, aCiter) {
  const dossier = await rpc("capture", "dossier", [pieceId]);
  if (dossier.extraction) return;

  const boite = (i) => {
    const yPdf = i === 0 ? 780 : 740 - (i - 1) * 18;
    const hauteur = i === 0 ? 16 : 12;
    return {
      x0: 60 / 595,
      x1: Math.min(1, (60 + (i === 0 ? titre.length : lignes[i - 1].length) * 5.6) / 595),
      y0: 1 - (yPdf + hauteur) / 842,
      y1: 1 - yPdf / 842,
    };
  };

  const textes = [titre, ...lignes];
  const jetons = textes.map((texte, i) => ({
    page: 1,
    ordinal: i + 1,
    text: texte,
    confidence: 0.98,
    ...boite(i),
  }));

  // Chaque champ cité pointe le jeton qui le porte — c'est ce lien, et lui
  // seul, qui fait qu'un montant à l'écran ouvre sa zone source.
  const citations = Object.entries(aCiter).flatMap(([champ, aiguille]) => {
    const i = textes.findIndex((l) => l.includes(aiguille));
    if (i < 0) throw new Error(`citation ${champ} : « ${aiguille} » absent de la pièce`);
    return [{ field: champ, page: 1, ordinal: i + 1, zone: `p.1` }];
  });

  await rpc("capture", "persisterLecture", [
    {
      pieceId,
      packId,
      tokens: jetons,
      contract: "extract.v1",
      extract: extrait,
      citations,
      flags: [],
      articles: extrait.articles ?? [],
      documentKind: extrait.document_kind,
      documentDate: extrait.document_date,
    },
  ]);
}

/** Un extrait conforme au contrat, à partir des trois montants de la pièce. */
function extrait(kind, emetteur, date, reference, ht, tva, timbre, articles) {
  const ttc = (Number(ht) + Number(tva) + Number(timbre ?? 0)).toFixed(3);
  return {
    contract: "extract.v1",
    issuer: emetteur,
    document_date: date,
    currency: "TND",
    document_kind: kind,
    lines: [
      {
        label: kind === "facture_vente" ? "Ventes" : "Achats",
        tax_code: "TVA19",
        base_ht: ht,
        vat_amount: tva,
        ttc: (Number(ht) + Number(tva)).toFixed(3),
      },
    ],
    articles: articles ?? [],
    other_charges: timbre
      ? [{ code: "DROIT_TIMBRE", label: "Droit de timbre", amount: timbre }]
      : [],
    totals: { base_ht: ht, vat: tva, ttc },
    references: { invoice_no: reference },
    field_confidence: { issuer: 0.98, document_date: 0.97, total: 0.99 },
  };
}

async function ecriture(pieceId, packId, journal, libelle, date, lignes, comptabiliser) {
  const existantes = await rpc("office", "ecrituresForPiece", [pieceId]);
  if (existantes.some((e) => e.status === "booked")) return null;

  // La lecture a porté le type de la pièce, mais la règle R2 veut qu'une
  // personne le confirme avant toute écriture : le jeu joue la personne,
  // comme le « Oui » de l'écran. Le journal dit le sens de la facture.
  await rpc("capture", "preciser", [
    pieceId,
    "document_kind",
    journal === "VEN" ? "facture_vente" : "facture_achat",
  ]);

  const id = await rpc("office", "propose", [
    {
      pieceId,
      journal,
      date,
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
  console.log("Jeu d'essai Malica Office\n");

  await ouvrirSession();

  const pack = await rpc("referentiel", "activePack", ["TN"]);
  if (!pack) throw new Error("aucun pack tunisien en vigueur : chargez les migrations d'abord");

  // Le matricule de DREAM OPTIC est celui qui figure sur ses vraies factures.
  const cabinet = await organisation("cabinet", "CABINET MALICA", "mandate", "1234567A/A/M/000");
  const optic = await organisation("pme", "DREAM OPTIC", "mandate", "1128882F/P/C/000");
  const atlas = await organisation("pme", "ATLAS DISTRIBUTION", "autonome", "9876543B/B/N/000");
  console.log(`  cabinet          CABINET MALICA`);
  console.log(`  dossiers         DREAM OPTIC · ATLAS DISTRIBUTION`);

  for (const pme of [optic, atlas]) {
    await rpc("identite", "creerMandat", [
      { pmeOrgId: pme, cabinetOrgId: cabinet, status: "actif" },
    ]);
  }
  console.log(`  mandats          2 actifs`);

  // Les comptes collectifs viennent du plan, jamais d'une constante ici.
  await tiers(optic, "client", "PHARMA01", "PHARMACIE CENTRALE", "411", "1234567A/A/M/000");
  await tiers(optic, "client", "OPTIQ02", "OPTIQUE DU LAC", "411", "2345678B/A/N/000");
  await tiers(optic, "fournisseur", "VERRES01", "VERRES DE TUNISIE", "401", "3456789C/A/P/000");
  await tiers(atlas, "fournisseur", "GROSSI01", "GROSSISTE DU SUD", "401", "4567890D/A/C/000");
  await tiers(atlas, "client", "SUPER01", "SUPERETTE EL MENZAH", "411", "5678901E/A/M/000");
  console.log(`  tiers            5`);

  // Un seul endroit décrit chaque pièce : le PDF et sa lecture lisent la même
  // chose, et une modification de l'un ne peut pas laisser l'autre en arrière.
  // Un seul endroit décrit chaque pièce : le PDF et sa lecture citée lisent la
  // même chose, et modifier l'un ne peut pas laisser l'autre en arrière.
  const LIGNES = {
    p1: {
      dossier: optic,
      marque: "optic-achat-1",
      titre: "FACTURE No 2026-114",
      lignes: [
        "VERRES DE TUNISIE - MF 3456789C/A/P/000",
        "Client : DREAM OPTIC",
        "",
        "Verres organiques traites          1 200,000 TND HT",
        "TVA 19%                              228,000 TND",
        "Droit de timbre                        1,000 TND",
        "TOTAL TTC                          1 429,000 TND",
      ],
    },
    p2: {
      dossier: optic,
      marque: "optic-vente-1",
      titre: "FACTURE No V-2026-058",
      lignes: [
        "DREAM OPTIC - MF 1128882F/P/C/000",
        "Client : PHARMACIE CENTRALE",
        "",
        "Montures et verres                 2 500,000 TND HT",
        "TVA 19%                              475,000 TND",
        "Droit de timbre                        1,000 TND",
        "TOTAL TTC                          2 976,000 TND",
      ],
    },
    p3: {
      dossier: atlas,
      marque: "atlas-achat-1",
      titre: "FACTURE No 4471",
      lignes: [
        "GROSSISTE DU SUD - MF 4567890D/A/C/000",
        "Client : ATLAS DISTRIBUTION",
        "",
        "Marchandises diverses                860,000 TND HT",
        "TVA 19%                              163,400 TND",
        "TOTAL TTC                          1 023,400 TND",
      ],
    },
    p4: {
      dossier: atlas,
      marque: "atlas-achat-2",
      titre: "FACTURE No 4488",
      lignes: [
        "GROSSISTE DU SUD - MF 4567890D/A/C/000",
        "Client : ATLAS DISTRIBUTION",
        "",
        "Fournitures de bureau                340,000 TND HT",
        "TVA 19%                               64,600 TND",
        "TOTAL TTC                            404,600 TND",
      ],
    },
  };

  const depose = async (cle) => {
    const d = LIGNES[cle];
    return piece(d.dossier, d.marque, d.titre, d.lignes);
  };
  const p1 = await depose("p1");
  const p2 = await depose("p2");
  const p3 = await depose("p3");
  const p4 = await depose("p4");
  console.log(`  pièces           4, avec leurs octets`);

  // Chaque pièce est lue : citations, extrait, jetons. Sans cela l'écran de
  // revue affiche « pièce non lue » et l'accueil PME n'a aucune TVA à montrer.
  await lecture(
    p1,
    pack.id,
    LIGNES.p1.titre,
    LIGNES.p1.lignes,
    extrait(
      "facture_achat",
      "VERRES DE TUNISIE",
      LE_JOUR,
      "2026-114",
      "1200.000",
      "228.000",
      "1.000",
      [
        {
          designation: "Verres organiques traites 1.5",
          quantity: "40",
          unit_price_ht: "22.500",
          unit_price_ttc: "26.775",
          total_ht: "900.000",
          tax_code: "TVA19",
        },
        {
          designation: "Traitement antireflet",
          quantity: "40",
          unit_price_ht: "7.500",
          unit_price_ttc: "8.925",
          total_ht: "300.000",
          tax_code: "TVA19",
        },
      ],
    ),
    {
      issuer: "VERRES DE TUNISIE",
      document_date: "FACTURE No",
      "totals.vat": "TVA 19%",
      "totals.ttc": "TOTAL TTC",
    },
  );
  await lecture(
    p2,
    pack.id,
    LIGNES.p2.titre,
    LIGNES.p2.lignes,
    extrait(
      "facture_vente",
      "PHARMACIE CENTRALE",
      LE_JOUR,
      "V-2026-058",
      "2500.000",
      "475.000",
      "1.000",
      [
        {
          designation: "Montures acetate",
          quantity: "25",
          unit_price_ht: "64.000",
          unit_price_ttc: "76.160",
          total_ht: "1600.000",
          tax_code: "TVA19",
        },
        {
          designation: "Verres unifocaux",
          quantity: "30",
          unit_price_ht: "30.000",
          unit_price_ttc: "35.700",
          total_ht: "900.000",
          tax_code: "TVA19",
        },
      ],
    ),
    {
      issuer: "PHARMACIE CENTRALE",
      document_date: "FACTURE No",
      "totals.vat": "TVA 19%",
      "totals.ttc": "TOTAL TTC",
    },
  );
  await lecture(
    p3,
    pack.id,
    LIGNES.p3.titre,
    LIGNES.p3.lignes,
    extrait("facture_achat", "GROSSISTE DU SUD", LE_JOUR, "4471", "860.000", "163.400", null, [
      {
        designation: "Marchandises diverses",
        quantity: "1",
        unit_price_ht: "860.000",
        unit_price_ttc: "1023.400",
        total_ht: "860.000",
        tax_code: "TVA19",
      },
    ]),
    {
      issuer: "GROSSISTE DU SUD",
      document_date: "FACTURE No",
      "totals.vat": "TVA 19%",
      "totals.ttc": "TOTAL TTC",
    },
  );
  await lecture(
    p4,
    pack.id,
    LIGNES.p4.titre,
    LIGNES.p4.lignes,
    extrait("facture_achat", "GROSSISTE DU SUD", LE_JOUR, "4488", "340.000", "64.600", null, [
      {
        designation: "Ramettes A4 80g",
        quantity: "300",
        unit_price_ht: "0.900",
        unit_price_ttc: "1.071",
        total_ht: "270.000",
        tax_code: "TVA19",
      },
      {
        designation: "Cartouches encre noire",
        quantity: "5",
        unit_price_ht: "14.000",
        unit_price_ttc: "16.660",
        total_ht: "70.000",
        tax_code: "TVA19",
      },
    ]),
    {
      issuer: "GROSSISTE DU SUD",
      document_date: "FACTURE No",
      "totals.vat": "TVA 19%",
      "totals.ttc": "TOTAL TTC",
    },
  );
  console.log(`  lectures         4, citées`);

  // Deux lignes équilibrées : la RPC refuse tout déséquilibre, et c'est bien.
  // Le code de taxe sur la ligne de TVA : sans lui, la declaration de TVA ne
  // peut pas etre construite depuis le grand livre. `buildProposal` le pose en
  // production ; le jeu d'essai l'oubliait, et le controle « ligne de TVA sans
  // code de taxe » restait vrai sur toutes les ecritures de demonstration.
  const achat = (ht, tva) =>
    selonLePlan(cabinet, [
      { ordinal: 1, account_code: "601", debit: ht, credit: 0 },
      { ordinal: 2, account_code: "4366", debit: tva, credit: 0, tax_code: "TVA19" },
      {
        ordinal: 3,
        account_code: "401",
        debit: 0,
        credit: (Number(ht) + Number(tva)).toFixed(3),
      },
    ]);
  const vente = (ht, tva) =>
    selonLePlan(cabinet, [
      {
        ordinal: 1,
        account_code: "411",
        debit: (Number(ht) + Number(tva)).toFixed(3),
        credit: 0,
      },
      { ordinal: 2, account_code: "701", debit: 0, credit: ht },
      { ordinal: 3, account_code: "4367", debit: 0, credit: tva, tax_code: "TVA19" },
    ]);

  await ecriture(
    p1,
    pack.id,
    "ACH",
    "Achat — VERRES DE TUNISIE — Réf. 2026-114 du 31/08/2026",
    LE_JOUR,
    await achat("1200.000", "228.000"),
    true,
  );
  await ecriture(
    p2,
    pack.id,
    // « VTE » n'existe pas dans ref.journals — le journal des ventes s'y appelle
    // « VEN ». Aucune clé étrangère ne porte encore socle.ecritures.journal :
    // la faute de frappe entrait donc dans le grand livre sans un mot.
    "VEN",
    "Vente — PHARMACIE CENTRALE — Réf. V-2026-058 du 31/08/2026",
    LE_JOUR,
    await vente("2500.000", "475.000"),
    true,
  );
  await ecriture(
    p3,
    pack.id,
    "ACH",
    "Achat — GROSSISTE DU SUD — Réf. 4471 du 31/08/2026",
    LE_JOUR,
    await achat("860.000", "163.400"),
    false,
  );
  await ecriture(
    p4,
    pack.id,
    "ACH",
    "Achat — GROSSISTE DU SUD — Réf. 4488 du 31/08/2026",
    LE_JOUR,
    await achat("340.000", "64.600"),
    true,
  );
  console.log(`  écritures        4 — trois comptabilisées, une en proposition`);
  console.log(
    `
  À superviser : la pièce d'ATLAS (mode autonome) se valide, se retourne` +
      `
  et se corrige. Celles de DREAM OPTIC (mode mandat) refusent : le` +
      `
  quatre-yeux interdit de superviser ce qu'on a soi-même comptabilisé.`,
  );

  console.log(`\nOuvrez http://localhost:8080 et connectez-vous :`);
  console.log(`  ${EMAIL}`);
  console.log(`  ${MOTDEPASSE}`);
}

main().catch((e) => {
  console.error(`\néchec : ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
