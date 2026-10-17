\set ON_ERROR_STOP on
\echo '=== ESPACE PRIVE : AVANT / APRES, ET LE QUOTA ==='
do $$
declare d uuid := gen_random_uuid(); s uuid := gen_random_uuid(); org uuid; lic uuid; p uuid;
begin
  insert into auth.users(id) values (d),(s) on conflict do nothing;
  insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
    values ('pme','TEST PRIVE','TN','TND',d) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,d,'dirigeant'),(org,s,'collaborateur');
  insert into facturation.licences(titulaire,offre_code,offre_depuis)
    values (d,'team',date '2026-10-17') returning id into lic;
  insert into facturation.licence_organisations(licence_id,tenant_id) values (lic,org);
  -- le siege photographie une ordonnance, et la garde pour lui
  insert into capture.pieces(tenant_id,vis,source,storage_path,status,idempotency_key,created_by)
    values (org,'personnel','photo','x/ordo.jpg','capturee','ordo',s) returning id into p;
  insert into capture.extractions(tenant_id,piece_id,contract,payload)
    values (org,p,'v1','{"montant":"42,000"}'::jsonb);
  perform set_config('verif.d',d::text,false); perform set_config('verif.s',s::text,false);
  perform set_config('verif.lic',lic::text,false); perform set_config('verif.org',org::text,false);
end $$;

\echo '--- le dirigeant regarde la piece personnelle de son collaborateur'
begin;
-- AVANT : la politique telle qu elle est dans le depot
drop policy capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces for select to authenticated
  using ((tenant_id in (select app.member_orgs()))
      or (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))
      or (select app.is_platform()));
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verif.d'), true) \gset
select 'AVANT (depot actuel)' as quand, count(*) as pieces_vues,
       (select count(*) from capture.extractions) as lectures_vues
  from capture.pieces where storage_path='x/ordo.jpg';
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verif.d'), true) \gset
select 'APRES (correctif)' as quand, count(*) as pieces_vues,
       (select count(*) from capture.extractions) as lectures_vues
  from capture.pieces where storage_path='x/ordo.jpg';
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verif.s'), true) \gset
select 'APRES, son auteur' as quand, count(*) as pieces_vues
  from capture.pieces where storage_path='x/ordo.jpg';
rollback;

\echo '--- le quota : une piece personnelle ne se lit pas, une piece transmise si'
select (public.lecture_autorisee((select id from capture.pieces where storage_path='x/ordo.jpg')))->>'motif' as personnelle;
