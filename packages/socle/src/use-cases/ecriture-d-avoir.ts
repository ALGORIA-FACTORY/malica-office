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

/** Les options du réglage `avoirs.ecriture`. */
export type EcritureDAvoir = "selon_avoir" | "extourne" | "rabais";

/** Pourquoi l'avoir ne se propose pas : un code stable, que l'écran traduit. */
export type RefusDAvoir =
  "avoir_excede_la_facture" | "avoir_hors_facture" | "avoir_desequilibre" | "facture_illisible";

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
}): ResultatDAvoir {
  const n = p.decimales;
  const u = (s: string) => enUnitesExactes(s, n);
  const achat = p.sens === "facture_achat";
  // Le montant d'une ligne de la facture, du côté de la pièce (débit d'un
  // achat, crédit d'une vente) ; la contrepartie, du côté opposé.
  const cote = (l: LigneDeLaFacture) =>
    achat ? u(l.debit) - u(l.credit) : u(l.credit) - u(l.debit);
  const lignes = p.facture.lignes;
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

  const bases = p.avoir.bases.map((b) => ({ code: b.code, ht: u(b.ht), tva: u(b.tva) }));
  const droits = p.avoir.droits.map((d) => ({ code: d.code, montant: u(d.montant) }));
  const totalAvoir =
    bases.reduce((s, b) => s + b.ht + b.tva, 0n) + droits.reduce((s, d) => s + d.montant, 0n);
  if (totalAvoir !== u(p.avoir.ttc) || totalAvoir <= 0n || bases.some((b) => b.ht < 0n))
    return { ok: false, refus: "avoir_desequilibre" };
  if (totalAvoir > totalFacture) return { ok: false, refus: "avoir_excede_la_facture" };
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

  // Ce que l'avoir retire, par compte, côté pièce.
  const retraits: Array<{ ligne: LigneDeLaFacture; montant: bigint; code: string | null }> = [];
  // Une contrepartie se porte du côté opposé : son poids, et ce qu'on lui
  // retire, changent de signe.
  const retirer = (pool: readonly LigneDeLaFacture[], montant: bigint, code: string | null) => {
    const signe = pool[0]?.nature === "tiers" ? -1n : 1n;
    const parts = repartir(
      montant * signe,
      pool.map((l) => cote(l) * signe),
    );
    pool.forEach((l, i) => retraits.push({ ligne: l, montant: parts[i]! * signe, code }));
  };

  for (const b of bases) {
    const parCode = lignes.filter((l) => l.nature === "base" && codeDe(l) === b.code);
    const pool =
      parCode.length > 0 ? parCode : lignes.filter((l) => l.nature === "base" && !codeDe(l));
    if (pool.length === 0) return { ok: false, refus: "avoir_hors_facture" };
    const tvas = lignes.filter((l) => l.nature === "tva" && l.tax_code === b.code);
    // Une TVA non déduite à la facture était dans la base : elle y retourne.
    const versLaBase = b.ht + (tvas.length === 0 ? b.tva : 0n);
    if (versLaBase > pool.reduce((s, l) => s + cote(l), 0n))
      return { ok: false, refus: "avoir_excede_la_facture" };
    retirer(pool, versLaBase, b.code);
    if (tvas.length > 0 && b.tva !== 0n) {
      if (b.tva > tvas.reduce((s, l) => s + cote(l), 0n))
        return { ok: false, refus: "avoir_excede_la_facture" };
      retirer(tvas, b.tva, b.code);
    }
  }
  for (const d of droits) {
    if (d.montant === 0n) continue;
    const pool = lignes.filter((l) => l.nature === "droit" && l.droit_code === d.code);
    if (pool.length === 0) return { ok: false, refus: "avoir_hors_facture" };
    if (d.montant > pool.reduce((s, l) => s + cote(l), 0n))
      return { ok: false, refus: "avoir_excede_la_facture" };
    retirer(pool, d.montant, null);
  }
  retirer(tiers, -totalAvoir, null);

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
  };
}
