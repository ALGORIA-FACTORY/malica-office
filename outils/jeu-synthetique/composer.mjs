/**
 * Composer le jeu synthétique : cent factures FICTIVES, et ce qu'elles disent.
 *
 *   node --experimental-strip-types outils/jeu-synthetique/composer.mjs
 *
 * ================================================================= POURQUOI
 *
 * Le jeu d'or porte UNE pièce réelle ; la cible est cinquante. Les pièces
 * réelles vivent chez les clients, et les copier en atelier est refusé
 * (données personnelles). Ce jeu-ci se fabrique donc, et il le dit : chaque
 * cas porte `synthetique: true` et sa provenance.
 *
 * ========================================================= CE QU'IL GARANTIT
 *
 * 1. Rien de réel. Les raisons sociales, adresses, téléphones et matricules
 *    sont inventés ; les matricules ont la FORME tunisienne, tirée par
 *    `matriculeDEssai` (le seul générateur de matricules fictifs du dépôt).
 * 2. Rien de circulaire. Les valeurs et les écritures attendues sont calculées
 *    ICI, depuis la spécification de la facture, par une arithmétique entière
 *    qui n'importe rien du moteur mesuré (`montants.mjs`). Seuls les COMPTES,
 *    les taux et le timbre viennent du référentiel — c'est la règle du Socle,
 *    et elle se lit dans l'instantané relevé en base (`referentiel-d-essai.json`)
 *    et dans `referentiel-complementaire.json`, relus en base par une épreuve.
 * 3. Le même jeu à chaque fois. Un générateur graine (mulberry32) : relancer
 *    réécrit des fichiers identiques à l'octet.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { matriculeDEssai } from "../../apps/api/src/matricule-d-essai.ts";

import { mulberry32, tirages } from "./hasard.mjs";
import { enChiffresOrientaux, enLettres, imprimer, versDecimal, versMineur } from "./montants.mjs";
import {
  COMPLEMENT,
  DEVISE_DU_DOSSIER,
  coursDe,
  droit,
  ecritureAttendue,
  exposantDe,
  fodecAuCout,
  piedDeFacture,
  RELEVE_DU_REFERENTIEL,
  tauxDe,
} from "./referentiel.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));

/**
 * Un taux imprimé en pourcentage, sans l'erreur du flottant : « 0.07 » × 100 donnait
 * « 7.000000000000001 % » sur douze factures (relevé par le banc sans IA, 4 novembre 2026),
 * et aucune lecture ne peut fermer une preuve sur ce taux-là.
 */
const pourcentImprime = (taux) => String(Math.round(Number(taux) * 1_000_000) / 10_000);
const GRAINE = 20261031;

/* ----------------------------------------------------------- le hasard graine */

const { tirer, choisir } = tirages(mulberry32(GRAINE));

/* --------------------------------------------------------- les noms inventés */

/*
 * Des sociétés qui n'existent pas. Les noms sont composés de mots rares pour
 * ne ressembler à aucune enseigne ; les téléphones commencent par « 00 »,
 * préfixe qu'aucun abonné tunisien ne porte.
 */
