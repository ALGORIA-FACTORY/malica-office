/** Lecture du dossier transmis. Les autorisations restent dans les vues RLS. */
import { z } from "zod";
import type {
  DocumentComptable,
  DossierComptable,
  ControlesComptables,
} from "@malica/socle/ports/repositories";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";
import type { Requete } from "./db.ts";
import { lireParametres } from "./scan/analyse.ts";

const Id = z.string().uuid();
const Periode = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .nullable();
const Choix = z.array(Id).min(1).max(2000);

/** Une borne de restitution, pas une troncature silencieuse. */
const MAX_DOCUMENTS = 2000;

/*
 * ======================================== LE MOIS D'UN DOCUMENT, ET SON FUSEAU
 *
 * Un document se range au mois de SA date quand la lecture l'a établie : une
 * facture de janvier transmise en mars appartient à janvier, et c'est la même
 * date de référence que l'analyse retient pour ses paramètres
 * (`scan/analyse.ts`, `dateRef`). À défaut, au mois de sa réception.
 *
 * La réception est un instant ; son mois dépend du fuseau. Celui-ci est celui
 * de la personne (`notif.preferences.fuseau`), jamais un fuseau écrit ici
 * (R4). Une personne sans préférence reçoit le défaut LIVRÉ de cette colonne,
 * inscrit dans sa ligne — visible et modifiable (R10), comme le fait déjà
 * `notif.remettre`.
 *
 * `$3` porte ce fuseau dans les deux lectures qui partagent ce gabarit.
 */
const DATE_DU_DOCUMENT = `case when x.payload ->> 'document_date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
       then x.payload ->> 'document_date' end`;
const DATE_DE_CLASSEMENT = `coalesce(${DATE_DU_DOCUMENT},
       to_char(p.created_at at time zone $3::text, 'YYYY-MM-DD'))`;

const DOCUMENTS = `select p.id, p.tenant_id as "tenantId", p.document_kind as type,
  p.status, p.created_at::text as "recuLe", p.sha256 as empreinte,
  (select parent.id from pieces_v parent where parent.id = p.source_piece_id
     and parent.tenant_id = p.tenant_id and parent.vis = 'partage') as "sourcePieceId",
  o.currency as devise,
  nullif(x.payload ->> 'document_date', '') as "dateDocument",
  ${DATE_DE_CLASSEMENT} as "dateDeClassement",
  case when p.document_kind = 'facture_vente' then null
       else nullif(btrim(x.payload ->> 'issuer'), '') end as tiers,
  coalesce(nullif(x.payload -> 'references' ->> 'invoice_no', ''),
           nullif(x.payload -> 'references' ->> 'document_no', ''),
           nullif(x.payload -> 'references' ->> 'numero', ''),
           nullif(x.payload -> 'references' ->> 'reference', '')) as reference,
  case when a.normalisation ->> 'etat' in ('tranche', 'non_verifie') and a.extraction_id = x.id
       then a.normalisation -> 'montants' ->> 'ttc' end as "ttcMineur",
  a.pack_version_id as "packAnalyse",
  -- La date à laquelle l'analyse a lu ses paramètres : la même règle, la même session.
  coalesce(${DATE_DU_DOCUMENT}, to_char(p.created_at, 'YYYY-MM-DD')) as "dateAnalyse"
  from pieces_v p
  join organizations_v o on o.id = p.tenant_id
  left join lateral (select id, payload from extractions_v x
                      where x.piece_id = p.id order by created_at desc, id desc limit 1) x on true
  left join lateral (select extraction_id, pack_version_id, normalisation from capture.analyses a
                      where a.piece_id = p.id order by created_at desc, id desc limit 1) a on true`;

type LigneDocument = Omit<DocumentComptable, "montant"> & {
  ttcMineur: string | null;
  packAnalyse: string | null;
  dateAnalyse: string;
};

/** Le fuseau de la personne connectée : sa préférence, ou le défaut livré inscrit chez elle. */
async function fuseauDeLaPersonne(db: Requete): Promise<string> {
  await db.query(
    `insert into notif.preferences (user_id) values (auth.uid()) on conflict (user_id) do nothing`,
  );
  const { rows } = await db.query<{ fuseau: string | null }>(
    `select fuseau from notif.preferences where user_id = auth.uid()`,
  );
  const fuseau = rows[0]?.fuseau;
  if (!fuseau)
    throw Object.assign(new Error("fuseau horaire absent des préférences de la personne"), {
      code: "22023",
    });
  return fuseau;
}

/**
 * Le montant TTC en unités de la devise. Les décimales viennent du chemin
 * commun des paramètres (`lireParametres`), au pack et à la date que l'analyse
 * a retenus : ce sont celles qui ont produit l'unité mineure.
 */
