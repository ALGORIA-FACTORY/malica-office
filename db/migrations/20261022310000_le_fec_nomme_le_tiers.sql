-- Le FEC nomme le tiers (20 octobre 2026).
--
-- Recette de la comptabilité : `CompAuxNum` et `CompAuxLib` étaient vides sur
-- les lignes 401 et 411. Un FEC sans compte auxiliaire ne permet pas de
-- suivre un fournisseur ou un client, et un contrôle le relève.
--
-- Le tiers d'une écriture est sur sa pièce : l'émetteur pour un achat, le
-- destinataire pour une vente. Le Socle ne porte pas encore de tiers sur la
-- ligne ; on le lit donc sur la DERNIÈRE lecture de la pièce, et seulement
-- sur la ligne de CONTREPARTIE — le compte que le paramétrage
-- (`ref.account_mappings`) donne comme contrepartie pour ce type de pièce.
--
-- Le sens se juge sans liste écrite ici : si l'émetteur porte le matricule de
-- la société, c'est une vente, et le tiers est le client (son matricule) ;
-- sinon c'est un achat, et le tiers est l'émetteur (son matricule, son nom).
-- Sans matricule lu, la colonne reste vide : un fichier légal n'invente pas.
--
-- `ValidDate` reste la date de COMPTABILISATION (`booked_at`) : une écriture
-- inscrite est validée, qu'elle le soit par la PME autonome ou par l'expert.
--
-- Le type de retour change : `drop` puis `create`, droits remis à l'identique.
-- REJEU (R11) : `drop function if exists`.

begin;

drop function if exists public.export_lignes_lire(uuid, uuid, date, date);

create function public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
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
           coalesce(e.booked_at::date, e.date_ecriture),
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
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $function$;

revoke all on function public.export_lignes_lire(uuid, uuid, date, date) from public;
grant execute on function public.export_lignes_lire(uuid, uuid, date, date) to authenticated;

commit;
