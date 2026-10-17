\set ON_ERROR_STOP on
\echo '=== LES CINQ SCENARIOS PUBLIES DU 17 OCTOBRE ==='
do $$
declare
  cas text[][] := array[
    ['team','1','4','45.000','210'], ['team','1','6','61.000','260'],
    ['team','1','10','93.000','360'],['premium','2','5','57.000','265'],
    ['premium','3','8','110.000','460']];
  i int; u uuid; org uuid; lic uuid; c uuid;
  nb_org int; nb_s int; prix numeric; lect int; att_p numeric; att_l int;
begin
  for i in 1..array_length(cas,1) loop
    nb_org := cas[i][2]::int; nb_s := cas[i][3]::int;
    att_p := cas[i][4]::numeric; att_l := cas[i][5]::int;
    u := gen_random_uuid();
    insert into auth.users(id) values (u) on conflict do nothing;
    insert into facturation.licences(titulaire, offre_code, offre_depuis)
      values (u, cas[i][1], date '2026-10-17') returning id into lic;
    for j in 1..nb_org loop
      insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
        values ('pme','SOC '||i||'-'||j,'TN','TND',u) returning id into org;
      insert into identity.memberships(tenant_id,user_id,role) values (org,u,'dirigeant');
      insert into facturation.licence_organisations(licence_id,tenant_id) values (lic,org);
      if j = 1 then
        for k in 1..nb_s loop
          c := gen_random_uuid();
          insert into auth.users(id) values (c) on conflict do nothing;
          insert into identity.memberships(tenant_id,user_id,role) values (org,c,'collaborateur');
        end loop;
      end if;
    end loop;
    select prix_mensuel_ht, lectures_droit into prix, lect
      from facturation.droits_v where licence_id = lic;
    raise notice '% : % org, % sieges -> % DT / % lectures   [attendu % / %]  %',
      rpad(cas[i][1],8), nb_org, nb_s, prix, lect, att_p, att_l,
      case when prix = att_p and lect = att_l then 'OK' else '*** ECART ***' end;
  end loop;
end $$;
