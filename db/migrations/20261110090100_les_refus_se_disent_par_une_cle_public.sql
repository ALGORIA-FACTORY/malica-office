-- Les refus se disent par une clé : les portes publiques (audit d'intégrité, 1er novembre 2026).
--
-- Ces fonctions levaient leur refus en français brut — « piece introuvable ou
-- non autorisee », « seul le proprietaire principal donne une place » — et la
-- frontière de l'API (`refus.ts`) le rendait tel quel : un utilisateur qui lit
-- l'arabe ou l'anglais le lisait en français. Elles lèvent désormais une CLÉ
-- du dictionnaire (`@malica/socle/messages`, en fr, en et ar), que l'écran dit
-- dans la langue de la personne ; les valeurs citées suivent la clé, encodées
-- par `app.refus_avec_valeurs` (migration 20261110090000).
--
-- Chaque fonction est recréée depuis sa définition EN VIGUEUR
-- (`pg_get_functiondef` d'une base migrée), seul le message changeant : même
-- corps, même `security definer`, même `set search_path`. `create or replace`
-- garde le propriétaire (le portier, lot 6) et les droits. Avant et après,
-- `prosecdef`, `proowner`, `proconfig` et les droits de chaque fonction ont
-- été relevés : identiques. Les messages restants que la frontière rend tels
-- quels sont tenus à zéro par `la-base-tient-son-integrite.test.ts`.

begin;

CREATE OR REPLACE FUNCTION public.acces_du_cabinet(p_cabinet uuid)
 RETURNS TABLE(acces_id uuid, client_tenant_id uuid, client_nom text, client_legal_id text, offre_code text, statut text, reference text, propose_le date, effet_du date, effet_au date, motif_fin text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return query
    select a.id, a.tenant_id, o.name, o.legal_id, a.offre_code, a.statut, a.reference,
           a.propose_le, a.effet_du, a.effet_au, a.motif_fin
      from facturation.acces a
      join identity.organizations o on o.id = a.tenant_id
     where a.cabinet_tenant_id = p_cabinet
     order by (a.statut = 'termine'), o.name, a.created_at desc;
end
$function$;

CREATE OR REPLACE FUNCTION public.acces_pour_moi(p_tenant uuid)
 RETURNS TABLE(acces_id uuid, cabinet_tenant_id uuid, cabinet_nom text, offre_code text, statut text, propose_le date, effet_du date, effet_au date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return query
    select a.id, a.cabinet_tenant_id, o.name, a.offre_code, a.statut, a.propose_le,
           a.effet_du, a.effet_au
      from facturation.acces a
      join identity.organizations o on o.id = a.cabinet_tenant_id
     where a.tenant_id = p_tenant and a.canal = 'cabinet'
     order by a.created_at desc;
end
$function$;

CREATE OR REPLACE FUNCTION public.acces_proposer(p_cabinet uuid, p_client uuid, p_offre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id    uuid;
  v_grille ref.offres;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '42501';
  end if;
  if exists (select 1 from facturation.acces a
              where a.tenant_id = p_client and a.statut in ('propose', 'actif', 'suspendu')) then
    raise exception 'refus.abonnement.deja_propose'
      using errcode = 'check_violation';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;

  insert into facturation.acces
    (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut, propose_le, propose_par)
  values
    (p_client, 'cabinet', p_cabinet, v_grille.code, v_grille.effective_from, 'propose',
     current_date, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_client, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('cabinet', p_cabinet, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_client, 'acces.propose',
          jsonb_build_object('acces_id', v_id, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.acces_repondre(p_acces uuid, p_accepte boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        facturation.acces;
  v_lic    uuid;
  v_rang_c smallint;
  v_rang_o smallint;
  v_offre  text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.statut <> 'propose' then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  if not app.has_org_role(v.tenant_id, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant'
      using errcode = '42501';
  end if;
  select lo.licence_id into v_lic
    from facturation.licence_organisations lo where lo.tenant_id = v.tenant_id;
  if v_lic is null then
    raise exception 'refus.licence.absente' using errcode = 'P0002';
  end if;

  if not p_accepte then
    update facturation.acces
       set statut = 'termine', licence_id = v_lic, effet_du = current_date,
           effet_au = current_date, motif_fin = 'refus_client',
           repondu_le = current_date, repondu_par = auth.uid()
     where id = p_acces;
  else
    update facturation.acces
       set statut = 'actif', licence_id = v_lic, effet_du = current_date,
           repondu_le = current_date, repondu_par = auth.uid()
     where id = p_acces;

    -- L'offre attribuée devient le forfait si elle est AU-DESSUS du forfait
    -- courant ; au-dessous, la PME garde le sien et paie la différence au-dessus
    -- du plancher couvert par le cabinet (`periodes_v`).
    select f.offre_code into v_offre
      from facturation.forfait_courant_v f where f.licence_id = v_lic;
    v_rang_c := (ref.offre_a(v_offre, current_date)).rang;
    v_rang_o := (ref.offre_a(v.offre_code, current_date)).rang;
    if v_rang_o > coalesce(v_rang_c, 0) then
      perform public.forfait_changer(v.offre_code, v.tenant_id, current_date);
    end if;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(),
          case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          'facturation', 'acces', p_acces, jsonb_build_object('cabinet', v.cabinet_tenant_id));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.cabinet_tenant_id, case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          jsonb_build_object('acces_id', p_acces, 'pme_org_id', v.tenant_id,
                             'client', (select name from identity.organizations where id = v.tenant_id),
                             'offre', v.offre_code));
  return jsonb_build_object('acces_id', p_acces,
                            'statut', case when p_accepte then 'actif' else 'termine' end);
end
$function$;

CREATE OR REPLACE FUNCTION public.agents_run_log(p_tenant uuid, p_agent text, p_model text, p_role text, p_status text, p_latency_ms integer, p_tokens_in integer DEFAULT NULL::integer, p_tokens_out integer DEFAULT NULL::integer, p_piece uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_in app.money_t := 0;
  v_out app.money_t := 0;
  v_cost app.cout_modele_t := 0;
  v_sov boolean := false;
  v_id uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  select price_in_per_mtok, price_out_per_mtok, sovereign
    into v_in, v_out, v_sov
    from agents.model_pricing
   where model = p_model and role = p_role
     and effective_from <= current_date
     and (effective_to is null or effective_to >= current_date)
   order by effective_from desc
   limit 1;

  if v_in is null then
    raise exception '%', app.refus_avec_valeurs('refus.ia.tarif_absent', 'modele', (p_model)::text, 'role', (p_role)::text)
      using errcode = 'check_violation';
  end if;

  v_cost := round(
    (coalesce(p_tokens_in, 0)::numeric / 1000000) * v_in
  + (coalesce(p_tokens_out, 0)::numeric / 1000000) * v_out, 8);

  insert into agents.agent_runs (tenant_id, piece_id, agent, model, sovereign, cost,
                                latency_ms, tokens_in, tokens_out, status, error)
  values (p_tenant, p_piece, p_agent, p_model, v_sov, v_cost,
          greatest(coalesce(p_latency_ms, 0), 0), p_tokens_in, p_tokens_out,
          p_status, p_error)
  returning id into v_id;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.analyse_poser(p_piece uuid, p_extraction uuid, p_pack uuid, p_normalisation jsonb, p_controles jsonb, p_verdict text, p_motifs jsonb, p_doublon_numero text, p_doublon_mf text, p_doublon_lu text, p_regles text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_id     uuid;
begin
  select p.tenant_id into v_tenant from public.pieces_v p where p.id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if not exists (select 1 from capture.extractions x
                  where x.id = p_extraction and x.piece_id = p_piece) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                normalisation, controles, verdict, motifs,
                                doublon_numero, doublon_mf, doublon_lu, regles)
  values (v_tenant, p_piece, p_extraction, p_pack, p_normalisation, p_controles, p_verdict,
          p_motifs, p_doublon_numero, p_doublon_mf, p_doublon_lu, p_regles)
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.analyse_verifier(p_analyse uuid, p_regles text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_n integer;
begin
  if nullif(btrim(p_regles), '') is null then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into capture.analyses_verifiees (tenant_id, piece_id, analyse_id, regles)
  select a.tenant_id, a.piece_id, a.id, p_regles
    from capture.analyses a where a.id = p_analyse
  on conflict (tenant_id, analyse_id, regles) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from capture.analyses a where a.id = p_analyse) then
    raise exception 'refus.introuvable.analyse' using errcode = '42501';
  end if;
  return v_n > 0;
end
$function$;

CREATE OR REPLACE FUNCTION public.annuel_souscrire(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_etat     jsonb := public.mon_annuel(p_tenant);
  v_licence  uuid;
  v_prop     jsonb;
  v_id       uuid;
  v_pid      uuid;
  f          record;
  v_ht       numeric;
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select l.id into v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where lo.tenant_id = p_tenant and l.titulaire = auth.uid();
  end if;
  if v_licence is null
     or not facturation.titulaire_de(v_licence)
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant'])) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if v_etat -> 'en_cours' <> 'null'::jsonb then
    raise exception '%', app.refus_avec_valeurs('refus.annuel.ferme', 'motif', 'deja_engage') using errcode = 'check_violation';
  end if;
  if v_etat ->> 'ferme' is not null then
    raise exception '%', app.refus_avec_valeurs('refus.annuel.ferme', 'motif', (v_etat ->> 'ferme')::text) using errcode = 'check_violation';
  end if;

  v_prop := v_etat -> 'proposition';
  insert into facturation.engagements_annuels
    (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
  values
    (v_licence, v_prop ->> 'offre', (v_prop ->> 'du')::date, (v_prop ->> 'au')::date,
     (v_prop ->> 'prix_mensuel_ht')::numeric, (v_prop ->> 'mois_offerts')::smallint,
     (v_prop ->> 'montant_ht')::numeric, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, auth.uid(), 'abonnement.annuel', 'facturation', 'engagements_annuels', v_id, v_prop
    from facturation.licence_organisations lo
   where lo.licence_id = v_licence
   order by lo.tenant_id limit 1;

  -- Le paiement : seulement s'il y a un émetteur (R4) ; sinon la facture du
  -- premier mois portera la ligne, et le paiement suivra la facture.
  if exists (select 1 from facturation.emetteurs e where e.valide_des <= current_date) then
    select * into f from facturation.fiscalite_en_vigueur(current_date);
    v_ht := (v_prop ->> 'montant_ht')::numeric;
    insert into facturation.paiements_en_ligne
      (licence_id, objet, engagement_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (v_licence, 'annuel', v_id,
       'Abonnement annuel ' || initcap(v_prop ->> 'offre') || ' — du '
         || to_char((v_prop ->> 'du')::date, 'DD/MM/YYYY') || ' au '
         || to_char((v_prop ->> 'au')::date, 'DD/MM/YYYY'),
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_pid;
  end if;

  return jsonb_build_object(
    'engagement', v_id,
    'paiement', (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_pid));
end
$function$;

CREATE OR REPLACE FUNCTION public.api_key_creer(p_tenant uuid, p_libelle text, p_portees text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_secret text;
  v_cle    text;
  v_id     uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if app.api_tenant() is not null then
    raise exception 'refus.cle_api.par_une_personne' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_tenant and o.kind = 'cabinet' and o.archived_at is null) then
    raise exception 'refus.cle_api.cabinet_seulement' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_libelle, ''))) = 0 then
    raise exception 'refus.cle_api.nom_requis' using errcode = '22023';
  end if;
  if p_portees is null or cardinality(p_portees) = 0 then
    raise exception 'refus.cle_api.portee_requise' using errcode = '22023';
  end if;
  if not (p_portees <@ array['ecritures.lire', 'pieces.deposer']::text[]) then
    raise exception 'refus.cle_api.portee_inconnue' using errcode = '22023';
  end if;

  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_cle    := 'rgo_live_' || v_secret;

  insert into identity.api_keys (tenant_id, libelle, prefixe, suffixe, empreinte, portees)
  values (p_tenant, btrim(p_libelle), left(v_secret, 8), right(v_secret, 4),
          encode(sha256(convert_to(v_cle, 'UTF8')), 'hex'), p_portees)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'api_key.creee', 'identity', 'api_keys', v_id,
          jsonb_build_object('libelle', btrim(p_libelle), 'prefixe', left(v_secret, 8),
                             'portees', to_jsonb(p_portees)));

  return jsonb_build_object('id', v_id, 'cle', v_cle,
                            'prefixe', left(v_secret, 8), 'suffixe', right(v_secret, 4));
end $function$;

CREATE OR REPLACE FUNCTION public.api_key_revoquer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_prefixe text;
begin
  if app.api_tenant() is not null then
    raise exception 'refus.cle_api.par_une_personne' using errcode = '42501';
  end if;

  update identity.api_keys
     set revoked_at = now()
   where id = p_id and revoked_at is null
  returning tenant_id, prefixe into v_tenant, v_prefixe;
  if not found then
    raise exception 'refus.cle_api.revoquee' using errcode = 'P0002';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_tenant, auth.uid(), 'api_key.revoquee', 'identity', 'api_keys', p_id,
          jsonb_build_object('prefixe', v_prefixe));

  return jsonb_build_object('id', p_id, 'revoquee', true);
end $function$;

CREATE OR REPLACE FUNCTION public.arbitrage_creer(p_tenant uuid, p_conversation uuid, p_question text, p_reponse text, p_sources jsonb, p_certitude numeric, p_doute text, p_canal text, p_theme text, p_langue text, p_statut text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cabinet   uuid;
  v_message   uuid;
  v_demandeur text;
  v_id        uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;
  if p_statut not in ('en_attente', 'repondue') then
    raise exception 'refus.arbitrage.etat_initial' using errcode = 'check_violation';
  end if;

  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
     and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
   order by e.starts_on desc
   limit 1;
  if v_cabinet is null then
    raise exception 'refus.conseil.sans_cabinet' using errcode = 'no_data_found';
  end if;

  select m.id into v_message
    from agents.conversation_messages m
   where m.conversation_id = p_conversation and m.role = 'user' and m.contenu = p_question
   order by m.created_at desc, m.id desc
   limit 1;

  select u.email::text into v_demandeur from auth.users u where u.id = auth.uid();

  insert into agents.arbitrages
    (tenant_id, cabinet_tenant_id, conversation_id, message_id, demandeur, question,
     reponse_proposee, sources, certitude, doute, canal, theme, langue, statut)
  values
    (p_tenant, v_cabinet, p_conversation, v_message, v_demandeur, btrim(p_question),
     p_reponse, coalesce(p_sources, '[]'::jsonb), p_certitude, nullif(btrim(p_doute), ''),
     coalesce(nullif(btrim(p_canal), ''), 'conversation'), nullif(btrim(p_theme), ''),
     coalesce(nullif(btrim(p_langue), ''), 'fr'), p_statut)
  returning id into v_id;

  -- Le cabinet lit les notifications de ses dossiers : c''est là qu''on la pose.
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_tenant,
          case when p_statut = 'en_attente' then 'conseil.arbitrage' else 'conseil.repondu' end,
          jsonb_build_object('arbitrage_id', v_id, 'conversation_id', p_conversation,
                             'certitude', p_certitude, 'theme', p_theme));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(),
          case when p_statut = 'en_attente' then 'conseil.retenu' else 'conseil.repondu' end,
          'agents', 'arbitrages', v_id,
          jsonb_build_object('cabinet', v_cabinet, 'certitude', p_certitude, 'theme', p_theme,
                             'sources', coalesce(p_sources, '[]'::jsonb)));

  return jsonb_build_object('id', v_id, 'cabinetId', v_cabinet);
end $function$;

CREATE OR REPLACE FUNCTION public.arbitrage_decider(p_id uuid, p_decision text, p_reponse text, p_article text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a agents.arbitrages%rowtype;
  v_reponse text := nullif(btrim(p_reponse), '');
  v_article text := nullif(btrim(p_article), '');
  v_origine text;
begin
  select * into v_a from agents.arbitrages where id = p_id;
  if not found then
    raise exception 'refus.introuvable.arbitrage' using errcode = 'no_data_found';
  end if;
  if v_a.cabinet_tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.arbitrage' using errcode = '42501';
  end if;
  if p_decision not in ('approuvee', 'corrigee', 'ecartee') then
    raise exception 'refus.arbitrage.decision_inconnue' using errcode = 'check_violation';
  end if;
  if v_a.statut not in ('en_attente', 'repondue') then
    raise exception 'refus.arbitrage.deja_decide' using errcode = 'check_violation';
  end if;
  if v_a.statut = 'repondue' and p_decision = 'ecartee' then
    raise exception 'refus.arbitrage.reponse_envoyee' using errcode = 'check_violation';
  end if;
  if p_decision = 'corrigee' and v_reponse is null then
    raise exception 'refus.reponse.vide' using errcode = 'check_violation';
  end if;

  update agents.arbitrages
     set statut = p_decision,
         reponse_cabinet = case when p_decision = 'corrigee' then v_reponse else null end,
         article_cabinet = case when p_decision = 'corrigee' then v_article else null end,
         decide_par = auth.uid(),
         decide_le = now()
   where id = p_id;

  -- Le message part dans le fil du client, s''il existe encore. Il est signé
  -- Malica dans le fil — c''est elle qui parle au client — mais le journal
  -- d''audit dit qui a décidé.
  if p_message is not null and length(btrim(p_message)) > 0
     and v_a.conversation_id is not null
     and exists (select 1 from agents.conversations c where c.id = v_a.conversation_id) then
    -- La réponse arbitrée est écrite par la BASE, au nom du cabinet qui vient
    -- de décider : la marque d'origine est posée le temps de cette ligne,
    -- puis rendue (20261022440000 réserve ces écritures au serveur).
    v_origine := coalesce(current_setting('malica.origine', true), '');
    perform set_config('malica.origine', 'serveur', true);
    insert into agents.conversation_messages (conversation_id, role, contenu)
    values (v_a.conversation_id, 'assistant', p_message);
    perform set_config('malica.origine', v_origine, true);
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_a.tenant_id, 'conseil.decide',
          jsonb_build_object('arbitrage_id', p_id, 'decision', p_decision,
                             'conversation_id', v_a.conversation_id, 'theme', v_a.theme));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_a.tenant_id, auth.uid(),
          case p_decision when 'approuvee' then 'conseil.approuve'
                          when 'corrigee' then 'conseil.corrige'
                          else 'conseil.ecarte' end,
          'agents', 'arbitrages', p_id,
          jsonb_build_object('cabinet', v_a.cabinet_tenant_id, 'depuis', v_a.statut,
                             'article', v_article, 'certitude', v_a.certitude));

  return (select to_jsonb(v) from public.arbitrages_v v where v.id = p_id);
end $function$;

CREATE OR REPLACE FUNCTION public.banque_delettrer(p_ligne uuid, p_motif uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_ecriture uuid;
  v_pack uuid;
  v_seq integer;
  v_id uuid;
  v_requires_note boolean;
begin
  select tenant_id, ecriture_id, pack_version_id
    into v_tenant, v_ecriture, v_pack
    from banque.lettrage_etat where ligne_id = p_ligne and active for update;
  if v_tenant is null then
    raise exception 'refus.banque.aucun_lettrage' using errcode = 'check_violation';
  end if;
  if p_motif is null then
    raise exception 'refus.motif.requis' using errcode = 'check_violation';
  end if;
  select requires_note into v_requires_note from ref.rejet_motifs where id = p_motif;
  if v_requires_note is null then
    raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
  end if;
  if v_requires_note and coalesce(btrim(p_note), '') = '' then
    raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from banque.lettrages where ligne_id = p_ligne and ecriture_id = v_ecriture;

  insert into banque.lettrages (tenant_id, ligne_id, ecriture_id, action, seq,
                                motif_id, note, pack_version_id, decided_by)
  values (v_tenant, p_ligne, v_ecriture, 'delettre', v_seq, p_motif, p_note,
          v_pack, auth.uid())
  returning id into v_id;

  update banque.lettrage_etat
     set active = false, updated_at = now()
   where ligne_id = p_ligne;

  update banque.releve_lignes
     set status = 'ouverte', updated_at = now()
   where id = p_ligne;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'banque.delettre', 'banque', 'lettrages', v_id,
          p_motif, v_pack,
          jsonb_build_object('ligne_id', p_ligne, 'ecriture_id', v_ecriture,
                             'note', p_note, 'seq', v_seq));

  return jsonb_build_object('lettrage_id', v_id, 'seq', v_seq);
end $function$;

CREATE OR REPLACE FUNCTION public.banque_lettrer(p_ligne uuid, p_ecriture uuid, p_score smallint, p_ecart_montant numeric, p_ecart_jours smallint, p_reference_exacte boolean, p_pack_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_seq integer;
  v_id uuid;
begin
  select tenant_id into v_tenant from banque.releve_lignes where id = p_ligne for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.ligne_de_releve' using errcode = '42501';
  end if;
  if not exists (select 1 from socle.ecritures e
                  where e.id = p_ecriture and e.tenant_id = v_tenant
                    and e.status = 'booked') then
    raise exception 'refus.banque.ecriture_non_lettrable'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from banque.lettrage_etat t where t.ligne_id = p_ligne and t.active) then
    raise exception 'refus.banque.ligne_deja_lettree' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from banque.lettrage_etat t
              where t.tenant_id = v_tenant and t.ecriture_id = p_ecriture and t.active) then
    raise exception 'refus.banque.ecriture_deja_lettree' using errcode = 'unique_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from banque.lettrages where ligne_id = p_ligne and ecriture_id = p_ecriture;

  insert into banque.lettrages (tenant_id, ligne_id, ecriture_id, action, seq, score,
                                ecart_montant, ecart_jours, reference_exacte,
                                pack_version_id, decided_by)
  values (v_tenant, p_ligne, p_ecriture, 'lettre', v_seq, coalesce(p_score, 0),
          coalesce(p_ecart_montant, 0), coalesce(p_ecart_jours, 0),
          coalesce(p_reference_exacte, false), p_pack_version, auth.uid())
  returning id into v_id;

  insert into banque.lettrage_etat (ligne_id, tenant_id, ecriture_id, active, score,
                                    ecart_montant, ecart_jours, reference_exacte,
                                    pack_version_id)
  values (p_ligne, v_tenant, p_ecriture, true, coalesce(p_score, 0),
          coalesce(p_ecart_montant, 0), coalesce(p_ecart_jours, 0),
          coalesce(p_reference_exacte, false), p_pack_version)
  on conflict (ligne_id) do update
    set ecriture_id = excluded.ecriture_id,
        active = true,
        score = excluded.score,
        ecart_montant = excluded.ecart_montant,
        ecart_jours = excluded.ecart_jours,
        reference_exacte = excluded.reference_exacte,
        pack_version_id = excluded.pack_version_id,
        updated_at = now();

  update banque.releve_lignes
     set status = 'rapprochee', updated_at = now()
   where id = p_ligne;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'banque.lettre', 'banque', 'lettrages', v_id,
          p_pack_version,
          jsonb_build_object('ligne_id', p_ligne, 'ecriture_id', p_ecriture,
                             'score', p_score, 'ecart_montant', p_ecart_montant,
                             'ecart_jours', p_ecart_jours, 'seq', v_seq));

  return jsonb_build_object('lettrage_id', v_id, 'seq', v_seq);
end $function$;

CREATE OR REPLACE FUNCTION public.banque_ligne_classer(p_ligne uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_status is null or p_status not in ('ouverte', 'ignoree') then
    raise exception 'refus.banque.statut_par_le_lettrage' using errcode = '22023';
  end if;
  update banque.releve_lignes set status = p_status where id = p_ligne;
  if not found then
    raise exception 'refus.introuvable.ligne_de_releve' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.banque_lignes_importer(p_tenant uuid, p_compte uuid, p_lot uuid, p_dates date[], p_libelles text[], p_montants numeric[], p_references text[], p_cles text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_n integer;
begin
  if not exists (select 1 from public.banque_comptes_v c where c.id = p_compte and c.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.compte_bancaire' using errcode = '42501';
  end if;
  if p_lot is null
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_libelles), 0)
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_montants), 0)
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_references), 0)
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_cles), 0) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into banque.releve_lignes (tenant_id, compte_id, at, label, montant, reference,
                                    import_batch, idempotency_key, created_by)
  select p_tenant, p_compte, u.at, u.label, u.montant, u.reference, p_lot, u.cle, auth.uid()
    from unnest(p_dates, p_libelles, p_montants, p_references, p_cles)
         as u(at, label, montant, reference, cle)
  on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

