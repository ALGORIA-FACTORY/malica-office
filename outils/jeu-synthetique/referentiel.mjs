/**
 * Le référentiel des jeux fabriqués, et l'écriture juste qu'il donne.
 *
 * ================================================================= POURQUOI ICI
 *
 * Le jeu synthétique (`composer.mjs`) et le jeu d'ALGORIA
 * (`outils/jeu-algoria/`) écrivent la même chose : des factures dont les
 * COMPTES, les taux et le timbre viennent du référentiel, et dont les montants
 * se calculent depuis la spécification, en entiers (`montants.mjs`). Ce module
 * lit le référentiel une fois — l'instantané relevé en base
 * (`apps/api/src/scan/referentiel-d-essai.json`) et ce qu'il ne porte pas
 * (`referentiel-complementaire.json`) — et compose le pied et l'écriture
 * attendus. Il n'importe rien du moteur mesuré : rien de circulaire.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { multiplier, versDecimal } from "./montants.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");

export const REFERENTIEL = JSON.parse(
  readFileSync(join(RACINE, "apps/api/src/scan/referentiel-d-essai.json"), "utf8"),
);
export const COMPLEMENT = JSON.parse(
  readFileSync(join(ICI, "referentiel-complementaire.json"), "utf8"),
);

/* ------------------------------------------------------------ le référentiel */

export const tauxDe = (code) => {
  const t = REFERENTIEL.taux.find((x) => x.code === code && x.validTo === null);
  if (!t) throw new Error(`taux ${code} absent du référentiel`);
  return t.rate;
};
const imputation = (sens, code) => {
  const m = REFERENTIEL.imputations.find((x) => x.documentKind === sens && x.taxCode === code);
  if (!m) throw new Error(`imputation ${sens}/${code} absente du référentiel`);
  return m;
};
export const droit = (code, sens) => {
  const d = REFERENTIEL.droits.find((x) => x.code === code && x.documentKind === sens);
  if (!d) throw new Error(`droit ${code}/${sens} absent du référentiel`);
  return d;
};
export const exposantDe = (devise) => {
  const d = REFERENTIEL.devises[devise];
  if (!d) throw new Error(`devise ${devise} absente du référentiel`);
  return d.exposant;
};
export const DEVISE_DU_DOSSIER = REFERENTIEL.devise;
export const coursDe = (devise) => COMPLEMENT.cours.find((c) => c.devise === devise);
/*
 * Le compte d'une NATURE d'article vendu (`ref.natures_de_vente`, relevé au
 * pack) : le défaut du CEO (`ventes.compte` = `par_nature_article`, 31 octobre
 * 2026). Le repli est le compte d'une vente dont le Socle ne prouve pas la
 * nature. Seuls les comptes viennent du référentiel ; la nature de chaque
 * article est celle de la SPÉCIFICATION (le catalogue du jeu), jamais
 * celle que les motifs du Socle reconnaîtraient.
 */
const compteDeLaNature = (code) => {
  const n = REFERENTIEL.naturesDeVente.find((x) => x.code === code);
  if (!n) throw new Error(`nature de vente ${code} absente du référentiel`);
  return n.compte;
};
const COMPTE_DE_REPLI = REFERENTIEL.naturesDeVente.find((x) => x.repli)?.compte;
if (!COMPTE_DE_REPLI) throw new Error("aucune nature de vente de repli au référentiel");
/*
 * Les droits qu'un ACHAT incorpore au coût (`fodec.traitement`, relevé au pack
 * par la fonction même de la proposition) : leur ligne porte le compte de la
 * charge, et reste une ligne à part. Absents : le compte du pack (6652).
 */
const DROITS_AU_COUT = new Set(REFERENTIEL.droitsAuCout);
export const fodecAuCout = DROITS_AU_COUT.has(COMPLEMENT.fodec.code);

/* ------------------------------------------------------------------ le pied */

