/**
 * Épreuve — les honoraires du cabinet, de bout en bout, comme l'écran les joue.
 *
 *   node outils/epreuves/honoraires.mjs [http://localhost:8080]
 *
 * Un mandat se définit, se redéfinit (l'ancien reste) ; un brouillon se crée,
 * se modifie, s'émet avec son numéro et son échéance ; émis, il ne bouge plus
 * (R7) ; il s'encaisse en deux fois jusqu'à « réglée », s'annule par un avoir ;
 * la synthèse du mois reflète exactement ces mouvements. Les totaux sont
 * recalculés ici en entiers (BigInt), jamais en flottant, et comparés à ce que
 * la base a posé.
 *
 * Rejouable : le client de l'épreuve porte une identité fixe et ce qui existe
 * est repris. Une facture émise ne s'efface pas (R7) : chaque passage en
 * laisse une, réglée puis annulée par son avoir.
 */
import { COMPTE_DEV, creerEpreuve } from "./socle.mjs";

const e = creerEpreuve("les honoraires du cabinet", process.argv[2]);

const DIRIGEANT = { email: "epreuve.dirigeant@malica.local", motDePasse: "EpreuveMalica2026!" };
const PME = { name: "ÉPREUVE ATELIER SARL", legalId: "9999999/E/P/000" };
const COUVERTURE = ["Tenue comptable", "Déclarations de TVA"];

/* ------------------------------------------------ l'arithmétique exacte */
/** « 1576.25 » → 1576250n pour trois décimales. Refuse ce qui n'est pas un nombre. */
function enUnites(valeur, decimales) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(valeur).trim());
  if (!m) throw new Error(`montant illisible : ${valeur}`);
  const fraction = (m[3] ?? "").padEnd(decimales, "0").slice(0, decimales);
  return (m[1] === "-" ? -1n : 1n) * BigInt(m[2] + fraction);
}
function depuisUnites(unites, decimales) {
  const negatif = unites < 0n;
  const abs = (negatif ? -unites : unites).toString().padStart(decimales + 1, "0");
  const entier = abs.slice(0, abs.length - decimales);
  return `${negatif ? "-" : ""}${entier}.${abs.slice(abs.length - decimales)}`;
}
/** Division entière arrondie à la moitié loin de zéro — la règle de `round()` en base. */
function arrondi(numerateur, denominateur) {
  const negatif = numerateur < 0n;
  const abs = negatif ? -numerateur : numerateur;
  const q = (2n * abs + denominateur) / (2n * denominateur);
  return negatif ? -q : q;
}
const M = (s) => enUnites(s, 3);
const millimes = (n) => depuisUnites(n, 3);
const memeMontant = (a, b) => M(a) === M(b);
/** Le motif écrit par la base, tel que l'écran l'affiche — sans le transport. */
function motif(erreur) {
  const m = /\{.*\}$/s.exec(erreur?.message ?? "");
  try {
    return m ? String(JSON.parse(m[0]).erreur ?? "") : (erreur?.message ?? "");
  } catch {
    return erreur?.message ?? "";
  }
}

/**
 * Les totaux tels que la base doit les poser : HT = Σ round(q × pu, 3) ;
 * TVA = round(HT × taux, 3) ; droits = ceux du pack ; TTC = HT + TVA + droits.
 */
function totauxAttendus(lignes, taux, droits) {
  const ht = lignes.reduce((acc, l) => acc + arrondi(M(l.quantite) * M(l.prixUnitaire), 1000n), 0n);
  const tva = arrondi(ht * enUnites(taux, 6), 1_000_000n);
  return { ht, tva, droits, ttc: ht + tva + droits };
}

