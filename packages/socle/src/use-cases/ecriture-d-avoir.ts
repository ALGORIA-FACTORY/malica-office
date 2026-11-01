/**
 * Cas d'usage : l'écriture d'un AVOIR lié à sa facture d'origine
 * (réglage `avoirs.traitement` = `lie_facture`, décidé par le CEO le
 * 31 octobre 2026).
 *
 * ================================================================= LA RÈGLE
 *
 * Code TVA art. 9 (point 5) ; pratique de la recherche du 31 octobre 2026 :
 * une annulation se passe en EXTOURNE de l'écriture de la facture ; une
 * réduction (rabais, remise, ristourne) au compte des RRR — accordés pour une
 * vente, obtenus pour un achat (`ref.comptes_de_rabais`, par préfixe du compte
 * d'origine). Le réglage `avoirs.ecriture` dit lequel : toujours l'un, toujours
 * l'autre, ou selon l'avoir (total : extourne ; partiel : rabais).
 *
 * Les MONTANTS sont ceux que l'avoir imprime, taux par taux (R2) — jamais une
 * règle de trois sur la facture. Les COMPTES sont ceux de l'écriture prise en
 * charge de la facture : la contrepartie, la TVA de chaque taux, la base de
 * chaque taux (au prorata de ses lignes, quand la facture en porte plusieurs),
 * les droits. Une TVA que la facture n'a pas déduite (dossier non assujetti)
 * rejoint la base, comme à la facture.
 *
 * Plusieurs lignes de l'avoir au même taux (ou au même droit) se cumulent
 * AVANT d'être comparées et réparties, et chaque ligne de la facture garde
 * son SOLDE : ce qu'une reprise a pris n'est plus disponible pour la suivante
 * (revue de #161 : deux lignes à 19 % reprenaient chacune toute la TVA du
 * taux).
 *
 * ========================================================== LE DROIT AU COÛT
 *
 * Un achat dont le FODEC est porté au coût (`fodec.traitement`,
 * `droitsAuCout`) l'inscrit sur le compte de la CHARGE, en une ligne à part au
 * libellé du droit (`buildProposal`) : son compte le range « base ». La
 * lecture de la facture dit le droit, ce libellé et son montant
 * (`droitsDeLaFacture`) : la ligne de base sans code de taxe qui porte
 * exactement ce libellé et ce montant, et elle seule, redevient la ligne de
 * ce droit. Quand rien ne la désigne ainsi (le cabinet l'a reprise), l'avoir
 * qui reprend TOUTE la facture en extourne — chaque droit, chaque TVA, chaque
 * base et le total imprimés égaux à ceux de la facture — se propose quand
 * même, ligne pour ligne, avec la réserve `droit_au_cout` ; tout autre avoir
 * se refuse (`droit_au_cout_non_attribue`, ou l'excès, ou le hors facture,
 * nommés) : sa part du droit ne se devine pas, et un montant imprimé n'est
 * jamais remplacé par celui de la facture.
 *
 * ================================================================ CE QUI REFUSE
 *
 * Rien n'est proposé — et le refus se nomme — quand l'avoir excède la facture
 * (au total, ou sur un taux, ou sur un droit), qu'il porte un taux ou un droit
 * que la facture n'a pas, que la facture ne se lit pas comme une facture, ou
 * que l'écriture ne s'équilibrerait pas au millime. Aucune valeur n'est
 * devinée ; l'écart d'un prorata va à la ligne la plus forte (plus forts
 * restes), jamais au hasard.
 */

import { composerLibelle, nomDeLaNature } from "../engines/libelle.ts";
import type { JournalLineV1, PivotV1 } from "../contracts/pivot.v1.ts";
import { periodeDeTva } from "../exercice.ts";
import { depuisUniteMineure, enUnitesExactes } from "../somme-decimale.ts";

/** Ce qu'est une ligne de la facture pour son dossier (`app.nature_des_comptes`). */
export type NatureDeLigne = "base" | "tva" | "droit" | "tiers" | "autre";

export interface LigneDeLaFacture {
  account_code: string;
  libelle: string;
  debit: string;
  credit: string;
  tax_code: string | null;
  nature: NatureDeLigne;
  /** Le code du droit hors TVA, pour une ligne de droit. */
  droit_code: string | null;
}

/** Ce que l'avoir imprime, normalisé par le jugement. */
export interface MontantsDeLAvoir {
  bases: ReadonlyArray<{ code: string; ht: string; tva: string }>;
  droits: ReadonlyArray<{ code: string; montant: string }>;
  ttc: string;
}

