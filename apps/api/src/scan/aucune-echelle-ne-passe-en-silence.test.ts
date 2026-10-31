/**
 * Aucune échelle ne passe en silence (revue de la PR 144, Codex, deux fois).
 *
 * « 100,000 » vaut 100 dinars par la convention du dinar (la virgule est
 * décimale) ; lu à l'anglaise, il vaut 100 000 dinars. Quand la facture
 * ENTIÈRE tient aussi à l'autre échelle (× 10^exposant, ou ÷), que rien ne
 * l'ancre (un droit à sa valeur fixée) et que l'arithmétique ne l'écarte pas,
 * la valeur n'est décidée que par la convention : le contrôle arithmétique
 * ne peut pas dire « conforme ».
 *
 * L'oracle est indépendant de la normalisation : il relit chaque montant
 * imprimé au lecteur unique (`lireUnMontantImprime`), refait l'arithmétique
 * à l'échelle voisine en rationnels exacts, et ne regarde du jugement que son
 * verdict. Il joue :
 *   - chaque pièce de la mesure, sur la vraie chaîne de jugement ;
 *   - la même pièce, tous ses montants imprimés × 10^exposant ;
 *   - une grille de factures fabriquées (bases, taux, droits fixés ou non,
 *     HT qui comprend les droits, sans total, sans TVA), à la normalisation.
 *
 *   node --experimental-strip-types --test src/scan/aucune-echelle-ne-passe-en-silence.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lireUnMontantImprime, type DeviseLue } from "@malica/socle/montant-imprime";

import { CAS_DE_MESURE, juger, type CasDeMesure } from "./mesure-des-propositions.ts";
import { normaliserMontants, type ResultatNormalisation } from "./normaliser-montants.ts";
import { DEVISES_LUES_D_ESSAI, deviseDEssai } from "./devise-d-essai.ts";
import { DROITS_D_ESSAI, PARAMETRES_D_ESSAI } from "./referentiel-d-essai.ts";

const TOLERANCE = BigInt(PARAMETRES_D_ESSAI["lecture.tolerance_arrondi_mineure"]);

/** Un taux décimal en rationnel exact : « 0.19 » → 19/100. */
function rationnel(taux: string): [bigint, bigint] {
  const [e, f = ""] = taux.split(".");
  return [BigInt(`${e}${f}`), 10n ** BigInt(f.length)];
}
const arrondi = (num: bigint, den: bigint) => {
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
};
const abs = (x: bigint) => (x < 0n ? -x : x);

/** La facture tient-elle à ces montants (en unités mineures) ? */
function tient(
  bases: Array<{ ht: bigint; taux: string }>,
  tva: bigint | null,
  autres: bigint[],
  ttc: bigint | null,
): boolean {
  const calculee = bases.reduce((s, b) => {
    const [n, d] = rationnel(b.taux);
    return s + arrondi(b.ht * n, d);
  }, 0n);
  if (tva !== null && abs(tva - calculee) > TOLERANCE) return false;
  if (ttc !== null) {
    const somme =
      bases.reduce((s, b) => s + b.ht, 0n) + (tva ?? calculee) + autres.reduce((s, a) => s + a, 0n);
    if (abs(somme - ttc) > TOLERANCE) return false;
  }
  return tva !== null || ttc !== null;
}

/**
 * L'échelle voisine que la pièce laisse ouverte : chaque montant imprimé se
 * lit aussi à cette échelle, aucun droit n'est à sa valeur fixée, et la
 * facture entière y tient. Null : rien n'est laissé à la seule convention.
 */
function echelleOuverte(
  n: ResultatNormalisation,
  devise: DeviseLue,
  fixes: Array<number | null>,
): string | null {
  if (n.etat !== "tranche") return null;
  const m = n.montants;
  if (m.bases.some((b) => b.ht === null) || m.autres.some((a) => a === null)) return null;
  if (m.autres.some((a, i) => fixes[i] !== null && fixes[i] !== undefined && a === fixes[i]))
    return null;
  const imprimes = [...n.imprime.bases, n.imprime.tva, ...n.imprime.autres, n.imprime.ttc].filter(
    (t): t is string => t !== null,
  );
  const facteur = 10n ** BigInt(devise.decimales);
  if (facteur === 1n) return null;
  for (const [nom, fois] of [
    ["× 10^exposant", (x: bigint) => x * facteur],
    ["÷ 10^exposant", (x: bigint) => (x % facteur === 0n ? x / facteur : null)],
  ] as const) {
    const lisible = imprimes.every((t) => {
      const lu = lireUnMontantImprime(t, devise);
      const toutes = new Set([...lu.lectures.map((l) => l.mineur), ...lu.ecarteesParConvention]);
      return lu.lectures.some((l) => {
        const autre = fois(BigInt(l.mineur));
        return autre !== null && toutes.has(Number(autre));
      });
    });
    if (!lisible) continue;
    const a = (x: number | null) => (x === null ? null : fois(BigInt(x)));
    const bases = m.bases.map((b) => ({ ht: a(b.ht), taux: b.taux }));
    const autres = m.autres.map((x) => a(x));
    const tva = a(m.tva);
    const ttc = a(m.ttc);
    if (bases.some((b) => b.ht === null) || autres.some((x) => x === null)) continue;
    if ((m.tva !== null && tva === null) || (m.ttc !== null && ttc === null)) continue;
    if (
      tient(
        bases.map((b) => ({ ht: b.ht!, taux: b.taux })),
        tva,
        autres.map((x) => x!),
        ttc,
      )
    )
      return nom;
  }
  return null;
}

