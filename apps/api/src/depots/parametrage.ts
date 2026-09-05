/**
 * Le paramétrage du cabinet — volet 1.
 *
 * Ce dépôt sert un seul écran, et il porte une idée : l'expert ne choisit pas
 * un compte pour une écriture, il choisit un compte pour un RÔLE. « Le timbre
 * collecté », « la TVA déductible », « les achats de marchandises » — cent
 * soixante rôles, que les 182 schémas d'écriture citent sans jamais nommer un
 * numéro. Renuméroter le plan ne réécrit donc aucun schéma.
 *
 * Ce que ce dépôt NE fait PAS : décider. Les quatre règles du plan et le
 * contrôle de classe des rôles sont des déclencheurs en base. Un écran se
 * contourne ; un déclencheur, non. Ici on lit, on écrit, et on laisse la base
 * refuser.
 */

import type { Requete } from "../db.ts";

/** Les réglages d'un cabinet, tels que la base les rend (défauts compris). */
interface ReglagesCabinetBruts {
  seuilConfianceLot: number | string;
  seuilConfianceRevue: number | string;
  doubleValidationAuDela: number | string | null;
  propositionsProactives: boolean;
  capaciteDossiers: number | string;
  ton: string;
  seuilCertitudeConseil: number | string;
  regle: boolean;
}

/** Une obligation du calendrier, telle que la base la rend. */
interface ObligationBrute {
  code: string;
  libelle: string;
  periodicite: string;
  echeanceJour: number | string;
  echeanceMois: number | string | null;
  regle: string;
  texteSource: string | null;
  article: string | null;
  propre: boolean;
  secteur: string;
  formeJuridique: string | null;
  modeDepot: string | null;
  regime: string | null;
  mandats: number | string;
  active: boolean;
  rappelJours: number | string;
  regle_par_le_cabinet: boolean;
}

function versReglages(brut: ReglagesCabinetBruts) {
  return {
    seuilConfianceLot: Number(brut.seuilConfianceLot),
    seuilConfianceRevue: Number(brut.seuilConfianceRevue),
    doubleValidationAuDela:
      brut.doubleValidationAuDela == null ? null : String(brut.doubleValidationAuDela),
    propositionsProactives: Boolean(brut.propositionsProactives),
    capaciteDossiers: Number(brut.capaciteDossiers),
    ton: String(brut.ton),
    seuilCertitudeConseil: Number(brut.seuilCertitudeConseil),
    regle: Boolean(brut.regle),
  };
}

