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
import type { GesteDeRetour } from "@malica/socle/ports/repositories";
import { CLE_CONFIANCE_GLOBALE } from "@malica/socle/contracts/extract.v1";
import { A_TRAITER, type StatutCabinet } from "@malica/socle/statut-d-envoi";
import {
  documents,
  documentsLies,
  controlesPiece,
  moisDuDossier,
  tiersDeLaPiece,
} from "../bibliotheque.ts";

import { COLONNES_DU_SUIVI, statutAuCabinet, versSuivi } from "./suivi.ts";

/** Chaque statut compte, même à zéro : un client sans pièce doit s'afficher. */
const COMPTES_VIDES = {
  capturee: 0,
  lue: 0,
  proposee: 0,
  comptabilisee: 0,
  supervisee: 0,
  retournee: 0,
} as const;

/** Chaque statut du cabinet compte, même à zéro. */
const STATUTS_VIDES: Readonly<Record<StatutCabinet, number>> = {
  recue: 0,
  vue: 0,
  corrigee: 0,
  retournee: 0,
  validee: 0,
  forcee: 0,
};

/**
 * Les pièces que le cabinet supervise : celles de ses mandats visibles (tous
 * pour l'expert, les siens pour le collaborateur). La file et les compteurs
 * partent de ce MÊME ensemble — sinon un compteur dit « 3 à traiter » quand la
 * file en montre deux.
 */
const PIECES_DU_CABINET = `pieces_v p
         join engagements_v g on g.pme_org_id = p.tenant_id and g.cabinet_org_id = $1
          and p.tenant_id in (select app.mandats_visibles($1))`;

/**
 * Ce qui a été TRANSMIS au cabinet : une pièce « chez vous » n'y paraît pas,
 * même pour un compte membre des deux côtés ; un reçu ou un justificatif
 * voyage avec sa pièce (« Documents liés ») ; la photo qui en remplace une
 * autre a pris sa place ; une pièce que le client a retirée n'attend plus rien.
 */
const TRANSMISE = `p.vis = 'partage'
          and not app.piece_accompagne(p.id)
          and p.remplacee_par is null and p.archivee_le is null`;

/**
 * L'ordre de la file : ce qui attend le cabinet d'abord — la pièce corrigée
 * par le client, la reçue, la vue —, puis ce qui est chez le client, puis ce
 * qui est pris en charge.
 */
const PRIORITE: Readonly<Record<StatutCabinet, number>> = {
  corrigee: 0,
  recue: 1,
  vue: 2,
  retournee: 3,
  validee: 4,
  forcee: 4,
};

