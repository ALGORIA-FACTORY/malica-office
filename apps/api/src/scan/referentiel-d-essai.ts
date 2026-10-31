/**
 * Le référentiel tunisien des épreuves pures : ce que le pack porte pour juger
 * une pièce et en proposer l'écriture, sans base.
 *
 * Rien n'y est écrit à la main. L'instantané `referentiel-d-essai.json` est
 * RELEVÉ d'une base migrée (`outils/relever-le-referentiel-d-essai.mjs`, par
 * `releve-du-referentiel.ts`), et `le-referentiel-d-essai-dit-vrai.test.ts`
 * rejoue le même relevé en base : au premier écart, l'épreuve échoue.
 *
 * La copie à la main du 30 octobre 2026 portait le timbre à 665 et 4368 ; le
 * pack le porte à 6654 et 4371. C'est ce que l'instantané empêche.
 */
import { readFileSync } from "node:fs";

import type { AccountMapping, FiscalCharge, TaxRate } from "@malica/socle/ports/repositories";

import type { releverLeReferentiel } from "./releve-du-referentiel.ts";

type Sens = "facture_achat" | "facture_vente";

export const RELEVE_D_ESSAI = JSON.parse(
  readFileSync(new URL("./referentiel-d-essai.json", import.meta.url), "utf8"),
) as Awaited<ReturnType<typeof releverLeReferentiel>>;

export const TAUX_D_ESSAI: TaxRate[] = RELEVE_D_ESSAI.taux.map((t) => ({
  ...t,
  label: t.code,
  jurisdiction: RELEVE_D_ESSAI.juridiction,
}));

export const IMPUTATIONS_D_ESSAI = RELEVE_D_ESSAI.imputations as Array<
  AccountMapping & { documentKind: Sens }
>;

export const DROITS_D_ESSAI: Array<FiscalCharge & { documentKind: Sens }> =
  RELEVE_D_ESSAI.droits.map((d) => ({
    ...d,
    documentKind: d.documentKind as Sens,
    label: d.code,
    legalReference: null,
  }));

export const PARAMETRES_D_ESSAI = RELEVE_D_ESSAI.parametres;

export const MENTIONS_D_ESSAI = RELEVE_D_ESSAI.mentions.map((code) => ({ code, libelle: code }));

export const TYPES_D_ESSAI = RELEVE_D_ESSAI.typesQuiPortentUneEcriture.map((code) => ({
  code,
  porteEcriture: true,
}));

/** Ce que le titre imprimé dit de la nature de la pièce (`ref.titres_de_piece`). */
export const TITRES_D_ESSAI = RELEVE_D_ESSAI.titres;

/** Les mots d'un bien susceptible d'être immobilisé (`ref.biens_immobilisables`). */
export const BIENS_IMMOBILISABLES_D_ESSAI = RELEVE_D_ESSAI.biensImmobilisables;

/** Les marques imprimées de chaque devise (`ref.devises`, `ref.devises_marques`). */
export const MARQUES_D_ESSAI = RELEVE_D_ESSAI.marques;

/** L'exposant et le séparateur décimal de chaque devise de `ref.devises`. */
export const DEVISES_D_ESSAI: Readonly<
  Record<string, { exposant: number; separateurDecimal: string }>
> = RELEVE_D_ESSAI.devises;

/** La devise des livres du dossier d'essai : celle du pack. */
export const DEVISE_D_ESSAI = RELEVE_D_ESSAI.devise;

/** La règle de change du pack (`change.*` de `ref.socle_params`). */
export const REGLE_DE_CHANGE_D_ESSAI = RELEVE_D_ESSAI.change;

/** Le jour où le référentiel d'essai a été relevé (`releve-du-referentiel.ts`). */
export const JOUR_DU_RELEVE_D_ESSAI: string = RELEVE_D_ESSAI.jour;

/** Les réglages comptables du pack (`ref.socle_params`), par code. */
export const REGLAGES_D_ESSAI: ReadonlyMap<string, string> = new Map(
  Object.entries(RELEVE_D_ESSAI.reglages),
);
