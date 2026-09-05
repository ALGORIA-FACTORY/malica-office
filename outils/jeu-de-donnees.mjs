/**
 * Le jeu de données — un cabinet, six PME, et de quoi éprouver chaque module.
 *
 *   node outils/jeu-de-donnees.mjs [http://localhost:8080]
 *
 * ================================================================ LE PRINCIPE
 *
 * Tout passe par l'application : les comptes par `/auth/inscription`, le
 * reste par `/rpc` et `/pieces/:id/contenu`, sous la session de la personne
 * qui ferait le geste dans le produit. Rien n'est inséré par-dessous : la
 * RLS, R7 et les déclencheurs sont exercés à chaque étape, et si le produit
 * refuse, le verdict le dit.
 *
 * Rejouable : les identités sont fixes (adresses, identifiants fiscaux, clés
 * d'idempotence), et chaque étape retrouve ce qui existe avant de créer.
 *
 * Aucun chiffre n'est écrit dans un texte s'il ne vient pas d'un moteur : les
 * taux viennent du pack, les totaux sont calculés en millimes entiers, les
 * chiffres des PV viennent des statistiques de la base, les citations du
 * conseil viennent du corpus.
 *
 * ================================================================ LE MONDE
 *
 *   Cabinet Ben Salah            leila.bensalah@bensalah.tn (expert, créatrice)
 *     Amine Bouzid               collaborateur — SOTUMAG, Medina Textile
 *     Nour Khelifi               collaborateur — Cléopâtre Voyages
 *     Sana Trabelsi              assistant     — Atelier Zitouna
 *   SOTUMAG SARL                 mandat actif, pièces lues, banque, PV, honoraires
 *   Medina Textile               mandat actif, pièces lues, honoraires émis
 *   Cléopâtre Voyages            mandat actif, pièces lues, clôture au 30 juin
 *   TunisFresh SA                mandat actif, sans collaborateur
 *   Atelier Zitouna              mandat actif, personne physique, forfaitaire
 *   Nabeul Céramique             mandat PROPOSÉ, fiche incomplète
 *
 * Mot de passe de tous les comptes : JeuDeDonnees2026!
 */
import { createHash } from "node:crypto";
import { creerEpreuve } from "./epreuves/socle.mjs";

const e = creerEpreuve("le jeu de données", process.argv[2]);

/**
 * Un appel RPC, repris une fois sur un incident de transport (5xx, connexion
 * coupée). Un refus du produit (4xx) n'est jamais repris : c'est un verdict.
 */
async function rpc(depot, methode, args = []) {
  try {
    return await e["rpc"](depot, methode, args);
  } catch (err) {
    const m = String(err?.message ?? err);
    if (!/ : 5\d\d |fetch failed|ECONNRESET|socket hang up/.test(m)) throw err;
    await new Promise((r) => setTimeout(r, 800));
    return e["rpc"](depot, methode, args);
  }
}