/**
 * Le pied d'une facture aux prix HT : brut, remise, HT net, FODEC, et une
 * ligne par code de taux (base HT, base de la TVA, TVA). La remise ne porte
 * que sur une facture à un seul taux (toute la base) ; le FODEC entre dans
 * l'assiette de la TVA (Code de la TVA, art. 6-I) d'une facture à un taux.
 * Chaque article porte `codeTaxe` et `total` (HT, en unités mineures).
 */
export function piedDeFacture({ articles, tauxRemise, avecFodec }) {
  const brut = articles.reduce((s, a) => s + a.total, 0n);
  const remise = tauxRemise ? multiplier(brut, tauxRemise) : 0n;
  const ht = brut - remise;
  const fodec = avecFodec ? multiplier(ht, COMPLEMENT.fodec.taux) : 0n;
  const codes = [...new Set(articles.map((a) => a.codeTaxe))].sort();
  const parTaux = codes.map((code) => {
    const baseArticles = articles
      .filter((a) => a.codeTaxe === code)
      .reduce((s, a) => s + a.total, 0n);
    const baseHt = codes.length === 1 ? ht : baseArticles;
    const baseTva =
      baseHt + (COMPLEMENT.fodec.entreDansLaBaseDeLaTva && codes.length === 1 ? fodec : 0n);
    const tva = multiplier(baseTva, tauxDe(code));
    return { code, taux: tauxDe(code), baseHt, baseTva, tva };
  });
  const tva = parTaux.reduce((s, l) => s + l.tva, 0n);
  return { brut, remise, ht, fodec, parTaux, tva };
}

/* ---------------------------------------------------------------- l'écriture */

/**
 * L'écriture juste — comptes du référentiel, montants de la spécification.
 *
 * `f` : la facture (`sens`, `devise`, `exposant`, `parTaux`, `articles` avec
 * leur `nature` pour une vente, `droits` [{ code, montant }], `ttc`, `tva`,
 * `immobilisation`, `dateIso`). `enCharge` : l'imputation du paramétrage pour
 * une immobilisation ; `auRepli` : une vente au compte de repli, toutes
 * natures confondues, par taux. Les notes (écart d'arrondi, cours) s'ajoutent
 * à `notes`.
 */
