import { randomUUID } from "node:crypto";
import { Decimal } from "@malica/socle/domain/decimal";
import { z } from "zod";
import {
  ConfigurationFiscaleSchema,
  NouveauProfilFiscalSchema,
  type ApercuFiscal,
  type CatalogueFiscal,
  type FiscaliteDossier,
  type LotFiscal,
  type ProfilFiscal,
} from "@malica/socle/ports/fiscalite";
import type { Requete } from "../db.ts";

const jour = z.string().date();
const uuid = z.string().uuid();
const Lot = z
  .object({
    cabinetId: uuid,
    versionProfilId: uuid,
    dateEffet: jour,
    remplacerPersonnalisation: z.boolean().default(false),
    cibles: z
      .array(z.object({ clientId: uuid, precedentId: uuid.nullable() }).strict())
      .min(1)
      .max(500),
  })
  .strict()
  .refine(
    (l) => new Set(l.cibles.map((c) => c.clientId)).size === l.cibles.length,
    "Dossier en double.",
  )
  .refine(
    (l) => !l.remplacerPersonnalisation || l.cibles.length === 1,
    "Les particularités ne se remplacent que dossier par dossier.",
  );

async function exigerExpert(db: Requete, cabinetId: string) {
  const { rows } = await db.query<{ ok: boolean }>(
    `select app.has_org_role($1, array['expert']) as ok`,
    [uuid.parse(cabinetId)],
  );
  if (!rows[0]?.ok) throw new Error("Seul l'expert peut modifier la fiscalité des dossiers.");
}
async function profil(db: Requete, id: string, cabinetId: string): Promise<ProfilFiscal> {
  const { rows } = await db.query<{ p: ProfilFiscal }>(
    `select jsonb_build_object('id', id, 'cabinetId', tenant_id, 'profilId', profil_id,
       'precedentId', precedent_id, 'nom', nom, 'categorie', categorie,
       'jurisdiction', jurisdiction, 'dateEffet', date_effet, 'configuration', configuration,
       'creeLe', created_at, 'creePar', created_by) as p
     from parametrage.profils_fiscaux where id = $1 and tenant_id = $2`,
    [uuid.parse(id), cabinetId],
  );
  if (!rows[0]) throw new Error("Profil fiscal inaccessible.");
  return rows[0].p;
}
const SELECT_DOSSIER = `select jsonb_build_object('id', id, 'clientId', tenant_id,
  'cabinetId', cabinet_id, 'versionProfilId', version_profil_id, 'categorie', categorie,
  'personnalise', personnalise, 'dateEffet', date_effet, 'configuration', configuration,
  'creeLe', created_at, 'creePar', created_by) as d from parametrage.fiscalite_dossiers`;

