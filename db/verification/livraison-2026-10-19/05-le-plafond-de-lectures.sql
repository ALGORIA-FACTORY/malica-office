\set ON_ERROR_STOP on
\echo '=== LE PLAFOND DE LECTURES MORD, ET LA RELECTURE EST GRATUITE ==='
do $$
declare u uuid := gen_random_uuid(); org uuid; lic uuid; p uuid; q uuid; v jsonb;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', u::text, true);
  insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
    values ('pme','TEST QUOTA','TN','TND',u) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,u,'dirigeant');
  insert into facturation.licences(titulaire,offre_code,offre_depuis)
    values (u,'basic',date '2026-10-17') returning id into lic;
  insert into facturation.licence_organisations(licence_id,tenant_id) values (lic,org);

  -- 64 pieces transmises et lues, sur les 65 du forfait Basic
  for i in 1..64 loop
    insert into capture.pieces(tenant_id,vis,source,storage_path,status,idempotency_key,created_by)
      values (org,'partage','photo','q/'||i,'lue','q'||i,u) returning id into p;
    insert into facturation.lectures(tenant_id,licence_id,piece_id,periode)
      values (org,lic,p,date_trunc('month',current_date)::date);
  end loop;

  -- la 65e
  insert into capture.pieces(tenant_id,vis,source,storage_path,status,idempotency_key,created_by)
    values (org,'partage','photo','q/65','capturee','q65',u) returning id into p;
  v := public.lecture_autorisee(p);
  raise notice '65e piece  -> autorisee=%  motif=%  restantes=%',
    v->>'autorisee', v->>'motif', v->>'restantes';
  perform public.lecture_consommer(p);

  -- la 66e
  insert into capture.pieces(tenant_id,vis,source,storage_path,status,idempotency_key,created_by)
    values (org,'partage','photo','q/66','capturee','q66',u) returning id into q;
  v := public.lecture_autorisee(q);
  raise notice '66e piece  -> autorisee=%  motif=%  restantes=%',
    v->>'autorisee', v->>'motif', v->>'restantes';

  -- relire la 65e, deja comptee
  v := public.lecture_autorisee(p);
  raise notice 'relecture  -> autorisee=%  motif=%  restantes=%',
    v->>'autorisee', v->>'motif', v->>'restantes';

  -- et la capture, elle, reste ouverte : la 66e existe bien, non lue
  raise notice 'pieces en base = % , dont lues = %',
    (select count(*) from capture.pieces where tenant_id=org),
    (select count(*) from facturation.lectures where licence_id=lic);
end $$;
