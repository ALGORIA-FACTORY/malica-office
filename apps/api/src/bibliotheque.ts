/** Lecture du dossier transmis. Les autorisations restent dans les vues RLS. */
import { z } from "zod";
import type {
  DocumentComptable,
  DossierComptable,
  ControlesComptables,
} from "@malica/socle/ports/repositories";
import type { Requete } from "./db.ts";

const Id = z.string().uuid();
const Periode = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .nullable();
const Choix = z.array(Id).min(1).max(2000);

/** Une borne de restitution, pas une troncature silencieuse. */
const MAX_DOCUMENTS = 2000;

const DOCUMENTS = `select p.id, p.tenant_id as "tenantId", p.document_kind as type,
  p.status, p.created_at::text as "recuLe",
  (select parent.id from pieces_v parent where parent.id = p.source_piece_id
     and parent.tenant_id = p.tenant_id and parent.vis = 'partage') as "sourcePieceId",
  o.currency as devise,
  nullif(x.payload ->> 'document_date', '') as "dateDocument",
  case when p.document_kind = 'facture_vente' then null
       else nullif(btrim(x.payload ->> 'issuer'), '') end as tiers,
  coalesce(nullif(x.payload -> 'references' ->> 'invoice_no', ''),
           nullif(x.payload -> 'references' ->> 'document_no', ''),
           nullif(x.payload -> 'references' ->> 'numero', ''),
           nullif(x.payload -> 'references' ->> 'reference', '')) as reference,
  case when a.normalisation ->> 'etat' in ('tranche', 'non_verifie')
         and a.extraction_id = x.id and sp.value_num is not null
       then ((a.normalisation -> 'montants' ->> 'ttc')::numeric
             / power(10::numeric, sp.value_num::numeric))::text end as montant
  from pieces_v p
  join organizations_v o on o.id = p.tenant_id
  left join lateral (select id, payload from extractions_v x
                      where x.piece_id = p.id order by created_at desc, id desc limit 1) x on true
  left join lateral (select extraction_id, pack_version_id, normalisation from capture.analyses a
                      where a.piece_id = p.id order by created_at desc, id desc limit 1) a on true
  left join lateral (select value_num from ref.socle_params sp
                      where sp.pack_version_id = a.pack_version_id and sp.code = 'money.decimals'
                        and sp.valid_from <= p.created_at::date
                        and (sp.valid_to is null or sp.valid_to >= p.created_at::date)
                      order by valid_from desc limit 1) sp on true`;

/** Un compte membre des deux espaces ne doit pas restituer ses pièces privées. */
async function exigerMandat(db: Requete, cabinetId: string, clientId: string): Promise<void> {
  Id.parse(cabinetId);
  Id.parse(clientId);
  const { rows } = await db.query(
    `select 1 from engagements_v g
      where g.cabinet_org_id = $1 and g.pme_org_id = $2 and g.status = 'actif'
        and g.starts_on <= current_date and (g.ends_on is null or g.ends_on >= current_date)
        and g.pme_org_id in (select app.mandats_visibles($1))`,
    [cabinetId, clientId],
  );
  if (!rows[0])
    throw Object.assign(new Error("dossier introuvable ou non mandaté"), { code: "42501" });
}

export async function documents(
  db: Requete,
  cabinetId: string,
  clientId: string,
  periode: string | null,
): Promise<DocumentComptable[]> {
  Periode.parse(periode);
  await exigerMandat(db, cabinetId, clientId);
  const { rows } = await db.query<DocumentComptable>(
    `${DOCUMENTS}
    where p.tenant_id = $1 and p.vis = 'partage'
      and ($2::text is null or to_char(p.created_at at time zone 'Africa/Tunis', 'YYYY-MM') = $2)
    order by p.created_at desc, p.id limit $3`,
    [clientId, periode, MAX_DOCUMENTS + 1],
  );
  if (rows.length > MAX_DOCUMENTS)
    throw Object.assign(
      new Error("Ce dossier est volumineux : choisissez un mois pour le consulter."),
      { code: "22023" },
    );
  return rows;
}