async function apercu(db: Requete, brut: LotFiscal): Promise<ApercuFiscal[]> {
  const input = Lot.parse(brut);
  await exigerExpert(db, input.cabinetId);
  const p = await profil(db, input.versionProfilId, input.cabinetId);
  if (input.dateEffet < p.dateEffet)
    throw new Error("Le profil n'est pas encore applicable à cette date.");
  const { rows } = await db.query<{
    id: string;
    nom: string;
    jurisdiction: string;
    precedent_id: string | null;
    personnalise: boolean | null;
    date_effet: string | null;
    version_profil_id: string | null;
    configuration: ApercuFiscal["avant"];
    fiche_date: string | null;
    fiche_change: boolean;
    fiche_particularites: boolean;
  }>(
    `select o.id, o.name as nom, o.jurisdiction, d.id as precedent_id,
      d.personnalise, d.date_effet::text, d.version_profil_id,
      coalesce(d.configuration, case when f.id is not null then jsonb_build_object(
        'activite', coalesce(f.secteur,''), 'regimeImposition', f.regime_imposition,
        'regimeTva', f.regime_tva, 'prorataTva', f.prorata_tva, 'regles', '[]'::jsonb) end) as configuration,
      (d.id is null and ((f.regime_imposition is not null and f.regime_imposition is distinct from $3::jsonb->>'regimeImposition')
        or (f.regime_tva is not null and f.regime_tva is distinct from $3::jsonb->>'regimeTva')
        or (f.prorata_tva is not null and f.prorata_tva is distinct from ($3::jsonb->>'prorataTva')::numeric)
        or (f.secteur is not null and f.secteur is distinct from $3::jsonb->>'activite'))) as fiche_particularites,
      f.valid_from::text as fiche_date,
      (f.regime_imposition is distinct from $3::jsonb->>'regimeImposition'
       or f.regime_tva is distinct from $3::jsonb->>'regimeTva'
       or f.prorata_tva is distinct from ($3::jsonb->>'prorataTva')::numeric
       or f.secteur is distinct from $3::jsonb->>'activite') as fiche_change
    from identity.engagements e join identity.organizations o on o.id = e.pme_org_id
    left join lateral (select * from parametrage.fiscalite_dossiers x
      where x.tenant_id = o.id order by date_effet desc, created_at desc limit 1) d on true
    left join lateral (select * from identity.fiches_fiscales x where x.tenant_id = o.id
      order by valid_from desc limit 1) f on true
    where e.cabinet_org_id = $1 and e.status = 'actif'
      and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
      and o.id = any($2::uuid[]) and o.archived_at is null`,
    [input.cabinetId, input.cibles.map((c) => c.clientId), JSON.stringify(p.configuration)],
  );
  if (rows.length !== input.cibles.length)
    throw new Error("Un dossier n'est plus accessible sous mandat actif. Actualisez la sélection.");
  return input.cibles.map((c) => {
    const r = rows.find((x) => x.id === c.clientId)!;
    if (r.precedent_id !== c.precedentId)
      throw new Error("La fiscalité a changé depuis sa lecture. Actualisez l'aperçu.");
    const statut =
      r.jurisdiction !== p.jurisdiction
        ? "juridiction"
        : (r.personnalise || r.fiche_particularites) && !input.remplacerPersonnalisation
          ? "personnalise"
          : (r.date_effet && input.dateEffet < r.date_effet) ||
              (r.fiche_change && r.fiche_date && input.dateEffet <= r.fiche_date)
            ? "date"
            : r.version_profil_id === p.id
              ? "identique"
              : "eligible";
    return {
      clientId: r.id,
      nom: r.nom,
      precedentId: r.precedent_id,
      statut,
      avant: r.configuration,
      apres: p.configuration,
    };
  });
}