/**
 * Un droit hors TVA que la LECTURE de la facture porte : son code, le libellé
 * que son écriture lui a donné (le libellé imprimé, sinon celui du pack) et
 * son montant.
 */
export interface DroitDeLaFacture {
  code: string;
  libelle: string;
  montant: string;
}

/** Les options du réglage `avoirs.ecriture`. */
export type EcritureDAvoir = "selon_avoir" | "extourne" | "rabais";

/** Pourquoi l'avoir ne se propose pas : un code stable, que l'écran traduit. */
export type RefusDAvoir =
  | "avoir_excede_la_facture"
  | "avoir_hors_facture"
  | "avoir_desequilibre"
  | "facture_illisible"
  | "droit_au_cout_non_attribue";

export type ResultatDAvoir =
  | {
      ok: true;
      /** Le traitement appliqué : l'extourne, ou le rabais. */
      traitement: "extourne" | "rabais";
      journal: string;
      libelle: string;
      pivot: PivotV1;
      lignes: Array<{
        account_code: string;
        libelle: string;
        debit: string;
        credit: string;
        tax_code: string | null;
      }>;
      /** Un droit au coût que rien ne désignait : l'extourne exacte, à vérifier. */
      reserves: Array<{ code: "droit_au_cout"; droit: string }>;
    }
  | { ok: false; refus: RefusDAvoir };

/** Répartit `total` au prorata de `poids` (entiers), les plus forts restes d'abord. */
function repartir(total: bigint, poids: readonly bigint[]): bigint[] {
  const somme = poids.reduce((s, p) => s + p, 0n);
  if (somme <= 0n) return poids.map(() => 0n);
  const parts = poids.map((p) => (total * p) / somme);
  let reste = total - parts.reduce((s, p) => s + p, 0n);
  const ordre = poids
    .map((p, i) => ({ i, r: (total * p) % somme }))
    .sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of ordre) {
    if (reste === 0n) break;
    parts[i]! += 1n;
    reste -= 1n;
  }
  return parts;
}

/** Cumule les éléments de même code, dans l'ordre de leur première apparition. */
function cumuler<T extends { code: string }>(xs: readonly T[], ajouter: (a: T, b: T) => T): T[] {
  const parCode = new Map<string, T>();
  for (const x of xs) {
    const deja = parCode.get(x.code);
    parCode.set(x.code, deja ? ajouter(deja, x) : x);
  }
  return [...parCode.values()];
}

/** Additionne `montant` au code, dans une table de sommes. */
function ajouterA(m: Map<string, bigint>, code: string, montant: bigint) {
  m.set(code, (m.get(code) ?? 0n) + montant);
}

/**
 * Le repli « extourne exacte » d'un droit au coût que rien ne désigne : ce
 * qui, dans l'avoir, n'est pas ce que la facture porte — `null` quand chaque
 * composante l'est. Un taux ou un droit que la facture n'a pas est hors
 * facture ; un droit ou une TVA déduite au-delà du sien excède la facture ;
 * tout autre écart (un droit en moins compensé sur la base, une TVA déduite
 * rendue à la base) laisse la part du droit indevinable.
 */
