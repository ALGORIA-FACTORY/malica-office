/**
 * Les immobilisations — biens, dotations, dépréciations, cessions.
 *
 * Comme pour les stocks, les gestes qui engagent sont indivisibles :
 * `constaterDotation` et `constaterDepreciation` écrivent le fait ET son
 * écriture comptable dans la même transaction. Les `record*` de l'ancien port,
 * qui n'écrivaient que le journal, ne sont pas portées : elles sont supprimées.
 *
 * `recordCession` reste, elle : la cession n'a pas encore d'équivalent
 * indivisible. L'écran des immobilisations calcule le résultat de cession
 * par `computeCession`, enregistre la cession, puis passe le bien à « cédé ».
 *
 * Dès qu'une dotation, une dépréciation ou une cession est constatée, la base
 * refuse de modifier ce qui fonde le plan du bien (valeur, durée, méthode,
 * mise en service) : seuls le libellé et l'état restent ouverts.
 *
 * Signatures relues avant écriture : les deux fonctions rendent du `jsonb`.
 */

import type { Requete } from "../db.ts";
import { dec } from "./decimal.ts";

export const immo = {
  async categories(db: Requete, packVersionId: string) {
    const { rows } = await db.query(
      `select id, code, label, method, duree_annees, coefficient, account_immo,
              account_amort, account_dotation, legal_reference
         from ref_immo_categories_v where pack_version_id = $1 order by code`,
      [packVersionId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      code: r["code"] as string,
      label: r["label"] as string,
      method: r["method"] as string,
      dureeAnnees: Number(r["duree_annees"]),
      coefficient: dec(r["coefficient"], 4),
      accountImmo: r["account_immo"] as string,
      accountAmort: r["account_amort"] as string,
      accountDotation: r["account_dotation"] as string,
      legalReference: (r["legal_reference"] as string | null) ?? null,
    }));
  },

  async listAssets(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, tenant_id, category_id, label, mise_en_service, valeur_brute,
              valeur_residuelle, method, duree_annees, coefficient, devise, status,
              piece_id, created_at
         from immo_assets_v where tenant_id = $1 order by mise_en_service desc`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      tenantId: r["tenant_id"] as string,
      categoryId: r["category_id"] as string,
      label: r["label"] as string,
      miseEnService: r["mise_en_service"] as string,
      valeurBrute: dec(r["valeur_brute"]),
      valeurResiduelle: dec(r["valeur_residuelle"]),
      method: r["method"] as string,
      dureeAnnees: Number(r["duree_annees"]),
      coefficient: dec(r["coefficient"], 4),
      devise: r["devise"] as string,
      status: r["status"] as string,
      pieceId: (r["piece_id"] as string | null) ?? null,
      createdAt: r["created_at"] as string,
    }));
  },

  async createAsset(
    db: Requete,
    input: {
      tenantId: string;
      entityId: string | null;
      vis?: string;
      pieceId?: string | null;
      categoryId: string;
      label: string;
      miseEnService: string;
      valeurBrute: string;
      valeurResiduelle: string;
      method: string;
      dureeAnnees: number;
      coefficient: string;
      devise: string;
      packVersionId: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into immo_assets_v
         (tenant_id, entity_id, vis, piece_id, category_id, label, mise_en_service,
          valeur_brute, valeur_residuelle, method, duree_annees, coefficient,
          devise, pack_version_id)
       values ($1, $2, $3::app.vis_t, $4, $5, $6, $7, $8::numeric, $9::numeric,
               $10, $11, $12::numeric, $13, $14) returning id`,
      [
        input.tenantId,
        input.entityId,
        input.vis ?? "partage",
        input.pieceId ?? null,
        input.categoryId,
        input.label,
        input.miseEnService,
        input.valeurBrute,
        input.valeurResiduelle,
        input.method,
        input.dureeAnnees,
        input.coefficient,
        input.devise,
        input.packVersionId,
      ],
    );
    return rows[0]!.id;
  },

  async updateAsset(
    db: Requete,
    input: {
      id: string;
      label: string;
      miseEnService: string;
      valeurBrute: string;
      valeurResiduelle: string;
      method: string;
      dureeAnnees: number;
      coefficient: string;
      status: string;
    },
  ): Promise<void> {
    await db.query(
      `update immo_assets_v
          set label = $2, mise_en_service = $3, valeur_brute = $4::numeric,
              valeur_residuelle = $5::numeric, method = $6, duree_annees = $7,
              coefficient = $8::numeric, status = $9
        where id = $1`,
      [
        input.id,
        input.label,
        input.miseEnService,
        input.valeurBrute,
        input.valeurResiduelle,
        input.method,
        input.dureeAnnees,
        input.coefficient,
        input.status,
      ],
    );
  },

  async dotations(db: Requete, tenantId: string, assetId?: string) {
    const { rows } = await db.query(
      `select id, asset_id, exercice, months, dotation, cumul, vnc, ecriture_id, created_at
         from immo_dotations_v
        where tenant_id = $1 and ($2::uuid is null or asset_id = $2)
        order by exercice`,
      [tenantId, assetId ?? null],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      assetId: r["asset_id"] as string,
      exercice: Number(r["exercice"]),
      months: Number(r["months"]),
      dotation: dec(r["dotation"]),
      cumul: dec(r["cumul"]),
      vnc: dec(r["vnc"]),
      ecritureId: (r["ecriture_id"] as string | null) ?? null,
      createdAt: r["created_at"] as string,
    }));
  },

  async constaterDotation(
    db: Requete,
    input: {
      assetId: string;
      exercice: number;
      months: number;
      dotation: string;
      cumul: string;
      vnc: string;
      packVersionId: string;
      date?: string;
    },
  ) {
    const { rows } = await db.query<{ dotation: string; ecriture: string }>(
      `select r ->> 'dotation_id' as dotation, r ->> 'ecriture_id' as ecriture
         from public.immo_dotation_constater(
           $1, $2::smallint, $3::smallint, $4::numeric, $5::numeric, $6::numeric, $7, $8) as r`,
      [
        input.assetId,
        input.exercice,
        input.months,
        input.dotation,
        input.cumul,
        input.vnc,
        input.packVersionId,
        input.date ?? null,
      ],
    );
    return { dotationId: rows[0]!.dotation, ecritureId: rows[0]!.ecriture };
  },

  async depreciations(db: Requete, tenantId: string, assetId?: string) {
    const { rows } = await db.query(
      `select id, asset_id, at, vnc, valeur_recouvrable, mouvement, cumul, note,
              ecriture_id, created_at
         from immo_depreciations_v
        where tenant_id = $1 and ($2::uuid is null or asset_id = $2)
        order by at`,
      [tenantId, assetId ?? null],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      assetId: r["asset_id"] as string,
      at: r["at"] as string,
      vnc: dec(r["vnc"]),
      valeurRecouvrable: dec(r["valeur_recouvrable"]),
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
      assetId: string;
      at: string;
      vnc: string;
      valeurRecouvrable: string;
      mouvement: string;
      cumul: string;
      packVersionId: string;
      note?: string | null;
    },
  ) {
    const { rows } = await db.query<{ depreciation: string; ecriture: string }>(
      `select r ->> 'depreciation_id' as depreciation, r ->> 'ecriture_id' as ecriture
         from public.immo_depreciation_constater(
           $1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7, $8) as r`,
      [
        input.assetId,
        input.at,
        input.vnc,
        input.valeurRecouvrable,
        input.mouvement,
        input.cumul,
        input.packVersionId,
        input.note ?? null,
      ],
    );
    return { depreciationId: rows[0]!.depreciation, ecritureId: rows[0]!.ecriture };
  },

  async cessions(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, asset_id, at, prix, vnc, resultat, created_at
         from immo_cessions_v where tenant_id = $1 order by at desc`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      assetId: r["asset_id"] as string,
      at: r["at"] as string,
      prix: dec(r["prix"]),
      vnc: dec(r["vnc"]),
      resultat: dec(r["resultat"]),
      createdAt: r["created_at"] as string,
    }));
  },

  async recordCession(
    db: Requete,
    input: {
      tenantId: string;
      assetId: string;
      at: string;
      prix: string;
      vnc: string;
      resultat: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into immo_cessions_v (tenant_id, asset_id, at, prix, vnc, resultat)
       values ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric) returning id`,
      [input.tenantId, input.assetId, input.at, input.prix, input.vnc, input.resultat],
    );
    return rows[0]!.id;
  },
};
