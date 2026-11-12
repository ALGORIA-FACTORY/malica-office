-- La ligne de charge porte le code taxe de sa TVA, dans l'export (recette du
-- 11 novembre 2026, point 2.7, rouvert).
--
-- Relevé : dans le fichier des écritures, le code taxe était rempli sur la
-- ligne de TVA et vide sur la ligne de charge, sa base. Une première
-- correction l'avait posé dans les PROPOSITIONS du Socle : elle faisait juger
-- fausses des écritures justes dans les jeux de référence, et a été annulée.
--
-- La correction vit donc à la lecture : quand les lignes codées d'une écriture
-- portent un seul code taxe, toutes du même côté, chaque ligne sans code de ce
-- côté — hors droit du pack (`ref.fiscal_charges`) et hors compte de TVA
-- (`ref.account_mappings`) — sort avec ce code. Plusieurs codes : la base
-- reste sans code, rien n'est deviné. Aucune ligne inscrite n'est réécrite (R7).
--
-- Même signature, même type rendu : `create or replace`, droits inchangés.
-- REJEU (R11) : rejouable tel quel.

begin;

create or replace function public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
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
           -- La base porte le code de sa TVA quand l'écriture n'en a qu'un : la
           -- ligne inscrite reste telle qu'elle est (R7), seul l'export le dit.
           -- Plusieurs codes : rien n'est deviné, la base reste sans code.
           coalesce(
             l.tax_code,
             case when tx.code is not null
                   and ((tx.au_debit and l.debit::numeric > 0)
                        or (tx.au_credit and l.credit::numeric > 0))
                   and not exists (
                         select 1 from ref.fiscal_charges fc
                          where fc.pack_version_id = e.pack_version_id
                            and fc.account_code = l.account_code)
                   and not exists (
                         select 1 from ref.account_mappings va
                          where va.pack_version_id = e.pack_version_id
                            and va.vat_account = l.account_code)
                  then tx.code end),
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
      -- Le code taxe de l'écriture, s'il est unique, et le côté de ses lignes.
      left join lateral (
             select min(lt.tax_code) as code,
                    bool_and(lt.debit::numeric > 0) as au_debit,
                    bool_and(lt.credit::numeric > 0) as au_credit
               from socle.ecriture_lignes lt
              where lt.tenant_id = e.tenant_id and lt.ecriture_id = e.id
                and lt.tax_code is not null
             having count(distinct lt.tax_code) = 1) tx on true
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
