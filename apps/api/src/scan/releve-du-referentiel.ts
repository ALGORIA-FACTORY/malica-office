/**
 * Le relevé du pack tunisien qu'utilisent les épreuves pures, lu en base.
 *
 * ================================================================= POURQUOI
 *
 * La copie écrite à la main le 30 octobre 2026 portait le timbre aux comptes
 * 665 et 4368 ; le pack les porte à 6654 et 4371 (4368 est la série des
 * retenues à la source). Les écritures attendues avaient été recopiées sur la
 * copie : les cas du timbre passaient pour une mauvaise raison.
 *
 * Il n'y a donc plus de copie à la main. Ce relevé produit l'instantané
 * `referentiel-d-essai.json` (`outils/relever-le-referentiel-d-essai.mjs`), et
 * `le-referentiel-d-essai-dit-vrai.test.ts` le rejoue en base : une seule
 * source, la base, et une épreuve qui échoue au premier écart.
 */
import type { Requete } from "../db.ts";
import { referentiel } from "../depots/referentiel.ts";
import { lireLesReglesDeLecture } from "../malica/lecture/regles-de-lecture.ts";

import {
  lireLesBiensImmobilisables,
  lireLesExclusionsDeDeduction,
  lireLesTitres,
  lireParametres,
} from "./analyse.ts";
import { lireLeBaremeDesDroits } from "./bareme-du-timbre.ts";
import { lireLaRegleDuPack } from "./cours-de-change.ts";
import { lireLesNaturesDeVente } from "./nature-de-vente.ts";
import { droitsAuCout, lireLesReglagesDuPack } from "./reglages-comptables.ts";

/** Le jour du relevé : un référentiel daté se relève à une date fixe (R11). */
const JOUR_DU_RELEVE = "2026-10-01";

// Every text ordering below is binary (`collate "C"`): the snapshot must not
// depend on the database's locale (C.UTF-8 locally, en_US in CI).
export async function releverLeReferentiel(db: Requete, juridiction: string) {
  const { rows: packs } = await db.query<{ id: string; currency: string }>(
    `select id, currency from ref.jurisdiction_packs
      where jurisdiction = $1 and effective_from <= $2::date
      order by effective_from desc limit 1`,
    [juridiction, JOUR_DU_RELEVE],
  );
  const pack = packs[0];
  if (!pack) throw new Error(`Aucun pack ${juridiction} au ${JOUR_DU_RELEVE}.`);
  const par =
    <T>(cle: (x: T) => string) =>
    (a: T, b: T) =>
      cle(a).localeCompare(cle(b));

  // Les dates en texte : un `Date` du pilote dépend du fuseau de la machine.
  const { rows: taux } = await db.query<{
    code: string;
    rate: string;
    validFrom: string;
    validTo: string | null;
  }>(
    `select code, rate::text as rate, to_char(valid_from, 'YYYY-MM-DD') as "validFrom",
            to_char(valid_to, 'YYYY-MM-DD') as "validTo"
       from ref_tva_rates_v where pack_version_id = $1 order by code collate "C", valid_from`,
    [pack.id],
  );
  const imputations = (await referentiel.accountMappings(db, pack.id))
    .filter((m) => m.documentKind === "facture_achat" || m.documentKind === "facture_vente")
    .sort(par((m) => `${m.documentKind}|${m.taxCode}`));
  const droits = (await referentiel.fiscalCharges(db, pack.id, "fr", JOUR_DU_RELEVE))
    .map((d) => ({
      code: d.code,
      documentKind: d.documentKind,
      accountCode: d.accountCode,
      fixedAmount: d.fixedAmount,
      taxable: d.taxable,
    }))
    .sort(par((d) => `${d.code}|${d.documentKind}`));
  const { rows: mentions } = await db.query<{ code: string }>(
    `select code from ref.mentions where pack_version_id = $1 and mandatory order by code collate "C"`,
    [pack.id],
  );
  const { rows: types } = await db.query<{ code: string }>(
    `select code from ref.document_types where porte_ecriture order by code collate "C"`,
  );
  const { rows: devises } = await db.query<{
    code: string;
    exposant: number;
    separateurDecimal: string;
  }>(
    `select code, exposant, separateur_decimal as "separateurDecimal" from ref.devises order by code collate "C"`,
  );
  const { rows: marques } = await db.query<{ marque: string; devise: string }>(
    `select marque, devise from (
       select code as marque, code as devise from ref.devises
        union
       select marque, devise from ref.devises_marques
     ) m order by marque collate "C", devise collate "C"`,
  );
  const reglages = await lireLesReglagesDuPack(db, pack.id, JOUR_DU_RELEVE);
  return {
    juridiction,
    jour: JOUR_DU_RELEVE,
    devise: pack.currency,
    parametres: await lireParametres(db, pack.id, JOUR_DU_RELEVE),
    taux,
    imputations,
    droits,
    mentions: mentions.map((m) => m.code),
    typesQuiPortentUneEcriture: types.map((t) => t.code),
    titres: await lireLesTitres(db),
    biensImmobilisables: await lireLesBiensImmobilisables(db, pack.id, JOUR_DU_RELEVE),
    exclusionsDeDeduction: await lireLesExclusionsDeDeduction(db, pack.id, JOUR_DU_RELEVE),
    // Les natures d'un article vendu et leurs motifs ; leur compte, celui du pack.
    naturesDeVente: await lireLesNaturesDeVente(db, pack.id, JOUR_DU_RELEVE, null),
    // La règle de change du pack (`change.*`) ; les cours, eux, sont des
    // données, et chaque cas de mesure dit le sien.
    change: await lireLaRegleDuPack(db, pack.id, JOUR_DU_RELEVE),
    // Les réglages comptables du pack (`ref.socle_params`, R10) : les défauts
    // que le cabinet confirme ou change.
    reglages,
    // Les droits qu'un achat incorpore au coût, selon le défaut du pack
    // (`fodec.traitement`) : la fonction même que la proposition appelle, pour
    // que la mesure et le jeu synthétique attendent ce que la recette propose.
    droitsAuCout: await droitsAuCout(db, new Map(Object.entries(reglages))),
    // Le barème daté des droits (`timbre.bareme`) : la catégorie au droit
    // standard et les tranches des autres.
    baremeDesDroits: await lireLeBaremeDesDroits(db, pack.id, JOUR_DU_RELEVE),
    marques,
    // Comment le pack écrit une date, un matricule et un montant en lettres.
    reglesDeLecture: await lireLesReglesDeLecture(db, pack.id, JOUR_DU_RELEVE),
    devises: Object.fromEntries(
      devises.map((d) => [
        d.code,
        { exposant: d.exposant, separateurDecimal: d.separateurDecimal },
      ]),
    ),
  };
}
