/**
 * La collaboration — équipe du cabinet, affectations, PV, notifications,
 * échéances, mur de visibilité.
 *
 * Les filtres par tenant présents ici ne défendent rien : ils réduisent ce
 * qu'on demande. C'est la RLS qui décide de ce qui remonte — et c'est pourquoi
 * il n'y a pas de vérification d'appartenance dans ce fichier.
 */

import type { Requete } from "../db.ts";

function texte(v: unknown, defaut = "—"): string {
  return (v as string | null) ?? defaut;
}

export const collab = {
  async members(db: Requete, cabinetTenantId: string) {
    const { rows } = await db.query(
      `select tenant_id, user_id, role, email from cabinet_members_v where tenant_id = $1`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map((m) => ({
      tenantId: m["tenant_id"] as string,
      userId: m["user_id"] as string,
      role: texte(m["role"]),
      email: texte(m["email"]),
    }));
  },

  async assignments(db: Requete, cabinetTenantId: string) {
    const { rows } = await db.query(
      `select id, cabinet_tenant_id, client_tenant_id, collaborator_id, briefing,
              active, seq, created_at
         from collab_assignments_v where cabinet_tenant_id = $1 order by created_at desc`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map((a) => ({
      id: a["id"] as string,
      cabinetTenantId: a["cabinet_tenant_id"] as string,
      clientTenantId: a["client_tenant_id"] as string,
      collaboratorId: a["collaborator_id"] as string,
      briefing: (a["briefing"] as string | null) ?? null,
      active: Boolean(a["active"]),
      seq: Number(a["seq"] ?? 1),
      createdAt: a["created_at"] as string,
    }));
  },

  async assign(
    db: Requete,
    input: {
      cabinetTenantId: string;
      clientTenantId: string;
      collaboratorId: string;
      briefing?: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.collab_assign($1, $2, $3, $4) as id`,
      [input.cabinetTenantId, input.clientTenantId, input.collaboratorId, input.briefing ?? null],
    );
    return rows[0]!.id;
  },

  async pvList(db: Requete, cabinetTenantId: string) {
    const { rows } = await db.query(
      `select id, client_tenant_id, at, titre, participants, ordre_du_jour, decisions, created_at
         from collab_pv_v where cabinet_tenant_id = $1 order by at desc`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map((p) => ({
      id: p["id"] as string,
      clientTenantId: (p["client_tenant_id"] as string | null) ?? null,
      at: p["at"] as string,
      titre: p["titre"] as string,
      participants: (p["participants"] as string | null) ?? null,
      ordreDuJour: (p["ordre_du_jour"] as string | null) ?? null,
      decisions: (p["decisions"] as string | null) ?? null,
      createdAt: p["created_at"] as string,
    }));
  },

  async addPv(
    db: Requete,
    input: {
      cabinetTenantId: string;
      clientTenantId?: string | null;
      at: string;
      titre: string;
      participants?: string | null;
      ordreDuJour?: string | null;
      decisions?: string | null;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into collab_pv_v
         (cabinet_tenant_id, client_tenant_id, at, titre, participants, ordre_du_jour, decisions)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        input.cabinetTenantId,
        input.clientTenantId ?? null,
        input.at,
        input.titre,
        input.participants ?? null,
        input.ordreDuJour ?? null,
        input.decisions ?? null,
      ],
    );
    return rows[0]!.id;
  },

  async stats(db: Requete, tenantIds: string[]) {
    if (tenantIds.length === 0) return [];
    const { rows } = await db.query(
      `select tenant_id, pieces, capturees, lues, proposees, comptabilisees,
              supervisees, retournees, heures_moyennes, derniere_piece
         from cabinet_stats_v where tenant_id = any($1::uuid[])`,
      [tenantIds],
    );
    return (rows as Record<string, unknown>[]).map((s) => ({
      tenantId: s["tenant_id"] as string,
      pieces: Number(s["pieces"] ?? 0),
      capturees: Number(s["capturees"] ?? 0),
      lues: Number(s["lues"] ?? 0),
      proposees: Number(s["proposees"] ?? 0),
      comptabilisees: Number(s["comptabilisees"] ?? 0),
      supervisees: Number(s["supervisees"] ?? 0),
      retournees: Number(s["retournees"] ?? 0),
      heuresMoyennes: Number(s["heures_moyennes"] ?? 0),
      dernierePiece: (s["derniere_piece"] as string | null) ?? null,
    }));
  },

  async notifications(db: Requete, tenantIds: string[]) {
    if (tenantIds.length === 0) return [];
    const { rows } = await db.query(
      `select id, tenant_id, kind, payload, read_at, created_at
         from notifications_v where tenant_id = any($1::uuid[])
        order by created_at desc limit 100`,
      [tenantIds],
    );
    return (rows as Record<string, unknown>[]).map((n) => ({
      id: n["id"] as string,
      tenantId: n["tenant_id"] as string,
      kind: n["kind"] as string,
      payload: n["payload"],
      readAt: (n["read_at"] as string | null) ?? null,
      createdAt: n["created_at"] as string,
    }));
  },

  async markRead(db: Requete, id: string): Promise<void> {
    // `now()` plutôt que l'horloge du navigateur : deux postes mal réglés
    // dateraient la même lecture à des heures différentes.
    await db.query(`update notifications_v set read_at = now() where id = $1`, [id]);
  },

  async echeances(db: Requete, tenantIds: string[]) {
    if (tenantIds.length === 0) return [];
    const { rows } = await db.query(
      `select id, tenant_id, kind, label, period, due_date, status
         from echeances_v where tenant_id = any($1::uuid[]) order by due_date`,
      [tenantIds],
    );
    return (rows as Record<string, unknown>[]).map((e) => ({
      id: e["id"] as string,
      tenantId: e["tenant_id"] as string,
      kind: e["kind"] as string,
      label: texte(e["label"]),
      period: (e["period"] as string | null) ?? null,
      dueDate: e["due_date"] as string,
      status: (e["status"] as string) ?? "a_venir",
    }));
  },

  async setPieceVis(db: Requete, pieceId: string, vis: string): Promise<boolean> {
    const { rows } = await db.query<{ changed: boolean }>(
      // La fonction rend du jsonb : on en extrait le drapeau, on ne le suppose pas.
      `select (public.capture_piece_set_vis($1, $2::app.vis_t) ->> 'changed')::boolean as changed`,
      [pieceId, vis],
    );
    return Boolean(rows[0]?.changed);
  },
};
