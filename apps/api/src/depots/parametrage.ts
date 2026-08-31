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

export const parametrage = {
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
                                    where jurisdiction = $3 and effective_from <= current_date
                                    order by effective_from desc limit 1)
         left join parametrage_role_bindings_v c
           on c.role_code = r.code and c.portee = 'cabinet' and c.portee_id = $1
         left join parametrage_role_bindings_v d
           on d.role_code = r.code and d.portee = 'dossier' and d.portee_id = $2
         left join plan_comptable_v a
           on a.account_code = coalesce(d.account_code, c.account_code, p.account_code)
          and (a.tenant_id is null or a.tenant_id = $1)
        order by r.famille, r.code`,
      [tenantId, dossierId, "TN"],
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
              origine, is_official, source_ref
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
