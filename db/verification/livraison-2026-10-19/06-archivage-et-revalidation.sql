\set ON_ERROR_STOP on
\echo '=== ARCHIVAGE D UN ETABLISSEMENT, ET REVALIDATION ==='
do $$
declare u uuid := gen_random_uuid(); org uuid; e1 uuid; e2 uuid; p uuid; r jsonb;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', u::text, true);
  insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
    values ('pme','TEST ARCH','TN','TND',u) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,u,'dirigeant');
  insert into identity.entities(tenant_id,code,name,is_default)
    values (org,'SIEGE','Siège',true) returning id into e1;
  insert into identity.entities(tenant_id,code,name)
    values (org,'SOUSSE','Dépôt Sousse') returning id into e2;

  -- 1. le dernier ouvert ne se ferme pas
  begin
    perform public.etablissement_archiver(e1);
    perform public.etablissement_archiver(e2);
    raise notice 'ECHEC : le dernier etablissement a pu fermer';
  exception when check_violation then
    raise notice 'OK  le dernier ouvert refuse de fermer : %', sqlerrm;
  end;

  -- 2. un etablissement qui porte une piece en cours refuse, et dit combien
  insert into capture.pieces(tenant_id,entity_id,vis,source,storage_path,status,idempotency_key,created_by)
    values (org,e2,'personnel','photo','a/1.jpg','capturee','a1',u) returning id into p;
  r := public.etablissement_archiver(e2);
  raise notice 'OK  refus motive : archive=%  motif=%  pieces=%',
    r->>'archive', r->>'motif', r->>'pieces';

  -- 3. piece transmise puis comptabilisee -> on vide, et on archive
  delete from capture.pieces where id = p;
  r := public.etablissement_archiver(e2, 'fermeture du depot');
  raise notice 'OK  archive : %   | visible dans entities_v ? %',
    r->>'archive',
    (select count(*) from public.entities_v where id = e2);

  -- 4. la correction apres transmission
  insert into capture.pieces(tenant_id,entity_id,vis,source,storage_path,status,idempotency_key,created_by)
    values (org,e1,'partage','photo','b/1.jpg','lue','b1',u) returning id into p;
  r := public.piece_corriger_apres_transmission(p,'montant_ttc','2400,000');
  raise notice 'OK  corrigee : statut=%  (precision inscrite : %)',
    r->>'status', (select count(*) from capture.precisions where piece_id=p);

  -- 5. une piece comptabilisee refuse la correction directe
  update capture.pieces set status='comptabilisee' where id=p;
  begin
    perform public.piece_corriger_apres_transmission(p,'montant_ttc','9');
    raise notice 'ECHEC : une piece comptabilisee a ete corrigee';
  exception when check_violation then
    raise notice 'OK  comptabilisee : %', sqlerrm;
  end;
end $$;
