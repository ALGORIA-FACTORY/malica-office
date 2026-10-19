/**
 * L'identité — organisations, établissements, création.
 *
 * L'adaptateur d'origine demandait l'utilisateur courant au client
 * d'authentification, puis croisait les appartenances en JavaScript. Ici,
 * `auth.uid()` est déjà posé dans la transaction : la jointure se fait en base,
 * en une requête au lieu de deux, et l'appartenance n'a pas à transiter.
 */

import { configurationCourriel } from "../courriel/brevo.ts";
import { envoyerInvitation, type StatutCourriel } from "../courriel/invitation.ts";
import type { Requete } from "../db.ts";

/** Un mandat proposé, vu depuis la PME qui doit y répondre. */
export interface MandatPropose {
  id: string;
  cabinetTenantId: string;
  cabinet: string;
  proposeLe: string;
}
import { enDate } from "./dates.ts";

/** Une fiche fiscale, telle que l'écran et Malica la lisent. */
export interface FicheFiscale {
  id: string;
  regimeImposition: string | null;
  regimeTva: string | null;
  prorataTva: string | null;
  secteur: string | null;
  debutActivite: string | null;
  clotureExercice: string | null;
  /** physique | morale — la forme décide du délai de dépôt. */
  formeJuridique: string | null;
  /** papier | electronique — la télédéclaration réduit le délai. */
  modeDepot: string | null;
  source: string;
  pieceId: string | null;
  validFrom: string;
  validTo: string | null;
}

/** pg rend une date SQL à minuit locale : `toISOString` afficherait la veille. */