export function ecritureAttendue(f, { enCharge = false, auRepli = false } = {}, notes = []) {
  const { sens, devise, exposant, parTaux, articles, droits, ttc, tva } = f;
  const dec = (m) => versDecimal(m, exposant);
  const lignes = [];
  const debit = sens === "facture_achat";
  const cours = devise === DEVISE_DU_DOSSIER ? null : coursDe(devise);
  const exposantDossier = exposantDe(DEVISE_DU_DOSSIER);
  // m × taux ÷ unité, à l'exposant du dossier, arrondi au pair une seule fois.
  const conv = (m) =>
    cours
      ? multiplier(m * 10n ** BigInt(exposantDossier - exposant), cours.taux, { pair: true }) /
        BigInt(cours.unite)
      : m;
  const decD = (m) => versDecimal(m, exposantDossier);
  // Les bases, par compte principal ; la TVA, par code ; les droits, par compte.
  // Une vente : par compte de sa NATURE et par taux, chaque base avec son code
  // (`ventes.compte`) ; une nature par article, ventilée par leurs totaux.
  const bases = new Map();
  // Le régime de chaque base : une base sans TVA (exonérée, export) dit son
  // code, sans quoi elle manque à la déclaration — la règle du forçage
  // (`refus.ecriture.taxe_sans_tva`, revue de #140) ; découvert par la
  // recette sur le staging (1er novembre 2026).
  const codesDesBases = new Map();
  const ajouter = (cle, m) => bases.set(cle, (bases.get(cle) ?? 0n) + m);
  for (const l of parTaux) {
    if (sens === "facture_vente") {
      const siens = articles.filter((a) => a.codeTaxe === l.code);
      const natures = [...new Set(siens.map((a) => a.nature))];
      if (auRepli || natures.length === 1) {
        ajouter(
          `${auRepli ? COMPTE_DE_REPLI : compteDeLaNature(natures[0])}|${l.code}`,
          conv(l.baseHt),
        );
        continue;
      }
      // Une ventilation en devise demanderait un arrondi : le jeu n'en compose pas.
      if (cours) throw new Error("vente mêlée en devise : non composée");
      for (const a of siens) ajouter(`${compteDeLaNature(a.nature)}|${l.code}`, a.total);
      continue;
    }
    const compte =
      f.immobilisation && !enCharge
        ? COMPLEMENT.immobilisation.compte
        : imputation(sens, l.code).mainAccount;
    ajouter(compte, conv(l.baseHt));
    codesDesBases.set(compte, [...(codesDesBases.get(compte) ?? []), l.code]);
  }
  const tvas = parTaux.map((l) => ({
    code: l.code,
    compte: imputation(sens, l.code).vatAccount,
    m: conv(l.tva),
  }));
  // Le compte de la charge, celui du premier taux, comme la proposition.
  const compteDeCharge = imputation(sens, parTaux[0].code).mainAccount;
  const lesDroits = droits.map((d) => ({
    compte:
      sens === "facture_achat" && DROITS_AU_COUT.has(d.code)
        ? compteDeCharge
        : droit(d.code, sens).accountCode,
    m: conv(d.montant),
  }));
  const total = conv(ttc);
  // L'écart d'arrondi de la conversion va à la plus grande base (`change.ecart`).
  const somme =
    [...bases.values()].reduce((s, m) => s + m, 0n) +
    tvas.reduce((s, t) => s + t.m, 0n) +
    lesDroits.reduce((s, d) => s + d.m, 0n);
  if (somme !== total) {
    const [plusGrand] = [...bases.entries()].sort((a, b) =>
      b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
    );
    bases.set(plusGrand[0], plusGrand[1] + (total - somme));
    notes.push(
      `écart d'arrondi de conversion ${decD(total - somme)} porté à la base ${plusGrand[0]} (change.ecart = ${REFERENTIEL.change.ecart})`,
    );
  }
  const imp = imputation(sens, parTaux[0].code);
  const posePiece = (compte, m, code) => {
    if (m === 0n) return;
    lignes.push(debit ? [compte, decD(m), "0", code] : [compte, "0", decD(m), code]);
  };
  // La clé d'une base : son compte, et son code de taux pour une vente.
  const sansTva = tvas.every((t) => t.m === 0n);
  for (const [cle, m] of bases) {
    const [compte, code] = cle.split("|");
    const codes = [...new Set(codesDesBases.get(cle) ?? [])];
    posePiece(compte, m, code ?? (sansTva && codes.length === 1 ? codes[0] : undefined));
  }
  for (const t of tvas) posePiece(t.compte, t.m, t.code);
  for (const d of lesDroits) posePiece(d.compte, d.m);
  lignes.push(
    debit
      ? [imp.counterpartyAccount, "0", decD(total)]
      : [imp.counterpartyAccount, decD(total), "0"],
  );
  const ecriture = {
    journal: imp.journalCode,
    lignes: lignes.map((l) => (l[3] ? l : l.slice(0, 3))),
  };
  if (cours) {
    notes.push(
      `converti au cours FICTIF ${cours.taux} ${DEVISE_DU_DOSSIER} pour ${cours.unite} ${devise}, publié le ${f.dateIso} (app.cours_applicable : ${REFERENTIEL.change.dateRetenue}, recul ${REFERENTIEL.change.recul} jours)`,
    );
    if (parTaux.length === 1 && droits.length === 0) {
      ecriture.origines = [
        [[...bases.keys()][0].split("|")[0], dec(parTaux[0].baseHt)],
        ...(tva === 0n ? [] : [[tvas[0].compte, dec(tva)]]),
        [imp.counterpartyAccount, dec(ttc)],
      ];
    }
  }
  return ecriture;
}

/** La ligne `referentiel` d'un cas : le relevé dont viennent ses comptes. */
export const RELEVE_DU_REFERENTIEL = `pack ${REFERENTIEL.juridiction}, relevé au ${REFERENTIEL.jour} (apps/api/src/scan/referentiel-d-essai.json) et referentiel-complementaire.json`;
