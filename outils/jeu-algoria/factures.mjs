/**
 * Composer une facture du jeu d'ALGORIA, et sa vérité.
 *
 * ================================================================= LA VÉRITÉ
 *
 * Chaque cas dit, depuis la SPÉCIFICATION et jamais depuis le moteur mesuré :
 *
 * - `attendu.champs`, `ecriture`, `issue`, `aTrancher`, `cours`, `referentiel`,
 *   `notes` : les mêmes noms que le jeu synthétique, calculés par les mêmes
 *   modules (`../jeu-synthetique/referentiel.mjs`, `montants.mjs`) ;
 * - `attendu.concepts` : pour chaque champ de la grille `facture` IMPRIMÉ sur la
 *   page, sa valeur attendue, clé par le code du champ en base
 *   (`grilles/facture.json`) — montants en décimal, dates ISO, matricules à la
 *   forme normalisée « 1234567A/A/M/000 » ;
 * - `attendu.confondus` : un champ que la page imprime UNE fois pour deux codes
 *   (la seule « Date » vaut date de l'opération et date d'émission) ;
 * - `attendu.non_imprimes` : les champs de la grille délibérément absents — un
 *   « absent » juste y est un succès.
 *
 * Les parties ne se croisent jamais : le matricule d'ALGORIA n'est imprimé que
 * du côté d'ALGORIA (client d'un achat, émetteur d'une vente), et aucun
 * matricule n'est imprimé deux fois sur une page (le tampon d'une facture
 * imprimée ne le porte pas ; celui d'un carnet le porte, et l'en-tête non).
 */
import { matriculeDEssai } from "../../apps/api/src/matricule-d-essai.ts";
import {
  enChiffresOrientaux,
  enLettres,
  horsTaxe,
  imprimer,
  multiplier,
  versDecimal,
  versMineur,
} from "../jeu-synthetique/montants.mjs";
import {
  coursDe,
  DEVISE_DU_DOSSIER,
  droit,
  ecritureAttendue,
  exposantDe,
  fodecAuCout,
  piedDeFacture,
  REFERENTIEL,
  RELEVE_DU_REFERENTIEL,
  tauxDe,
} from "../jeu-synthetique/referentiel.mjs";

import {
  ACHATS,
  ALGORIA,
  BANQUES,
  CLIENTS,
  ENSEIGNES,
  FOURNISSEURS,
  MENTIONS_DE_DETAIL,
  RAYON,
  RUES,
  VENDEURS,
  VENTES,
  VENTES_EXPORT,
} from "./catalogue.mjs";

