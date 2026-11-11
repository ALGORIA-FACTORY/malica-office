-- La tour de contrôle de la plateforme — ce qu'elle voit, et ce qu'elle ne voit pas.
--
-- Script de vérification de la livraison, joué à la main dans psql sur une base de
-- recette, jamais en production : il crée ses propres utilisateurs, une organisation
-- et une licence d'essai (identifiants tirés au hasard), puis affiche ce qu'il constate.
-- Il ne contient aucune assertion automatique ; c'est une personne qui lit la sortie.
--
-- Quatre étapes, dans l'ordre :
--   1. un opérateur de la plateforme, connecté comme un utilisateur ordinaire (rôle
--      `authenticated`), compte les pièces du client qu'il peut lire, et les clients
--      qu'il voit dans la tour (`plateforme.clients_v`) ;
--   2. suspension, supplément de lectures et reprise d'une licence, avec leurs motifs ;
--   3. une réquisition d'une autorité : refusée tant qu'une seconde signature manque,
--      puis servie sous forme d'inventaire de métadonnées (empreinte, sans contenu) ;
--   4. l'émission d'une facture, son encours avant et après encaissement, le flux du mois.
--
-- Les tables et fonctions appelées sont celles des schémas `plateforme`, `facturation`,
-- `capture` et `identity` ; le script ne remplace aucune règle, il les exerce (R6 : c'est
-- la base, pas l'application, qui porte l'isolation).
\set ON_ERROR_STOP on
\echo '=== LA TOUR : CE QU ELLE VOIT, ET CE QU ELLE NE VOIT PAS ==='
do $$
declare
  op uuid := gen_random_uuid(); op2 uuid := gen_random_uuid();
  cl uuid := gen_random_uuid(); org uuid; lic uuid; p uuid; r jsonb; req uuid;
begin
  insert into auth.users(id) values (op),(op2),(cl) on conflict do nothing;
  insert into app.platform_operators(user_id) values (op),(op2) on conflict do nothing;
  insert into identity.profiles(user_id, display_name) values (cl,'Client Essai');
  perform set_config('request.jwt.claim.sub', cl::text, true);
  insert into identity.organizations(kind,name,jurisdiction,currency,created_by)
    values ('pme','TOUR ESSAI','TN','TND',cl) returning id into org;
  insert into identity.memberships(tenant_id,user_id,role) values (org,cl,'dirigeant');
  insert into facturation.licences(titulaire,offre_code,offre_depuis)
    values (cl,'solo',date '2026-10-17') returning id into lic;
  insert into facturation.licence_organisations(licence_id,tenant_id) values (lic,org);
  insert into capture.pieces(tenant_id,vis,source,storage_path,sha256,status,idempotency_key,created_by)
    values (org,'partage','photo','t/1.jpg',repeat('a',64),'capturee','t1',cl) returning id into p;
  perform set_config('verif.op',op::text,false); perform set_config('verif.op2',op2::text,false);
  perform set_config('verif.lic',lic::text,false); perform set_config('verif.org',org::text,false);
end $$;

\echo '--- 1. un opérateur ALGORIA lit-il les pièces du client ?'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verif.op'), true) \gset
select 'pieces vues par la plateforme' as quoi, count(*) as n from capture.pieces
 where tenant_id = current_setting('verif.org')::uuid;
select 'clients vus dans la tour' as quoi, count(*) as n from plateforme.clients_v
 where licence_id = current_setting('verif.lic')::uuid;
rollback;

\echo '--- 2. suspension, supplément, reprise'
do $$
declare r jsonb; lic uuid := current_setting('verif.lic')::uuid;
begin
  perform set_config('request.jwt.claim.sub', current_setting('verif.op'), true);
  r := plateforme.suspendre(lic, 'impayé de la facture ALG-202609-00001', 'deux relances, un appel');
  raise notice 'suspendue      : %', r;
  r := public.lecture_autorisee((select id from capture.pieces where storage_path='t/1.jpg' and tenant_id=current_setting('verif.org')::uuid));
  raise notice 'lecture pendant : autorisee=% motif=%', r->>'autorisee', r->>'motif';
  r := plateforme.accorder_lectures(lic, 80, 'geste commercial, gros mois de septembre');
  raise notice 'supplement     : %', r;
  r := plateforme.reprendre(lic, 'facture réglée par virement');
  raise notice 'reprise        : %', r;
  raise notice 'droit total    : % (forfait % + supplement %)',
    (select lectures_droit from facturation.consommation_v where licence_id=lic),
    (select lectures_forfait from facturation.consommation_v where licence_id=lic),
    (select lectures_supplement from facturation.consommation_v where licence_id=lic);
end $$;

\echo '--- 3. réquisition : deux signatures, puis l inventaire sans contenu'
do $$
declare req uuid; r jsonb; org uuid := current_setting('verif.org')::uuid;
begin
  perform set_config('request.jwt.claim.sub', current_setting('verif.op'), true);
  insert into plateforme.requisitions(tenant_id,autorite,reference,portee,motif,close_le)
    values (org,'recette_des_finances','RF-2026-8841','metadonnees',
            'contrôle de TVA 2026', now()+interval '30 days') returning id into req;
  begin
    r := plateforme.servir_requisition(req);
    raise notice 'ECHEC : servie sans seconde signature';
  exception when check_violation then
    raise notice 'OK  refus sans seconde signature : %', sqlerrm;
  end;
  update plateforme.requisitions
     set approuve_par = current_setting('verif.op2')::uuid, approuve_le = now()
   where id = req;
  r := plateforme.servir_requisition(req);
  raise notice 'OK  servie : % piece(s), contenu inclus = %, empreinte rendue = %',
    r->>'pieces', r->>'contenu_inclus',
    left((r->'inventaire'->0->>'empreinte'), 12) || '…';
end $$;

\echo '--- 4. facture, encours, flux'
do $$
declare r jsonb; lic uuid := current_setting('verif.lic')::uuid; f uuid;
begin
  perform set_config('request.jwt.claim.sub', current_setting('verif.op'), true);
  r := facturation.emettre(lic, date_trunc('month',current_date)::date);
  f := (r->>'facture_id')::uuid;
  raise notice 'facture        : % — % TND TTC', r->>'numero', r->>'ttc';
  raise notice 'encours        : etat=% reste=%',
    (select etat from facturation.encours_v where facture_id=f),
    (select reste_du from facturation.encours_v where facture_id=f);
  insert into facturation.encaissements(facture_id,montant,moyen,encaisse_le)
    values (f,(r->>'ttc')::numeric,'virement',current_date);
  raise notice 'apres paiement : etat=% reste=%',
    (select etat from facturation.encours_v where facture_id=f),
    (select reste_du from facturation.encours_v where facture_id=f);
  raise notice 'flux du mois   : facture=% encaisse=% ecart=%',
    (select facture_ttc from facturation.flux_mensuel_v where mois=date_trunc('month',current_date)::date),
    (select encaisse    from facturation.flux_mensuel_v where mois=date_trunc('month',current_date)::date),
    (select ecart       from facturation.flux_mensuel_v where mois=date_trunc('month',current_date)::date);
end $$;
