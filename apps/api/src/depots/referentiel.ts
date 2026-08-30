/**
 * Le référentiel fiscal — porté depuis l'adaptateur Supabase, à l'identique.
 *
 * Mêmes vues, mêmes transformations, mêmes erreurs. Seul le transport change :
 * `db.query` au lieu de `supabase.from`. Les vues restent en `security_invoker`,
 * donc c'est toujours la RLS qui décide de ce qui remonte.
 *
 * R4 s'applique ici plus qu'ailleurs : aucun taux, compte ou seuil n'est écrit
 * dans ce fichier. Tout vient du pack, versionné par date d'effet.
 */

import type { Requete } from "../db.ts";

/**
 * Ramène un numérique à sa chaîne décimale, au nombre de décimales du contrat.
 *
 * Attention au piège, découvert en portant ce fichier : PostgREST rendait les
 * `numeric` en NOMBRES JSON, `pg` les rend en CHAÎNES. L'adaptateur d'origine
 * faisait confiance aux chaînes et ne reformatait que les nombres — repris tel
 * quel, il aurait laissé passer « 0.190000 » là où le contrat attend « 0.1900 »,
 * et ce décalage se serait glissé dans chaque décimale du portage sans qu'aucun
 * type ne s'en plaigne.
 *
 * On refixe donc toujours, quelle que soit la représentation d'arrivée.
 */
function decStr(v: unknown, decimals: number): string {
  if (v === null || v === undefined) return (0).toFixed(decimals);
  return Number(v).toFixed(decimals);
}

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

export const referentiel = {
  async activePack(db: Requete, jurisdiction: string) {
    const { rows } = await db.query(
      `select id, jurisdiction, version, effective_from, ratified
         from ref_packs_v
        where jurisdiction = $1 and effective_from <= $2
        order by effective_from desc
        limit 1`,
      [jurisdiction, aujourdhui()],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row["id"] as string,
      jurisdiction: row["jurisdiction"] as string,
      version: row["version"] as string,
      effectiveFrom: row["effective_from"] as string,
      ratified: Boolean(row["ratified"]),
    };
  },

  async taxRates(db: Requete, packId: string, jurisdiction: string) {
    const { rows } = await db.query(
      `select code, label, rate, valid_from, valid_to
         from ref_tva_rates_v where pack_version_id = $1`,
      [packId],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        code: row["code"] as string,
        label: (row["label"] as string) ?? (row["code"] as string),
        rate: decStr(row["rate"], 4),
        validFrom: row["valid_from"] as string,
        validTo: (row["valid_to"] as string | null) ?? null,
        jurisdiction,
      };
    });
  },

  async accountMappings(db: Requete, packId: string) {
    const { rows } = await db.query(
      `select document_kind, tax_code, main_account, vat_account, counterparty_account
         from ref_account_mappings_v where pack_version_id = $1`,
      [packId],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        documentKind: row["document_kind"] as string,
        taxCode: (row["tax_code"] as string | null) ?? null,
        mainAccount: row["main_account"] as string,
        vatAccount: row["vat_account"] as string,
        counterpartyAccount: row["counterparty_account"] as string,
      };
    });
  },

  async fiscalCharges(db: Requete, packId: string) {
    const jour = aujourdhui();
    const { rows } = await db.query(
      `select code, label, document_kind, account_code, fixed_amount,
              legal_reference, valid_from, valid_to
         from ref_fiscal_charges_v
        where pack_version_id = $1 and valid_from <= $2`,
      [packId, jour],
    );
    return rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => !r["valid_to"] || (r["valid_to"] as string) >= jour)
      .map((r) => ({
        code: r["code"] as string,
        label: r["label"] as string,
        documentKind: r["document_kind"] as string,
        accountCode: r["account_code"] as string,
        fixedAmount:
          r["fixed_amount"] === null || r["fixed_amount"] === undefined
            ? null
            : decStr(r["fixed_amount"], 3),
        legalReference: (r["legal_reference"] as string | null) ?? null,
      }));
  },

  async socleParams(db: Requete, packId: string) {
    const { rows } = await db.query(
      `select code, value_text, value_num from ref_socle_params_v where pack_version_id = $1`,
      [packId],
    );
    const parCode = new Map<string, { text: string | null; num: unknown }>();
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      parCode.set(row["code"] as string, {
        text: (row["value_text"] as string | null) ?? null,
        num: row["value_num"],
      });
    }

    // Un paramètre absent lève, il ne retombe pas sur une valeur par défaut :
    // un pack incomplet doit se voir, pas produire un calcul plausible.
    const num = (code: string): number => {
      const v = parCode.get(code)?.num;
      if (v === null || v === undefined) {
        throw new Error(`Paramètre du Socle absent du pack : ${code}`);
      }
      return Number(v);
    };
    const text = (code: string): string => {
      const v = parCode.get(code)?.text;
      if (!v) throw new Error(`Paramètre du Socle absent du pack : ${code}`);
      return v;
    };

    const decimals = num("money.decimals");
    const methode = text("stock.methode");
    if (methode !== "cump" && methode !== "fifo") {
      throw new Error(`Méthode de stock inconnue au pack : ${methode}`);
    }
    return {
      packVersionId: packId,
      moneyDecimals: decimals,
      stockMethode: methode,
      stockQuantiteDecimals: num("stock.quantite_decimals"),
      rapprochementToleranceJours: num("rapprochement.tolerance_jours"),
      rapprochementToleranceMontant: num("rapprochement.tolerance_montant").toFixed(decimals),
    };
  },
};
