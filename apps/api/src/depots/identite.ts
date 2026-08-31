/**
 * L'identité — organisations, établissements, création.
 *
 * L'adaptateur d'origine demandait l'utilisateur courant au client
 * d'authentification, puis croisait les appartenances en JavaScript. Ici,
 * `auth.uid()` est déjà posé dans la transaction : la jointure se fait en base,
 * en une requête au lieu de deux, et l'appartenance n'a pas à transiter.
 */

import type { Requete } from "../db.ts";

export const identite = {
  async listMyOrganizations(db: Requete) {
    const { rows } = await db.query(
      `select o.id, o.kind, o.name, o.legal_id, o.jurisdiction, o.currency,
              o.validation_mode, m.role
         from organizations_v o
         join memberships_v m on m.tenant_id = o.id and m.user_id = auth.uid()
        order by o.name`,
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row["id"] as string,
        kind: row["kind"] as string,
        name: row["name"] as string,
        legalId: (row["legal_id"] as string | null) ?? null,
        jurisdiction: row["jurisdiction"] as string,
        currency: row["currency"] as string,
        validationMode: row["validation_mode"] as string,
        role: (row["role"] as string) ?? "membre",
      };
    });
  },

  async listEntities(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, tenant_id, code, name, is_default
         from entities_v where tenant_id = $1 order by code`,
      [tenantId],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row["id"] as string,
        tenantId: row["tenant_id"] as string,
        code: row["code"] as string,
        name: row["name"] as string,
        isDefault: Boolean(row["is_default"]),
      };
    });
  },

  /**
   * Un cabinet prend un dossier en charge.
   *
   * Le geste manquait : les mandats existaient en base, avec leurs politiques,
   * et aucun chemin applicatif ne permettait d'''en créer un. On mandatait donc à
   * la main, ce qu'''aucun cabinet ne fera.
   *
   * La politique décide qui a le droit : le dirigeant de la PME ou l'''expert du
   * cabinet. Ici on insère, la base tranche.
   */
  async creerMandat(
    db: Requete,
    input: { pmeOrgId: string; cabinetOrgId: string; status?: string },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into engagements_v (pme_org_id, cabinet_org_id, status, created_by)
       values ($1, $2, $3, auth.uid())
       on conflict (pme_org_id, cabinet_org_id) do update set status = excluded.status
       returning id`,
      [input.pmeOrgId, input.cabinetOrgId, input.status ?? "actif"],
    );
    return rows[0]!.id;
  },

  async createOrganization(
    db: Requete,
    input: {
      kind: string;
      name: string;
      validationMode?: string;
      legalId?: string;
      jurisdiction: string;
      currency: string;
      defaultEntityName?: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.create_organization($1, $2, $3::app.validation_mode_t, $4, $5, $6) as id`,
      [
        input.kind,
        input.name,
        input.validationMode ?? "mandate",
        input.legalId ?? null,
        // Plus de repli : la juridiction vient de l'écran, la devise du pack.
        // Un `?? "TN"` ici décidait de la fiscalité d'un client par omission.
        input.jurisdiction,
        input.currency,
      ],
    );
    const orgId = rows[0]!.id;

    // Création et établissement principal dans la MÊME transaction : une
    // organisation sans établissement serait inutilisable, et l'adaptateur
    // d'origine pouvait la laisser dans cet état si le second appel échouait.
    await db.query(
      `insert into entities_v (tenant_id, code, name, is_default) values ($1, 'PRINCIPAL', $2, true)`,
      [orgId, input.defaultEntityName?.trim() || input.name],
    );

    return orgId;
  },
};
