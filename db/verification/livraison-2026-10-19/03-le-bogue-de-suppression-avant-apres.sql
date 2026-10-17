\set ON_ERROR_STOP on
\echo '=== LE BOGUE DE SUPPRESSION : AVANT / APRES ==='
do $$
declare u uuid := gen_random_uuid(); org uuid; lic uuid; p uuid;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
    values ('pme','TEST SUPPR','TN','TND',u) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,u,'dirigeant');
  insert into facturation.licences(titulaire,offre_code,offre_depuis)
    values (u,'solo',date '2026-10-17') returning id into lic;
  insert into facturation.licence_organisations(licence_id,tenant_id) values (lic,org);
  insert into capture.pieces(tenant_id,vis,source,storage_path,status,idempotency_key,created_by)
    values (org,'personnel','photo','x/1.jpg','capturee','k1',u) returning id into p;
  insert into capture.paiements(tenant_id,piece_id,moyen_code,pack_version_id,devise)
    select org,p,'especes',(select id from ref.jurisdiction_packs limit 1),'TND';
  perform set_config('verif.u',u::text,false); perform set_config('verif.p',p::text,false);
  perform set_config('verif.org',org::text,false);
  raise notice 'piece personnelle/capturee avec 1 paiement : prete';
end $$;

-- AVANT : on remet le garde STRICT tel qu'il est aujourd'hui dans le depot
begin;
drop trigger capture_paiements_no_upd on capture.paiements;
create trigger capture_paiements_no_upd before delete or update on capture.paiements
  for each row execute function app.deny_mutation();
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verif.u'), true);
do $$ begin
  perform public.capture_piece_supprimer(current_setting('verif.p')::uuid);
  raise notice 'AVANT : la suppression a reussi (inattendu)';
exception when others then
  raise notice 'AVANT (depot actuel) : REFUS -> %', sqlerrm;
end $$;
rollback;

-- APRES : le garde corrige du 18 octobre
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verif.u'), true);
do $$ begin
  perform public.capture_piece_supprimer(current_setting('verif.p')::uuid);
  raise notice 'APRES (correctif) : la piece est supprimee';
exception when others then
  raise notice 'APRES : REFUS -> %', sqlerrm;
end $$;
rollback;
