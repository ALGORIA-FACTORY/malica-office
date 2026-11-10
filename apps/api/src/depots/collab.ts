/**
 * La collaboration — équipe du cabinet, affectations, PV, notifications,
 * échéances, mur de visibilité.
 *
 * Les filtres par tenant présents ici ne défendent rien : ils réduisent ce
 * qu'on demande. C'est la RLS qui décide de ce qui remonte — et c'est pourquoi
 * il n'y a pas de vérification d'appartenance dans ce fichier.
 */

import type {
  DemandeSurPiece,
  EtapeDeDemande,
  EtatDeDemande,
  FaitDeDemande,
} from "@malica/socle/ports/repositories";

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
       created_at, sections, chiffres, ton, statut, envoye_le, redige_par_malica,
       arrete::text as arrete`;

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
    arrete: (p["arrete"] as string | null) ?? null,
    redigeParMalica: Boolean(p["redige_par_malica"]),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /** Retirer l'affectation active d'un dossier : il redevient sans collaborateur. */
  async desaffecter(
    db: Requete,
    input: { cabinetTenantId: string; clientTenantId: string },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.collab_desaffecter($1, $2) as id`,
      [input.cabinetTenantId, input.clientTenantId],
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

  async pvDuClient(db: Requete, clientTenantId: string) {
    const { rows } = await db.query(
      `select p.*, (select r.recu_le from public.pv_receptions_v r
                    where r.pv_id = p.id and r.membre_id = auth.uid()) as recu_le,
             (select n.payload->>'cabinet' from public.notifications_v n
               where n.tenant_id = p.client_tenant_id and n.kind = 'pv.envoye'
                 and n.payload->>'pv_id' = p.id::text order by n.created_at desc limit 1) as comptabilite
         from public.collab_pv_v p
        where p.client_tenant_id = $1 and p.statut = 'envoye'
        order by p.envoye_le desc, p.created_at desc`,
      [clientTenantId],
    );
    return (rows as Record<string, unknown>[]).map((p) => ({
      document: versPv(p),
      recuLe: (p["recu_le"] as string | null) ?? null,
      comptabilite: (p["comptabilite"] as string | null) ?? null,
    }));
  },

  async pvAccuserReception(db: Requete, id: string): Promise<string> {
    const { rows } = await db.query<{ recu: string }>(
      `select public.pv_accuser_reception($1) as recu`,
      [id],
    );
    return rows[0]!.recu;
  },

  async pvReceptions(db: Requete, id: string) {
    const { rows } = await db.query<{ id: string; recu_le: string }>(
      `select id, recu_le from public.pv_receptions_v where pv_id = $1 order by recu_le`,
      [id],
    );
    return rows.map((r) => ({ id: r.id, recuLe: r.recu_le }));
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
    await db.query(
      `select public.pv_modifier($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
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
    const { rows } = await db.query(`select ${COLONNES_PV} from collab_pv_v where id = $1`, [
      input.id,
    ]);
    return versPv((rows as Record<string, unknown>[])[0]!);
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
      `select public.pv_creer($1, $2, $3, $4, $5, $6, $7) as id`,
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
      // La lecture est celle de la personne (27 octobre 2026). Toutes les non
      // lues et les cent dernières (5 novembre 2026) : une notification non
      // lue ne sort jamais de la liste. Une seule lecture (9 novembre 2026) :
      // la règle par ligne coûtait 4,7 s pour 846 notifications.
      `select id, tenant_id, kind, payload, created_at, read_at
         from app.notifications_des_societes($1::uuid[])
        order by created_at desc, id`,
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
    // Chacun sa lecture : celle du cabinet ne lit pas à la place du dirigeant.
    await db.query(`select public.notification_marquer_lue($1)`, [id]);
  },

  /**
   * « Tout lire » (planche 2, approuvée le 7 novembre 2026) : la même porte
   * que `markRead`, pour une liste, en un appel — cent alertes ne font pas
   * cent allers-retours. Bornée : au-delà, l'écran envoie par tranches.
   */
  async markAllRead(db: Requete, ids: unknown): Promise<void> {
    if (!Array.isArray(ids) || ids.length > 500) throw new Error("notifications.invalides");
    if (!ids.every((id) => typeof id === "string" && UUID.test(id)))
      throw new Error("notifications.invalides");
    if (ids.length === 0) return;
    await db.query(`select public.notification_marquer_lue(i) from unnest($1::uuid[]) i`, [ids]);
  },

  /**
   * Les échéances des dossiers, avec l'obligation qui fonde chacune : sa
   * règle littérale, son texte, son article. Rien ici n'est saisi.
   */
  /**
   * Les échéances des dossiers, l'intitulé d'une obligation du référentiel
   * dans la langue demandée (`ref.labels`, `fiscal_obligation`), celui de
   * l'échéance à défaut — une obligation propre au cabinet garde le sien.
   */
  async echeances(db: Requete, tenantIds: string[], locale = "fr") {
    if (tenantIds.length === 0) return [];
    const { rows } = await db.query(
      `select e.id, e.tenant_id, e.kind, coalesce(l.value, e.label) as label, e.period,
              e.due_date, e.status, e.fait_le, e.echeance_regle, e.texte_source, e.article,
              e.periodicite, e.date_legale, e.date_origine, e.report_motif, e.report_source
         from echeances_v e
         left join ref_labels_v l
                on l.ns = 'fiscal_obligation' and l.key = e.kind and l.locale = $2
        where e.tenant_id = any($1::uuid[]) order by e.due_date, e.label`,
      [tenantIds, locale],
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
      dateLegale: (e["date_legale"] as string | null) ?? (e["due_date"] as string),
      dateOrigine: ((e["date_origine"] as string | null) ?? "loi") as
        "loi" | "jour_ouvrable" | "report_algoria" | "report_cabinet",
      reportMotif: (e["report_motif"] as string | null) ?? null,
      reportSource: (e["report_source"] as string | null) ?? null,
    }));
  },

  /**
   * Dériver le calendrier de chaque dossier depuis le pack. Idempotent : ce
   * qui existe est mis à jour, ce qui est fait reste fait. Quand rien ne
   * peut être dérivé, la raison le dit — et l'écran la montre.
   */
  async deriverEcheances(db: Requete, tenantIds: string[]) {
    const resultats: Array<{ tenantId: string; generees: number; raison: string | null }> = [];
    /*
     * Un dossier qui refuse ne fait pas échouer les autres.
     *
     * Recette du 20 octobre 2026 : après la révocation d'un mandat, chaque
     * page du cabinet rendait un 400 — la liste portait encore le client
     * révoqué, et son refus annulait toute la transaction. Chaque dossier
     * passe donc sous son point de sauvegarde ; un dossier qui n'est plus
     * le sien est écarté — il n'a plus d'échéance à montrer ici —, et les
     * autres dossiers sont dérivés quand même.
     */
    for (const tenantId of tenantIds) {
      await db.query("savepoint deriver_un_dossier");
      try {
        const { rows } = await db.query<{ r: { generees: number; raison: string | null } }>(
          `select public.echeances_deriver($1) as r`,
          [tenantId],
        );
        await db.query("release savepoint deriver_un_dossier");
        const r = rows[0]?.r;
        resultats.push({ tenantId, generees: r?.generees ?? 0, raison: r?.raison ?? null });
      } catch (e) {
        await db.query("rollback to savepoint deriver_un_dossier");
        const code = (e as { code?: string }).code;
        // Seul un REFUS de la base écarte le dossier ; une panne remonte.
        if (code !== "42501" && code !== "23514" && code !== "22023" && code !== "P0002") throw e;
      }
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
   * LE geste « Envoyer » (« Malica sans blocage », lot 4) : un seul circuit,
   * deux fois. Le siège envoie au propriétaire ; qui en a le droit transmet au
   * comptable, et y renvoie la pièce qu'il lui a retournée. La base choisit
   * le passage d'après les droits de l'appelant (`piece_envoyer`).
   */
  async envoyer(
    db: Requete,
    pieceId: string,
  ): Promise<{ chez: "proprietaire" | "cabinet"; le: string; deja: boolean }> {
    const { rows } = await db.query<{ r: { chez: string; le: string; deja?: boolean } }>(
      `select public.piece_envoyer($1) as r`,
      [pieceId],
    );
    const r = rows[0]!.r;
    return {
      chez: r.chez as "proprietaire" | "cabinet",
      le: new Date(r.le).toISOString(),
      deja: Boolean(r.deja),
    };
  },

  /**
   * Envoyer d'un geste les pièces restées chez la société (recette « vie
   * réelle », ANO-LIVE-003 : 32 à 41 gestes pour seize pièces). Chacune passe
   * par la même porte que l'envoi à l'unité — la base en garde les règles
   * (impayé, pièce privée, droit d'envoyer) —, dans UNE transaction : tout
   * part, ou rien, et le refus dit pourquoi.
   */
  async transmettreLesPieces(db: Requete, pieceIds: string[]): Promise<{ transmises: number }> {
    let transmises = 0;
    for (const id of pieceIds) {
      // Le lot n'envoie que ce qui reste à envoyer : un retour se renvoie par
      // sa carte (`piece_envoyer_en_lot`).
      const { rows } = await db.query<{ deja: boolean }>(
        `select coalesce((public.piece_envoyer_en_lot($1) ->> 'deja')::boolean, false) as deja`,
        [id],
      );
      if (!rows[0]!.deja) transmises += 1;
    }
    return { transmises };
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

  /**
   * Trancher : le cabinet, ou le propriétaire pour la demande d'un siège. Un
   * accord de rappel remet la pièce dans la société, ici même ; l'accord du
   * propriétaire sur une pièce déjà chez le cabinet y transmet la demande.
   */
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

  /**
   * La longueur maximale d'un motif de réponse, telle que la base la porte
   * (`app.motif_longueur_max()`) : la contrainte, la porte et l'écran lisent la
   * même valeur, et aucune copie n'en vit dans le code.
   */
  async limiteDuMotif(db: Requete): Promise<number> {
    const { rows } = await db.query<{ n: number }>(`select app.motif_longueur_max() as n`);
    return rows[0]!.n;
  },

  /**
   * L'ÉTAT des demandes d'une pièce : le dernier fait par objet et par étape,
   * tel que la base le lit (`app.etat_des_demandes`) — la garde d'inscription
   * et les portes lisent le même. L'écran n'en refait aucune interprétation.
   */
  async etatDesDemandes(db: Requete, pieceId: string): Promise<EtatDeDemande[]> {
    const { rows } = await db.query<{
      objet: DemandeSurPiece;
      etape: EtapeDeDemande;
      fait: FaitDeDemande["fait"];
      note: string | null;
      created_at: Date;
      transmise: boolean;
    }>(
      `select objet, etape, fait, note, created_at, transmise
         from app.etat_des_demandes_lisible($1)
        order by objet, etape`,
      [pieceId],
    );
    return rows.map((r) => ({
      objet: r.objet,
      etape: r.etape,
      fait: r.fait,
      note: r.note,
      createdAt: r.created_at.toISOString(),
      transmise: r.transmise,
    }));
  },

  /** Les demandes portées sur une pièce, du fait le plus récent au plus ancien. */
  async demandesDUnePiece(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      `select objet, fait, note, created_at, etape from demandes_sur_piece_v
        where piece_id = $1 order by created_at desc, id desc`,
      [pieceId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      objet: r["objet"] as "rappel" | "suppression",
      fait: r["fait"] as "demandee" | "accordee" | "refusee" | "retiree",
      note: (r["note"] as string | null) ?? null,
      createdAt: (r["created_at"] as Date).toISOString(),
      etape: r["etape"] as "proprietaire" | "cabinet",
    }));
  },
};
