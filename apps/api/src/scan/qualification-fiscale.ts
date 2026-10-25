import {
  QualificationFiscaleSchema,
  type QualificationFiscaleInscrite,
} from "@malica/socle/ports/qualification-fiscale";
import { calculerLignesFiscales } from "@malica/socle/engines/fiscalite/lignes";
import { enUnitesExactes } from "@malica/socle/somme-decimale";
import { D, toFixedStr, sum } from "@malica/socle/domain/decimal";
import type { Requete } from "../db.ts";
import { fiscaliteDuDossier } from "./fiscalite-du-dossier.ts";
import { referentiel } from "../depots/referentiel.ts";

export async function lireQualificationFiscale(
  db: Requete,
  pieceId: string,
): Promise<QualificationFiscaleInscrite | null> {
  const { rows } = await db.query<{
    id: string;
    payload: unknown;
    created_by: string;
    created_at: Date;
  }>(
    `select id,payload,created_by,created_at from parametrage.qualifications_fiscales where piece_id=$1 order by created_at desc limit 1`,
    [pieceId],
  );
  const r = rows[0];
  return r
    ? {
        ...QualificationFiscaleSchema.parse(r.payload),
        id: r.id,
        creePar: r.created_by,
        creeLe: new Date(r.created_at).toISOString(),
      }
    : null;
}
/** Référentiel et contexte relus à la date du fait, y compris sans profil. */
async function contexteFiscalQualifie(db: Requete, pieceId: string, dateConfirmee?: string) {
  const { rows } = await db.query<{
    tenant_id: string;
    jurisdiction: string;
    extraction_id: string;
    payload: Record<string, unknown>;
    date: string;
    kind: string;
    pack_id: string;
  }>(
    `select p.tenant_id,o.jurisdiction,x.id as extraction_id,x.payload,
    coalesce(nullif(x.payload->>'document_date','')::date,$2::date,(qd.payload->>'dateOperation')::date,p.created_at::date)::text as date,
    coalesce(case when p.document_kind_statut='confirme' then p.document_kind end,x.payload->>'document_kind') as kind,
    pk.id as pack_id
  from capture.pieces p join identity.organizations o on o.id=p.tenant_id
  join lateral (select id,payload from capture.extractions where piece_id=p.id order by created_at desc limit 1) x on true
  left join lateral (select payload from parametrage.qualifications_fiscales where piece_id=p.id and extraction_id=x.id order by created_at desc limit 1) qd on true
  join lateral (select id from ref.jurisdiction_packs where jurisdiction=o.jurisdiction and effective_from <= coalesce(nullif(x.payload->>'document_date','')::date,$2::date,(qd.payload->>'dateOperation')::date,p.created_at::date) order by effective_from desc limit 1) pk on true
  where p.id=$1`,
    [pieceId, dateConfirmee ?? null],
  );
  const p = rows[0];
  if (!p) throw new Error("Pièce lue introuvable.");
  const profil = await fiscaliteDuDossier(db, p.tenant_id, p.date);
  const { rows: fiches } = await db.query<{
    regime_tva: string | null;
    prorata_tva: string | null;
  }>(
    `select regime_tva,prorata_tva::text from identity.fiches_fiscales where tenant_id=$1 and valid_from <= $2::date and (valid_to is null or valid_to > $2::date) order by valid_from desc limit 1`,
    [p.tenant_id, p.date],
  );
  const param = await referentiel.socleParams(db, p.pack_id);
  return {
    ...p,
    profil,
    regimeTva: profil?.configuration.regimeTva ?? fiches[0]?.regime_tva ?? null,
    prorata:
      profil?.configuration.prorataTva != null
        ? String(profil.configuration.prorataTva)
        : (fiches[0]?.prorata_tva ?? null),
    decimales: param.moneyDecimals,
    droits: (await referentiel.fiscalCharges(db, p.pack_id, "fr", p.date)).filter(
      (r): r is typeof r & { documentKind: "facture_achat" | "facture_vente" } =>
        r.documentKind === "facture_achat" || r.documentKind === "facture_vente",
    ),
  };
}
export async function lignesQualifiees(db: Requete, pieceId: string) {
  const c = await contexteFiscalQualifie(db, pieceId);
  const q = await lireQualificationFiscale(db, pieceId);
  if (!q) return { contexte: c, qualification: null, lignes: null };
  if (
    q.extractionId !== c.extraction_id ||
    q.profilVersionId !== (c.profil?.id ?? null) ||
    q.documentKind !== c.kind ||
    q.dateOperation !== c.date
  )
    return { contexte: c, qualification: null, lignes: null };
  const codes = (c.payload["lines"] as Array<{ tax_code: string }>).map((l) => l.tax_code);
  const lignes = calculerLignesFiscales({
    qualification: q,
    codesTva: codes,
    droits: c.droits,
    profil: c.profil?.configuration ?? null,
    prorata: c.prorata,
    regimeTva: c.regimeTva,
    decimales: c.decimales,
  });
  return { contexte: c, qualification: q, lignes };
}
export async function inscrireQualificationFiscale(db: Requete, brut: unknown) {
  const q = QualificationFiscaleSchema.parse(brut);
  const c = await contexteFiscalQualifie(db, q.pieceId, q.dateOperation);
  if (c.date !== q.dateOperation) throw new Error("La date qualifiée diffère de la date imprimée.");
  // Avant tout verrou : l'identité doit être expert du mandat courant.
  const { rows: acces } = await db.query<{ ok: boolean }>(
    `select exists(select 1 from identity.engagements e where e.pme_org_id=$1 and e.status='actif' and e.starts_on<=current_date and (e.ends_on is null or e.ends_on>=current_date) and app.has_org_role(e.cabinet_org_id,array['expert'])) as ok`,
    [c.tenant_id],
  );
  if (!acces[0]?.ok) throw new Error("Seul l’expert mandaté qualifie la fiscalité d’une pièce.");
  const codes = (c.payload["lines"] as Array<{ tax_code: string }>).map((l) => l.tax_code);
  const lignes = calculerLignesFiscales({
    qualification: q,
    codesTva: codes,
    droits: c.droits,
    profil: c.profil?.configuration ?? null,
    prorata: c.prorata,
    regimeTva: c.regimeTva,
    decimales: c.decimales,
  });
  // Un coût doit être une imputation existante du pack ou du mandat courant.
  const comptes = new Set((await comptesDeCout(db, c)).map((p) => p.code));
  for (const l of lignes) {
    enUnitesExactes(l.baseHt, c.decimales);
    if (!comptes.has(l.compteCout))
      throw new Error(`Compte de coût « ${l.compteCout} » absent du plan applicable.`);
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into parametrage.qualifications_fiscales(tenant_id,piece_id,extraction_id,profil_version_id,precedent_id,payload) values($1,$2,$3,$4,$5,$6::jsonb) returning id`,
    [c.tenant_id, q.pieceId, q.extractionId, q.profilVersionId, q.precedentId, JSON.stringify(q)],
  );
  return { id: rows[0]!.id };
}
/** Ancres explicites pour la normalisation, jamais une réécriture du texte lu. */
export function ancresFiscales(
  lignes: NonNullable<Awaited<ReturnType<typeof lignesQualifiees>>["lignes"]>,
  decimales: number,
) {
  const droits = new Map<string, string>();
  const mineur = (v: string) => {
    const n = Number(enUnitesExactes(v, decimales));
    if (!Number.isSafeInteger(n))
      throw new Error("Montant trop grand pour être normalisé sans perte.");
    return n;
  };
  const groupes = new Map<number, { baseHt: string; majorationTva: string }>();
  for (const l of lignes) {
    const g = groupes.get(l.index) ?? { baseHt: "0", majorationTva: "0" };
    groupes.set(l.index, {
      baseHt: D(g.baseHt).plus(l.baseHt).toString(),
      majorationTva: D(g.majorationTva).plus(l.majorationTva).toString(),
    });
  }
  for (const d of lignes.flatMap((l) => l.droits))
    droits.set(d.code, toFixedStr(D(droits.get(d.code) ?? 0).plus(d.montant), decimales));
  return {
    bases: [...groupes]
      .sort(([a], [b]) => a - b)
      .map(([, l]) => ({ attendu: mineur(l.baseHt), majoration: mineur(l.majorationTva) })),
    droits,
    somme: toFixedStr(sum(droits.values()), decimales),
  };
}

export async function contexteQualificationFiscale(db: Requete, pieceId: string) {
  const c = await contexteFiscalQualifie(db, pieceId);
  const { rows: analyses } = await db.query<{
    normalisation: import("./normaliser-montants.ts").ResultatNormalisation;
  }>(
    `select normalisation from capture.analyses where piece_id=$1 and extraction_id=$2 order by created_at desc limit 1`,
    [pieceId, c.extraction_id],
  );
  const n = analyses[0]?.normalisation;
  const comptes = await comptesDeCout(db, c);
  return {
    extractionId: c.extraction_id,
    profilVersionId: c.profil?.id ?? null,
    documentKind: c.kind as "facture_achat" | "facture_vente",
    dateLue: (c.payload["document_date"] as string | null) ?? null,
    decimales: c.decimales,
    prorata: c.prorata,
    regimeTva: c.regimeTva,
    qualification: await lireQualificationFiscale(db, pieceId),
    comptes,
    lignes: (c.payload["lines"] as Array<{ label: string; tax_code: string }>).map((l, i) => ({
      index: i,
      libelle: l.label,
      codeTva: l.tax_code,
      htLu: n?.imprime.bases[i] ?? null,
      baseProposee:
        n?.montants.bases[i]?.ht == null
          ? null
          : toFixedStr(D(n.montants.bases[i]!.ht!).div(D(10).pow(c.decimales)), c.decimales),
    })),
    droits: c.droits
      .filter((d) => d.documentKind === c.kind && d.rate != null)
      .map((d) => ({
        code: d.code,
        libelle: d.label,
        taux: d.rate!,
        referenceLegale: d.legalReference ?? "",
        taxable: d.taxable ?? false,
      })),
  };
}

async function comptesDeCout(db: Requete, c: Awaited<ReturnType<typeof contexteFiscalQualifie>>) {
  const { rows } = await db.query<{ code: string; libelle: string }>(
    `
  with comptes as (
    select null::uuid as tenant_id,account_code,label,account_class from ref.accounts where pack_version_id=$5
    union all select tenant_id,account_code,label,account_class from parametrage.accounts
  )
  select distinct on(pc.account_code) pc.account_code as code,pc.label as libelle from comptes pc
  where pc.account_class::text in(select account_class from ref.fiscal_cost_classes where jurisdiction=$2 and document_kind=$3 and valid_from<=$4::date and (valid_to is null or valid_to>$4::date))
   and (pc.tenant_id is null or pc.tenant_id=$1 or pc.tenant_id in(select cabinet_org_id from identity.engagements where pme_org_id=$1 and status='actif' and starts_on<=current_date and (ends_on is null or ends_on>=current_date)))
  order by pc.account_code,(pc.tenant_id=$1) desc nulls last,(pc.tenant_id is not null) desc`,
    [c.tenant_id, c.jurisdiction, c.kind, c.date, c.pack_id],
  );
  return rows;
}
