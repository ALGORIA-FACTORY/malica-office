\set ON_ERROR_STOP on
\echo '=== LES QUATRE VERROUS DE MALICA ==='
do $$
declare u uuid := gen_random_uuid(); org uuid; r jsonb;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', u::text, true);
  insert into identity.profiles(user_id, display_name, locale) values (u,'Testeur','fr');
  insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
    values ('pme','NOTIF ESSAI','TN','TND',u) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,u,'dirigeant');
  insert into collab.push_devices(tenant_id,user_id,platform,token)
    values (org,u,'android','jeton-'||u::text);
  insert into notif.preferences(user_id, silence_de, silence_a)
    values (u, time '23:59', time '00:01') on conflict (user_id) do update
      set silence_de = time '23:59', silence_a = time '00:01';

  r := notif.poster(u,'plafond.atteint','lic-oct',
        '{"droit":"65","offre_suivante":"Solo"}'::jsonb, org,'push');
  raise notice '1er envoi      : poste=% motif=%', r->>'poste', coalesce(r->>'motif','—');
  perform notif.remettre((r->>'envoi_id')::uuid, 'remis');

  r := notif.poster(u,'plafond.atteint','lic-oct',
        '{"droit":"65","offre_suivante":"Solo"}'::jsonb, org,'push');
  raise notice '2e, meme sujet : poste=% motif=%  <- la promesse « une fois »',
    r->>'poste', coalesce(r->>'motif','—');

  r := notif.poster(u,'plafond.atteint','lic-nov',
        '{"droit":"65","offre_suivante":"Solo"}'::jsonb, org,'push');
  raise notice 'autre mois     : poste=% motif=%', r->>'poste', coalesce(r->>'motif','—');

  -- verrou silence : fenetre ouverte toute la journee
  update notif.preferences set silence_de=time '00:00', silence_a=time '23:59' where user_id=u;
  r := notif.poster(u,'echeance.approche','tva-oct',
        '{"date":"28 octobre","pieces":"7"}'::jsonb, org,'push');
  raise notice 'pendant silence: poste=% motif=%', r->>'poste', coalesce(r->>'motif','—');
  raise notice '  mais le centre de notifications, lui, a recu : % ligne(s)',
    (select count(*) from collab.notifications where user_id=u and kind='echeance.approche');

  -- verrou cadence
  update notif.preferences set silence_de=time '23:59', silence_a=time '00:01',
                               cadence='jamais' where user_id=u;
  r := notif.poster(u,'cabinet.a_repondu','fil-12',
        '{"cabinet":"Cabinet Chaouech","resume":"La TVA est deductible."}'::jsonb, org,'push');
  raise notice 'cadence jamais : poste=% motif=%', r->>'poste', coalesce(r->>'motif','—');

  -- verrou droit : un siege revoque
  update notif.preferences set cadence='matin' where user_id=u;
  delete from identity.memberships where tenant_id=org and user_id=u;
  r := notif.poster(u,'piece.a_valider','lot-3',
        '{"auteur":"Leila","pieces":"2"}'::jsonb, org,'push');
  raise notice 'siege revoque  : poste=% motif=%', r->>'poste', coalesce(r->>'motif','—');

  -- le texte rendu est fige, jetons substitues
  raise notice 'etat deduit    : % (tentatives : %)',
    (select etat from notif.envois_v where destinataire=u and sujet_cle='lic-oct' limit 1),
    (select tentatives from notif.envois_v where destinataire=u and sujet_cle='lic-oct' limit 1);
  raise notice 'texte rendu    : « % »',
    (select corps_rendu from notif.envois where destinataire=u and sujet_cle='lic-oct' limit 1);
end $$;