export const MOIS_FR = [
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
export const iso = (j) => j.toISOString().slice(0, 10);
export const deux = (n) => String(n).padStart(2, "0");
/** Un taux du référentiel (« 0.190000 ») tel qu'une page l'imprime : « 19 ». */
const pourcent = (taux) => String(versMineur(taux, 2));

/* ------------------------------------------------------------ les biens */

/*
 * Aucun achat du jeu n'est une immobilisation : son écriture irait au compte
 * d'immobilisation, et l'issue serait « à trancher ». Le catalogue l'évite, et
 * ce garde le prouve avec les motifs mêmes du référentiel.
 */
const MOTIFS_IMMOBILISABLES = REFERENTIEL.biensImmobilisables.map((b) => new RegExp(b.motif, "iu"));
for (const a of [...RAYON, ...ACHATS]) {
  for (const texte of [a.fr, a.ar].filter(Boolean)) {
    if (MOTIFS_IMMOBILISABLES.some((m) => m.test(texte)))
      throw new Error(`catalogue : « ${texte} » se lirait comme une immobilisation`);
  }
}

/* ------------------------------------------------------------ les parties */

/**
 * Les parties inventées, tirées UNE fois : la même société garde son
 * matricule, son RC, son RIB d'un cas à l'autre.
 */
export function lesParties({ tirer, choisir }) {
  const identite = () => {
    const matricule = matriculeDEssai("A", "M", tirer);
    if (matricule === ALGORIA.matricule) throw new Error("matricule fictif égal à celui d'ALGORIA");
    return {
      matricule,
      rc: `B${tirer(10, 99)}${tirer(100000, 999999)}${tirer(2008, 2025)}`,
      banque: choisir(BANQUES),
      rib: `99 ${tirer(100, 999)} ${tirer(1000000, 9999999)}${tirer(100000, 999999)} ${deux(tirer(1, 97))}`,
      telephone: `00 ${tirer(30, 79)} ${tirer(100, 999)} ${tirer(100, 999)}`,
      fax: `00 ${tirer(30, 79)} ${tirer(100, 999)} ${tirer(100, 999)}`,
      rue: choisir(RUES),
      numeroDeRue: tirer(2, 160),
    };
  };
  return {
    // L'adresse d'une enseigne est la sienne : l'identité tirée ne la remplace pas.
    enseignes: ENSEIGNES.map((e) => ({ ...identite(), ...e })),
    fournisseurs: FOURNISSEURS.map((f) => ({ ...f, ...identite() })),
    clients: CLIENTS.map((c) => ({ ...c, ...identite(), code: `C${tirer(1000000, 9999999)}` })),
  };
}

/**
 * Le matricule d'ALGORIA tel que la page l'imprime : à barres le plus souvent,
 * compact (un cas sur trois), espacé (quelques-uns), en chiffres orientaux
 * dans des carnets arabes. La valeur attendue reste la forme normalisée.
 */
export function formeDuMatricule(matricule, forme) {
  if (forme === "compact") return matricule.replaceAll("/", "");
  if (forme === "espace") return matricule.replace(/^(\d{7})/, "$1 ");
  if (forme === "oriental") return enChiffresOrientaux(matricule);
  return matricule;
}

/** Un EAN-13 inventé, préfixe 619, clé de contrôle juste. */
function ean13(tirer) {
  const corps = `619${String(tirer(0, 1e9)).padStart(9, "0")}`;
  const somme = [...corps].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return `${corps}${(10 - (somme % 10)) % 10}`;
}

/* ------------------------------------------------- ce qui s'imprime, et sa vérité */

/**
 * Ce qu'une page imprime, chemin par chemin, et sa vérité clé par les codes de
 * la grille. `pose(chemin, texte, concept, valeur)` : le texte imprimé au
 * chemin, et la valeur attendue du champ ; `poseConcept` : une valeur attendue
 * sans chemin propre. Un code `x[i].y` remplit la i-ième occurrence de `x`
 * (une ligne d'articles, un mouvement, une résolution), un code `x[k]` la clé
 * `k` de `x` (un taux de TVA).
 */
export function lesPoses() {
  const imprime = {};
  const versConcept = {};
  const concepts = {};
  const poseConcept = (concept, valeur) => {
    const m = /^(\w+)\[(\w+)\]\.(\w+)$/.exec(concept);
    if (m) {
      (concepts[m[1]] ??= [])[Number(m[2])] ??= {};
      concepts[m[1]][Number(m[2])][m[3]] = valeur;
    } else {
      const t = /^(\w+)\[(\w+)\]$/.exec(concept);
      if (t) (concepts[t[1]] ??= {})[t[2]] = valeur;
      else concepts[concept] = valeur;
    }
  };
  const pose = (chemin, texte, concept, valeur) => {
    imprime[chemin] = texte;
    if (concept) {
      versConcept[chemin] = concept;
      poseConcept(concept, valeur);
    }
  };
  return { imprime, versConcept, concepts, pose, poseConcept };
}

/**
 * Les effets d'une prise de vue, tirés dans cet ordre : photo de téléphone
 * (l'ombre de la main une fois sur deux, froissé ou pli), ou scan (photocopie
 * ou page passée).
 */
export function effetsDeLaPriseDeVue(capture, tirer) {
  const realisme = [];
  if (capture === "photo")
    realisme.push(
      "fond_bureau",
      "perspective",
      "rotation",
      "eclairage_inegal",
      "flou",
      ...(tirer(0, 2) ? ["ombre_main"] : []),
      ...(tirer(0, 3) === 0 ? ["froisse"] : tirer(0, 2) ? ["pli"] : []),
    );
  if (capture === "scan")
    realisme.push(
      "biais",
      "grain",
      ...(tirer(0, 3) === 0 ? ["photocopie"] : tirer(0, 2) ? ["pale"] : []),
    );
  return realisme;
}

/* --------------------------------------------------------------- un cas */

/**
 * Une facture du jeu. `g` : la case de la matrice (sens, gabarit, langue,
 * rendu, capture) ; `j` : le rang dans la case ; `rang` : le rang dans le jeu.
 */
export function composerFacture({ rang, g, j, scenario, parties, tirages, graine }) {
  const { tirer, choisir } = tirages;
  const id = String(rang + 1).padStart(3, "0");
  const achat = g.sens === "achat";
  const sens = achat ? "facture_achat" : "facture_vente";
  const { gabarit, langue, rendu } = g;
  const detail = gabarit === "A";
  const carnet = gabarit === "E" || gabarit === "F";
  const devise =
    scenario === "devise_eur" ? "EUR" : scenario === "export_usd" ? "USD" : DEVISE_DU_DOSSIER;
  const exposant = exposantDe(devise);
  const unite = 10n ** BigInt(exposant);

  /* les parties : ALGORIA d'un côté, une société inventée de l'autre */
  const tiers = detail
    ? achat
      ? choisir(parties.enseignes)
      : choisir(parties.clients.filter((c) => c.ville !== "Valletta"))
    : achat
      ? choisir(
          parties.fournisseurs.filter((f) =>
            scenario === "fodec"
              ? f.industriel
              : scenario === "exonere"
                ? f.fr.startsWith("Centre")
                : !f.fr.startsWith("Centre"),
          ),
        )
      : choisir(
          parties.clients.filter((c) =>
            scenario === "export_usd" ? c.ville === "Valletta" : c.ville !== "Valletta",
          ),
        );
  const orientaux = langue === "ar" && carnet && j % 3 === 0;
  const forme = orientaux
    ? "oriental"
    : rang % 3 === 1
      ? "compact"
      : rang % 11 === 5
        ? "espace"
        : "slash";
  const algoria = {
    nom: ALGORIA.nom,
    nomAr: ALGORIA.nomAr,
    matricule: ALGORIA.matricule,
    matriculeImprime: formeDuMatricule(ALGORIA.matricule, forme),
    adresse:
      langue === "ar"
        ? `${ALGORIA.rue[1]}، ${ALGORIA.ville[1]}`
        : `${ALGORIA.rue[0]}, ${ALGORIA.ville[0]}`,
    telephone: ALGORIA.telephone,
    email: ALGORIA.email,
    rc: ALGORIA.rc,
    rib: ALGORIA.rib,
    banque: ALGORIA.banque,
    forme: ALGORIA.forme,
  };
  const autre = {
    nom: detail && achat ? tiers.raison : langue === "ar" ? tiers.ar : tiers.fr,
    nomAr: tiers.ar ?? null,
    enseigne: detail && achat ? tiers.nom : null,
    matricule: tiers.ville === "Valletta" ? null : tiers.matricule,
    matriculeImprime: tiers.ville === "Valletta" ? null : tiers.matricule,
    adresse: detail
      ? achat
        ? `${tiers.rue}, ${tiers.ville}`
        : `${tiers.numeroDeRue}, ${tiers.rue[0]}, ${tiers.ville}`
      : langue === "ar"
        ? `${tiers.numeroDeRue}، ${tiers.rue[1]}، ${tiers.villeAr}`
        : `${tiers.numeroDeRue}, ${tiers.rue[0]}, ${tiers.ville}`,
    telephone: tiers.telephone,
    fax: tiers.fax,
    email: tiers.email ?? null,
    site: tiers.site ?? null,
    rc: tiers.rc,
    rib: tiers.rib,
    banque: tiers.banque,
    code: tiers.code ?? `C${tirer(1000000, 9999999)}`,
    couleur: tiers.couleur ?? null,
    slogan: tiers.slogan ?? null,
    magasin: tiers.magasin ?? null,
  };
  const emetteur = achat ? autre : algoria;
  const client = achat ? algoria : autre;
  if (emetteur.matricule === client.matricule) throw new Error(`${id} : un matricule deux fois`);

  /* le format des nombres */
  const milliers = devise === "USD" ? "," : [" ", ".", "", " "][(rang + j) % 4];
  const decimal = devise === "USD" ? "." : ",";
  const chiffres = orientaux && j % 2 === 0 ? "orientaux" : "latins";
  const format = { milliers, decimal, chiffres };
  const montant = (m) => imprimer(m, exposant, format);
  const dec = (m) => versDecimal(m, exposant);
  const nombre = (n) => (chiffres === "orientaux" ? enChiffresOrientaux(String(n)) : String(n));

  /* la date et le numéro */
  const jour = new Date(Date.UTC(2026, tirer(0, 10), tirer(1, 29)));
  const dateIso = iso(jour);
  const jj = deux(jour.getUTCDate());
  const mm = deux(jour.getUTCMonth() + 1);
  const aaaa = jour.getUTCFullYear();
  let dateImprimee;
  if (detail) dateImprimee = `${jj}/${mm}/${aaaa}`;
  else if (langue === "ar") {
    const d = j % 3 === 0 ? `${aaaa}/${mm}/${jj}` : `${jj}/${mm}/${aaaa}`;
    dateImprimee = orientaux ? enChiffresOrientaux(d) : d;
  } else if (carnet)
    dateImprimee = j % 2 === 0 ? `${jj}/${mm}/${aaaa}` : `${jj}/${mm}/${String(aaaa).slice(2)}`;
  else
    dateImprimee =
      j % 3 === 0
        ? `${jour.getUTCDate()} ${MOIS_FR[jour.getUTCMonth()]} ${aaaa}`
        : j % 3 === 1
          ? `${jj}/${mm}/${aaaa}`
          : `${jj}-${mm}-${aaaa}`;
  const serie = tirer(1, 9999);
  let numero;
  if (detail)
    numero = `FAC-${String(aaaa).slice(2)}M${emetteur.magasin ?? "02"}LIV-${String(aaaa).slice(2)}${String(tirer(1000, 9999))}`;
  else if (carnet) numero = String(tirer(100, 999)).padStart(4, "0");
  else if (langue === "ar") numero = `${aaaa}/${String(serie).padStart(4, "0")}`;
  else
    numero =
      j % 2 === 0
        ? `F-${aaaa}-${String(serie).padStart(4, "0")}`
        : `FA${String(aaaa).slice(2)}/${String(serie).padStart(5, "0")}`;
  const numeroImprime = orientaux ? enChiffresOrientaux(numero) : numero;

  /* les articles, et le pied */
  const tirerArticles = (catalogue, n) => {
    const pris = [];
    while (pris.length < n && pris.length < catalogue.length) {
      const a = choisir(catalogue);
      if (!pris.includes(a)) pris.push(a);
    }
    return pris;
  };
  let articles;
  let tauxRemise = null;
  let avecFodec = false;
  if (detail) {
    const dense = scenario === "dense";
    const n = dense ? tirer(20, 26) : tirer(2, 10);
    const catalogue = achat
      ? scenario === "plusieurs_taux" || dense
        ? RAYON
        : RAYON.filter((a) => a.code === "TVA19")
      : VENTES.filter((a) => a.code === "TVA19" || scenario === "plusieurs_taux");
    let pris = tirerArticles(catalogue, n);
    if (scenario === "plusieurs_taux" && new Set(pris.map((a) => a.code)).size < 2)
      pris = [...pris, catalogue.find((a) => a.code !== pris[0].code)];
    articles = pris.map((a, k) => {
      const quantite = a.ttc && a.ttc[1] < 40 ? tirer(1, 8) : tirer(1, 3);
      const puTtc = a.ttc
        ? BigInt(tirer(a.ttc[0], a.ttc[1])) * unite + BigInt(choisir([0, 900, 500, 0, 0]))
        : multiplier(BigInt(tirer(a.pu[0], a.pu[1])) * unite, `1${tauxDe(a.code).slice(1)}`);
      const remiseLigne = scenario === "remise_ligne" && k % 3 === 0 ? choisir([5, 10]) : 0;
      const brut = puTtc * BigInt(quantite);
      const net = brut - (remiseLigne ? multiplier(brut, (remiseLigne / 100).toFixed(2)) : 0n);
      return {
        designation: a.fr,
        reference: a.ref ?? `ALG-${String(k + 1).padStart(3, "0")}`,
        codeBarre: a.ref ? ean13(tirer) : "",
        codeTaxe: a.code,
        nature: a.nature ?? "marchandises",
        quantite,
        puTtc,
        remiseLigne,
        total: horsTaxe(net, tauxDe(a.code)),
        // Le bruit imprimé sous une ligne : numéros de série, « D1 **1.00 ».
        sousLignes: dense
          ? Array.from({ length: tirer(2, 5) }, (_, s) =>
              s === 0
                ? `S N : ${tirer(100000, 999999)}${tirer(100000000, 999999999)}`
                : choisir([
                    "SN:",
                    "D1 **1.00",
                    `D${tirer(1, 4)} **${quantite}.00`,
                    `S N : ${tirer(1000000, 9999999)}${tirer(10000000, 99999999)}`,
                  ]),
            )
          : a.serie
            ? [
                `S N : ${tirer(100000, 999999)}${tirer(100000000, 999999999)}`,
                ...(tirer(0, 2) ? ["D1 **1.00"] : []),
              ]
            : tirer(0, 4) === 0
              ? ["SN:"]
              : [],
      };
    });
    // Une page dense imprime au moins cent six rangées d'articles : des « SN: » vides s'ajoutent.
    for (
      let r = 0;
      dense && articles.reduce((s, a) => s + 1 + a.sousLignes.length, 0) < 106;
      r += 1
    )
      articles[r % articles.length].sousLignes.push("SN:");
  } else {
    const catalogue = achat
      ? scenario === "fodec"
        ? ACHATS.filter((a) => a.fodec)
        : scenario === "exonere"
          ? ACHATS.filter((a) => a.code === "EXO")
          : scenario === "taux_13"
            ? ACHATS.filter((a) => a.code === "TVA13")
            : scenario === "taux_7"
              ? ACHATS.filter((a) => a.code === "TVA07")
              : scenario === "plusieurs_taux"
                ? ACHATS.filter((a) => a.code !== "EXO")
                : ACHATS.filter((a) => a.code === "TVA19" && !a.fodec)
      : scenario === "export_usd"
        ? VENTES_EXPORT
        : scenario === "exonere"
          ? VENTES.filter((a) => a.code === "EXO")
          : scenario === "plusieurs_taux"
            ? VENTES
            : VENTES.filter((a) => a.code === "TVA19");
    const n = carnet ? tirer(2, 7) : scenario === "long" ? tirer(12, 16) : tirer(2, 9);
    let pris = tirerArticles(catalogue, n);
    if (scenario === "plusieurs_taux" && new Set(pris.map((a) => a.code)).size < 2)
      pris = [...pris, catalogue.find((a) => a.code !== pris[0].code)];
    articles = pris.map((a) => {
      const quantite = a.pu[1] > 1000 ? tirer(1, 4) : tirer(1, 25);
      const pu = BigInt(tirer(a.pu[0], a.pu[1])) * unite + BigInt(tirer(0, Number(unite)));
      return {
        designation: langue === "ar" ? a.ar : a.fr,
        designationAr: a.ar,
        codeTaxe: a.code,
        nature: a.nature ?? null,
        quantite,
        pu,
        total: pu * BigInt(quantite),
      };
    });
    tauxRemise = scenario === "remise" ? choisir(["0.05", "0.10", "0.03"]) : null;
    avecFodec = scenario === "fodec";
  }

  let pied;
  if (detail) {
    // Le ticket de détail : base par taux = Σ des HT de ses lignes, TVA par taux.
    const codes = [...new Set(articles.map((a) => a.codeTaxe))].sort();
    const parTaux = codes.map((code) => {
      const base = articles.filter((a) => a.codeTaxe === code).reduce((s, a) => s + a.total, 0n);
      return {
        code,
        taux: tauxDe(code),
        baseHt: base,
        baseTva: base,
        tva: multiplier(base, tauxDe(code)),
      };
    });
    const ht = parTaux.reduce((s, l) => s + l.baseHt, 0n);
    pied = {
      brut: ht,
      remise: 0n,
      ht,
      fodec: 0n,
      parTaux,
      tva: parTaux.reduce((s, l) => s + l.tva, 0n),
    };
  } else pied = piedDeFacture({ articles, tauxRemise, avecFodec });
  const { brut, remise, ht, fodec, parTaux, tva } = pied;
  const timbre =
    devise === DEVISE_DU_DOSSIER
      ? versMineur(droit("DROIT_TIMBRE", sens).fixedAmount, exposant)
      : 0n;
  const ttc = ht + fodec + tva + timbre;
  const droits = [];
  if (fodec > 0n) droits.push({ code: "FODEC", montant: fodec });
  if (timbre > 0n) droits.push({ code: "DROIT_TIMBRE", montant: timbre });

  /* le montant en lettres : sur le ticket de détail presque toujours, ailleurs un sur quatre */
  const nomDevise = devise === "TND" ? "dinars" : devise === "EUR" ? "euros" : "dollars";
  const enMots =
    `${enLettres(Number(ttc / unite))} ${nomDevise}` +
    (ttc % unite === 0n
      ? ""
      : ` et ${enLettres(Number(ttc % unite))} ${devise === "TND" ? "millimes" : "centimes"}`);
  const avecLettres = detail
    ? j % 5 !== 4
    : langue !== "ar" && (j % 4 === 0 || (carnet && j % 3 === 1));
  const lettres = avecLettres ? (detail && j % 2 === 1 ? enMots.toUpperCase() : enMots) : null;
  const phraseEnLettres = lettres
    ? detail
      ? `Arrêtée la présente pièce à la somme de: ${lettres}`
      : `Arrêtée la présente facture à la somme de : ${lettres}.`
    : null;

  /* ce qui s'imprime, champ par champ — clé par le chemin de la page */
  const { imprime, versConcept, concepts, pose, poseConcept } = lesPoses();

  const titre = detail
    ? "Bon de Livraison/Facture"
    : langue === "fr"
      ? "FACTURE"
      : langue === "ar"
        ? "فاتورة"
        : "FACTURE / فاتورة";
  poseConcept("type_document", titre);
  pose("issuer", emetteur.nom, "raison_sociale_emetteur", emetteur.nom);
  pose("document_date", dateImprimee, "date_operation", dateIso);
  pose("references.numero", numeroImprime, "numero_facture", numero);
  if (emetteur.matriculeImprime)
    pose(
      "references.matricule_fiscal",
      emetteur.matriculeImprime,
      "matricule_fiscal_emetteur",
      emetteur.matricule,
    );
  if (client.matriculeImprime)
    pose(
      "references.matricule_fiscal_client",
      client.matriculeImprime,
      "matricule_fiscal_client",
      client.matricule,
    );
  pose("nom_client", client.nom, "nom_client", client.nom);
  pose("adresse_client", client.adresse, "adresse_client", client.adresse);
  pose("adresse_emetteur", emetteur.adresse, "adresse_emetteur", emetteur.adresse);
  // Téléphone, fax, e-mail, site : un seul champ de la grille, chaque morceau imprimé.
  imprime.telephone_emetteur = emetteur.telephone;
  versConcept.telephone_emetteur = "telephone_email_emetteur.telephone";
  poseConcept("telephone_email_emetteur", {
    telephone: emetteur.telephone,
    ...(detail ? { fax: emetteur.fax, email: emetteur.email, site: emetteur.site } : {}),
  });

  // Le RC et le RIB de l'émetteur : toujours au ticket de détail ; ailleurs, souvent.
  const avecRc = detail || carnet || j % 3 !== 2;
  const avecRib = detail || (!carnet && j % 2 === 0);
  if (avecRc)
    pose("registre_commerce_emetteur", emetteur.rc, "registre_commerce_emetteur", emetteur.rc);
  if (avecRib) pose("rib_emetteur", emetteur.rib, "rib_emetteur", emetteur.rib);
  const modes = ["CARTE", "ESPECES", "CHEQUE", "VIREMENT", "TRAITE"];
  const modesFr = ["Carte bancaire", "Espèces", "Chèque", "Virement", "Traite"];
  const modesAr = ["بطاقة بنكية", "نقدا", "صك", "تحويل بنكي", "كمبيالة"];
  const avecMode = detail || j % 3 === 0;
  const k = tirer(0, modes.length);
  const mode = detail ? modes[k] : langue === "ar" ? modesAr[k] : modesFr[k];
  if (avecMode) pose("mode_reglement", mode, "mode_reglement", mode);
  if (detail)
    pose("code_client", client.code ?? `C${tirer(1000000, 9999999)}`, "code_client", client.code);
  const avecForme = !achat && !carnet && j % 2 === 1;
  if (avecForme)
    pose("forme_juridique", ALGORIA.forme, "forme_juridique_capital_emetteur", ALGORIA.forme);

  pose("totals.base_ht", montant(ht), "total_ht", dec(ht));
  // La TVA totale n'est pas un champ de la grille : elle ne vaut le montant
  // par taux que s'il n'y a qu'un taux.
  imprime["totals.vat"] = montant(tva);
  if (parTaux.length === 1) {
    versConcept["totals.vat"] = `montant_tva_par_taux[${pourcent(parTaux[0].taux)}]`;
    poseConcept(versConcept["totals.vat"], dec(tva));
  }
  pose("totals.ttc", montant(ttc), "total_ttc", dec(ttc));
  droits.forEach((d, i) =>
    pose(
      `other_charges[${i}].amount`,
      montant(d.montant),
      d.code === "FODEC" ? "montant_fodec" : "droit_timbre",
      dec(d.montant),
    ),
  );
  if (tauxRemise) {
    poseConcept("total_brut_ht", dec(brut));
    poseConcept("remise_globale", dec(remise));
  }
  // Le tableau par taux : dès qu'il y a plusieurs taux, ou un FODEC (la base de
  // la TVA n'est plus le HT). Le ticket de détail l'imprime aussi à plusieurs taux.
  const tableauParTaux = parTaux.length > 1 || fodec > 0n;
  parTaux.forEach((l, i) => {
    const t = pourcent(l.taux);
    if (tableauParTaux) {
      pose(`lines[${i}].base_ht`, montant(l.baseTva), `base_tva_par_taux[${t}]`, dec(l.baseTva));
      pose(`lines[${i}].vat_amount`, montant(l.tva), `montant_tva_par_taux[${t}]`, dec(l.tva));
    } else if (fodec === 0n) {
      // Un seul taux, sans droit dans l'assiette : la base imprimée est le total HT.
      poseConcept(`base_tva_par_taux[${t}]`, dec(l.baseTva));
    }
  });
  articles.forEach((a, i) => {
    pose(`articles[${i}].designation`, a.designation, `lignes[${i}].designation`, a.designation);
    pose(
      `articles[${i}].quantity`,
      nombre(a.quantite),
      `lignes[${i}].quantite`,
      String(a.quantite),
    );
    if (detail) {
      pose(
        `articles[${i}].unit_price_ttc`,
        montant(a.puTtc),
        `lignes[${i}].prix_unitaire_ttc`,
        dec(a.puTtc),
      );
      pose(`articles[${i}].reference`, a.reference, `lignes[${i}].reference_article`, a.reference);
      if (a.remiseLigne) poseConcept(`lignes[${i}].remise_ligne`, String(a.remiseLigne));
    } else
      pose(
        `articles[${i}].unit_price_ht`,
        montant(a.pu),
        `lignes[${i}].prix_unitaire_ht`,
        dec(a.pu),
      );
    pose(
      `articles[${i}].total_ht`,
      montant(a.total),
      `lignes[${i}].montant_ligne_ht`,
      dec(a.total),
    );
    poseConcept(`lignes[${i}].taux_tva_ligne`, pourcent(tauxDe(a.codeTaxe)));
  });
  if (lettres) pose("montant_en_lettres", lettres, "montant_en_lettres", lettres);
  // La devise est imprimée dès que la page porte sa marque : « DNT » après le
  // TTC (gabarit A), « (DT) » à côté du total (la facture classique, B à D). Le
  // carnet n'en porte pas, sauf une devise étrangère. Relevé par le banc sans IA,
  // le 4 novembre 2026 : la vérité la taisait, et le moteur, qui la lisait, était
  // compté comme inventant.
  if (devise !== DEVISE_DU_DOSSIER || !carnet) poseConcept("devise", devise);
  const exonere = parTaux.some((l) => l.code === "EXO");
  if (exonere) {
    const m =
      langue === "ar" ? "عملية معفاة من الأداء على القيمة المضافة" : "Opération exonérée de TVA";
    pose("mention_exoneration", m, "mention_suspension_exoneration", m);
  }
  if (devise === "USD")
    pose(
      "mention_export",
      "Export sale — outside the scope of Tunisian VAT / Vente à l'exportation, hors TVA",
      "mention_export",
      "Export sale — outside the scope of Tunisian VAT / Vente à l'exportation, hors TVA",
    );
  const conditions = detail ? choisir(MENTIONS_DE_DETAIL) : null;
  if (conditions) pose("conditions_generales", conditions, "conditions_generales", conditions);

  /* le réalisme, tiré ici pour que la vérité le sache */
  const capture = carnet ? g.capture : rendu === "pdf_image" ? choisir(["photo", "scan"]) : rendu;
  const realisme = effetsDeLaPriseDeVue(capture, tirer);
  const papier = capture === "photo" || capture === "scan";
  const tampon =
    carnet || (papier && tirer(0, 5) < 3) || (rendu === "pdf" && !detail && tirer(0, 4) === 0);
  const signature = carnet || (papier && tirer(0, 2) === 0);
  if (tampon) realisme.push("tampon");
  if (signature) realisme.push("signature");
  let annotation = null;
  if (papier && !carnet && achat && tirer(0, 4) === 0) {
    const regle = new Date(jour.getTime() + tirer(2, 21) * 86_400_000);
    const r = `${deux(regle.getUTCDate())}/${deux(regle.getUTCMonth() + 1)}`;
    annotation =
      langue === "ar"
        ? choisir(["خالص", `تم الاستلام ${r}`])
        : choisir([
            `Payé le ${r}`,
            "Reçu",
            `Réglé chq n° ${tirer(1000000, 9999999)}`,
            `Reçu le ${r}`,
          ]);
    realisme.push("annotation");
  }
  if (carnet) {
    realisme.push("souche_carbone");
    if (j % 2 === 0) realisme.push("ratures");
    if (j % 3 === 1) realisme.push("deux_ecritures");
    if (chiffres === "orientaux" || orientaux) realisme.push("chiffres_orientaux");
  }
  // Le tampon d'un carnet porte le matricule de l'émetteur, l'en-tête non ; celui
  // d'une facture imprimée porte nom, ville et téléphone : un matricule par page.
  const tamponPorteLeMatricule = carnet;
  if (tampon) poseConcept("cachet_emetteur", true);
  if (signature) poseConcept("signature_emetteur", true);
  if (annotation && /^(Reçu|تم الاستلام)/.test(annotation)) poseConcept("visa_client", true);
  const ratures =
    carnet && realisme.includes("ratures")
      ? articles.slice(0, Math.min(2, articles.length)).map((a, i) => ({
          chemin: i === 0 ? `articles[0].total_ht` : `articles[${i}].quantity`,
          barre:
            i === 0
              ? montant(a.total + BigInt(tirer(1, 9)) * 10n * unite)
              : nombre(a.quantite + tirer(1, 4)),
        }))
      : [];

  /* l'écriture juste, avec les mêmes modules que le jeu synthétique */
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
    immobilisation: false,
    dateIso,
  };
  const ecriture = ecritureAttendue(facture, {}, notes);
  const issue = {
    type: "ecriture",
    ...(devise !== DEVISE_DU_DOSSIER ? { reserve: "cours_de_change" } : {}),
  };
  const aTrancher = achat
    ? null
    : { reserve: "nature_de_vente", ecriture: ecritureAttendue(facture, { auRepli: true }, []) };
  if (fodec > 0n)
    notes.push(
      fodecAuCout
        ? "INCERTAIN — FODEC à l'achat incorporé au coût, sur sa ligne au compte de la charge (fodec.traitement du pack), et compris dans la base de la TVA"
        : "INCERTAIN — FODEC à l'achat imputé au compte du pack, et compris dans la base de la TVA",
    );
  if (!achat)
    notes.push(
      "INCERTAIN — compte de vente par nature d'article (ventes.compte = par_nature_article, défaut du CEO du 31/10/2026) : 705 prestations, 706 annexes, 707 marchandises ; repli au compte des produits finis, avec la réserve « nature de la vente à préciser »",
    );
  if (detail)
    notes.push(
      "Piège : le titre « Bon de Livraison/Facture » contient « bon de livraison », que ref.titres_de_piece refuse (rejet) — la pièce EST une facture (TVA, timbre, matricules) : l'issue juste est une écriture ; un refus sur le titre est un refus injuste. « Total avec Timbre » vaut HT + timbre, jamais le TTC.",
      "INCERTAIN — timbre de 1,000 DT (droit fixe du référentiel) : le barème des grandes surfaces (1,500 / 2,000 DT, ref.baremes_des_droits) ne s'applique pas à ces enseignes fictives.",
    );
  if (annotation)
    notes.push(`Annotation manuscrite « ${annotation} » : ni la date ni le montant de la pièce.`);
  if (ratures.length > 0)
    notes.push(
      "Ratures : la valeur barrée n'est jamais la valeur attendue ; la valeur juste est écrite à côté.",
    );
  const cours = devise === DEVISE_DU_DOSSIER ? null : coursDe(devise);

  /* les champs du jeu synthétique, aux mêmes noms */
  const champs = {
    document_kind: sens,
    issuer: emetteur.nom,
    document_date: dateIso,
    currency: devise,
    "references.numero": numero,
    "references.matricule_fiscal": emetteur.matricule,
    "references.matricule_fiscal_client": client.matricule,
    "totals.base_ht": dec(ht),
    "totals.vat": dec(tva),
    "totals.ttc": dec(ttc),
  };
  parTaux.forEach((l, i) => {
    champs[`lines[${i}].tax_code`] = l.code;
    champs[`lines[${i}].base_ht`] = dec(tableauParTaux ? l.baseTva : l.baseHt);
    champs[`lines[${i}].vat_amount`] = dec(l.tva);
  });
  droits.forEach((d, i) => {
    champs[`other_charges[${i}].code`] = d.code;
    champs[`other_charges[${i}].amount`] = dec(d.montant);
  });
  articles.forEach((a, i) => {
    champs[`articles[${i}].quantity`] = dec(BigInt(a.quantite) * unite);
    if (!detail) champs[`articles[${i}].unit_price_ht`] = dec(a.pu);
    champs[`articles[${i}].total_ht`] = dec(a.total);
  });

  return {
    id,
    synthetique: true,
    provenance: `jeu d'ALGORIA, composé par outils/jeu-algoria/composer.mjs (graine ${graine}) : facture inventée ; seule partie réelle, ALGORIA FACTORY SARL et son matricule (à la demande du dirigeant)`,
    type: sens,
    grille: "facture",
    langue,
    rendu,
    capture: rendu === "pdf" ? null : capture,
    gabarit,
    scenario,
    realisme,
    dossier: { nom: ALGORIA.nom, identifiantFiscal: ALGORIA.matricule },
    piece: {
      sens,
      titre,
      devise,
      exposant,
      format,
      emetteur: { ...emetteur, role: achat ? "fournisseur" : "dossier" },
      client: { ...client, role: achat ? "dossier" : "client" },
      date: dateImprimee,
      chargee: detail ? choisir(VENDEURS) : null,
      votreReference: detail
        ? choisir([
            "Facture Vente en ligne",
            "Vente comptoir",
            "Commande téléphonique",
            "Retrait magasin",
          ])
        : null,
      articles: articles.map((a) => ({
        designation: a.designation,
        designationAr: a.designationAr ?? null,
        codeTaxe: a.codeTaxe,
        tauxImprime: `${pourcent(tauxDe(a.codeTaxe))} %`,
        ...(detail
          ? {
              reference: a.reference,
              codeBarre: a.codeBarre,
              remise: a.remiseLigne ? `${a.remiseLigne},00` : "",
              taux: pourcent(tauxDe(a.codeTaxe)),
              sousLignes: a.sousLignes,
            }
          : {}),
      })),
      tableauParTaux,
      parTaux: parTaux.map((l) => ({ code: l.code, tauxImprime: `${pourcent(l.taux)} %` })),
      remise: tauxRemise
        ? {
            tauxImprime: `${versMineur(tauxRemise, 2)} %`,
            brut: montant(brut),
            montant: montant(remise),
          }
        : null,
      droits: droits.map((d) => d.code),
      totalAvecTimbre: detail ? montant(ht + timbre) : null,
      enLettres: phraseEnLettres,
      tampon: tampon ? { porteLeMatricule: tamponPorteLeMatricule } : null,
      annotation,
      ratures,
      imprime,
      versConcept,
    },
    graineDuRendu: tirer(1, 2 ** 31),
    attendu: {
      champs,
      ecriture,
      issue,
      ...(aTrancher ? { aTrancher } : {}),
      ...(cours ? { cours: { devise, taux: cours.taux, unite: cours.unite, date: dateIso } } : {}),
      referentiel: RELEVE_DU_REFERENTIEL,
      notes,
      concepts,
    },
  };
}