function ecartAuRepli(x: {
  lignes: readonly LigneDeLaFacture[];
  bases: ReadonlyArray<{ code: string; ht: bigint; tva: bigint }>;
  droits: ReadonlyArray<{ code: string; montant: bigint }>;
  cote: (l: LigneDeLaFacture) => bigint;
  codeUnique: string | null;
  nonAttribues: ReadonlySet<string>;
  droitsDeLaFacture: readonly DroitDeLaFacture[];
  u: (s: string) => bigint;
}): RefusDAvoir | null {
  // La facture, composante par composante.
  const droitsF = new Map<string, bigint>();
  const tvasF = new Map<string, bigint>();
  const basesCodees = new Map<string, bigint>();
  let basesSansCode = 0n;
  for (const l of x.lignes) {
    if (l.nature === "droit" && l.droit_code) ajouterA(droitsF, l.droit_code, x.cote(l));
    else if (l.nature === "tva" && l.tax_code) ajouterA(tvasF, l.tax_code, x.cote(l));
    else if (l.nature === "base" && l.tax_code) ajouterA(basesCodees, l.tax_code, x.cote(l));
    else if (l.nature === "base") basesSansCode += x.cote(l);
  }
  for (const d of x.droitsDeLaFacture)
    if (x.nonAttribues.has(d.code)) ajouterA(droitsF, d.code, x.u(d.montant));
  // L'avoir : ce qui va à la base d'un taux, TVA non déduite comprise.
  const versLaBase = new Map(
    x.bases.map((b) => [b.code, b.ht + (tvasF.has(b.code) ? 0n : b.tva)] as const),
  );
  const tvasA = new Map(x.bases.map((b) => [b.code, b.tva] as const));
  const droitsA = new Map(x.droits.map((d) => [d.code, d.montant] as const));

  // Hors facture : un taux qu'aucune ligne ne porte, un droit qu'elle n'a pas.
  const tauxConnu = (code: string) =>
    basesCodees.has(code) ||
    tvasF.has(code) ||
    (basesSansCode > 0n && (x.codeUnique === null || x.codeUnique === code));
  if (
    x.bases.some((b) => (b.ht !== 0n || b.tva !== 0n) && !tauxConnu(b.code)) ||
    x.droits.some((d) => d.montant !== 0n && !droitsF.has(d.code))
  )
    return "avoir_hors_facture";
  // Au-delà de la facture, sur un droit ou sur une TVA déduite.
  if (
    [...droitsA].some(([code, m]) => m > (droitsF.get(code) ?? 0n)) ||
    [...tvasF].some(([code, m]) => (tvasA.get(code) ?? 0n) > m)
  )
    return "avoir_excede_la_facture";
  // Chaque droit et chaque TVA déduite exactement, chaque base codée au moins.
  const exacte =
    [...droitsF].every(([code, m]) => (droitsA.get(code) ?? 0n) === m) &&
    [...tvasF].every(([code, m]) => (tvasA.get(code) ?? 0n) === m) &&
    [...basesCodees].every(([code, m]) => (versLaBase.get(code) ?? 0n) >= m);
  return exacte ? null : "droit_au_cout_non_attribue";
}