CREATE OR REPLACE FUNCTION public.cabinet_calendrier_lire(p_cabinet uuid, p_exercice integer, p_secteur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_juridiction text;
  v_resultat    jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;

  with mandats as (
    select e.pme_org_id, f.forme_juridique, f.mode_depot, f.regime_imposition, f.secteur
      from identity.engagements e
      left join lateral (
        select forme_juridique, mode_depot, regime_imposition, secteur
          from identity.fiches_fiscales x
         where x.tenant_id = e.pme_org_id and x.valid_to is null
         order by x.valid_from desc limit 1) f on true
     where e.cabinet_org_id = p_cabinet and e.status = 'actif'
       and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
  ),
  du_pack as (
    select o.code, o.libelle, o.periodicite, o.echeance_jour, null::integer as echeance_mois,
           o.echeance_regle as regle, o.texte_source, o.article, false as propre,
           '*'::text as secteur,
           o.forme_juridique, o.mode_depot, o.regime,
           (select count(*) from mandats m
             where (o.forme_juridique is null or o.forme_juridique = m.forme_juridique)
               and (o.mode_depot is null or o.mode_depot = m.mode_depot)
               and (o.regime is null or o.regime = m.regime_imposition)
               and (p_secteur = '*' or m.secteur = p_secteur)) as mandats
      from ref.fiscal_obligations o
     where o.jurisdiction = v_juridiction
       and o.periodicite in ('mensuelle', 'trimestrielle', 'annuelle')
       and o.echeance_jour is not null
       and o.valid_from <= make_date(p_exercice, 12, 31)
       and (o.valid_to is null or o.valid_to >= make_date(p_exercice, 1, 1))
  ),
  propres as (
    select 'CAB:' || p.id::text as code, p.libelle, p.periodicite, p.echeance_jour, p.echeance_mois,
           p.regle, null::text as texte_source, null::text as article, true as propre,
           p.secteur,
           null::text as forme_juridique, null::text as mode_depot, null::text as regime,
           (select count(*) from mandats m
             where (p.secteur = '*' or m.secteur = p.secteur)
               and (p_secteur = '*' or m.secteur = p_secteur)) as mandats
      from collab.obligations_propres p
     where p.tenant_id = p_cabinet and p.active
       and (p.secteur = '*' or p.secteur = p_secteur)
  ),
  toutes as (
    select * from du_pack union all select * from propres
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', t.code,
           'libelle', t.libelle,
           'periodicite', t.periodicite,
           'echeanceJour', t.echeance_jour,
           'echeanceMois', t.echeance_mois,
           'regle', t.regle,
           'texteSource', t.texte_source,
           'article', t.article,
           'propre', t.propre,
           'secteur', t.secteur,
           'formeJuridique', t.forme_juridique,
           'modeDepot', t.mode_depot,
           'regime', t.regime,
           'mandats', t.mandats,
           'active', coalesce(r.active, true),
           'rappelJours', coalesce(r.rappel_jours,
             (select column_default::integer from information_schema.columns
               where table_schema = 'collab' and table_name = 'obligations_cabinet'
                 and column_name = 'rappel_jours')),
           'regle_par_le_cabinet', r.tenant_id is not null)
           order by t.propre, t.periodicite, t.libelle, t.forme_juridique, t.mode_depot), '[]'::jsonb)
    into v_resultat
    from toutes t
    left join collab.obligations_cabinet r
      on r.tenant_id = p_cabinet and r.obligation_code = t.code
     and r.exercice = p_exercice and r.secteur = p_secteur;

  return v_resultat;
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_fuseau_definir(p_cabinet uuid, p_fuseau text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if p_fuseau is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_fuseau) then
    raise exception '%', app.refus_avec_valeurs('refus.fuseau.inconnu', 'fuseau', (p_fuseau)::text) using errcode = '22023';
  end if;

  update identity.organizations set fuseau = p_fuseau where id = p_cabinet;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.reglages', 'identity', 'organizations', p_cabinet,
          jsonb_build_object('fuseau', p_fuseau));

  return public.cabinet_fuseau_lire(p_cabinet);
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_fuseau_lire(p_cabinet uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'fuseau', coalesce(o.fuseau, c.fuseau),
           'defaut', c.fuseau,
           'regle', o.fuseau is not null,
           'aujourdhui', case when coalesce(o.fuseau, c.fuseau) is not null
                              then (now() at time zone coalesce(o.fuseau, c.fuseau))::date end)
    into v
    from identity.organizations o
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where o.id = p_cabinet;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_inviter(p_tenant uuid, p_email text, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
  v_expire timestamptz;
begin
  if p_role in ('dirigeant', 'collaborateur', 'assistant')
     and facturation.licence_de(p_tenant) is not null
     and not exists (select 1 from facturation.licences l
                      where l.id = facturation.licence_de(p_tenant)
                        and l.titulaire = auth.uid()) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'refus.invitation.adresse' using errcode = '22023';
  end if;
  -- L'adresse d'un membre ne se lit que par app.email_du_membre : auth.users
  -- reste fermée à l'appelant, comme partout.
  if exists (select 1 from identity.memberships m
             where m.tenant_id = p_tenant
               and lower(coalesce(app.email_du_membre(m.user_id), '')) = v_email) then
    raise exception 'refus.invitation.deja_membre' using errcode = '22023';
  end if;

  -- Une invitation en attente pour la même adresse est rendue telle quelle.
  select id, expires_at into v_id, v_expire
    from identity.invitations
   where tenant_id = p_tenant and lower(email) = v_email
     and accepted_at is null and expires_at > now()
   order by created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role,
                              'expiresAt', v_expire, 'deja', true);
  end if;

  insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
  values (p_tenant, v_email, p_role,
          encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
          auth.uid(), now() + interval '30 days')
  returning id, expires_at into v_id, v_expire;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'membre.invite', 'identity', 'invitations', v_id,
          jsonb_build_object('email', v_email, 'role', p_role));

  return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role,
                            'expiresAt', v_expire, 'deja', false);
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_mise_en_route_terminer(p_tenant uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quand timestamptz := now();
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  -- Sans ligne de réglages, les défauts du schéma s'appliquent : on n'en pose aucun ici.
  insert into collab.reglages_cabinet (tenant_id, mise_en_route_terminee_le)
  values (p_tenant, v_quand)
  on conflict (tenant_id) do update
    set mise_en_route_terminee_le = excluded.mise_en_route_terminee_le,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.mise_en_route', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('terminee_le', v_quand));
  return v_quand;
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_obligation_definir(p_cabinet uuid, p_code text, p_exercice integer, p_secteur text, p_active boolean, p_rappel integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  insert into collab.obligations_cabinet (tenant_id, obligation_code, exercice, secteur, active, rappel_jours)
  values (p_cabinet, p_code, p_exercice, p_secteur, p_active, p_rappel)
  on conflict (tenant_id, obligation_code, exercice, secteur) do update
    set active = excluded.active, rappel_jours = excluded.rappel_jours,
        updated_by = auth.uid(), updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.obligation_reglee', 'collab', 'obligations_cabinet', p_cabinet,
          jsonb_build_object('code', p_code, 'exercice', p_exercice, 'secteur', p_secteur,
                             'active', p_active, 'rappel', p_rappel));
  return jsonb_build_object('active', p_active, 'rappelJours', p_rappel);
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_obligation_propre_creer(p_cabinet uuid, p_libelle text, p_periodicite text, p_jour integer, p_mois integer, p_regle text, p_secteur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  insert into collab.obligations_propres (tenant_id, libelle, periodicite, echeance_jour, echeance_mois, regle, secteur)
  values (p_cabinet, btrim(p_libelle), p_periodicite, p_jour, p_mois, btrim(p_regle), coalesce(nullif(btrim(p_secteur), ''), '*'))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.obligation_propre', 'collab', 'obligations_propres', v_id,
          jsonb_build_object('libelle', p_libelle, 'periodicite', p_periodicite, 'jour', p_jour,
                             'mois', p_mois, 'secteur', p_secteur));
  return jsonb_build_object('id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_ouvrir_dossier(p_cabinet uuid, p_nom text, p_legal_id text, p_adresse text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_nom text := nullif(trim(coalesce(p_nom, '')), '');
  v_mf text := nullif(trim(coalesce(p_legal_id, '')), '');
  v_adresse text := nullif(trim(coalesce(p_adresse, '')), '');
  v_cab record;
  v_pme uuid;
begin
  if v_uid is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select id, kind, jurisdiction, currency into v_cab
    from identity.organizations
   where id = p_cabinet and archived_at is null;
  if v_cab.id is null or v_cab.kind <> 'cabinet'
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v_nom is null then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023';
  end if;
  if v_mf is null then
    raise exception 'refus.dossier.matricule_requis' using errcode = '22023';
  end if;
  if exists (select 1 from identity.organizations o
              where o.archived_at is null and upper(trim(o.legal_id)) = upper(v_mf)) then
    raise exception 'refus.dossier.matricule_existant'
      using errcode = '23505';
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by, adresse)
  values ('pme', v_nom, v_mf, v_cab.jurisdiction, v_cab.currency, 'mandate', v_uid, v_adresse)
  returning id into v_pme;

  -- Comme createOrganization côté API : une organisation sans établissement
  -- principal serait inutilisable.
  insert into identity.entities (tenant_id, code, name, is_default)
  values (v_pme, 'PRINCIPAL', v_nom, true);

  insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
  values (v_pme, p_cabinet, 'actif', v_uid);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_pme, v_uid, 'dossier.ouvert', 'identity', 'organizations', v_pme,
          jsonb_build_object('cabinet', p_cabinet, 'legalId', v_mf));

  return jsonb_build_object('id', v_pme, 'name', v_nom, 'legalId', v_mf, 'adresse', v_adresse);
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_reglages_definir(p_tenant uuid, p_seuil_lot numeric, p_seuil_revue numeric, p_double_validation numeric, p_proactives boolean, p_capacite integer, p_ton text, p_seuil_conseil numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not app.has_org_role(p_tenant, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if p_seuil_lot is null or p_seuil_lot < 0 or p_seuil_lot > 1
     or p_seuil_revue is null or p_seuil_revue < 0 or p_seuil_revue > 1 then
    raise exception 'refus.reglages.proportion'
      using errcode = 'check_violation';
  end if;
  if p_seuil_revue > p_seuil_lot then
    raise exception
      '%', app.refus_avec_valeurs('refus.reglages.revue_au_dessus_du_lot', 'revue', (p_seuil_revue)::text, 'lot', (p_seuil_lot)::text)
      using errcode = 'check_violation';
  end if;
  if p_double_validation is not null and p_double_validation < 0 then
    raise exception 'refus.reglages.double_validation'
      using errcode = 'check_violation';
  end if;
  if p_capacite is null or p_capacite <= 0 then
    raise exception 'refus.reglages.capacite'
      using errcode = 'check_violation';
  end if;
  if p_seuil_conseil is null or p_seuil_conseil < 0 or p_seuil_conseil > 1 then
    raise exception 'refus.reglages.proportion'
      using errcode = 'check_violation';
  end if;
  if p_ton is null or p_ton not in ('sobre', 'chaleureux') then
    raise exception 'refus.reglages.ton'
      using errcode = 'check_violation';
  end if;

  insert into collab.reglages_cabinet
    (tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
     propositions_proactives, capacite_dossiers_par_collaborateur, ton_restitutions,
     seuil_certitude_conseil)
  values (p_tenant, p_seuil_lot, p_seuil_revue, p_double_validation, p_proactives, p_capacite, p_ton,
          p_seuil_conseil)
  on conflict (tenant_id) do update
    set seuil_confiance_lot = excluded.seuil_confiance_lot,
        seuil_confiance_revue = excluded.seuil_confiance_revue,
        double_validation_au_dela = excluded.double_validation_au_dela,
        propositions_proactives = excluded.propositions_proactives,
        capacite_dossiers_par_collaborateur = excluded.capacite_dossiers_par_collaborateur,
        ton_restitutions = excluded.ton_restitutions,
        seuil_certitude_conseil = excluded.seuil_certitude_conseil,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.reglages', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('seuil_lot', p_seuil_lot, 'seuil_revue', p_seuil_revue,
                             'double_validation', p_double_validation, 'proactives', p_proactives,
                             'capacite', p_capacite, 'ton', p_ton,
                             'seuil_conseil', p_seuil_conseil));

  return public.cabinet_reglages_lire(p_tenant);
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_reglages_lire(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'seuilConfianceLot', r.seuil_confiance_lot,
           'seuilConfianceRevue', r.seuil_confiance_revue,
           'doubleValidationAuDela', r.double_validation_au_dela,
           'propositionsProactives', r.propositions_proactives,
           'capaciteDossiers', r.capacite_dossiers_par_collaborateur,
           'ton', r.ton_restitutions,
           'seuilCertitudeConseil', r.seuil_certitude_conseil,
           'regle', true)
    into v
    from collab.reglages_cabinet r where r.tenant_id = p_tenant;
  if v is not null then return v; end if;

  -- Les défauts, tels que le schéma les déclare.
  select jsonb_build_object(
           'seuilConfianceLot', (select column_default::numeric from information_schema.columns
                                  where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                    and column_name = 'seuil_confiance_lot'),
           'seuilConfianceRevue', (select column_default::numeric from information_schema.columns
                                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                      and column_name = 'seuil_confiance_revue'),
           'doubleValidationAuDela', null,
           'propositionsProactives', true,
           'capaciteDossiers', (select column_default::integer from information_schema.columns
                                 where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                   and column_name = 'capacite_dossiers_par_collaborateur'),
           'ton', (select split_part(column_default, '''', 2) from information_schema.columns
                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                      and column_name = 'ton_restitutions'),
           'seuilCertitudeConseil', (select column_default::numeric from information_schema.columns
                                      where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                        and column_name = 'seuil_certitude_conseil'),
           'regle', false)
    into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.cabinet_report_poser(p_cabinet uuid, p_code text, p_periode text, p_date date, p_motif text, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_juridiction text;
  v_id          uuid;
  v_legale      date;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'refus.report.date_requise' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  if coalesce(p_periode, '') !~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$' then
    raise exception 'refus.report.periode_illisible' using errcode = 'check_violation';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  if not (
    exists (select 1 from ref.fiscal_obligations o
             where o.jurisdiction = v_juridiction and o.code = p_code)
    or (p_code like 'CAB:%' and exists (
          select 1 from collab.obligations_propres p
           where p.tenant_id = p_cabinet and p.id::text = substr(p_code, 5)))
  ) then
    raise exception 'refus.report.obligation_inconnue' using errcode = 'check_violation';
  end if;

  -- Un report REPOUSSE : il ne place jamais l'échéance avant sa date légale.
  select min(e.date_legale) into v_legale
    from schedule.echeances e
    join identity.engagements g on g.pme_org_id = e.tenant_id
   where g.cabinet_org_id = p_cabinet and g.status = 'actif'
     and e.kind = p_code and e.period = p_periode;
  if v_legale is not null and p_date < v_legale then
    raise exception '%', app.refus_avec_valeurs('refus.report.avant_l_echeance', 'date', (to_char(p_date, 'DD/MM/YYYY'))::text, 'legale', (to_char(v_legale, 'DD/MM/YYYY'))::text)
      using errcode = 'check_violation', hint = 'report.avant_date_legale';
  end if;

  update collab.reports_echeance_cabinet
     set retire_le = now()
   where tenant_id = p_cabinet and obligation_code = p_code and periode = p_periode
     and retire_le is null;
  insert into collab.reports_echeance_cabinet
    (tenant_id, obligation_code, periode, nouvelle_date, motif, source)
  values (p_cabinet, p_code, p_periode, p_date, btrim(p_motif), nullif(btrim(p_source), ''))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.report_echeance', 'collab', 'reports_echeance_cabinet', v_id,
          jsonb_build_object('code', p_code, 'periode', p_periode, 'date', p_date,
                             'motif', p_motif, 'source', p_source));
  return jsonb_build_object('id', v_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.cabinet_report_retirer(p_cabinet uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  update collab.reports_echeance_cabinet
     set retire_le = now()
   where id = p_id and tenant_id = p_cabinet and retire_le is null;
  if not found then
    raise exception 'refus.introuvable.report' using errcode = 'P0002';
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.report_retire', 'collab', 'reports_echeance_cabinet', p_id,
          '{}'::jsonb);
  return jsonb_build_object('id', p_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.cabinet_reports_lire(p_cabinet uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_juridiction text;
  v             jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  select coalesce(jsonb_agg(x.j order by x.nouvelle_date desc, x.creee desc), '[]'::jsonb) into v
    from (
      select r.nouvelle_date, r.created_at as creee,
             jsonb_build_object(
               'id', r.id, 'origine', 'report_cabinet', 'code', r.obligation_code,
               'libelle', coalesce(
                 (select o.libelle from ref.fiscal_obligations o
                   where o.jurisdiction = v_juridiction and o.code = r.obligation_code
                   order by o.valid_from desc limit 1),
                 (select p.libelle from collab.obligations_propres p
                   where r.obligation_code like 'CAB:%' and p.id::text = substr(r.obligation_code, 5))),
               'periode', r.periode, 'nouvelleDate', r.nouvelle_date,
               'motif', r.motif, 'source', r.source, 'creeLe', r.created_at) as j
        from collab.reports_echeance_cabinet r
       where r.tenant_id = p_cabinet and r.retire_le is null
      union all
      select r.nouvelle_date, r.created_at,
             jsonb_build_object(
               'id', r.id, 'origine', 'report_algoria', 'code', r.obligation_code,
               'libelle', (select o.libelle from ref.fiscal_obligations o
                            where o.jurisdiction = r.jurisdiction and o.code = r.obligation_code
                            order by o.valid_from desc limit 1),
               'periode', r.periode, 'nouvelleDate', r.nouvelle_date,
               'motif', r.motif, 'source', r.source, 'creeLe', r.created_at)
        from ref.reports_echeance r
       where r.jurisdiction = v_juridiction and r.retire_le is null
    ) x;
  return v;
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_articles_persist(p_piece uuid, p_pack uuid, p_document_date date, p_account text, p_articles jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_a jsonb;
  v_i smallint := 0;
  v_fam text;
  v_src text;
  v_idx text;
  -- NULL quand la date n'a pas été lue : aucun mois, plutôt qu'un faux mois.
  v_period text := case when p_document_date is null
                        then null
                        else to_char(p_document_date, 'YYYY-MM') end;
  -- La date de réception de la pièce : un fait, propre à cette pièce, stable
  -- d'une reprise à l'autre. Renseignée juste après la lecture du tenant.
  v_recue date;
  v_date_ref date;
begin
  select tenant_id, entity_id, vis, created_at::date
    into v_tenant, v_entity, v_vis, v_recue
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  v_date_ref := coalesce(p_document_date, v_recue);

  -- Projection reconstruite depuis l'extraction, elle-meme immuable et historisee :
  -- aucune donnee d'origine n'est effacee ici.
  delete from capture.piece_articles where piece_id = p_piece;

  for v_a in select * from jsonb_array_elements(coalesce(p_articles, '[]'::jsonb))
  loop
    if coalesce(btrim(v_a->>'designation'), '') = '' then
      continue;
    end if;
    v_i := v_i + 1;
    v_idx := 'articles[' || (v_i - 1)::text || ']';
    select r.famille_code, r.famille_source into v_fam, v_src
      from public.charge_famille_resolve(p_pack, p_account, v_a->>'designation', v_date_ref) r;
    if v_fam is null then
      raise exception '%', app.refus_avec_valeurs('refus.referentiel.famille_absente', 'designation', (v_a->>'designation')::text) using errcode = 'check_violation';
    end if;

    insert into capture.piece_articles (tenant_id, entity_id, vis, piece_id, ordinal,
      designation, quantity, unit_price_ht, unit_price_ttc, total_ht,
      famille_code, famille_source, period, document_date, citation_field,
      citation_quantity, citation_unit_price_ht, citation_unit_price_ttc,
      citation_total_ht, pack_version_id)
    values (v_tenant, v_entity, v_vis, p_piece, v_i,
      v_a->>'designation',
      nullif(v_a->>'quantity','')::numeric,
      nullif(v_a->>'unit_price_ht','')::numeric,
      nullif(v_a->>'unit_price_ttc','')::numeric,
      nullif(v_a->>'total_ht','')::numeric,
      v_fam, v_src, v_period, p_document_date, v_idx,
      v_idx || '.quantity', v_idx || '.unit_price_ht', v_idx || '.unit_price_ttc',
      v_idx || '.total_ht', p_pack);
  end loop;

  return jsonb_build_object('piece_id', p_piece, 'articles', v_i, 'period', v_period);
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_piece_garder(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_deja timestamptz;
begin
  if not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  select tenant_id, vis, status, app.garde_en_vigueur(id, gardee_le)
    into v_tenant, v_vis, v_status, v_deja
    from capture.pieces where id = p_piece for update;
  -- Garder, c'est décider de ne pas l'envoyer au comptable : la décision de
  -- qui l'y envoie (le siège, lui, l'envoie au propriétaire).
  if not app.a_le_droit(v_tenant, 'piece.garder') then
    raise exception 'refus.garder.reserve_au_proprietaire' using errcode = '42501';
  end if;

  if v_vis = 'partage'::app.vis_t then
    if v_status = 'retournee' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t);
      update capture.pieces set gardee_le = now(), updated_at = now() where id = p_piece;
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
              jsonb_build_object('vis', 'entite', 'retour', true));
      return jsonb_build_object('piece_id', p_piece, 'changed', true);
    end if;
    raise exception 'refus.piece.transmise_au_cabinet'
      using errcode = 'check_violation';
  end if;

  if v_deja is not null then
    return jsonb_build_object('piece_id', p_piece, 'gardee_le', v_deja, 'changed', false);
  end if;

  update capture.pieces
     set gardee_le = now(),
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis));

  return jsonb_build_object('piece_id', p_piece, 'changed', true);
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_piece_poser_chemin(p_piece uuid, p_content_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_chemin text;
begin
  if not app.piece_modifiable(p_piece)
     or not exists (select 1 from capture.pieces p
                     where p.id = p_piece and p.created_by is not distinct from auth.uid()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  update capture.pieces
     set storage_path = tenant_id::text || '/' || id::text,
         content_type = coalesce(p_content_type, content_type)
   where id = p_piece
  returning storage_path into v_chemin;
  return v_chemin;
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_piece_register(p_tenant uuid, p_source text, p_storage_path text, p_idempotency_key text, p_entity uuid DEFAULT NULL::uuid, p_vis app.vis_t DEFAULT 'partage'::app.vis_t, p_sha256 text DEFAULT NULL::text, p_page_count smallint DEFAULT NULL::smallint, p_document_kind text DEFAULT NULL::text, p_source_piece uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_source uuid;
  v_tenant_source uuid;
  v_vis_source app.vis_t;
  v_vis app.vis_t := p_vis;
begin
  if p_document_kind is not null
     and not exists (select 1 from ref.document_types d where d.code = p_document_kind) then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.type_de_document', 'type', (p_document_kind)::text)
      using errcode = 'foreign_key_violation';
  end if;

  -- La pièce source doit être du MÊME dossier. Sinon le lien pointerait hors
  -- du dossier et la RLS rendrait un reçu orphelin sans dire pourquoi.
  if p_source_piece is not null then
    -- Une pièce issue d'une version précédente l'est de sa version courante :
    -- rien de nouveau ne s'accroche à une version gelée, et le côté est celui
    -- de la courante.
    select id, tenant_id, vis into v_source, v_tenant_source, v_vis_source
      from capture.pieces where id = app.version_courante(p_source_piece);
    if v_tenant_source is null or v_tenant_source <> p_tenant then
      raise exception 'refus.introuvable.piece'
        using errcode = '42501';
    end if;
    -- Une pièce dérivée a la visibilité de sa source, quoi qu'on déclare :
    -- jamais partagée si sa source ne l'est pas.
    v_vis := v_vis_source;
  end if;

  insert into capture.pieces (tenant_id, entity_id, vis, source, storage_path,
                              sha256, page_count, idempotency_key,
                              document_kind, document_kind_statut, source_piece_id)
  values (p_tenant, p_entity, v_vis, p_source, p_storage_path,
          p_sha256, p_page_count, p_idempotency_key,
          p_document_kind,
          -- Sans type déclaré : à déterminer, la lecture tranchera.
          -- Type déclaré sur une pièce DÉRIVÉE : confirmé — Malica l'a faite.
          -- Type déclaré sur une pièce autonome : à confirmer, la lecture a
          -- le dernier mot.
          case
            when p_document_kind is null then 'a_determiner'
            when v_source is not null then 'confirme'
            else 'a_confirmer'
          end,
          v_source)
  on conflict (tenant_id, idempotency_key) do update
     set updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
          jsonb_build_object('source', p_source, 'document_kind', p_document_kind,
                             'source_piece_id', v_source));

  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_rendue boolean := false;
  v_derive record;
begin
  -- Jamais NULL : « par accord » se dit, ou ne se dit pas.
  p_par_accord := coalesce(p_par_accord, false);
  select tenant_id, vis, status, created_by
    into v_tenant, v_old, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null
     or not ((v_tenant in (select app.member_orgs()) and app.piece_lisible(p_piece))
             or (p_par_accord and v_tenant in (select app.engaged_orgs())
                 and app.accord_donne(p_piece, 'rappel'))) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  if p_vis = 'personnel'::app.vis_t
     and (v_status in ('comptabilisee','supervisee')
          or exists (select 1 from socle.ecritures e
                      where e.piece_id in (select app.versions_de_la_piece(p_piece))
                        and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'refus.piece.comptabilisee_dans_la_societe' using errcode = 'check_violation';
  end if;

  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee')
       or exists (select 1 from socle.ecritures e
                   where e.piece_id in (select app.versions_de_la_piece(p_piece))
                     and e.status = 'booked'
                     and app.ecriture_vivante(e.id)) then
      raise exception 'refus.piece.comptabilisee_partagee' using errcode = 'check_violation';
    end if;
    -- Ce qui est chez le comptable revient par qui l'y envoie, ou par son accord.
    if not app.a_le_droit(v_tenant, 'envoi.cabinet')
       and not (p_par_accord and v_tenant in (select app.engaged_orgs())) then
      raise exception 'refus.envoi.reserve_au_proprietaire'
        using errcode = '42501', hint = 'envoi.proprietaire';
    end if;
    v_rendue := coalesce(v_status = 'retournee' and p_vis = 'entite'::app.vis_t, false);
    if not v_rendue and not app.accord_donne(p_piece, 'rappel') then
      raise exception 'refus.piece.transmise_au_cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Retournée au siège par le propriétaire, la main est au siège : elle ne
  -- part chez le comptable qu'après qu'il l'a reprise et renvoyée (revue Codex
  -- de #146 — le lot du propriétaire la comptait). La même règle que l'écran
  -- (`resteAEnvoyer` au Socle), tenue ici pour toute porte.
  if p_vis = 'partage'::app.vis_t and v_old = 'entite'::app.vis_t
     and (select fait from app.dernier_fait_du_circuit(p_piece)) is not distinct from 'retournee' then
    raise exception 'refus.envoi.chez_le_siege' using errcode = 'check_violation';
  end if;

  -- Entre Mon espace et la société : chacun les siennes, dans les deux sens.
  if (p_vis = 'personnel'::app.vis_t and v_old = 'entite'::app.vis_t)
     or (p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t) then
    if v_auteur is distinct from auth.uid() then
      raise exception 'refus.deplacer.pas_la_sienne' using errcode = '42501';
    end if;
    -- Partie chez le propriétaire, ou retournée par lui : elle se demande,
    -- elle ne se reprend pas en douce.
    if p_vis = 'personnel'::app.vis_t
       and (select fait from app.dernier_fait_du_circuit(p_piece)) in ('envoyee', 'retournee') then
      raise exception 'refus.deplacer.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
  end if;

  if v_rendue then
    perform app.piece_oublie_ses_propositions(p_piece);
  end if;

  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         gardee_le = null,
         status = case when v_rendue then app.statut_hors_retour(p_piece) else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id in (select app.versions_de_la_piece(p_piece))
         and vis = 'partage'::app.vis_t
         and status not in ('comptabilisee', 'supervisee')
      returning id
    loop
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', v_derive.id,
              jsonb_build_object('from', 'partage', 'to', p_vis,
                                 'par_accord', p_par_accord, 'suit_la_source', p_piece));
    end loop;
  end if;

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t then
    perform app.notifier_les_receveurs(v_tenant, 'piece.a_valider',
                                       jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  if v_rendue and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.gardee', jsonb_build_object('piece_id', p_piece, 'vis', p_vis));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_vis      text;
  v_status   text;
  v_tenant   uuid;
  v_archivee timestamptz;
  v_version  uuid;
  v_auteur   uuid;
  v_prevenir uuid;
begin
  -- Jamais NULL : « par accord » se dit, ou ne se dit pas.
  p_par_accord := coalesce(p_par_accord, false);
  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;

  select p.vis::text, p.status, p.tenant_id, p.archivee_le, p.created_by
    into v_vis, v_status, v_tenant, v_archivee, v_auteur
    from capture.pieces p where p.id = p_piece;

  if v_vis is null then
    raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
  end if;

  if v_tenant not in (select app.member_orgs())
     and not (v_vis = 'personnel' and v_auteur is not distinct from auth.uid()
              and v_auteur is not null)
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
  end if;

  if v_tenant in (select app.member_orgs()) then
    -- Ce qu'on ne lit pas n'existe pas pour soi.
    if not app.piece_lisible(p_piece) then
      raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
    end if;
    if v_vis = 'personnel' and v_auteur is distinct from auth.uid() then
      raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
    end if;
    if v_vis <> 'personnel' and v_auteur is distinct from auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes') then
      raise exception 'refus.suppression.pas_la_sienne' using errcode = '42501';
    end if;
    if v_vis = 'entite' and v_auteur = auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes')
       and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'envoyee' then
      raise exception 'refus.suppression.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
    -- Le propriétaire retire la pièce d'un autre : l'auteur le saura. Sur
    -- l'accord de sa demande, la réponse le lui dit déjà.
    if v_auteur is distinct from auth.uid() and not p_par_accord then
      v_prevenir := v_auteur;
    end if;
  end if;

  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  if v_archivee is not null then
    return 'archivee';
  end if;

  if v_vis = 'partage'
     and v_status <> 'retournee'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'refus.piece.transmise_au_cabinet'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception
      'refus.suppression.engagee'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from immo.assets a
              where a.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from stocks.mouvements m
                 where m.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from identity.fiches_fiscales f
                 where f.piece_id in (select app.versions_de_la_piece(p_piece)))
  then
    raise exception
      'refus.suppression.justificatif'
      using errcode = 'check_violation';
  end if;

  perform app.piece_oublie_ses_propositions(v.id)
     from app.versions_de_la_piece(p_piece) v(id);

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.status = 'booked') then
    update capture.pieces set archivee_le = now(), updated_at = now()
     where id in (select app.versions_de_la_piece(p_piece)) and archivee_le is null;
    perform app.les_issues_suivent_l_archive(p_piece);

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.archivee', 'capture', 'pieces', p_piece,
            jsonb_build_object('vis', v_vis, 'status', v_status, 'par_accord', p_par_accord));

    if v_vis = 'partage' and not p_par_accord then
      insert into collab.notifications (tenant_id, kind, payload)
      values (v_tenant, 'piece.archivee', jsonb_build_object('piece_id', p_piece));
    end if;
    if v_prevenir is not null then
      insert into collab.notifications (tenant_id, user_id, kind, payload)
      values (v_tenant, v_prevenir, 'piece.supprimee_par_le_proprietaire',
              jsonb_build_object('piece_id', p_piece,
                                 'par', app.prenom_au_moment(auth.uid()), 'archivee', true));
    end if;
    return 'archivee';
  end if;

  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id in (select app.versions_de_la_piece(p_piece))
          and (exists (select 1 from fabrique.recette_version_exemples r where r.exemple_id = x.id)
               or exists (select 1 from fabrique.evaluation_exemples v where v.exemple_id = x.id)))
  then
    raise exception 'refus.suppression.exemple_de_recette' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord,
                             'versions', (select jsonb_agg(v)
                                            from app.versions_de_la_piece(p_piece) v
                                           where v <> p_piece)));

  if v_vis = 'partage' and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;
  -- L'auteur apprend que sa pièce a été retirée par un propriétaire. La
  -- notification lui est adressée : elle survit à la pièce.
  if v_prevenir is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_prevenir, 'piece.supprimee_par_le_proprietaire',
            jsonb_build_object('piece_id', p_piece, 'par', app.prenom_au_moment(auth.uid())));
  end if;

  for v_version in
    with recursive suite(id, rang) as (
      select p_piece, 0
      union all
      select r.piece_id, s.rang + 1
        from capture.remplacements r join suite s on r.remplacee_par = s.id
    )
    select id from suite order by rang
  loop
    -- L'effacement s'inscrit comme un fait de la transaction, que les gardes
    -- de R7 lisent (`20261104120000`) ; il se retire avant de rendre la main.
    perform app.effacer_la_piece(v_version);
  end loop;
  perform app.effacements_clos();

  return 'supprimee';
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_precision_persist(p_piece uuid, p_champ text, p_valeur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_status text;
  v_avant  text;
  v_statut text;
  v_id uuid;
  v_date date;
begin
  select tenant_id, status, document_kind, document_kind_statut
    into v_tenant, v_status, v_avant, v_statut
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'refus.precision.engagee'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après : une seule liste.
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur and d.propose_a_la_capture) then
      raise exception '%', app.refus_avec_valeurs('refus.precision.type_non_propose', 'type', (p_valeur)::text) using errcode = 'check_violation';
    end if;
    -- Le sens (un type qui porte une écriture) est l'acte du cabinet quand il
    -- tient les livres : la PME ne le pose pas, et ne défait pas celui qu'une
    -- personne a établi.
    if app.livres_tenus_par_le_cabinet(v_tenant)
       and not app.supervise_le_dossier(v_tenant)
       and (exists (select 1 from ref.document_types d
                     where d.code = p_valeur and d.porte_ecriture)
            or (v_statut = 'confirme'
                and exists (select 1 from ref.document_types d
                             where d.code = v_avant and d.porte_ecriture))) then
      raise exception 'refus.sens.reserve_au_cabinet'
        using errcode = '42501', hint = 'sens.cabinet';
    end if;
  elsif p_champ = 'document_date' then
    -- Une date qui n'est pas une date lève ici, et non trois écrans plus loin.
    begin
      v_date := p_valeur::date;
    exception when others then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_illisible', 'date', (p_valeur)::text) using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_a_venir', 'date', (p_valeur)::text)
        using errcode = 'check_violation';
    end if;
  else
    raise exception '%', app.refus_avec_valeurs('refus.precision.champ', 'champ', (p_champ)::text) using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, p_valeur)
  returning id into v_id;

  -- La personne a tranché : la pièce porte le type, confirmé, et c'est ce que
  -- le verrou R2 attend avant toute écriture. Une date précisée ne touche pas
  -- au type.
  if p_champ = 'document_kind' then
    update capture.pieces
       set document_kind = p_valeur,
           document_kind_statut = 'confirme',
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur)
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', p_valeur);
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_read_persist(p_piece uuid, p_tokens jsonb, p_contract text, p_extract jsonb, p_citations jsonb, p_flags jsonb DEFAULT '[]'::jsonb, p_mode text DEFAULT NULL::text, p_confiance jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_tok jsonb;
  v_cit jsonb;
  v_token_id uuid;
  v_count int := 0;
  v_kind text;
  v_extraction uuid;
  v_page smallint;
  v_ordinal int;
  v_fin int;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- R7 : une lecture est un fait. On ne la remplace pas.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    raise exception 'R7 : cette piece a deja ete lue — rephotographiez-la pour en creer une nouvelle'
      using errcode = 'restrict_violation';
  end if;
  for v_tok in select * from jsonb_array_elements(p_tokens)
  loop
    insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text,
                                    x0, y0, x1, y1, confidence)
    values (v_tenant, p_piece,
            (v_tok->>'page')::smallint, (v_tok->>'ordinal')::int, v_tok->>'text',
            (v_tok->>'x0')::numeric, (v_tok->>'y0')::numeric,
            (v_tok->>'x1')::numeric, (v_tok->>'y1')::numeric,
            nullif(v_tok->>'confidence','')::numeric);
  end loop;
  for v_cit in select * from jsonb_array_elements(p_citations)
  loop
    v_page := (v_cit->>'page')::smallint;
    v_ordinal := (v_cit->>'ordinal')::int;
    -- La clé arrive en camelCase : c'est le nom du champ TypeScript
    -- (`TokenRef.ordinalEnd`), sérialisé tel quel, comme l'est déjà `bbox`.
    v_fin := nullif(v_cit->>'ordinalEnd', '')::int;
    if v_fin is not null and v_fin <= v_ordinal then
      v_fin := null;
    end if;

    select t.id into v_token_id
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = v_page
       and t.ordinal = v_ordinal;
    if v_token_id is null then
      raise exception '%', app.refus_avec_valeurs('refus.lecture.citation_orpheline', 'champ', (v_cit->>'field')::text) using errcode = 'check_violation';
    end if;

    -- Une fin de plage qui ne désigne aucun jeton élargirait le cadre cité
    -- sans rien derrière : c'est le même défaut que la citation orpheline.
    if v_fin is not null and not exists (
      select 1 from capture.token_plan t
       where t.piece_id = p_piece and t.page = v_page and t.ordinal = v_fin
    ) then
      raise exception '%', app.refus_avec_valeurs('refus.lecture.citation_orpheline', 'champ', (v_cit->>'field')::text) using errcode = 'check_violation';
    end if;

    -- Le cadre est l'union des jetons cités. Pour un jeton seul, c'est le sien.
    insert into capture.citations (tenant_id, piece_id, field, token_id, page, ordinal_end,
                                   bbox, zone, ui_field, ui_role, bbox_page_px)
    select v_tenant, p_piece, v_cit->>'field', v_token_id, v_page, v_fin,
           jsonb_build_object('x0', min(t.x0), 'y0', min(t.y0),
                              'x1', max(t.x1), 'y1', max(t.y1)),
           nullif(v_cit->>'zone',''),
           nullif(v_cit->>'ui_field',''),
           nullif(v_cit->>'ui_role',''),
           case when v_cit ? 'bbox' then v_cit->'bbox' else null end
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = v_page
       and t.ordinal between v_ordinal and coalesce(v_fin, v_ordinal);
    v_count := v_count + 1;
  end loop;
  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags,
                                   mode_lecture, confiance_par_champ)
  values (v_tenant, p_piece, p_contract, p_extract, p_flags,
          nullif(trim(coalesce(p_mode, '')), ''), coalesce(p_confiance, '{}'::jsonb))
  returning id into v_extraction;

  -- Le type lu, s'il fait partie du vocabulaire, monte sur la pièce : lu,
  -- pas encore confirmé. Un type déjà confirmé par la personne n'est jamais
  -- écrasé par une lecture.
  select t.code into v_kind
    from ref.document_types t
   where t.code = p_extract->>'document_kind';

  update capture.pieces
     set status = case when status = 'capturee' then 'lue' else status end,
         document_kind = case when document_kind_statut = 'confirme' then document_kind
                              else coalesce(v_kind, document_kind) end,
         document_kind_statut = case when document_kind_statut = 'confirme' then 'confirme'
                                     when v_kind is not null then 'a_confirmer'
                                     else document_kind_statut end,
         updated_at = now()
   where id = p_piece;

  -- Qui a lu quoi, comment : l'audit de la lecture.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.read', 'capture', 'extractions', v_extraction,
          jsonb_build_object('piece', p_piece, 'contract', p_contract,
                             'mode', nullif(trim(coalesce(p_mode, '')), ''),
                             'citations', v_count,
                             'flags', jsonb_array_length(coalesce(p_flags, '[]'::jsonb))));

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count,
                            'document_kind', v_kind, 'extraction_id', v_extraction);
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_sceller_empreinte(p_piece uuid, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_original uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'refus.piece.empreinte' using errcode = '22023';
  end if;
  select id, tenant_id, sha256, doublon_de into v
    from capture.pieces where id = p_piece for update;
  if v.id is null then
    raise exception 'refus.introuvable.piece' using errcode = 'P0002';
  end if;

  -- Remplacée pendant que ses octets voyageaient (file hors ligne) : ils
  -- arrivent trop tard, et le disent — ni « scellée », ni panne.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Déjà scellée : même contenu, rien à faire ; autre contenu, refus.
  if v.sha256 is not null then
    if v.sha256 <> p_sha256 then
      raise exception 'refus.piece.scellee'
        using errcode = '23514';
    end if;
    return jsonb_build_object('sha256', v.sha256, 'doublonDe', null, 'etat', 'deja_scellee');
  end if;
  if v.doublon_de is not null then
    return jsonb_build_object('sha256', p_sha256, 'doublonDe', v.doublon_de, 'etat', 'doublon');
  end if;

  -- L'original d'un doublon n'est jamais une version de la même pièce, ni une
  -- version remplacée : la même règle que la détection à l'analyse.
  select p.id into v_original
    from capture.pieces p
   where p.tenant_id = v.tenant_id and p.sha256 = p_sha256 and p.id <> p_piece
     and p.id not in (select app.versions_de_la_piece(p_piece))
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
   limit 1;

  if v_original is not null then
    update capture.pieces set doublon_de = v_original where id = p_piece;
  else
    begin
      update capture.pieces set sha256 = p_sha256 where id = p_piece;
    exception when unique_violation then
      -- L'empreinte est déjà tenue — par une pièce que l'appelant ne voit pas,
      -- ou par une version de cette pièce : on ne la nomme pas.
      return jsonb_build_object('sha256', p_sha256, 'doublonDe', null, 'etat', 'non_scellee');
    end;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'piece.recue', 'capture', 'pieces', p_piece,
          jsonb_build_object('sha256', p_sha256, 'doublonDe', v_original));

  return jsonb_build_object('sha256', p_sha256, 'doublonDe', v_original,
                            'etat', case when v_original is null then 'scellee' else 'doublon' end);
end
$function$;

CREATE OR REPLACE FUNCTION public.charge_question_answer(p_tenant uuid, p_period text, p_famille text, p_observed numeric, p_baseline numeric, p_ratio numeric, p_threshold text, p_pack uuid, p_answer text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_seq integer;
  v_membre boolean;
  v_mandate boolean;
  v_side text;
begin
  -- PREMIER ÉCART : l'expert sous mandat actif peut trancher. Personne d'autre.
  v_membre := p_tenant in (select app.member_orgs());
  v_mandate := p_tenant in (select app.engaged_orgs());
  if not v_membre and not v_mandate then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  if p_answer not in ('exceptionnel','a_verifier') then
    raise exception 'refus.charge.reponse_invalide' using errcode = '22023';
  end if;

  -- SECOND ÉCART : le côté s'inscrit. Le membre d'abord — un expert qui serait
  -- AUSSI membre du dossier répond en tant que membre, parce que c'est le lien
  -- le plus fort des deux.
  v_side := case when v_membre then 'pme' else 'cabinet' end;

  select coalesce(max(seq), 0) + 1 into v_seq
    from collab.charge_questions
   where tenant_id = p_tenant and period = p_period and famille_code = p_famille;

  insert into collab.charge_questions (tenant_id, period, famille_code, observed, baseline,
    deviation_ratio, threshold_code, pack_version_id, answer, answered_by, answered_at, seq,
    answered_side)
  values (p_tenant, p_period, p_famille, p_observed, p_baseline, p_ratio, p_threshold,
          p_pack, p_answer, auth.uid(), now(), v_seq, v_side)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_tenant, auth.uid(), 'charge.question_answered', 'collab', 'charge_questions',
          v_id, p_pack,
          jsonb_build_object('period', p_period, 'famille_code', p_famille,
                             'answer', p_answer, 'observed', p_observed,
                             'baseline', p_baseline, 'deviation_ratio', p_ratio,
                             'seq', v_seq, 'side', v_side));

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.collab_assign(p_cabinet uuid, p_client uuid, p_user uuid, p_briefing text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seq integer;
  v_prev uuid;
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_cabinet and m.user_id = p_user) then
    raise exception 'refus.collab.hors_cabinet'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'refus.mandat.aucun_actif' using errcode = 'check_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from collab.assignments
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client;

  update collab.assignments
     set active = false
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client and active
  returning collaborator_id into v_prev;

  insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id,
                                  briefing, active, seq, decided_by)
  values (p_cabinet, p_client, p_user, p_briefing, true, v_seq, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_cabinet, auth.uid(), 'client.affecte', 'collab', 'assignments', v_id,
          jsonb_build_object('client_tenant_id', p_client, 'collaborator_id', p_user,
                             'previous_collaborator_id', v_prev, 'briefing', p_briefing,
                             'seq', v_seq));

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.compte_cabinet_fermer(p_tenant uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from parametrage.accounts where tenant_id = p_tenant and account_code = p_code;
  if not found then
    raise exception 'refus.introuvable.compte' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.conseil_budget_exiger(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plafond numeric := app.plafond_ia_de(p_tenant);
  v_depense numeric := app.depense_ia_du_mois(p_tenant);
begin
  if p_tenant not in (select app.member_orgs())
     and p_tenant not in (select app.engaged_orgs())
     and not app.is_platform() then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  if v_depense >= v_plafond then
    raise exception 'refus.conseil.plafond'
      using errcode = '22023', hint = 'ia.plafond_atteint';
  end if;
  return jsonb_build_object('depense', v_depense, 'plafond', v_plafond);
end
$function$;

CREATE OR REPLACE FUNCTION public.conseil_contexte(p_pme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cabinet uuid;
  v_nom     text;
  v_seuil   numeric;
begin
  if not (p_pme in (select app.member_orgs()) or p_pme in (select app.engaged_orgs())) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;

  select e.cabinet_org_id, o.name
    into v_cabinet, v_nom
    from identity.engagements e
    join identity.organizations o on o.id = e.cabinet_org_id
   where e.pme_org_id = p_pme and e.status = 'actif'
     and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
     and o.archived_at is null
   order by e.starts_on desc
   limit 1;

  if v_cabinet is not null then
    select r.seuil_certitude_conseil into v_seuil
      from collab.reglages_cabinet r where r.tenant_id = v_cabinet;
    if v_seuil is null then
      select column_default::numeric into v_seuil
        from information_schema.columns
       where table_schema = 'collab' and table_name = 'reglages_cabinet'
         and column_name = 'seuil_certitude_conseil';
    end if;
  end if;

  return jsonb_build_object(
    'cabinetId', v_cabinet,
    'cabinetNom', v_nom,
    'seuil', v_seuil,
    'appelantMembre', p_pme in (select app.member_orgs()));
end $function$;

CREATE OR REPLACE FUNCTION public.conversation_controles_journaliser(p_tenant uuid, p_message uuid, p_controles text[], p_suites text[], p_details text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(cardinality(p_controles), 0) <> coalesce(cardinality(p_suites), 0)
     or coalesce(cardinality(p_controles), 0) <> coalesce(cardinality(p_details), 0) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  if p_message is not null
     and not exists (select 1 from agents.conversation_messages m
                       join agents.conversations c on c.id = m.conversation_id
                      where m.id = p_message and c.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.message' using errcode = '42501';
  end if;
  insert into agents.reponse_controles (tenant_id, message_id, controle, suite, detail)
  select p_tenant, p_message, c.controle, c.suite, left(c.detail, 500)
    from unnest(p_controles, p_suites, p_details) as c(controle, suite, detail);
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_juger(p_tenant uuid, p_message uuid, p_verdict text, p_attendu text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from agents.conversation_messages m
                   join agents.conversations c on c.id = m.conversation_id
                  where m.id = p_message and c.tenant_id = p_tenant and m.role = 'assistant') then
    raise exception 'refus.introuvable.message' using errcode = '42501';
  end if;
  insert into agents.reponse_verdicts (tenant_id, message_id, verdict, attendu, created_by)
  values (p_tenant, p_message, p_verdict, nullif(btrim(p_attendu), ''), auth.uid())
  on conflict (message_id, created_by) do nothing;
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_poser(p_conversation uuid, p_question text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if nullif(btrim(p_question), '') is null then
    raise exception 'refus.conversation.question_vide' using errcode = '22023';
  end if;
  if not exists (select 1 from agents.conversations c
                  where c.id = p_conversation and c.created_by = auth.uid()) then
    raise exception 'refus.introuvable.conversation' using errcode = '42501';
  end if;
  insert into agents.conversation_messages (conversation_id, role, contenu)
  values (p_conversation, 'user', btrim(p_question));
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_renommer(p_conversation uuid, p_titre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if nullif(btrim(p_titre), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update agents.conversations set titre = left(btrim(p_titre), 120)
   where id = p_conversation and created_by = auth.uid();
  if not found then
    raise exception 'refus.introuvable.conversation' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_repondre(p_conversation uuid, p_question text, p_reponse text, p_raisonnement text, p_model text, p_tokens_in integer, p_tokens_out integer, p_latency_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from agents.conversations c
                  where c.id = p_conversation and c.created_by = auth.uid()) then
    raise exception 'refus.introuvable.conversation' using errcode = '42501';
  end if;
  insert into agents.conversation_messages (conversation_id, role, contenu)
  values (p_conversation, 'user', p_question);
  insert into agents.conversation_messages (conversation_id, role, contenu, raisonnement, model,
                                            tokens_in, tokens_out, latency_ms)
  values (p_conversation, 'assistant', p_reponse, p_raisonnement, p_model, p_tokens_in,
          p_tokens_out, p_latency_ms);
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_supprimer(p_conversation uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from agents.conversations where id = p_conversation and created_by = auth.uid();
  if not found then
    raise exception 'refus.introuvable.conversation' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.create_organization(p_kind text, p_name text, p_validation_mode app.validation_mode_t DEFAULT 'mandate'::app.validation_mode_t, p_legal_id text DEFAULT NULL::text, p_jurisdiction text DEFAULT NULL::text, p_currency text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_role text;
  v_refus text;
begin
  if v_uid is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  if p_kind not in ('pme','cabinet') then
    raise exception 'refus.organisation.type_inconnu' using errcode = '22023';
  end if;

  -- Un nom fait d'espaces n'est pas un nom.
  p_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  if p_name is null then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023',
      hint = 'organisation.nom_requis';
  end if;

  -- À juridiction connue, la devise se déduit du pack : pas de constante ici.
  if p_jurisdiction is null then
    raise exception 'refus.organisation.juridiction_requise' using errcode = '22023';
  end if;
  if p_currency is null then
    select p.currency into p_currency
      from ref.jurisdiction_packs p
     where p.jurisdiction = p_jurisdiction
       and p.effective_from <= current_date
     order by p.effective_from desc
     limit 1;
    if p_currency is null then
      raise exception 'refus.referentiel.pack_absent'
        using errcode = '22023';
    end if;
  end if;

  -- Les espaces autour viennent du copier-coller : on nettoie, on ne refuse pas.
  p_legal_id := nullif(btrim(coalesce(p_legal_id, '')), '');

  v_refus := public.identifiant_verifier(p_jurisdiction, 'matricule_fiscal', p_legal_id);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- On accepte large, on range net : la pièce imprime des capitales.
  p_legal_id := upper(p_legal_id);

  -- Reprendre une inscription n'est pas créer une seconde société : si la
  -- personne est déjà membre d'une société active qui porte ce matricule,
  -- c'est celle-là.
  if p_legal_id is not null then
    select o.id into v_org
      from identity.organizations o
      join identity.memberships m on m.tenant_id = o.id and m.user_id = v_uid
     where o.jurisdiction = p_jurisdiction
       and upper(o.legal_id) = p_legal_id
       and o.kind = p_kind
       and o.archived_at is null
     order by o.created_at
     limit 1;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by)
  values (p_kind, p_name, p_legal_id, p_jurisdiction, p_currency,
          p_validation_mode, v_uid)
  returning id into v_org;

  v_role := case when p_kind = 'cabinet' then 'expert' else 'dirigeant' end;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v_org, v_uid, v_role);

  -- Une PME naît avec sa licence ; un cabinet n'en a pas (rend vide, sans lever).
  perform facturation.licence_naitre(v_org, v_uid, null, current_date);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end
$function$;

CREATE OR REPLACE FUNCTION public.dossier_invitations_lire(p_pme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.expert_mandate_sur(p_pme) then
    raise exception 'refus.reserve.expert_mandate'
      using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'email', i.email,
             'statut', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at),
             'expiresAt', i.expires_at,
             'createdAt', i.created_at,
             'acceptedAt', i.accepted_at,
             'revokedAt', i.revoked_at)
           order by i.created_at desc)
      from identity.invitations i
     where i.tenant_id = p_pme), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.dossier_inviter_contact(p_pme uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_jeton text;
  v_id uuid;
  v_expire timestamptz;
begin
  if v_uid is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  if not app.expert_mandate_sur(p_pme) then
    raise exception 'refus.reserve.expert_mandate'
      using errcode = '42501';
  end if;
  if exists (select 1 from identity.memberships where tenant_id = p_pme) then
    raise exception 'refus.dossier.a_son_dirigeant' using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'refus.invitation.adresse' using errcode = '22023';
  end if;

  -- Un seul lien vivant par dossier : le précédent est révoqué.
  update identity.invitations
     set revoked_at = now(), revoked_by = v_uid
   where tenant_id = p_pme and accepted_at is null and revoked_at is null
     and expires_at > now();

  v_jeton := encode(extensions.gen_random_bytes(32), 'hex');
  insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
  values (p_pme, v_email, 'dirigeant',
          encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'),
          v_uid, now() + interval '7 days')
  returning id, expires_at into v_id, v_expire;

  -- L'audit dit qui a invité qui ; le jeton n'y entre pas.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_pme, v_uid, 'contact.invite', 'identity', 'invitations', v_id,
          jsonb_build_object('email', v_email, 'role', 'dirigeant', 'par', 'lien'));

  return jsonb_build_object('id', v_id, 'email', v_email, 'jeton', v_jeton,
                            'expiresAt', v_expire);
end $function$;

CREATE OR REPLACE FUNCTION public.dossier_revoquer_invitation(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  select id, tenant_id, accepted_at, revoked_at, expires_at into v
    from identity.invitations where id = p_id;
  if v.id is null or not app.expert_mandate_sur(v.tenant_id) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.revocation' using errcode = '22023';
  end if;
  update identity.invitations set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'contact.invitation_revoquee', 'identity', 'invitations',
          p_id, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'statut', 'revoquee');
end $function$;

CREATE OR REPLACE FUNCTION public.echeance_marquer(p_id uuid, p_fait boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        record;
  v_status text;
begin
  select id, tenant_id, due_date, status into v from schedule.echeances where id = p_id;
  if v.id is null
     or not (v.tenant_id in (select app.member_orgs())
             or v.tenant_id in (select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.introuvable.echeance' using errcode = '42501';
  end if;

  v_status := case
    when p_fait then 'fait'
    when v.due_date < current_date then 'en_retard'
    else 'a_venir'
  end;

  update schedule.echeances
     set status   = v_status,
         fait_le  = case when p_fait then current_date else null end,
         fait_par = case when p_fait then auth.uid() else null end
   where id = p_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(),
          case when p_fait then 'echeance.faite' else 'echeance.rouverte' end,
          'schedule', 'echeances', p_id,
          jsonb_build_object('due_date', v.due_date, 'avant', v.status, 'apres', v_status));

  return jsonb_build_object('status', v_status);
end
$function$;

CREATE OR REPLACE FUNCTION public.echeances_deriver(p_tenant uuid, p_jusqua date DEFAULT ((CURRENT_DATE + '4 mons'::interval))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_juridiction text;
  v_fiche       record;
  v_pack        uuid;
  v_cabinet     uuid;
  v_depuis      date := date_trunc('month', current_date)::date;
  v_n           int  := 0;
  v_ob          record;
  v_mois        date;
  v_periode     text;
  v_legale      date;
  v_echeance    date;
  v_origine     text;
  v_motif       text;
  v_source      text;
  v_rep         record;
begin
  if not (p_tenant in (select app.member_orgs())
          or p_tenant in (select app.engaged_orgs())
          or app.is_platform()) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;

  select jurisdiction into v_juridiction from identity.organizations where id = p_tenant;

  select forme_juridique, mode_depot, regime_imposition, secteur, regime_tva
    into v_fiche
    from identity.fiches_fiscales
   where tenant_id = p_tenant and valid_to is null
   order by valid_from desc
   limit 1;
  if not found then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.absente');
  end if;
  if v_fiche.forme_juridique is null or v_fiche.mode_depot is null then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.incomplete');
  end if;

  select id into v_pack
    from ref.jurisdiction_packs
   where jurisdiction = v_juridiction
     and effective_from <= current_date
     and (effective_to is null or effective_to > current_date)
   order by effective_from desc
   limit 1;
  if v_pack is null then
    return jsonb_build_object('generees', 0, 'raison', 'pack.absent');
  end if;

  -- Le cabinet qui tient ce dossier, s'il y en a un.
  select cabinet_org_id into v_cabinet
    from identity.engagements
   where pme_org_id = p_tenant and status = 'actif'
     and starts_on <= current_date and (ends_on is null or ends_on >= current_date)
   order by starts_on desc
   limit 1;

  for v_ob in
    with applicables as (
      select o.code, o.libelle, o.periodicite, o.echeance_jour, null::integer as echeance_mois,
             split_part(o.code, '_', 1) as famille,
             (case when o.forme_juridique is not null then 2 else 0 end
              + case when o.mode_depot is not null then 1 else 0 end
              + case when o.regime is not null then 4 else 0 end) as precision
        from ref.fiscal_obligations o
       where o.jurisdiction = v_juridiction
         and o.periodicite in ('mensuelle', 'trimestrielle')
         and o.echeance_jour is not null
         and o.valid_from <= p_jusqua
         and (o.valid_to is null or o.valid_to > v_depuis)
         and (o.forme_juridique is null or o.forme_juridique = v_fiche.forme_juridique)
         and (o.mode_depot is null or o.mode_depot = v_fiche.mode_depot)
         and (o.regime is null or o.regime = v_fiche.regime_imposition)
         -- Une obligation de TVA ne vise pas un dossier non assujetti (ANO-LIVE-007).
         and (not o.exige_assujettissement_tva or coalesce(v_fiche.regime_tva, '') <> 'non_assujetti')
    ),
    retenues as (
      select a.code, a.libelle, a.periodicite, a.echeance_jour, a.echeance_mois
        from applicables a
       where a.precision = (select max(b.precision) from applicables b where b.famille = a.famille)
      union all
      select 'CAB:' || p.id::text, p.libelle, p.periodicite, p.echeance_jour, p.echeance_mois
        from collab.obligations_propres p
       where v_cabinet is not null and p.tenant_id = v_cabinet and p.active
         and (p.secteur = '*' or p.secteur = v_fiche.secteur)
    )
    select * from retenues
  loop
    v_mois := v_depuis;
    while v_mois <= p_jusqua loop
      v_legale := null;
      if v_ob.periodicite = 'mensuelle' then
        v_periode := to_char(v_mois - interval '1 month', 'YYYY-MM');
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'trimestrielle' and extract(month from v_mois)::int % 3 = 1 then
        v_periode := to_char(v_mois - interval '1 month', 'YYYY')
                     || '-T' || extract(quarter from v_mois - interval '1 month')::text;
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'annuelle' and extract(month from v_mois)::int = v_ob.echeance_mois then
        v_periode := to_char(v_mois, 'YYYY');
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      end if;

      -- La fenêtre se juge sur la date LÉGALE : un report qui pousse
      -- l'échéance au-delà de l'horizon doit quand même mettre la ligne à jour.
      if v_legale is not null and v_legale between v_depuis and p_jusqua
         -- Le cabinet a-t-il écarté cette obligation pour cet exercice et ce secteur ?
         and not exists (
           select 1 from collab.obligations_cabinet r
            where r.tenant_id = v_cabinet and r.obligation_code = v_ob.code
              and r.exercice = extract(year from v_legale)::int
              and (r.secteur = '*' or r.secteur = v_fiche.secteur)
              and r.active = false)
      then
        -- La date retenue : report du cabinet, sinon d'ALGORIA, sinon le
        -- premier jour ouvrable à partir de la date légale.
        v_echeance := null;
        v_motif := null;
        v_source := null;
        select r.nouvelle_date, r.motif, r.source into v_rep
          from collab.reports_echeance_cabinet r
         where v_cabinet is not null and r.tenant_id = v_cabinet
           and r.obligation_code = v_ob.code and r.periode = v_periode and r.retire_le is null;
        if found then
          v_echeance := v_rep.nouvelle_date;
          v_origine  := 'report_cabinet';
          v_motif    := v_rep.motif;
          v_source   := v_rep.source;
        else
          select r.nouvelle_date, r.motif, r.source into v_rep
            from ref.reports_echeance r
           where r.jurisdiction = v_juridiction
             and r.obligation_code = v_ob.code and r.periode = v_periode and r.retire_le is null;
          if found then
            v_echeance := v_rep.nouvelle_date;
            v_origine  := 'report_algoria';
            v_motif    := v_rep.motif;
            v_source   := v_rep.source;
          else
            v_echeance := app.jour_ouvrable(v_juridiction, v_legale);
            v_origine  := case when v_echeance = v_legale then 'loi' else 'jour_ouvrable' end;
          end if;
        end if;

        insert into schedule.echeances
          (tenant_id, kind, label, period, due_date, pack_version_id,
           date_legale, date_origine, report_motif, report_source)
        values (p_tenant, v_ob.code, v_ob.libelle, v_periode, v_echeance, v_pack,
                v_legale, v_origine, v_motif, v_source)
        on conflict (tenant_id, kind, period) do update
          set due_date        = excluded.due_date,
              label           = excluded.label,
              pack_version_id = excluded.pack_version_id,
              date_legale     = excluded.date_legale,
              date_origine    = excluded.date_origine,
              report_motif    = excluded.report_motif,
              report_source   = excluded.report_source
          where schedule.echeances.status <> 'fait';
        v_n := v_n + 1;
      end if;
      v_mois := (v_mois + interval '1 month')::date;
    end loop;
  end loop;

  -- Une obligation de TVA d'un dossier devenu (ou déclaré) non assujetti sort
  -- du calendrier, sauf ce qui est fait (ANO-LIVE-007).
  if coalesce(v_fiche.regime_tva, '') = 'non_assujetti' then
    delete from schedule.echeances s
     where s.tenant_id = p_tenant and s.status <> 'fait'
       and exists (select 1 from ref.fiscal_obligations o
                    where o.jurisdiction = v_juridiction and o.code = s.kind
                      and o.exige_assujettissement_tva);
  end if;

  -- Ce que le cabinet a écarté depuis sort du calendrier, sauf ce qui est fait.
  delete from schedule.echeances s
   where s.tenant_id = p_tenant and s.status <> 'fait'
     and coalesce(s.date_legale, s.due_date) >= v_depuis
     and exists (
       select 1 from collab.obligations_cabinet r
        where r.tenant_id = v_cabinet and r.obligation_code = s.kind
          and r.exercice = extract(year from coalesce(s.date_legale, s.due_date))::int
          and (r.secteur = '*' or r.secteur = v_fiche.secteur)
          and r.active = false);

  update schedule.echeances set status = 'en_retard'
   where tenant_id = p_tenant and status = 'a_venir' and due_date < current_date;
  update schedule.echeances set status = 'a_venir'
   where tenant_id = p_tenant and status = 'en_retard' and due_date >= current_date;

  return jsonb_build_object('generees', v_n, 'raison', null);
end
$function$;

CREATE OR REPLACE FUNCTION public.etablissement_archiver(p_entity uuid, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant   uuid;
  v_defaut   boolean;
  v_en_cours integer;
  v_autres   integer;
begin
  select tenant_id, is_default into v_tenant, v_defaut
    from identity.entities where id = p_entity;
  if v_tenant is null then
    raise exception 'refus.introuvable.etablissement' using errcode = 'no_data_found';
  end if;

  if not app.has_org_role(v_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant' using errcode = '42501';
  end if;

  -- Le dernier établissement actif ne se ferme pas : une société sans
  -- établissement n'a plus où ranger la pièce suivante.
  select count(*) into v_autres
    from identity.entities
   where tenant_id = v_tenant and id <> p_entity and archived_at is null;
  if v_autres = 0 then
    raise exception 'refus.etablissement.dernier'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_en_cours
    from capture.pieces
   where entity_id = p_entity
     and status in ('capturee', 'lue', 'proposee');
  if v_en_cours > 0 then
    return jsonb_build_object(
      'archive', false,
      'motif', 'pieces_en_cours',
      'pieces', v_en_cours);
  end if;

  update identity.entities
     set archived_at = now(), archived_reason = p_motif, updated_at = now()
   where id = p_entity;

  -- L'établissement par défaut qui ferme passe le relais : sans ça, la
  -- capture suivante n'a plus de destination et `pme.tsx` prend « le premier »,
  -- c'est-à-dire n'importe lequel.
  if v_defaut then
    update identity.entities
       set is_default = true, updated_at = now()
     where id = (select id from identity.entities
                  where tenant_id = v_tenant and archived_at is null
                  order by created_at limit 1);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'etablissement.archive', 'identity', 'entities',
          p_entity, jsonb_build_object('motif', p_motif, 'etait_defaut', v_defaut));

  return jsonb_build_object('archive', true, 'pieces', 0);
end
$function$;

CREATE OR REPLACE FUNCTION public.export_journaliser(p_cabinet uuid, p_client uuid, p_format text, p_du date, p_au date, p_lignes integer, p_taille bigint, p_empreinte text, p_pack uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  insert into collab.exports
    (tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte, pack_version_id)
  values (p_cabinet, p_client, p_format, p_du, p_au, p_lignes, p_taille, p_empreinte, p_pack)
  returning id into v_id;

  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'export.genere', 'collab', 'exports', v_id, p_pack,
          jsonb_build_object('format', p_format, 'client', p_client, 'du', p_du, 'au', p_au,
                             'lignes', p_lignes, 'taille', p_taille, 'empreinte', p_empreinte));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.fait_consigner(p_action text, p_objet uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ref     ref.faits_consignables%rowtype;
  v_tenant  uuid;
  v_pack    uuid;
  v_id      uuid;
begin
  select * into v_ref from ref.faits_consignables where action = p_action;
  if not found then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  -- L'objet se lit sous la RLS de l'appelant : ce qu'il ne voit pas
  -- n'existe pas pour lui.
  if (v_ref.object_schema, v_ref.object_table) = ('socle', 'ecritures') then
    select e.tenant_id, e.pack_version_id into v_tenant, v_pack
      from public.ecritures_v e where e.id = p_objet;
  else
    select p.tenant_id into v_tenant from public.pieces_v p where p.id = p_objet;
  end if;
  if v_tenant is null then
    raise exception 'refus.introuvable' using errcode = '42501';
  end if;

  if (v_ref.garde = 'superviseur' and not app.peut_superviser(v_tenant))
     or (v_ref.garde = 'redacteur'
         and v_tenant not in (select app.member_orgs())
         and not app.supervise_le_dossier(v_tenant)) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), p_action, v_ref.object_schema, v_ref.object_table,
          p_objet, v_pack, p_payload)
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.fiche_fiscale_etablir(p_tenant uuid, p_regime_imposition text, p_regime_tva text, p_prorata_tva numeric, p_secteur text, p_debut_activite date, p_cloture_exercice text, p_forme_juridique text, p_mode_depot text, p_source text, p_piece uuid, p_valid_from date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if p_valid_from is null or nullif(btrim(p_source), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- La pièce qui la prouve est une pièce de la société (revue de #149).
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  update identity.fiches_fiscales
     set valid_to = p_valid_from
   where tenant_id = p_tenant and valid_to is null and valid_from < p_valid_from;
  insert into identity.fiches_fiscales (tenant_id, regime_imposition, regime_tva, prorata_tva,
                                        secteur, debut_activite, cloture_exercice,
                                        forme_juridique, mode_depot, source, piece_id, valid_from)
  values (p_tenant, p_regime_imposition, p_regime_tva, p_prorata_tva, p_secteur,
          p_debut_activite, p_cloture_exercice, p_forme_juridique, p_mode_depot, p_source,
          p_piece, p_valid_from)
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.forfait_changer(p_offre text, p_tenant uuid DEFAULT NULL::uuid, p_le date DEFAULT CURRENT_DATE)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_emp     record;
  v_courant record;
  v_cible   record;
  v_motif   text;
begin
  -- Ajouté le 19 octobre 2026 : un engagement à l'année fige l'offre.
  if exists (select 1 from facturation.engagements_annuels e
              where e.licence_id = v_licence and e.au >= p_le) then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', 'engagement_annuel', 'chiffres', '{}') using errcode = 'check_violation';
  end if;

  select e.code, e.chiffres into v_emp
    from facturation.empechement_de_forfait(v_licence, p_offre, p_le) e;

  if v_emp.code is not null then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', (v_emp.code)::text, 'chiffres', (v_emp.chiffres)::text)
      using errcode = 'check_violation';
  end if;

  select f.id, f.offre_code, f.canal, f.effet_du into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;

  select o.rang into v_cible
    from ref.offres o
   where o.code = p_offre and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  select case when v_cible.rang > o.rang then 'montee' else 'descente' end into v_motif
    from ref.offres o
   where o.code = v_courant.offre_code and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  update facturation.forfait_historique
     set effet_au = p_le
   where licence_id = v_licence and effet_au is null;

  insert into facturation.forfait_historique
    (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
  values
    (v_licence, p_offre, p_le, v_courant.canal, p_le, v_motif, auth.uid());

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_avoir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f        record;
  v_avoir  uuid;
  v_numero text;
  v_jour   date := current_date;
begin
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut not in ('emise', 'payee') then
    raise exception 'refus.honoraires.avoir_d_une_emise' using errcode = '22023';
  end if;
  if f.avoir_de is not null then
    raise exception 'refus.honoraires.avoir_non_annulable' using errcode = '22023';
  end if;

  insert into collab.factures_honoraires
    (tenant_id, client_tenant_id, mandat_id, periode_du, periode_au, pack_version_id,
     taux_tva_code, taux_tva, devise, droits_fixes, droits_libelle, avoir_de)
  values (f.tenant_id, f.client_tenant_id, f.mandat_id, f.periode_du, f.periode_au, f.pack_version_id,
          f.taux_tva_code, f.taux_tva, f.devise, -f.droits_fixes, f.droits_libelle, p_id)
  returning id into v_avoir;

  insert into collab.factures_honoraires_lignes (tenant_id, facture_id, ordre, libelle, quantite, prix_unitaire)
  select tenant_id, v_avoir, ordre, libelle, -quantite, prix_unitaire
    from collab.factures_honoraires_lignes where facture_id = p_id order by ordre;

  v_numero := app.honoraires_numero_suivant(f.tenant_id, v_jour);
  update collab.factures_honoraires
     set statut = 'emise', numero = v_numero, emise_le = v_jour, echeance_le = v_jour
   where id = v_avoir;

  perform set_config('malica.honoraires_transition', p_id::text, true);
  update collab.factures_honoraires set statut = 'annulee', annulee_le = v_jour where id = p_id;
  perform set_config('malica.honoraires_transition', '', true);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.avoir', 'collab', 'factures_honoraires', v_avoir,
          jsonb_build_object('annule', p_id, 'numero_annule', f.numero, 'numero', v_numero));
  return jsonb_build_object('id', v_avoir, 'numero', v_numero);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_brouillon_creer(p_cabinet uuid, p_client uuid, p_du date, p_au date, p_taux_code text, p_lignes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id     uuid;
  v_mandat uuid;
  v_devise text;
  v_taux   record;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client and e.status = 'actif'
  ) then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '22023';
  end if;

  select id into v_mandat from collab.mandats_honoraires
   where tenant_id = p_cabinet and client_tenant_id = p_client and valid_to is null;
  select currency into v_devise from identity.organizations where id = p_cabinet;
  v_taux := app.honoraires_taux_du_pack(p_cabinet, p_taux_code);

  insert into collab.factures_honoraires
    (tenant_id, client_tenant_id, mandat_id, periode_du, periode_au, pack_version_id,
     taux_tva_code, taux_tva, devise)
  values (p_cabinet, p_client, v_mandat, p_du, p_au, v_taux.o_pack, p_taux_code, v_taux.o_taux, v_devise)
  returning id into v_id;

  perform app.honoraires_lignes_poser(v_id, p_cabinet, p_lignes);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'honoraires.brouillon_cree', 'collab', 'factures_honoraires', v_id,
          jsonb_build_object('client', p_client, 'periode_du', p_du, 'periode_au', p_au, 'taux', p_taux_code));
  return jsonb_build_object('id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_brouillon_modifier(p_id uuid, p_du date, p_au date, p_taux_code text, p_lignes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f      record;
  v_taux record;
begin
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'refus.honoraires.emise_figee'
      using errcode = '22023';
  end if;
  v_taux := app.honoraires_taux_du_pack(f.tenant_id, p_taux_code);

  update collab.factures_honoraires
     set periode_du = p_du, periode_au = p_au,
         pack_version_id = v_taux.o_pack, taux_tva_code = p_taux_code, taux_tva = v_taux.o_taux
   where id = p_id;
  perform app.honoraires_lignes_poser(p_id, f.tenant_id, p_lignes);
  return jsonb_build_object('id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_brouillon_supprimer(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f record;
begin
  select id, tenant_id, statut into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'refus.honoraires.emise_figee'
      using errcode = '22023';
  end if;
  delete from collab.factures_honoraires where id = p_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_encaisser(p_facture uuid, p_montant numeric, p_date date, p_moyen text, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f       record;
  v_id    uuid;
  v_deja  numeric(18,3);
  v_reste numeric(18,3);
  v_somme numeric(18,3);
begin
  select * into f from collab.factures_honoraires where id = p_facture;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'emise' then
    raise exception 'refus.honoraires.encaissable' using errcode = '22023';
  end if;
  if f.total_ttc <= 0 then
    raise exception 'refus.honoraires.avoir_non_encaissable' using errcode = '22023';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'refus.honoraires.montant_positif' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'refus.honoraires.date_requise' using errcode = '22023';
  end if;

  select coalesce(sum(montant), 0) into v_deja
    from collab.encaissements_honoraires where facture_id = p_facture;
  v_reste := f.total_ttc - v_deja;
  if p_montant > v_reste then
    raise exception '%', app.refus_avec_valeurs('refus.honoraires.trop_percu', 'montant', (p_montant)::text, 'reste', (v_reste)::text)
      using errcode = '22023';
  end if;

  insert into collab.encaissements_honoraires (tenant_id, facture_id, montant, encaisse_le, moyen, reference)
  values (f.tenant_id, p_facture, p_montant, p_date, p_moyen, nullif(btrim(p_reference), ''))
  returning id into v_id;

  v_somme := v_deja + p_montant;

  if v_somme >= f.total_ttc then
    perform set_config('malica.honoraires_transition', p_facture::text, true);
    update collab.factures_honoraires set statut = 'payee', payee_le = p_date where id = p_facture;
    perform set_config('malica.honoraires_transition', '', true);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.encaissement', 'collab', 'encaissements_honoraires', v_id,
          jsonb_build_object('facture', p_facture, 'numero', f.numero, 'montant', p_montant::text,
                             'date', p_date, 'moyen', p_moyen, 'soldee', v_somme >= f.total_ttc));
  -- Le montant voyage en texte : un nombre JSON deviendrait un flottant.
  return jsonb_build_object('id', v_id, 'encaisse', v_somme::text, 'soldee', v_somme >= f.total_ttc);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_facture_emettre(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f        record;
  v_delai  integer;
  v_numero text;
  v_jour   date := current_date;
begin
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.facture' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'refus.honoraires.deja_emise' using errcode = '22023';
  end if;
  if not exists (select 1 from collab.factures_honoraires_lignes where facture_id = p_id) then
    raise exception 'refus.honoraires.sans_ligne' using errcode = '22023';
  end if;
  if f.total_ht <= 0 then
    raise exception 'refus.honoraires.total_positif' using errcode = '22023';
  end if;

  -- Le délai : celui du mandat, ou à défaut aucun — l'échéance est le jour même.
  select delai_paiement_jours into v_delai
    from collab.mandats_honoraires where id = f.mandat_id;
  if v_delai is null then
    select delai_paiement_jours into v_delai
      from collab.mandats_honoraires
     where tenant_id = f.tenant_id and client_tenant_id = f.client_tenant_id and valid_to is null;
  end if;

  v_numero := app.honoraires_numero_suivant(f.tenant_id, v_jour);

  update collab.factures_honoraires
     set statut = 'emise', numero = v_numero, emise_le = v_jour,
         echeance_le = v_jour + coalesce(v_delai, 0)
   where id = p_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.facture_emise', 'collab', 'factures_honoraires', p_id,
          jsonb_build_object('numero', v_numero, 'client', f.client_tenant_id,
                             'total_ttc', f.total_ttc, 'echeance', v_jour + coalesce(v_delai, 0)));
  return jsonb_build_object('id', p_id, 'numero', v_numero);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_mandat_clore(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from collab.mandats_honoraires where id = p_id and valid_to is null;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.mandat.clos' using errcode = 'P0002';
  end if;
  update collab.mandats_honoraires set valid_to = current_date where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_tenant, auth.uid(), 'honoraires.mandat_clos', 'collab', 'mandats_honoraires', p_id, '{}'::jsonb);
  return jsonb_build_object('id', p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_mandat_definir(p_cabinet uuid, p_client uuid, p_mode text, p_frequence text, p_jour integer, p_forfait numeric, p_taux_horaire numeric, p_delai integer, p_couverture text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client and e.status = 'actif'
       and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
  ) then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '22023';
  end if;

  update collab.mandats_honoraires
     set valid_to = current_date
   where tenant_id = p_cabinet and client_tenant_id = p_client and valid_to is null;

  insert into collab.mandats_honoraires
    (tenant_id, client_tenant_id, mode, frequence, jour_facturation, forfait, taux_horaire,
     delai_paiement_jours, couverture)
  values
    (p_cabinet, p_client, p_mode, p_frequence, p_jour,
     case when p_mode in ('forfait', 'mixte') then p_forfait end,
     case when p_mode in ('temps', 'mixte') then p_taux_horaire end,
     p_delai,
     coalesce((select array_agg(btrim(c)) from unnest(p_couverture) c where btrim(c) <> ''), '{}'))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'honoraires.mandat_defini', 'collab', 'mandats_honoraires', v_id,
          jsonb_build_object('client', p_client, 'mode', p_mode, 'frequence', p_frequence,
                             'jour', p_jour, 'forfait', p_forfait, 'taux_horaire', p_taux_horaire,
                             'delai', p_delai, 'couverture', to_jsonb(p_couverture)));
  return jsonb_build_object('id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.honoraires_synthese_lire(p_cabinet uuid, p_mois text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_du date;
  v_au date;
  v    jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  v_du := to_date(p_mois || '-01', 'YYYY-MM-DD');
  v_au := (v_du + interval '1 month')::date;

  with emises as (
    select f.*, coalesce((select sum(e.montant) from collab.encaissements_honoraires e
                           where e.facture_id = f.id), 0) as encaisse
      from collab.factures_honoraires f
     where f.tenant_id = p_cabinet and f.statut <> 'brouillon'
  ),
  du_mois as (
    select coalesce(sum(total_ht), 0) as ht, coalesce(sum(total_ttc), 0) as ttc, count(*) as n
      from emises where emise_le >= v_du and emise_le < v_au
  ),
  encaisse as (
    select coalesce(sum(e.montant), 0) as montant, count(*) as n
      from collab.encaissements_honoraires e
     where e.tenant_id = p_cabinet and e.encaisse_le >= v_du and e.encaisse_le < v_au
  ),
  ouvertes as (
    select coalesce(sum(total_ttc - encaisse), 0) as reste, count(*) as n,
           coalesce(sum(total_ttc - encaisse) filter (where echeance_le < current_date), 0) as retard,
           count(*) filter (where echeance_le < current_date) as n_retard
      from emises where statut = 'emise' and total_ttc > 0
  ),
  brouillons as (
    select count(*) as n from collab.factures_honoraires
     where tenant_id = p_cabinet and statut = 'brouillon'
  )
  select jsonb_build_object(
           'mois', p_mois,
           'devise', (select currency from identity.organizations where id = p_cabinet),
           -- Les montants voyagent en texte : un nombre JSON deviendrait un flottant.
           'factureHt', du_mois.ht::text,
           'factureTtc', du_mois.ttc::text,
           'nbFactures', du_mois.n,
           'encaisse', encaisse.montant::text,
           'nbEncaissements', encaisse.n,
           'resteDu', ouvertes.reste::text,
           'nbOuvertes', ouvertes.n,
           'enRetard', ouvertes.retard::text,
           'nbRetard', ouvertes.n_retard,
           'tauxEncaissement', case when du_mois.ttc > 0
                                    then round(encaisse.montant / du_mois.ttc, 4)::text end,
           'nbBrouillons', brouillons.n)
    into v
    from du_mois, encaisse, ouvertes, brouillons;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.immo_bien_creer(p_tenant uuid, p_entity uuid, p_vis app.vis_t, p_piece uuid, p_category uuid, p_label text, p_mise_en_service date, p_valeur_brute numeric, p_valeur_residuelle numeric, p_method app.amort_method_t, p_duree_annees smallint, p_coefficient numeric, p_devise text, p_pack uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if nullif(btrim(p_label), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- L'établissement est celui de la société, jamais d'une autre (revue de #149).
  if p_entity is not null and not app.entite_de(p_tenant, p_entity) then
    raise exception 'refus.saisie.etablissement' using errcode = '42501';
  end if;
  insert into immo.assets (tenant_id, entity_id, vis, piece_id, category_id, label,
                           mise_en_service, valeur_brute, valeur_residuelle, method,
                           duree_annees, coefficient, devise, pack_version_id, created_by)
  values (p_tenant, p_entity, p_vis, p_piece, p_category, p_label, p_mise_en_service,
          p_valeur_brute, p_valeur_residuelle, p_method, p_duree_annees, p_coefficient,
          p_devise, p_pack, auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.immo_bien_modifier(p_id uuid, p_label text, p_mise_en_service date, p_valeur_brute numeric, p_valeur_residuelle numeric, p_method app.amort_method_t, p_duree_annees smallint, p_coefficient numeric, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if nullif(btrim(p_label), '') is null or nullif(btrim(p_status), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update immo.assets
     set label = p_label, mise_en_service = p_mise_en_service, valeur_brute = p_valeur_brute,
         valeur_residuelle = p_valeur_residuelle, method = p_method,
         duree_annees = p_duree_annees, coefficient = p_coefficient, status = p_status
   where id = p_id;
  if not found then
    raise exception 'refus.introuvable.immobilisation' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.immo_cession_inscrire(p_tenant uuid, p_asset uuid, p_at date, p_prix numeric, p_vnc numeric, p_resultat numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.immo_assets_v a where a.id = p_asset and a.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.immobilisation' using errcode = '42501';
  end if;
  insert into immo.cessions (tenant_id, asset_id, at, prix, vnc, resultat, created_by)
  values (p_tenant, p_asset, p_at, p_prix, p_vnc, p_resultat, auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.immo_depreciation_constater(p_asset uuid, p_at date, p_vnc numeric, p_valeur_recouvrable numeric, p_mouvement numeric, p_cumul numeric, p_pack_version uuid, p_note text DEFAULT NULL::text, p_journal text DEFAULT 'OD'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_deprec text;
  v_acc_dot text;
  v_acc_rep text;
  v_abs numeric;
  v_ecr uuid;
  v_dep uuid;
begin
  select a.tenant_id, a.entity_id, a.vis, a.devise, a.label,
         c.account_deprec, c.account_deprec_dotation, c.account_deprec_reprise
    into v_tenant, v_entity, v_vis, v_devise, v_label,
         v_acc_deprec, v_acc_dot, v_acc_rep
    from immo.assets a
    join ref.immo_categories c on c.id = a.category_id
   where a.id = p_asset;

  if v_tenant is null then
    raise exception 'refus.introuvable.immobilisation' using errcode = '42501';
  end if;
  if coalesce(p_mouvement, 0) = 0 then
    raise exception 'refus.immo.rien_a_constater' using errcode = 'check_violation';
  end if;

  v_abs := abs(p_mouvement);

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, p_at, v_devise,
          case when p_mouvement > 0 then 'Dépréciation — ' else 'Reprise de dépréciation — ' end
            || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if p_mouvement > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_dot, 'Dotation dépréciation — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_deprec, 'Dépréciation — ' || v_label, 0, v_abs);
  else
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_deprec, 'Dépréciation — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_rep, 'Reprise dépréciation — ' || v_label, 0, v_abs);
  end if;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into immo.depreciations (tenant_id, asset_id, at, vnc, valeur_recouvrable,
                                  mouvement, cumul, note, ecriture_id, created_by)
  values (v_tenant, p_asset, p_at, p_vnc, p_valeur_recouvrable, p_mouvement, p_cumul,
          p_note, v_ecr, auth.uid())
  returning id into v_dep;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'immo.depreciation_constatee', 'immo', 'depreciations',
          v_dep, p_pack_version,
          jsonb_build_object('asset_id', p_asset, 'at', p_at, 'mouvement', p_mouvement,
                             'ecriture_id', v_ecr, 'note', p_note));

  return jsonb_build_object('depreciation_id', v_dep, 'ecriture_id', v_ecr);
end $function$;

CREATE OR REPLACE FUNCTION public.immo_dotation_constater(p_asset uuid, p_exercice smallint, p_months smallint, p_dotation numeric, p_cumul numeric, p_vnc numeric, p_pack_version uuid, p_date date DEFAULT NULL::date, p_journal text DEFAULT 'OD'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_amort text;
  v_acc_dot text;
  v_date date;
  v_ecr uuid;
  v_dot uuid;
begin
  select a.tenant_id, a.entity_id, a.vis, a.devise, a.label,
         c.account_amort, c.account_dotation
    into v_tenant, v_entity, v_vis, v_devise, v_label, v_acc_amort, v_acc_dot
    from immo.assets a
    join ref.immo_categories c on c.id = a.category_id
   where a.id = p_asset;

  if v_tenant is null then
    raise exception 'refus.introuvable.immobilisation' using errcode = '42501';
  end if;
  if coalesce(p_dotation, 0) <= 0 then
    raise exception 'refus.immo.dotation_positive' using errcode = 'check_violation';
  end if;
  if exists (select 1 from immo.dotations d
              where d.asset_id = p_asset and d.exercice = p_exercice) then
    raise exception 'refus.immo.dotation_deja' using errcode = 'unique_violation';
  end if;

  if p_exercice > extract(year from current_date)::int then
    raise exception '%', app.refus_avec_valeurs('refus.immo.exercice_a_venir', 'exercice', (p_exercice)::text)
      using errcode = '22023', hint = 'immo.exercice_futur';
  end if;
  if p_date is not null and extract(year from p_date)::int <> p_exercice then
    raise exception '%', app.refus_avec_valeurs('refus.immo.date_hors_exercice', 'exercice', (p_exercice)::text)
      using errcode = '22023', hint = 'immo.date_hors_exercice';
  end if;

  v_date := coalesce(p_date, make_date(p_exercice::int, 12, 31));

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, v_date, v_devise,
          'Dotation aux amortissements ' || p_exercice::text || ' — ' || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                     libelle, debit, credit)
  values (v_tenant, v_ecr, 1, v_acc_dot, 'Dotation — ' || v_label, p_dotation, 0),
         (v_tenant, v_ecr, 2, v_acc_amort, 'Amortissements — ' || v_label, 0, p_dotation);

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into immo.dotations (tenant_id, asset_id, exercice, months, dotation, cumul,
                              vnc, ecriture_id, pack_version_id, created_by)
  values (v_tenant, p_asset, p_exercice, p_months, p_dotation, p_cumul, p_vnc,
          v_ecr, p_pack_version, auth.uid())
  returning id into v_dot;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'immo.dotation_constatee', 'immo', 'dotations', v_dot,
          p_pack_version,
          jsonb_build_object('asset_id', p_asset, 'exercice', p_exercice,
                             'dotation', p_dotation, 'ecriture_id', v_ecr));

  return jsonb_build_object('dotation_id', v_dot, 'ecriture_id', v_ecr);
end $function$;

CREATE OR REPLACE FUNCTION public.invitation_par_lien_accepter(p_jeton text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v.tenant_id, auth.uid(), v.role)
  on conflict (tenant_id, user_id) do nothing;
  -- Le dirigeant qui arrive est le titulaire naturel (20261022100000).
  if v.role = 'dirigeant' then
    perform facturation.licence_naitre(v.tenant_id, auth.uid(), null, current_date);
  end if;
  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', v.id,
          jsonb_build_object('role', v.role, 'par', 'lien'));

  return jsonb_build_object('tenantId', v.tenant_id, 'role', v.role);
end $function$;

CREATE OR REPLACE FUNCTION public.invitation_repondre(p_id uuid, p_accepte boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations where id = p_id;
  if v.id is null
     or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if v.accepted_at is not null or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;

  if p_accepte then
    insert into identity.memberships (tenant_id, user_id, role)
    values (v.tenant_id, auth.uid(), v.role)
    on conflict (tenant_id, user_id) do nothing;
    -- Le dirigeant qui arrive est le titulaire naturel (20261022100000).
    if v.role = 'dirigeant' then
      perform facturation.licence_naitre(v.tenant_id, auth.uid(), null, current_date);
    end if;
    update identity.invitations
       set accepted_at = now(), accepted_by = auth.uid()
     where id = p_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', p_id,
            jsonb_build_object('role', v.role));
    return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', true);
  end if;

  update identity.invitations set expires_at = now() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.decline', 'identity', 'invitations', p_id,
          jsonb_build_object('role', v.role));
  return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', false);
end $function$;

CREATE OR REPLACE FUNCTION public.journal_export_journaliser(p_cabinet uuid, p_client uuid, p_jour date, p_format text, p_numero integer, p_lignes integer, p_taille bigint, p_empreinte text, p_pack uuid, p_ecritures uuid[], p_contre_passees uuid[], p_ecart jsonb, p_fuseau text, p_nom_de_fichier text, p_type_mime text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id      uuid;
  v_dernier integer;
  v_cal     jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  perform 1 from app.export_mandats(p_cabinet, p_client);
  if p_format not in ('journal_csv', 'journal_xlsx') then
    raise exception 'refus.export.format_inconnu' using errcode = '22023';
  end if;
  -- Un jour à venir, dans le fuseau du cabinet, ne prend pas de numéro.
  v_cal := public.cabinet_fuseau_lire(p_cabinet);
  if (v_cal ->> 'aujourdhui') is null or p_jour > (v_cal ->> 'aujourdhui')::date then
    raise exception 'refus.export.jour_a_venir'
      using errcode = '22023';
  end if;
  if p_fuseau is distinct from (v_cal ->> 'fuseau') then
    raise exception 'refus.export.fuseau' using errcode = '22023';
  end if;

  select max(x.numero) into v_dernier
    from collab.exports x
   where x.tenant_id = p_cabinet
     and x.client_tenant_id is not distinct from p_client
     and x.du = p_jour and x.numero is not null;
  if p_numero <> coalesce(v_dernier, 0) + 1 then
    raise exception 'refus.export.concurrent'
      using errcode = '40001';
  end if;

  insert into collab.exports
    (tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
     pack_version_id, numero, ecritures, contre_passees, fuseau, nom_de_fichier, type_mime)
  values (p_cabinet, p_client, p_format, p_jour, p_jour, p_lignes, p_taille, p_empreinte,
          p_pack, p_numero, p_ecritures, p_contre_passees, p_fuseau, p_nom_de_fichier, p_type_mime)
  returning id into v_id;

  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'export.genere', 'collab', 'exports', v_id, p_pack,
          jsonb_build_object('format', p_format, 'client', p_client, 'jour', p_jour,
                             'numero', p_numero, 'lignes', p_lignes, 'taille', p_taille,
                             'empreinte', p_empreinte, 'fuseau', p_fuseau, 'ecart', p_ecart));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.justificatif_deplacer(p_piece uuid, p_paiement uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant    uuid;
  v_vis       app.vis_t;
  v_kind      text;
  v_cible     public.paiements_v;
  v_vis_cible app.vis_t;
  v_quittes   uuid[];
begin
  v_tenant := app.piece_qui_accompagne_garde(p_piece, false);
  select vis, document_kind into v_vis, v_kind from capture.pieces where id = p_piece;
  if v_kind = 'recu_de_paiement' then
    raise exception 'refus.recu.sans_reglement' using errcode = '22023';
  end if;

  -- Deux déplacements simultanés vers le même règlement : le second attend
  -- et voit la preuve du premier. Pas de `for update` : la table refuse
  -- l'UPDATE (R7), et PostgreSQL le soumettrait à cette politique.
  -- La pièce aussi : deux déplacements simultanés de la même preuve vers deux
  -- règlements feraient qu'une photo en prouve deux.
  perform pg_advisory_xact_lock(hashtextextended(p_piece::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_paiement::text, 0));

  select * into v_cible from public.paiements_v where id = p_paiement;
  if v_cible.id is null or v_cible.tenant_id <> v_tenant then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  if v_cible.eteint or v_cible.annule_paiement_id is not null
     or v_cible.montant_mineur is null or v_cible.moyen_code = 'non_paye' then
    raise exception 'refus.justificatif.reglement_eteint' using errcode = 'check_violation';
  end if;
  if v_cible.justificatif_piece_id is not null then
    raise exception 'refus.justificatif.reglement_deja_prouve' using errcode = 'check_violation';
  end if;
  -- La facture du règlement, c'est sa photo courante (revue Codex de #127).
  select vis into v_vis_cible from capture.pieces
   where id = app.version_courante(v_cible.piece_id);
  if (v_vis_cible = 'partage'::app.vis_t) <> (v_vis = 'partage'::app.vis_t) then
    raise exception 'refus.justificatif.autre_cote_du_cabinet' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(r), '{}') into v_quittes from app.reglements_prouves_par(p_piece) r;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, q, null, 'detache' from unnest(v_quittes) q;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  values (v_tenant, p_paiement, p_piece, 'rattache');

  perform app.poser_la_source(p_piece, app.version_courante(v_cible.piece_id));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_deplace', 'capture', 'pieces', p_piece,
          jsonb_build_object('vers', p_paiement, 'depuis', to_jsonb(v_quittes)));

  return jsonb_build_object('piece_id', p_piece, 'paiement_id', p_paiement);
end
$function$;

CREATE OR REPLACE FUNCTION public.justificatif_remplacer(p_ancien uuid, p_nouveau uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant    uuid;
  v_source    uuid;
  v_kind      text;
  v_tenant_n  uuid;
  v_reglements uuid[];
begin
  v_tenant := app.piece_qui_accompagne_garde(p_ancien, true);
  select source_piece_id, document_kind into v_source, v_kind
    from capture.pieces where id = p_ancien;
  if v_kind = 'recu_de_paiement' then
    raise exception 'refus.recu.produit' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_n from capture.pieces where id = p_nouveau;
  if v_tenant_n is null or v_tenant_n <> v_tenant or p_nouveau = p_ancien then
    raise exception 'refus.introuvable.justificatif'
      using errcode = '42501';
  end if;
  -- La nouvelle pièce est une photo de preuve qui vient d'être prise, et rien
  -- d'autre : jamais une facture lue, une pièce d'un autre côté du cabinet,
  -- ni une preuve qui prouve déjà quelque chose.
  if not exists (
       select 1 from capture.pieces n, capture.pieces a
        where n.id = p_nouveau and a.id = p_ancien
          and n.document_kind = 'justificatif_paiement'
          and n.status = 'capturee'
          and n.vis = a.vis
          and (n.source_piece_id is null or n.source_piece_id = a.source_piece_id))
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouveau)
     or exists (select 1 from public.paiements_v v where v.justificatif_piece_id = p_nouveau)
     or exists (select 1 from capture.recu_paiements r where r.piece_id = p_nouveau) then
    raise exception 'refus.justificatif.nouvelle_photo' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(r), '{}') into v_reglements from app.reglements_prouves_par(p_ancien) r;

  -- La nouvelle photo prend la place de l'ancienne, règlement par règlement :
  -- « le rattachement au règlement est gardé ».
  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, r, p_nouveau, 'rattache' from unnest(v_reglements) r;

  -- Sa source, s'il en a une et qu'elle change : par la porte.
  if v_source is not null
     and v_source is distinct from (select source_piece_id from capture.pieces
                                     where id = p_nouveau) then
    perform app.poser_la_source(p_nouveau, v_source);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_remplace', 'capture', 'pieces', p_nouveau,
          jsonb_build_object('remplace', p_ancien, 'reglements', to_jsonb(v_reglements)));

  -- La SEULE porte par laquelle une pièce disparaît ; ses lignes de preuve
  -- partent avec elle (cascade), et la nouvelle est déjà la dernière.
  perform public.capture_piece_supprimer(p_ancien, false);

  return jsonb_build_object('piece_id', p_nouveau, 'remplace', p_ancien);
end
$function$;

CREATE OR REPLACE FUNCTION public.lecture_autorisee(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Une version précédente ne se lit plus : sa lecture ne s'inscrirait nulle
  -- part (elle est gelée), et le modèle serait payé pour rien. Refus définitif.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_remplacee',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà lue ne reçoit pas de seconde lecture : le dire ICI, avant
  -- le modèle, et non après l'avoir payé. Avant les licences : le refus ne
  -- dépend ni du forfait ni du plafond.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_deja_lue',
      'restantes', null, 'droit', null);
  end if;

  return public.lecture_verdict(p_piece);
end
$function$;

CREATE OR REPLACE FUNCTION public.lecture_consommer(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant   uuid;
  v_licence  uuid;
  v_verdict  jsonb;
  v_motif    text;
  v_recharge uuid;
begin
  -- La porte, nommée, et d'abord. La RLS de `capture.pieces` ne s'applique
  -- plus ici : sans cette ligne, tout compte authentifié ferait compter la
  -- lecture d'une pièce qu'il n'a pas le droit de voir.
  if not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- La règle du plafond vit à UN seul endroit, et c'est ici qu'on l'invoque.
  v_verdict := public.lecture_verdict(p_piece);
  if not (v_verdict ->> 'autorisee')::boolean then
    raise exception '%', app.refus_avec_valeurs('refus.lecture.refusee', 'motif', (v_verdict ->> 'motif')::text)
      using errcode = 'check_violation';
  end if;

  v_motif := v_verdict ->> 'motif';
  if v_motif = 'relecture_gratuite' then
    return v_verdict;
  end if;

  -- Rien de ce qui s'écrit ne vient de l'appelant : le tenant est celui de la
  -- pièce, la licence est celle du tenant. C'est ce qui tient les sections 8
  -- et 9 sans la politique.
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;

  if v_motif in ('sur_recharge', 'recharge_automatique') then
    -- Deux lectures simultanées ne prennent pas la même dernière unité : on
    -- verrouille la licence avant de choisir (ou d'acheter) : les lectures sur
    -- recharge d'un même client passent l'une après l'autre.
    perform 1 from facturation.licences l where l.id = v_licence for update;

    -- Une lecture concurrente a pu acheter pendant l'attente : on n'en achète
    -- une que s'il n'en reste toujours aucune.
    if v_motif = 'recharge_automatique' and facturation.recharge_disponible(v_licence) = 0 then
      perform facturation.recharge_inscrire(
        v_licence, v_verdict ->> 'palier', 'automatique', auth.uid());
    end if;

    select r.recharge_id into v_recharge
      from facturation.recharges_v r
     where r.licence_id = v_licence and r.utilisable and r.restantes > 0
     order by r.expire_le, r.achetee_le, r.recharge_id
     limit 1;
    if v_recharge is null then
      raise exception '%', app.refus_avec_valeurs('refus.lecture.refusee', 'motif', 'plafond_atteint') using errcode = 'check_violation';
    end if;
  end if;

  insert into facturation.lectures
    (tenant_id, licence_id, piece_id, periode, consommee_par, recharge_id)
  values (v_tenant, v_licence, p_piece,
          date_trunc('month', current_date)::date, auth.uid(), v_recharge)
  on conflict (piece_id) do nothing;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'lecture.consommee', 'capture', 'pieces', p_piece,
          jsonb_build_object('licence_id', v_licence, 'recharge_id', v_recharge));

  return public.lecture_verdict(p_piece);
end
$function$;

CREATE OR REPLACE FUNCTION public.lecture_verdict(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant   uuid;
  v_vis      app.vis_t;
  v_licence  uuid;
  v_conso    record;
  v_deja     boolean;
  v_recharge integer;
  v_auto     text;
begin
  -- La RLS de `capture.pieces` ne s'applique plus ici : la lisibilité de la
  -- pièce pour l'appelant se demande à la fonction qui la porte.
  if not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- B6 : une pièce personnelle n'est jamais lue.
  if v_vis = 'personnel'::app.vis_t then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_personnelle',
      'restantes', null, 'droit', null);
  end if;

  -- 20 octobre 2026 : le reçu qu'on génère et le justificatif d'un paiement
  -- ACCOMPAGNENT une pièce, ils n'en sont pas une. Les lire consommait le
  -- forfait et rangeait le reçu en « facture d'achat ».
  if app.piece_accompagne(p_piece) then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_accompagnante',
      'restantes', null, 'droit', null);
  end if;

  -- Le doublon strict d'une pièce déjà lue n'apprend rien : même octets,
  -- même lecture. Il ne coûte pas une lecture de plus.
  if exists (select 1 from capture.pieces d
              where d.id = p_piece and d.doublon_de is not null
                and exists (select 1 from facturation.lectures l where l.piece_id = d.doublon_de))
  then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_en_double',
      'restantes', null, 'droit', null);
  end if;

  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;
  if v_licence is null then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  select * into v_conso from facturation.consommation_v where licence_id = v_licence;
  if v_conso.licence_id is null then
    -- Pas de ligne : on ne sait pas, donc on refuse. Jamais `true` par défaut.
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà comptée se relit sans rien coûter. C'est la correction
  -- gratuite, et c'est volontaire.
  select exists (select 1 from facturation.lectures where piece_id = p_piece)
    into v_deja;
  if v_deja then
    return jsonb_build_object(
      'autorisee', true, 'motif', 'relecture_gratuite',
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  -- Une licence suspendue n'arrête pas la caméra, elle arrête l'œil.
  if v_conso.statut <> 'active' then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'licence_' || v_conso.statut,
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  if v_conso.lectures_restantes <= 0 then
    v_recharge := facturation.recharge_disponible(v_licence);
    if v_recharge > 0 then
      return jsonb_build_object(
        'autorisee', true, 'motif', 'sur_recharge',
        'restantes', 0, 'droit', v_conso.lectures_droit,
        'recharge', v_recharge, 'licence_id', v_licence);
    end if;

    v_auto := facturation.recharge_automatique_possible(v_licence);
    if v_auto is not null then
      return jsonb_build_object(
        'autorisee', true, 'motif', 'recharge_automatique',
        'restantes', 0, 'droit', v_conso.lectures_droit,
        'recharge', 0, 'palier', v_auto, 'licence_id', v_licence);
    end if;

    return jsonb_build_object(
      'autorisee', false, 'motif', 'plafond_atteint',
      'restantes', 0, 'droit', v_conso.lectures_droit,
      'recharge', 0,
      'gelees', (select coalesce(sum(greatest(0, r.restantes)), 0)::int
                   from facturation.recharges_v r
                  where r.licence_id = v_licence and r.gelee),
      'licence_id', v_licence);
  end if;

  return jsonb_build_object(
    'autorisee', true, 'motif', 'dans_le_forfait',
    'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
    'licence_id', v_licence);
end
$function$;

CREATE OR REPLACE FUNCTION public.licence_transmettre(p_tenant uuid, p_nouveau uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_ancien  uuid;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  select l.id, l.titulaire into v_licence, v_ancien
    from facturation.licences l
    join facturation.licence_organisations lo on lo.licence_id = l.id
   where lo.tenant_id = p_tenant;

  if v_licence is null then
    raise exception 'refus.licence.absente' using errcode = '22023';
  end if;
  if v_ancien is distinct from auth.uid() then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if p_nouveau = v_ancien then
    raise exception 'refus.licence.deja_titulaire' using errcode = '22023';
  end if;
  -- On transmet à un propriétaire : quelqu'un qui dirige déjà une société de
  -- la licence. Pas à un inconnu, pas à un utilisateur.
  if not exists (
    select 1 from facturation.licence_organisations lo
    join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = v_licence and m.user_id = p_nouveau and m.role = 'dirigeant'
  ) then
    raise exception 'refus.licence.a_un_proprietaire' using errcode = '22023';
  end if;

  perform set_config('facturation.transmission', v_licence::text, true);
  update facturation.licences set titulaire = p_nouveau where id = v_licence;
  perform set_config('facturation.transmission', '', true);

  insert into facturation.transmissions (licence_id, de, a) values (v_licence, v_ancien, p_nouveau);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'licence.transmise', 'facturation', 'licences', v_licence,
          jsonb_build_object('de', v_ancien, 'a', p_nouveau));

  return v_licence;
end
$function$;

CREATE OR REPLACE FUNCTION public.mandat_proposer(p_cabinet uuid, p_legal_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_legal text := trim(p_legal_id);
  v_pme uuid;
  v_nom text;
  v_id uuid;
  v_status text;
  v_cabinet text;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v_legal = '' then
    raise exception 'refus.mandat.identifiant_fiscal_requis' using errcode = '22023';
  end if;
  select id, name into v_pme, v_nom
    from identity.organizations
   where kind = 'pme' and archived_at is null and legal_id = v_legal
   order by created_at limit 1;
  if v_pme is null then
    raise exception 'refus.mandat.pme_inconnue'
      using errcode = 'P0002';
  end if;

  select id, status into v_id, v_status
    from identity.engagements where pme_org_id = v_pme and cabinet_org_id = p_cabinet;

  -- Un mandat en cours, proposé ou suspendu : rien à reproposer.
  if v_id is not null and v_status <> 'termine' then
    return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                              'status', v_status, 'deja', true);
  end if;

  select name into v_cabinet from identity.organizations where id = p_cabinet;

  if v_id is null then
    insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
    values (v_pme, p_cabinet, 'propose', auth.uid())
    returning id into v_id;
  else
    -- Terminé ou refusé : la proposition renaît, la PME répondra à nouveau.
    update identity.engagements
       set status = 'propose', starts_on = current_date, ends_on = null
     where id = v_id;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('pme_org_id', v_pme));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_pme, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('cabinet_org_id', p_cabinet));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v_pme, 'mandat.propose',
          jsonb_build_object('engagement_id', v_id, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                            'status', 'propose', 'deja', false);
end $function$;

CREATE OR REPLACE FUNCTION public.mandat_repondre(p_engagement uuid, p_accepte boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_status text;
  v_cabinet text;
  v_pme text;
begin
  select id, pme_org_id, cabinet_org_id, status into v
    from identity.engagements where id = p_engagement;
  if v.id is null or v.pme_org_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.mandat' using errcode = '42501';
  end if;
  if v.status <> 'propose' then
    raise exception 'refus.mandat.deja_repondu' using errcode = '22023';
  end if;

  v_status := case when p_accepte then 'actif' else 'termine' end;
  update identity.engagements
     set status = v_status,
         starts_on = case when p_accepte then current_date else starts_on end,
         ends_on = case when p_accepte then null else current_date end
   where id = p_engagement;

  select name into v_cabinet from identity.organizations where id = v.cabinet_org_id;
  select name into v_pme from identity.organizations where id = v.pme_org_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.pme_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('pme_org_id', v.pme_org_id));
  -- Le cabinet lit les notifications de ses mandats : celle-ci lui dit la réponse.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.pme_org_id,
          case when p_accepte then 'mandat.accepte' else 'mandat.refuse' end,
          jsonb_build_object('engagement_id', p_engagement, 'cabinet', v_cabinet, 'client', v_pme));

  return jsonb_build_object('id', p_engagement, 'status', v_status);
end $function$;

CREATE OR REPLACE FUNCTION public.mandat_revoquer(p_tenant uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.mandat.motif_de_revocation' using errcode = '22023';
  end if;

  select e.id, e.cabinet_org_id
    into v
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
   order by e.created_at desc
   limit 1
   for update;

  if v.id is null then
    raise exception 'refus.mandat.aucun_actif' using errcode = '22023';
  end if;

  update identity.engagements
     set status = 'termine', ends_on = current_date
   where id = v.id;

  -- L'abonnement attribué par ce cabinet passe à la PME, le jour même
  -- (décision du 20 octobre 2026) : l'accès se termine, la licence reste la
  -- sienne, le cabinet cesse d'être payeur. Une proposition en attente tombe.
  update facturation.acces a
     set statut = 'termine', effet_au = current_date, motif_fin = 'revocation_client'
   where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
     and a.statut in ('actif', 'suspendu');
  update facturation.acces a
     set statut = 'termine',
         licence_id = (select lo.licence_id from facturation.licence_organisations lo
                        where lo.tenant_id = p_tenant),
         effet_du = current_date, effet_au = current_date, motif_fin = 'revocation_client'
   where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
     and a.statut = 'propose';
  if found or exists (select 1 from facturation.acces a
                       where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
                         and a.effet_au = current_date and a.motif_fin = 'revocation_client') then
    -- La PME est avertie : son abonnement continue, à sa charge, au prix public.
    insert into collab.notifications (tenant_id, kind, payload)
    values (p_tenant, 'acces.repris',
            jsonb_build_object('cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                               'offre', (select f.offre_code from facturation.forfait_courant_v f
                                           join facturation.licence_organisations lo on lo.licence_id = f.licence_id
                                          where lo.tenant_id = p_tenant)));
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id, 'motif', btrim(p_motif)));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('pme_org_id', p_tenant, 'motif', btrim(p_motif)));

  insert into collab.notifications (tenant_id, kind, payload)
  values (p_tenant, 'mandat.revoque',
          jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  -- Le cabinet aussi l'apprend, chez LUI : la notification du dossier client
  -- lui devient invisible à l'instant où le mandat se termine.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.cabinet_org_id, 'mandat.revoque',
          jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'pme_org_id', p_tenant,
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  return jsonb_build_object('id', v.id, 'statut', 'termine', 'le', current_date);
end
$function$;

CREATE OR REPLACE FUNCTION public.mes_preferences_ouvrir()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  insert into notif.preferences (user_id) values (auth.uid()) on conflict (user_id) do nothing;
end
$function$;

CREATE OR REPLACE FUNCTION public.mon_mandat(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  select e.id, e.status, e.starts_on, e.ends_on, o.name as comptabilite
    into v
    from identity.engagements e
    join identity.organizations o on o.id = e.cabinet_org_id
   where e.pme_org_id = p_tenant
     and e.status in ('actif', 'propose')
   order by (e.status = 'actif') desc, e.created_at desc
   limit 1;

  if v.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v.id,
    'comptabilite', v.comptabilite,
    'statut', v.status,
    'depuis', v.starts_on,
    'revocable', app.has_org_role(p_tenant, array['dirigeant']) and v.status = 'actif');
end
$function$;

CREATE OR REPLACE FUNCTION public.mon_profil_ecrire(p_prenom text, p_nom text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profil jsonb;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  insert into identity.profiles (user_id, prenom, nom)
  values (auth.uid(), nullif(btrim(p_prenom), ''), nullif(btrim(p_nom), ''))
  on conflict (user_id) do update set prenom = excluded.prenom, nom = excluded.nom
  returning jsonb_build_object('prenom', prenom, 'nom', nom, 'display_name', display_name)
    into v_profil;
  return v_profil;
end
$function$;

CREATE OR REPLACE FUNCTION public.notification_marquer_lue(p_notification uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
begin
  -- Ce que l'appelant voit, et rien d'autre : la politique de lecture de la
  -- notification tranche (membre, cabinet engagé, plateforme).
  select tenant_id into v_tenant from collab.notifications where id = p_notification;
  if v_tenant is null then
    raise exception 'refus.introuvable.notification' using errcode = '42501';
  end if;

  insert into collab.notification_lectures (tenant_id, notification_id)
  values (v_tenant, p_notification)
  on conflict do nothing;
end
$function$;

CREATE OR REPLACE FUNCTION public.organisation_definir(p_org uuid, p_name text, p_legal_id text, p_jurisdiction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_currency text;
  v_name text := trim(p_name);
  v_legal text := nullif(trim(coalesce(p_legal_id, '')), '');
begin
  if not app.has_org_role(p_org, array['dirigeant', 'expert']) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023';
  end if;
  select p.currency into v_currency
    from ref.jurisdiction_packs p
   where p.jurisdiction = p_jurisdiction and p.effective_from <= current_date
   order by p.effective_from desc limit 1;
  if v_currency is null then
    raise exception 'refus.referentiel.pack_absent' using errcode = '22023';
  end if;

  update identity.organizations
     set name = v_name, legal_id = v_legal, jurisdiction = p_jurisdiction, currency = v_currency
   where id = p_org;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_org, auth.uid(), 'organization.updated', 'identity', 'organizations', p_org,
          jsonb_build_object('name', v_name, 'legal_id', v_legal, 'jurisdiction', p_jurisdiction));

  return jsonb_build_object('id', p_org, 'name', v_name, 'legalId', v_legal,
                            'jurisdiction', p_jurisdiction, 'currency', v_currency);
end $function$;

CREATE OR REPLACE FUNCTION public.paiement_annuler(p_paiement uuid, p_motif uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant   uuid;
  v_entity   uuid;
  v_vis      app.vis_t;
  v_piece    uuid;
  v_moyen    text;
  v_pack     uuid;
  v_montant  bigint;
  v_devise   text;
  v_paye_le  date;
  v_annule   uuid;
  v_nouveau  uuid;
begin
  -- Pas de `for update` : PostgreSQL le soumet à la politique UPDATE, que
  -- cette table n'a pas (R7). La course est fermée par l'index unique
  -- `paiements_une_seule_annulation`, plus haut — les refus qui suivent sont
  -- là pour la phrase, pas pour la garantie.
  select tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
         montant_mineur, devise, paye_le, annule_paiement_id
    into v_tenant, v_entity, v_vis, v_piece, v_moyen, v_pack,
         v_montant, v_devise, v_paye_le, v_annule
    from capture.paiements where id = p_paiement;

  if v_tenant is null then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;

  -- On n'annule pas une annulation : la chaîne reste plate, et la vue
  -- calculable en une passe.
  if v_annule is not null then
    raise exception 'refus.paiement.deja_annulation' using errcode = '22023';
  end if;

  if exists (select 1 from capture.paiements where annule_paiement_id = p_paiement) then
    raise exception 'refus.paiement.deja_annule' using errcode = '22023';
  end if;

  if not exists (
    select 1 from ref.paiement_motifs_annulation
     where id = p_motif and valid_to is null
  ) then
    raise exception 'refus.motif.inconnu' using errcode = '22023';
  end if;

  -- L'annulation recopie le fait qu'elle éteint. Le montant reste positif —
  -- la contrainte l'exige, et l'intention n'est pas d'écrire un négatif mais
  -- de désigner un fait éteint.
  insert into capture.paiements
    (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
     montant_mineur, devise, paye_le, annule_paiement_id, annulation_motif_id)
  values
    (v_tenant, v_entity, v_vis, v_piece, v_moyen, v_pack,
     v_montant, v_devise, v_paye_le, p_paiement, p_motif)
  returning id into v_nouveau;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.annule', 'capture', 'paiements',
          p_paiement, jsonb_build_object('annulation_id', v_nouveau, 'motif_id', p_motif));

  return jsonb_build_object('paiement_id', p_paiement, 'annulation_id', v_nouveau);
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_corriger(p_paiement uuid, p_motif uuid, p_moyen text, p_montant bigint, p_paye_le date, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ancien  capture.paiements;
  v_nouveau uuid;
begin
  select * into v_ancien from capture.paiements where id = p_paiement;
  if v_ancien.id is null then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  if v_ancien.moyen_code = 'non_paye' then
    raise exception 'paiement.non_paye_ne_se_corrige_pas' using errcode = 'check_violation';
  end if;
  if not coalesce((select m.remplace from ref.paiement_motifs_annulation m where m.id = p_motif), false) then
    raise exception 'paiement.motif_qui_retire' using errcode = 'check_violation';
  end if;

  -- L'ancien d'abord : le total réglé est jugé sans lui, et rien n'existe
  -- entre les deux écritures pour un autre lecteur.
  perform public.paiement_annuler(p_paiement, p_motif);

  insert into capture.paiements
    (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
     montant_mineur, devise, paye_le, reference)
  values
    (v_ancien.tenant_id, v_ancien.entity_id, v_ancien.vis, v_ancien.piece_id, p_moyen,
     v_ancien.pack_version_id, p_montant, v_ancien.devise, p_paye_le, nullif(trim(p_reference), ''))
  returning id into v_nouveau;

  return v_nouveau;
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_inscrire(p_paiement uuid, p_etat text, p_prestataire text, p_reference text DEFAULT NULL::text, p_lien text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb, p_moyen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_presta  facturation.prestataires_paiement;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  select * into v_presta from facturation.prestataires_paiement where code = p_prestataire;
  if not found or not v_presta.ouvre_le_paiement then
    raise exception 'refus.paiement.prestataire_inconnu' using errcode = 'check_violation';
  end if;
  -- Un prestataire qui ne fait entrer aucun argent n'est admis que si l'API l'a
  -- déclaré pour la transaction, ce qu'elle ne fait que si la tour l'a ouvert.
  if not v_presta.fait_entrer_argent
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'refus.paiement.simulateur_ferme' using errcode = '42501';
  end if;
  -- Le lien se crée pour un moyen choisi, actif, que ce prestataire accepte.
  if p_etat = 'lien_cree' and not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  -- « Payé » ou « refusé » se constate chez le prestataire qui a créé le lien,
  -- et chez lui seul : un simulateur ouvert après coup ne solde pas un
  -- paiement parti chez un prestataire réel (dont le vrai « payé » serait
  -- ensuite refusé par l'index « payé une fois »).
  if p_etat in ('paye', 'refuse') and p_prestataire is distinct from (
       select e.prestataire from facturation.paiement_evenements e
        where e.paiement_id = p_paiement and e.etat = 'lien_cree'
        order by e.le desc, e.id desc limit 1) then
    raise exception 'paiement.prestataire_du_lien' using errcode = 'check_violation';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail, moyen)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb),
          case when p_etat = 'lien_cree' then p_moyen end);

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.recu', 'facturation',
           'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from (select 1) un
      left join lateral (
        select x.tenant_id from facturation.licence_organisations x
         where x.licence_id = v_licence order by x.tenant_id limit 1) lo on true
     where coalesce(v_payeur, lo.tenant_id) is not null;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_inscrire(p_piece uuid, p_moyen text, p_pack uuid, p_montant_mineur bigint, p_devise text, p_paye_le date, p_justificatif uuid, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.ref_payment_means_v m
                  where m.pack_version_id = p_pack and m.code = p_moyen
                    and m.valid_from <= coalesce(p_paye_le, current_date)
                    and (m.valid_to is null or m.valid_to >= coalesce(p_paye_le, current_date))) then
    raise exception '%', app.refus_avec_valeurs('refus.paiement.moyen_inconnu', 'moyen', (p_moyen)::text)
      using errcode = '22023';
  end if;
  insert into capture.paiements (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
                                 montant_mineur, devise, paye_le, justificatif_piece_id, reference)
  select p.tenant_id, p.entity_id, p.vis, p.id, p_moyen, p_pack, p_montant_mineur, p_devise,
         p_paye_le, p_justificatif, p_reference
    from public.pieces_v p
   where p.id = p_piece
     -- Le justificatif est une pièce de la même société (revue de #149).
     and (p_justificatif is null
          or exists (select 1 from public.pieces_v j
                      where j.id = p_justificatif and j.tenant_id = p.tenant_id))
  returning id into v_id;
  if v_id is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_montee_preparer(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence  uuid;
  v_cour     record;
  v_prec     record;
  v_neuf     numeric;
  v_ancien   numeric;
  v_jours    int;
  v_restants int;
  v_ht       numeric;
  f          record;
  v_id       uuid;
begin
  select l.id into v_licence
    from facturation.licences l
    join facturation.licence_organisations lo on lo.licence_id = l.id
   where l.titulaire = auth.uid() and (p_tenant is null or lo.tenant_id = p_tenant)
   order by l.id limit 1;
  -- La porte, nommée (`schema.test.ts`) : dirigeant d'une société de la
  -- licence, ET son propriétaire principal.
  if v_licence is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(v_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  select h.id, h.offre_code, h.offre_depuis, h.effet_du, h.motif into v_cour
    from facturation.forfait_courant_v h where h.licence_id = v_licence;
  if v_cour.motif is distinct from 'montee' then
    return null;   -- rien à payer maintenant : pas de montée en cours.
  end if;

  -- Déjà préparé : on le rend tel quel.
  select p.id into v_id from facturation.paiements_en_ligne p where p.forfait_id = v_cour.id;
  if v_id is not null then
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end if;

  select h.offre_code, h.offre_depuis into v_prec
    from facturation.forfait_historique h
   where h.licence_id = v_licence and h.effet_au = v_cour.effet_du and h.id <> v_cour.id
   order by h.created_at desc, h.id desc limit 1;
  if v_prec.offre_code is null then
    return null;
  end if;

  v_neuf   := (ref.offre_a(v_cour.offre_code, v_cour.offre_depuis)).prix_mensuel_ht;
  v_ancien := (ref.offre_a(v_prec.offre_code, v_prec.offre_depuis)).prix_mensuel_ht;
  v_jours  := extract(day from (date_trunc('month', v_cour.effet_du) + interval '1 month'
                                - interval '1 day'))::int;
  v_restants := v_jours - extract(day from v_cour.effet_du)::int + 1;
  v_ht := round((v_neuf - v_ancien) * v_restants / v_jours, 3);
  if v_ht <= 0 then
    return null;
  end if;

  -- Sans émetteur désigné, ALGORIA ne facture pas encore : rien ne se prépare,
  -- et on ne suppose aucune TVA (R4). L'offre reste ouverte ; la tour désigne
  -- l'émetteur, et le paiement suivra la facture.
  if not exists (select 1 from facturation.emetteurs e where e.valide_des <= v_cour.effet_du) then
    return null;
  end if;

  select * into f from facturation.fiscalite_en_vigueur(v_cour.effet_du);

  insert into facturation.paiements_en_ligne
    (licence_id, objet, forfait_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
     devise, cree_par)
  values
    (v_licence, 'montee', v_cour.id,
     'Passage ' || initcap(v_prec.offre_code) || ' -> ' || initcap(v_cour.offre_code)
       || ' — ' || v_restants || '/' || v_jours || ' jours',
     v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
  returning id into v_id;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_moyen_admis(p_moyen text, p_prestataire text, p_devise text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  if not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  select jsonb_build_object('iso_numerique', d.iso_numerique, 'exposant', d.exposant) into v
    from ref.devises d where d.code = p_devise;
  if v is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.devise_inconnue', 'devise', (p_devise)::text) using errcode = 'no_data_found';
  end if;
  return v;
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_rattacher_justificatif(p_paiement uuid, p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_tenant_preuve uuid;
begin
  select tenant_id into v_tenant from capture.paiements where id = p_paiement;
  if v_tenant is null then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_preuve from capture.pieces where id = p_piece;
  if v_tenant_preuve is null or v_tenant_preuve <> v_tenant then
    raise exception 'refus.introuvable.justificatif'
      using errcode = '42501';
  end if;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id)
  values (v_tenant, p_paiement, p_piece);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_rattache', 'capture', 'paiements',
          p_paiement, jsonb_build_object('piece_id', p_piece));

  return jsonb_build_object('paiement_id', p_paiement, 'piece_id', p_piece);
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_recharge_preparer(p_recharge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r    record;
  f    record;
  v_id uuid;
begin
  select x.* into r from facturation.recharges x where x.id = p_recharge;
  if r.id is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = r.licence_id
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(r.licence_id) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if r.prix_ht <= 0 then
    return null;   -- offerte par la plateforme : rien à payer.
  end if;
  if not exists (select 1 from facturation.emetteurs e where e.valide_des <= r.achetee_le) then
    return null;   -- pas encore d'émetteur : la facture du mois portera la recharge.
  end if;

  select p.id into v_id from facturation.paiements_en_ligne p where p.recharge_id = r.id;
  if v_id is null then
    select * into f from facturation.fiscalite_en_vigueur(r.achetee_le);
    insert into facturation.paiements_en_ligne
      (licence_id, objet, recharge_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (r.licence_id, 'recharge', r.id, 'Recharge ' || r.lectures || ' lectures',
       r.prix_ht, f.taux, round(r.prix_ht * f.taux, 3), r.prix_ht + round(r.prix_ht * f.taux, 3),
       f.devise, auth.uid())
    returning id into v_id;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_demander(p_piece uuid, p_objet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_auteur uuid;
  v_etape text;
  v_dernier text;
begin
  select tenant_id, vis, status, created_by into v_tenant, v_vis, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or v_tenant not in (select app.member_orgs())
     or not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    v_etape := 'cabinet';
    -- Une pièce qu'on n'a pas envoyée se reprend sans demander.
    if v_vis <> 'partage'::app.vis_t then
      raise exception 'refus.piece.non_partagee'
        using errcode = 'check_violation';
    end if;
  elsif app.a_le_droit(v_tenant, 'envoi.proprietaire') and v_auteur = auth.uid() then
    v_etape := 'proprietaire';
    -- Dans la société, il ne demande que ce qui est parti chez le propriétaire.
    if v_vis = 'personnel'::app.vis_t
       or (v_vis = 'entite'::app.vis_t
           and (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee') then
      raise exception 'refus.piece.non_partagee'
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Prise en charge, elle se demande : le comptable qui accorde contre-passe.
  -- Un règlement inscrit, lui, engage un paiement réel : il s'annule d'abord.
  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and e.status = 'booked'
                and app.ecriture_vivante(e.id)) then
    raise exception '%', case when p_objet = 'rappel' then 'refus.rappel.inscrite'
                              else 'refus.suppression.inscrite' end
      using errcode = 'check_violation';
  end if;

  select d.fait into v_dernier from app.derniere_demande(p_piece, p_objet, v_etape) d;
  if v_dernier = 'demandee' then
    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', true,
                              'etape', v_etape);
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape)
  values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), v_etape);

  if v_etape = 'cabinet' then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.demande',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
  else
    perform app.notifier_les_receveurs(v_tenant, 'piece.demande',
                                       jsonb_build_object('piece_id', p_piece, 'objet', p_objet,
                                                          'chez', 'proprietaire'));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', false,
                            'etape', v_etape);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_detacher(p_piece uuid, p_liee uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_paire record;
begin
  perform 1 from capture.pieces
   where id in (p_piece, p_liee) order by id for update;
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if p_motif is null or length(trim(p_motif)) = 0 then
    raise exception 'refus.rattachement.motif'
      using errcode = 'check_violation';
  end if;
  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if not found or v_paire.fait <> 'rattache' then
    raise exception 'refus.rattachement.absent'
      using errcode = 'check_violation';
  end if;
  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, motif, auteur)
  values (v_tenant, p_piece, p_liee, 'detache', trim(p_motif), auth.uid());
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_envoyer(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_r      jsonb;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    if v_vis = 'partage'::app.vis_t and v_status = 'retournee' then
      return public.piece_renvoyer(p_piece) || jsonb_build_object('chez', 'cabinet');
    end if;
    v_r := public.capture_piece_set_vis(p_piece, 'partage'::app.vis_t);
    return jsonb_build_object('piece_id', p_piece, 'le', now(),
                              'deja', not (v_r ->> 'changed')::boolean, 'chez', 'cabinet');
  end if;
  return app.envoyer_au_proprietaire(p_piece);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_qui_accompagne(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_piece      capture.pieces;
  v_genre      text;
  v_mere       uuid;
  v_reglements uuid[];
  v_mere_json  jsonb;
  v_regl_json  jsonb;
  v_annulation jsonb;
  v_candidats  jsonb := '[]'::jsonb;
begin
  select * into v_piece from capture.pieces where id = p_piece;
  if v_piece.id is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if not app.piece_accompagne(p_piece) then
    return null;
  end if;

  select coalesce(array_agg(r), '{}') into v_reglements from app.reglements_prouves_par(p_piece) r;

  v_genre := case
    when v_piece.document_kind = 'recu_de_paiement' then 'recu'
    when cardinality(v_reglements) > 0 or v_piece.document_kind = 'justificatif_paiement'
      then 'justificatif'
    -- Une pièce née d'une autre, sans type et sans règlement : les reçus
    -- produits avant que le type ne soit déclaré.
    when v_piece.source_piece_id is not null then 'recu'
    else 'justificatif'
  end;

  if v_genre = 'recu' then
    select coalesce(array_agg(rp.paiement_id), '{}') into v_reglements
      from capture.recu_paiements rp where rp.piece_id = p_piece;
    v_mere := v_piece.source_piece_id;
  else
    -- Le justificatif suit son règlement : sa pièce est la mère.
    v_mere := coalesce(
      (select p.piece_id from capture.paiements p where p.id = any (v_reglements)
        order by p.created_at limit 1),
      v_piece.source_piece_id);
  end if;
  -- La mère, c'est sa photo courante : un règlement saisi sur une photo
  -- reprise mène à celle qui l'a remplacée (revue Codex de #127).
  v_mere := app.version_courante(v_mere);

  select jsonb_build_object(
           'id', m.id,
           'typeDeDocument', coalesce(m.document_kind, x.payload ->> 'document_kind'),
           'emetteur', x.payload ->> 'issuer',
           'date', x.payload ->> 'document_date',
           'ttc', x.payload #>> '{totals,ttc}',
           'devise', x.payload ->> 'currency')
    into v_mere_json
    from capture.pieces m
    left join lateral (
      select e.payload from public.extractions_v e
       where e.piece_id = m.id and e.contract like 'extract.v1%'
       order by e.created_at desc limit 1
    ) x on true
   where m.id = v_mere;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'moyenCode', v.moyen_code,
           'montantMineur', v.montant_mineur,
           'devise', v.devise,
           'payeLe', v.paye_le,
           'eteint', v.eteint) order by v.paye_le, v.created_at), '[]'::jsonb)
    into v_regl_json
    from public.paiements_v v
   where v.id = any (v_reglements);

  -- La première extinction : le règlement d'origine annulé, sa date et son motif.
  select jsonb_build_object(
           'paiementId', v.id,
           'le', a.created_at,
           'motifCode', m.code)
    into v_annulation
    from public.paiements_v v
    join capture.paiements a on a.annule_paiement_id = v.id
    join ref.paiement_motifs_annulation m on m.id = a.annulation_motif_id
   where v.id = any (v_reglements)
   order by a.created_at
   limit 1;

  if v_genre = 'justificatif' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'moyenCode', c.moyen_code,
             'montantMineur', c.montant_mineur,
             'devise', c.devise,
             'payeLe', c.paye_le,
             'pieceId', c.piece_id,
             'tiers', c.tiers) order by c.paye_le desc, c.created_at desc), '[]'::jsonb)
      into v_candidats
      from (
        -- La facture d'un règlement candidat : sa photo courante — son tiers,
        -- son côté du cabinet, et le lien de l'écran.
        select v.id, v.moyen_code, v.montant_mineur, v.devise, v.paye_le, f.id as piece_id,
               v.created_at,
               (select e.payload ->> 'issuer' from public.extractions_v e
                 where e.piece_id = f.id and e.contract like 'extract.v1%'
                 order by e.created_at desc limit 1) as tiers
          from public.paiements_v v
          join capture.pieces f on f.id = app.version_courante(v.piece_id)
         where v.tenant_id = v_piece.tenant_id
           and not v.eteint
           and v.annule_paiement_id is null
           and v.montant_mineur is not null
           and v.moyen_code <> 'non_paye'
           and v.justificatif_piece_id is null
           and not (v.id = any (v_reglements))
           and ((f.vis = 'partage'::app.vis_t) = (v_piece.vis = 'partage'::app.vis_t))
         order by v.paye_le desc, v.created_at desc
         limit 50
      ) c;
  end if;

  return jsonb_build_object(
    'genre', v_genre,
    'vis', v_piece.vis,
    'creeLe', v_piece.created_at,
    'mere', v_mere_json,
    'reglements', v_regl_json,
    'vaut', v_annulation is null,
    'annulation', v_annulation,
    'candidats', v_candidats);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_rattacher(p_piece uuid, p_liee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_tenant_liee uuid;
  v_vis app.vis_t;
  v_vis_liee app.vis_t;
  v_paire record;
begin
  if p_piece = p_liee then
    raise exception 'refus.rattachement.a_elle_meme'
      using errcode = 'check_violation';
  end if;
  -- Les deux lignes sont verrouillées dans un ordre fixe : deux rattachements
  -- croisés (A→B et B→A au même instant) ne s'attendent pas l'un l'autre.
  perform 1 from capture.pieces
   where id in (p_piece, p_liee) order by id for update;
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  select tenant_id, vis into v_tenant_liee, v_vis_liee from capture.pieces where id = p_liee;
  if v_tenant is null or v_tenant_liee is null
     or v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_tenant <> v_tenant_liee then
    raise exception 'refus.rattachement.autre_dossier'
      using errcode = 'check_violation';
  end if;
  if v_vis = 'personnel'::app.vis_t or v_vis_liee = 'personnel'::app.vis_t then
    raise exception
      'refus.rattachement.espace_prive'
      using errcode = 'check_violation';
  end if;

  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if found and v_paire.fait = 'rattache' then
    return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', true);
  end if;

  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
  values (v_tenant, p_piece, p_liee, 'rattache', auth.uid());
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', false);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
  n record;
begin
  -- Les deux lignes, dans un ordre fixe : deux remplacements croisés ne
  -- s'attendent pas l'un l'autre.
  perform 1 from capture.pieces where id in (p_ancienne, p_nouvelle) order by id for update;
  select * into a from capture.pieces where id = p_ancienne;
  select * into n from capture.pieces where id = p_nouvelle;

  -- L'ancienne n'est plus là pour celui qui la reprend — retirée, archivée,
  -- jamais vue : la reprise le dit par son code (la file hors ligne propose
  -- alors de garder la photo comme une pièce à part).
  if a.id is null or not app.piece_lisible(p_ancienne) then
    raise exception 'refus.remplacement.introuvable' using errcode = 'P0002';
  end if;

  -- `security definer` court-circuite la RLS : le contrôle est refait ici.
  if n.id is null or p_ancienne = p_nouvelle
     or a.tenant_id <> n.tenant_id
     or a.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  if exists (select 1 from capture.remplacements r
              where r.piece_id = p_ancienne and r.remplacee_par = p_nouvelle) then
    return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', true);
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_ancienne) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Un reçu, un justificatif : ils ont leur propre reprise (`justificatif_remplacer`).
  if a.source_piece_id is not null or app.piece_accompagne(p_ancienne) then
    raise exception 'refus.remplacement.accompagne' using errcode = 'check_violation';
  end if;

  -- Une pièce prise en charge porte une écriture : le cabinet la retourne
  -- d'abord (contre-passation), puis la photo se reprend.
  if a.status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_ancienne))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.remplacement.inscrite' using errcode = 'check_violation';
  end if;

  -- La nouvelle est une photo qui vient d'être prise, par celui qui remplace,
  -- et rien d'autre : jamais une pièce lue, issue d'une autre, ou déjà liée.
  if n.status <> 'capturee'
     or n.created_by is distinct from auth.uid()
     or n.source_piece_id is not null
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouvelle)
     or exists (select 1 from capture.remplacements r
                 where r.remplacee_par = p_nouvelle or r.piece_id = p_nouvelle) then
    raise exception 'refus.remplacement.nouvelle_photo' using errcode = 'check_violation';
  end if;

  -- Qui reprend la photo est inscrit ici (`auteur`) ; la pièce, elle, reste
  -- à l'auteur de l'ancienne.
  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  -- La nouvelle hérite du partage de l'ancienne : ce n'est pas une nouvelle
  -- transmission, et un impayé ne doit pas empêcher de corriger une pièce
  -- déjà envoyée. Les déclencheurs le lisent au fait inscrit juste au-dessus
  -- (`app.remplacement_en_cours`), jamais à un réglage de session.
  update capture.pieces
     set vis = a.vis,
         entity_id = coalesce(n.entity_id, a.entity_id),
         transmise_le = a.transmise_le,
         gardee_le = a.gardee_le,
         -- La pièce d'un siège reprise par le dirigeant reste celle du siège.
         created_by = a.created_by,
         -- Le retour en cours suit la photo ; sinon, elle part en lecture.
         status = case when a.status = 'retournee' then 'retournee' else 'capturee' end,
         -- Le type déclaré suit, à confirmer : la lecture aura le dernier mot.
         document_kind = coalesce(n.document_kind, a.document_kind),
         document_kind_statut = case
           when n.document_kind is not null then n.document_kind_statut
           when a.document_kind is not null then 'a_confirmer'
           else n.document_kind_statut end,
         updated_at = now()
   where id = p_nouvelle;

  -- Les documents rattachés à l'ancienne ne se recopient pas : `rattachements_v`
  -- les lit à travers la version courante.

  -- Une demande en attente sur l'ancienne n'a plus d'objet : on inscrit le
  -- fait qui la clôt, À SON ÉTAPE (au propriétaire, au comptable) — la ligne
  -- « demandee » reste, R7. L'état se lit par étape (`app.etat_des_demandes`).
  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  select a.tenant_id, p_ancienne, e.objet, 'retiree', null, auth.uid(), e.etape
    from app.etat_des_demandes(p_ancienne) e
   where e.fait = 'demandee';

  perform app.piece_oublie_ses_propositions(p_ancienne);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (a.tenant_id, auth.uid(), 'piece.remplacee', 'capture', 'pieces', p_nouvelle,
          jsonb_build_object('remplace', p_ancienne, 'vis', a.vis, 'status', a.status));

  if a.vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (a.tenant_id, 'piece.remplacee',
            jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne));
  end if;

  return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', false);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_renvoyer(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Le retour du propriétaire : le siège la lui renvoie.
  if v_vis = 'entite'::app.vis_t
     and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'retournee' then
    return app.envoyer_au_proprietaire(p_piece);
  end if;

  if v_vis <> 'partage'::app.vis_t or v_status <> 'retournee' then
    raise exception 'refus.renvoi.sans_retour' using errcode = 'check_violation';
  end if;
  -- Seul qui transmet au comptable lui renvoie : le siège fait le geste, le
  -- propriétaire renvoie.
  if not app.a_le_droit(v_tenant, 'envoi.cabinet') then
    raise exception 'refus.envoi.reserve_au_proprietaire'
      using errcode = '42501', hint = 'envoi.proprietaire';
  end if;

  perform app.piece_oublie_ses_propositions(p_piece);

  update capture.pieces
     set status = app.statut_hors_retour(p_piece), updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.renvoyee', 'capture', 'pieces', p_piece, '{}'::jsonb);

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.renvoyee', jsonb_build_object('piece_id', p_piece));

  return jsonb_build_object('piece_id', p_piece, 'le', now());
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_repondre(p_piece uuid, p_objet text, p_accorde boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_auteur  uuid;
  v_dernier record;
  v_demandeur uuid;
  v_relayee boolean := false;
  v_vivante uuid;
begin
  if p_accorde is null then
    raise exception 'refus.reponse.sans_decision' using errcode = 'check_violation';
  end if;
  if not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;
  select tenant_id, vis, created_by into v_tenant, v_vis, v_auteur
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Le propriétaire tranche la demande d'un siège. Un membre de la société
  -- ne tranche rien d'autre : la demande faite au cabinet n'est pas à lui (nul
  -- ne tranche sa propre demande).
  if v_tenant in (select app.member_orgs()) then
    select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'proprietaire');
    if v_dernier.fait is distinct from 'demandee' then
      raise exception 'refus.reserve.cabinet_mandate'
        using errcode = '42501';
    end if;
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') then
      raise exception 'refus.reserve.proprietaire'
        using errcode = '42501';
    end if;
    v_demandeur := v_dernier.auteur;

    -- Accordée sur une pièce chez le comptable, la demande y part : un fait.
    v_relayee := p_accorde and v_vis = 'partage'::app.vis_t;
    insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape,
                                           transmise)
    values (v_tenant, p_piece, p_objet,
            case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(),
            'proprietaire', v_relayee);

    if v_relayee then
      -- Chez le comptable : la demande part d'elle-même, au nom du propriétaire.
      if (select d.fait from app.derniere_demande(p_piece, p_objet, 'cabinet') d)
         is distinct from 'demandee' then
        -- Après l'accord, dans la même transaction : l'heure de l'horloge, pas
        -- celle de la transaction, pour que la suite des faits garde son ordre.
        insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape,
                                               created_at)
        values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), 'cabinet', clock_timestamp());
        insert into collab.notifications (tenant_id, kind, payload)
        values (v_tenant, 'piece.demande',
                jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
      end if;
    elsif p_accorde and p_objet = 'rappel' then
      -- Rendue au siège, dans la société : à envoyer de nouveau.
      insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
      values (v_tenant, p_piece, 'rappelee', auth.uid(), app.prenom_au_moment(auth.uid()));
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'proprietaire'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'proprietaire') d)
             = 'demandee';
    end if;

    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_demandeur, 'piece.demande_tranchee',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note, 'chez', 'proprietaire',
                               'transmise', v_relayee));

    if p_accorde and p_objet = 'suppression' and not v_relayee then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;

    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                              'transmise', v_relayee);
  end if;

  -- Le comptable : repris de `20261029100000`, sur les demandes qui lui sont faites.
  if v_tenant not in (select app.engaged_orgs()) then
    raise exception 'refus.reserve.cabinet_mandate'
      using errcode = '42501';
  end if;

  select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'cabinet');
  if v_dernier.fait is distinct from 'demandee' then
    raise exception 'refus.piece.aucune_demande'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(), 'cabinet');

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                             'note', p_note));

  -- La demande venait d'un siège, que son propriétaire a fait partir ici : il
  -- apprend la réponse. L'état par étape le dit (`transmise`).
  select e.demandeur into v_demandeur
    from app.etat_des_demandes(p_piece) e
   where e.objet = p_objet and e.etape = 'proprietaire' and e.transmise;
  if v_demandeur is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_demandeur, 'piece.demande_tranchee',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note));
  end if;

  if p_accorde then
    -- Prise en charge : son écriture se contre-passe au journal du jour, puis
    -- la pièce revient ou s'archive (spec §3).
    select e.id into v_vivante
      from socle.ecritures e
     where e.piece_id in (select app.versions_de_la_piece(p_piece))
       and e.nature = 'piece'
       and app.ecriture_vivante(e.id)
     limit 1;
    if v_vivante is not null then
      perform public.socle_ecriture_contre_passer(
        v_vivante, (select m.id from ref.rejet_motifs m where m.code = 'retrait_accorde'));
      update capture.pieces
         set status = app.statut_hors_retour(p_piece), updated_at = now()
       where id = p_piece;
    end if;

    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t, true);
      -- Rendue à la société ; la pièce d'un siège lui revient « à envoyer ».
      if v_demandeur is not null then
        insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
        values (v_tenant, p_piece, 'rappelee', auth.uid(), app.nom_au_moment(auth.uid()));
      end if;
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'cabinet'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'cabinet') d)
             = 'demandee';
    elsif p_objet = 'suppression' then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_repondre_au_cabinet(p_piece uuid, p_texte text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_au_proprietaire boolean;
begin
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs())
     or not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- Jamais NULL : une pièce qui n'est jamais entrée dans le passage n'a
  -- personne à qui répondre (revue Codex de #146).
  v_au_proprietaire := coalesce(v_vis = 'entite'::app.vis_t
    and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'retournee', false);
  if v_vis <> 'partage'::app.vis_t and not v_au_proprietaire then
    raise exception 'refus.piece.non_partagee'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_texte), '') = '' then
    raise exception 'refus.reponse.vide' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.reponse_client', 'capture', 'pieces', p_piece,
          jsonb_build_object('texte', btrim(p_texte))
            -- Au propriétaire : un fait du passage interne.
            || case when v_au_proprietaire then jsonb_build_object('chez', 'proprietaire')
                    else '{}'::jsonb end);

  if v_au_proprietaire then
    perform app.notifier_les_receveurs(v_tenant, 'piece.reponse_client',
                                       jsonb_build_object('piece_id', p_piece,
                                                          'note', btrim(p_texte)));
  else
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.reponse_client',
            jsonb_build_object('piece_id', p_piece, 'note', btrim(p_texte)));
  end if;

  return jsonb_build_object('piece_id', p_piece);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_pack   uuid;
  v_vivante uuid;
  v_rev    uuid;
begin
  select tenant_id, vis, status, created_by into v_tenant, v_vis, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Le propriétaire, sur la pièce d'un siège qu'il a reçue.
  if v_vis = 'entite'::app.vis_t and v_tenant in (select app.member_orgs()) then
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') or not app.piece_lisible(p_piece) then
      raise exception 'refus.introuvable.piece' using errcode = '42501';
    end if;
    if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
      raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
    end if;
    if (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      raise exception 'refus.retour.rien_recu' using errcode = 'check_violation';
    end if;
    perform app.exiger_un_motif_de_retour(p_motif, p_note);

    insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom, motif_id, note)
    values (v_tenant, p_piece, 'retournee', auth.uid(), app.prenom_au_moment(auth.uid()),
            p_motif, nullif(btrim(p_note), ''));

    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_auteur, 'piece.retournee_par_le_proprietaire',
            jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                               'note', nullif(btrim(p_note), ''), 'chez', 'proprietaire'));

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, motif_id, payload)
    values (v_tenant, auth.uid(), 'piece.retournee_au_siege', 'capture', 'pieces', p_piece,
            p_motif, jsonb_build_object('note', nullif(btrim(p_note), ''), 'chez', 'proprietaire'));

    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null,
                              'chez', 'siege');
  end if;

  if not app.supervise_le_dossier(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  if v_status = 'retournee' then
    raise exception 'refus.retour.deja' using errcode = 'check_violation';
  end if;

  perform app.exiger_un_motif_de_retour(p_motif, p_note);

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and app.ecriture_vivante(e.id)) then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  select e.id into v_vivante
    from socle.ecritures e
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_vivante is not null then
    v_rev := public.socle_ecriture_review(v_vivante, 'retourne', p_motif, p_note);
    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                              'contre_passation', v_rev);
  end if;

  v_pack := app.pack_de_la_piece(p_piece);

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, p_piece, 'a_corriger'::app.verdict_t, p_motif, nullif(btrim(p_note), ''),
          v_pack, auth.uid());

  update capture.pieces set status = 'retournee', updated_at = now() where id = p_piece;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.retournee',
          jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                             'note', nullif(btrim(p_note), '')));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.retournee', 'capture', 'pieces', p_piece, p_motif, v_pack,
          jsonb_build_object('note', nullif(btrim(p_note), ''), 'sans_ecriture', true));

  return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_type_etabli_par_le_cabinet(p_piece uuid, p_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_type   text;
  v_statut text;
  v_retenu text;
  v_id     uuid;
begin
  select tenant_id, vis, document_kind, document_kind_statut
    into v_tenant, v_vis, v_type, v_statut
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if not app.supervise_le_dossier(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  v_retenu := coalesce(nullif(btrim(p_type), ''), v_type);
  if v_retenu is null then
    raise exception 'refus.inscription.type_inconnu' using errcode = 'check_violation';
  end if;
  if v_statut = 'confirme' and v_retenu = v_type then
    return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', true);
  end if;
  -- Un type qui ne porte pas d'écriture ne s'établit pas pour en inscrire une.
  if not exists (select 1 from ref.document_types d
                  where d.code = v_retenu and d.porte_ecriture) then
    raise exception 'refus.inscription.type_sans_ecriture' using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, 'document_kind', v_retenu)
  returning id into v_id;

  update capture.pieces
     set document_kind = v_retenu, document_kind_statut = 'confirme', updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', 'document_kind', 'valeur', v_retenu,
                             'avant', v_type, 'par_le_cabinet', true));

  return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', false);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_voir(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_cabinet uuid;
  v_archivee timestamptz;
  v_depuis  timestamptz;
  v_le      timestamptz;
  v_membre  boolean;
  v_rien    constant jsonb := jsonb_build_object('piece_id', p_piece, 'vue_le', null,
                                                 'deja', false);
begin
  select tenant_id, vis, archivee_le into v_tenant, v_vis, v_archivee
    from capture.pieces where id = p_piece;
  v_membre := coalesce(v_tenant in (select app.member_orgs()) and app.piece_lisible(p_piece),
                       false);

  -- Dans la société : le propriétaire qui ouvre la pièce qu'un siège lui a
  -- envoyée la « voit ». Ouvrir n'importe quelle autre pièce de la société
  -- n'écrit rien, et ne refuse rien : l'écran ouvre, la base décide. Une pièce
  -- PARTAGÉE prend le passage du comptable, même pour qui est membre des deux
  -- côtés (compte de développement : la « Vue » du cabinet ne s'écrivait plus).
  if v_membre and v_vis = 'entite'::app.vis_t then
    if v_archivee is not null
       or not app.a_le_droit(v_tenant, 'circuit.recevoir')
       or exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
       or (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      return v_rien;
    end if;
    -- Une « Vue » par envoi et par correction de l'auteur — la première, quel
    -- que soit le propriétaire : deux propriétaires qui ouvrent ensemble n'en
    -- écrivent qu'une (l'index unique tranche).
    v_depuis := greatest(app.dernier_envoi_au_proprietaire(p_piece),
                         coalesce(app.corrigee_par_l_auteur(p_piece), '-infinity'::timestamptz));
    insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
    values (v_tenant, p_piece, v_tenant, auth.uid(), app.prenom_au_moment(auth.uid()), v_depuis)
    on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
    returning vue_le into v_le;
    if v_le is not null then
      return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
    end if;
    select v.vue_le into v_le
      from capture.vues v
     where v.tenant_id = v_tenant and v.piece_id = p_piece
       and v.cabinet_org_id = v_tenant and v.depuis = v_depuis;
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
  end if;

  -- Le comptable : repris de `20261030090000`. Un membre qui n'est pas du
  -- cabinet ouvre sans rien écrire.
  if v_tenant is null or v_vis <> 'partage'::app.vis_t then
    if v_membre then
      return v_rien;
    end if;
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id
   where e.pme_org_id = v_tenant and e.status = 'actif' and m.user_id = auth.uid()
     and v_tenant in (select app.mandats_visibles(e.cabinet_org_id))
   order by e.starts_on desc nulls last
   limit 1;
  if v_cabinet is null then
    if v_membre then
      return v_rien;
    end if;
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_archivee is not null
     or exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return v_rien;
  end if;

  v_depuis := coalesce(greatest(app.dernier_envoi(p_piece), app.corrigee_par_le_client(p_piece)),
                       '-infinity'::timestamptz);
  insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
  values (v_tenant, p_piece, v_cabinet, auth.uid(), app.nom_au_moment(auth.uid()), v_depuis)
  on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
  returning vue_le into v_le;
  if v_le is not null then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
  end if;

  select v.vue_le into v_le
    from capture.vues v
   where v.tenant_id = v_tenant and v.piece_id = p_piece
     and v.cabinet_org_id = v_cabinet and v.depuis = v_depuis;
  return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
end
$function$;

CREATE OR REPLACE FUNCTION public.proprietaire_inviter(p_tenant uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  return facturation.place_offrir(p_tenant, p_email, 'dirigeant');
end
$function$;

CREATE OR REPLACE FUNCTION public.pv_accuser_reception(p_pv uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid; v_quand timestamptz;
begin
  select client_tenant_id into v_tenant from collab.pv_reunions
    where id = p_pv and statut = 'envoye';
  if v_tenant is null or not app.has_org_role(v_tenant, array['dirigeant']) then
    raise exception 'refus.introuvable.proces_verbal' using errcode = 'P0002';
  end if;
  insert into collab.pv_receptions (tenant_id, pv_id, membre_id)
    values (v_tenant, p_pv, auth.uid()) on conflict (pv_id, membre_id) do nothing;
  select recu_le into v_quand from collab.pv_receptions
    where pv_id = p_pv and membre_id = auth.uid();
  return v_quand;
end $function$;

CREATE OR REPLACE FUNCTION public.pv_creer(p_cabinet uuid, p_client uuid, p_at date, p_titre text, p_participants text, p_ordre_du_jour text, p_decisions text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if nullif(btrim(p_titre), '') is null or p_at is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_client is not null
     and (p_client not in (select app.engaged_orgs())
          or not exists (select 1 from identity.engagements g
                          where g.pme_org_id = p_client and g.cabinet_org_id = p_cabinet
                            and g.status = 'actif')) then
    raise exception 'refus.introuvable.client' using errcode = '42501';
  end if;
  insert into collab.pv_reunions (cabinet_tenant_id, client_tenant_id, at, titre, participants,
                                  ordre_du_jour, decisions, created_by)
  values (p_cabinet, p_client, p_at, p_titre, p_participants, p_ordre_du_jour, p_decisions,
          auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.pv_envoyer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v collab.pv_reunions%rowtype;
  v_cabinet text;
begin
  select * into v from collab.pv_reunions where id = p_id for update;
  if v.id is null then
    raise exception 'refus.introuvable.proces_verbal' using errcode = 'P0002';
  end if;
  if v.cabinet_tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.proces_verbal' using errcode = 'P0002';
  end if;
  if v.statut = 'envoye' then
    return jsonb_build_object('id', v.id, 'statut', v.statut, 'envoyeLe', v.envoye_le);
  end if;
  if v.client_tenant_id is null then
    raise exception 'refus.pv.sans_client'
      using errcode = '22023';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = v.cabinet_tenant_id
                    and e.pme_org_id = v.client_tenant_id
                    and e.status = 'actif') then
    raise exception 'refus.pv.mandat_inactif'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v.sections) = 0 then
    raise exception 'refus.pv.sans_texte'
      using errcode = '22023';
  end if;

  select name into v_cabinet from identity.organizations where id = v.cabinet_tenant_id;

  perform set_config('app.pv_envoi', 'oui', true);
  update collab.pv_reunions
     set statut = 'envoye', envoye_le = now()
   where id = p_id;

  -- Le journal du cabinet, et celui du mandat : les deux parties le voient.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_tenant_id, auth.uid(), 'pv.envoye', 'collab', 'pv_reunions', v.id,
          jsonb_build_object('client_tenant_id', v.client_tenant_id, 'at', v.at,
                             'redige_par_malica', v.redige_par_malica));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.client_tenant_id, auth.uid(), 'pv.envoye', 'collab', 'pv_reunions', v.id,
          jsonb_build_object('cabinet_tenant_id', v.cabinet_tenant_id, 'at', v.at));

  insert into collab.notifications (tenant_id, kind, payload)
  values (v.client_tenant_id, 'pv.envoye',
          jsonb_build_object('pv_id', v.id, 'titre', v.titre, 'at', v.at, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v.id, 'statut', 'envoye', 'envoyeLe', now());
end $function$;

CREATE OR REPLACE FUNCTION public.pv_modifier(p_id uuid, p_titre text, p_avec_participants boolean, p_participants text, p_avec_decisions boolean, p_decisions text, p_sections jsonb, p_chiffres jsonb, p_avec_ton boolean, p_ton text, p_redige_par_malica boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (p_sections is not null and jsonb_typeof(p_sections) <> 'array')
     or (p_chiffres is not null and jsonb_typeof(p_chiffres) <> 'array')
     or (p_titre is not null and btrim(p_titre) = '') then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update collab.pv_reunions
     set titre             = coalesce(p_titre, titre),
         participants      = case when p_avec_participants then p_participants else participants end,
         decisions         = case when p_avec_decisions then p_decisions else decisions end,
         sections          = coalesce(p_sections, sections),
         chiffres          = coalesce(p_chiffres, chiffres),
         ton               = case when p_avec_ton then p_ton else ton end,
         redige_par_malica = coalesce(p_redige_par_malica, redige_par_malica)
   where id = p_id;
  if not found then
    raise exception 'refus.introuvable.proces_verbal' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.recharge_acheter(p_code text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_permis  boolean;
  v_id      uuid;
begin
  if p_tenant is not null and not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  v_licence := facturation.ma_licence(p_tenant);
  if v_licence is null then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  select o.recharges_permises into v_permis
    from facturation.forfait_courant_v h
    cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
   where h.licence_id = v_licence;
  if not coalesce(v_permis, false) then
    raise exception 'refus.recharge.offre_sans_recharge' using errcode = 'check_violation',
      hint = 'Le Basic ne prend pas de recharge : passer au Solo ou au-dessus.';
  end if;

  v_id := facturation.recharge_inscrire(v_licence, p_code, 'achat', auth.uid());
  return (select to_jsonb(r) from facturation.recharges_v r where r.recharge_id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION public.recharge_automatique_regler(p_active boolean, p_code text DEFAULT NULL::text, p_plafond_mois_ht numeric DEFAULT NULL::numeric, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
begin
  if p_tenant is not null and not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire_principal'
      using errcode = '42501';
  end if;
  v_licence := facturation.ma_licence(p_tenant);
  if v_licence is null then
    raise exception 'refus.reserve.proprietaire_principal'
      using errcode = '42501';
  end if;
  if p_active and (ref.recharge_a(p_code, current_date)).code is null then
    raise exception 'refus.recharge.palier_inconnu' using errcode = 'check_violation';
  end if;

  insert into facturation.recharge_automatique
    (licence_id, active, recharge_code, plafond_mois_ht, decide_par)
  values (v_licence, p_active,
          case when p_active then p_code end,
          case when p_active then p_plafond_mois_ht end,
          auth.uid());

  return jsonb_build_object('active', p_active, 'palier', case when p_active then p_code end,
                            'plafond_mois_ht', case when p_active then p_plafond_mois_ht end);
end
$function$;

CREATE OR REPLACE FUNCTION public.recu_attester_paiements(p_recu uuid, p_paiements uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_source uuid;
  v_kind   text;
  v_n      integer;
begin
  select tenant_id, source_piece_id, document_kind into v_tenant, v_source, v_kind
    from capture.pieces where id = p_recu;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_kind is distinct from 'recu_de_paiement' or v_source is null then
    raise exception 'refus.recu.attestation'
      using errcode = '22023';
  end if;

  -- Chaque règlement est un règlement RÉEL de la pièce dont le reçu est issu :
  -- ni une annulation, ni « pas encore payé », ni le règlement d'une autre.
  -- Un identifiant qui ne l'est pas (règlement disparu entre la production
  -- du reçu et son envoi depuis la file hors ligne) est écarté et tracé :
  -- lever ici bloquerait le reçu dans la file pour toujours.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  select v_tenant, auth.uid(), 'recu.reglement_ecarte', 'capture', 'pieces', p_recu,
         jsonb_build_object('paiement', x.id)
    from unnest(p_paiements) as x(id)
   where not exists (select 1 from capture.paiements p
                      where p.id = x.id and p.piece_id in (select app.versions_de_la_piece(v_source))
                        and p.tenant_id = v_tenant
                        and p.annule_paiement_id is null
                        and p.montant_mineur is not null);

  insert into capture.recu_paiements (tenant_id, piece_id, paiement_id)
  select v_tenant, p_recu, x.id from unnest(p_paiements) as x(id)
   where exists (select 1 from capture.paiements p
                  where p.id = x.id and p.piece_id in (select app.versions_de_la_piece(v_source))
                    and p.tenant_id = v_tenant
                    and p.annule_paiement_id is null
                    and p.montant_mineur is not null)
  on conflict (tenant_id, piece_id, paiement_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

CREATE OR REPLACE FUNCTION public.role_compte_definir(p_tenant uuid, p_portee text, p_portee_id uuid, p_role text, p_compte text, p_motif text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.peut_arreter_le_parametrage(p_tenant, p_portee, p_portee_id) then
    raise exception 'refus.role_compte.droits' using errcode = '42501';
  end if;
  if nullif(btrim(p_role), '') is null or nullif(btrim(p_compte), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  insert into parametrage.role_bindings (tenant_id, portee, portee_id, role_code, account_code, motif)
  values (p_tenant, p_portee, p_portee_id, p_role, p_compte, p_motif)
  on conflict (portee, portee_id, role_code) do update
    set account_code = excluded.account_code,
        motif        = excluded.motif,
        decide_par   = auth.uid(),
        decide_le    = now()
  -- Une liaison d'un autre dossier ne se reprend pas sous ce nom.
  where parametrage.role_bindings.tenant_id = p_tenant;
  if not found then
    raise exception 'refus.introuvable.liaison' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_engagement_status(p_engagement uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pme uuid;
begin
  if p_status not in ('propose','actif','suspendu','termine') then
    raise exception 'refus.mandat.statut_inconnu' using errcode = '22023';
  end if;

  update identity.engagements
     set status = p_status,
         ends_on = case when p_status = 'termine' then current_date else ends_on end
   where id = p_engagement
  returning pme_org_id into v_pme;

  if v_pme is null then
    raise exception 'refus.introuvable.mandat' using errcode = '42501';
  end if;

  insert into audit.event_log (tenant_id, action, object_schema, object_table,
                              object_id, payload)
  values (v_pme, 'engagement.status_changed', 'identity', 'engagements',
          p_engagement, jsonb_build_object('status', p_status));
end $function$;

CREATE OR REPLACE FUNCTION public.siege_inviter(p_tenant uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  return facturation.place_offrir(p_tenant, p_email, 'collaborateur');
end
$function$;

CREATE OR REPLACE FUNCTION public.siege_reprendre_sa_place(p_tenant uuid, p_membre uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_privees integer;
begin
  if not app.a_le_droit(p_tenant, 'circuit.recevoir') then
    raise exception 'refus.reserve.proprietaire' using errcode = '42501';
  end if;
  -- Un propriétaire ne se retire pas par cette porte : il n'occupe pas un siège.
  if exists (select 1 from app.receveurs_du_circuit(p_tenant) r where r = p_membre) then
    raise exception 'refus.place.proprietaire' using errcode = 'check_violation';
  end if;

  -- Compté, jamais lu : ce nombre part avec lui.
  select count(*) into v_privees
    from capture.pieces
   where tenant_id = p_tenant and created_by = p_membre and vis = 'personnel'::app.vis_t;

  delete from identity.memberships
   where tenant_id = p_tenant and user_id = p_membre;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'siege.libere', 'identity', 'memberships',
          p_membre, jsonb_build_object('membre', p_membre, 'mon_espace_parti', v_privees));

  return jsonb_build_object('libere', true, 'pieces', 0);
end
$function$;

CREATE OR REPLACE FUNCTION public.signalement_deposer(p_tenant uuid, p_version_client text, p_appareil text, p_ou text, p_message text, p_pile text, p_piece uuid, p_origine text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid := gen_random_uuid();
  v_le timestamptz := now();
begin
  if p_tenant is not null and p_tenant not in (select app.member_orgs())
     and p_tenant not in (select app.engaged_orgs()) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  insert into app.signalements (id, cree_le, user_id, tenant_id, version_client, appareil, ou,
                                message, pile, piece_id, origine)
  values (v_id, v_le, app.current_uid(), p_tenant, p_version_client, p_appareil, p_ou,
          p_message, p_pile, p_piece, p_origine);
  return jsonb_build_object('id', v_id, 'cree_le', v_le);
end
$function$;

CREATE OR REPLACE FUNCTION public.socle_ecriture_book(p_ecriture uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_nature  text;
  v_paiement uuid;
  v_reverses uuid;
  v_dossier uuid;
begin
  select piece_id into v_piece from socle.ecritures where id = p_ecriture;
  -- La pièce de l'écriture ET sa version courante — celle que le contrôle R2
  -- juge —, dans l'ordre des identifiants : une reprise ou une suppression de
  -- la courante attend cette inscription, puis la voit.
  if v_piece is not null then
    perform 1 from capture.pieces
     where id in (v_piece, app.version_courante(v_piece)) order by id for update;
  end if;

  select e.nature, e.paiement_id, e.reverses_id, e.tenant_id
    into v_nature, v_paiement, v_reverses, v_dossier
    from socle.ecritures e where e.id = p_ecriture and e.status = 'proposee';

  -- L'annulation d'un règlement, dans un dossier confié à une comptabilité,
  -- est inscrite par l'expert mandaté, et par lui seul (revue du 24 octobre
  -- 2026) : la PME ne touche pas au grand livre qu'elle a confié.
  if v_nature = 'reglement' and v_reverses is not null
     and exists (select 1 from identity.engagements g
                  where g.pme_org_id = v_dossier and g.status = 'actif')
     and v_dossier not in (select app.engaged_orgs_as_expert()) then
    raise exception 'refus.reserve.expert_mandate'
      using errcode = '42501', hint = 'reglement.annulation_expert';
  end if;
  -- L'écriture d'une pièce, dans un dossier EN MANDAT confié à un cabinet
  -- engagé, est l'acte du cabinet (« Malica sans blocage ») : le client ne
  -- voit ni ne confirme d'écriture, il n'en inscrit donc pas non plus. Le
  -- dossier AUTONOME tient lui-même ses livres (`booked_autonome`), et un
  -- dossier sans cabinet n'a personne d'autre pour les tenir : ces deux cas
  -- restent ouverts. Le règlement, lui, reste un geste de la PME (`pme.regler`).
  if v_nature = 'piece'
     and app.livres_tenus_par_le_cabinet(v_dossier)
     and not app.supervise_le_dossier(v_dossier) then
    raise exception 'refus.inscription.reservee_au_cabinet'
      using errcode = '42501', hint = 'inscription.cabinet';
  end if;
  -- Une contre-passation éteint l'écriture vivante : elle ne la double pas.
  if v_nature is not null and v_piece is not null and v_reverses is null and exists (
       select 1 from socle.ecritures o
        where o.piece_id = v_piece and o.id <> p_ecriture
          and o.nature = v_nature and o.paiement_id is not distinct from v_paiement
          and app.ecriture_vivante(o.id)) then
    raise exception 'refus.ecriture.deja_inscrite'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  update socle.ecritures
     set status = 'booked',
         booked_by = auth.uid(),
         booked_at = now(),
         updated_at = now()
   where id = p_ecriture and status = 'proposee'
  returning tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'refus.ecriture.non_inscriptible'
      using errcode = '42501';
  end if;

  -- Un règlement inscrit ne fait pas repasser une facture supervisée en
  -- « comptabilisée » : seule l'écriture de la facture fait le statut. Celle
  -- que le cabinet inscrit est prise en charge (le déclencheur vient de le
  -- poser) : la pièce est supervisée.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when exists (select 1 from socle.prises_en_charge x
                                       where x.ecriture_id = p_ecriture)
                         then 'supervisee' else 'comptabilisee' end,
           updated_at = now()
     where id = v_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece, 'nature', v_nature,
                             'paiement_id', v_paiement));
end
$function$;

CREATE OR REPLACE FUNCTION public.socle_ecriture_contre_passer(p_ecriture uuid, p_motif uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_entity  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_journal text;
  v_libelle text;
  v_devise  text;
  v_date    date;
  v_rev     uuid;
  v_i       smallint := 0;
  v_l       record;
begin
  select tenant_id, entity_id, piece_id, pack_version_id, journal, libelle, devise, date_ecriture
    into v_tenant, v_entity, v_piece, v_pack, v_journal, v_libelle, v_devise, v_date
    from socle.ecritures where id = p_ecriture;
  if v_tenant is null then
    raise exception 'refus.introuvable.ecriture' using errcode = '42501';
  end if;
  -- Défaire une écriture d'un dossier tenu par un cabinet est l'acte du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if not app.ecriture_vivante(p_ecriture) then
    raise exception 'refus.ecriture.contre_passee'
      using errcode = 'check_violation', hint = 'ecriture.contre_passee';
  end if;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               status, reverses_id, reversal_reason_id)
  values (v_tenant, v_entity, v_piece, 'partage', v_journal,
          app.date_de_contre_passation(v_tenant, v_date), v_devise,
          'Contre-passation — ' || v_libelle, v_pack,
          'proposee', p_ecriture, p_motif)
  returning id into v_rev;

  for v_l in
    select ordinal, account_code, libelle, debit, credit, tax_code,
           devise_origine, montant_origine, taux_de_change, cours_id
      from socle.ecriture_lignes where ecriture_id = p_ecriture order by ordinal
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code,
                                       devise_origine, montant_origine, taux_de_change, cours_id)
    values (v_tenant, v_rev, v_i, v_l.account_code,
            'Contre-passation — ' || v_l.libelle,
            v_l.credit, v_l.debit, v_l.tax_code,
            v_l.devise_origine, v_l.montant_origine, v_l.taux_de_change, v_l.cours_id);
  end loop;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_rev;

  return v_rev;
end
$function$;

CREATE OR REPLACE FUNCTION public.socle_ecriture_propose(p_piece uuid, p_journal text, p_date date, p_libelle text, p_pack_version uuid, p_lignes jsonb, p_devise text, p_paiement uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis    app.vis_t;
  v_nature text := case when p_paiement is null then 'piece' else 'reglement' end;
  v_ecr    uuid;
  v_inscrite uuid;
  v_l      jsonb;
  v_i      smallint := 0;
  v_devise_du_dossier text;
  v_controles jsonb;
  v_cours_juge uuid;
begin
  -- Le verrou de la pièce sérialise deux clics, deux onglets, deux personnes.
  -- Une photo reprise se lit à sa version courante : c'est elle qu'on
  -- verrouille, et elle qui dit le dossier, l'établissement et le côté.
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = app.version_courante(p_piece) for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- Les livres d'un dossier sont dans SA devise : une pièce en devise se
  -- convertit avant (la proposition le fait, au cours de la règle de change).
  select o.currency into v_devise_du_dossier from identity.organizations o where o.id = v_tenant;
  if p_devise is distinct from v_devise_du_dossier then
    raise exception 'refus.ecriture.devise_du_dossier' using errcode = '22023';
  end if;
  -- Une ligne convertie porte LE cours de la pièce, jamais un autre (revue de
  -- #148 : la porte recopiait le cours, le taux et l'origine qu'on lui
  -- donnait). Ce cours est celui que le DERNIER jugement de la pièce a lu,
  -- jugement encore à jour ; la devise d'origine est celle du cours, le taux
  -- celui du cours pour une unité.
  if exists (select 1 from jsonb_array_elements(p_lignes) l
              where nullif(l ->> 'cours_id', '') is not null
                 or nullif(l ->> 'devise_origine', '') is not null) then
    -- Le jugement que la proposition a lu : celui de cette pièce.
    select a.controles into v_controles
      from capture.analyses a
     where a.piece_id = p_piece
     order by a.created_at desc
     limit 1;
    select (k -> 'preuves' -> 'cours' ->> 'id')::uuid into v_cours_juge
      from jsonb_array_elements(case when jsonb_typeof(v_controles) = 'array' then v_controles
                                     else '[]'::jsonb end) k
     where k ->> 'code' = 'cours_de_change' and k ->> 'statut' = 'reserve'
     limit 1;
    if v_cours_juge is null or not app.cours_du_jugement_a_jour(v_tenant, v_controles) then
      raise exception 'refus.ecriture.cours_perime' using errcode = '22023';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_lignes) l
       where (nullif(l ->> 'cours_id', '') is not null
              or nullif(l ->> 'devise_origine', '') is not null)
         and (nullif(l ->> 'cours_id', '')::uuid is distinct from v_cours_juge
          or (l ->> 'montant_origine') is null
          or not app.cours_de_la_ligne_conforme(v_cours_juge, l ->> 'devise_origine',
                                                v_devise_du_dossier,
                                                (l ->> 'taux_de_change')::numeric))) then
      raise exception 'refus.ecriture.cours_de_la_ligne' using errcode = '22023';
    end if;
  end if;
  if p_paiement is not null
     and not exists (select 1 from capture.paiements
                      where id = p_paiement and piece_id = p_piece) then
    raise exception 'refus.ecriture.reglement_d_une_autre_piece' using errcode = '22023';
  end if;

  select e.id into v_inscrite
    from socle.ecritures e
   where e.piece_id = p_piece and e.nature = v_nature
     and e.paiement_id is not distinct from p_paiement
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_inscrite is not null then
    -- Un règlement inscrit l'est une fois : redemander rend la même écriture.
    if v_nature = 'reglement' then
      return v_inscrite;
    end if;
    raise exception 'refus.ecriture.reimputer'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  delete from socle.ecritures
   where piece_id = p_piece and status = 'proposee' and reverses_id is null
     and nature = v_nature and paiement_id is not distinct from p_paiement;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               nature, paiement_id)
  values (v_tenant, v_entity, p_piece, v_vis, p_journal, p_date, p_devise,
          p_libelle, p_pack_version, v_nature, p_paiement)
  returning id into v_ecr;

  for v_l in select * from jsonb_array_elements(p_lignes)
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code,
                                       devise_origine, montant_origine, taux_de_change, cours_id)
    values (v_tenant, v_ecr, v_i, v_l->>'account_code', v_l->>'libelle',
            coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0),
            nullif(v_l->>'tax_code',''),
            nullif(v_l->>'devise_origine', ''),
            (v_l->>'montant_origine')::numeric,
            (v_l->>'taux_de_change')::numeric,
            (v_l->>'cours_id')::uuid);
  end loop;

  -- Seule l'écriture de la facture fait avancer la pièce.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when status in ('capturee','lue','retournee') then 'proposee' else status end,
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.proposed', 'socle', 'ecritures', v_ecr,
          jsonb_build_object('piece_id', p_piece, 'pack_version_id', p_pack_version,
                             'nature', v_nature, 'paiement_id', p_paiement,
                             'lignes', jsonb_array_length(p_lignes)));

  return v_ecr;
end $function$;

CREATE OR REPLACE FUNCTION public.socle_ecriture_review(p_ecriture uuid, p_outcome app.review_outcome_t, p_motif uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_status  text;
  v_rev     uuid;
  v_requires_note boolean;
  v_courante uuid;
begin
  select tenant_id, piece_id, pack_version_id, status
    into v_tenant, v_piece, v_pack, v_status
    from socle.ecritures where id = p_ecriture;
  -- Le verdict porte sur la pièce, donc sur sa version courante ; la
  -- contre-passation, elle, garde la pièce de l'écriture qu'elle annule.
  v_courante := app.version_courante(v_piece);

  if v_tenant is null then
    raise exception 'refus.introuvable.ecriture' using errcode = '42501';
  end if;
  -- La supervision est le second regard : elle revient à l'expert ou au
  -- collaborateur du cabinet engagé, jamais à l'assistant (ANO-CAB-006). Un
  -- membre de la société la garde seulement quand elle tient ses livres
  -- (dossier autonome, ou sans cabinet) : en mandat, elle ne valide ni ne
  -- contre-passe l'écriture du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_status <> 'booked' then
    raise exception 'refus.supervision.comptabilisee_seulement'
      using errcode = 'check_violation';
  end if;

  if p_outcome = 'retourne' then
    if p_motif is null then
      raise exception 'refus.motif.requis' using errcode = 'check_violation';
    end if;
    select requires_note into v_requires_note from ref.rejet_motifs where id = p_motif;
    if v_requires_note is null then
      raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
    end if;
    if v_requires_note and coalesce(btrim(p_note), '') = '' then
      raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
    end if;
  end if;

  update socle.ecritures
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_outcome = p_outcome,
         review_motif_id = p_motif,
         review_note = p_note,
         updated_at = now()
   where id = p_ecriture;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, v_courante,
          case when p_outcome = 'valide' then 'conforme'::app.verdict_t
               else 'a_corriger'::app.verdict_t end,
          p_motif, p_note, v_pack, auth.uid());

  if p_outcome = 'valide' then
    update capture.pieces set status = 'supervisee', updated_at = now()
     where id = v_courante;
  else
    v_rev := public.socle_ecriture_contre_passer(p_ecriture, p_motif);
    update capture.pieces set status = 'retournee', updated_at = now()
     where id = v_courante;
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant,
          case when p_outcome = 'valide' then 'piece.validee' else 'piece.retournee' end,
          jsonb_build_object('piece_id', v_courante, 'ecriture_id', p_ecriture,
                             'motif_id', p_motif, 'note', p_note));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(),
          case when p_outcome = 'valide' then 'ecriture.validee' else 'ecriture.retournee' end,
          'socle', 'ecritures', p_ecriture, p_motif, v_pack,
          jsonb_build_object('piece_id', v_piece, 'reversal_id', v_rev, 'note', p_note));

  return v_rev;
end $function$;

CREATE OR REPLACE FUNCTION public.stocks_article_modifier(p_id uuid, p_designation text, p_unite text, p_methode app.stock_methode_t, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if nullif(btrim(p_designation), '') is null or nullif(btrim(p_unite), '') is null
     or p_active is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update stocks.items
     set designation = p_designation, unite = p_unite, methode = p_methode, active = p_active
   where id = p_id;
  if not found then
    raise exception 'refus.introuvable.article' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.stocks_depreciation_constater(p_item uuid, p_at date, p_valeur_stock numeric, p_valeur_nette numeric, p_mouvement numeric, p_cumul numeric, p_pack_version uuid, p_note text DEFAULT NULL::text, p_journal text DEFAULT 'OD'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_prov text;
  v_acc_dot text;
  v_acc_rep text;
  v_abs numeric;
  v_ecr uuid;
  v_dep uuid;
begin
  select i.tenant_id, i.entity_id, i.vis, i.devise, i.designation,
         c.account_provision, c.account_provision_dotation, c.account_provision_reprise
    into v_tenant, v_entity, v_vis, v_devise, v_label, v_acc_prov, v_acc_dot, v_acc_rep
    from stocks.items i
    join ref.stock_categories c on c.id = i.category_id
   where i.id = p_item;

  if v_tenant is null then
    raise exception 'refus.stocks.article_sans_categorie'
      using errcode = '42501';
  end if;
  if coalesce(p_mouvement, 0) = 0 then
    raise exception 'refus.immo.rien_a_constater' using errcode = 'check_violation';
  end if;

  v_abs := abs(p_mouvement);

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, p_at, v_devise,
          case when p_mouvement > 0 then 'Dépréciation de stock — '
               else 'Reprise de dépréciation de stock — ' end || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if p_mouvement > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_dot, 'Dotation provision stock — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_prov, 'Provision stock — ' || v_label, 0, v_abs);
  else
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_prov, 'Provision stock — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_rep, 'Reprise provision stock — ' || v_label, 0, v_abs);
  end if;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into stocks.depreciations (tenant_id, item_id, at, valeur_stock, valeur_nette,
                                    mouvement, cumul, note, ecriture_id, pack_version_id,
                                    created_by)
  values (v_tenant, p_item, p_at, p_valeur_stock, p_valeur_nette, p_mouvement, p_cumul,
          p_note, v_ecr, p_pack_version, auth.uid())
  returning id into v_dep;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'stock.depreciation_constatee', 'stocks', 'depreciations',
          v_dep, p_pack_version,
          jsonb_build_object('item_id', p_item, 'at', p_at, 'mouvement', p_mouvement,
                             'ecriture_id', v_ecr));

  return jsonb_build_object('depreciation_id', v_dep, 'ecriture_id', v_ecr);
end $function$;

CREATE OR REPLACE FUNCTION public.stocks_inventaire_constater(p_item uuid, p_period text, p_initial numeric, p_final numeric, p_variation numeric, p_pack_version uuid, p_date date, p_journal text DEFAULT 'OD'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_stock text;
  v_acc_var text;
  v_abs numeric;
  v_ecr uuid;
  v_inv uuid;
begin
  select i.tenant_id, i.entity_id, i.vis, i.devise, i.designation,
         coalesce(c.account_stock, i.account_stock),
         coalesce(c.account_variation, i.account_variation)
    into v_tenant, v_entity, v_vis, v_devise, v_label, v_acc_stock, v_acc_var
    from stocks.items i
    left join ref.stock_categories c on c.id = i.category_id
   where i.id = p_item;

  if v_tenant is null then
    raise exception 'refus.introuvable.article' using errcode = '42501';
  end if;
  if coalesce(p_variation, 0) = 0 then
    raise exception 'refus.immo.rien_a_constater' using errcode = 'check_violation';
  end if;
  if exists (select 1 from stocks.inventaires s
              where s.tenant_id = v_tenant and s.item_id = p_item and s.period = p_period) then
    raise exception 'refus.stocks.inventaire_deja' using errcode = 'unique_violation';
  end if;

  v_abs := abs(p_variation);

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, p_date, v_devise,
          'Variation de stock ' || p_period || ' — ' || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if p_variation > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_stock, 'Stock final — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_var, 'Variation de stock — ' || v_label, 0, v_abs);
  else
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_var, 'Variation de stock — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_stock, 'Stock initial — ' || v_label, 0, v_abs);
  end if;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into stocks.inventaires (tenant_id, item_id, period, initial, final, variation,
                                  ecriture_id, pack_version_id, created_by)
  values (v_tenant, p_item, p_period, p_initial, p_final, p_variation,
          v_ecr, p_pack_version, auth.uid())
  returning id into v_inv;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'stock.inventaire_constate', 'stocks', 'inventaires', v_inv,
          p_pack_version,
          jsonb_build_object('item_id', p_item, 'period', p_period,
                             'variation', p_variation, 'ecriture_id', v_ecr));

  return jsonb_build_object('inventaire_id', v_inv, 'ecriture_id', v_ecr);
end $function$;

CREATE OR REPLACE FUNCTION public.stocks_mouvement_inscrire(p_tenant uuid, p_item uuid, p_sens app.stock_sens_t, p_at date, p_quantite numeric, p_cout_unitaire numeric, p_reference text, p_piece uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  -- L'article est celui du dossier, et l'appelant le voit.
  if not exists (select 1 from public.stocks_items_v i where i.id = p_item and i.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.article' using errcode = '42501';
  end if;
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  insert into stocks.mouvements (tenant_id, item_id, sens, at, quantite, cout_unitaire,
                                 reference, piece_id, created_by)
  values (p_tenant, p_item, p_sens, p_at, p_quantite, p_cout_unitaire,
          nullif(btrim(p_reference), ''), p_piece, auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.tiers_activer(p_id uuid, p_actif boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_actif is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update tiers.auxiliaires set actif = p_actif where id = p_id;
  if not found then
    raise exception 'refus.introuvable.tiers' using errcode = '42501';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.tiers_modifier(p_id uuid, p_raison_sociale text, p_compte_collectif text, p_identifiant_fiscal text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if nullif(btrim(p_raison_sociale), '') is null or nullif(btrim(p_compte_collectif), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update tiers.auxiliaires
     set raison_sociale = btrim(p_raison_sociale), compte_collectif = btrim(p_compte_collectif),
         identifiant_fiscal = nullif(btrim(p_identifiant_fiscal), ''),
         note = nullif(btrim(p_note), '')
   where id = p_id;
  if not found then
    raise exception 'refus.introuvable.tiers' using errcode = '42501';
  end if;
end
$function$;

commit;