export const fiscalite = {
  async profilsFiscaux(db: Requete, cabinetId: string): Promise<ProfilFiscal[]> {
    const { rows } = await db.query<{ id: string }>(
      `select id from parametrage.profils_fiscaux where tenant_id = $1 order by nom, created_at desc`,
      [uuid.parse(cabinetId)],
    );
    return Promise.all(rows.map((r) => profil(db, r.id, cabinetId)));
  },
  async enregistrerProfilFiscal(db: Requete, brut: unknown): Promise<ProfilFiscal> {
    const i = NouveauProfilFiscalSchema.parse(brut);
    await exigerExpert(db, i.cabinetId);
    const { rows } = await db.query<{ id: string }>(
      `insert into parametrage.profils_fiscaux
       (tenant_id, profil_id, precedent_id, nom, categorie, jurisdiction, date_effet, configuration)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning id`,
      [
        i.cabinetId,
        i.profilId ?? randomUUID(),
        i.precedentId,
        i.nom,
        i.categorie,
        i.jurisdiction,
        i.dateEffet,
        JSON.stringify(i.configuration),
      ],
    );
    return profil(db, rows[0]!.id, i.cabinetId);
  },
  async fiscaliteDossiers(
    db: Requete,
    cabinetId: string,
    date: string,
  ): Promise<FiscaliteDossier[]> {
    const { rows } = await db.query<{ d: FiscaliteDossier }>(
      `${SELECT_DOSSIER} where id in (select distinct on (tenant_id) id
       from parametrage.fiscalite_dossiers where cabinet_id = $1 and date_effet <= $2::date
       order by tenant_id, date_effet desc, created_at desc)`,
      [uuid.parse(cabinetId), jour.parse(date)],
    );
    return rows.map((r) => r.d);
  },
  async historiqueFiscal(
    db: Requete,
    cabinetId: string,
    clientId: string,
  ): Promise<FiscaliteDossier[]> {
    const { rows } = await db.query<{ d: FiscaliteDossier }>(
      `${SELECT_DOSSIER} where cabinet_id = $1 and tenant_id = $2 order by date_effet desc, created_at desc`,
      [uuid.parse(cabinetId), uuid.parse(clientId)],
    );
    return rows.map((r) => r.d);
  },
  async catalogueFiscal(
    db: Requete,
    jurisdiction: string,
    date: string,
  ): Promise<CatalogueFiscal[]> {
    const d = jour.parse(date);
    const { rows } = await db.query<{
      code: string;
      label: string;
      famille: CatalogueFiscal["famille"];
      operation: CatalogueFiscal["operation"];
      rate: string | null;
      fixed_amount: string | null;
      basis: string | null;
      taxable: boolean | null;
      legal_reference: string | null;
    }>(
      `with p as (select id from ref.jurisdiction_packs where jurisdiction = $1
       and effective_from <= $2::date and (effective_to is null or effective_to > $2::date)
       order by effective_from desc limit 1)
      select t.code, t.label, 'tva' as famille, op as operation, t.rate::text,
        null::text as fixed_amount, null::text as basis, null::boolean as taxable, t.legal_reference
      from ref.tva_rates t join p on p.id = t.pack_version_id
      cross join unnest(array['achat','vente']) op
      where t.valid_from <= $2::date and (t.valid_to is null or t.valid_to > $2::date)
      union all
      select c.code, c.label, c.famille,
        case when c.document_kind = 'facture_achat' then 'achat' else 'vente' end,
        c.rate::text, c.fixed_amount::text, c.basis, c.taxable, c.legal_reference
      from ref.fiscal_charges c join p on p.id = c.pack_version_id
      where c.valid_from <= $2::date and (c.valid_to is null or c.valid_to > $2::date)
      order by famille, label, operation`,
      [jurisdiction, d],
    );
    return rows.map((r) => ({
      code: r.code,
      libelle: r.label,
      famille: r.famille,
      operation: r.operation,
      mode: r.fixed_amount !== null ? "montant" : r.rate !== null ? "taux" : "aucun",
      valeur: r.fixed_amount ?? (r.rate === null ? null : new Decimal(r.rate).mul(100).toString()),
      assiette: r.basis ?? "",
      dansBaseTva: r.taxable,
      referenceLegale: r.legal_reference ?? "",
    }));
  },
  apercuFiscal: apercu,
  async appliquerProfilFiscal(db: Requete, brut: LotFiscal) {
    const i = Lot.parse(brut);
    // Même ordre de verrous pour tous les lots : ni course entre aperçu et
    // insertion, ni interblocage si deux experts sélectionnent les mêmes clients.
    for (const c of [...i.cibles].sort((a, b) => a.clientId.localeCompare(b.clientId))) {
      await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [c.clientId]);
    }
    const preview = await apercu(db, i);
    const p = await profil(db, i.versionProfilId, i.cabinetId);
    let appliques = 0;
    for (const c of preview.filter((r) => r.statut === "eligible")) {
      await db.query(
        `insert into parametrage.fiscalite_dossiers
        (tenant_id, cabinet_id, version_profil_id, precedent_id, categorie, personnalise, date_effet, configuration)
        values ($1,$2,$3,$4,$5,false,$6,$7::jsonb)`,
        [
          c.clientId,
          i.cabinetId,
          p.id,
          c.precedentId,
          p.categorie,
          i.dateEffet,
          JSON.stringify(p.configuration),
        ],
      );
      appliques++;
    }
    return { appliques, ignores: preview.length - appliques };
  },
  async personnaliserFiscalite(db: Requete, brut: unknown) {
    const i = z
      .object({
        cabinetId: uuid,
        clientId: uuid,
        versionProfilId: uuid,
        precedentId: uuid.nullable(),
        dateEffet: jour,
        configuration: ConfigurationFiscaleSchema,
      })
      .strict()
      .parse(brut);
    await exigerExpert(db, i.cabinetId);
    const p = await profil(db, i.versionProfilId, i.cabinetId);
    const { rows } = await db.query<{ id: string }>(
      `insert into parametrage.fiscalite_dossiers
      (tenant_id, cabinet_id, version_profil_id, precedent_id, categorie, personnalise, date_effet, configuration)
      values ($1,$2,$3,$4,$5,true,$6,$7::jsonb) returning id`,
      [
        i.clientId,
        i.cabinetId,
        i.versionProfilId,
        i.precedentId,
        p.categorie,
        i.dateEffet,
        JSON.stringify(i.configuration),
      ],
    );
    return { id: rows[0]!.id };
  },
};