export const supervision = {
  documents,
  moisDuDossier,
  documentsLies,
  controlesPiece,
  async listMyCabinets(db: Requete) {
    // `auth.uid()` est déjà posé : l'appartenance se joint en base, là où
    // l'adaptateur faisait deux requêtes et croisait les identifiants.
    const { rows } = await db.query(
      `select o.id, o.kind, o.name, o.legal_id, o.jurisdiction, o.currency, o.validation_mode
         from organizations_v o
         join mes_adhesions_v m on m.tenant_id = o.id
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
    const [mandats, pieces] = await Promise.all([
      db.query(
        `select e.pme_org_id, e.status, e.starts_on, e.ends_on,
                -- Un mandat terminé garde le nom du client (ANO-013).
                coalesce(o.name, app.nom_d_un_client_du_cabinet(e.pme_org_id)) as name,
                o.legal_id, o.jurisdiction, o.currency, o.validation_mode
           from engagements_v e
           left join organizations_v o on o.id = e.pme_org_id
          where e.cabinet_org_id = $1
            -- Chacun voit ses mandats : tous pour l'expert, les siens pour le collaborateur.
            and e.pme_org_id in (select app.mandats_visibles($1))`,
        [cabinetTenantId],
      ),
      // Les pièces de la file, avec leurs faits : les compteurs se classent
      // comme la file, par `statutAuCabinet`.
      db.query(
        `select p.tenant_id, p.status, ${COLONNES_DU_SUIVI}
           from ${PIECES_DU_CABINET}
           left join lateral app.suivi_de_la_piece(p.id) s on true
          where ${TRANSMISE}`,
        [cabinetTenantId],
      ),
    ]);

    const parClient = new Map<
      string,
      { comptes: Record<string, number>; parStatut: Record<StatutCabinet, number> }
    >();
    for (const r of pieces.rows as Record<string, unknown>[]) {
      const tenant = r["tenant_id"] as string;
      let c = parClient.get(tenant);
      if (!c) {
        c = { comptes: { ...COMPTES_VIDES }, parStatut: { ...STATUTS_VIDES } };
        parClient.set(tenant, c);
      }
      const brut = r["status"] as string;
      c.comptes[brut] = (c.comptes[brut] ?? 0) + 1;
      c.parStatut[statutAuCabinet(brut, r)] += 1;
    }

    return (mandats.rows as Record<string, unknown>[])
      .map((r) => {
        const tenant = r["pme_org_id"] as string;
        const c = parClient.get(tenant);
        const parStatut = c?.parStatut ?? { ...STATUTS_VIDES };
        return {
          tenantId: tenant,
          name: (r["name"] as string) ?? "—",
          legalId: (r["legal_id"] as string | null) ?? null,
          // Les deux colonnes sont NOT NULL en base, et la jointure part du
          // mandat : le repli ne pouvait rien sauver, seulement afficher
          // « Tunisie, dinar » sur un dossier qui dirait autre chose.
          jurisdiction: r["jurisdiction"] as string,
          currency: r["currency"] as string,
          validationMode: (r["validation_mode"] as string) ?? "mandate",
          engagementStatus: r["status"] as string,
          mandatDepuis: (r["starts_on"] as string | null) ?? null,
          mandatJusquau: (r["ends_on"] as string | null) ?? null,
          counts: c?.comptes ?? { ...COMPTES_VIDES },
          parStatut,
          // La même règle que la file : `A_TRAITER` du Socle.
          aTraiter: (Object.keys(parStatut) as StatutCabinet[])
            .filter((st) => A_TRAITER.has(st))
            .reduce((n, st) => n + parStatut[st], 0),
        };
      })
      .sort((a, b) => b.aTraiter - a.aTraiter);
  },

  async queue(db: Requete, cabinetTenantId: string, tenantId?: string) {
    const { rows } = await db.query(
      `select p.id as piece_id, p.tenant_id, p.status, p.source, p.created_at,
              -- La date d'envoi : une photo reprise hérite de celle de l'ancienne
              -- (piece_remplacer), et garde ainsi sa place dans la file.
              coalesce(p.transmise_le, p.created_at) as envoyee_le,
              o.name as client, e.id as ecriture_id, e.libelle, e.date_ecriture,
              m.montant, lu.montant_lu, c.email as collaborateur, cf.confiance,
              (select an2.verdict from capture.analyses an2 where an2.piece_id = p.id
                order by an2.created_at desc limit 1) as verdict,
              ((p.document_kind_statut = 'confirme' and p.document_kind is not null)
                or exists (select 1 from ref.document_types dt
                            where dt.code = cf.payload->>'document_kind' and dt.porte_ecriture)
              ) as sens_etabli,
              dem.objet as demande_objet,
              ${tiersDeLaPiece("p", "cf.payload")} as tiers, ${COLONNES_DU_SUIVI}
         from ${PIECES_DU_CABINET}
         left join organizations_v o on o.id = p.tenant_id
         -- L'écriture VIVANTE de la pièce — celle de la facture d'abord, sinon
         -- un règlement —, sur toutes ses versions : un règlement saisi sur une
         -- photo reprise a son écriture sur l'ancienne.
         left join lateral (
           select x.id, x.libelle, x.date_ecriture
             from ecritures_v x
            -- « = any(array(…)) » et non « in (select …) » : l'index de piece_id
            -- sert, au lieu d'un parcours de toutes les écritures par pièce
            -- (12 fois plus lent, mesuré le 5 novembre 2026).
            where x.piece_id = any(array(select app.versions_de_la_piece(p.id)))
              and app.ecriture_vivante(x.id)
            order by (x.nature = 'piece') desc, x.created_at desc
            limit 1
         ) e on true
         -- Envoyée, vue, corrigée, prise en charge : le Socle en dérive le statut.
         left join lateral app.suivi_de_la_piece(p.id) s on true
         -- Le montant de l'écriture : la somme de ses débits, telle que le
         -- Socle l'a posée. L'écran ne l'additionne pas.
         left join lateral (
           select sum(l.debit)::text as montant
             from ecriture_lignes_v l where l.ecriture_id = e.id
         ) m on true
         -- La confiance de la dernière lecture, telle que le désignateur l'a
         -- rendue. Absente pour une pièce lue avant qu'on la persiste. La même
         -- lecture porte l'émetteur lu, repli du tiers quand personne ne l'a dit.
         left join lateral (
           -- La clé vient du contrat, en paramètre : la relire ici en littéral
           -- était la huitième occurrence du même défaut muet. Un renommage
           -- faisait passer cette colonne a NULL sans erreur ni drapeau.
           select (x2.payload -> 'field_confidence' ->> $3)::numeric as confiance, x2.payload,
                  x2.id as extraction_id
             from extractions_v x2 where x2.piece_id = p.id
            order by x2.created_at desc limit 1
         ) cf on true
         -- Le TTC LU, tant qu'aucune écriture ne porte de montant.
         --
         -- Recette du 7 novembre 2026 : une facture lue à 750,700 arrivait dans
         -- la file avec « — » en colonne Montant, parce que la colonne ne lisait
         -- que l'écriture comptabilisée. Le chiffre vient du jugement de la
         -- DERNIÈRE lecture, en unités mineures, à l'exposant de sa devise —
         -- la même règle que la bibliothèque (bibliotheque.ts). Jamais additionné ici.
         left join lateral (
           select round(an.ttc_mineur::numeric / power(10, dv.exposant)::numeric, dv.exposant)::text
                    as montant_lu
             -- Le DERNIER jugement d'abord, son état ensuite (revue Codex de
             -- #266) : un rejugement qui défait un total ne doit pas laisser
             -- reparaître le total d'un jugement plus ancien.
             from (select a.normalisation ->> 'etat' as etat,
                          a.normalisation -> 'montants' ->> 'ttc' as ttc_mineur,
                          coalesce(a.normalisation ->> 'devise', o.currency) as devise
                     from capture.analyses a
                    where a.piece_id = p.id and a.extraction_id = cf.extraction_id
                    order by a.created_at desc, a.id desc limit 1) an
             join ref.devises dv on dv.code = an.devise
            where an.etat in ('tranche', 'non_verifie')
              and an.ttc_mineur ~ '^-?[0-9]+$'
         ) lu on true
         -- Le collaborateur : l'affectation active du client dans ce cabinet.
         left join lateral (
           select mb.email
             from collab_assignments_v a
             join cabinet_members_v mb on mb.user_id = a.collaborator_id and mb.tenant_id = $1
            where a.cabinet_tenant_id = $1 and a.client_tenant_id = p.tenant_id and a.active
            order by a.created_at desc limit 1
         ) c on true
         -- La demande en attente, s'il y en a une.
         --
         -- Le 11 octobre, le commanditaire a posé que le rappel d'une pièce
         -- transmise doit être APPROUVÉ par le cabinet. J'avais livré la
         -- demande et le bouton côté PME, et aucun écran pour y répondre : on
         -- pouvait demander, personne ne pouvait trancher.
         --
         -- Elle paraît donc ICI, dans la file, et non dans un écran séparé :
         -- une demande qu'il faut aller chercher est une demande qui dort.
         -- Le DERNIER fait décide : une demande accordée hier n'est plus en
         -- attente aujourd'hui, et la file ne doit pas la redemander. D'où le
         -- test sur le dernier fait plutôt qu'un filtre sur « demandee » :
         -- ce filtre ressortirait une vieille demande déjà tranchée, parce
         -- qu'il y a toujours une ligne « demandee » quelque part dans
         -- l'histoire.
         -- L'état par étape (revue Codex de #146) : seule la demande faite
         -- AU CABINET l'attend ; celle d'un siège à son propriétaire n'est
         -- pas la sienne, et sa décision ne clôt pas celle du cabinet.
         left join lateral (
           select e.objet
             from app.etat_des_demandes_lisible(p.id) e
            where e.etape = 'cabinet' and e.fait = 'demandee'
            order by e.objet
            limit 1
         ) dem on true
        where ${TRANSMISE}
          and ($2::uuid is null or p.tenant_id = $2)
        order by coalesce(p.transmise_le, p.created_at) desc
        limit 200`,
      [cabinetTenantId, tenantId ?? null, CLE_CONFIANCE_GLOBALE],
    );

    /*
     * « Doublon probable » (staging, 30 octobre 2026) : deux pièces du même
     * émetteur et du même numéro passaient toutes deux dans la file, sans un
     * mot. Jugé au moment où la file est lue, sur les derniers jugements des
     * deux pièces : une première pièce lue après la seconde la fait signaler,
     * une pièce retirée cesse de compter. Rien n'est supprimé.
     *
     * Toutes les pièces de la file en UNE instruction (`app.doublons_probables`,
     * 20261130200000) : appelé ligne à ligne, chaque jugement réévaluait les
     * politiques d'accès — environ 25 ms par pièce, un tiers de la file.
     */
    const ids = (rows as Record<string, unknown>[]).map((p) => p["piece_id"] as string);
    const { rows: doublons } = ids.length
      ? await db.query<{ piece_id: string; doublon_de: string | null }>(
          `select piece_id, doublon_de from app.doublons_probables($1::uuid[])`,
          [ids],
        )
      : { rows: [] };
    const doublonDe = new Map(doublons.map((d) => [d.piece_id, d.doublon_de]));

    return (rows as Record<string, unknown>[])
      .map((p) => {
        const suivi = versSuivi(p);
        return {
          pieceId: p["piece_id"] as string,
          tenantId: p["tenant_id"] as string,
          clientName: (p["client"] as string) ?? "—",
          status: p["status"] as string,
          statut: statutAuCabinet(p["status"] as string, p),
          suivi,
          source: p["source"] as string,
          createdAt: p["created_at"] as string,
          envoyeeLe: new Date(p["envoyee_le"] as string).toISOString(),
          ecritureId: (p["ecriture_id"] as string | null) ?? null,
          libelle: (p["libelle"] as string | null) ?? null,
          dateEcriture: (p["date_ecriture"] as string | null) ?? null,
          montant: (p["montant"] as string | null) ?? null,
          montantLu: (p["montant_lu"] as string | null) ?? null,
          collaborateur: (p["collaborateur"] as string | null) ?? null,
          confiance: p["confiance"] == null ? null : Number(p["confiance"]),
          verdict: (p["verdict"] as string | null) ?? null,
          sensEtabli: p["sens_etabli"] === true,
          demandeEnAttente: (p["demande_objet"] as "rappel" | "suppression" | null) ?? null,
          doublonDe: doublonDe.get(p["piece_id"] as string) ?? null,
          tiers: (p["tiers"] as string | null) ?? null,
        };
      })
      .sort((a, b) => {
        const d = PRIORITE[a.statut] - PRIORITE[b.statut];
        if (d !== 0) return d;
        return a.envoyeeLe < b.envoyeeLe ? 1 : -1;
      });
  },

  /**
   * Les statistiques du cabinet, sur ses mandats engagés. Tout est agrégé
   * ici, en SQL — l'écran de pilotage ne calcule rien.
   */
  async statistiques(db: Requete, cabinetTenantId: string, locale: string) {
    const [parMois, motifs, socle] = await Promise.all([
      db.query(
        // Les prises en charge du cabinet (valider, forcer — et les revues
        // `valide` d'avant, que le registre a reprises) : une pièce par mois et
        // par collaborateur, même forcée deux fois.
        `select to_char(date_trunc('month', pc.prise_le), 'YYYY-MM') as mois,
                coalesce(m.email, '') as collaborateur,
                count(distinct e.piece_id)::int as supervisees
           from prises_en_charge_v pc
           join ecritures_v e on e.id = pc.ecriture_id and e.nature = 'piece'
           join engagements_v g on g.pme_org_id = pc.client_tenant_id and g.cabinet_org_id = $1
           left join cabinet_members_v m on m.user_id = pc.par and m.tenant_id = $1
          where pc.tenant_id = $1
            and pc.prise_le >= date_trunc('month', now()) - interval '11 months'
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

  /**
   * Les motifs d'un usage : rendre une pièce au client (`retour`, le défaut)
   * ou défaire un rapprochement bancaire (`delettrage`, 5 novembre 2026).
   */
  async motifs(db: Requete, locale: string, usage: "retour" | "delettrage" = "retour") {
    // Le libellé vient du référentiel, jamais du code (R4). Le repli sur le
    // français est explicite : un motif sans traduction s'affiche, il ne
    // disparaît pas.
    const { rows } = await db.query(
      `select m.id, m.code, m.severity, m.requires_note, m.geste,
              coalesce(demandee.value, francais.value, m.code) as label
         from ref_rejet_motifs_v m
         left join ref_labels_v demandee
           on demandee.ns = 'rejet_motif' and demandee.key = m.code and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'rejet_motif' and francais.key = m.code and francais.locale = 'fr'
        where m.active is not false and m.usage = $2
        order by m.sort_order`,
      [locale, usage],
    );
    return (rows as Record<string, unknown>[]).map((m) => ({
      id: m["id"] as string,
      code: m["code"] as string,
      label: m["label"] as string,
      severity: m["severity"] as string,
      requiresNote: Boolean(m["requires_note"]),
      geste: m["geste"] as GesteDeRetour,
    }));
  },

  /**
   * Retourner au client, à toute étape, avec le motif gouverné et la note
   * (`piece_retourner`). Une pièce prise en charge l'est avec la
   * contre-passation de son écriture, au journal du jour (spec §4).
   */
  async retourner(
    db: Requete,
    input: { pieceId: string; motifId: string; note?: string | null },
  ): Promise<void> {
    await db.query(`select public.piece_retourner($1, $2, $3)`, [
      input.pieceId,
      input.motifId,
      input.note ?? null,
    ]);
  },

  /**
   * Le cabinet ouvre la pièce : elle est « Vue » (spec §4), et le client lit
   * « Vue par {cabinet} ». Un fait, posé une fois par envoi : rouvrir rend la
   * même vue (`deja`).
   */
  async voir(db: Requete, pieceId: string): Promise<{ vueLe: string | null; deja: boolean }> {
    const { rows } = await db.query<{ r: { vue_le: string | null; deja: boolean } }>(
      `select public.piece_voir($1) as r`,
      [pieceId],
    );
    const r = rows[0]!.r;
    return { vueLe: r.vue_le ? new Date(r.vue_le).toISOString() : null, deja: r.deja };
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
    //
    // Forcer inscrit l'écriture SAISIE par le comptable par la même porte
    // que la proposition du Socle (`socle_ecriture_propose`, puis
    // l'inscription) : la porte pose « ecriture.proposed », et le journal
    // lisait « Le Socle a proposé une écriture. » à la minute du forçage
    // (staging, 30 octobre 2026). Le Socle n'a rien proposé : c'est le fait
    // « ecriture.forcee » de la MÊME écriture qui dit ce qui s'est passé. Le
    // fait reste au journal d'audit (R7) ; la piste de la pièce ne le répète
    // pas sous un nom faux.
    // `service` : le code du compte de service quand l'acteur n'est pas une
    // personne (le relecteur de nuit) — l'écran dit qui a agi, jamais un uuid.
    const { rows } = await db.query(
      `select e.id, e.action, e.actor, e.at, e.motif_id, e.payload,
              app.compte_de_service_de(e.actor) as service
         from event_log_v e
        where (e.object_id = $1 or e.payload ->> 'piece_id' = $2)
          and not (e.action = 'ecriture.proposed'
                   and exists (select 1 from event_log_v f
                                where f.object_table = 'ecritures' and f.action = 'ecriture.forcee'
                                  and f.object_id = e.object_id))
        order by e.at desc limit 200`,
      [pieceId, pieceId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      action: r["action"] as string,
      actor: (r["actor"] as string | null) ?? null,
      at: r["at"] as string,
      motifId: (r["motif_id"] as string | null) ?? null,
      service: (r["service"] as string | null) ?? null,
      payload: r["payload"],
    }));
  },
};