/** Un montant en unités mineures, imprimé à la tunisienne : « 1 234 560,000 ». */
function imprimer(mineur: bigint, devise: DeviseLue): string {
  const facteur = 10n ** BigInt(devise.decimales);
  const entier = (mineur / facteur).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  if (devise.decimales === 0) return entier;
  const frac = (mineur % facteur).toString().padStart(devise.decimales, "0");
  return `${entier}${devise.separateurDecimal}${frac}`;
}

const CHAMPS_MONTANT =
  /^(lines\[\d+\]\.base_ht|other_charges\[\d+\]\.amount|totals\.(base_ht|vat|ttc))$/u;

/** La même pièce, chaque montant imprimé (lu d'une seule façon) × 10^exposant. */
function aLEchelle(cas: CasDeMesure, devise: DeviseLue): CasDeMesure {
  const facteur = 10n ** BigInt(devise.decimales);
  return {
    ...cas,
    nom: `${cas.nom} (× 10^${devise.decimales})`,
    lecture: {
      ...cas.lecture,
      imprime: (champ) => {
        const t = cas.lecture.imprime(champ);
        if (t === null || !CHAMPS_MONTANT.test(champ)) return t;
        const lu = lireUnMontantImprime(t, devise);
        return lu.lectures.length === 1
          ? imprimer(BigInt(lu.lectures[0]!.mineur) * facteur, devise)
          : t;
      },
    },
  };
}

describe("aucune échelle ne passe en silence", () => {
  it("sur chaque pièce de la mesure, et sur la même × 10^exposant", () => {
    const silencieuses: string[] = [];
    let ouvertes = 0;
    for (const original of CAS_DE_MESURE) {
      const code = (original.lecture.payload as { currency?: string | null }).currency ?? "TND";
      const devise = DEVISES_LUES_D_ESSAI.find((d) => d.code === code);
      if (!devise) continue;
      for (const cas of [original, aLEchelle(original, devise)]) {
        const jugement = juger(cas);
        const n = jugement.normalisation;
        const payload = cas.lecture.payload as {
          document_kind?: string;
          other_charges?: Array<{ code?: string }>;
        };
        const sens = cas.lecture.sensDit ?? payload.document_kind;
        const fixes = (payload.other_charges ?? []).map((c) => {
          const d = DROITS_D_ESSAI.find((x) => x.code === c.code && x.documentKind === sens);
          return d?.fixedAmount ? Math.round(Number(d.fixedAmount) * 10 ** devise.decimales) : null;
        });
        const echelle = echelleOuverte(n, devise, fixes);
        if (echelle === null) continue;
        ouvertes++;
        const coherence = jugement.motifs.find((x) => x.code === "coherence_arithmetique");
        if (coherence?.statut === "conforme")
          silencieuses.push(`${cas.nom} : ${echelle} tient aussi, et le jugement dit « conforme »`);
      }
    }
    assert.ok(ouvertes > 0, "la mesure doit porter au moins une échelle ouverte");
    assert.deepEqual(silencieuses, []);
  });

  it("sur une grille de factures fabriquées", () => {
    const silencieuses: string[] = [];
    let ouvertes = 0;
    for (const devise of [deviseDEssai(3), DEVISES_LUES_D_ESSAI.find((d) => d.code === "EUR")!]) {
      const P = { ...devise, toleranceMineure: Number(TOLERANCE) };
      const u = 10n ** BigInt(devise.decimales);
      for (const ht of [100n * u, 1234n * u + 56n, 2n * u, 50000n * u])
        for (const taux of ["0.19", "0.07"])
          for (const droit of ["aucun", "libre", "fixé juste", "fixé autre"] as const)
            for (const forme of ["simple", "HT avec droits", "sans total", "sans TVA"] as const) {
              const [n, d] = rationnel(taux);
              const tva = arrondi(ht * n, d);
              const valeur = droit === "aucun" ? 0n : u;
              const ttc = ht + tva + valeur;
              const autres =
                droit === "aucun"
                  ? []
                  : droit === "libre"
                    ? [imprimer(valeur, devise)]
                    : [
                        {
                          brut: imprimer(valeur, devise),
                          attendu: Number(droit === "fixé juste" ? valeur : 2n * u),
                        },
                      ];
              const r = normaliserMontants(
                {
                  bases: [
                    {
                      ht: imprimer(forme === "HT avec droits" ? ht + valeur : ht, devise),
                      taux,
                    },
                  ],
                  tva: forme === "sans TVA" ? null : imprimer(tva, devise),
                  autres,
                  ttc: forme === "sans total" ? null : imprimer(ttc, devise),
                },
                P,
              );
              const fixes = autres.map((a) => (typeof a === "string" ? null : a.attendu));
              const echelle = echelleOuverte(r, devise, fixes);
              if (echelle === null) continue;
              ouvertes++;
              const silencieux =
                !r.parConvention &&
                r.deduits.length === 0 &&
                r.totalNonLu === null &&
                r.ligneNonLue === null;
              if (silencieux)
                silencieuses.push(
                  `${devise.code} HT ${ht} à ${taux}, droit ${droit}, ${forme} : ${echelle} tient aussi`,
                );
            }
    }
    assert.ok(ouvertes > 0, "la grille doit porter au moins une échelle ouverte");
    assert.deepEqual(silencieuses, []);
  });
});