const SOCIETES = [
  { fr: "Zarvane Équipements SARL", ar: "شركة زرفان للتجهيزات", ville: "Radès", villeAr: "رادس" },
  { fr: "Comptoir Belkadra SA", ar: "متجر بلقادرة", ville: "Sousse", villeAr: "سوسة" },
  { fr: "Tamzirt Services SUARL", ar: "تمزيرت للخدمات", ville: "Sfax", villeAr: "صفاقس" },
  { fr: "Ateliers Ouedrane SARL", ar: "ورشات وادران", ville: "Bizerte", villeAr: "بنزرت" },
  { fr: "Imprimerie Selvane", ar: "مطبعة سلفان", ville: "Nabeul", villeAr: "نابل" },
  { fr: "Kessira Bureautique SARL", ar: "قصيرة للمكتبيات", ville: "Monastir", villeAr: "المنستير" },
  { fr: "Oulmira Distribution SA", ar: "ولميرة للتوزيع", ville: "Gabès", villeAr: "قابس" },
  {
    fr: "Fennara Logistique SARL",
    ar: "فنارة للخدمات اللوجستية",
    ville: "Kairouan",
    villeAr: "القيروان",
  },
  { fr: "Dzirane Agro SARL", ar: "دزيران للفلاحة", ville: "Béja", villeAr: "باجة" },
  { fr: "Menzra Conseil SUARL", ar: "منزرة للاستشارات", ville: "Ariana", villeAr: "أريانة" },
  { fr: "Talvine Matériaux SA", ar: "تلفين لمواد البناء", ville: "Mahdia", villeAr: "المهدية" },
  { fr: "Borjane Textile SARL", ar: "برجان للنسيج", ville: "Ksar Hellal", villeAr: "قصر هلال" },
];
/** Les dossiers : les sociétés dont on tient les livres, fictives elles aussi. */
const DOSSIERS = [
  {
    fr: "Société Nervane d'Essai SARL",
    ar: "شركة نرفان التجريبية",
    ville: "Tunis",
    villeAr: "تونس",
  },
  {
    fr: "Laboratoire Qirwane d'Essai SA",
    ar: "مخبر قيروان التجريبي",
    ville: "La Marsa",
    villeAr: "المرسى",
  },
  {
    fr: "Groupe Sidrane d'Essai SUARL",
    ar: "مجمع سدران التجريبي",
    ville: "Ben Arous",
    villeAr: "بن عروس",
  },
];
const RUES = [
  ["rue des Orangers", "نهج البرتقال"],
  ["avenue des Jasmins", "شارع الياسمين"],
  ["rue de l'Olivier", "نهج الزيتونة"],
  ["zone industrielle, lot", "المنطقة الصناعية، مقسم"],
];
/** Les matricules, une fois par société : la même société garde le sien. */
const avecMatricule = (s) => ({
  ...s,
  matricule: matriculeDEssai("A", "M", tirer),
  rue: choisir(RUES),
  numeroDeRue: tirer(2, 120),
  telephone: `00 ${tirer(100, 999)} ${tirer(100, 999)}`,
});
const TIERS = SOCIETES.map(avecMatricule);
const LES_DOSSIERS = DOSSIERS.map(avecMatricule);

/* ----------------------------------------------------------- les articles */

/*
 * `nature` : ce que l'article EST, quand le dossier le vend — la vérité de la
 * spécification, d'où l'écriture attendue d'une vente se compose (705, 706,
 * 707). Un négoce : un bien se vend en marchandise.
 */
const ARTICLES = [
  {
    fr: "Papier A4 80 g, ramette",
    ar: "ورق طباعة A4 رزمة",
    code: "TVA19",
    pu: [8, 15],
    nature: "marchandises",
  },
  {
    fr: "Cartouche d'encre noire",
    ar: "خرطوشة حبر أسود",
    code: "TVA19",
    pu: [60, 180],
    nature: "marchandises",
  },
  {
    fr: "Prestation de maintenance",
    ar: "خدمات صيانة",
    code: "TVA19",
    pu: [250, 1800],
    nature: "prestations",
  },
  {
    fr: "Location de chariot élévateur",
    ar: "كراء رافعة شوكية",
    code: "TVA19",
    pu: [400, 2600],
    nature: "annexes",
  },
  {
    fr: "Tôle galvanisée 2 mm",
    ar: "صفائح مجلفنة 2 مم",
    code: "TVA19",
    pu: [90, 450],
    nature: "marchandises",
  },
  {
    fr: "Huile d'olive vierge, bidon 5 L",
    ar: "زيت زيتون بكر 5 لتر",
    code: "TVA07",
    pu: [45, 95],
    nature: "marchandises",
  },
  {
    fr: "Farine de blé, sac 50 kg",
    ar: "فارينة قمح كيس 50 كغ",
    code: "TVA07",
    pu: [38, 70],
    nature: "marchandises",
  },
  {
    fr: "Médicament vétérinaire",
    ar: "دواء بيطري",
    code: "TVA07",
    pu: [20, 260],
    nature: "marchandises",
  },
  {
    fr: "Hébergement en hôtel, nuitée",
    ar: "إقامة بالنزل ليلة",
    code: "TVA13",
    pu: [120, 380],
    nature: "prestations",
  },
  {
    fr: "Transport de marchandises",
    ar: "نقل البضائع",
    code: "TVA13",
    pu: [300, 1500],
    nature: "prestations",
  },
  {
    fr: "Formation professionnelle agréée",
    ar: "تكوين مهني معتمد",
    code: "EXO",
    pu: [500, 3200],
    nature: "prestations",
  },
  {
    fr: "Pain et viennoiseries",
    ar: "خبز ومعجنات",
    code: "EXO",
    pu: [2, 9],
    nature: "marchandises",
  },
];
const IMMOBILISATIONS = [
  { fr: "Serveur de stockage en baie", ar: "خادم تخزين في خزانة", code: "TVA19", pu: [4200, 9800] },
  {
    fr: "Photocopieur multifonction A3",
    ar: "آلة نسخ متعددة الوظائف A3",
    code: "TVA19",
    pu: [3100, 7400],
  },
];
const EXPORT = [
  {
    fr: "Huile d'olive en vrac, tonne",
    ar: "زيت زيتون سائب، طن",
    code: "EXPORT",
    pu: [3800, 5200],
    nature: "marchandises",
  },
  {
    fr: "Dattes Deglet Nour, carton",
    ar: "تمور دقلة نور، صندوق",
    code: "EXPORT",
    pu: [40, 85],
    nature: "marchandises",
  },
];

