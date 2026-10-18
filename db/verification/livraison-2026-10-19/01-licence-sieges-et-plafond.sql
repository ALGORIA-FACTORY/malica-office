\set ON_ERROR_STOP on
-- ─────────── fixture : un dirigeant, une organisation, une licence Team ───────────
create extension if not exists pgcrypto;
do $$
declare u uuid := gen_random_uuid(); org uuid; lic uuid;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  insert into identity.profiles(user_id, display_name) values (u,'Wissem');
  insert into identity.organizations(id, kind, name, jurisdiction, currency, created_by)
    values (gen_random_uuid(),'pme','ATELIERS MEDINA','TN','TND',u) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,u,'dirigeant');
  insert into facturation.licences(titulaire, offre_code, offre_depuis)
    values (u,'team',date '2026-10-17') returning id into lic;
  insert into facturation.licence_organisations(licence_id, tenant_id) values (lic,org);
  perform set_config('verif.u',u::text,false);
  perform set_config('verif.org',org::text,false);
  perform set_config('verif.lic',lic::text,false);
end $$;

\echo '--- 1. DROITS D UNE LICENCE TEAM (0 siege) : attendu 160 lectures, 29 DT'
select offre_code, organisations, sieges_occupes, lectures_droit, prix_mensuel_ht
  from facturation.droits_v where licence_id = current_setting('verif.lic')::uuid;

\echo '--- 2. TROIS SIEGES AJOUTES : attendu 160 + 25 = 185 lectures, 29 + 8 = 37 DT'
do $$
declare org uuid := current_setting('verif.org')::uuid; c uuid;
begin
  for i in 1..3 loop
    c := gen_random_uuid();
    insert into auth.users(id) values (c) on conflict do nothing;
    insert into identity.memberships(tenant_id,user_id,role) values (org,c,'collaborateur');
  end loop;
end $$;
select sieges_occupes, lectures_droit, prix_mensuel_ht
  from facturation.droits_v where licence_id = current_setting('verif.lic')::uuid;

\echo '--- 3. LE PLAFOND DE SIEGES MORD : Team = 10 places, on tente la 11e'
do $$
declare org uuid := current_setting('verif.org')::uuid; c uuid;
begin
  for i in 4..10 loop
    c := gen_random_uuid();
    insert into auth.users(id) values (c) on conflict do nothing;
    insert into identity.memberships(tenant_id,user_id,role) values (org,c,'collaborateur');
  end loop;
  begin
    c := gen_random_uuid();
    insert into auth.users(id) values (c) on conflict do nothing;
    insert into identity.memberships(tenant_id,user_id,role) values (org,c,'collaborateur');
    raise notice 'ECHEC DU TEST : la 11e place est passee';
  exception when check_violation then
    raise notice 'OK  la 11e place est refusee : %', sqlerrm;
  end;
end $$;
