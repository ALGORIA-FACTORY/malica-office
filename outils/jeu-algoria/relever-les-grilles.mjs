/**
 * Relever les grilles de lecture d'une base migrée : les champs du jeu d'ALGORIA.
 *
 *   node db/migrer.mjs --base <url d'une base vide>
 *   DATABASE_URL_ADMIN=<même url> node outils/jeu-algoria/relever-les-grilles.mjs [facture …]
 *
 * ================================================================= POURQUOI
 *
 * La vérité de chaque cas (`attendu.concepts`) se clé par le CODE du champ de
 * la grille (`ref.grille_champs`), et chaque champ porte son concept
 * (`ref.concepts`) et son rôle (fournisseur, client). Ces codes ne s'inventent
 * pas dans le compositeur : ils se relèvent ici, une fois, dans
 * `grilles/<code>.json`, et le compositeur refuse toute clé qu'une grille ne
 * porte pas. Une grille de plus (relevé bancaire, bulletin de paie…) se relève
 * par son code, pour les pièces qui ne sont pas des factures.
 *
 * Les paramètres fiscaux et sociaux dont les pièces ont besoin (taux de l'IS,
 * des acomptes, de la CNSS, de la TFP, du FOPROLOS, des retenues à la source,
 * barème de l'IRPP) se relèvent aussi, dans `parametres.json`, depuis
 * `ref.fiscal_parameters` : le compositeur n'écrit aucun taux (R4), et chaque
 * paramètre garde sa confiance (« confirme », « a_confirmer »).
 *
 * Le pack est le tunisien, au jour de l'instantané du référentiel
 * (`referentiel-d-essai.json`) : le même jour que les comptes du jeu. L'URL
 * n'est jamais affichée.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { REFERENTIEL } from "../jeu-synthetique/referentiel.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL_ADMIN;
if (!url) throw new Error("DATABASE_URL_ADMIN absente : la base migrée à relever.");
const codes = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["facture"];

/** Les paramètres que les pièces du jeu lisent (`pieces.mjs`). */
const PARAMETRES = [
  "ACOMPTES_TAUX",
  "CNSS_RSNA_TAUX_GLOBAL",
  "CNSS_RSNA_TAUX_PATRONAL",
  "CNSS_RSNA_TAUX_SALARIAL",
  "FOPROLOS_TAUX",
  "IRPP_BAREME",
  "IS_MIN_IMPOT_PLANCHER_NORMAL",
  "IS_MIN_IMPOT_TAUX_NORMAL",
  "IS_TAUX_DROIT_COMMUN",
  "RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS",
  "RAS_MARCHES_ACQUISITIONS",
  "RAS_MARCHES_SEUIL",
  "SALAIRES_FRAIS_PROFESSIONNELS_PLAFOND",
  "SALAIRES_FRAIS_PROFESSIONNELS_TAUX",
  "TFP_TAUX_GENERAL",
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  mkdirSync(join(ICI, "grilles"), { recursive: true });
  for (const code of codes) {
    const { rows: grilles } = await client.query(
      `select g.id, g.code, g.nom, g.document_type, g.valid_from::text as valid_from
         from ref.grilles g join ref.jurisdiction_packs p on p.id = g.pack_version_id
        where p.jurisdiction = $1 and g.code = $2
          and p.effective_from <= $3::date and (p.effective_to is null or p.effective_to >= $3::date)
          and g.valid_from <= $3::date and (g.valid_to is null or g.valid_to >= $3::date)`,
      [REFERENTIEL.juridiction, code, REFERENTIEL.jour],
    );
    if (grilles.length !== 1)
      throw new Error(`grille « ${code} » : ${grilles.length} en vigueur, 1 attendue`);
    const g = grilles[0];
    const { rows: champs } = await client.query(
      `select c.code, c.parcelle, c.type, c.obligatoire, k.code as concept, c.role,
              k.expert, k.porte_sur_une_partie
         from ref.grille_champs c join ref.concepts k on k.id = c.concept_id
        where c.grille_id = $1 order by c.code`,
      [g.id],
    );
    const releve = {
      note: `Relevé par outils/jeu-algoria/relever-les-grilles.mjs dans une base migrée (pack ${REFERENTIEL.juridiction} au ${REFERENTIEL.jour}). Ne pas éditer à la main : relancer.`,
      grille: { code: g.code, nom: g.nom, typeDeDocument: g.document_type, valideDu: g.valid_from },
      champs: champs.map((c) => ({
        code: c.code,
        concept: c.concept,
        role: c.role,
        type: c.type,
        obligatoire: c.obligatoire,
        parcelle: c.parcelle,
        expert: c.expert,
        porteSurUnePartie: c.porte_sur_une_partie,
      })),
    };
    writeFileSync(join(ICI, "grilles", `${code}.json`), `${JSON.stringify(releve, null, 2)}\n`);
    console.log(`grille ${code} : ${champs.length} champs`);
  }
  const { rows: parametres } = await client.query(
    `select code, valeur_brute, confiance, article
       from ref.fiscal_parameters
      where jurisdiction = $1 and code = any($2)
        and valid_from <= $3::date and (valid_to is null or valid_to >= $3::date)
      order by code`,
    [REFERENTIEL.juridiction, PARAMETRES, REFERENTIEL.jour],
  );
  const manquants = PARAMETRES.filter((c) => !parametres.some((p) => p.code === c));
  if (manquants.length > 0) throw new Error(`paramètres absents : ${manquants.join(", ")}`);
  writeFileSync(
    join(ICI, "parametres.json"),
    `${JSON.stringify(
      {
        note: `Relevé par outils/jeu-algoria/relever-les-grilles.mjs dans ref.fiscal_parameters (pack ${REFERENTIEL.juridiction} au ${REFERENTIEL.jour}). Ne pas éditer à la main : relancer.`,
        parametres: Object.fromEntries(
          parametres.map((p) => [
            p.code,
            { valeur: p.valeur_brute, confiance: p.confiance, article: p.article },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`paramètres : ${parametres.length}`);
} finally {
  await client.end();
}