/* --------------------------------------------------- la matrice des 100 cas */

/** Langue × rendu : 40/30/30 et 45/30/25, la matrice du README. */
const MATRICE = [
  ["fr", "pdf", 18],
  ["fr", "photo", 12],
  ["fr", "manuscrit", 10],
  ["ar", "pdf", 13],
  ["ar", "photo", 9],
  ["ar", "manuscrit", 8],
  ["hybride", "pdf", 14],
  ["hybride", "photo", 9],
  ["hybride", "manuscrit", 7],
];

/** Les contenus, tournés dans chaque groupe pour que chaque rendu les voie tous. */
const SCENARIOS = [
  "achat_un_taux",
  "achat_plusieurs_taux",
  "vente_un_taux",
  "achat_remise",
  "achat_fodec",
  "vente_plusieurs_taux",
  "achat_immobilisation",
  "achat_eur",
  "vente_usd_export",
  "avoir_achat",
  "achat_exonere",
  "achat_13",
];

/**
 * Les huit factures défectueuses : leur issue attendue est un REFUS nommé, pas
 * une écriture. Désignées par (langue, rendu, rang dans le groupe).
 */
const DEFAUTS = [
  ["fr", "pdf", 2, "total_faux"],
  ["ar", "pdf", 2, "total_faux"],
  ["hybride", "pdf", 2, "tva_fausse"],
  ["fr", "pdf", 14, "date_absente"],
  ["hybride", "pdf", 13, "montant_illisible"],
  ["ar", "photo", 2, "date_absente"],
  ["fr", "photo", 2, "montant_illisible"],
  ["hybride", "manuscrit", 2, "tva_fausse"],
];
/**
 * Ce que le jugement doit dire de chaque défaut : l'un de ces contrôles en
 * défaut (« coherence_arithmetique »), ou ce code précis de refus
 * (« proposition/a_completer » : la proposition dit le champ à compléter).
 *
 * La date absente admet `proposition/a_completer` depuis la première mesure
 * (31 octobre 2026) : le produit ne la refuse pas par un contrôle, il dit
 * « à compléter — document_date ». C'est le refus juste, nommé ; la liste du
 * premier jet ne le prévoyait pas. Écrit ici pour que ce choix se voie.
 */
const REFUS_DU_DEFAUT = {
  total_faux: ["coherence_arithmetique"],
  tva_fausse: ["coherence_arithmetique"],
  date_absente: ["mentions_obligatoires", "coherence_dates", "proposition/a_completer"],
  montant_illisible: ["coherence_arithmetique", "normalisation"],
};

const MOIS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const iso = (j) => j.toISOString().slice(0, 10);
const deuxChiffres = (n) => String(n).padStart(2, "0");

/* --------------------------------------------------------------- un cas */