export const parametrage = {
  /**
   * Les seuils et préférences du cabinet. Absents, la base rend les défauts
   * de son schéma — jamais un écran ne les porte.
   */
  async reglagesCabinet(db: Requete, tenantId: string) {
    const { rows } = await db.query<{ r: ReglagesCabinetBruts }>(
      `select public.cabinet_reglages_lire($1) as r`,
      [tenantId],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("reglages.illisibles");
    return versReglages(r);
  },

  /** Quand la mise en route a été terminée — ou rien. Elle se rejoue à volonté. */
  async miseEnRoute(db: Requete, tenantId: string): Promise<{ termineeLe: string | null }> {
    const { rows } = await db.query<{ quand: Date | string | null }>(
      `select public.cabinet_mise_en_route_lire($1) as quand`,
      [tenantId],
    );
    const quand = rows[0]?.quand ?? null;
    return { termineeLe: quand === null ? null : new Date(quand).toISOString() };
  },

  async terminerMiseEnRoute(db: Requete, tenantId: string): Promise<{ termineeLe: string }> {
    const { rows } = await db.query<{ quand: Date | string }>(
      `select public.cabinet_mise_en_route_terminer($1) as quand`,
      [tenantId],
    );
    const quand = rows[0]?.quand;
    if (!quand) throw new Error("mise_en_route.non_terminee");
    return { termineeLe: new Date(quand).toISOString() };
  },

  async definirReglagesCabinet(
    db: Requete,
    input: {
      tenantId: string;
      seuilConfianceLot: number;
      seuilConfianceRevue: number;
      doubleValidationAuDela: string | null;
      propositionsProactives: boolean;
      capaciteDossiers: number;
      ton: string;
      seuilCertitudeConseil: number;
    },
  ) {
    const { rows } = await db.query<{ r: ReglagesCabinetBruts }>(
      `select public.cabinet_reglages_definir($1, $2, $3, $4, $5, $6, $7, $8) as r`,
      [
        input.tenantId,
        input.seuilConfianceLot,
        input.seuilConfianceRevue,
        input.doubleValidationAuDela,
        input.propositionsProactives,
        input.capaciteDossiers,
        input.ton,
        input.seuilCertitudeConseil,
      ],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("reglages.non_enregistres");
    return versReglages(r);
  },

  /**
   * Le calendrier du cabinet pour un exercice et un secteur : les
   * obligations du pack et les siennes, ce qu'il en a réglé, et le nombre
   * RÉEL de mandats concernés, compté depuis les fiches.
   */
  async calendrierCabinet(db: Requete, tenantId: string, exercice: number, secteur: string) {
    const { rows } = await db.query<{ r: ObligationBrute[] }>(
      `select public.cabinet_calendrier_lire($1, $2, $3) as r`,
      [tenantId, exercice, secteur],
    );
    return (rows[0]?.r ?? []).map((o) => ({
      code: o.code,
      libelle: o.libelle,
      periodicite: o.periodicite,
      echeanceJour: Number(o.echeanceJour),
      echeanceMois: o.echeanceMois == null ? null : Number(o.echeanceMois),
      regle: o.regle,
      texteSource: o.texteSource ?? null,
      article: o.article ?? null,
      propre: Boolean(o.propre),
      secteur: o.secteur,
      formeJuridique: o.formeJuridique ?? null,
      modeDepot: o.modeDepot ?? null,
      regime: o.regime ?? null,
      mandats: Number(o.mandats),
      active: Boolean(o.active),
      rappelJours: Number(o.rappelJours),
      regleParLeCabinet: Boolean(o.regle_par_le_cabinet),
    }));
  },

  /** Le cabinet suit ou écarte une obligation, et choisit son rappel. */
  async definirObligation(
    db: Requete,
    input: {
      tenantId: string;
      code: string;
      exercice: number;
      secteur: string;
      active: boolean;
      rappelJours: number;
    },
  ): Promise<{ active: boolean; rappelJours: number }> {
    const { rows } = await db.query<{ r: { active: boolean; rappelJours: number } }>(
      `select public.cabinet_obligation_definir($1, $2, $3, $4, $5, $6) as r`,
      [input.tenantId, input.code, input.exercice, input.secteur, input.active, input.rappelJours],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("obligation.non_reglee");
    return { active: Boolean(r.active), rappelJours: Number(r.rappelJours) };
  },

  /** Une obligation qui n'existe que pour les mandats de ce cabinet. */
  async creerObligationPropre(
    db: Requete,
    input: {
      tenantId: string;
      libelle: string;
      periodicite: string;
      echeanceJour: number;
      echeanceMois: number | null;
      regle: string;
      secteur: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.cabinet_obligation_propre_creer($1, $2, $3, $4, $5, $6, $7) as r`,
      [
        input.tenantId,
        input.libelle,
        input.periodicite,
        input.echeanceJour,
        input.echeanceMois,
        input.regle,
        input.secteur,
      ],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("obligation.non_creee");
    return { id };
  },

  /** Les secteurs d'activité que les fiches des mandats déclarent. */
  async secteursDuCabinet(db: Requete, tenantId: string): Promise<string[]> {
    const { rows } = await db.query<{ secteur: string }>(
      `select distinct f.secteur
         from identity.engagements e
         join identity.fiches_fiscales f on f.tenant_id = e.pme_org_id and f.valid_to is null
        where e.cabinet_org_id = $1 and e.status = 'actif' and f.secteur is not null
        order by 1`,
      [tenantId],
    );
    return rows.map((r) => r.secteur);
  },

  /**
   * Les rôles, groupés par famille, avec le compte résolu et SON ORIGINE.
   *
   * L'origine est la colonne qui compte. Voir « 4371 » ne dit rien ; voir
   * « 4371 — livré par le pack » ou « 4371 — arrêté par votre cabinet » dit
   * qui répond de ce choix. C'est la deuxième conséquence de R10, et elle se
   * calcule ici plutôt que dans l'écran : la question « qui a décidé » ne doit
   * pas dépendre de la page qui l'affiche.
   */
  async roles(db: Requete, tenantId: string, dossierId: string | null) {
    const { rows } = await db.query(
      `select r.code, r.libelle, r.famille, r.classes_admises, r.note,
              coalesce(d.account_code, c.account_code, p.account_code) as compte,
              case
                when d.account_code is not null then 'dossier'
                when c.account_code is not null then 'cabinet'
                when p.account_code is not null then 'pack'
                else 'aucun'
              end as origine,
              coalesce(d.motif, c.motif) as motif,
              coalesce(d.decide_le, c.decide_le) as decide_le,
              p.account_code as defaut_du_pack,
              p.justification as justification_du_pack,
              a.label as compte_libelle
         from ref.account_roles r
         left join ref.role_bindings p
           on p.role_code = r.code
          and p.pack_version_id = (select id from ref_packs_v
                                    where jurisdiction = (select jurisdiction from organizations_v where id = $1)
                                      and effective_from <= current_date
                                    order by effective_from desc limit 1)
         left join parametrage_role_bindings_v c
           on c.role_code = r.code and c.portee = 'cabinet' and c.portee_id = $1
         left join parametrage_role_bindings_v d
           on d.role_code = r.code and d.portee = 'dossier' and d.portee_id = $2
         left join plan_comptable_v a
           on a.account_code = coalesce(d.account_code, c.account_code, p.account_code)
          and (a.tenant_id is null or a.tenant_id = $1)
        order by r.famille, r.code`,
      // La juridiction est celle du cabinet, lue en base : aucune n'est écrite ici (R4, R5).
      [tenantId, dossierId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      famille: r["famille"] as string,
      classesAdmises: (r["classes_admises"] as number[]) ?? [],
      note: (r["note"] as string | null) ?? null,
      compte: (r["compte"] as string | null) ?? null,
      compteLibelle: (r["compte_libelle"] as string | null) ?? null,
      origine: r["origine"] as string,
      motif: (r["motif"] as string | null) ?? null,
      decideLe: (r["decide_le"] as string | null) ?? null,
      defautDuPack: (r["defaut_du_pack"] as string | null) ?? null,
      justificationDuPack: (r["justification_du_pack"] as string | null) ?? null,
    }));
  },

  /**
   * Le plan tel que ce cabinet le voit : le livré et le sien.
   *
   * Filtré par classe quand l'écran propose un compte pour un rôle — inutile
   * d'offrir six cents lignes quand le rôle n'en admet qu'une classe.
   */
  async plan(db: Requete, tenantId: string, classes: number[] | null) {
    const { rows } = await db.query(
      `select account_code, label, parent_code, account_class, normal_side,
              origine, is_official, source_ref, is_collective
         from plan_comptable_v
        where (tenant_id is null or tenant_id = $1)
          and ($2::int[] is null or account_class::int = any($2))
        order by account_code`,
      [tenantId, classes],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["account_code"] as string,
      libelle: r["label"] as string,
      parent: (r["parent_code"] as string | null) ?? null,
      classe: r["account_class"] as string,
      sensUsuel: (r["normal_side"] as string | null) ?? null,
      origine: r["origine"] as string,
      officiel: Boolean(r["is_official"]),
      // Un collectif reçoit des tiers, pas des subdivisions : l'écran doit
      // pouvoir le dire AVANT que l'expert ne tente.
      collectif: Boolean(r["is_collective"]),
      source: (r["source_ref"] as string | null) ?? null,
    }));
  },

  /** Ouvre un compte propre au cabinet. La base vérifie les quatre règles. */
  async ouvrirCompte(
    db: Requete,
    input: {
      tenantId: string;
      code: string;
      libelle: string;
      parent: string;
      sensUsuel?: string | null;
      motif?: string | null;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into parametrage.accounts
         (tenant_id, account_code, label, parent_code, account_class, normal_side, motif)
       values ($1, $2, $3, $4, '', $5, $6)
       returning id`,
      [
        input.tenantId,
        input.code.trim(),
        input.libelle.trim(),
        input.parent.trim(),
        // La classe est laissée vide : le déclencheur la déduit du parent.
        // La demander à l'appelant, c'est lui offrir de se contredire.
        input.sensUsuel ?? null,
        input.motif ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /** Referme un compte ouvert par le cabinet. Les comptes livrés ne s'effacent pas. */
  async fermerCompte(db: Requete, tenantId: string, code: string): Promise<void> {
    await db.query(`delete from parametrage.accounts where tenant_id = $1 and account_code = $2`, [
      tenantId,
      code,
    ]);
  },

  /**
   * Arrête le compte d'un rôle, pour le cabinet ou pour un dossier.
   *
   * Une décision remplace la précédente : c'est un paramétrage, pas un journal.
   * L'écriture qu'elle produira, elle, restera immuable — R7 porte sur les
   * écritures, pas sur les réglages qui les précèdent.
   */
  async definirLiaison(
    db: Requete,
    input: {
      tenantId: string;
      portee: string;
      porteeId: string;
      roleCode: string;
      compte: string;
      motif?: string | null;
    },
  ): Promise<void> {
    await db.query(
      `insert into parametrage.role_bindings
         (tenant_id, portee, portee_id, role_code, account_code, motif)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (portee, portee_id, role_code) do update
         set account_code = excluded.account_code,
             motif        = excluded.motif,
             decide_par   = auth.uid(),
             decide_le    = now()`,
      [
        input.tenantId,
        input.portee,
        input.porteeId,
        input.roleCode,
        input.compte,
        input.motif ?? null,
      ],
    );
  },

  /** Rend un rôle au défaut du pack : la surcharge disparaît, le livré reprend. */
  async rendreAuPack(
    db: Requete,
    input: { tenantId: string; portee: string; porteeId: string; roleCode: string },
  ): Promise<void> {
    await db.query(
      `delete from parametrage.role_bindings
        where tenant_id = $1 and portee = $2 and portee_id = $3 and role_code = $4`,
      [input.tenantId, input.portee, input.porteeId, input.roleCode],
    );
  },
};
