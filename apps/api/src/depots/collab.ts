/**
 * La collaboration — équipe du cabinet, affectations, PV, notifications,
 * échéances, mur de visibilité.
 *
 * Les filtres par tenant présents ici ne défendent rien : ils réduisent ce
 * qu'on demande. C'est la RLS qui décide de ce qui remonte — et c'est pourquoi
 * il n'y a pas de vérification d'appartenance dans ce fichier.
 */

import type { Requete } from "../db.ts";

/** Une invitation reçue, vue par la personne qui peut la rejoindre. */
export interface InvitationRecue {
  id: string;
  cabinetTenantId: string;
  cabinet: string;
  role: string;
  expiresAt: string;
}

function texte(v: unknown, defaut = "—"): string {
  return (v as string | null) ?? defaut;
}

const COLONNES_PV = `id, cabinet_tenant_id, client_tenant_id, at, titre, participants, ordre_du_jour, decisions,
       created_at, sections, chiffres, ton, statut, envoye_le, redige_par_malica`;

/** Un PV tel que la vue le rend. Les tableaux JSON arrivent déjà décodés par pg. */
function versPv(p: Record<string, unknown>) {
  return {
    id: p["id"] as string,
    cabinetTenantId: p["cabinet_tenant_id"] as string,
    clientTenantId: (p["client_tenant_id"] as string | null) ?? null,
    at: p["at"] as string,
    titre: p["titre"] as string,
    participants: (p["participants"] as string | null) ?? null,
    ordreDuJour: (p["ordre_du_jour"] as string | null) ?? null,
    decisions: (p["decisions"] as string | null) ?? null,
    createdAt: p["created_at"] as string,
    sections: Array.isArray(p["sections"])
      ? (p["sections"] as Array<{ kicker: string; corps: string }>)
      : [],
    chiffres: Array.isArray(p["chiffres"])
      ? (p["chiffres"] as Array<{
          label: string;
          valeur: string;
          source: string;
          genre: "montant" | "nombre";
          devise: string | null;
        }>)
      : [],
    ton: (p["ton"] as string | null) ?? null,
    statut: (p["statut"] as string) ?? "brouillon",
    envoyeLe: (p["envoye_le"] as string | null) ?? null,
    redigeParMalica: Boolean(p["redige_par_malica"]),
  };
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
      `select ${COLONNES_PV}
         from collab_pv_v where cabinet_tenant_id = $1 order by at desc, created_at desc`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map(versPv);
  },

  async pvOuvrir(db: Requete, id: string) {
    const { rows } = await db.query(`select ${COLONNES_PV} from collab_pv_v where id = $1`, [id]);
    const p = (rows as Record<string, unknown>[])[0];
    return p ? versPv(p) : null;
  },

  /**
   * Reprendre un brouillon : le texte, les chiffres, les décisions. Ce qu'on
   * ne passe pas reste tel quel. Un PV envoyé est refusé par le déclencheur
   * de la base (R7) — ce dépôt n'a rien à vérifier.
   *
   * Les tableaux passent en JSON explicite : pg rendrait sinon un tableau
   * PostgreSQL, que la colonne jsonb refuserait.
   */
  async pvEnregistrer(
    db: Requete,
    input: {
      id: string;
      titre?: string;
      participants?: string | null;
      decisions?: string | null;
      sections?: Array<{ kicker: string; corps: string }>;
      chiffres?: Array<{
        label: string;
        valeur: string;
        source: string;
        genre: "montant" | "nombre";
        devise: string | null;
      }>;
      ton?: string | null;
      redigeParMalica?: boolean;
    },
  ) {
    const { rows } = await db.query(
      `update collab_pv_v
          set titre               = coalesce($2, titre),
              participants        = case when $3::boolean then $4 else participants end,
              decisions           = case when $5::boolean then $6 else decisions end,
              sections            = coalesce($7::jsonb, sections),
              chiffres            = coalesce($8::jsonb, chiffres),
              ton                 = case when $9::boolean then $10 else ton end,
              redige_par_malica = coalesce($11, redige_par_malica)
        where id = $1
        returning ${COLONNES_PV}`,
      [
        input.id,
        input.titre ?? null,
        input.participants !== undefined,
        input.participants ?? null,
        input.decisions !== undefined,
        input.decisions ?? null,
        input.sections ? JSON.stringify(input.sections) : null,
        input.chiffres ? JSON.stringify(input.chiffres) : null,
        input.ton !== undefined,
        input.ton ?? null,
        input.redigeParMalica ?? null,
      ],
    );
    const p = (rows as Record<string, unknown>[])[0];
    if (!p) throw new Error("pv.introuvable");
    return versPv(p);
  },

  async pvEnvoyer(db: Requete, id: string) {
    const { rows } = await db.query<{
      r: { id: string; statut: string; envoyeLe: string | null };
    }>(`select public.pv_envoyer($1) as r`, [id]);
    const r = rows[0]?.r;
    if (!r) throw new Error("pv.introuvable");
    return { id: r.id, statut: r.statut, envoyeLe: r.envoyeLe ?? null };
  },

  async invitations(db: Requete, cabinetTenantId: string) {
    const { rows } = await db.query(
      `select id, tenant_id, email, role, expires_at, accepted_at, created_at
         from invitations_v where tenant_id = $1 order by created_at desc`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map((i) => ({
      id: i["id"] as string,
      tenantId: i["tenant_id"] as string,
      email: i["email"] as string,
      role: i["role"] as string,
      expiresAt: i["expires_at"] as string,
      acceptedAt: (i["accepted_at"] as string | null) ?? null,
      createdAt: i["created_at"] as string,
    }));
  },

  /** Les invitations adressées à l'adresse du compte connecté, encore valables. */
  async invitationsPourMoi(db: Requete): Promise<InvitationRecue[]> {
    const { rows } = await db.query<{ r: InvitationRecue[] | null }>(
      `select public.invitations_pour_moi() as r`,
    );
    return rows[0]?.r ?? [];
  },

  /** Rejoindre le cabinet avec le rôle réservé, ou décliner. */
  async repondreAInvitation(
    db: Requete,
    id: string,
    accepte: boolean,
  ): Promise<{ id: string; tenantId: string; role: string; rejoint: boolean }> {
    const { rows } = await db.query<{
      r: { id: string; tenantId: string; role: string; rejoint: boolean };
    }>(`select public.invitation_repondre($1, $2) as r`, [id, accepte]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.sans_reponse");
    return { ...r, rejoint: Boolean(r.rejoint) };
  },

  /** Consigne une invitation ; la base refuse une adresse déjà membre. */
  async inviter(db: Requete, input: { tenantId: string; email: string; role: string }) {
    const { rows } = await db.query<{
      r: { id: string; email: string; role: string; expiresAt: string; deja: boolean };
    }>(`select public.cabinet_inviter($1, $2, $3) as r`, [input.tenantId, input.email, input.role]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_creee");
    return { ...r, deja: Boolean(r.deja) };
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

  /**
   * Les échéances des dossiers, avec l'obligation qui fonde chacune : sa
   * règle littérale, son texte, son article. Rien ici n'est saisi.
   */
  async echeances(db: Requete, tenantIds: string[]) {
    if (tenantIds.length === 0) return [];
    const { rows } = await db.query(
      `select id, tenant_id, kind, label, period, due_date, status, fait_le,
              echeance_regle, texte_source, article, periodicite
         from echeances_v where tenant_id = any($1::uuid[]) order by due_date, label`,
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
      faitLe: (e["fait_le"] as string | null) ?? null,
      regle: (e["echeance_regle"] as string | null) ?? null,
      texteSource: (e["texte_source"] as string | null) ?? null,
      article: (e["article"] as string | null) ?? null,
      periodicite: (e["periodicite"] as string | null) ?? null,
    }));
  },

  /**
   * Dériver le calendrier de chaque dossier depuis le pack. Idempotent : ce
   * qui existe est mis à jour, ce qui est fait reste fait. Quand rien ne
   * peut être dérivé, la raison le dit — et l'écran la montre.
   */
  async deriverEcheances(db: Requete, tenantIds: string[]) {
    const resultats: Array<{ tenantId: string; generees: number; raison: string | null }> = [];
    for (const tenantId of tenantIds) {
      const { rows } = await db.query<{ r: { generees: number; raison: string | null } }>(
        `select public.echeances_deriver($1) as r`,
        [tenantId],
      );
      const r = rows[0]?.r;
      resultats.push({ tenantId, generees: r?.generees ?? 0, raison: r?.raison ?? null });
    }
    return resultats;
  },

  /** L'expert dit qu'une échéance est faite, ou la rouvre. Le journal le garde. */
  async marquerEcheance(db: Requete, id: string, fait: boolean): Promise<{ status: string }> {
    const { rows } = await db.query<{ r: { status: string } }>(
      `select public.echeance_marquer($1, $2) as r`,
      [id, fait],
    );
    const status = rows[0]?.r.status;
    if (!status) throw new Error("echeance.introuvable");
    return { status };
  },

  async setPieceVis(
    db: Requete,
    pieceId: string,
    vis: "personnel" | "entite" | "partage",
  ): Promise<boolean> {
    const { rows } = await db.query<{ changed: boolean }>(
      // La fonction rend du jsonb : on en extrait le drapeau, on ne le suppose pas.
      `select (public.capture_piece_set_vis($1, $2::app.vis_t) ->> 'changed')::boolean as changed`,
      [pieceId, vis],
    );
    return Boolean(rows[0]?.changed);
  },

  /**
   * Garder la pièce chez soi, et le DIRE.
   *
   * La base refuse le geste sur une pièce déjà transmise : ce retour-là passe
   * par l'accord du cabinet, et un bouton « garder » qui l'autoriserait
   * contournerait la seule règle qui en exige un.
   */
  async garderPiece(db: Requete, pieceId: string): Promise<{ changed: boolean }> {
    const { rows } = await db.query<{ changed: boolean }>(
      `select (public.capture_piece_garder($1) ->> 'changed')::boolean as changed`,
      [pieceId],
    );
    return { changed: Boolean(rows[0]?.changed) };
  },

  /**
   * La PME demande au cabinet de rappeler ou d'effacer une pièce transmise.
   *
   * ================================================================= POURQUOI
   *
   * 11 octobre 2026 : « le rappel de la pièce doit être approuvé par le
   * cabinet ». La veille j'avais livré un rappel unilatéral — corrigeant un
   * défaut par un autre : le cabinet travaille sur ce qu'il a reçu, et une
   * pièce qui disparaît de sa file sans un mot est pire que l'état bloqué
   * qu'on voulait défaire.
   *
   * Un seul mécanisme pour les deux motifs : « une pièce transmise au cabinet
   * peut être effacée par accord du cabinet » (7 octobre) est la même phrase,
   * le même geste, la même partie qui tranche.
   */
  async demanderSurPiece(db: Requete, pieceId: string, objet: "rappel" | "suppression") {
    const { rows } = await db.query<{ deja: boolean }>(
      `select (public.piece_demander($1, $2) ->> 'deja')::boolean as deja`,
      [pieceId, objet],
    );
    return { dejaDemandee: Boolean(rows[0]?.deja) };
  },

  /** Le cabinet tranche. Un accord de rappel remet la pièce chez la PME, ici même. */
  async repondreSurPiece(
    db: Requete,
    pieceId: string,
    objet: "rappel" | "suppression",
    accorde: boolean,
    note?: string | null,
  ) {
    await db.query(`select public.piece_repondre($1, $2, $3, $4)`, [
      pieceId,
      objet,
      accorde,
      note ?? null,
    ]);
  },

  /** Les demandes portées sur une pièce, du fait le plus récent au plus ancien. */
  async demandesDUnePiece(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      `select objet, fait, note, created_at from demandes_sur_piece_v
        where piece_id = $1 order by created_at desc`,
      [pieceId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      objet: r["objet"] as "rappel" | "suppression",
      fait: r["fait"] as "demandee" | "accordee" | "refusee",
      note: (r["note"] as string | null) ?? null,
      createdAt: (r["created_at"] as Date).toISOString(),
    }));
  },
};