export function ecritureDAvoir(p: {
  pieceId: string;
  sens: "facture_achat" | "facture_vente";
  date: string;
  devise: string;
  decimales: number;
  /** L'écriture prise en charge de la facture d'origine : son journal, ses lignes rangées. */
  facture: { journal: string; lignes: readonly LigneDeLaFacture[] };
  avoir: MontantsDeLAvoir;
  ecriture: EcritureDAvoir;
  /** Le compte des RRR pour un compte d'origine (`ref.comptes_de_rabais`) ; nul : le compte d'origine. */
  compteDeRabais: (compteDOrigine: string) => string | null;
  /** Les faits du libellé : la contrepartie et le numéro imprimés sur l'avoir. */
  contrepartie: string | null;
  reference: string | null;
  /** Les droits que la lecture de la facture porte : ceux portés au coût s'y retrouvent. */
  droitsDeLaFacture: readonly DroitDeLaFacture[];
}): ResultatDAvoir {
  const n = p.decimales;
  const u = (s: string) => enUnitesExactes(s, n);
  const achat = p.sens === "facture_achat";
  // Le montant d'une ligne de la facture, du côté de la pièce (débit d'un
  // achat, crédit d'une vente) ; la contrepartie, du côté opposé.
  const cote = (l: LigneDeLaFacture) =>
    achat ? u(l.debit) - u(l.credit) : u(l.credit) - u(l.debit);
  // Un droit au coût redevient la ligne de son droit quand la lecture de la
  // facture la désigne seule : base, sans code de taxe, son libellé, son montant.
  const nonAttribues = new Set<string>();
  const attribues = new Map<LigneDeLaFacture, string>();
  for (const d of p.droitsDeLaFacture) {
    if (p.facture.lignes.some((l) => l.nature === "droit" && l.droit_code === d.code)) continue;
    const designees = p.facture.lignes.filter(
      (l) =>
        l.nature === "base" &&
        l.tax_code === null &&
        l.libelle === d.libelle &&
        cote(l) === u(d.montant) &&
        !attribues.has(l),
    );
    if (designees.length === 1) attribues.set(designees[0]!, d.code);
    else nonAttribues.add(d.code);
  }
  const lignes = p.facture.lignes.map((l): LigneDeLaFacture => {
    const droit = attribues.get(l);
    return droit ? { ...l, nature: "droit", droit_code: droit } : l;
  });
  const tiers = lignes.filter((l) => l.nature === "tiers");
  const totalFacture = -tiers.reduce((s, l) => s + cote(l), 0n);
  // Une facture : ses contreparties d'un côté, tout le reste de l'autre, et
  // rien qui ne soit ni base, ni TVA, ni droit, ni contrepartie.
  if (
    tiers.length === 0 ||
    totalFacture <= 0n ||
    lignes.some((l) => l.nature === "autre" || (l.nature === "tiers" ? cote(l) > 0n : cote(l) < 0n))
  )
    return { ok: false, refus: "facture_illisible" };

  const lues = p.avoir.bases.map((b) => ({ code: b.code, ht: u(b.ht), tva: u(b.tva) }));
  const droitsLus = p.avoir.droits.map((d) => ({ code: d.code, montant: u(d.montant) }));
  const totalAvoir =
    lues.reduce((s, b) => s + b.ht + b.tva, 0n) + droitsLus.reduce((s, d) => s + d.montant, 0n);
  if (totalAvoir !== u(p.avoir.ttc) || totalAvoir <= 0n || lues.some((b) => b.ht < 0n))
    return { ok: false, refus: "avoir_desequilibre" };
  if (totalAvoir > totalFacture) return { ok: false, refus: "avoir_excede_la_facture" };
  // Ce que l'avoir imprime, CUMULÉ par taux et par droit : deux lignes au
  // même taux reprennent ensemble, jamais chacune toute la facture.
  const bases = cumuler(lues, (a, b) => ({ code: a.code, ht: a.ht + b.ht, tva: a.tva + b.tva }));
  const droits = cumuler(droitsLus, (a, b) => ({ code: a.code, montant: a.montant + b.montant }));
  const traitement =
    p.ecriture === "selon_avoir"
      ? totalAvoir === totalFacture
        ? "extourne"
        : "rabais"
      : p.ecriture;

  // Le code d'une base de la facture : le sien, ou le seul taux de la facture.
  const codesDeTva = [...new Set(lignes.filter((l) => l.nature === "tva").map((l) => l.tax_code))];
  const codeUnique = codesDeTva.length === 1 ? codesDeTva[0]! : null;
  const codeDe = (l: LigneDeLaFacture) => l.tax_code ?? codeUnique;
  const tvasDu = (code: string) => lignes.filter((l) => l.nature === "tva" && l.tax_code === code);

  // Ce que l'avoir retire, par compte, côté pièce.
  const retraits: Array<{ ligne: LigneDeLaFacture; montant: bigint; code: string | null }> = [];
  // Le SOLDE de chaque ligne de la facture, positif : ce qui reste à reprendre.
  // Une contrepartie se porte du côté opposé : son solde, et ce qu'on lui
  // retire, changent de signe.
  const signe = (l: LigneDeLaFacture) => (l.nature === "tiers" ? -1n : 1n);
  const solde = new Map(lignes.map((l) => [l, cote(l) * signe(l)]));
  /** Retire `montant` des soldes de `pool`, à leur prorata ; faux s'il les excède. */
  const retirer = (pool: readonly LigneDeLaFacture[], montant: bigint, code: string | null) => {
    const soldes = pool.map((l) => solde.get(l)!);
    if (montant > soldes.reduce((s, x) => s + x, 0n)) return false;
    const parts = repartir(montant, soldes);
    pool.forEach((l, i) => {
      solde.set(l, soldes[i]! - parts[i]!);
      retraits.push({ ligne: l, montant: parts[i]! * signe(l), code });
    });
    return true;
  };

  const reserves: Array<{ code: "droit_au_cout"; droit: string }> = [];
  const sansLigne = droits.find(
    (d) =>
      d.montant !== 0n &&
      nonAttribues.has(d.code) &&
      !lignes.some((l) => l.nature === "droit" && l.droit_code === d.code),
  );
  if (sansLigne) {
    /*
     * Le droit au coût ne se retrouve pas. Seule l'extourne de TOUTE la
     * facture se passe de lui : chaque ligne revient pour son montant. Elle
     * reprend donc les montants de la FACTURE, et ne se propose que si
     * l'avoir imprime les mêmes, composante par composante — chaque droit,
     * chaque TVA déduite, chaque base de taux que la facture code, et le
     * total (revue de #169 : un droit imprimé au double, compensé sur la
     * base, s'extournait aux montants de la facture sans rien dire).
     */
    const ecart = ecartAuRepli({
      lignes,
      bases,
      droits,
      cote,
      codeUnique,
      nonAttribues,
      droitsDeLaFacture: p.droitsDeLaFacture,
      u,
    });
    if (ecart) return { ok: false, refus: ecart };
    if (traitement !== "extourne" || totalAvoir !== totalFacture)
      return { ok: false, refus: "droit_au_cout_non_attribue" };
    for (const l of lignes)
      retirer([l], solde.get(l)!, l.nature === "base" || l.nature === "tva" ? codeDe(l) : null);
    reserves.push({ code: "droit_au_cout", droit: sansLigne.code });
  } else {
    for (const b of bases) {
      const parCode = lignes.filter((l) => l.nature === "base" && codeDe(l) === b.code);
      const pool =
        parCode.length > 0 ? parCode : lignes.filter((l) => l.nature === "base" && !codeDe(l));
      if (pool.length === 0) return { ok: false, refus: "avoir_hors_facture" };
      const tvas = tvasDu(b.code);
      // Une TVA non déduite à la facture était dans la base : elle y retourne.
      const versLaBase = b.ht + (tvas.length === 0 ? b.tva : 0n);
      if (!retirer(pool, versLaBase, b.code))
        return { ok: false, refus: "avoir_excede_la_facture" };
      if (tvas.length > 0 && b.tva !== 0n && !retirer(tvas, b.tva, b.code))
        return { ok: false, refus: "avoir_excede_la_facture" };
    }
    for (const d of droits) {
      if (d.montant === 0n) continue;
      const pool = lignes.filter((l) => l.nature === "droit" && l.droit_code === d.code);
      if (pool.length === 0) return { ok: false, refus: "avoir_hors_facture" };
      if (!retirer(pool, d.montant, null)) return { ok: false, refus: "avoir_excede_la_facture" };
    }
    if (!retirer(tiers, totalAvoir, null)) return { ok: false, refus: "avoir_excede_la_facture" };
  }

  /*
   * L'écriture : chaque retrait au côté opposé de la facture (une contrepartie
   * retirée y revient). Une base va au compte des RRR quand le traitement est
   * le rabais et que le pack en nomme un pour son compte ; sinon elle se
   * contre-passe sur son compte. Les lignes de même compte, même code et même
   * libellé se regroupent ; une ligne nulle ne s'inscrit pas.
   */
  const groupes = new Map<
    string,
    { account_code: string; libelle: string; tax_code: string | null; montant: bigint }
  >();
  for (const r of retraits) {
    if (r.montant === 0n) continue;
    const l = r.ligne;
    const compte =
      traitement === "rabais" && l.nature === "base"
        ? (p.compteDeRabais(l.account_code) ?? l.account_code)
        : l.account_code;
    const code = l.nature === "base" || l.nature === "tva" ? r.code : null;
    const cle = JSON.stringify([compte, code, l.libelle]);
    const g = groupes.get(cle);
    if (g) g.montant += r.montant;
    else
      groupes.set(cle, {
        account_code: compte,
        libelle: l.libelle,
        tax_code: code,
        montant: r.montant,
      });
  }
  const enTexte = (m: bigint) => depuisUniteMineure(Number(m), n);
  // Le côté vide d'une ligne vaut « 0 », comme au moteur d'équilibre.
  const zero = "0";
  const sortie = [...groupes.values()].map((g) => {
    // Côté pièce retiré : au crédit d'un achat, au débit d'une vente ; une
    // contrepartie (montant négatif côté pièce) de l'autre côté.
    const auCredit = achat ? g.montant > 0n : g.montant < 0n;
    const abs = g.montant < 0n ? -g.montant : g.montant;
    return {
      account_code: g.account_code,
      libelle: g.libelle,
      debit: auCredit ? zero : enTexte(abs),
      credit: auCredit ? enTexte(abs) : zero,
      tax_code: g.tax_code,
    };
  });
  const debit = sortie.reduce((s, l) => s + u(l.debit), 0n);
  const credit = sortie.reduce((s, l) => s + u(l.credit), 0n);
  if (debit !== credit || debit !== totalAvoir || sortie.length < 2)
    return { ok: false, refus: "avoir_desequilibre" };

  const lignesDuPivot: JournalLineV1[] = sortie.map((l) => ({
    account_code: l.account_code,
    label: l.libelle,
    debit: l.debit,
    credit: l.credit,
    ...(l.tax_code ? { tax_code: l.tax_code } : {}),
  }));
  const pivot: PivotV1 = {
    contract: "pivot.v1",
    source_item_id: p.pieceId,
    entry_date: p.date,
    period: periodeDeTva(p.date),
    currency: p.devise,
    lines: lignesDuPivot,
    totals: { debit: enTexte(debit), credit: enTexte(credit) },
    traffic_light: "VERT",
    motifs: [{ code: "OK", severity: "info", message: "Écriture équilibrée et cohérente" }],
    approvable: true,
  };
  return {
    ok: true,
    traitement,
    journal: p.facture.journal,
    libelle: composerLibelle({
      nature: nomDeLaNature(achat ? "avoir_achat" : "avoir_vente"),
      contrepartie: p.contrepartie,
      reference: p.reference,
      date: p.date,
    }),
    pivot,
    lignes: sortie,
    reserves,
  };
}
