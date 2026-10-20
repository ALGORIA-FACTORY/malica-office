/**
 * Épreuve — les moteurs du dossier et les réglages, dans l'ordre d'un usage
 * réel : la fiche fiscale, les échéances qui en dérivent, les réglages et le
 * calendrier du cabinet, le rapprochement, les immobilisations, les stocks,
 * le plan comptable, et la synthèse du dossier qui rassemble tout.
 *
 *   node outils/epreuves/moteurs-du-dossier.mjs [http://localhost:8080]
 *
 * Rejouable : les deux PME de l'épreuve portent des identifiants fixes ; les
 * comptes, biens, articles et tiers qu'elle crée portent des libellés
 * « Épreuve … » et des clés d'idempotence fixes. Ce qui existe déjà est repris
 * tel quel, puis éprouvé de nouveau. Aucun montant ne passe par un flottant :
 * les sommes se font en millimes entiers.
 */
import { COMPTE_DEV, creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("les moteurs du dossier", process.argv[2]);

const PME_A = { name: "ÉPREUVE MOTEURS SARL", legalId: "9999998M/A/P/000" };
const PME_B = { name: "ÉPREUVE SANS FICHE SARL", legalId: "9999997S/A/P/000" };
const FICHE = {
  regimeImposition: "reel",
  regimeTva: "assujetti",
  secteur: "commerce de détail",
  clotureExercice: "12-31",
  formeJuridique: "morale",
  modeDepot: "electronique",
};
const AUJOURDHUI = new Date().toISOString().slice(0, 10);
const ANNEE = Number(AUJOURDHUI.slice(0, 4));
const EXERCICE_PASSE = ANNEE - 1;

/* ------------------------------------------------------------- décimal exact */
/** Une chaîne décimale → entier en millimes (BigInt). Trois décimales, jamais plus. */
function millimes(s) {
  const m = /^(-?)(\d+)(?:\.(\d{0,3}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`montant illisible : ${s}`);
  const signe = m[1] === "-" ? -1n : 1n;
  return signe * (BigInt(m[2]) * 1000n + BigInt((m[3] ?? "").padEnd(3, "0")));
}
function texte(m) {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const ent = abs / 1000n;
  const dec = (abs % 1000n).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${ent}.${dec}`;
}
const egal = (a, b) => millimes(a) === millimes(b);

/* ------------------------------------------------------------- le cabinet */
e.section("Le cabinet et ses deux dossiers d'épreuve");
await e.connecter(COMPTE_DEV);
const orgs = await e.rpc("identite", "listMyOrganizations");
const cabinet = orgs.find((o) => o.kind === "cabinet");
e.verdict("le compte de développement a un cabinet", Boolean(cabinet), cabinet?.name ?? "");
if (!cabinet) e.conclure();
const pack = await e.rpc("referentiel", "activePack", [cabinet.jurisdiction]);
e.verdict("un pack de juridiction est en vigueur", Boolean(pack?.id), pack?.version ?? "");
if (!pack) e.conclure();

async function pmeDEpreuve(identite) {
  const miennes = await e.rpc("identite", "listMyOrganizations");
  let pme = miennes.find((o) => o.kind === "pme" && o.legalId === identite.legalId);
  if (!pme) {
    const id = await e.rpc("identite", "createOrganization", [
      {
        kind: "pme",
        name: identite.name,
        legalId: identite.legalId,
        jurisdiction: cabinet.jurisdiction,
        currency: pack.currency,
      },
    ]);
    pme = (await e.rpc("identite", "listMyOrganizations")).find((o) => o.id === id);
  }
  // Le mandat : proposé par le cabinet, accepté par la PME — le même compte
  // est membre des deux, et c'est ce qui rend l'épreuve autonome.
  const proposition = await e.rpc("identite", "proposerMandat", [cabinet.id, identite.legalId]);
  if (proposition.status === "propose") {
    await e.rpc("identite", "repondreAuMandat", [proposition.id, true]);
  }
  return pme;
}
const pmeA = await pmeDEpreuve(PME_A);
const pmeB = await pmeDEpreuve(PME_B);
const clients = await e.rpc("supervision", "listClients", [cabinet.id]);
e.verdict(
  "les deux PME sont des mandats actifs du cabinet",
  [pmeA, pmeB].every((p) =>
    clients.some((c) => c.tenantId === p.id && c.engagementStatus === "actif"),
  ),
  `${pmeA.name} · ${pmeB.name}`,
);
const clientA = clients.find((c) => c.tenantId === pmeA.id);

/* ------------------------------------------------------------- la fiche */
e.section("La fiche fiscale");
const formes = await e.rpc("identite", "formesDisponibles", [cabinet.jurisdiction]);
e.verdict(
  "le référentiel distingue des formes juridiques et des modes de dépôt",
  formes.some((f) => f.axe === "forme" && f.code === FICHE.formeJuridique) &&
    formes.some((f) => f.axe === "mode" && f.code === FICHE.modeDepot),
  formes.map((f) => `${f.axe}:${f.code}`).join(" "),
);
const regimes = await e.rpc("identite", "regimesDisponibles", [cabinet.jurisdiction]);
e.verdict(
  "les régimes de la fiche existent au référentiel",
  regimes.some((r) => r.axe === "imposition" && r.code === FICHE.regimeImposition) &&
    regimes.some((r) => r.axe === "tva" && r.code === FICHE.regimeTva),
);

let fiche = await e.rpc("identite", "ficheCourante", [pmeA.id]);
const ficheConforme = (f) =>
  Boolean(f) &&
  f.formeJuridique === FICHE.formeJuridique &&
  f.modeDepot === FICHE.modeDepot &&
  f.regimeImposition === FICHE.regimeImposition &&
  f.regimeTva === FICHE.regimeTva &&
  f.secteur === FICHE.secteur &&
  f.clotureExercice === FICHE.clotureExercice;
if (!ficheConforme(fiche) || fiche.validFrom !== AUJOURDHUI) {
  // Établir clôture la fiche qui court et en ouvre une neuve datée d'aujourd'hui.
  // Le même jour, la base refuserait deux fiches sur la même période : on
  // n'établit que si celle d'aujourd'hui n'est pas déjà la bonne.
  if (!(ficheConforme(fiche) && fiche.validFrom === AUJOURDHUI)) {
    const etablie = await e.rpc("identite", "etablirFiche", [
      { tenantId: pmeA.id, ...FICHE, source: "saisie", validFrom: AUJOURDHUI },
    ]);
    e.verdict("la fiche s'établit avec sa forme et son mode de dépôt", Boolean(etablie?.id));
  }
}
fiche = await e.rpc("identite", "ficheCourante", [pmeA.id]);
e.verdict(
  "la fiche relue porte ce qui a été établi",
  ficheConforme(fiche) && fiche.validTo === null,
  fiche ? `${fiche.formeJuridique} · ${fiche.modeDepot} · depuis ${fiche.validFrom}` : "aucune",
);
const refusRegime = await e.rpcAttenduEnEchec("identite", "etablirFiche", [
  {
    tenantId: pmeB.id,
    regimeImposition: "regime_inexistant",
    formeJuridique: "morale",
    modeDepot: "papier",
    source: "saisie",
    validFrom: AUJOURDHUI,
  },
]);
e.verdict(
  "un régime inconnu du référentiel est refusé",
  refusRegime !== null,
  refusRegime?.message ?? "",
);
e.verdict(
  "le refus n'a rien laissé derrière lui",
  (await e.rpc("identite", "ficheCourante", [pmeB.id])) === null,
);

/* ------------------------------------------------------------- les échéances */
e.section("Les échéances dérivent du pack");
const derivation = await e.rpc("collab", "deriverEcheances", [[pmeA.id, pmeB.id]]);
const dA = derivation.find((d) => d.tenantId === pmeA.id);
const dB = derivation.find((d) => d.tenantId === pmeB.id);
e.verdict(
  "le dossier à fiche complète a un calendrier",
  dA?.raison === null && dA.generees > 0,
  `${dA?.generees} générée(s)`,
);
e.verdict(
  "le dossier sans fiche n'en a pas, et la raison le dit",
  dB?.raison === "fiche.absente",
  dB?.raison ?? "",
);

// Le référentiel, tel que le calendrier du cabinet le rend : de quoi retrouver
// l'obligation retenue pour la forme et le mode de la fiche.
const calendrier = await e.rpc("parametrage", "calendrierCabinet", [cabinet.id, ANNEE, "*"]);
const duPack = calendrier.filter((o) => !o.propre);
e.verdict(
  "le calendrier du cabinet lit les obligations du pack",
  duPack.length > 0,
  `${duPack.length} obligation(s)`,
);
e.verdict(
  "chaque obligation dit à qui elle s'applique",
  duPack.every((o) => "formeJuridique" in o && "modeDepot" in o && "regime" in o),
);
const applicables = duPack.filter(
  (o) =>
    ["mensuelle", "trimestrielle"].includes(o.periodicite) &&
    (o.formeJuridique === null || o.formeJuridique === fiche.formeJuridique) &&
    (o.modeDepot === null || o.modeDepot === fiche.modeDepot) &&
    (o.regime === null || o.regime === fiche.regimeImposition),
);
const precision = (o) => (o.formeJuridique ? 2 : 0) + (o.modeDepot ? 1 : 0) + (o.regime ? 4 : 0);
const famille = (code) => code.split("_")[0];
const retenues = applicables.filter(
  (o) =>
    precision(o) ===
    Math.max(...applicables.filter((b) => famille(b.code) === famille(o.code)).map(precision)),
);
const attendus = new Map(retenues.map((o) => [o.code, o]));
const echeancesA = (await e.rpc("collab", "echeances", [[pmeA.id]])).filter(
  (x) => !x.kind.startsWith("CAB:"),
);
const kindsA = new Set(echeancesA.map((x) => x.kind));
e.verdict(
  "les échéances sont celles des obligations retenues pour cette forme et ce mode",
  kindsA.size > 0 &&
    [...kindsA].every((k) => attendus.has(k)) &&
    [...attendus.keys()].every((k) => kindsA.has(k)),
  `${[...kindsA].sort().join(" ")}`,
);
/*
 * Depuis la 0.2.43, la date LÉGALE porte le quantième de l'obligation ; la
 * date retenue peut glisser au premier jour ouvrable (le 15 octobre 2026 est
 * la fête de l'Évacuation). L'épreuve juge les deux, et leur lien.
 */
e.verdict(
  "la date légale de chaque échéance est le quantième de son obligation",
  echeancesA.every((x) => Number(x.dateLegale.slice(8, 10)) === attendus.get(x.kind)?.echeanceJour),
  echeancesA
    .slice(0, 3)
    .map((x) => `${x.kind} ${x.dateLegale}`)
    .join(" · "),
);
e.verdict(
  "la date retenue est la date légale, ou le jour ouvrable qui la suit",
  echeancesA.every((x) =>
    x.dateOrigine === "loi"
      ? x.dueDate === x.dateLegale
      : x.dateOrigine === "jour_ouvrable" && x.dueDate > x.dateLegale,
  ),
  echeancesA
    .filter((x) => x.dateOrigine !== "loi")
    .slice(0, 3)
    .map((x) => `${x.kind} ${x.dateLegale} → ${x.dueDate}`)
    .join(" · "),
);
e.verdict(
  "chaque échéance porte la règle et la période qui la fondent",
  echeancesA.every((x) => x.regle && x.period && x.periodicite),
);

/* ------------------------------------------------------------- marquer */
e.section("Marquer faite, rouvrir");
const cible = echeancesA.find((x) => x.status !== "fait") ?? echeancesA[0];
const faite = await e.rpc("collab", "marquerEcheance", [cible.id, true]);
e.verdict("une échéance se marque faite", faite.status === "fait");
const relue = (await e.rpc("collab", "echeances", [[pmeA.id]])).find((x) => x.id === cible.id);
e.verdict(
  "relue, elle est faite et datée",
  relue?.status === "fait" && relue.faitLe !== null,
  relue?.faitLe ?? "",
);
const journal1 = await e.rpc("supervision", "journalDuMandat", [pmeA.id, 50]);
e.verdict(
  "le journal du mandat garde le geste",
  journal1.some((j) => j.action === "echeance.faite"),
);
const rouverte = await e.rpc("collab", "marquerEcheance", [cible.id, false]);
e.verdict(
  "elle se rouvre, et son état se constate depuis la date",
  rouverte.status === (cible.dueDate < AUJOURDHUI ? "en_retard" : "a_venir"),
  rouverte.status,
);

/* ------------------------------------------------------------- les réglages */
e.section("Les réglages du cabinet");
const reglages = await e.rpc("parametrage", "reglagesCabinet", [cabinet.id]);
const CHAMPS = [
  "seuilConfianceLot",
  "seuilConfianceRevue",
  "doubleValidationAuDela",
  "propositionsProactives",
  "capaciteDossiers",
  "ton",
  "seuilCertitudeConseil",
];
e.verdict(
  "les réglages se lisent, défauts compris",
  CHAMPS.every((c) => c in reglages),
  reglages.regle ? "réglés" : "défauts du schéma",
);
const definis = await e.rpc("parametrage", "definirReglagesCabinet", [
  { tenantId: cabinet.id, ...Object.fromEntries(CHAMPS.map((c) => [c, reglages[c]])) },
]);
const relus = await e.rpc("parametrage", "reglagesCabinet", [cabinet.id]);
e.verdict(
  "définir en repassant tous les champs lus les rend à l'identique",
  CHAMPS.every(
    (c) => String(definis[c]) === String(reglages[c]) && String(relus[c]) === String(reglages[c]),
  ) && relus.regle === true,
);
const refusSeuils = await e.rpcAttenduEnEchec("parametrage", "definirReglagesCabinet", [
  {
    tenantId: cabinet.id,
    ...Object.fromEntries(CHAMPS.map((c) => [c, reglages[c]])),
    seuilConfianceLot: 0.5,
    seuilConfianceRevue: 0.9,
  },
]);
e.verdict(
  "un seuil de revue au-dessus du seuil de lot est refusé",
  refusSeuils !== null,
  refusSeuils?.message ?? "",
);
const refusCapacite = await e.rpcAttenduEnEchec("parametrage", "definirReglagesCabinet", [
  {
    tenantId: cabinet.id,
    ...Object.fromEntries(CHAMPS.map((c) => [c, reglages[c]])),
    capaciteDossiers: 0,
  },
]);
e.verdict("une capacité nulle est refusée", refusCapacite !== null);
const apresRefus = await e.rpc("parametrage", "reglagesCabinet", [cabinet.id]);
e.verdict(
  "un refus ne change rien",
  CHAMPS.every((c) => String(apresRefus[c]) === String(reglages[c])),
);

/* ------------------------------------------------------------- le calendrier */
e.section("Le calendrier des obligations");
const secteurs = await e.rpc("parametrage", "secteursDuCabinet", [cabinet.id]);
e.verdict(
  "les secteurs viennent des fiches des mandats",
  secteurs.includes(FICHE.secteur),
  secteurs.join(" · "),
);
const cetteAnnee = (liste, kind) =>
  liste.filter((x) => x.kind === kind && x.dueDate.startsWith(`${ANNEE}-`));
const ecartee = attendus.get([...kindsA].find((k) => cetteAnnee(echeancesA, k).length > 0));
e.verdict(
  "une obligation dérivée cette année sert de cobaye",
  Boolean(ecartee),
  ecartee?.code ?? "",
);
const rappel = calendrier.find((o) => o.code === ecartee.code)?.rappelJours ?? 0;
const desactivee = await e.rpc("parametrage", "definirObligation", [
  {
    tenantId: cabinet.id,
    code: ecartee.code,
    exercice: ANNEE,
    secteur: "*",
    active: false,
    rappelJours: rappel,
  },
]);
e.verdict("le cabinet écarte une obligation pour l'exercice", desactivee.active === false);
await e.rpc("collab", "deriverEcheances", [[pmeA.id]]);
const apresRetrait = await e.rpc("collab", "echeances", [[pmeA.id]]);
e.verdict(
  "redérivé, le dossier ne la porte plus pour cet exercice",
  cetteAnnee(apresRetrait, ecartee.code).length === 0,
);
e.verdict(
  "le calendrier la montre écartée, réglée par le cabinet",
  (await e.rpc("parametrage", "calendrierCabinet", [cabinet.id, ANNEE, "*"])).some(
    (o) => o.code === ecartee.code && o.active === false && o.regleParLeCabinet,
  ),
);
await e.rpc("parametrage", "definirObligation", [
  {
    tenantId: cabinet.id,
    code: ecartee.code,
    exercice: ANNEE,
    secteur: "*",
    active: true,
    rappelJours: rappel,
  },
]);
await e.rpc("collab", "deriverEcheances", [[pmeA.id]]);
const apresRetour = await e.rpc("collab", "echeances", [[pmeA.id]]);
e.verdict(
  "réactivée et redérivée, elle revient",
  cetteAnnee(apresRetour, ecartee.code).length === cetteAnnee(echeancesA, ecartee.code).length,
);

const LIBELLE_PROPRE = "Épreuve — taxe de place";
let propre = calendrier.find((o) => o.propre && o.libelle === LIBELLE_PROPRE);
if (!propre) {
  const creee = await e.rpc("parametrage", "creerObligationPropre", [
    {
      tenantId: cabinet.id,
      libelle: LIBELLE_PROPRE,
      periodicite: "mensuelle",
      echeanceJour: 10,
      echeanceMois: null,
      regle: "Le 10 de chaque mois, pour le mois écoulé",
      secteur: "*",
    },
  ]);
  e.verdict("le cabinet crée une obligation propre", Boolean(creee?.id));
  propre = (await e.rpc("parametrage", "calendrierCabinet", [cabinet.id, ANNEE, "*"])).find(
    (o) => o.propre && o.libelle === LIBELLE_PROPRE,
  );
}
e.verdict(
  "l'obligation propre figure au calendrier, comptée sur les mandats",
  Boolean(propre) && propre.mandats >= 1,
  propre?.code ?? "",
);
await e.rpc("collab", "deriverEcheances", [[pmeA.id]]);
const avecPropre = (await e.rpc("collab", "echeances", [[pmeA.id]])).filter(
  (x) => x.kind === propre.code,
);
e.verdict(
  "elle apparaît dans les échéances du dossier, au jour qu'elle dit",
  avecPropre.length > 0 &&
    avecPropre.every(
      (x) => Number(x.dateLegale.slice(8, 10)) === propre.echeanceJour && x.regle === propre.regle,
    ),
  `${avecPropre.length} échéance(s)`,
);

/* ------------------------------------------------------------- rapprochement */
e.section("Le rapprochement bancaire");
const planA = await e.rpc("parametrage", "plan", [pmeA.id, [5]]);
const compteBanque =
  planA.find((c) => c.parent === "532" && !c.collectif) ??
  planA.find((c) => c.code.startsWith("53") && !c.collectif);
e.verdict("le plan livre un compte de banque", Boolean(compteBanque), compteBanque?.code ?? "");
const LABEL_COMPTE = "Épreuve — banque";
let comptes = await e.rpc("banque", "listAccounts", [pmeA.id]);
let compte = comptes.find((c) => c.label === LABEL_COMPTE);
if (!compte) {
  const id = await e.rpc("banque", "createAccount", [
    {
      tenantId: pmeA.id,
      entityId: null,
      label: LABEL_COMPTE,
      iban: null,
      devise: clientA.currency,
      accountCode: compteBanque.code,
    },
  ]);
  comptes = await e.rpc("banque", "listAccounts", [pmeA.id]);
  compte = comptes.find((c) => c.id === id);
}
e.verdict(
  "le compte bancaire du dossier existe",
  Boolean(compte) && compte.accountCode === compteBanque.code,
);

const DATE_RELEVE = `${EXERCICE_PASSE}-03-15`;
const LOT = [
  {
    at: DATE_RELEVE,
    label: "Épreuve — virement reçu",
    montant: "1500.000",
    reference: "EPR-RAP-001",
    idempotencyKey: "epreuve-rap-001",
  },
  {
    at: DATE_RELEVE,
    label: "Épreuve — prélèvement",
    montant: "-250.500",
    reference: "EPR-RAP-002",
    idempotencyKey: "epreuve-rap-002",
  },
];
const importe1 = await e.rpc("banque", "importLines", [
  {
    tenantId: pmeA.id,
    compteId: compte.id,
    batchId: "00000000-0000-4000-8000-0000000e0001",
    lines: LOT,
  },
]);
const importe2 = await e.rpc("banque", "importLines", [
  {
    tenantId: pmeA.id,
    compteId: compte.id,
    batchId: "00000000-0000-4000-8000-0000000e0002",
    lines: LOT,
  },
]);
const lignes = await e.rpc("banque", "lines", [pmeA.id, compte.id]);
const miennes = lignes.filter((l) => LOT.some((x) => x.reference === l.reference));
e.verdict(
  "le même lot importé deux fois n'ajoute rien",
  importe2 === 0 && miennes.length === LOT.length,
  `${importe1} puis ${importe2}`,
);
e.verdict(
  "les montants importés sont relus à l'identique",
  LOT.every((x) =>
    egal(miennes.find((l) => l.reference === x.reference)?.montant ?? "0", x.montant),
  ),
);

// L'écriture à lettrer : une pièce d'épreuve, une écriture comptabilisée sur
// le compte de banque, du même montant, à la même date.
const piece = await e.rpc("capture", "enregistrer", [
  { tenantId: pmeA.id, source: "pdf", vis: "partage", idempotencyKey: "epreuve-rap-piece" },
]);
let ecriture = (await e.rpc("office", "ecrituresForPiece", [piece.id])).find(
  (x) => x.status === "booked",
);
if (!ecriture) {
  const compteVentes = (await e.rpc("parametrage", "plan", [pmeA.id, [7]])).find(
    (c) => !c.collectif && c.code.startsWith("70") && c.code.length >= 3,
  );
  // Une pièce jamais lue n'a pas de type : la personne le donne (une vente
  // encaissée), sinon le verrou R2 refuse l'écriture.
  await e.confirmerLeType(piece.id, "facture_vente");
  const id = await e.rpc("office", "propose", [
    {
      pieceId: piece.id,
      journal: "BQ",
      date: DATE_RELEVE,
      libelle: "Épreuve — encaissement client",
      packVersionId: pack.id,
      devise: clientA.currency,
      lignes: [
        { account_code: compteBanque.code, libelle: "Banque", debit: "1500.000", credit: "0.000" },
        { account_code: compteVentes.code, libelle: "Ventes", debit: "0.000", credit: "1500.000" },
      ],
    },
  ]);
  await e.rpc("office", "book", [id]);
  ecriture = (await e.rpc("office", "ecrituresByIds", [[id]]))[0];
}
e.verdict("une écriture comptabilisée touche le compte de banque", ecriture?.status === "booked");
const livre = await e.rpc("banque", "bookLines", [
  {
    tenantId: pmeA.id,
    accountCode: compteBanque.code,
    from: `${EXERCICE_PASSE}-01-01`,
    to: `${EXERCICE_PASSE}-12-31`,
  },
]);
const enLivre = livre.find((b) => b.id === ecriture.id);
e.verdict(
  "le livre la rend avec le montant du côté banque",
  Boolean(enLivre) && egal(enLivre.montant, "1500.000"),
  enLivre?.montant ?? "absente",
);

const ligneVirement = miennes.find((l) => l.reference === "EPR-RAP-001");
const dejaLettree = (await e.rpc("banque", "etat", [pmeA.id])).find(
  (s) => s.ligneId === ligneVirement.id && s.active,
);
const motifs = await e.rpc("supervision", "motifs", ["fr"]);
const motif = motifs.find((m) => !m.requiresNote) ?? motifs[0];
if (dejaLettree) {
  await e.rpc("banque", "delettrer", [
    { ligneId: ligneVirement.id, motifId: motif.id, note: "Épreuve — rejouée" },
  ]);
}
const lettrage = await e.rpc("banque", "lettrer", [
  {
    ligneId: ligneVirement.id,
    ecritureId: ecriture.id,
    score: 80,
    ecartMontant: texte(millimes(ligneVirement.montant) - millimes(enLivre.montant)),
    ecartJours: 0,
    referenceExacte: false,
    packVersionId: pack.id,
  },
]);
e.verdict("la ligne se lettre à l'écriture", Boolean(lettrage));
const etatApres = await e.rpc("banque", "etat", [pmeA.id]);
e.verdict(
  "l'état du lettrage le dit, sans écart",
  etatApres.some(
    (s) =>
      s.ligneId === ligneVirement.id &&
      s.ecritureId === ecriture.id &&
      s.active &&
      egal(s.ecartMontant, "0.000"),
  ),
);
e.verdict(
  "la ligne est rapprochée",
  (await e.rpc("banque", "lines", [pmeA.id, compte.id])).find((l) => l.id === ligneVirement.id)
    ?.status === "rapprochee",
);
const deuxFois = await e.rpcAttenduEnEchec("banque", "lettrer", [
  {
    ligneId: ligneVirement.id,
    ecritureId: ecriture.id,
    score: 80,
    ecartMontant: "0.000",
    ecartJours: 0,
    referenceExacte: false,
    packVersionId: pack.id,
  },
]);
e.verdict("une ligne déjà lettrée ne se lettre pas deux fois", deuxFois !== null);
const delettrage = await e.rpc("banque", "delettrer", [
  { ligneId: ligneVirement.id, motifId: motif.id, note: "Épreuve — délettrage" },
]);
e.verdict("elle se délettre avec un motif du référentiel", Boolean(delettrage));
e.verdict(
  "délettrée, elle redevient ouverte et le journal garde les deux gestes",
  (await e.rpc("banque", "lines", [pmeA.id, compte.id])).find((l) => l.id === ligneVirement.id)
    ?.status === "ouverte" &&
    (await e.rpc("banque", "lettrages", [pmeA.id]))
      .filter((l) => l.ligneId === ligneVirement.id)
      .some((l) => l.action === "delettre"),
);

/* ------------------------------------------------------------- immobilisations */
e.section("Les immobilisations");
const categories = await e.rpc("immo", "categories", [pack.id]);
e.verdict(
  "le pack livre des catégories d'immobilisation",
  categories.length > 0,
  `${categories.length}`,
);
const VALEUR_BRUTE = "12000.000";
const categorie = categories.find(
  (c) => c.method === "lineaire" && millimes(VALEUR_BRUTE) % BigInt(c.dureeAnnees) === 0n,
);
e.verdict(
  "une catégorie linéaire convient à une valeur exactement divisible",
  Boolean(categorie),
  categorie ? `${categorie.code} · ${categorie.dureeAnnees} ans` : "",
);
const LABEL_BIEN = "Épreuve — bien";
let biens = await e.rpc("immo", "listAssets", [pmeA.id]);
let bien = biens.find((b) => b.label === LABEL_BIEN);
if (!bien) {
  const id = await e.rpc("immo", "createAsset", [
    {
      tenantId: pmeA.id,
      entityId: null,
      categoryId: categorie.id,
      label: LABEL_BIEN,
      miseEnService: `${EXERCICE_PASSE}-01-01`,
      valeurBrute: VALEUR_BRUTE,
      valeurResiduelle: "0.000",
      method: categorie.method,
      dureeAnnees: categorie.dureeAnnees,
      coefficient: categorie.coefficient,
      devise: clientA.currency,
      packVersionId: pack.id,
    },
  ]);
  biens = await e.rpc("immo", "listAssets", [pmeA.id]);
  bien = biens.find((b) => b.id === id);
}
e.verdict(
  "le bien existe, avec la méthode et la durée de sa catégorie",
  Boolean(bien) &&
    bien.method === categorie.method &&
    bien.dureeAnnees === categorie.dureeAnnees &&
    egal(bien.valeurBrute, VALEUR_BRUTE),
);

// Le plan : linéaire, mis en service au 1er janvier — une annuité pleine, exacte.
const annuite = millimes(bien.valeurBrute) / BigInt(bien.dureeAnnees);
const dotationAttendue = texte(annuite);
const vncAttendue = texte(millimes(bien.valeurBrute) - annuite);
let dotations = await e.rpc("immo", "dotations", [pmeA.id, bien.id]);
if (!dotations.some((d) => d.exercice === EXERCICE_PASSE)) {
  const constatee = await e.rpc("immo", "constaterDotation", [
    {
      assetId: bien.id,
      exercice: EXERCICE_PASSE,
      months: 12,
      dotation: dotationAttendue,
      cumul: dotationAttendue,
      vnc: vncAttendue,
      packVersionId: pack.id,
    },
  ]);
  e.verdict(
    "la dotation du premier exercice se constate avec son écriture",
    Boolean(constatee?.dotationId && constatee?.ecritureId),
  );
  dotations = await e.rpc("immo", "dotations", [pmeA.id, bien.id]);
}
const dotation = dotations.find((d) => d.exercice === EXERCICE_PASSE);
e.verdict(
  "la dotation relue vaut valeur brute ÷ durée, la VNC le reste",
  Boolean(dotation) &&
    egal(dotation.dotation, dotationAttendue) &&
    egal(dotation.vnc, vncAttendue) &&
    dotation.ecritureId !== null,
  dotation ? `${dotation.dotation} · VNC ${dotation.vnc}` : "",
);
const ecritureDotation = (await e.rpc("office", "ecrituresByIds", [[dotation.ecritureId]]))[0];
e.verdict(
  "son écriture débite le compte de dotation et crédite l'amortissement",
  ecritureDotation?.status === "booked" &&
    ecritureDotation.lines.some(
      (l) => l.accountCode === categorie.accountDotation && egal(l.debit, dotationAttendue),
    ) &&
    ecritureDotation.lines.some(
      (l) => l.accountCode === categorie.accountAmort && egal(l.credit, dotationAttendue),
    ),
);
const deuxiemeDotation = await e.rpcAttenduEnEchec("immo", "constaterDotation", [
  {
    assetId: bien.id,
    exercice: EXERCICE_PASSE,
    months: 12,
    dotation: dotationAttendue,
    cumul: dotationAttendue,
    vnc: vncAttendue,
    packVersionId: pack.id,
  },
]);
e.verdict("le même exercice ne se constate pas deux fois", deuxiemeDotation !== null);
const modification = await e.rpcAttenduEnEchec("immo", "updateAsset", [
  {
    id: bien.id,
    label: bien.label,
    miseEnService: bien.miseEnService,
    valeurBrute: "13000.000",
    valeurResiduelle: bien.valeurResiduelle,
    method: bien.method,
    dureeAnnees: bien.dureeAnnees,
    coefficient: bien.coefficient,
    status: bien.status,
  },
]);
e.verdict(
  "après constatation, la valeur du bien ne se modifie plus",
  modification !== null,
  modification?.message.slice(0, 80) ?? "",
);
e.verdict(
  "le bien relu n'a pas bougé",
  egal(
    (await e.rpc("immo", "listAssets", [pmeA.id])).find((b) => b.id === bien.id)?.valeurBrute ??
      "0",
    VALEUR_BRUTE,
  ),
);

/* ------------------------------------------------------------- stocks */
e.section("Les stocks");
const params = await e.rpc("referentiel", "socleParams", [pack.id]);
const categoriesStock = await e.rpc("stocks", "categories", [pack.id]);
e.verdict(
  "le pack livre des catégories de stock et une méthode",
  categoriesStock.length > 0 && Boolean(params.stockMethode),
  params.stockMethode,
);
const categorieStock = categoriesStock.find((c) => c.code === "marchandises") ?? categoriesStock[0];
const REFERENCE = "EPR-CUMP";
let articles = await e.rpc("stocks", "listItems", [pmeA.id]);
let article = articles.find((a) => a.reference === REFERENCE);
if (!article) {
  const id = await e.rpc("stocks", "createItem", [
    {
      tenantId: pmeA.id,
      entityId: null,
      categoryId: categorieStock.id,
      reference: REFERENCE,
      designation: "Épreuve — article",
      unite: "u",
      methode: params.stockMethode,
      accountStock: categorieStock.accountStock,
      accountVariation: categorieStock.accountVariation,
      devise: clientA.currency,
      packVersionId: pack.id,
    },
  ]);
  articles = await e.rpc("stocks", "listItems", [pmeA.id]);
  article = articles.find((a) => a.id === id);
}
e.verdict(
  "l'article existe, aux comptes de sa catégorie",
  Boolean(article) && article.accountStock === categorieStock.accountStock,
);
const MOUVEMENTS = [
  {
    sens: "entree",
    at: `${EXERCICE_PASSE}-02-01`,
    quantite: "10.000",
    coutUnitaire: "5.000",
    reference: "EPR-MVT-1",
  },
  {
    sens: "entree",
    at: `${EXERCICE_PASSE}-02-10`,
    quantite: "10.000",
    coutUnitaire: "7.000",
    reference: "EPR-MVT-2",
  },
  {
    sens: "sortie",
    at: `${EXERCICE_PASSE}-02-20`,
    quantite: "5.000",
    coutUnitaire: null,
    reference: "EPR-MVT-3",
  },
];
let mouvements = await e.rpc("stocks", "mouvements", [pmeA.id, article.id]);
for (const m of MOUVEMENTS) {
  if (!mouvements.some((x) => x.reference === m.reference)) {
    await e.rpc("stocks", "addMouvement", [{ tenantId: pmeA.id, itemId: article.id, ...m }]);
  }
}
mouvements = await e.rpc("stocks", "mouvements", [pmeA.id, article.id]);
e.verdict(
  "les trois mouvements sont là, et une seule fois chacun",
  MOUVEMENTS.every((m) => mouvements.filter((x) => x.reference === m.reference).length === 1),
);
// Le CUMP, en millimes entiers : (10 × 5,000 + 10 × 7,000) ÷ 20.
let quantite = 0n;
let valeur = 0n;
for (const m of [...mouvements].sort((a, b) => a.at.localeCompare(b.at))) {
  const q = millimes(m.quantite);
  if (m.sens === "entree") {
    quantite += q;
    valeur += (q * millimes(m.coutUnitaire)) / 1000n;
  } else {
    const cump = valeur / quantite;
    valeur -= (q * cump) / 1n;
    valeur = (quantite - q) * cump;
    quantite -= q;
  }
}
const cump = (valeur * 1000n) / quantite;
e.verdict(
  "le coût unitaire moyen pondéré tombe juste",
  texte(cump) === "6.000" && texte(quantite) === "15.000" && texte(valeur) === "90.000",
  `${texte(quantite)} u à ${texte(cump)} = ${texte(valeur)}`,
);
const PERIODE = `${EXERCICE_PASSE}-02`;
let inventaires = await e.rpc("stocks", "inventaires", [pmeA.id, article.id]);
if (!inventaires.some((i) => i.period === PERIODE)) {
  const constate = await e.rpc("stocks", "constaterInventaire", [
    {
      itemId: article.id,
      period: PERIODE,
      initial: "0.000",
      final: texte(valeur),
      variation: texte(valeur),
      packVersionId: pack.id,
      date: `${EXERCICE_PASSE}-02-28`,
    },
  ]);
  e.verdict(
    "l'inventaire de la période se constate avec son écriture",
    Boolean(constate?.inventaireId && constate?.ecritureId),
  );
  inventaires = await e.rpc("stocks", "inventaires", [pmeA.id, article.id]);
}
const inventaire = inventaires.find((i) => i.period === PERIODE);
e.verdict(
  "l'inventaire relu porte la variation constatée",
  Boolean(inventaire) &&
    egal(inventaire.variation, texte(valeur)) &&
    inventaire.ecritureId !== null,
);
const ecritureStock = (await e.rpc("office", "ecrituresByIds", [[inventaire.ecritureId]]))[0];
e.verdict(
  "son écriture débite le stock et crédite la variation",
  ecritureStock?.status === "booked" &&
    ecritureStock.lines.some(
      (l) => l.accountCode === categorieStock.accountStock && egal(l.debit, texte(valeur)),
    ) &&
    ecritureStock.lines.some(
      (l) => l.accountCode === categorieStock.accountVariation && egal(l.credit, texte(valeur)),
    ),
);
const deuxiemeInventaire = await e.rpcAttenduEnEchec("stocks", "constaterInventaire", [
  {
    itemId: article.id,
    period: PERIODE,
    initial: "0.000",
    final: texte(valeur),
    variation: texte(valeur),
    packVersionId: pack.id,
    date: `${EXERCICE_PASSE}-02-28`,
  },
]);
e.verdict("la même période ne se constate pas deux fois", deuxiemeInventaire !== null);

/* ------------------------------------------------------------- plan comptable */
e.section("Le plan comptable, les rôles, les tiers");
const plan = await e.rpc("parametrage", "plan", [cabinet.id, null]);
e.verdict("le plan livré se lit", plan.length > 100, `${plan.length} comptes`);
const codes = new Set(plan.map((c) => c.code));
const parent =
  plan.find((c) => c.officiel && !c.collectif && String(c.classe) === "6" && c.code.length === 3) ??
  plan.find((c) => c.officiel && !c.collectif);
const codeLibre = [`${parent.code}9`, `${parent.code}99`, `${parent.code}999`].find(
  (c) => !codes.has(c),
);
const LIBELLE_COMPTE = "Épreuve — sous-compte";
const existant = plan.find((c) => c.code === codeLibre && !c.officiel);
if (existant) await e.rpc("parametrage", "fermerCompte", [cabinet.id, codeLibre]);
const ouvert = await e.rpc("parametrage", "ouvrirCompte", [
  {
    tenantId: cabinet.id,
    code: codeLibre,
    libelle: LIBELLE_COMPTE,
    parent: parent.code,
    motif: "Épreuve",
  },
]);
const planApres = await e.rpc("parametrage", "plan", [cabinet.id, null]);
const sousCompte = planApres.find((c) => c.code === codeLibre);
e.verdict(
  "un sous-compte s'ouvre sous un compte du pack, à la classe de son parent",
  Boolean(ouvert) &&
    sousCompte?.officiel === false &&
    String(sousCompte.classe) === String(parent.classe) &&
    sousCompte.parent === parent.code,
  `${codeLibre} sous ${parent.code}`,
);
const collectif = plan.find((c) => c.collectif);
const refusCollectif = await e.rpcAttenduEnEchec("parametrage", "ouvrirCompte", [
  {
    tenantId: cabinet.id,
    code: `${collectif.code}9`,
    libelle: "Épreuve — refusé",
    parent: collectif.code,
  },
]);
e.verdict(
  "un sous-compte sous un collectif est refusé",
  refusCollectif !== null,
  refusCollectif?.message.slice(0, 70) ?? "",
);
const refusDoublon = await e.rpcAttenduEnEchec("parametrage", "ouvrirCompte", [
  {
    tenantId: cabinet.id,
    code: parent.code,
    libelle: "Épreuve — doublon",
    parent: parent.parent ?? parent.code,
  },
]);
e.verdict("un compte déjà livré ne se rouvre pas", refusDoublon !== null);
await e.rpc("parametrage", "fermerCompte", [cabinet.id, codeLibre]);
e.verdict(
  "fermé, le sous-compte disparaît du plan",
  !(await e.rpc("parametrage", "plan", [cabinet.id, null])).some((c) => c.code === codeLibre),
);

const roles = await e.rpc("parametrage", "roles", [cabinet.id, null]);
e.verdict(
  "les rôles comptables se lisent avec leur origine",
  roles.length > 0 && roles.every((r) => r.origine),
  `${roles.length} rôles`,
);
const role = roles.find((r) => r.origine === "pack" && r.defautDuPack);
await e.rpc("parametrage", "definirLiaison", [
  {
    tenantId: cabinet.id,
    portee: "cabinet",
    porteeId: cabinet.id,
    roleCode: role.code,
    compte: role.defautDuPack,
    motif: "Épreuve",
  },
]);
const roleArrete = (await e.rpc("parametrage", "roles", [cabinet.id, null])).find(
  (r) => r.code === role.code,
);
e.verdict(
  "le cabinet arrête un rôle : l'origine devient la sienne",
  roleArrete?.origine === "cabinet" && roleArrete.compte === role.defautDuPack,
  role.code,
);
const classeInterdite = plan.find(
  (c) => !role.classesAdmises.includes(Number(c.classe)) && c.officiel,
);
const refusClasse = await e.rpcAttenduEnEchec("parametrage", "definirLiaison", [
  {
    tenantId: cabinet.id,
    portee: "cabinet",
    porteeId: cabinet.id,
    roleCode: role.code,
    compte: classeInterdite.code,
  },
]);
e.verdict("un compte d'une classe que le rôle n'admet pas est refusé", refusClasse !== null);
await e.rpc("parametrage", "rendreAuPack", [
  { tenantId: cabinet.id, portee: "cabinet", porteeId: cabinet.id, roleCode: role.code },
]);
e.verdict(
  "rendu au pack, le rôle reprend le défaut livré",
  (await e.rpc("parametrage", "roles", [cabinet.id, null])).find((r) => r.code === role.code)
    ?.origine === "pack",
);

const collectifs = await e.rpc("tiers", "comptesCollectifs");
e.verdict("les comptes collectifs se lisent", collectifs.length > 0);
const collectifClient =
  collectifs.find((c) => c.code === "411") ?? collectifs.find((c) => c.classe === "4");
const CODE_TIERS = "EPR-CLI";
let tiersA = await e.rpc("tiers", "lister", [pmeA.id, null]);
let tiers = tiersA.find((x) => x.code === CODE_TIERS);
if (!tiers) {
  const id = await e.rpc("tiers", "creer", [
    {
      tenantId: pmeA.id,
      nature: "client",
      code: CODE_TIERS,
      raisonSociale: "Épreuve — client",
      compteCollectif: collectifClient.code,
    },
  ]);
  tiersA = await e.rpc("tiers", "lister", [pmeA.id, null]);
  tiers = tiersA.find((x) => x.id === id);
}
e.verdict(
  "un tiers s'ouvre sous un collectif du dossier",
  Boolean(tiers) && tiers.compteCollectif === collectifClient.code,
);
await e.rpc("tiers", "modifier", [
  {
    id: tiers.id,
    raisonSociale: "Épreuve — client (relu)",
    compteCollectif: collectifClient.code,
    note: "Épreuve",
  },
]);
e.verdict(
  "il se modifie, filtré par nature",
  (await e.rpc("tiers", "lister", [pmeA.id, "client"])).find((x) => x.id === tiers.id)
    ?.raisonSociale === "Épreuve — client (relu)",
);
await e.rpc("tiers", "desactiver", [tiers.id, false]);
const inactif = (await e.rpc("tiers", "lister", [pmeA.id, null])).find((x) => x.id === tiers.id);
await e.rpc("tiers", "desactiver", [tiers.id, true]);
e.verdict("il se désactive sans disparaître, puis se réactive", inactif?.actif === false);
const refusNonCollectif = await e.rpcAttenduEnEchec("tiers", "creer", [
  {
    tenantId: pmeA.id,
    nature: "client",
    code: "EPR-REFUS",
    raisonSociale: "Épreuve — refusé",
    compteCollectif: parent.code,
  },
]);
e.verdict("un tiers sous un compte qui n'est pas collectif est refusé", refusNonCollectif !== null);

/* ------------------------------------------------------------- la synthèse */
e.section("La synthèse du dossier");
const journal = await e.rpc("supervision", "journalDuMandat", [pmeA.id, 200]);
const actions = new Set(journal.map((j) => j.action));
e.verdict(
  "le journal du mandat rassemble les gestes de l'épreuve",
  [
    "echeance.faite",
    "echeance.rouverte",
    "banque.lettre",
    "immo.dotation_constatee",
    "stock.inventaire_constate",
  ].every((a) => actions.has(a)),
  [...actions].sort().join(" "),
);
const lignesPeriode = await e.rpc("office", "periodeLignes", [
  pmeA.id,
  `${EXERCICE_PASSE}-01-01`,
  `${EXERCICE_PASSE}-12-31`,
]);
e.verdict(
  "les lignes de période portent la dotation et la variation de stock",
  lignesPeriode.some(
    (l) => l.accountCode === categorie.accountDotation && egal(l.debit, dotationAttendue),
  ) &&
    lignesPeriode.some(
      (l) => l.accountCode === categorieStock.accountVariation && egal(l.credit, texte(valeur)),
    ),
  `${lignesPeriode.length} ligne(s)`,
);
const extraits = await e.rpc("office", "bookedExtracts", [
  pmeA.id,
  `${EXERCICE_PASSE}-01-01`,
  `${EXERCICE_PASSE}-12-31`,
]);
e.verdict(
  "les extraits comptabilisés se lisent (sans pièce lue, ils sont vides)",
  Array.isArray(extraits),
  `${extraits.length}`,
);
e.verdict(
  "le dossier sans fiche n'a ni échéance ni ligne",
  (await e.rpc("collab", "echeances", [[pmeB.id]])).length === 0 &&
    (await e.rpc("office", "periodeLignes", [pmeB.id, `${EXERCICE_PASSE}-01-01`, AUJOURDHUI]))
      .length === 0,
);

e.conclure();