/* ------------------------------------------------ les dates */
const aujourdhui = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const MOIS = aujourdhui.slice(0, 7);
function plusJours(iso, jours) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
/** Le prochain « jour J » du mois, à partir d'aujourd'hui et de l'ouverture du mandat. */
function prochaineMensuelle(jour, validFrom) {
  let [a, m] = aujourdhui.split("-").map(Number);
  for (let i = 0; i < 14; i += 1) {
    const cand = `${a}-${String(m).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
    if (cand >= aujourdhui && cand >= validFrom) return cand;
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return null;
}

/* ------------------------------------------------ le cabinet et son client */
e.section("Le cabinet et le client de l'épreuve");
await e.connecter(COMPTE_DEV);
const orgs = await e.rpc("identite", "listMyOrganizations");
const cabinet = orgs.find((o) => o.kind === "cabinet");
e.verdict("le compte de développement a un cabinet", Boolean(cabinet), cabinet?.name ?? "");
if (!cabinet) e.conclure();

async function clientDeLEpreuve() {
  const clients = await e.rpc("supervision", "listClients", [cabinet.id]);
  return clients.find((c) => c.legalId === PME.legalId && c.engagementStatus === "actif") ?? null;
}
let client = await clientDeLEpreuve();
if (!client) {
  // Première fois : la PME et son mandat se créent comme dans l'épreuve des mandats.
  await e.inscrireOuConnecter(DIRIGEANT, "Épreuve Dirigeant");
  let pme = (await e.rpc("identite", "listMyOrganizations")).find((o) => o.legalId === PME.legalId);
  if (!pme) {
    const pack = await e.rpc("referentiel", "activePack", ["TN"]);
    const id = await e.rpc("identite", "createOrganization", [
      {
        kind: "pme",
        name: PME.name,
        legalId: PME.legalId,
        jurisdiction: "TN",
        currency: pack.currency ?? "TND",
      },
    ]);
    pme = (await e.rpc("identite", "listMyOrganizations")).find((o) => o.id === id);
  }
  await e.connecter(COMPTE_DEV);
  const proposition = await e.rpc("identite", "proposerMandat", [cabinet.id, PME.legalId]);
  if (proposition.status === "propose") {
    await e.connecter(DIRIGEANT);
    await e.rpc("identite", "repondreAuMandat", [proposition.id, true]);
    await e.connecter(COMPTE_DEV);
  }
  client = await clientDeLEpreuve();
}
e.verdict(
  "le client de l'épreuve est mandaté auprès du cabinet",
  Boolean(client),
  client?.name ?? "",
);
if (!client) e.conclure();

/* ------------------------------------------------ le pack : taux et droits */
const pack = await e.rpc("referentiel", "activePack", [cabinet.jurisdiction]);
e.verdict(
  "un pack de juridiction est en vigueur pour le cabinet",
  Boolean(pack?.id),
  pack?.version ?? "",
);
if (!pack) e.conclure();
const tauxDuPack = (await e.rpc("referentiel", "taxRates", [pack.id, cabinet.jurisdiction])).filter(
  (r) => r.validFrom <= aujourdhui && (!r.validTo || r.validTo >= aujourdhui),
);
// Le taux le plus élevé en vigueur : c'est celui qui fait travailler l'arrondi.
const tauxChoisi = [...tauxDuPack].sort((a, b) =>
  Number(enUnites(b.rate, 6) - enUnites(a.rate, 6)),
)[0];
e.verdict(
  "le pack porte au moins un taux de TVA en vigueur",
  Boolean(tauxChoisi),
  tauxChoisi?.code ?? "",
);
if (!tauxChoisi) e.conclure();
const droitsDuPack = (await e.rpc("referentiel", "fiscalCharges", [pack.id])).filter(
  (c) => c.documentKind === "facture_vente" && c.fixedAmount !== null,
);
const droits = droitsDuPack.reduce((acc, c) => acc + M(c.fixedAmount), 0n);
const droitsLibelle = droitsDuPack.length
  ? droitsDuPack
      .map((c) => c.label)
      .sort((a, b) => a.localeCompare(b))
      .join(", ")
  : null;

const syntheseAvant = await e.rpc("honoraires", "synthese", [cabinet.id, MOIS]);

/* ------------------------------------------------ le mandat */
e.section("Le mandat d'honoraires");
const mandatsAvant = await e.rpc("honoraires", "mandats", [cabinet.id]);
e.verdict(
  "les mandats se lisent, un seul ouvert par client",
  new Set(mandatsAvant.map((m) => m.clientTenantId)).size === mandatsAvant.length,
  `${mandatsAvant.length} ouvert(s)`,
);
const MANDAT_A = {
  mode: "mixte",
  frequence: "mensuelle",
  jourFacturation: 5,
  forfait: "1200",
  tauxHoraire: "150",
  delaiPaiementJours: 30,
};
const defA = await e.rpc("honoraires", "definirMandat", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: client.tenantId,
    ...MANDAT_A,
    couverture: [...COUVERTURE, "  "],
  },
]);
e.verdict("le mandat se définit", Boolean(defA?.id));
let mandats = await e.rpc("honoraires", "mandats", [cabinet.id]);
let mandatA = mandats.find((m) => m.id === defA.id) ?? null;
e.verdict(
  "il est le seul mandat ouvert du client, avec ses valeurs",
  mandats.filter((m) => m.clientTenantId === client.tenantId).length === 1 &&
    mandatA?.mode === "mixte" &&
    mandatA.frequence === "mensuelle" &&
    mandatA.jourFacturation === 5 &&
    memeMontant(mandatA.forfait, "1200") &&
    memeMontant(mandatA.tauxHoraire, "150") &&
    mandatA.delaiPaiementJours === 30 &&
    mandatA.clientName === client.name,
  mandatA ? `${mandatA.mode} · ${mandatA.forfait} · ${mandatA.tauxHoraire}` : "absent",
);
e.verdict(
  "la couverture est reprise, nettoyée des blancs",
  JSON.stringify(mandatA?.couverture) === JSON.stringify(COUVERTURE),
  JSON.stringify(mandatA?.couverture),
);
e.verdict(
  "la prochaine facturation est dérivée en base du jour et de la fréquence",
  mandatA?.prochaine === prochaineMensuelle(5, mandatA?.validFrom ?? aujourdhui),
  `${mandatA?.prochaine} (attendu ${prochaineMensuelle(5, mandatA?.validFrom ?? aujourdhui)})`,
);
const refusModeSansBareme = await e.rpcAttenduEnEchec("honoraires", "definirMandat", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: client.tenantId,
    mode: "forfait",
    frequence: "mensuelle",
    jourFacturation: 1,
    forfait: null,
    tauxHoraire: null,
    delaiPaiementJours: 30,
    couverture: [],
  },
]);
e.verdict("un forfait sans montant ne se définit pas", refusModeSansBareme !== null);
mandats = await e.rpc("honoraires", "mandats", [cabinet.id]);
e.verdict(
  "le refus n'a pas clos le mandat en place",
  mandats.some((m) => m.id === defA.id),
);

/* ------------------------------------------------ le brouillon */
e.section("Le brouillon et ses totaux");
const LIGNES_1 = [
  { libelle: "Forfait d'honoraires — épreuve", quantite: "1", prixUnitaire: "1200" },
  { libelle: "Heures de conseil", quantite: "2.5", prixUnitaire: "150.5" },
];
const brouillon = await e.rpc("honoraires", "creerBrouillon", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: client.tenantId,
    periodeDu: `${MOIS}-01`,
    periodeAu: `${MOIS}-28`,
    tauxTvaCode: tauxChoisi.code,
    lignes: LIGNES_1,
  },
]);
e.verdict("le brouillon se crée", Boolean(brouillon?.id));
let f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "il est un brouillon sans numéro, rattaché au mandat ouvert et au client",
  f?.statut === "brouillon" &&
    f.numero === null &&
    f.emiseLe === null &&
    f.mandatId === defA.id &&
    f.clientTenantId === client.tenantId &&
    f.client.name === client.name &&
    f.cabinet.name === cabinet.name,
);
e.verdict(
  "le taux du pack est photographié sur la facture, avec sa devise",
  f?.tauxTvaCode === tauxChoisi.code &&
    enUnites(f.tauxTva, 6) === enUnites(tauxChoisi.rate, 6) &&
    f.devise === cabinet.currency,
  `${f?.tauxTvaCode} = ${f?.tauxTva}`,
);
let attendu = totauxAttendus(LIGNES_1, tauxChoisi.rate, droits);
e.verdict(
  "chaque ligne porte son montant HT calculé en base",
  f?.lignes.length === 2 &&
    f.lignes.every(
      (l, i) =>
        l.ordre === i + 1 &&
        l.libelle === LIGNES_1[i].libelle &&
        M(l.montantHt) === arrondi(M(l.quantite) * M(l.prixUnitaire), 1000n),
    ),
  f?.lignes.map((l) => l.montantHt).join(" + "),
);
e.verdict(
  "HT, TVA, droits et TTC sont ceux du calcul exact",
  M(f.totalHt) === attendu.ht &&
    M(f.totalTva) === attendu.tva &&
    M(f.droitsFixes) === attendu.droits &&
    M(f.totalTtc) === attendu.ttc,
  `${f.totalHt} / ${f.totalTva} / ${f.droitsFixes} / ${f.totalTtc} (attendu ${millimes(attendu.ht)} / ${millimes(attendu.tva)} / ${millimes(attendu.droits)} / ${millimes(attendu.ttc)})`,
);
e.verdict(
  "les droits fixes portent le nom que le pack leur donne",
  f.droitsLibelle === droitsLibelle,
  f.droitsLibelle ?? "aucun",
);
e.verdict(
  "les mentions exigées par le pack accompagnent la facture",
  Array.isArray(f.mentions) && f.mentions.every((m) => m.code && m.label),
  `${f.mentions.length} mention(s)`,
);
const refusTauxInconnu = await e.rpcAttenduEnEchec("honoraires", "modifierBrouillon", [
  {
    id: brouillon.id,
    periodeDu: f.periodeDu,
    periodeAu: f.periodeAu,
    tauxTvaCode: "TAUX-INEXISTANT",
    lignes: LIGNES_1,
  },
]);
e.verdict("un taux absent du pack est refusé", refusTauxInconnu !== null);

/* ------------------------------------------------ redéfinir : l'ancien reste */
e.section("Redéfinir le mandat : on clôt, on rouvre, l'ancien reste");
const MANDAT_B = {
  mode: "forfait",
  frequence: "trimestrielle",
  jourFacturation: 10,
  forfait: "1300.5",
  tauxHoraire: null,
  delaiPaiementJours: 45,
};
const defB = await e.rpc("honoraires", "definirMandat", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: client.tenantId,
    ...MANDAT_B,
    couverture: COUVERTURE,
  },
]);
mandats = await e.rpc("honoraires", "mandats", [cabinet.id]);
const mandatB = mandats.find((m) => m.id === defB.id) ?? null;
e.verdict(
  "le nouveau mandat remplace l'ancien parmi les ouverts, avec ses valeurs",
  defB.id !== defA.id &&
    !mandats.some((m) => m.id === defA.id) &&
    mandats.filter((m) => m.clientTenantId === client.tenantId).length === 1 &&
    mandatB?.mode === "forfait" &&
    mandatB.frequence === "trimestrielle" &&
    mandatB.jourFacturation === 10 &&
    memeMontant(mandatB.forfait, "1300.5") &&
    mandatB.tauxHoraire === null &&
    mandatB.delaiPaiementJours === 45,
);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "l'ancien mandat reste : le brouillon le lit encore, avec son délai",
  f.mandatId === defA.id &&
    f.mandat?.mode === "mixte" &&
    f.mandat.delaiPaiementJours === 30 &&
    memeMontant(f.mandat.forfait, "1200"),
  f.mandat ? `délai ${f.mandat.delaiPaiementJours} j` : "mandat absent",
);

/* ------------------------------------------------ modifier le brouillon */
e.section("Modifier le brouillon");
const LIGNES_2 = [
  { libelle: "Forfait d'honoraires — épreuve", quantite: "1", prixUnitaire: "1000.5" },
  { libelle: "Heures de conseil", quantite: "3", prixUnitaire: "150" },
  { libelle: "Déplacement", quantite: "1", prixUnitaire: "0.333" },
  { libelle: "   ", quantite: "9", prixUnitaire: "9" },
];
await e.rpc("honoraires", "modifierBrouillon", [
  {
    id: brouillon.id,
    periodeDu: `${MOIS}-01`,
    periodeAu: `${MOIS}-27`,
    tauxTvaCode: tauxChoisi.code,
    lignes: LIGNES_2,
  },
]);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
const LIGNES_2_UTILES = LIGNES_2.filter((l) => l.libelle.trim() !== "");
attendu = totauxAttendus(LIGNES_2_UTILES, tauxChoisi.rate, droits);
e.verdict(
  "les lignes sont remplacées, la ligne sans libellé écartée, la période reprise",
  f.lignes.length === 3 &&
    f.lignes.every((l, i) => l.ordre === i + 1 && l.libelle === LIGNES_2_UTILES[i].libelle) &&
    f.periodeAu === `${MOIS}-27`,
);
e.verdict(
  "les totaux sont recalculés en base après modification",
  M(f.totalHt) === attendu.ht && M(f.totalTva) === attendu.tva && M(f.totalTtc) === attendu.ttc,
  `${f.totalHt} / ${f.totalTva} / ${f.totalTtc} (attendu ${millimes(attendu.ht)} / ${millimes(attendu.tva)} / ${millimes(attendu.ttc)})`,
);
const totalTtc = f.totalTtc;

/* ------------------------------------------------ un brouillon vide */
e.section("Un brouillon sans ligne");
const vide = await e.rpc("honoraires", "creerBrouillon", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: client.tenantId,
    periodeDu: `${MOIS}-01`,
    periodeAu: `${MOIS}-28`,
    tauxTvaCode: tauxChoisi.code,
    lignes: [],
  },
]);
const fVide = await e.rpc("honoraires", "facture", [vide.id]);
e.verdict(
  "un brouillon sans ligne existe, à zéro",
  fVide?.lignes.length === 0 && M(fVide.totalTtc) === attendu.droits,
);
const refusVide = await e.rpcAttenduEnEchec("honoraires", "emettre", [vide.id]);
e.verdict("il ne s'émet pas", refusVide !== null, motif(refusVide));

/* ------------------------------------------------ émettre */
e.section("Émettre : numéro, échéance, gel (R7)");
const numerosAvant = new Set(
  (await e.rpc("honoraires", "factures", [cabinet.id])).map((x) => x.numero).filter(Boolean),
);
const emission = await e.rpc("honoraires", "emettre", [brouillon.id]);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "la facture prend un numéro H-AAAA-NNNN de l'année d'émission, jamais attribué",
  /^H-\d{4}-\d{4}$/.test(emission?.numero ?? "") &&
    f.numero === emission.numero &&
    emission.numero.slice(2, 6) === f.emiseLe.slice(0, 4) &&
    !numerosAvant.has(emission.numero),
  emission?.numero ?? "",
);
e.verdict("elle est émise ce jour", f.statut === "emise" && f.emiseLe === aujourdhui, f.emiseLe);
e.verdict(
  "l'échéance vaut émission + délai du mandat qu'elle porte",
  f.echeanceLe === plusJours(f.emiseLe, f.mandat.delaiPaiementJours),
  `${f.echeanceLe} = ${f.emiseLe} + ${f.mandat.delaiPaiementJours} j`,
);
const refusDeuxieme = await e.rpcAttenduEnEchec("honoraires", "emettre", [brouillon.id]);
e.verdict("une facture émise ne s'émet pas deux fois", refusDeuxieme !== null);
const refusModif = await e.rpcAttenduEnEchec("honoraires", "modifierBrouillon", [
  {
    id: brouillon.id,
    periodeDu: f.periodeDu,
    periodeAu: f.periodeAu,
    tauxTvaCode: tauxChoisi.code,
    lignes: LIGNES_1,
  },
]);
e.verdict("R7 : elle ne se modifie plus", refusModif !== null);
const refusSuppr = await e.rpcAttenduEnEchec("honoraires", "supprimerBrouillon", [brouillon.id]);
e.verdict("R7 : elle ne se supprime pas", refusSuppr !== null);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "rien n'a bougé après ces refus",
  f.lignes.length === 3 && memeMontant(f.totalTtc, totalTtc) && f.statut === "emise",
);
const listeDuMois = await e.rpc("honoraires", "factures", [cabinet.id, { mois: MOIS }]);
e.verdict(
  "elle figure dans les factures du mois, avec son client",
  listeDuMois.some((x) => x.id === brouillon.id && x.clientName === client.name),
);
const listeEmises = await e.rpc("honoraires", "factures", [
  cabinet.id,
  { statut: "emise", clientTenantId: client.tenantId },
]);
e.verdict(
  "le filtre par état et par client la retrouve",
  listeEmises.some((x) => x.id === brouillon.id) &&
    listeEmises.every((x) => x.statut === "emise" && x.clientTenantId === client.tenantId),
);

/* ------------------------------------------------ encaisser */
e.section("Encaisser en deux fois");
const refusZero = await e.rpcAttenduEnEchec("honoraires", "encaisser", [
  {
    factureId: brouillon.id,
    montant: "0",
    encaisseLe: aujourdhui,
    moyen: "virement",
    reference: null,
  },
]);
e.verdict("un encaissement nul est refusé", refusZero !== null);
const tropPercu = millimes(M(totalTtc) + 1n);
const refusTrop = await e.rpcAttenduEnEchec("honoraires", "encaisser", [
  {
    factureId: brouillon.id,
    montant: tropPercu,
    encaisseLe: aujourdhui,
    moyen: "virement",
    reference: null,
  },
]);
e.verdict("un encaissement supérieur au reste dû est refusé", refusTrop !== null, motif(refusTrop));
const ACOMPTE = "1000";
const enc1 = await e.rpc("honoraires", "encaisser", [
  {
    factureId: brouillon.id,
    montant: ACOMPTE,
    encaisseLe: aujourdhui,
    moyen: "virement",
    reference: "  V-EPREUVE-1  ",
  },
]);
e.verdict(
  "un acompte s'enregistre sans solder",
  enc1?.id && memeMontant(enc1.encaisse, ACOMPTE) && enc1.soldee === false,
  enc1?.encaisse,
);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "la facture reste émise, l'encaissé sommé en base, la référence nettoyée",
  f.statut === "emise" &&
    memeMontant(f.encaisse, ACOMPTE) &&
    f.encaissements.length === 1 &&
    f.encaissements[0].reference === "V-EPREUVE-1" &&
    f.encaissements[0].moyen === "virement",
);
const solde = millimes(M(totalTtc) - M(ACOMPTE));
const refusTropApres = await e.rpcAttenduEnEchec("honoraires", "encaisser", [
  {
    factureId: brouillon.id,
    montant: millimes(M(solde) + 1n),
    encaisseLe: aujourdhui,
    moyen: "cheque",
    reference: null,
  },
]);
e.verdict("le reste dû tient compte de l'acompte", refusTropApres !== null);
const enc2 = await e.rpc("honoraires", "encaisser", [
  {
    factureId: brouillon.id,
    montant: solde,
    encaisseLe: aujourdhui,
    moyen: "cheque",
    reference: "",
  },
]);
e.verdict(
  "le solde règle la facture",
  enc2?.soldee === true && memeMontant(enc2.encaisse, totalTtc),
  enc2?.encaisse,
);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "elle est réglée ce jour, avec deux encaissements et une référence vide rendue nulle",
  f.statut === "payee" &&
    f.payeeLe === aujourdhui &&
    f.encaissements.length === 2 &&
    f.encaissements[1].reference === null,
);
const refusPayee = await e.rpcAttenduEnEchec("honoraires", "encaisser", [
  {
    factureId: brouillon.id,
    montant: "1",
    encaisseLe: aujourdhui,
    moyen: "especes",
    reference: null,
  },
]);
e.verdict("une facture réglée ne s'encaisse plus", refusPayee !== null);
const encDuMois = await e.rpc("honoraires", "encaissements", [cabinet.id, MOIS]);
e.verdict(
  "les encaissements du mois portent les deux, avec le numéro et le client",
  [enc1.id, enc2.id].every((id) =>
    encDuMois.some(
      (x) =>
        x.id === id &&
        x.numero === emission.numero &&
        x.clientName === client.name &&
        x.factureId === brouillon.id,
    ),
  ),
);
// Avant l'avoir, le mois a facturé et encaissé : le taux d'encaissement se lit.
const sReglee = await e.rpc("honoraires", "synthese", [cabinet.id, MOIS]);
const ecart = (apres, avant) => M(apres) - M(avant);
e.verdict(
  "la synthèse compte la facture émise et réglée",
  ecart(sReglee.factureTtc, syntheseAvant.factureTtc) === M(totalTtc) &&
    sReglee.nbFactures === syntheseAvant.nbFactures + 1 &&
    ecart(sReglee.encaisse, syntheseAvant.encaisse) === M(totalTtc) &&
    sReglee.nbEncaissements === syntheseAvant.nbEncaissements + 2,
  `${sReglee.factureTtc} facturé · ${sReglee.encaisse} encaissé`,
);
e.verdict(
  "le taux d'encaissement est l'encaissé sur le facturé TTC, arrondi à quatre décimales",
  M(sReglee.factureTtc) > 0n &&
    sReglee.tauxEncaissement !== null &&
    enUnites(sReglee.tauxEncaissement, 4) ===
      arrondi(M(sReglee.encaisse) * 10_000n, M(sReglee.factureTtc)),
  sReglee.tauxEncaissement ?? "aucun",
);

/* ------------------------------------------------ l'avoir */
e.section("L'avoir : la seule correction d'une facture émise");
const avoir = await e.rpc("honoraires", "avoir", [brouillon.id]);
e.verdict(
  "l'avoir se crée avec son propre numéro",
  /^H-\d{4}-\d{4}$/.test(avoir?.numero ?? "") && avoir.numero !== emission.numero,
  avoir?.numero ?? "",
);
const fAvoir = await e.rpc("honoraires", "facture", [avoir.id]);
f = await e.rpc("honoraires", "facture", [brouillon.id]);
e.verdict(
  "il reprend la facture ligne pour ligne, en négatif, droits compris",
  fAvoir?.avoirDe === brouillon.id &&
    fAvoir.statut === "emise" &&
    fAvoir.emiseLe === aujourdhui &&
    fAvoir.lignes.length === 3 &&
    fAvoir.lignes.every(
      (l, i) =>
        M(l.quantite) === -M(f.lignes[i].quantite) && M(l.montantHt) === -M(f.lignes[i].montantHt),
    ) &&
    M(fAvoir.totalHt) === -M(f.totalHt) &&
    M(fAvoir.totalTva) === -M(f.totalTva) &&
    M(fAvoir.droitsFixes) === -M(f.droitsFixes) &&
    M(fAvoir.totalTtc) === -M(f.totalTtc),
  `${fAvoir?.totalTtc} pour ${f.totalTtc}`,
);
e.verdict(
  "la facture d'origine passe annulée ce jour, sans rien perdre",
  f.statut === "annulee" &&
    f.annuleeLe === aujourdhui &&
    f.lignes.length === 3 &&
    f.encaissements.length === 2,
);
const refusAvoirDAvoir = await e.rpcAttenduEnEchec("honoraires", "avoir", [avoir.id]);
e.verdict("un avoir ne s'annule pas", refusAvoirDAvoir !== null);
const refusAvoirBis = await e.rpcAttenduEnEchec("honoraires", "avoir", [brouillon.id]);
e.verdict("une facture annulée n'a pas de second avoir", refusAvoirBis !== null);
const refusEncAvoir = await e.rpcAttenduEnEchec("honoraires", "encaisser", [
  { factureId: avoir.id, montant: "1", encaisseLe: aujourdhui, moyen: "virement", reference: null },
]);
e.verdict("un avoir ne s'encaisse pas", refusEncAvoir !== null);

/* ------------------------------------------------ la synthèse */
e.section("La synthèse du mois reflète exactement les mouvements");
const s = await e.rpc("honoraires", "synthese", [cabinet.id, MOIS]);
e.verdict(
  "facturé du mois : la facture et son avoir s'annulent, deux pièces de plus",
  ecart(s.factureHt, syntheseAvant.factureHt) === 0n &&
    ecart(s.factureTtc, syntheseAvant.factureTtc) === 0n &&
    s.nbFactures === syntheseAvant.nbFactures + 2,
  `${syntheseAvant.factureTtc} → ${s.factureTtc}, ${syntheseAvant.nbFactures} → ${s.nbFactures}`,
);
e.verdict(
  "encaissé du mois : le TTC de la facture, en deux encaissements",
  ecart(s.encaisse, syntheseAvant.encaisse) === M(totalTtc) &&
    s.nbEncaissements === syntheseAvant.nbEncaissements + 2,
  `${syntheseAvant.encaisse} → ${s.encaisse}`,
);
e.verdict(
  "reste dû et brouillons : un brouillon de plus, rien d'ouvert de plus",
  ecart(s.resteDu, syntheseAvant.resteDu) === 0n &&
    s.nbOuvertes === syntheseAvant.nbOuvertes &&
    s.nbBrouillons === syntheseAvant.nbBrouillons + 1,
);

// La même synthèse, refaite ici à partir des listes que l'écran affiche.
const [duMois, emises, brouillons] = await Promise.all([
  e.rpc("honoraires", "factures", [cabinet.id, { mois: MOIS }]),
  e.rpc("honoraires", "factures", [cabinet.id, { statut: "emise" }]),
  e.rpc("honoraires", "factures", [cabinet.id, { statut: "brouillon" }]),
]);
const emisesDuMois = duMois.filter((x) => x.statut !== "brouillon" && x.emiseLe?.startsWith(MOIS));
const ouvertes = emises.filter((x) => M(x.totalTtc) > 0n);
const attenduHt = emisesDuMois.reduce((a, x) => a + M(x.totalHt), 0n);
const attenduTtc = emisesDuMois.reduce((a, x) => a + M(x.totalTtc), 0n);
const attenduEnc = encDuMois.reduce((a, x) => a + M(x.montant), 0n);
const attenduReste = ouvertes.reduce((a, x) => a + M(x.totalTtc) - M(x.encaisse), 0n);
const retards = ouvertes.filter((x) => x.echeanceLe !== null && x.echeanceLe < aujourdhui);
const attenduRetard = retards.reduce((a, x) => a + M(x.totalTtc) - M(x.encaisse), 0n);
const attenduTaux =
  attenduTtc > 0n ? depuisUnites(arrondi(attenduEnc * 10_000n, attenduTtc), 4) : null;
e.verdict(
  "facturé, encaissé et taux d'encaissement concordent avec les listes",
  M(s.factureHt) === attenduHt &&
    M(s.factureTtc) === attenduTtc &&
    s.nbFactures === emisesDuMois.length &&
    M(s.encaisse) === attenduEnc &&
    s.nbEncaissements === encDuMois.length &&
    (s.tauxEncaissement === null
      ? attenduTaux === null
      : enUnites(s.tauxEncaissement, 4) === enUnites(attenduTaux, 4)),
  `${s.factureTtc} TTC · ${s.encaisse} encaissé · taux ${s.tauxEncaissement ?? "aucun"} (attendu ${attenduTaux ?? "aucun"})`,
);
e.verdict(
  "reste dû, retards et brouillons concordent avec les listes",
  M(s.resteDu) === attenduReste &&
    s.nbOuvertes === ouvertes.length &&
    M(s.enRetard) === attenduRetard &&
    s.nbRetard === retards.length &&
    s.nbBrouillons === brouillons.length,
  `${s.resteDu} sur ${s.nbOuvertes} ouverte(s), ${s.enRetard} en retard sur ${s.nbRetard}, ${s.nbBrouillons} brouillon(s)`,
);
e.verdict(
  "la synthèse parle la devise du cabinet",
  s.devise === cabinet.currency && s.mois === MOIS,
);

/* ------------------------------------------------ supprimer un brouillon */
e.section("Supprimer un brouillon");
const supprime = await e.rpc("honoraires", "supprimerBrouillon", [vide.id]);
e.verdict(
  "le brouillon vide disparaît",
  supprime === true && (await e.rpc("honoraires", "facture", [vide.id])) === null,
);
const sApres = await e.rpc("honoraires", "synthese", [cabinet.id, MOIS]);
e.verdict("la synthèse ne le compte plus", sApres.nbBrouillons === s.nbBrouillons - 1);
const refusIntrouvable = await e.rpcAttenduEnEchec("honoraires", "supprimerBrouillon", [vide.id]);
e.verdict("le supprimer deux fois est refusé", refusIntrouvable !== null);

/* ------------------------------------------------ ce qui n'est pas à soi */
e.section("Ce qui n'appartient pas au cabinet");
const NEANT = "00000000-0000-0000-0000-000000000000";
e.verdict(
  "une facture inconnue se lit comme absente",
  (await e.rpc("honoraires", "facture", [NEANT])) === null,
);
const refusClientEtranger = await e.rpcAttenduEnEchec("honoraires", "definirMandat", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: NEANT,
    mode: "forfait",
    frequence: "mensuelle",
    jourFacturation: 1,
    forfait: "100",
    tauxHoraire: null,
    delaiPaiementJours: 30,
    couverture: [],
  },
]);
e.verdict("un mandat ne se définit pas pour un client non mandaté", refusClientEtranger !== null);
const refusBrouillonEtranger = await e.rpcAttenduEnEchec("honoraires", "creerBrouillon", [
  {
    cabinetTenantId: cabinet.id,
    clientTenantId: NEANT,
    periodeDu: `${MOIS}-01`,
    periodeAu: `${MOIS}-28`,
    tauxTvaCode: tauxChoisi.code,
    lignes: LIGNES_1,
  },
]);
e.verdict("une facture ne se crée pas pour un client non mandaté", refusBrouillonEtranger !== null);
const refusClore = await e.rpcAttenduEnEchec("honoraires", "cloreMandat", [defA.id]);
e.verdict("un mandat déjà clos ne se clôt pas deux fois", refusClore !== null);

e.conclure();
