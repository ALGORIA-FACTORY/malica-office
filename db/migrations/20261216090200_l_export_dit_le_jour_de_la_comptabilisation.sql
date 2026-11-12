-- L'export dit le jour où chaque écriture est comptabilisée (recette du
-- 11 novembre 2026, point 2.7).
--
-- Relevé : dans le CSV des écritures, « comptabilisee_le » était vide. La
-- colonne portait la date de SUPERVISION (`valide_le`, ANO-007), vide tant
-- que la comptabilité n'a pas validé — une écriture forcée, ou inscrite sans
-- revue, sortait donc sans date. `export_lignes_lire` rend désormais aussi le
-- jour de l'inscription au journal (`booked_at`) ; le CSV met chaque date sous
-- son nom (`comptabilisee_le`, puis `validee_le`).
--
-- Une colonne s'ajoute au type rendu : la fonction se supprime et se recrée,
-- avec ses droits. Corps repris tel qu'en base ; seule la colonne s'ajoute.
-- REJEU (R11) : `drop function if exists`, puis création.

begin;

drop function if exists public.export_lignes_lire(uuid, uuid, date, date);

create function public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
 RETURNS TABLE(client_tenant_id uuid, client_nom text, client_legal_id text, ecriture_id uuid, numero bigint, journal text, journal_libelle text, date_ecriture date, ordinal smallint, compte text, compte_libelle text, piece_ref text, piece_date date, ecriture_libelle text, ligne_libelle text, debit numeric, credit numeric, tax_code text, valide_le date, devise text, pack_version_id uuid, tiers_num text, tiers_lib text, comptabilisee_le date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin
  return query
    select e.tenant_id,
           o.name,
           o.legal_id,
           e.id,
           dense_rank() over (partition by e.tenant_id, e.journal
                              order by e.date_ecriture, e.booked_at, e.id),
           e.journal,
           coalesce(j.libelle, e.journal),
           e.date_ecriture,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = e.pack_version_id and ra.account_code = l.account_code),
             ''),
           coalesce(
             (select r.valeur
                from capture.extractions x
                cross join lateral jsonb_each_text(coalesce(x.payload -> 'references', '{}'::jsonb))
                     as r(cle, valeur)
               where x.piece_id = c.id and x.contract = 'extract.v1'
                 and length(btrim(r.valeur)) > 0
               order by x.created_at desc,
                        (r.cle ~* 'invoice|facture|numero|number') desc,
                        r.cle
               limit 1),
             ''),
           coalesce(
             (case when xp.payload ->> 'document_date' ~ '^\d{4}-\d{2}-\d{2}$'
                   then (xp.payload ->> 'document_date')::date end),
             p.created_at::date,
             e.date_ecriture),
           e.libelle,
           l.libelle,
           l.debit::numeric,
           l.credit::numeric,
           l.tax_code,
           -- ValidDate : la SUPERVISION, pas la comptabilisation (ANO-007).
           -- Une contre-passation est l'acte même du cabinet : elle est
           -- validée à son inscription. Sinon, vide tant que non validée.
           case when e.reverses_id is not null then e.booked_at::date
                when e.review_outcome = 'valide' then e.reviewed_at::date end,
           e.devise,
           e.pack_version_id,
           case when l.account_code = cp.counterparty_account then t.num end,
           case when l.account_code = cp.counterparty_account and t.num is not null
                then coalesce(nullif(t.lib, ''), t.num) end,
           -- Le jour où l'écriture est entrée au journal : c'est la colonne
           -- « comptabilisee_le » de l'export (recette du 11 novembre 2026).
           e.booked_at::date
      from socle.ecritures e
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      join identity.organizations o on o.id = e.tenant_id
      left join ref.journals j on j.code = e.journal
      -- La pièce telle que sa version courante la dit : un règlement saisi
      -- sur une photo reprise garde son écriture sur l'ancienne (le fait).
      cross join lateral (select app.version_courante(e.piece_id) as id) c
      left join capture.pieces p on p.id = c.id
      left join lateral (
             select x.payload from capture.extractions x
              where x.piece_id = c.id and x.contract = 'extract.v1'
              order by x.created_at desc limit 1) xp on true
      left join lateral (
             select mm.counterparty_account from ref.account_mappings mm
              where mm.pack_version_id = e.pack_version_id and mm.document_kind = p.document_kind
              order by mm.counterparty_account limit 1) cp on true
      left join lateral (
             select nullif(upper(regexp_replace(
                      coalesce(xp.payload -> 'references' ->> 'matricule_fiscal', ''), '\s', '', 'g')), '') as emetteur,
                    nullif(upper(regexp_replace(
                      coalesce(xp.payload -> 'references' ->> 'matricule_fiscal_client', ''), '\s', '', 'g')), '') as client
           ) mf on true
      left join lateral (
             select case when mf.emetteur is not null and mf.emetteur = upper(o.legal_id)
                         then mf.client else mf.emetteur end as num,
                    case when mf.emetteur is not null and mf.emetteur = upper(o.legal_id)
                         then null else btrim(coalesce(app.emetteur_dit(c.id), xp.payload ->> 'issuer')) end as lib
           ) t on true
     where e.status = 'booked'
       -- Ce que la société n'a pas transmis n'est pas au cabinet (ANO-007).
       and e.vis = 'partage'::app.vis_t
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $function$;

revoke all on function public.export_lignes_lire(uuid, uuid, date, date) from public, anon;
grant execute on function public.export_lignes_lire(uuid, uuid, date, date) to authenticated;

commit;
