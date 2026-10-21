-- Le FEC du cabinet : ce qui lui a été transmis, validé quand il l'a validé
-- (21 octobre 2026).
--
-- Campagne de validation du 21 octobre, ANO-007 (TF-003, FC-009, B-013).
--   1. Une pièce gardée par la société (« votre comptabilité ne la voit
--      pas ») figurait au FEC du cabinet : `export_lignes_lire` est
--      `security definer` et lisait toutes les écritures comptabilisées du
--      dossier. Il ne lit plus que les écritures transmises (`vis = partage`),
--      celles que le cabinet voit — la visibilité suit désormais la pièce
--      (migration 20261022450000).
--   2. `ValidDate` portait la date de COMPTABILISATION : une écriture jamais
--      supervisée paraissait validée. C'est maintenant la date de
--      supervision (`reviewed_at` d'un « valide »), vide sinon ; une
--      contre-passation est validée à son inscription.
--
-- Corps repris de 20261022310000 ; seules ces deux lignes changent.
-- REJEU (R11) : `create or replace` (même signature, même type de retour).

begin;

create or replace function public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
returns table(client_tenant_id uuid, client_nom text, client_legal_id text, ecriture_id uuid,
              numero bigint, journal text, journal_libelle text, date_ecriture date,
              ordinal smallint, compte text, compte_libelle text, piece_ref text,
              piece_date date, ecriture_libelle text, ligne_libelle text, debit numeric,
              credit numeric, tax_code text, valide_le date, devise text,
              pack_version_id uuid, tiers_num text, tiers_lib text)
language plpgsql
stable security definer
set search_path = ''
as $function$
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
               where x.piece_id = e.piece_id and x.contract = 'extract.v1'
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
                then coalesce(nullif(t.lib, ''), t.num) end
      from socle.ecritures e
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      join identity.organizations o on o.id = e.tenant_id
      left join ref.journals j on j.code = e.journal
      left join capture.pieces p on p.id = e.piece_id
      left join lateral (
             select x.payload from capture.extractions x
              where x.piece_id = e.piece_id and x.contract = 'extract.v1'
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
                         then null else btrim(xp.payload ->> 'issuer') end as lib
           ) t on true
     where e.status = 'booked'
       -- Ce que la société n'a pas transmis n'est pas au cabinet (ANO-007).
       and e.vis = 'partage'::app.vis_t
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $function$;

revoke all on function public.export_lignes_lire(uuid, uuid, date, date) from public;
grant execute on function public.export_lignes_lire(uuid, uuid, date, date) to authenticated;

commit;