async function avecMontants(db: Requete, lignes: LigneDocument[]): Promise<DocumentComptable[]> {
  const decimales = new Map<string, Promise<number>>();
  const lire = (pack: string, date: string) => {
    const cle = `${pack}|${date}`;
    let d = decimales.get(cle);
    if (!d) {
      d = lireParametres(db, pack, date).then((p) => p["money.decimals"]);
      decimales.set(cle, d);
    }
    return d;
  };
  const documents: DocumentComptable[] = [];
  // Séquentiel : une seule connexion, et un paramètre lu une fois par (pack, date).
  for (const { ttcMineur, packAnalyse, dateAnalyse, ...doc } of lignes) {
    const montant =
      ttcMineur !== null && packAnalyse !== null
        ? depuisUniteMineure(Number(ttcMineur), await lire(packAnalyse, dateAnalyse))
        : null;
    documents.push({ ...doc, montant });
  }
  return documents;
}

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
  const fuseau = await fuseauDeLaPersonne(db);
  const { rows } = await db.query<LigneDocument>(
    `${DOCUMENTS}
    where p.tenant_id = $1 and p.vis = 'partage'
      -- Une version précédente se lit depuis la photo qui la remplace.
      and p.remplacee_par is null
      and ($2::text is null or left(${DATE_DE_CLASSEMENT}, 7) = $2)
    order by p.created_at desc, p.id limit $4`,
    [clientId, periode, fuseau, MAX_DOCUMENTS + 1],
  );
  if (rows.length > MAX_DOCUMENTS)
    throw Object.assign(
      new Error("Ce dossier est volumineux : choisissez un mois pour le consulter."),
      { code: "22023" },
    );
  return avecMontants(db, rows);
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
  // Chaque bout est lu à sa VERSION COURANTE : un lien saisi sur une photo
  // reprise mène à celle qui l'a remplacée, sans que le fait change (R7).
  const { rows: ids } = await db.query<{ id: string }>(
    `with recursive
    visibles as materialized (select id, source_piece_id from pieces_v
      where tenant_id = $1 and vis = 'partage' and remplacee_par is null),
    liens as (
      select l.a, app.version_courante(l.b) as b from (
        select id as a, source_piece_id as b from visibles where source_piece_id is not null
        union select app.version_courante(pa.piece_id), pa.justificatif_piece_id from paiements_v pa
          where pa.tenant_id = $1 and pa.justificatif_piece_id is not null
        union select r.piece_id, r.piece_liee_id
          from rattachements_v r where r.tenant_id = $1 and r.fait = 'rattache'
      ) l
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
  const fuseau = await fuseauDeLaPersonne(db);
  const { rows: lignes } = await db.query<LigneDocument>(
    `${DOCUMENTS}
    where p.tenant_id = $1 and p.vis = 'partage' and p.id = any($2::uuid[])
    order by p.created_at, p.id`,
    [clientId, tous, fuseau],
  );
  const docs = await avecMontants(db, lignes);
  const { rows: ecritures } = await db.query<DossierComptable["ecritures"][number]>(
    // Écritures et règlements d'une pièce : ceux de toutes ses versions, au nom
    // de la photo courante.
    `select e.id, app.version_courante(e.piece_id) as "pieceId", e.paiement_id as "paiementId", e.nature,
            e.journal, e.date_ecriture::text as date, e.libelle, e.status as statut,
            l.account_code as compte, e.devise, e.review_outcome as revue,
            coalesce((select pa.label from plan_comptable_v pa
                       where pa.account_code = l.account_code and pa.tenant_id in ($1, $3)
                       order by (pa.tenant_id = $1) desc limit 1),
                     (select ra.label from ref_accounts_v ra
                       where ra.pack_version_id = e.pack_version_id and ra.account_code = l.account_code), '') as "compteLibelle",
            l.debit::text, l.credit::text
       from ecritures_v e join ecriture_lignes_v l on l.ecriture_id = e.id
      where e.tenant_id = $1 and e.vis = 'partage' and app.version_courante(e.piece_id) = any($2::uuid[])
      order by e.date_ecriture, e.id, l.ordinal`,
    [clientId, tous, cabinetId],
  );
  const controles = await lireControles(db, tous);
  const { rows: paiements } = await db.query<NonNullable<DossierComptable["paiements"]>[number]>(
    `select p.id, app.version_courante(p.piece_id) as "pieceId", p.moyen_code as moyen,
            p.montant_mineur::text as "montantMineur", p.devise, p.paye_le::text as date,
            p.reference, j.id as "justificatifId", p.eteint as annule
       from paiements_v p
       left join pieces_v j on j.id = p.justificatif_piece_id and j.tenant_id = $1 and j.vis = 'partage'
      where p.tenant_id = $1 and app.version_courante(p.piece_id) = any($2::uuid[])
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