export const identite = {
  /**
   * Les régimes que la juridiction connaît, à la date demandée.
   *
   * L'écran ne propose JAMAIS une liste écrite dans son code : il propose ce
   * que le référentiel porte. Le jour où un régime naît ou disparaît, la liste
   * suit sans qu'on touche au produit — R4.
   */
  async regimesDisponibles(db: Requete, jurisdiction: string, jour?: string | null) {
    const { rows } = await db.query<Record<string, unknown>>(
      `select axe, code, libelle, fondement
         from ref.regimes_fiscaux
        where jurisdiction = $1
          and valid_from <= coalesce($2::date, current_date)
          and (valid_to is null or valid_to > coalesce($2::date, current_date))
        order by axe, libelle`,
      [jurisdiction, jour ?? null],
    );
    return rows.map((r) => ({
      axe: r["axe"] as "imposition" | "tva",
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      fondement: r["fondement"] as string,
    }));
  },

  /**
   * Les formes juridiques et les modes de dépôt que le calendrier des
   * obligations distingue. Ils viennent du référentiel : une forme qu'aucune
   * obligation ne nomme n'aurait pas de sens ici.
   */
  async formesDisponibles(db: Requete, jurisdiction: string) {
    const { rows } = await db.query<{ axe: string; code: string }>(
      `select 'forme' as axe, forme_juridique as code
         from ref.fiscal_obligations
        where jurisdiction = $1 and forme_juridique is not null
       union
       select 'mode', mode_depot
         from ref.fiscal_obligations
        where jurisdiction = $1 and mode_depot is not null
       order by 1, 2`,
      [jurisdiction],
    );
    return rows.map((r) => ({ axe: r.axe as "forme" | "mode", code: r.code }));
  },

  /**
   * La fiche en vigueur pour ce dossier, ou rien.
   *
   * « Rien » est une réponse : un dossier sans fiche n'est pas un dossier au
   * régime réel par défaut. Supposer serait la faute que cette table existe
   * pour empêcher.
   */
  async ficheCourante(db: Requete, tenantId: string): Promise<FicheFiscale | null> {
    const { rows } = await db.query<Record<string, unknown>>(
      `select id, regime_imposition, regime_tva, prorata_tva, secteur,
              debut_activite, cloture_exercice, forme_juridique, mode_depot,
              source, piece_id, valid_from, valid_to
         from identity.fiches_fiscales
        where tenant_id = $1 and valid_to is null
        order by valid_from desc limit 1`,
      [tenantId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r["id"] as string,
      regimeImposition: (r["regime_imposition"] as string | null) ?? null,
      regimeTva: (r["regime_tva"] as string | null) ?? null,
      prorataTva: r["prorata_tva"] === null ? null : String(r["prorata_tva"]),
      secteur: (r["secteur"] as string | null) ?? null,
      debutActivite: enDate(r["debut_activite"]),
      clotureExercice: (r["cloture_exercice"] as string | null) ?? null,
      formeJuridique: (r["forme_juridique"] as string | null) ?? null,
      modeDepot: (r["mode_depot"] as string | null) ?? null,
      source: r["source"] as string,
      pieceId: (r["piece_id"] as string | null) ?? null,
      validFrom: enDate(r["valid_from"]) ?? "",
      validTo: enDate(r["valid_to"]),
    };
  },

  /**
   * Établir une fiche : clôturer celle qui court, en ouvrir une neuve.
   *
   * Les deux gestes dans la MÊME transaction. Séparés, une panne entre les
   * deux laisserait le dossier sans fiche du tout — pire que l'ancienne, qui
   * au moins disait quelque chose de vrai jusqu'à hier.
   *
   * La base refuse de réécrire une fiche (R7) et refuse deux fiches sur la
   * même période. Ce dépôt n'a donc rien à vérifier : il enchaîne, et la base
   * arbitre.
   */
  async etablirFiche(
    db: Requete,
    input: {
      tenantId: string;
      regimeImposition?: string | null;
      regimeTva?: string | null;
      prorataTva?: number | null;
      secteur?: string | null;
      debutActivite?: string | null;
      clotureExercice?: string | null;
      formeJuridique?: string | null;
      modeDepot?: string | null;
      source: "carte" | "saisie";
      pieceId?: string | null;
      validFrom: string;
    },
  ): Promise<{ id: string }> {
    await db.query(
      `update identity.fiches_fiscales
          set valid_to = $2::date
        where tenant_id = $1 and valid_to is null and valid_from < $2::date`,
      [input.tenantId, input.validFrom],
    );

    const { rows } = await db.query<{ id: string }>(
      `insert into identity.fiches_fiscales
         (tenant_id, regime_imposition, regime_tva, prorata_tva, secteur,
          debut_activite, cloture_exercice, forme_juridique, mode_depot,
          source, piece_id, valid_from)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12::date)
       returning id`,
      [
        input.tenantId,
        input.regimeImposition ?? null,
        input.regimeTva ?? null,
        input.prorataTva ?? null,
        input.secteur ?? null,
        input.debutActivite ?? null,
        input.clotureExercice ?? null,
        input.formeJuridique ?? null,
        input.modeDepot ?? null,
        input.source,
        input.pieceId ?? null,
        input.validFrom,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("fiche.creation_refusee");
    return { id };
  },

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
  /**
   * Le cabinet qui mandate cette PME.
   *
   * Aucun filtre de sécurité ici : `engagements_sel` ne rend la ligne qu'aux
   * deux parties, et `organizations_sel` ne rend le cabinet qu'à qui lui est
   * lié. La RLS décide, comme partout.
   */
  async monCabinet(db: Requete, pmeTenantId: string) {
    const { rows } = await db.query(
      `select o.id, o.name
         from engagements_v e
         join organizations_v o on o.id = e.cabinet_org_id
        where e.pme_org_id = $1 and e.status = 'actif'
        order by o.name
        limit 1`,
      [pmeTenantId],
    );
    const trouve = (rows as Record<string, unknown>[])[0];
    return trouve ? { id: trouve["id"] as string, name: trouve["name"] as string } : null;
  },

  /** Les mandats qu'un cabinet propose à cette PME, et qui attendent sa réponse. */
  async mandatsProposes(db: Requete, pmeTenantId: string): Promise<MandatPropose[]> {
    const { rows } = await db.query<{ r: MandatPropose[] | null }>(
      `select public.mandats_proposes_lire($1) as r`,
      [pmeTenantId],
    );
    return rows[0]?.r ?? [];
  },

  /** La PME répond : oui rend le mandat actif à compter d'aujourd'hui, non le termine. */
  async repondreAuMandat(
    db: Requete,
    engagementId: string,
    accepte: boolean,
  ): Promise<{ id: string; status: string }> {
    const { rows } = await db.query<{ r: { id: string; status: string } }>(
      `select public.mandat_repondre($1, $2) as r`,
      [engagementId, accepte],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("mandat.sans_reponse");
    return r;
  },

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

  /**
   * Le cabinet ouvre le dossier d'une PME qui n'existe pas encore : la PME,
   * son établissement principal et un mandat actif, en un geste. Un matricule
   * qui a déjà un dossier est refusé — on lui propose un mandat.
   */
  async ouvrirDossier(
    db: Requete,
    input: { cabinetTenantId: string; name: string; legalId: string; adresse: string | null },
  ): Promise<{ id: string; name: string; legalId: string; adresse: string | null }> {
    const { rows } = await db.query<{
      r: { id: string; name: string; legalId: string; adresse: string | null };
    }>(`select public.cabinet_ouvrir_dossier($1, $2, $3, $4) as r`, [
      input.cabinetTenantId,
      input.name,
      input.legalId,
      input.adresse,
    ]);
    const r = rows[0]?.r;
    if (!r) throw new Error("dossier.non_ouvert");
    return { ...r, adresse: r.adresse ?? null };
  },

  /**
   * Le cabinet invite le contact du dossier. Le jeton n'est rendu qu'ici, une
   * fois : la base n'en garde que l'empreinte.
   *
   * Si Brevo est configuré, le courriel part aussitôt ; sinon, ou s'il échoue,
   * l'invitation vaut quand même et le cabinet transmet le lien lui-même.
   * `courriel` dit lequel des trois s'est produit.
   */
  async inviterContact(
    db: Requete,
    pmeTenantId: string,
    email: string,
  ): Promise<{
    id: string;
    email: string;
    jeton: string;
    expiresAt: string;
    courriel: StatutCourriel;
    lien: string | null;
  }> {
    const { rows } = await db.query<{
      r: { id: string; email: string; jeton: string; expiresAt: string };
    }>(`select public.dossier_inviter_contact($1, $2) as r`, [pmeTenantId, email]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_emise");

    let config: ReturnType<typeof configurationCourriel>;
    try {
      config = configurationCourriel(process.env);
    } catch (e) {
      console.error(`[invitation] configuration du courriel : ${(e as Error).message}`);
      return { ...r, courriel: "echec", lien: null };
    }
    const noms = config ? await identite.lireInvitationParLien(db, r.jeton) : null;
    const envoi = await envoyerInvitation(
      {
        cabinet: noms?.cabinet ?? "Votre cabinet",
        pme: noms?.pme ?? "",
        email: r.email,
        jeton: r.jeton,
        expireLe: new Date(r.expiresAt),
      },
      config,
    );
    return { ...r, ...envoi };
  },

  /** Les invitations d'un dossier et leur état, pour le cabinet mandaté. Jamais le jeton. */
  async invitationsDuDossier(
    db: Requete,
    pmeTenantId: string,
  ): Promise<
    {
      id: string;
      email: string;
      statut: "en_attente" | "acceptee" | "expiree" | "revoquee";
      expiresAt: string;
      createdAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }[]
  > {
    const { rows } = await db.query<{ r: unknown }>(
      `select public.dossier_invitations_lire($1) as r`,
      [pmeTenantId],
    );
    return (rows[0]?.r ?? []) as Awaited<ReturnType<typeof identite.invitationsDuDossier>>;
  },

  /** Le cabinet révoque une invitation encore en attente. */
  async revoquerInvitation(
    db: Requete,
    invitationId: string,
  ): Promise<{ id: string; statut: "revoquee" }> {
    const { rows } = await db.query<{ r: { id: string; statut: "revoquee" } }>(
      `select public.dossier_revoquer_invitation($1) as r`,
      [invitationId],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_revoquee");
    return r;
  },

  /** Ce que le lien fait rejoindre ; null pour un jeton inconnu. */
  async lireInvitationParLien(
    db: Requete,
    jeton: string,
  ): Promise<{
    pme: string;
    cabinet: string | null;
    email: string;
    statut: "en_attente" | "acceptee" | "expiree" | "revoquee";
    valable: boolean;
  } | null> {
    const { rows } = await db.query<{
      r: {
        pme: string;
        cabinet: string | null;
        email: string;
        statut: "en_attente" | "acceptee" | "expiree" | "revoquee";
        valable: boolean;
      } | null;
    }>(`select public.invitation_par_lien_lire($1) as r`, [jeton]);
    return rows[0]?.r ?? null;
  },

  /** Le contact rejoint le dossier ; son compte doit porter l'adresse invitée. */
  async accepterInvitationParLien(
    db: Requete,
    jeton: string,
  ): Promise<{ tenantId: string; role: string }> {
    const { rows } = await db.query<{ r: { tenantId: string; role: string } }>(
      `select public.invitation_par_lien_accepter($1) as r`,
      [jeton],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_acceptee");
    return r;
  },

  /**
   * Proposer un mandat à une PME inscrite, par son identifiant fiscal.
   *
   * Le cabinet ne voit pas les PME qu'il ne mandate pas : la recherche passe
   * par une fonction sous définisseur, qui ne rend que le nom de celle qu'il
   * vient de solliciter. Le mandat naît « proposé » ; la PME l'active.
   */
  async proposerMandat(db: Requete, cabinetTenantId: string, legalId: string) {
    const { rows } = await db.query<{
      r: { id: string; pmeTenantId: string; pmeName: string; status: string; deja: boolean };
    }>(`select public.mandat_proposer($1, $2) as r`, [cabinetTenantId, legalId]);
    const r = rows[0]?.r;
    if (!r) throw new Error("mandat.non_propose");
    return { ...r, deja: Boolean(r.deja) };
  },

  /**
   * Le cabinet se décrit. La devise n'est pas passée : la base la lit dans le
   * pack de la juridiction, et refuse une juridiction sans pack (R4).
   */
  async definirOrganisation(
    db: Requete,
    input: { tenantId: string; name: string; legalId: string | null; jurisdiction: string },
  ) {
    const { rows } = await db.query<{
      r: {
        id: string;
        name: string;
        legalId: string | null;
        jurisdiction: string;
        currency: string;
      };
    }>(`select public.organisation_definir($1, $2, $3, $4) as r`, [
      input.tenantId,
      input.name,
      input.legalId,
      input.jurisdiction,
    ]);
    const r = rows[0]?.r;
    if (!r) throw new Error("organisation.non_definie");
    return { ...r, legalId: r.legalId ?? null };
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

  /**
   * Le prénom et le nom de l'appelant. Le prénom salue, le nom complet
   * facture : la base compose `display_name` (« Prénom Nom ») dès que l'un
   * des deux est posé (`20261021090000`). `null` tant que rien n'est écrit.
   */
  async monProfil(db: Requete) {
    const { rows } = await db.query<{
      prenom: string | null;
      nom: string | null;
      display_name: string | null;
    }>(`select prenom, nom, display_name from identity.profiles where user_id = auth.uid()`);
    return rows[0] ?? null;
  },

  /** Écrire son prénom et son nom. Un champ vide s'efface. */
  async ecrireMonProfil(db: Requete, prenom: string | null, nom: string | null) {
    const { rows } = await db.query<{
      prenom: string | null;
      nom: string | null;
      display_name: string | null;
    }>(
      `insert into identity.profiles (user_id, prenom, nom)
       values (auth.uid(), nullif(btrim($1), ''), nullif(btrim($2), ''))
       on conflict (user_id) do update set prenom = excluded.prenom, nom = excluded.nom
       returning prenom, nom, display_name`,
      [prenom, nom],
    );
    return rows[0] ?? null;
  },
};