export async function documentsLies(
  db: Requete,
  cabinetId: string,
  clientId: string,
  pieces: string[],
): Promise<DossierComptable> {
  Choix.parse(pieces);
  await exigerMandat(db, cabinetId, clientId);
  // Même garde de licence et de dates que les exports existants.
  await db.query(`select app.export_mandats($1, $2)`, [cabinetId, clientId]);
  // Les deux bouts de chaque arête sont joints aux pièces autorisées AVANT
  // la récursion. Une pièce cachée ne peut pas servir de pont vers une autre.
  const { rows: ids } = await db.query<{ id: string }>(
    `with recursive
    visibles as materialized (select id, source_piece_id from pieces_v
      where tenant_id = $1 and vis = 'partage'),
    liens as (
      select id as a, source_piece_id as b from visibles where source_piece_id is not null
      union select pa.piece_id, pa.justificatif_piece_id from paiements_v pa
        where pa.tenant_id = $1 and pa.justificatif_piece_id is not null
      union select r.piece_id, r.piece_liee_id from rattachements_v r
        where r.tenant_id = $1 and r.fait = 'rattache'
    ),
    aretes as (select l.a, l.b from liens l join visibles a on a.id = l.a join visibles b on b.id = l.b),
    parcours(id) as (
      select id from visibles where id = any($2::uuid[])
      union
      select case when l.a = p.id then l.b else l.a end
        from parcours p join aretes l on l.a = p.id or l.b = p.id
    ) select id from parcours limit $3`,
    [clientId, pieces, MAX_DOCUMENTS + 1],
  );
  if (ids.length > MAX_DOCUMENTS)
    throw Object.assign(new Error("Le dossier lié est trop volumineux : réduisez la sélection."), {
      code: "22023",
    });
  const selection = new Set(ids.map((p) => p.id));
  if (pieces.some((id) => !selection.has(id)))
    throw Object.assign(new Error("document introuvable ou non transmis"), { code: "42501" });
  const tous = [...selection];
  const { rows: docs } = await db.query<DocumentComptable>(
    `${DOCUMENTS}
    where p.tenant_id = $1 and p.vis = 'partage' and p.id = any($2::uuid[])
    order by p.created_at, p.id`,
    [clientId, tous],
  );
  const { rows: ecritures } = await db.query<DossierComptable["ecritures"][number]>(
    `select e.id, e.piece_id as "pieceId", e.paiement_id as "paiementId", e.nature,
            e.journal, e.date_ecriture::text as date, e.libelle, e.status as statut,
            l.account_code as compte, e.devise, e.review_outcome as revue,
            coalesce((select pa.label from plan_comptable_v pa
                       where pa.account_code = l.account_code and pa.tenant_id in ($1, $3)
                       order by (pa.tenant_id = $1) desc limit 1),
                     (select ra.label from ref_accounts_v ra
                       where ra.pack_version_id = e.pack_version_id and ra.account_code = l.account_code), '') as "compteLibelle",
            l.debit::text, l.credit::text
       from ecritures_v e join ecriture_lignes_v l on l.ecriture_id = e.id
      where e.tenant_id = $1 and e.vis = 'partage' and e.piece_id = any($2::uuid[])
      order by e.date_ecriture, e.id, l.ordinal`,
    [clientId, tous, cabinetId],
  );
  const controles = await lireControles(db, tous);
  const { rows: paiements } = await db.query<NonNullable<DossierComptable["paiements"]>[number]>(
    `select p.id, p.piece_id as "pieceId", p.moyen_code as moyen,
            p.montant_mineur::text as "montantMineur", p.devise, p.paye_le::text as date,
            p.reference, j.id as "justificatifId", p.eteint as annule
       from paiements_v p
       left join pieces_v j on j.id = p.justificatif_piece_id and j.tenant_id = $1 and j.vis = 'partage'
      where p.tenant_id = $1 and p.piece_id = any($2::uuid[])
       order by p.created_at, p.id`,
    [clientId, tous],
  );
  return { documents: docs, ecritures, controles, paiements };
}

export async function controlesPiece(
  db: Requete,
  cabinetId: string,
  pieceId: string,
): Promise<ControlesComptables | null> {
  Id.parse(pieceId);
  const { rows: pieces } = await db.query<{ tenant_id: string }>(
    `select tenant_id from pieces_v where id = $1 and vis = 'partage'`,
    [pieceId],
  );
  if (!pieces[0])
    throw Object.assign(new Error("document introuvable ou non transmis"), { code: "42501" });
  await exigerMandat(db, cabinetId, pieces[0].tenant_id);
  return (await lireControles(db, [pieceId]))[0] ?? null;
}

async function lireControles(db: Requete, pieces: string[]): Promise<ControlesComptables[]> {
  const { rows } = await db.query<{
    id: string;
    piece_id: string;
    controles: unknown;
    a_jour: boolean;
  }>(
    `select distinct on (a.piece_id) a.id, a.piece_id, a.controles, a.extraction_id = x.id as a_jour
       from capture.analyses a
       left join lateral (select id from extractions_v x where x.piece_id = a.piece_id
                           order by created_at desc, id desc limit 1) x on true
      where a.piece_id = any($1::uuid[]) order by a.piece_id, a.created_at desc, a.id desc`,
    [pieces],
  );
  const controle = z.object({ code: z.string(), statut: z.string(), motif: z.string() });
  return rows.map((a) => ({
    pieceId: a.piece_id,
    analyseId: a.id,
    aJour: a.a_jour === true,
    controles: z.array(controle).parse(a.controles),
  }));
}
