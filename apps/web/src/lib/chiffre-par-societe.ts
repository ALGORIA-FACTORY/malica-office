/**
 * Le chiffre d'UNE société, tel que le moteur du Socle le rend — pour la liste « une société par
 * ligne » de TVA et de Charges sous « Toutes les sociétés » (maquette du 13 novembre 2026,
 * planche B ; décision du dirigeant le 14 novembre : livré en 0.2.112).
 *
 * ============================================================ CE QUE CE MODULE FAIT
 *
 * Il lit, pour la société donnée, ce que l'écran de CETTE société lit — les mêmes portes, dans la
 * juridiction, la devise et le mois de cette société — et le passe au MÊME moteur :
 * `tvaDesExtraits` (TVA du mois) ou `computeChargesByFamille` (charges du mois). Aucun calcul
 * ici : il rend ce que le moteur rend, et le dit tel quel (R3).
 *
 * ============================================================ CE QU'IL NE FAIT PAS
 *
 * - Aucun total entre sociétés : une juridiction, une devise, une période par société (R3).
 * - Aucune juridiction, aucune devise, aucune décimale de repli (R4) : ce qui manque est un
 *   ÉTAT nommé (`EtatSansChiffre`), jamais un zéro ni une supposition.
 * - Aucun contournement de l'isolation : chaque lecture passe par la porte qui contrôle les
 *   droits de la personne sur CETTE société (R6). Une lecture refusée REMONTE (rejet) ; l'écran
 *   la dit « indisponible », il ne la remplace pas.
 *
 * Les lectures sont celles de `hooks/use-tva` et `pme.charges` ; une seule société à la fois les
 * assemble à l'écran, celle-ci les assemble pour chaque ligne.
 */
import { tvaDesExtraits } from "@malica/socle/engines/tva/des-extraits";
import { computeChargesByFamille } from "@malica/socle/engines/charges/familles";
import { finDuMois, moisDeLExercice } from "@malica/socle/exercice";

import { moisLocal } from "@/lib/lisible";
import { sensDuSolde } from "@/lib/sens-du-solde";
import { office } from "@/verticals/malica-office/composition";
import { extraitsDeLaTvaDuMois } from "./extraits-de-la-tva-du-mois";

/** Le seuil d'écart des charges : le même code que l'écran « Vos charges ». */
const SEUIL_DES_CHARGES = "FAMILLE_CONSO";

/** Ce qui empêche de rendre un chiffre pour une société — dit à l'écran, jamais comblé. */
type EtatSansChiffre =
  "sansJuridiction" | "sansReferentiel" | "regimeAbsent" | "nonAssujetti" | "referentielIncomplet";

export interface SocieteALire {
  id: string;
  jurisdiction: string;
  currency: string;
}

export type ChiffreDUneSociete =
  | {
      etat: "calcule";
      /** Le montant tel que le moteur le rend, signe compris. */
      montant: string;
      devise: string;
      /** TVA seulement : de quel côté de zéro le moteur a posé le solde. */
      sens?: ReturnType<typeof sensDuSolde>;
    }
  | { etat: EtatSansChiffre };

/** Le pack de la juridiction de la société, ou l'état qui dit pourquoi il n'y en a pas. */
async function packDe(s: SocieteALire): Promise<{ id: string } | EtatSansChiffre> {
  if (s.jurisdiction.trim() === "") return "sansJuridiction";
  // Pas de devise de repli : sans la devise de la société, aucun montant ne s'écrit (R4).
  if (s.currency.trim() === "") return "referentielIncomplet";
  const pack = await office().referential.activePack(s.jurisdiction);
  return pack === null ? "sansReferentiel" : { id: pack.id };
}

export async function chiffreTva(
  s: SocieteALire,
  periode: string,
  locale: string,
): Promise<ChiffreDUneSociete> {
  const pack = await packDe(s);
  if (typeof pack === "string") return { etat: pack };

  // Le régime vient de la fiche fiscale en vigueur, et d'elle seule : sans elle, on ne sait pas si
  // la société déclare de la TVA, et un solde ne se devine pas.
  const fiche = await office().identity.ficheCourante(s.id);
  const regime = fiche?.regimeTva ?? null;
  if (regime === null || regime.trim() === "") return { etat: "regimeAbsent" };
  if (regime === "non_assujetti") return { etat: "nonAssujetti" };

  const du = `${periode}-01`;
  const au = finDuMois(periode);
  const [params, taux, declaration, cabinet] = await Promise.all([
    office().referential.socleParams(pack.id),
    office().referential.taxRates(pack.id, s.jurisdiction, locale),
    office().referential.declarationTva(pack.id, s.id, au, locale),
    office().identity.monCabinet(s.id),
  ]);
  const decimales = params?.moneyDecimals;
  if (typeof decimales !== "number") return { etat: "referentielIncomplet" };

  // Comme l'écran de la société (`extraits-de-la-tva-du-mois.ts`).
  const { lignes } = await extraitsDeLaTvaDuMois(s.id, cabinet !== null, du, au);

  const tva = tvaDesExtraits({
    period: periode,
    currency: { code: s.currency, decimals: decimales },
    taux,
    declaration,
    rows: lignes,
  });
  return {
    etat: "calcule",
    montant: tva.totals.solde,
    devise: tva.currency ?? s.currency,
    sens: sensDuSolde(tva.totals.solde),
  };
}

export async function chiffreCharges(
  s: SocieteALire,
  periode: string,
  locale: string,
): Promise<ChiffreDUneSociete> {
  const pack = await packDe(s);
  if (typeof pack === "string") return { etat: pack };

  const [familles, seuil, params, fiche] = await Promise.all([
    office().charges.familles(pack.id, locale),
    office().charges.anomalyThreshold(pack.id, SEUIL_DES_CHARGES),
    office().referential.socleParams(pack.id),
    office().identity.ficheCourante(s.id),
  ]);
  const decimales = params?.moneyDecimals;
  if (typeof decimales !== "number") return { etat: "referentielIncomplet" };

  // L'exercice de la société, comme l'écran : la base de comparaison des écarts en dépend.
  const mois = moisDeLExercice(fiche?.clotureExercice ?? null, periode, moisLocal(new Date()));
  const periodes = mois.map((m) => m.periode).sort();
  const articles = await office().charges.articles(s.id, periodes[0]!, periodes[11]!);

  const charges = computeChargesByFamille({
    articles,
    familles,
    period: periode,
    baselinePeriods: periodes.filter((p) => p < periode),
    threshold: seuil,
    decimals: decimales,
  });
  return { etat: "calcule", montant: charges.total, devise: s.currency };
}
