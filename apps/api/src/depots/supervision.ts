/**
 * La supervision — cabinets, clients mandatés, file de travail, revue.
 *
 * Le mur de visibilité (R6) reste tenu par la RLS : le cabinet ne reçoit
 * jamais une ligne de l'espace personnel d'une PME, même sans filtre ici.
 *
 * L'adaptateur d'origine enchaînait jusqu'à quatre requêtes puis recollait les
 * morceaux en JavaScript, faute de pouvoir joindre côté client. On joint en
 * base : moins d'allers-retours, et un résultat cohérent parce qu'il vient
 * d'une seule transaction.
 */

import type { Requete } from "../db.ts";

/** Chaque statut compte, même à zéro : un client sans pièce doit s'afficher. */
const COMPTES_VIDES = {
  capturee: 0,
  lue: 0,
  proposee: 0,
  comptabilisee: 0,
  supervisee: 0,
  retournee: 0,
} as const;

/** L'ordre de la file : ce qui attend le cabinet d'abord. */
const PRIORITE: Record<string, number> = {
  comptabilisee: 0,
  retournee: 1,
  proposee: 2,
  lue: 3,
  capturee: 4,
  supervisee: 5,
};

export const supervision = {
  async listMyCabinets(db: Requete) {
    // `auth.uid()` est déjà posé : l'appartenance se joint en base, là où
    // l'adaptateur faisait deux requêtes et croisait les identifiants.
    const { rows } = await db.query(
      `select o.id, o.kind, o.name, o.legal_id, o.jurisdiction, o.currency, o.validation_mode
         from organizations_v o
         join memberships_v m on m.tenant_id = o.id and m.user_id = auth.uid()
        where o.kind = 'cabinet'
        order by o.name`,
    );
    return (rows as Record<string, unknown>[]).map((o) => ({
      id: o["id"] as string,
      kind: o["kind"] as string,
      name: o["name"] as string,
      legalId: (o["legal_id"] as string | null) ?? null,
      jurisdiction: o["jurisdiction"] as string,
      currency: o["currency"] as string,
      validationMode: o["validation_mode"] as string,
    }));
  },

  async listClients(db: Requete, cabinetTenantId: string) {
    // Trois requêtes et un croisement manuel deviennent une jointure avec
    // agrégat : les compteurs sont calculés là où sont les lignes.
    const { rows } = await db.query(
      `select e.pme_org_id, e.status, e.starts_on,
              o.name, o.legal_id, o.jurisdiction, o.currency, o.validation_mode,
              coalesce(
                jsonb_object_agg(p.status, p.n) filter (where p.status is not null),
                '{}'::jsonb) as comptes
         from engagements_v e
         left join organizations_v o on o.id = e.pme_org_id
         left join lateral (
           select status, count(*) as n
             from pieces_v where tenant_id = e.pme_org_id group by status
         ) p on true
        where e.cabinet_org_id = $1
          -- Chacun voit ses mandats : tous pour l'expert, les siens pour le collaborateur.
          and e.pme_org_id in (select app.mandats_visibles($1))
        group by e.pme_org_id, e.status, e.starts_on, o.name, o.legal_id, o.jurisdiction,
                 o.currency, o.validation_mode`,
      [cabinetTenantId],
    );

    return (rows as Record<string, unknown>[])
      .map((r) => {
        const bruts = (r["comptes"] ?? {}) as Record<string, unknown>;
        const comptes = { ...COMPTES_VIDES } as Record<string, number>;
        for (const [statut, n] of Object.entries(bruts)) comptes[statut] = Number(n);
        return {
          tenantId: r["pme_org_id"] as string,
          name: (r["name"] as string) ?? "—",
          legalId: (r["legal_id"] as string | null) ?? null,
          jurisdiction: (r["jurisdiction"] as string) ?? "TN",
          currency: (r["currency"] as string) ?? "TND",
          validationMode: (r["validation_mode"] as string) ?? "mandate",
          engagementStatus: r["status"] as string,
          mandatDepuis: (r["starts_on"] as string | null) ?? null,
          counts: comptes,
        };
      })
      .sort((a, b) => (b.counts["comptabilisee"] ?? 0) - (a.counts["comptabilisee"] ?? 0));
  },

  async queue(db: Requete, cabinetTenantId: string, tenantId?: string) {
    // `distinct on` rend la dernière écriture comptabilisée non revue de chaque
    // pièce — ce que l'adaptateur reconstituait par une boucle et une carte.
    const { rows } = await db.query(
      `select p.id as piece_id, p.tenant_id, p.status, p.source, p.created_at,
              o.name as client, e.id as ecriture_id, e.libelle, e.date_ecriture,
              m.montant, c.email as collaborateur, cf.confiance
         from pieces_v p
         join engagements_v g on g.pme_org_id = p.tenant_id and g.cabinet_org_id = $1
          and p.tenant_id in (select app.mandats_visibles($1))
         left join organizations_v o on o.id = p.tenant_id
         left join lateral (
           select distinct on (x.piece_id) x.id, x.libelle, x.date_ecriture
             from ecritures_v x
            where x.piece_id = p.id and x.status = 'booked'
              and x.reverses_id is null and x.review_outcome is null
            order by x.piece_id, x.created_at desc
         ) e on true
         -- Le montant de l'écriture : la somme de ses débits, telle que le
         -- Socle l'a posée. L'écran ne l'additionne pas.
         left join lateral (
           select sum(l.debit)::text as montant
             from ecriture_lignes_v l where l.ecriture_id = e.id
         ) m on true
         -- La confiance de la dernière lecture, telle que le désignateur l'a
         -- rendue. Absente pour une pièce lue avant qu'on la persiste.
         left join lateral (
           select (x2.payload -> 'field_confidence' ->> 'overall')::numeric as confiance
             from extractions_v x2 where x2.piece_id = p.id
            order by x2.created_at desc limit 1
         ) cf on true
         -- Le collaborateur : l'affectation active du client dans ce cabinet.
         left join lateral (
           select mb.email
             from collab_assignments_v a
             join cabinet_members_v mb on mb.user_id = a.collaborator_id and mb.tenant_id = $1
            where a.cabinet_tenant_id = $1 and a.client_tenant_id = p.tenant_id and a.active
            order by a.created_at desc limit 1
         ) c on true
        -- La file du cabinet, c'est ce qui lui a été TRANSMIS : une pièce « chez
        -- vous » n'y paraît pas, même pour un compte membre des deux côtés.
        where p.vis = 'partage'
          and ($2::uuid is null or p.tenant_id = $2)
        order by p.created_at desc
        limit 200`,
      [cabinetTenantId, tenantId ?? null],
    );

    return (rows as Record<string, unknown>[])
      .map((p) => ({
        pieceId: p["piece_id"] as string,
        tenantId: p["tenant_id"] as string,
        clientName: (p["client"] as string) ?? "—",
        status: p["status"] as string,
        source: p["source"] as string,
        createdAt: p["created_at"] as string,
        ecritureId: (p["ecriture_id"] as string | null) ?? null,
        libelle: (p["libelle"] as string | null) ?? null,
        dateEcriture: (p["date_ecriture"] as string | null) ?? null,
        montant: (p["montant"] as string | null) ?? null,
        collaborateur: (p["collaborateur"] as string | null) ?? null,
        confiance: p["confiance"] == null ? null : Number(p["confiance"]),
      }))
      .sort((a, b) => {
        const d = (PRIORITE[a.status] ?? 9) - (PRIORITE[b.status] ?? 9);
        if (d !== 0) return d;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
  },

  /**
   * Les statistiques du cabinet, sur ses mandats engagés. Tout est agrégé
   * ici, en SQL — l'écran de pilotage ne calcule rien.
   */
  async statistiques(db: Requete, cabinetTenantId: string, locale: string) {
    const [parMois, motifs, socle] = await Promise.all([
      db.query(
        `select to_char(date_trunc('month', e.reviewed_at), 'YYYY-MM') as mois,
                coalesce(m.email, '') as collaborateur,
                count(*)::int as supervisees
           from ecritures_v e
           join engagements_v g on g.pme_org_id = e.tenant_id and g.cabinet_org_id = $1
           left join cabinet_members_v m on m.user_id = e.reviewed_by and m.tenant_id = $1
          where e.review_outcome = 'valide'
            and e.reviewed_at >= date_trunc('month', now()) - interval '11 months'
          group by 1, 2
          order by 1, 2`,
        [cabinetTenantId],
      ),
      db.query(
        `select coalesce(demandee.value, francais.value, mo.code) as label,
                count(*)::int as retours
           from ecritures_v e
           join engagements_v g on g.pme_org_id = e.tenant_id and g.cabinet_org_id = $1
           join ref_rejet_motifs_v mo on mo.id = e.review_motif_id
           left join ref_labels_v demandee
             on demandee.ns = 'rejet_motif' and demandee.key = mo.code and demandee.locale = $2
           left join ref_labels_v francais
             on francais.ns = 'rejet_motif' and francais.key = mo.code and francais.locale = 'fr'
          where e.review_outcome = 'retourne'
          group by 1
          order by 2 desc, 1
          limit 5`,
        [cabinetTenantId, locale],
      ),
      db.query(
        `with mandats as (
           select g.pme_org_id as tenant_id from engagements_v g where g.cabinet_org_id = $1
         ),
         lues as (
           select count(distinct x.piece_id)::int as n
             from extractions_v x join mandats t on t.tenant_id = x.tenant_id
            where x.created_at >= now() - interval '30 days'
         ),
         proposees as (
           select count(*)::int as n
             from ecritures_v e join mandats t on t.tenant_id = e.tenant_id
            where e.created_at >= now() - interval '30 days'
         ),
         comptabilisees as (
           select count(*)::int as n
             from ecritures_v e join mandats t on t.tenant_id = e.tenant_id
            where e.booked_at >= now() - interval '30 days'
         ),
         delai as (
           select percentile_cont(0.5) within group
                    (order by extract(epoch from (e.booked_at - x.created_at)) / 3600.0) as heures
             from ecritures_v e
             join mandats t on t.tenant_id = e.tenant_id
             join lateral (
               select created_at from extractions_v x
                where x.piece_id = e.piece_id order by created_at asc limit 1
             ) x on true
            where e.booked_at is not null
              and e.booked_at >= now() - interval '30 days'
         )
         select lues.n as lues, proposees.n as proposees, comptabilisees.n as comptabilisees,
                delai.heures as delai_median_heures
           from lues, proposees, comptabilisees, delai`,
        [cabinetTenantId],
      ),
    ]);
    const s = (socle.rows as Record<string, unknown>[])[0] ?? {};
    return {
      parMois: (parMois.rows as Record<string, unknown>[]).map((r) => ({
        mois: r["mois"] as string,
        collaborateur: (r["collaborateur"] as string) || null,
        supervisees: Number(r["supervisees"] ?? 0),
      })),
      motifsDeRetour: (motifs.rows as Record<string, unknown>[]).map((r) => ({
        label: r["label"] as string,
        retours: Number(r["retours"] ?? 0),
      })),
      socle: {
        lues: Number(s["lues"] ?? 0),
        proposees: Number(s["proposees"] ?? 0),
        comptabilisees: Number(s["comptabilisees"] ?? 0),
        delaiMedianHeures:
          s["delai_median_heures"] == null ? null : Number(s["delai_median_heures"]),
      },
    };
  },

  async motifs(db: Requete, locale: string) {
    // Le libellé vient du référentiel, jamais du code (R4). Le repli sur le
    // français est explicite : un motif sans traduction s'affiche, il ne
    // disparaît pas.
    const { rows } = await db.query(
      `select m.id, m.code, m.severity, m.requires_note,
              coalesce(demandee.value, francais.value, m.code) as label
         from ref_rejet_motifs_v m
         left join ref_labels_v demandee
           on demandee.ns = 'rejet_motif' and demandee.key = m.code and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'rejet_motif' and francais.key = m.code and francais.locale = 'fr'
        where m.active is not false
        order by m.sort_order`,
      [locale],
    );
    return (rows as Record<string, unknown>[]).map((m) => ({
      id: m["id"] as string,
      code: m["code"] as string,
      label: m["label"] as string,
      severity: m["severity"] as string,
      requiresNote: Boolean(m["requires_note"]),
    }));
  },

  async review(
    db: Requete,
    input: { ecritureId: string; outcome: string; motifId?: string; note?: string },
  ): Promise<string | null> {
    const { rows } = await db.query<{ id: string | null }>(
      `select public.socle_ecriture_review($1, $2, $3, $4) as id`,
      [input.ecritureId, input.outcome, input.motifId ?? null, input.note ?? null],
    );
    return rows[0]?.id ?? null;
  },

  /**
   * Les derniers événements d'un dossier, tels que le journal d'audit les a
   * posés. Sous RLS : le cabinet ne voit que ses mandats. L'écran traduit
   * l'action ; l'API ne porte aucun libellé.
   */
  async journalDuMandat(db: Requete, tenantId: string, limite = 20) {
    const { rows } = await db.query(
      `select id, action, at, object_table, object_id
         from event_log_v
        where tenant_id = $1
        order by at desc
        limit $2`,
      [tenantId, limite],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      action: r["action"] as string,
      at: r["at"] as string,
      objet: (r["object_table"] as string | null) ?? null,
      objetId: (r["object_id"] as string | null) ?? null,
    }));
  },

  async auditForPiece(db: Requete, pieceId: string) {
    // Le filtre est passé à la base. L'adaptateur lisait 200 lignes puis les
    // filtrait en JavaScript : il pouvait manquer des événements plus anciens
    // que la limite, et transportait ceux des autres pièces pour rien.
    //
    // Deux paramètres pour une seule valeur : `object_id` est un uuid, la clé
    // du `payload` est du texte. Un paramètre unique ne peut pas être les deux
    // — PostgreSQL refuse l'opérateur `text = uuid`.
    const { rows } = await db.query(
      `select id, action, actor, at, motif_id, payload
         from event_log_v
        where object_id = $1 or payload ->> 'piece_id' = $2
        order by at desc limit 200`,
      [pieceId, pieceId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      action: r["action"] as string,
      actor: (r["actor"] as string | null) ?? null,
      at: r["at"] as string,
      motifId: (r["motif_id"] as string | null) ?? null,
      payload: r["payload"],
    }));
  },
};