/** Un UUID stable, dérivé d'un nom : un lot d'import rejoué porte le même. */
function uuidDe(nom) {
  const h = createHash("sha1").update(nom).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const MOT_DE_PASSE = "JeuDeDonnees2026!";
const JURIDICTION = "TN";

/* ------------------------------------------------------------ les identités */
const LEILA = { email: "leila.bensalah@bensalah.tn", motDePasse: MOT_DE_PASSE, nom: "Leïla Ben Salah" };
const CABINET = { name: "Cabinet Ben Salah", legalId: "1234567/A/M/000" };
const EQUIPE = [
  { email: "amine.bouzid@bensalah.tn", motDePasse: MOT_DE_PASSE, nom: "Amine Bouzid", role: "collaborateur" },
  { email: "nour.khelifi@bensalah.tn", motDePasse: MOT_DE_PASSE, nom: "Nour Khelifi", role: "collaborateur" },
  { email: "sana.trabelsi@bensalah.tn", motDePasse: MOT_DE_PASSE, nom: "Sana Trabelsi", role: "assistant" },
];

/**
 * Les six PME. `fiche` décrit ce que la fiche fiscale porte ; `forme` et
 * `mode` absents laissent une fiche incomplète, et c'est voulu pour Nabeul.
 */
const PMES = {
  sotumag: {
    name: "SOTUMAG SARL", legalId: "7654321/B/M/000", email: "contact@sotumag.tn", nom: "Direction SOTUMAG",
    validationMode: "mandate",
    fiche: { forme: "morale", mode: "electronique", imposition: "reel", tva: "assujetti", secteur: "commerce de gros", cloture: "12-31", debut: "2015-04-01" },
    mandat: true, affecte: "amine.bouzid@bensalah.tn",
  },
  medina: {
    name: "Medina Textile", legalId: "2345678/C/M/000", email: "contact@medina-textile.tn", nom: "Direction Medina Textile",
    validationMode: "mandate",
    fiche: { forme: "morale", mode: "papier", imposition: "reel", tva: "assujetti", secteur: "industrie et transformation", cloture: "12-31", debut: "2009-09-01" },
    mandat: true, affecte: "amine.bouzid@bensalah.tn",
  },
  cleopatre: {
    name: "Cléopâtre Voyages", legalId: "3456789/D/M/000", email: "contact@cleopatre-voyages.tn", nom: "Direction Cléopâtre Voyages",
    validationMode: "mandate",
    fiche: { forme: "morale", mode: "electronique", imposition: "reel", tva: "assujetti", secteur: "tourisme et hôtellerie", cloture: "06-30", debut: "2018-01-15" },
    mandat: true, affecte: "nour.khelifi@bensalah.tn",
  },
  tunisfresh: {
    name: "TunisFresh SA", legalId: "4567890/E/M/000", email: "contact@tunisfresh.tn", nom: "Direction TunisFresh",
    validationMode: "autonome",
    fiche: { forme: "morale", mode: "electronique", imposition: "reel", tva: "assujetti", secteur: "commerce et distribution", cloture: "12-31", debut: "2021-06-01" },
    mandat: true, affecte: null,
  },
  zitouna: {
    name: "Atelier Zitouna", legalId: "5678901/F/P/000", email: "contact@atelier-zitouna.tn", nom: "Atelier Zitouna",
    validationMode: "mandate",
    // Les codes préférés ; remplacés par ce que le référentiel connaît.
    fiche: { forme: "physique", mode: "papier", imposition: "forfaitaire", tva: "non_assujetti", secteur: "artisanat", cloture: "12-31", debut: "2012-03-01" },
    mandat: true, affecte: "sana.trabelsi@bensalah.tn",
  },
  nabeul: {
    name: "Nabeul Céramique", legalId: "6789012/G/M/000", email: "contact@nabeul-ceramique.tn", nom: "Direction Nabeul Céramique",
    validationMode: "mandate",
    fiche: { forme: null, mode: null, imposition: "reel", tva: "assujetti", secteur: "artisanat", cloture: "12-31", debut: "2016-10-01" },
    mandat: false, affecte: null,
  },
};

/* ------------------------------------------------------------ les dates */
const AUJOURDHUI = new Date();
const ISO_JOUR = AUJOURDHUI.toISOString().slice(0, 10);
const MOIS = ISO_JOUR.slice(0, 7);
const ANNEE = AUJOURDHUI.getUTCFullYear();
const jourDuMois = (n) => `${MOIS}-${String(n).padStart(2, "0")}`;
function plusJours(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function moisPrecedent() {
  const debut = new Date(Date.UTC(AUJOURDHUI.getUTCFullYear(), AUJOURDHUI.getUTCMonth() - 1, 1));
  const fin = new Date(Date.UTC(AUJOURDHUI.getUTCFullYear(), AUJOURDHUI.getUTCMonth(), 0));
  return { du: debut.toISOString().slice(0, 10), au: fin.toISOString().slice(0, 10) };
}
function enJour(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/* ------------------------------------------------------------ les montants */
/*
 * Tout montant est une chaîne décimale à trois décimales, manipulée en
 * millimes entiers (BigInt). Aucun flottant sur le chemin : une TVA qui ne
 * tombe pas juste au millime lève, plutôt que d'être arrondie en silence.
 */
function enMillimes(s) {
  const neg = String(s).startsWith("-");
  const [entier, frac = ""] = String(s).replace(/^-/, "").split(".");
  const m = BigInt(entier) * 1000n + BigInt((frac + "000").slice(0, 3));
  return neg ? -m : m;
}
function enTexte(m) {
  const neg = m < 0n;
  const a = neg ? -m : m;
  return `${neg ? "-" : ""}${a / 1000n}.${String(a % 1000n).padStart(3, "0")}`;
}
function tauxEnDixMilliemes(taux) {
  const [entier, frac = ""] = String(taux).split(".");
  return BigInt(entier) * 10000n + BigInt((frac + "0000").slice(0, 4));
}
function tvaDe(ht, taux) {
  const produit = enMillimes(ht) * tauxEnDixMilliemes(taux);
  if (produit % 10000n !== 0n) throw new Error(`TVA inexacte au millime pour ${ht} × ${taux}`);
  return enTexte(produit / 10000n);
}
const somme = (...xs) => enTexte(xs.reduce((acc, x) => acc + enMillimes(x), 0n));
const moitie = (x) => enTexte(enMillimes(x) / 2n);

/* ------------------------------------------------------------ le PDF */
/** Un PDF valide, avec sa table xref — les offsets sont comptés en octets. */
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
  const ascii = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "");
  const flux =
    `BT /F1 14 Tf 60 780 Td (${ascii(titre)}) Tj ET\n` +
    lignes.map((l, i) => `BT /F1 10 Tf 60 ${740 - i * 18} Td (${ascii(l)}) Tj ET`).join("\n");
  ajouter("%PDF-1.4\n");
  objet(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objet(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objet(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>");
  objet(4, `<< /Length ${enc.encode(flux).length} >>\nstream\n${flux}\nendstream`);
  objet(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const debutXref = position;
  ajouter("xref\n0 6\n0000000000 65535 f \n");
  for (let n = 1; n <= 5; n += 1) ajouter(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
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

/* ------------------------------------------------------------ les aides */
const message = (err) => String(err?.message ?? err).replace(/\s+/g, " ").slice(0, 160);

/** Une étape qui peut échouer sans arrêter le jeu : l'échec devient un verdict. */
async function etape(libelle, fn) {
  try {
    return await fn();
  } catch (err) {
    e.verdict(libelle, false, message(err));
    return null;
  }
}

async function mesOrganisations() {
  return rpc("identite", "listMyOrganizations");
}

/** Le référentiel du pack, lu une fois. */
let REF = null;
async function referentiel() {
  if (REF) return REF;
  const pack = await rpc("referentiel", "activePack", [JURIDICTION]);
  if (!pack) throw new Error(`aucun pack ${JURIDICTION} en vigueur`);
  const [taux, mappings, charges, regimes, formes] = await Promise.all([
    rpc("referentiel", "taxRates", [pack.id, JURIDICTION]),
    rpc("referentiel", "accountMappings", [pack.id]),
    rpc("referentiel", "fiscalCharges", [pack.id]),
    rpc("identite", "regimesDisponibles", [JURIDICTION]),
    rpc("identite", "formesDisponibles", [JURIDICTION]),
  ]);
  REF = { pack, taux, mappings, charges, regimes, formes };
  return REF;
}

/* ============================================================ 1. le cabinet */
e.section("Le cabinet Ben Salah");
await e.inscrireOuConnecter(LEILA, LEILA.nom);
const ref = await referentiel();
e.verdict("le pack de la juridiction est en vigueur", Boolean(ref.pack.id), `${ref.pack.jurisdiction} ${ref.pack.version}`);

let cabinet = (await mesOrganisations()).find((o) => o.kind === "cabinet" && o.legalId === CABINET.legalId);
if (!cabinet) {
  const id = await rpc("identite", "createOrganization", [
    { kind: "cabinet", name: CABINET.name, legalId: CABINET.legalId, jurisdiction: JURIDICTION, currency: ref.pack.currency },
  ]);
  cabinet = (await mesOrganisations()).find((o) => o.id === id);
  e.verdict("le cabinet est créé", Boolean(cabinet), cabinet?.name ?? "");
} else {
  e.verdict("le cabinet existe déjà", true, cabinet.name);
}
e.verdict("la créatrice est expert du cabinet", cabinet?.role === "expert", cabinet?.role ?? "aucun rôle");
if (!cabinet) e.conclure();

/* ============================================================ 2. l'équipe */
e.section("L'équipe du cabinet");
for (const personne of EQUIPE) {
  await e.connecter(LEILA);
  const membres = await rpc("collab", "members", [cabinet.id]);
  const dejaMembre = membres.some((m) => m.email === personne.email);
  if (!dejaMembre) {
    const invitation = await etape(`invitation de ${personne.nom}`, () =>
      rpc("collab", "inviter", [{ tenantId: cabinet.id, email: personne.email, role: personne.role }]),
    );
    if (invitation) e.verdict(`${personne.nom} est invité(e) comme ${personne.role}`, Boolean(invitation.id), invitation.deja ? "invitation déjà en attente" : "nouvelle invitation");
  }
  await e.inscrireOuConnecter(personne, personne.nom);
  const siennes = await mesOrganisations();
  if (siennes.some((o) => o.id === cabinet.id)) {
    e.verdict(`${personne.nom} est déjà membre du cabinet`, true, siennes.find((o) => o.id === cabinet.id).role);
    continue;
  }
  const pourMoi = await rpc("collab", "invitationsPourMoi");
  const mienne = pourMoi.find((i) => i.cabinetTenantId === cabinet.id);
  if (!mienne) {
    e.verdict(`${personne.nom} voit son invitation`, false, "aucune invitation pour ce cabinet");
    continue;
  }
  const reponse = await etape(`${personne.nom} rejoint le cabinet`, () => rpc("collab", "repondreAInvitation", [mienne.id, true]));
  if (reponse) e.verdict(`${personne.nom} rejoint le cabinet comme ${personne.role}`, reponse.rejoint === true && reponse.role === personne.role, reponse.role);
}

/* ============================================================ 3. les PME */
e.section("Les six PME et leurs fiches fiscales");
const codeRegime = (axe, prefere, repli) => {
  const codes = ref.regimes.filter((r) => r.axe === axe).map((r) => r.code);
  return codes.includes(prefere) ? prefere : repli;
};
const codeForme = (axe, code) => (code && ref.formes.some((f) => f.axe === axe && f.code === code) ? code : null);

for (const [cle, pme] of Object.entries(PMES)) {
  const compte = { email: pme.email, motDePasse: MOT_DE_PASSE };
  await e.inscrireOuConnecter(compte, pme.nom);
  let org = (await mesOrganisations()).find((o) => o.kind === "pme" && o.legalId === pme.legalId);
  if (!org) {
    const id = await etape(`création de ${pme.name}`, () =>
      rpc("identite", "createOrganization", [
        { kind: "pme", name: pme.name, legalId: pme.legalId, jurisdiction: JURIDICTION, currency: ref.pack.currency, validationMode: pme.validationMode, defaultEntityName: "Siège" },
      ]),
    );
    org = (await mesOrganisations()).find((o) => o.id === id);
    e.verdict(`${pme.name} est créée par son dirigeant`, Boolean(org), org?.role ?? "");
  } else {
    e.verdict(`${pme.name} existe déjà`, true, org.role);
  }
  pme.id = org?.id ?? null;
  pme.compte = compte;
  if (!org) continue;

  const fiche = await rpc("identite", "ficheCourante", [org.id]);
  if (fiche) {
    e.verdict(`la fiche de ${pme.name} existe déjà`, true, `${fiche.regimeImposition ?? "—"} · ${fiche.regimeTva ?? "—"} · forme ${fiche.formeJuridique ?? "absente"}`);
    continue;
  }
  const f = pme.fiche;
  const etablie = await etape(`fiche de ${pme.name}`, () =>
    rpc("identite", "etablirFiche", [
      {
        tenantId: org.id,
        regimeImposition: codeRegime("imposition", f.imposition, "reel"),
        regimeTva: codeRegime("tva", f.tva, "assujetti"),
        secteur: f.secteur,
        debutActivite: f.debut,
        clotureExercice: f.cloture,
        formeJuridique: codeForme("forme", f.forme),
        modeDepot: codeForme("mode", f.mode),
        source: "saisie",
        validFrom: f.debut,
      },
    ]),
  );
  if (etablie) {
    const relue = await rpc("identite", "ficheCourante", [org.id]);
    e.verdict(
      `la fiche de ${pme.name} est établie`,
      Boolean(relue),
      `${relue?.regimeImposition} · ${relue?.regimeTva} · ${relue?.formeJuridique ?? "forme absente"} · ${relue?.modeDepot ?? "mode absent"}`,
    );
  }
  if (cle === "nabeul") {
    const derive = await etape("Nabeul dérive ses échéances", () => rpc("collab", "deriverEcheances", [[org.id]]));
    if (derive) e.verdict("une fiche incomplète ne dérive aucune échéance", derive[0]?.raison === "fiche.incomplete", derive[0]?.raison ?? `${derive[0]?.generees} générées`);
  }
}

/* ============================================================ 4. les mandats */
e.section("Les mandats");
await e.connecter(LEILA);
const propositions = {};
for (const [cle, pme] of Object.entries(PMES)) {
  if (!pme.id) continue;
  const p = await etape(`mandat proposé à ${pme.name}`, () => rpc("identite", "proposerMandat", [cabinet.id, pme.legalId]));
  if (p) {
    propositions[cle] = p;
    e.verdict(`le cabinet propose un mandat à ${pme.name}`, p.pmeTenantId === pme.id, `${p.status}${p.deja ? " (déjà)" : ""}`);
  }
}
for (const [cle, pme] of Object.entries(PMES)) {
  const p = propositions[cle];
  if (!p || !pme.mandat) continue;
  if (p.status !== "propose") {
    e.verdict(`${pme.name} a déjà répondu au mandat`, true, p.status);
    continue;
  }
  await e.connecter(pme.compte);
  const proposes = await rpc("identite", "mandatsProposes", [pme.id]);
  const visible = proposes.find((m) => m.id === p.id);
  e.verdict(`${pme.name} voit le mandat proposé par ${cabinet.name}`, visible?.cabinet === cabinet.name);
  const reponse = await etape(`${pme.name} accepte le mandat`, () => rpc("identite", "repondreAuMandat", [p.id, true]));
  if (reponse) e.verdict(`${pme.name} accepte : le mandat est actif`, reponse.status === "actif", reponse.status);
}
if (propositions.nabeul) {
  // Le jeu laisse ce mandat proposé ; si quelqu'un y a répondu depuis, le
  // rejeu le dit sans le compter comme un défaut de l'application.
  e.verdict(
    "Nabeul Céramique reste en mandat proposé, ou a répondu depuis",
    propositions.nabeul.status === "propose" || propositions.nabeul.status === "actif",
    propositions.nabeul.status,
  );
}
await e.connecter(LEILA);
const clients = await rpc("supervision", "listClients", [cabinet.id]);
const actifs = Object.values(PMES).filter((p) => p.mandat && p.id);
e.verdict(
  "l'expert voit les cinq mandats actifs",
  actifs.every((p) => clients.some((c) => c.tenantId === p.id && c.engagementStatus === "actif")),
  `${clients.filter((c) => c.engagementStatus === "actif").length} actif(s)`,
);

/* ============================================================ 5. les affectations */
e.section("Les affectations");
const membres = await rpc("collab", "members", [cabinet.id]);
const affectations = await rpc("collab", "assignments", [cabinet.id]);
const briefingDe = (pme) => {
  const f = pme.fiche;
  return `${pme.name} — ${f.secteur}, ${f.forme === "physique" ? "personne physique" : "personne morale"}, dépôt ${f.mode}. Régime ${f.imposition}, ${f.tva.replace("_", " ")} à la TVA. Pièces transmises par le dirigeant au fil de l'eau.`;
};
for (const pme of Object.values(PMES)) {
  if (!pme.id || !pme.mandat) continue;
  const active = affectations.find((a) => a.clientTenantId === pme.id && a.active);
  if (!pme.affecte) {
    e.verdict(`${pme.name} reste sans collaborateur`, !active, active ? "une affectation active existe" : "aucune main");
    continue;
  }
  const collaborateur = membres.find((m) => m.email === pme.affecte);
  if (!collaborateur) {
    e.verdict(`${pme.affecte} est membre du cabinet`, false, "introuvable parmi les membres");
    continue;
  }
  if (active?.collaboratorId === collaborateur.userId) {
    e.verdict(`${pme.name} est déjà affectée à ${pme.affecte}`, true);
    continue;
  }
  const id = await etape(`affectation de ${pme.name}`, () =>
    rpc("collab", "assign", [{ cabinetTenantId: cabinet.id, clientTenantId: pme.id, collaboratorId: collaborateur.userId, briefing: briefingDe(pme) }]),
  );
  if (id) e.verdict(`${pme.name} est affectée à ${pme.affecte}`, Boolean(id));
}

/* ============================================================ 6. les pièces */
e.section("Les pièces, leurs lectures et leurs écritures");

const timbre = (kind) => ref.charges.find((c) => c.code === "DROIT_TIMBRE" && c.documentKind === kind);
const tauxParCode = (code) => ref.taux.find((t) => t.code === code);
const tauxNormal = ref.taux.find((t) => /normal/i.test(t.label)) ?? [...ref.taux].sort((a, b) => Number(b.rate) - Number(a.rate))[0];

/**
 * Une pièce décrite une seule fois : le PDF, la lecture et l'écriture lisent
 * la même description. `lue: false` dépose seulement les octets.
 */
function facture({ kind, issuer, ref: reference, date, ht, taxCode, avecTimbre, articles, lue = true }) {
  const taux = tauxParCode(taxCode);
  if (!taux) throw new Error(`taux ${taxCode} absent du pack`);
  const tva = tvaDe(ht, taux.rate);
  const droit = avecTimbre ? timbre(kind) : null;
  const ttc = somme(ht, tva, droit?.fixedAmount ?? "0.000");
  const nature = kind === "facture_vente" ? "Vente" : "Achat";
  const titre = `FACTURE No ${reference}`;
  const lignes = [
    `${issuer}`,
    `Date : ${enJour(date)}`,
    "",
    `${nature === "Vente" ? "Prestations et marchandises" : "Marchandises et services"}   ${ht} ${ref.pack.currency} HT`,
    `${taux.label}   ${tva} ${ref.pack.currency}`,
    ...(droit ? [`${droit.label}   ${droit.fixedAmount} ${ref.pack.currency}`] : []),
    `TOTAL TTC   ${ttc} ${ref.pack.currency}`,
  ];
  const extrait = lue
    ? {
        contract: "extract.v1",
        issuer,
        document_date: date,
        currency: ref.pack.currency,
        document_kind: kind,
        lines: [{ label: nature === "Vente" ? "Ventes" : "Achats", tax_code: taxCode, base_ht: ht, vat_amount: tva, ttc: somme(ht, tva), confidence: 0.97 }],
        articles: articles ?? [],
        other_charges: droit ? [{ code: droit.code, label: droit.label, amount: droit.fixedAmount }] : [],
        totals: { base_ht: ht, vat: tva, ttc },
        references: { invoice_no: reference },
        field_confidence: { issuer: 0.98, document_date: 0.97, overall: 0.96, "totals.ttc": 0.99 },
      }
    : null;
  return { kind, issuer, reference, date, titre, lignes, extrait, taxCode, droit, lue };
}

/** Les lignes de l'écriture, telles que le pivot du Socle les compose. */
function lignesDuPivot(x) {
  const ex = x.extrait;
  const premierCode = ex.lines[0].tax_code;
  const mapping =
    ref.mappings.find((m) => m.documentKind === ex.document_kind && m.taxCode === premierCode) ??
    ref.mappings.find((m) => m.documentKind === ex.document_kind && m.taxCode === null) ??
    ref.mappings.find((m) => m.documentKind === ex.document_kind);
  if (!mapping) throw new Error(`aucune imputation au pack pour ${ex.document_kind}`);
  const ht = somme(...ex.lines.map((l) => l.base_ht));
  const tva = somme(...ex.lines.map((l) => l.vat_amount));
  const charges = ex.other_charges.map((c) => {
    const regle = ref.charges.find((r) => r.code === c.code && r.documentKind === ex.document_kind);
    if (!regle) throw new Error(`aucun compte au pack pour le droit ${c.code}`);
    return { label: c.label || regle.label, account: regle.accountCode, amount: c.amount };
  });
  const contrepartie = somme(ht, tva, ...charges.map((c) => c.amount));
  const lignes =
    ex.document_kind === "facture_achat"
      ? [
          { account_code: mapping.mainAccount, libelle: ex.issuer, debit: ht, credit: "0" },
          { account_code: mapping.vatAccount, libelle: "TVA déductible", debit: tva, credit: "0" },
          ...charges.map((c) => ({ account_code: c.account, libelle: c.label, debit: c.amount, credit: "0" })),
          { account_code: mapping.counterpartyAccount, libelle: `Fournisseur ${ex.issuer}`, debit: "0", credit: contrepartie },
        ]
      : [
          { account_code: mapping.counterpartyAccount, libelle: `Client ${ex.issuer}`, debit: contrepartie, credit: "0" },
          { account_code: mapping.vatAccount, libelle: "TVA collectée", debit: "0", credit: tva },
          { account_code: mapping.mainAccount, libelle: ex.issuer, debit: "0", credit: ht },
          ...charges.map((c) => ({ account_code: c.account, libelle: c.label, debit: "0", credit: c.amount })),
        ];
  return {
    mapping,
    journal: ex.document_kind === "facture_achat" ? "ACH" : "VEN",
    libelle: `${ex.document_kind === "facture_achat" ? "Achat" : "Vente"} — ${ex.issuer} — Réf. ${x.reference} du ${enJour(ex.document_date)}`,
    lignes: lignes
      .filter((l) => enMillimes(l.debit) !== 0n || enMillimes(l.credit) !== 0n)
      .map((l) => ({ ...l, tax_code: l.account_code === mapping.vatAccount ? premierCode : null })),
  };
}

async function deposer(tenantId, cle, piece) {
  const enregistree = await rpc("capture", "enregistrer", [
    { tenantId, source: "pdf", vis: "partage", idempotencyKey: cle, contentType: "application/pdf", pageCount: 1 },
  ]);
  const deja = await e.appel(`/pieces/${enregistree.id}/contenu`);
  if (deja.status !== 200) {
    const depot = await e.appel(`/pieces/${enregistree.id}/contenu`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: pdf(piece.titre, piece.lignes),
    });
    if (depot.status !== 201) throw new Error(`dépôt des octets : ${depot.status}`);
  }
  return enregistree.id;
}

/** La lecture citée, sans IA : chaque champ pointe le jeton qui le porte. */
async function lire(pieceId, piece) {
  const dossier = await rpc("capture", "dossier", [pieceId]);
  if (dossier.extraction) return "déjà lue";
  const textes = [piece.titre, ...piece.lignes];
  const boite = (i) => {
    const yPdf = i === 0 ? 780 : 740 - (i - 1) * 18;
    const hauteur = i === 0 ? 16 : 12;
    return { x0: 60 / 595, x1: Math.min(1, (60 + textes[i].length * 5.6) / 595), y0: 1 - (yPdf + hauteur) / 842, y1: 1 - yPdf / 842 };
  };
  const tokens = textes.map((text, i) => ({ page: 1, ordinal: i + 1, text, confidence: 0.98, ...boite(i) }));
  const aCiter = { issuer: piece.issuer, document_date: "Date :", "totals.vat": tauxParCode(piece.taxCode).label, "totals.ttc": "TOTAL TTC", ...(piece.droit ? { "other_charges[0].amount": piece.droit.label } : {}) };
  const citations = Object.entries(aCiter).map(([field, aiguille]) => {
    const i = textes.findIndex((t) => t.includes(aiguille));
    if (i < 0) throw new Error(`citation ${field} : « ${aiguille} » absent de la pièce`);
    return { field, page: 1, ordinal: i + 1, zone: "p.1" };
  });
  const persister = (articles) =>
    rpc("capture", "persisterLecture", [
      { pieceId, packId: ref.pack.id, tokens, contract: "extract.v1", extract: piece.extrait, citations, flags: [], articles, documentKind: piece.kind, documentDate: piece.date },
    ]);
  try {
    await persister(piece.extrait.articles);
    return `lue, ${citations.length} citations`;
  } catch (err) {
    if (!/famille/i.test(message(err))) throw err;
    await persister([]);
    return `lue sans articles (${message(err)})`;
  }
}

async function comptabiliser(pieceId, piece) {
  const existantes = await rpc("office", "ecrituresForPiece", [pieceId]);
  const gravee = existantes.find((x) => x.status === "booked");
  if (gravee) return { id: gravee.id, detail: "déjà comptabilisée" };
  const p = lignesDuPivot(piece);
  const id = await rpc("office", "propose", [
    { pieceId, journal: p.journal, date: piece.date, libelle: p.libelle, packVersionId: ref.pack.id, lignes: p.lignes, devise: ref.pack.currency },
  ]);
  await rpc("office", "book", [id]);
  return { id, detail: `${p.journal} · ${p.lignes.length} lignes` };
}

/** Les tiers d'un dossier, pour que la lecture et le plan les connaissent. */
async function tiers(tenantId, liste) {
  const existants = await rpc("tiers", "lister", [tenantId, null]);
  let crees = 0;
  for (const t of liste) {
    if (existants.some((x) => x.code === t.code)) continue;
    const mapping = ref.mappings.find((m) => m.documentKind === (t.nature === "client" ? "facture_vente" : "facture_achat"));
    await rpc("tiers", "creer", [{ tenantId, nature: t.nature, code: t.code, raisonSociale: t.raisonSociale, compteCollectif: mapping.counterpartyAccount, identifiantFiscal: t.identifiantFiscal ?? null }]);
    crees += 1;
  }
  return crees;
}

const PIECES = {
  sotumag: {
    tiers: [
      { nature: "fournisseur", code: "ELECTRO01", raisonSociale: "ELECTRO IMPORT TUNISIE", identifiantFiscal: "1122334/H/A/M/000" },
      { nature: "client", code: "MANAR01", raisonSociale: "SUPERMARCHE EL MANAR", identifiantFiscal: "2233445/J/A/M/000" },
    ],
    pieces: [
      facture({ kind: "facture_achat", issuer: "ELECTRO IMPORT TUNISIE", ref: "EI-2026-0417", date: jourDuMois(3), ht: "4200.000", taxCode: tauxNormal.code, avecTimbre: true,
        articles: [{ designation: "Televiseurs LED 43 pouces", quantity: "12", unit_price_ht: "350.000", unit_price_ttc: null, total_ht: "4200.000", tax_code: tauxNormal.code }] }),
      facture({ kind: "facture_vente", issuer: "SUPERMARCHE EL MANAR", ref: "SM-2026-0088", date: jourDuMois(7), ht: "3600.000", taxCode: tauxNormal.code, avecTimbre: true,
        articles: [{ designation: "Televiseurs LED 43 pouces", quantity: "8", unit_price_ht: "450.000", unit_price_ttc: null, total_ht: "3600.000", tax_code: tauxNormal.code }] }),
      facture({ kind: "facture_achat", issuer: "STEG", ref: "STEG-0926-114", date: jourDuMois(9), ht: "310.000", taxCode: tauxNormal.code, avecTimbre: false, lue: false }),
      facture({ kind: "facture_achat", issuer: "TUNISIE TELECOM", ref: "TT-0926-5521", date: jourDuMois(11), ht: "95.000", taxCode: tauxNormal.code, avecTimbre: false, lue: false }),
    ],
  },
  medina: {
    tiers: [
      { nature: "fournisseur", code: "FILSAHEL", raisonSociale: "FILATURE DU SAHEL", identifiantFiscal: "3344556/K/A/M/000" },
      { nature: "client", code: "BOUTSFAX", raisonSociale: "MAISON BOUTIQUE SFAX", identifiantFiscal: "4455667/L/A/M/000" },
    ],
    pieces: [
      facture({ kind: "facture_achat", issuer: "FILATURE DU SAHEL", ref: "FS-2026-1205", date: jourDuMois(4), ht: "8500.000", taxCode: tauxNormal.code, avecTimbre: false,
        articles: [{ designation: "Fil de coton peigne", quantity: "1000", unit_price_ht: "8.500", unit_price_ttc: null, total_ht: "8500.000", tax_code: tauxNormal.code }] }),
      facture({ kind: "facture_vente", issuer: "MAISON BOUTIQUE SFAX", ref: "MT-2026-0312", date: jourDuMois(10), ht: "2400.000", taxCode: tauxNormal.code, avecTimbre: true,
        articles: [{ designation: "Nappes brodees", quantity: "60", unit_price_ht: "40.000", unit_price_ttc: null, total_ht: "2400.000", tax_code: tauxNormal.code }] }),
      facture({ kind: "facture_achat", issuer: "SONEDE", ref: "SON-0926-2210", date: jourDuMois(12), ht: "140.000", taxCode: tauxNormal.code, avecTimbre: false, lue: false }),
    ],
  },
  cleopatre: {
    tiers: [
      { nature: "fournisseur", code: "ORANGERS", raisonSociale: "HOTEL LES ORANGERS", identifiantFiscal: "5566778/M/A/M/000" },
      { nature: "client", code: "ALPHACON", raisonSociale: "ALPHA CONSEIL", identifiantFiscal: "6677889/N/A/M/000" },
    ],
    pieces: [
      facture({ kind: "facture_achat", issuer: "HOTEL LES ORANGERS", ref: "HO-2026-3388", date: jourDuMois(5), ht: "1500.000", taxCode: (tauxParCode("TVA07") ?? tauxNormal).code, avecTimbre: false,
        articles: [{ designation: "Nuitees en demi-pension", quantity: "10", unit_price_ht: "150.000", unit_price_ttc: null, total_ht: "1500.000", tax_code: (tauxParCode("TVA07") ?? tauxNormal).code }] }),
      facture({ kind: "facture_vente", issuer: "ALPHA CONSEIL", ref: "CV-2026-0151", date: jourDuMois(12), ht: "2000.000", taxCode: tauxNormal.code, avecTimbre: true,
        articles: [{ designation: "Seminaire d'entreprise, forfait", quantity: "1", unit_price_ht: "2000.000", unit_price_ttc: null, total_ht: "2000.000", tax_code: tauxNormal.code }] }),
      facture({ kind: "facture_achat", issuer: "TUNISAIR", ref: "TU-2026-77812", date: jourDuMois(6), ht: "980.000", taxCode: tauxNormal.code, avecTimbre: false, lue: false }),
      facture({ kind: "facture_achat", issuer: "LOUAGE EXPRESS", ref: "LX-0926-41", date: jourDuMois(8), ht: "120.000", taxCode: tauxNormal.code, avecTimbre: false, lue: false }),
    ],
  },
};

const ECRITURES = {};
for (const [cle, jeu] of Object.entries(PIECES)) {
  const pme = PMES[cle];
  if (!pme.id) continue;
  await e.connecter(pme.compte);
  const nb = await etape(`tiers de ${pme.name}`, () => tiers(pme.id, jeu.tiers));
  if (nb !== null) e.verdict(`les tiers de ${pme.name} sont connus`, true, nb ? `${nb} créé(s)` : "déjà là");
  ECRITURES[cle] = [];
  for (const [i, piece] of jeu.pieces.entries()) {
    const marque = `jeu-${cle}-${i + 1}`;
    const pieceId = await etape(`dépôt ${marque}`, () => deposer(pme.id, marque, piece));
    if (!pieceId) continue;
    e.verdict(`${pme.name} dépose ${piece.reference}`, true, marque);
    if (!piece.lue) continue;
    const lecture = await etape(`lecture ${marque}`, () => lire(pieceId, piece));
    if (lecture) e.verdict(`${piece.reference} est lue sans IA`, true, lecture);
    const ecriture = await etape(`écriture ${marque}`, () => comptabiliser(pieceId, piece));
    if (ecriture) {
      e.verdict(`${piece.reference} est proposée puis comptabilisée`, Boolean(ecriture.id), ecriture.detail);
      ECRITURES[cle].push({ pieceId, ecritureId: ecriture.id, piece });
    }
  }
  const historique = await rpc("capture", "listAvecLecture", [pme.id]);
  e.verdict(`l'historique de ${pme.name} porte ses pièces`, historique.length >= jeu.pieces.length, `${historique.length} pièce(s), ${historique.filter((p) => p.status === "comptabilisee").length} comptabilisée(s)`);
}

await e.connecter(LEILA);
const file = await rpc("supervision", "queue", [cabinet.id]);
e.verdict("la file du cabinet porte les pièces transmises", file.length > 0, `${file.length} pièce(s), ${file.filter((p) => p.status === "comptabilisee").length} à superviser`);

/* ============================================================ 7. les honoraires */
e.section("Les honoraires");
await e.connecter(LEILA);
const COUVERTURE = ["Tenue comptable", "Déclarations de TVA", "Déclarations sociales", "Bilan annuel"];
const MANDATS = {
  sotumag: { mode: "forfait", frequence: "mensuelle", jourFacturation: 5, forfait: "450.000", tauxHoraire: null },
  medina: { mode: "forfait", frequence: "mensuelle", jourFacturation: 5, forfait: "380.000", tauxHoraire: null },
  tunisfresh: { mode: "forfait", frequence: "mensuelle", jourFacturation: 10, forfait: "600.000", tauxHoraire: null },
  cleopatre: { mode: "mixte", frequence: "mensuelle", jourFacturation: 5, forfait: "300.000", tauxHoraire: "80.000" },
  zitouna: { mode: "temps", frequence: "trimestrielle", jourFacturation: 15, forfait: null, tauxHoraire: "60.000" },
};
const mandatsHonoraires = await rpc("honoraires", "mandats", [cabinet.id]);
for (const [cle, m] of Object.entries(MANDATS)) {
  const pme = PMES[cle];
  if (!pme.id) continue;
  const ouvert = mandatsHonoraires.find((x) => x.clientTenantId === pme.id);
  if (ouvert) {
    e.verdict(`le mandat d'honoraires de ${pme.name} existe`, true, `${ouvert.mode} · ${ouvert.frequence}`);
    continue;
  }
  const defini = await etape(`mandat d'honoraires de ${pme.name}`, () =>
    rpc("honoraires", "definirMandat", [{ cabinetTenantId: cabinet.id, clientTenantId: pme.id, ...m, delaiPaiementJours: 30, couverture: m.mode === "temps" ? [] : COUVERTURE }]),
  );
  if (defini) e.verdict(`le mandat d'honoraires de ${pme.name} est défini`, Boolean(defini.id), `${m.mode} · ${m.frequence}`);
}

const periode = moisPrecedent();
const FACTURES = {};
for (const cle of ["sotumag", "medina"]) {
  const pme = PMES[cle];
  if (!pme.id) continue;
  const existantes = await rpc("honoraires", "factures", [cabinet.id, { clientTenantId: pme.id }]);
  let f = existantes.find((x) => x.periodeDu === periode.du && x.statut !== "annulee");
  if (!f) {
    const cree = await etape(`brouillon d'honoraires de ${pme.name}`, () =>
      rpc("honoraires", "creerBrouillon", [
        { cabinetTenantId: cabinet.id, clientTenantId: pme.id, periodeDu: periode.du, periodeAu: periode.au, tauxTvaCode: tauxNormal.code,
          lignes: [{ libelle: `Forfait mensuel — ${COUVERTURE.join(", ").toLowerCase()}`, quantite: "1", prixUnitaire: MANDATS[cle].forfait }] },
      ]),
    );
    if (!cree) continue;
    f = await rpc("honoraires", "facture", [cree.id]);
    e.verdict(`un brouillon d'honoraires est créé pour ${pme.name}`, f?.statut === "brouillon", `HT ${f?.totalHt} · TVA ${f?.totalTva} · TTC ${f?.totalTtc}`);
  }
  if (f.statut === "brouillon") {
    const emise = await etape(`émission de la facture de ${pme.name}`, () => rpc("honoraires", "emettre", [f.id]));
    if (emise) e.verdict(`la facture de ${pme.name} est émise`, Boolean(emise.numero), emise.numero);
  } else {
    e.verdict(`la facture de ${pme.name} est déjà ${f.statut}`, true, f.numero ?? "");
  }
  FACTURES[cle] = await rpc("honoraires", "facture", [f.id]);
}
if (FACTURES.sotumag) {
  const f = FACTURES.sotumag;
  if (f.encaissements.length > 0) {
    e.verdict("SOTUMAG a déjà un encaissement partiel", true, `${f.encaisse} / ${f.totalTtc}`);
  } else if (f.statut === "emise") {
    const enc = await etape("encaissement partiel SOTUMAG", () =>
      rpc("honoraires", "encaisser", [{ factureId: f.id, montant: moitie(f.totalTtc), encaisseLe: ISO_JOUR, moyen: "virement", reference: `VIR ${f.numero}` }]),
    );
    if (enc) e.verdict("SOTUMAG règle la moitié de sa facture", enc.soldee === false, `${enc.encaisse} encaissé sur ${f.totalTtc}`);
  }
}
const synthese = await etape("synthèse des honoraires", () => rpc("honoraires", "synthese", [cabinet.id, MOIS]));
if (synthese) e.verdict("la synthèse du mois se lit", true, `${synthese.nbFactures} facture(s) · encaissé ${synthese.encaisse} · reste dû ${synthese.resteDu}`);

/* ============================================================ 8. le calendrier */
e.section("Le calendrier et les réglages du cabinet");
await e.connecter(LEILA);
const derives = await etape("dérivation des échéances", () => rpc("collab", "deriverEcheances", [actifs.map((p) => p.id)]));
if (derives) {
  for (const d of derives) {
    const pme = actifs.find((p) => p.id === d.tenantId);
    e.verdict(`les échéances de ${pme?.name} dérivent du pack`, d.raison === null, d.raison ?? `${d.generees} échéance(s)`);
  }
}
if (PMES.sotumag.id) {
  const echeances = await rpc("collab", "echeances", [[PMES.sotumag.id]]);
  const faite = echeances.find((x) => x.status === "fait");
  if (faite) {
    e.verdict("une échéance de SOTUMAG est déjà faite", true, `${faite.label} · ${faite.dueDate}`);
  } else {
    const prochaine = echeances.find((x) => x.status !== "fait");
    if (prochaine) {
      const m = await etape("marquer une échéance faite", () => rpc("collab", "marquerEcheance", [prochaine.id, true]));
      if (m) e.verdict("une échéance de SOTUMAG est marquée faite", m.status === "fait", `${prochaine.label} · ${prochaine.dueDate}`);
    } else {
      e.verdict("SOTUMAG a une échéance à marquer", false, "aucune échéance dérivée");
    }
  }
}
const secteurs = await etape("secteurs du cabinet", () => rpc("parametrage", "secteursDuCabinet", [cabinet.id]));
const secteur = secteurs?.[0] ?? "*";
const calendrier = await etape("calendrier du cabinet", () => rpc("parametrage", "calendrierCabinet", [cabinet.id, ANNEE, secteur]));
if (calendrier) {
  const obligation = calendrier.find((o) => !o.propre);
  if (obligation) {
    const reglee = await etape("réglage d'une obligation", () =>
      rpc("parametrage", "definirObligation", [{ tenantId: cabinet.id, code: obligation.code, exercice: ANNEE, secteur, active: true, rappelJours: 10 }]),
    );
    if (reglee) e.verdict(`l'obligation « ${obligation.libelle} » est réglée par le cabinet`, reglee.active === true, `rappel à ${reglee.rappelJours} jours · secteur ${secteur}`);
  } else {
    e.verdict("le calendrier du cabinet porte une obligation du pack", false, `${calendrier.length} ligne(s)`);
  }
}
const reglages = await etape("lecture des réglages", () => rpc("parametrage", "reglagesCabinet", [cabinet.id]));
if (reglages) {
  if (reglages.regle && reglages.ton === "chaleureux") {
    e.verdict("le ton du cabinet est déjà réglé", true, reglages.ton);
  } else {
    const { regle: _regle, ...champs } = reglages;
    const definis = await etape("réglages du cabinet", () => rpc("parametrage", "definirReglagesCabinet", [{ tenantId: cabinet.id, ...champs, ton: "chaleureux" }]));
    if (definis) e.verdict("le cabinet arrête ses réglages, ton chaleureux", definis.regle === true && definis.ton === "chaleureux", `seuils ${definis.seuilConfianceLot}/${definis.seuilConfianceRevue}`);
  }
}

/* ============================================================ 9. la banque */
e.section("Le rapprochement bancaire de SOTUMAG");
if (PMES.sotumag.id) {
  const pme = PMES.sotumag;
  await e.connecter(pme.compte);
  const LIBELLE_COMPTE = "BIAT — compte courant";
  // Le compte de banque du plan : « Banques » de préférence, sinon le plus
  // court des comptes de classe 5 qui portent ce mot.
  const plan = await etape("plan comptable, classe 5", () => rpc("parametrage", "plan", [pme.id, [5]]));
  const banque =
    plan?.find((c) => /^banques?$/i.test(c.libelle.trim())) ??
    plan?.filter((c) => /banque/i.test(c.libelle)).sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))[0];
  let compte = (await rpc("banque", "listAccounts", [pme.id])).find((c) => c.label === LIBELLE_COMPTE);
  if (!compte) {
    const entite = (await rpc("identite", "listEntities", [pme.id])).find((x) => x.isDefault);
    if (banque && entite) {
      const id = await etape("création du compte bancaire", () =>
        rpc("banque", "createAccount", [{ tenantId: pme.id, entityId: entite.id, label: LIBELLE_COMPTE, iban: "TN59 0800 1000 0123 4567 8901", devise: ref.pack.currency, accountCode: banque.code }]),
      );
      compte = id ? { id, accountCode: banque.code } : null;
      if (compte) e.verdict("SOTUMAG ouvre un compte bancaire", true, `${banque.code} ${banque.libelle}`);
    } else {
      e.verdict("un compte de banque existe au plan", false, plan ? `${plan.length} compte(s) de classe 5, aucun nommé banque` : "plan illisible");
    }
  } else {
    e.verdict("le compte bancaire de SOTUMAG existe", true, `${compte.accountCode} — le rapprochement lit ce code comme préfixe`);
  }
  if (compte && banque) {
    /*
     * Ce que le Socle apparie : les lignes du relevé d'un côté, les écritures
     * gravées SUR LE COMPTE DE BANQUE de l'autre. Il faut donc des règlements
     * en journal de banque — chacun porté par un avis de banque déposé comme
     * pièce — puis un relevé qui les reflète à moins de la tolérance du pack.
     */
    const params = await rpc("referentiel", "socleParams", [ref.pack.id]);
    const ecartJours = Math.max(0, Math.min(1, params.rapprochementToleranceJours - 1));
    const compteBanque = compte.accountCode.length >= banque.code.length ? compte.accountCode : banque.code;
    const lignes = [];
    for (const { ecritureId, piece } of ECRITURES.sotumag ?? []) {
      const [facturee] = await rpc("office", "ecrituresByIds", [[ecritureId]]);
      if (!facturee) continue;
      const p = lignesDuPivot(piece);
      const contrepartie = facturee.lines.find((l) => l.accountCode === p.mapping.counterpartyAccount);
      if (!contrepartie) continue;
      const achat = piece.kind === "facture_achat";
      const montant = achat ? contrepartie.credit : contrepartie.debit;
      const dateReglement = plusJours(facturee.dateEcriture.slice(0, 10), 6);
      const avis = {
        titre: `${achat ? "AVIS DE DEBIT" : "AVIS DE CREDIT"} ${piece.reference}`,
        lignes: [LIBELLE_COMPTE, `Date : ${enJour(dateReglement)}`, "", `${achat ? "Virement emis" : "Virement recu"} ${piece.issuer}`, `Reference ${piece.reference}`, `Montant ${montant} ${ref.pack.currency}`],
      };
      const avisId = await etape(`avis de banque ${piece.reference}`, () => deposer(pme.id, `jeu-sotumag-reglement-${piece.reference}`, avis));
      if (!avisId) continue;
      const reglement = await etape(`règlement ${piece.reference}`, async () => {
        const existantes = await rpc("office", "ecrituresForPiece", [avisId]);
        const gravee = existantes.find((x) => x.status === "booked");
        if (gravee) return { id: gravee.id, detail: "déjà comptabilisé" };
        const lignesBq = achat
          ? [
              { account_code: p.mapping.counterpartyAccount, libelle: `Fournisseur ${piece.issuer}`, debit: montant, credit: "0", tax_code: null },
              { account_code: compteBanque, libelle: banque.libelle, debit: "0", credit: montant, tax_code: null },
            ]
          : [
              { account_code: compteBanque, libelle: banque.libelle, debit: montant, credit: "0", tax_code: null },
              { account_code: p.mapping.counterpartyAccount, libelle: `Client ${piece.issuer}`, debit: "0", credit: montant, tax_code: null },
            ];
        const id = await rpc("office", "propose", [
          { pieceId: avisId, journal: "BQ", date: dateReglement, libelle: `${achat ? "Règlement fournisseur" : "Encaissement client"} — ${piece.issuer} — Réf. ${piece.reference} du ${enJour(dateReglement)}`, packVersionId: ref.pack.id, lignes: lignesBq, devise: ref.pack.currency },
        ]);
        await rpc("office", "book", [id]);
        return { id, detail: `BQ · ${compteBanque}` };
      });
      if (!reglement) continue;
      e.verdict(`le règlement de ${piece.reference} est comptabilisé en banque`, true, reglement.detail);
      lignes.push({
        at: plusJours(dateReglement, ecartJours),
        label: `${achat ? "VIR EMIS" : "VIR RECU"} ${piece.issuer} ${piece.reference}`,
        montant: achat ? enTexte(-enMillimes(montant)) : montant,
        reference: piece.reference,
        idempotencyKey: `jeu-sotumag-banque-${piece.reference}`,
      });
    }
    // Une ligne sans écriture en face : le Socle doit la laisser orpheline.
    lignes.push({ at: jourDuMois(2), label: "COMMISSION TENUE DE COMPTE", montant: "-15.000", reference: null, idempotencyKey: "jeu-sotumag-banque-commission" });
    const importees = await etape("import du relevé", () =>
      rpc("banque", "importLines", [{ tenantId: pme.id, compteId: compte.id, batchId: uuidDe(`jeu-sotumag-releve-${MOIS}`), lines: lignes }]),
    );
    if (importees !== null) e.verdict("le relevé de SOTUMAG est importé", true, importees ? `${importees} ligne(s) nouvelle(s)` : "déjà importé");
    const releve = await rpc("banque", "lines", [pme.id, compte.id]);
    e.verdict("le relevé se relit", releve.length >= lignes.length, `${releve.length} ligne(s)`);
    const livre = await etape("écritures du compte de banque", () =>
      rpc("banque", "bookLines", [{ tenantId: pme.id, accountCode: compte.accountCode, from: `${MOIS}-01`, to: plusJours(`${MOIS}-01`, 40) }]),
    );
    if (livre) {
      const appariables = releve.filter((l) => livre.some((k) => enMillimes(k.montant) === enMillimes(l.montant) && Math.abs((Date.parse(l.at.slice(0, 10)) - Date.parse(k.at.slice(0, 10))) / 86400000) <= params.rapprochementToleranceJours));
      e.verdict("le Socle a de quoi apparier : montants égaux, dates dans la tolérance", appariables.length >= 2, `${appariables.length} ligne(s) appariable(s) sur ${releve.length}, tolérance ${params.rapprochementToleranceJours} j`);
    }
  }
}

/* ============================================================ 10. le PV */
e.section("Le procès-verbal de SOTUMAG");
if (PMES.sotumag.id) {
  await e.connecter(LEILA);
  const TITRE = "Restitution mensuelle — SOTUMAG SARL";
  const pvs = await rpc("collab", "pvList", [cabinet.id]);
  let pv = pvs.find((p) => p.titre === TITRE && p.clientTenantId === PMES.sotumag.id);
  if (!pv) {
    const id = await etape("création du PV", () =>
      rpc("collab", "addPv", [{ cabinetTenantId: cabinet.id, clientTenantId: PMES.sotumag.id, at: ISO_JOUR, titre: TITRE, participants: "Leïla Ben Salah, Amine Bouzid, direction SOTUMAG", ordreDuJour: "Pièces du mois, trésorerie, échéances à venir" }]),
    );
    pv = id ? await rpc("collab", "pvOuvrir", [id]) : null;
    if (pv) e.verdict("un PV brouillon est ouvert pour SOTUMAG", pv.statut === "brouillon");
  } else {
    e.verdict("le PV de SOTUMAG existe déjà", true, pv.statut);
  }
  if (pv && pv.statut === "brouillon" && pv.sections.length === 0) {
    const [stats] = await rpc("collab", "stats", [[PMES.sotumag.id]]);
    const chiffres = stats
      ? [
          { label: "Pièces reçues", valeur: String(stats.pieces), source: "collab.stats", genre: "nombre", devise: null },
          { label: "Pièces comptabilisées", valeur: String(stats.comptabilisees), source: "collab.stats", genre: "nombre", devise: null },
        ]
      : [];
    const enregistre = await etape("rédaction du PV", () =>
      rpc("collab", "pvEnregistrer", [
        {
          id: pv.id,
          sections: [
            { kicker: "Pièces du mois", corps: "Les factures transmises ont été lues et comptabilisées. Des pièces restent à lire, dont une facture d'énergie : elles seront traitées à la prochaine remise." },
            { kicker: "Trésorerie", corps: "Le relevé bancaire du mois a été importé. Le rapprochement est en cours ; les règlements fournisseur et client attendus y figurent." },
            { kicker: "Échéances", corps: "Le calendrier déclaratif est dérivé du pack en vigueur. La première échéance du mois est marquée faite ; les suivantes sont suivies par le cabinet." },
          ],
          chiffres,
          decisions: "Transmettre les pièces au fil de l'eau ; le cabinet prépare la déclaration de TVA dès réception des factures manquantes.",
          ton: reglages?.ton ?? null,
          redigeParRegalica: false,
        },
      ]),
    );
    if (enregistre) e.verdict("le PV est rédigé, chiffres tirés des statistiques", enregistre.sections.length === 3, `${enregistre.chiffres.length} chiffre(s) cité(s)`);
  }
}

/* ============================================================ 11. le conseil */
e.section("Le conseil : trois arbitrages");
await e.connecter(LEILA);
const parametres = await etape("paramètres cités du corpus", () =>
  rpc("corpus", "parametresPour", [{ jurisdiction: JURIDICTION, mots: ["forfaitaires", "acomptes", "retenue", "honoraires"], nb: 60 }]),
);
const nomsCorpus = parametres ? await rpc("conseil", "nomsDesCorpus", [[...new Set(parametres.map((p) => p.corpus))]]) : {};
const fileAvant = await rpc("conseil", "file", [cabinet.id]);

/** Une réponse composée du seul texte du corpus : l'article, sa citation. */
function reponseDepuis(param) {
  const nom = nomsCorpus[param.corpus] ?? param.corpus;
  const depuis = param.validFrom ? ` (en vigueur depuis le ${enJour(param.validFrom)})` : "";
  return `Le ${nom}, ${param.article ?? "article non précisé"}${depuis}, dispose : ${param.citation ?? param.libelle}. ${param.note ?? ""}`.trim();
}
function sourceDepuis(param) {
  return { corpus: param.corpus, numero: String(param.article ?? "").replace(/^\s*art(icle|\.)?\s*/i, "").trim() || param.code, validFrom: param.validFrom, validTo: param.validTo, langue: "fr" };
}
const ARBITRAGES = [
  {
    cle: "sotumag", code: "AVANCE_VENTES_FORFAITAIRES", theme: "avance sur ventes aux forfaitaires",
    question: "Nous vendons à un détaillant au régime forfaitaire : devons-nous facturer l'avance sur nos ventes aux forfaitaires ?",
    doute: "La qualité de forfaitaire du client n'est pas établie au dossier.", decider: false,
  },
  {
    cle: "cleopatre", code: "ACOMPTES_ECHEANCES_PM", theme: "acomptes provisionnels",
    question: "Notre exercice clôture en milieu d'année civile : à quelles dates tombent nos acomptes provisionnels ?",
    doute: "La date de clôture décalée demande de recompter les mois depuis la clôture ; à vérifier avec le cabinet.", decider: false,
  },
  {
    cle: "medina", code: "RAS_HONORAIRES_REEL", theme: "retenue à la source sur honoraires",
    question: "Devons-nous opérer une retenue à la source sur les honoraires que nous verse notre cabinet comptable ?",
    doute: "Le régime du bénéficiaire conditionne le taux : à confirmer.", decider: true,
  },
];
for (const a of ARBITRAGES) {
  const pme = PMES[a.cle];
  if (!pme.id || !parametres) continue;
  const param = parametres.find((p) => p.code === a.code) ?? parametres.find((p) => p.libelle.toLowerCase().includes(a.theme.split(" ")[0]));
  if (!param) {
    e.verdict(`un paramètre du corpus fonde l'arbitrage de ${pme.name}`, false, `${a.code} introuvable`);
    continue;
  }
  let arbitrage = fileAvant.find((x) => x.tenantId === pme.id && x.question === a.question);
  if (!arbitrage) {
    await e.connecter(pme.compte);
    const contexte = await rpc("conseil", "contexte", [pme.id]);
    if (contexte.seuil === null) {
      e.verdict(`${pme.name} a un cabinet qui arbitre`, false, "aucun seuil : pas de cabinet mandaté");
      continue;
    }
    const certitude = Math.max(0.05, Math.round((contexte.seuil - 0.2) * 100) / 100);
    const titre = `Question — ${a.theme}`;
    let fil = (await rpc("conversations", "lister", [pme.id])).find((f) => f.titre === titre);
    if (!fil) {
      fil = await rpc("conversations", "ouvrirNouvelle", [pme.id]);
      await rpc("conversations", "ajouter", [{ conversationId: fil.id, question: a.question, reponse: "Votre question est relue par votre cabinet avant réponse." }]);
      await rpc("conversations", "renommer", [{ conversationId: fil.id, titre }]);
    }
    const cree = await etape(`arbitrage de ${pme.name}`, () =>
      rpc("conseil", "creer", [
        { tenantId: pme.id, conversationId: fil.id, question: a.question, reponse: reponseDepuis(param), sources: [sourceDepuis(param)], certitude, doute: a.doute, canal: "conversation", theme: a.theme, langue: "fr", statut: "en_attente" },
      ]),
    );
    if (!cree) continue;
    e.verdict(`${pme.name} pose une question de conseil, retenue sous le seuil`, cree.cabinetId === cabinet.id, `certitude ${certitude} < seuil ${contexte.seuil} · ${param.corpus} ${param.article}`);
    await e.connecter(LEILA);
    arbitrage = await rpc("conseil", "lire", [cree.id]);
  } else {
    e.verdict(`l'arbitrage de ${pme.name} existe déjà`, true, arbitrage.statut);
  }
  if (a.decider && arbitrage?.statut === "en_attente") {
    await e.connecter(LEILA);
    const decide = await etape(`approbation de l'arbitrage de ${pme.name}`, () =>
      rpc("conseil", "decider", [arbitrage.id, "approuvee", null, null, `${arbitrage.reponseProposee}\n\nRéponse relue et approuvée par ${cabinet.name}.`]),
    );
    if (decide) e.verdict(`le cabinet approuve la réponse à ${pme.name}`, decide.statut === "approuvee", decide.statut);
  }
}
await e.connecter(LEILA);
const stats = await etape("statistiques du conseil", () => rpc("conseil", "statistiques", [cabinet.id]));
if (stats) e.verdict("la file du conseil porte deux attentes et une approbation", stats.totaux.enAttente >= 2 && stats.totaux.approuvees >= 1, `${stats.totaux.enAttente} en attente · ${stats.totaux.approuvees} approuvée(s)`);

/* ============================================================ fin */
e.section("Pour ouvrir le jeu");
console.log(`  ${LEILA.email}  (expert)            mot de passe ${MOT_DE_PASSE}`);
for (const p of EQUIPE) console.log(`  ${p.email}  (${p.role})`);
for (const p of Object.values(PMES)) console.log(`  ${p.email}  (dirigeant de ${p.name})`);
e.conclure();
