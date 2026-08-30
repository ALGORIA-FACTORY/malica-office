/**
 * Les stocks — articles, mouvements, inventaires, dépréciations.
 *
 * Les deux gestes qui engagent — constater un inventaire, constater une
 * dépréciation — sont indivisibles : ils écrivent le fait ET son écriture
 * comptable dans la même transaction. C'est ce qui les distingue des méthodes
 * `record*` de l'ancien port, qui n'écrivaient que le journal et laissaient la
 * comptabilité muette. Elles ne sont pas portées : elles sont supprimées.
 *
 * Signatures relues avant écriture : les deux fonctions rendent du `jsonb`.
 */

import type { Requete } from "../db.ts";
import { dec, decOuNul } from "./decimal.ts";

export const stocks = {
  async categories(db: Requete, packVersionId: string) {
    const { rows } = await db.query(
      `select id, code, label, account_stock, account_variation, account_provision,
              account_provision_dotation, account_provision_reprise, legal_reference
         from ref_stock_categories_v where pack_version_id = $1 order by code`,
      [packVersionId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      code: r["code"] as string,
      label: r["label"] as string,
      accountStock: r["account_stock"] as string,
      accountVariation: r["account_variation"] as string,
      accountProvision: r["account_provision"] as string,
      accountProvisionDotation: r["account_provision_dotation"] as string,
      accountProvisionReprise: r["account_provision_reprise"] as string,
      legalReference: (r["legal_reference"] as string | null) ?? null,
    }));
  },

  async listItems(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, tenant_id, category_id, reference, designation, unite, methode,
              account_stock, account_variation, devise, active
         from stocks_items_v where tenant_id = $1 order by reference`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      tenantId: r["tenant_id"] as string,
      categoryId: (r["category_id"] as string | null) ?? null,
      reference: r["reference"] as string,
      designation: r["designation"] as string,
      unite: r["unite"] as string,
      methode: r["methode"] as string,
      accountStock: r["account_stock"] as string,
      accountVariation: r["account_variation"] as string,
      devise: r["devise"] as string,
      active: Boolean(r["active"]),
    }));
  },

  async createItem(
    db: Requete,
    input: {
      tenantId: string;
      entityId: string;
      categoryId: string;
      reference: string;
      designation: string;
      unite: string;
      methode: string;
      accountStock: string;
      accountVariation: string;
      devise: string;
      packVersionId: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into stocks_items_v
         (tenant_id, entity_id, category_id, reference, designation, unite, methode,
          account_stock, account_variation, devise, pack_version_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        input.tenantId,
        input.entityId,
        input.categoryId,
        input.reference,
        input.designation,
        input.unite,
        input.methode,
        input.accountStock,
        input.accountVariation,
        input.devise,
        input.packVersionId,
      ],
    );
    return rows[0]!.id;
  },

  async updateItem(
    db: Requete,
    input: { id: string; designation: string; unite: string; methode: string; active: boolean },
  ): Promise<void> {
    await db.query(
      `update stocks_items_v set designation = $2, unite = $3, methode = $4, active = $5
        where id = $1`,
      [input.id, input.designation, input.unite, input.methode, input.active],
    );
  },

  async mouvements(db: Requete, tenantId: string, itemId?: string) {
    // Le filtre optionnel passe par un paramètre nul plutôt que par une requête
    // construite à la main : aucune chaîne SQL n'est assemblée.
    const { rows } = await db.query(
      `select id, item_id, sens, at, quantite, cout_unitaire, reference, piece_id
         from stocks_mouvements_v
        where tenant_id = $1 and ($2::uuid is null or item_id = $2)
        order by at`,
      [tenantId, itemId ?? null],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      itemId: r["item_id"] as string,
      sens: r["sens"] as string,
      at: r["at"] as string,
      quantite: dec(r["quantite"]),
      coutUnitaire: decOuNul(r["cout_unitaire"]),
      reference: (r["reference"] as string | null) ?? null,
      pieceId: (r["piece_id"] as string | null) ?? null,
    }));
  },

  async addMouvement(
    db: Requete,
    input: {
      tenantId: string;
      itemId: string;
      sens: string;
      at: string;
      quantite: string;
      coutUnitaire?: string | null;
      reference?: string | null;
      pieceId?: string | null;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into stocks_mouvements_v
         (tenant_id, item_id, sens, at, quantite, cout_unitaire, reference, piece_id)
       values ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8) returning id`,
      [
        input.tenantId,
        input.itemId,
        input.sens,
        input.at,
        input.quantite,
        input.coutUnitaire ?? null,
        input.reference ?? null,
        input.pieceId ?? null,
      ],
    );
    return rows[0]!.id;
  },

  async inventaires(db: Requete, tenantId: string, itemId?: string) {
    const { rows } = await db.query(
      `select id, item_id, period, initial, final, variation, ecriture_id, created_at
         from stocks_inventaires_v
        where tenant_id = $1 and ($2::uuid is null or item_id = $2)
        order by period`,
      [tenantId, itemId ?? null],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      itemId: (r["item_id"] as string | null) ?? null,
      period: r["period"] as string,
      initial: dec(r["initial"]),
      final: dec(r["final"]),
      variation: dec(r["variation"]),
      ecritureId: (r["ecriture_id"] as string | null) ?? null,
      createdAt: r["created_at"] as string,
    }));
  },

  async constaterInventaire(
    db: Requete,
    input: {
      itemId: string;
      period: string;
      initial: string;
      final: string;
      variation: string;
      packVersionId: string;
      date: string;
    },
  ) {
    const { rows } = await db.query<{ inventaire: string; ecriture: string }>(
      `select r ->> 'inventaire_id' as inventaire, r ->> 'ecriture_id' as ecriture
         from public.stocks_inventaire_constater(
           $1, $2, $3::numeric, $4::numeric, $5::numeric, $6, $7) as r`,
      [
        input.itemId,
        input.period,
        input.initial,
        input.final,
        input.variation,
        input.packVersionId,
        input.date,
      ],
    );
    return { inventaireId: rows[0]!.inventaire, ecritureId: rows[0]!.ecriture };
  },

  async depreciations(db: Requete, tenantId: string, itemId?: string) {
    const { rows } = await db.query(
      `select id, item_id, at, valeur_stock, valeur_nette, mouvement, cumul, note,
              ecriture_id, created_at
         from stocks_depreciations_v
        where tenant_id = $1 and ($2::uuid is null or item_id = $2)
        order by at`,
      [tenantId, itemId ?? null],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      itemId: r["item_id"] as string,
      at: r["at"] as string,
      valeurStock: dec(r["valeur_stock"]),
      valeurNette: dec(r["valeur_nette"]),
      mouvement: dec(r["mouvement"]),
      cumul: dec(r["cumul"]),
      note: (r["note"] as string | null) ?? null,
      ecritureId: (r["ecriture_id"] as string | null) ?? null,
      createdAt: r["created_at"] as string,
    }));
  },

  async constaterDepreciation(
    db: Requete,
    input: {
      itemId: string;
      at: string;
      valeurStock: string;
      valeurNette: string;
      mouvement: string;
      cumul: string;
      packVersionId: string;
      note?: string;
    },
  ) {
    const { rows } = await db.query<{ depreciation: string; ecriture: string }>(
      `select r ->> 'depreciation_id' as depreciation, r ->> 'ecriture_id' as ecriture
         from public.stocks_depreciation_constater(
           $1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7, $8) as r`,
      [
        input.itemId,
        input.at,
        input.valeurStock,
        input.valeurNette,
        input.mouvement,
        input.cumul,
        input.packVersionId,
        input.note ?? null,
      ],
    );
    return { depreciationId: rows[0]!.depreciation, ecritureId: rows[0]!.ecriture };
  },
};