function composer(rang, langue, rendu, j, scenario, defaut) {
  const id = String(rang + 1).padStart(3, "0");
  const sens = scenario.startsWith("vente") ? "facture_vente" : "facture_achat";
  const devise =
    scenario === "achat_eur" ? "EUR" : scenario === "vente_usd_export" ? "USD" : DEVISE_DU_DOSSIER;
  const exposant = exposantDe(devise);
  const dossier = LES_DOSSIERS[rang % LES_DOSSIERS.length];
  const tiers = TIERS[tirer(0, TIERS.length)];
  const emetteur = sens === "facture_vente" ? dossier : tiers;
  const client = sens === "facture_vente" ? tiers : dossier;

  // Le format des nombres : un séparateur de milliers sur trois cas sur quatre.
  const milliers = devise === "USD" ? "," : [" ", ".", " ", ""][j % 4];
  const decimal = devise === "USD" ? "." : ",";
  // L'arabe : chiffres orientaux pour les dates et numéros d'un cas sur deux,
  // et pour les MONTANTS de quelques cas (le produit les refuse, et le dit).
  const datesOrientales = langue === "ar" && j % 2 === 1;
  const montantsOrientaux =
    langue === "ar" && j % 4 === 3 && devise === DEVISE_DU_DOSSIER && defaut === undefined;
  const format = { milliers, decimal, chiffres: montantsOrientaux ? "orientaux" : "latins" };
  const montant = (m) => imprimer(m, exposant, format);

  /* les articles */
  const catalogue =
    scenario === "achat_immobilisation"
      ? IMMOBILISATIONS
      : scenario === "vente_usd_export"
        ? EXPORT
        : scenario === "achat_exonere"
          ? ARTICLES.filter((a) => a.code === "EXO")
          : scenario === "achat_13"
            ? ARTICLES.filter((a) => a.code === "TVA13")
            : scenario.includes("plusieurs_taux")
              ? ARTICLES
              : ARTICLES.filter((a) => a.code === "TVA19");
  const nombre = scenario === "achat_immobilisation" ? 1 : tirer(2, 5);
  const pris = [];
  while (pris.length < nombre) {
    const a = choisir(catalogue);
    if (!pris.includes(a)) pris.push(a);
    if (pris.length === catalogue.length) break;
  }
  // Plusieurs taux : au moins deux codes différents, sinon on en ajoute un.
  if (scenario.includes("plusieurs_taux") && new Set(pris.map((a) => a.code)).size < 2) {
    pris.push(ARTICLES.find((a) => a.code !== pris[0].code && !pris.includes(a)));
  }
  if (scenario === "vente_plusieurs_taux" && !pris.some((a) => a.code === "EXO")) {
    pris.push(ARTICLES.find((a) => a.code === "EXO"));
  }
  const articles = pris.map((a) => {
    const quantite = a.pu[1] > 1000 ? tirer(1, 3) : tirer(1, 24);
    const pu =
      BigInt(tirer(a.pu[0], a.pu[1])) * 10n ** BigInt(exposant) + BigInt(tirer(0, 10 ** exposant));
    return {
      designation: langue === "ar" ? a.ar : a.fr,
      designationAr: a.ar,
      codeTaxe: a.code,
      nature: a.nature,
      quantite,
      pu,
      total: pu * BigInt(quantite),
    };
  });

  /* le pied */
  const tauxRemise = scenario === "achat_remise" ? choisir(["0.05", "0.10"]) : null;
  const { brut, remise, ht, fodec, parTaux, tva } = piedDeFacture({
    articles,
    tauxRemise,
    avecFodec: scenario === "achat_fodec",
  });

  // Le timbre : chaque facture en dinars, jamais une pièce en devise ni un
  // avoir (INCERTAIN : la règle exacte est à confirmer, voir le README).
  const timbreAttendu = devise === DEVISE_DU_DOSSIER && scenario !== "avoir_achat";
  const timbre = timbreAttendu ? versMineur(droit("DROIT_TIMBRE", sens).fixedAmount, exposant) : 0n;
  let ttc = ht + fodec + tva + timbre;

  /* les défauts, posés SUR ce que la facture imprime */
  let tvaImprimee = tva;
  let ttcImprime = ttc;
  if (defaut === "total_faux") ttcImprime = ttc + 10n * 10n ** BigInt(exposant);
  if (defaut === "tva_fausse") {
    tvaImprimee = tva + 5n * 10n ** BigInt(exposant);
    ttcImprime = ttc + 5n * 10n ** BigInt(exposant);
    parTaux[0].tvaImprimee = parTaux[0].tva + 5n * 10n ** BigInt(exposant);
  }

  /* la date, et ce qui est imprimé */
  const jour = new Date(Date.UTC(2026, 8 + (j % 2), 1 + tirer(0, 27)));
  const recue = new Date(jour.getTime() + tirer(1, 6) * 86_400_000);
  const dateIso = defaut === "date_absente" ? null : iso(jour);
  const jj = deuxChiffres(jour.getUTCDate());
  const mm = deuxChiffres(jour.getUTCMonth() + 1);
  let dateImprimee;
  if (langue === "ar") {
    const d =
      j % 3 === 0 ? `${jour.getUTCFullYear()}/${mm}/${jj}` : `${jj}/${mm}/${jour.getUTCFullYear()}`;
    dateImprimee = datesOrientales ? enChiffresOrientaux(d) : d;
  } else {
    dateImprimee =
      j % 3 === 0
        ? `${jour.getUTCDate()} ${MOIS_FR[jour.getUTCMonth()]} ${jour.getUTCFullYear()}`
        : j % 3 === 1
          ? `${jj}/${mm}/${jour.getUTCFullYear()}`
          : `${jj}-${mm}-${jour.getUTCFullYear()}`;
  }
  const numeroBrut = `${jour.getUTCFullYear()}/${String(tirer(1, 9999)).padStart(4, "0")}`;
  const numero =
    langue === "ar"
      ? datesOrientales
        ? enChiffresOrientaux(numeroBrut)
        : numeroBrut
      : `${scenario === "avoir_achat" ? "AV" : "F"}-${numeroBrut.replace("/", "-")}`;

  const illisible = (texte) => texte.replace(/[0-9٠-٩]/g, (c, i) => (i % 2 === 0 ? "#" : c));
  const imprime = {
    issuer: langue === "ar" ? emetteur.ar : emetteur.fr,
    ...(dateIso ? { document_date: dateImprimee } : {}),
    "references.numero": numero,
    "references.matricule_fiscal": emetteur.matricule,
    "references.matricule_fiscal_client": client.matricule,
    "totals.base_ht": montant(ht),
    "totals.vat":
      defaut === "montant_illisible" ? illisible(montant(tvaImprimee)) : montant(tvaImprimee),
    "totals.ttc":
      defaut === "montant_illisible" ? illisible(montant(ttcImprime)) : montant(ttcImprime),
  };
  const droits = [];
  if (fodec > 0n) droits.push({ code: "FODEC", montant: fodec });
  if (timbre > 0n) droits.push({ code: "DROIT_TIMBRE", montant: timbre });
  droits.forEach((d, k) => (imprime[`other_charges[${k}].amount`] = montant(d.montant)));
  // Le tableau par taux s'imprime dès qu'il y a plusieurs taux, ou un FODEC
  // (sa base de TVA n'est plus le HT) ; sinon la ligne se lit au pied.
  const tableauParTaux = parTaux.length > 1 || fodec > 0n;
  parTaux.forEach((l, i) => {
    if (tableauParTaux) {
      imprime[`lines[${i}].base_ht`] = montant(l.baseTva);
      imprime[`lines[${i}].vat_amount`] = montant(l.tvaImprimee ?? l.tva);
    }
  });
  articles.forEach((a, k) => {
    imprime[`articles[${k}].designation`] = a.designation;
    imprime[`articles[${k}].quantity`] =
      format.chiffres === "orientaux"
        ? enChiffresOrientaux(String(a.quantite))
        : String(a.quantite);
    imprime[`articles[${k}].unit_price_ht`] = montant(a.pu);
    imprime[`articles[${k}].total_ht`] = montant(a.total);
  });
  const lettres =
    langue !== "ar" && j % 2 === 0 && defaut !== "montant_illisible"
      ? `Arrêtée la présente ${scenario === "avoir_achat" ? "facture d'avoir" : "facture"} à la somme de : ` +
        `${enLettres(Number(ttcImprime / 10n ** BigInt(exposant)))} ${devise === "TND" ? "dinars" : devise === "EUR" ? "euros" : "dollars"}` +
        (ttcImprime % 10n ** BigInt(exposant) === 0n
          ? "."
          : ` et ${enLettres(Number(ttcImprime % 10n ** BigInt(exposant)))} ${devise === "TND" ? "millimes" : "centimes"}.`)
      : null;

  /* ce que la lecture doit rendre — écrit depuis la spécification */
  const dec = (m) => versDecimal(m, exposant);
  const champs = {
    document_kind: sens,
    issuer: imprime.issuer,
    document_date: dateIso,
    currency: devise,
    "references.numero": numero,
    "references.matricule_fiscal": emetteur.matricule,
    "references.matricule_fiscal_client": client.matricule,
    "totals.base_ht": dec(ht),
    "totals.vat": defaut === "montant_illisible" ? null : dec(tvaImprimee),
    "totals.ttc": defaut === "montant_illisible" ? null : dec(ttcImprime),
  };
  // Une ligne par taux n'existe au contrat qu'entière (base, TVA, code) : sans
  // tableau, une TVA illisible au pied ne laisse AUCUNE ligne à lire.
  const ligneIllisible = defaut === "montant_illisible" && !tableauParTaux;
  parTaux.forEach((l, i) => {
    champs[`lines[${i}].tax_code`] = ligneIllisible ? null : l.code;
    champs[`lines[${i}].base_ht`] = ligneIllisible
      ? null
      : dec(tableauParTaux ? l.baseTva : l.baseHt);
    champs[`lines[${i}].vat_amount`] = ligneIllisible ? null : dec(l.tvaImprimee ?? l.tva);
  });
  droits.forEach((d, k) => {
    champs[`other_charges[${k}].code`] = d.code;
    champs[`other_charges[${k}].amount`] = dec(d.montant);
  });
  articles.forEach((a, k) => {
    champs[`articles[${k}].quantity`] = dec(BigInt(a.quantite) * 10n ** BigInt(exposant));
    champs[`articles[${k}].unit_price_ht`] = dec(a.pu);
    champs[`articles[${k}].total_ht`] = dec(a.total);
  });

  /* l'écriture juste — comptes du référentiel, montants de la spécification */
  const notes = [];
  const facture = {
    sens,
    devise,
    exposant,
    parTaux,
    articles,
    droits,
    ttc,
    tva,
    immobilisation: scenario === "achat_immobilisation",
    dateIso,
  };
  const ecritureDe = (enCharge = false, auRepli = false) =>
    ecritureAttendue(facture, { enCharge, auRepli }, notes);

  let ecriture = null;
  let issue;
  let ecritureDuComptable = null;
  let aTrancher = null;
  if (defaut) {
    issue = { type: "refus", motifs: REFUS_DU_DEFAUT[defaut] };
    notes.push(`défaut délibéré « ${defaut} » : la pièce ne doit recevoir aucune écriture`);
  } else if (scenario === "avoir_achat") {
    // Le pack range l'avoir parmi les pièces que le cabinet saisit
    // (`ref.titres_de_piece`, statut « anomalie ») : l'issue juste est ce
    // refus nommé. L'écriture du comptable — l'achat contre-passé — est notée
    // pour le jour où le Socle proposera les avoirs.
    // Lié à sa facture (`avoirs.traitement`, défaut du CEO) : le jeu n'a pas
    // de base, aucune facture ne se rattache — la proposition le dit
    // (« facture d'origine à rattacher »). Un titre PERDU reste un refus de
    // la nature : facture ou avoir, le cabinet tranche.
    issue = { type: "refus", motifs: ["proposition/facture_d_origine", "nature_piece"] };
    const e = ecritureDe();
    ecritureDuComptable = {
      journal: e.journal,
      lignes: e.lignes.map(([c, d, cr, code]) => (code ? [c, cr, d, code] : [c, cr, d])),
    };
  } else {
    ecriture = ecritureDe();
    issue = {
      type: "ecriture",
      ...(devise !== DEVISE_DU_DOSSIER ? { reserve: "cours_de_change" } : {}),
    };
  }
  if (scenario === "achat_immobilisation") {
    notes.push(`INCERTAIN — ${COMPLEMENT.immobilisation.incertain}`);
    // Le Socle ne tranche pas entre charge et immobilisation (R10) : il
    // propose l'imputation du paramétrage AVEC la réserve qui dit la question
    // (`ref.biens_immobilisables`). Cette issue n'est pas l'écriture exacte ;
    // elle n'est pas fausse non plus : elle est à trancher, et se compte à part.
    if (!defaut) aTrancher = { reserve: "immobilisation_a_trancher", ecriture: ecritureDe(true) };
  }
  // Une vente dont le Socle ne prouve pas la nature (un mot qu'il ne
  // reconnaît pas, une désignation perdue) : le compte de repli, avec la
  // réserve qui le dit. Ni exacte, ni fausse : à trancher.
  if (sens === "facture_vente" && !defaut && ecriture)
    aTrancher = { reserve: "nature_de_vente", ecriture: ecritureDe(false, true) };
  if (fodec > 0n)
    notes.push(
      fodecAuCout
        ? "INCERTAIN — FODEC à l'achat incorporé au coût, sur sa ligne au compte de la charge (fodec.traitement du pack), et compris dans la base de la TVA"
        : "INCERTAIN — FODEC à l'achat imputé au compte du pack, et compris dans la base de la TVA",
    );
  if (sens === "facture_vente")
    notes.push(
      "INCERTAIN — compte de vente par nature d'article (ventes.compte = par_nature_article, défaut du CEO du 31/10/2026) : 705 prestations, 706 annexes, 707 marchandises ; repli au compte des produits finis, avec la réserve « nature de la vente à préciser »",
    );

  const cours = devise === DEVISE_DU_DOSSIER ? null : coursDe(devise);
  const titreFr = scenario === "avoir_achat" ? "FACTURE D'AVOIR" : "FACTURE";
  const titreAr = scenario === "avoir_achat" ? "إشعار دائن" : "فاتورة";

  return {
    id,
    synthetique: true,
    provenance: `jeu synthétique, composé par outils/jeu-synthetique/composer.mjs (graine ${GRAINE}) : facture inventée, aucune donnée réelle`,
    langue,
    rendu,
    scenario,
    defaut: defaut ?? null,
    dossier: { nom: dossier.fr, identifiantFiscal: dossier.matricule },
    piece: {
      sens,
      titre: langue === "fr" ? titreFr : langue === "ar" ? titreAr : `${titreFr} / ${titreAr}`,
      recueLe: iso(recue),
      devise,
      exposant,
      format,
      emetteur: {
        nom: imprime.issuer,
        nomAr: emetteur.ar,
        matricule: emetteur.matricule,
        adresse:
          langue === "ar"
            ? `${emetteur.numeroDeRue}، ${emetteur.rue[1]}، ${emetteur.villeAr}`
            : `${emetteur.numeroDeRue}, ${emetteur.rue[0]}, ${emetteur.ville}`,
        telephone: emetteur.telephone,
      },
      client: {
        nom: langue === "ar" ? client.ar : client.fr,
        matricule: client.matricule,
        adresse: langue === "ar" ? client.villeAr : client.ville,
      },
      articles: articles.map((a) => ({
        designation: a.designation,
        designationAr: a.designationAr,
        codeTaxe: a.codeTaxe,
        tauxImprime: `${pourcentImprime(tauxDe(a.codeTaxe))} %`,
      })),
      tableauParTaux,
      parTaux: parTaux.map((l) => ({ code: l.code, tauxImprime: `${pourcentImprime(l.taux)} %` })),
      remise: tauxRemise
        ? {
            tauxImprime: `${pourcentImprime(tauxRemise)} %`,
            brut: montant(brut),
            montant: montant(remise),
          }
        : null,
      droits: droits.map((d) => d.code),
      enLettres: lettres,
      imprime,
    },
    graineDuRendu: tirer(1, 2 ** 31),
    attendu: {
      champs,
      ecriture,
      issue,
      ...(aTrancher ? { aTrancher } : {}),
      ...(ecritureDuComptable ? { ecritureDuComptable } : {}),
      ...(cours ? { cours: { devise, taux: cours.taux, unite: cours.unite, date: dateIso } } : {}),
      referentiel: RELEVE_DU_REFERENTIEL,
      notes,
    },
  };
}

/* ------------------------------------------------------------- l'écriture */

const SORTIE = join(ICI, "cas");
rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });

let rang = 0;
let groupe = 0;
for (const [langue, rendu, n] of MATRICE) {
  for (let j = 0; j < n; j += 1) {
    const scenario = SCENARIOS[(j + groupe * 5) % SCENARIOS.length];
    const defaut = DEFAUTS.find((d) => d[0] === langue && d[1] === rendu && d[2] === j)?.[3];
    // Un défaut se pose sur une facture ordinaire : achat ou vente à un taux.
    const scenarioDuDefaut = defaut ? (j % 2 === 0 ? "achat_un_taux" : "vente_un_taux") : scenario;
    const cas = composer(rang, langue, rendu, j, scenarioDuDefaut, defaut);
    writeFileSync(join(SORTIE, `${cas.id}.json`), `${JSON.stringify(cas, null, 2)}\n`);
    rang += 1;
  }
  groupe += 1;
}
console.log(`${readdirSync(SORTIE).length} cas écrits dans ${SORTIE}`);
