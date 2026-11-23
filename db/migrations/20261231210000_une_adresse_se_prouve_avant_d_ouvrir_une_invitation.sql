-- Une adresse se prouve avant d'ouvrir une invitation (audit de sécurité du
-- 23 novembre 2026, B4).
--
-- Constat, exécuté : Malica ne vérifiait jamais l'adresse d'un compte. Une
-- invitation s'acceptait du seul fait que l'adresse du compte connecté était
-- celle de l'invitation (`app.mon_email()`). Quiconque créait un compte avec
-- l'adresse d'un associé invité, avant lui, devenait expert du cabinet — ses
-- dossiers, ses factures, son droit de payer.
--
-- La cause est une seule fonction : `app.mon_email()` rendait une adresse
-- DÉCLARÉE. Elle ne rend plus qu'une adresse PROUVÉE. Deux preuves existent :
--
--   1. le lien de confirmation envoyé à l'inscription (`auth.confirmations_adresse`,
--      comme `auth.reinitialisations` : hors RLS, seule l'empreinte du secret est
--      gardée, l'API seule y écrit) ;
--   2. le lien d'une invitation : il a été reçu à cette adresse. L'ouvrir confirme
--      l'adresse, puis l'invitation s'accepte par le chemin ordinaire.
--
-- Les comptes déjà ouverts sont tenus pour confirmés à leur date de création :
-- les retirer couperait les cabinets du pilote de leurs invitations en cours.
-- Un compte de cette période ouvert sur une adresse usurpée se repère par
-- l'audit (`membre.rejoint` sans lien) ; il n'est pas reconfirmé ici.
--
-- Les six fonctions qui lisent `app.mon_email()` sont toutes des fonctions
-- d'invitation : aucune autre lecture ne change.

begin;

alter table auth.users add column adresse_confirmee_le timestamptz;
comment on column auth.users.adresse_confirmee_le is
  'Quand l''adresse a été prouvée (lien de confirmation ou lien d''invitation). Vide : déclarée seulement.';

update auth.users set adresse_confirmee_le = created_at where adresse_confirmee_le is null;

create table auth.confirmations_adresse (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  empreinte  text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  cree_le    timestamptz not null default now(),
  expire_le  timestamptz not null,
  utilise_le timestamptz
);
create index confirmations_adresse_user_idx on auth.confirmations_adresse (user_id, cree_le desc);

revoke all on auth.confirmations_adresse from public, anon, authenticated;
grant select, insert, update on auth.confirmations_adresse to malica_api;
grant update (adresse_confirmee_le) on auth.users to malica_api;

-- L'adresse de la personne connectée, si elle est PROUVÉE ; sinon rien.
create or replace function app.mon_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.email::text from auth.users u
   where u.id = auth.uid() and u.adresse_confirmee_le is not null
$$;
revoke all on function app.mon_email() from public, anon, service_role;
grant execute on function app.mon_email() to authenticated;

-- Le lien d'une invitation adressée à l'adresse déclarée du compte connecté prouve
-- cette adresse : la personne a reçu le courriel — que l'invitation soit encore
-- ouverte ou non. Ne rend rien, ne dit pas si le jeton existe ; l'acceptation qui
-- suit refuse ce qui ne va pas (expirée, révoquée, déjà acceptée).
create or replace function app.adresse_prouvee_par_invitation(p_jeton text)
returns void
language sql
security definer
set search_path = ''
as $$
  update auth.users u
     set adresse_confirmee_le = now()
   where u.id = auth.uid()
     and u.adresse_confirmee_le is null
     and exists (
       select 1 from identity.invitations i
        where i.token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex')
          and lower(i.email) = lower(u.email::text))
$$;
revoke all on function app.adresse_prouvee_par_invitation(text) from public, anon;
grant execute on function app.adresse_prouvee_par_invitation(text) to authenticated;

-- Les textes du courriel de confirmation, dans les trois langues.
insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('confirmation.sujet', 'fr', 'Confirmez votre adresse — Malica Office', date '2026-11-23'),
  ('confirmation.sujet', 'en', 'Confirm your address — Malica Office', date '2026-11-23'),
  ('confirmation.sujet', 'ar', 'أكّدوا عنوانكم — Malica Office', date '2026-11-23'),
  ('confirmation.apercu', 'fr', 'Le lien est valable trois jours, une seule fois.', date '2026-11-23'),
  ('confirmation.apercu', 'en', 'The link is valid for three days, once.', date '2026-11-23'),
  ('confirmation.apercu', 'ar', 'الرابط صالح لثلاثة أيام، لمرة واحدة.', date '2026-11-23'),
  ('confirmation.titre', 'fr', 'Confirmez votre adresse.', date '2026-11-23'),
  ('confirmation.titre', 'en', 'Confirm your address.', date '2026-11-23'),
  ('confirmation.titre', 'ar', 'أكّدوا عنوانكم.', date '2026-11-23'),
  ('confirmation.corps', 'fr', 'Votre accès Malica Office vient d''être créé avec cette adresse. Confirmez-la pour qu''un cabinet ou une société puisse vous inviter : tant qu''elle n''est pas confirmée, aucune invitation ne s''ouvre.', date '2026-11-23'),
  ('confirmation.corps', 'en', 'Your Malica Office access has just been created with this address. Confirm it so that a firm or a company can invite you: until it is confirmed, no invitation opens.', date '2026-11-23'),
  ('confirmation.corps', 'ar', 'أُنشئ حسابكم على Malica Office بهذا العنوان. أكّدوه حتى يتمكّن مكتب أو شركة من دعوتكم: لا تُفتح أي دعوة قبل تأكيده.', date '2026-11-23'),
  ('confirmation.bouton', 'fr', 'Confirmer mon adresse', date '2026-11-23'),
  ('confirmation.bouton', 'en', 'Confirm my address', date '2026-11-23'),
  ('confirmation.bouton', 'ar', 'تأكيد عنواني', date '2026-11-23'),
  ('confirmation.note', 'fr', 'Vous n''avez pas créé d''accès Malica Office ? Ignorez ce message : sans confirmation, cette adresse n''ouvre rien.', date '2026-11-23'),
  ('confirmation.note', 'en', 'Did not create a Malica Office access? Ignore this message: without confirmation, this address opens nothing.', date '2026-11-23'),
  ('confirmation.note', 'ar', 'لم تُنشئوا حسابًا على Malica Office؟ تجاهلوا هذه الرسالة: دون تأكيد، لا يفتح هذا العنوان شيئًا.', date '2026-11-23'),
  ('confirmation.raison', 'fr', 'Un accès Malica Office a été créé avec cette adresse.', date '2026-11-23'),
  ('confirmation.raison', 'en', 'A Malica Office access was created with this address.', date '2026-11-23'),
  ('confirmation.raison', 'ar', 'أُنشئ حساب على Malica Office بهذا العنوان.', date '2026-11-23');

-- Les deux acceptations par lien : le lien prouve d'abord l'adresse.

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
  -- Le lien prouve l'adresse : la personne qui l'ouvre a reçu le courriel.
  perform app.adresse_prouvee_par_invitation(p_jeton);
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  -- Une invitation de la société à SA comptabilité ne fait entrer personne
  -- dans la société : elle s'accepte par sa porte, qui choisit la comptabilité
  -- (`comptabilite_invitation_accepter`).
  if v.role = 'expert' and exists (select 1 from identity.organizations o
                                    where o.id = v.tenant_id and o.kind = 'pme') then
    raise exception 'refus.invitation.choisir_la_comptabilite' using errcode = '22023';
  end if;
  insert into identity.memberships (tenant_id, user_id, role)
  values (v.tenant_id, auth.uid(), v.role)
  on conflict (tenant_id, user_id) do nothing;
  if v.role = 'dirigeant' then
    perform facturation.dirigeant_arrive(v.tenant_id);
  end if;
  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', v.id,
          jsonb_build_object('role', v.role, 'par', 'lien'));
  return jsonb_build_object('tenantId', v.tenant_id, 'role', v.role);
end
$function$;

CREATE OR REPLACE FUNCTION public.comptabilite_invitation_accepter(p_jeton text, p_invitation uuid, p_cabinet uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_engagement uuid;
  v_cabinet text;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  -- Le lien prouve l'adresse ; sans lien, l'adresse doit déjà être confirmée.
  if p_jeton is not null then
    perform app.adresse_prouvee_par_invitation(p_jeton);
  end if;
  select * into v from app.invitation_expert_lire(p_jeton, p_invitation);
  if v.id is null or v.pme_kind <> 'pme' then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.organizations c
                  where c.id = p_cabinet and c.kind = 'cabinet' and c.archived_at is null)
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if app.autre_mandat_en_vigueur(v.tenant_id, p_cabinet) then
    raise exception 'refus.mandat.un_seul_actif' using errcode = '22023';
  end if;

  -- Le mandat, puis ce qu'il dit ; l'invitation est encore ouverte à cet
  -- instant, c'est elle qui autorise ces écritures (politiques ci-dessus).
  insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, created_by)
  values (v.tenant_id, p_cabinet, 'actif', current_date, auth.uid())
  on conflict (pme_org_id, cabinet_org_id) do update
    set status = 'actif', starts_on = current_date, ends_on = null
  returning id into v_engagement;

  select name into v_cabinet from identity.organizations where id = p_cabinet;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('cabinet_org_id', p_cabinet, 'par', 'invitation')),
         (p_cabinet, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('pme_org_id', v.tenant_id, 'par', 'invitation'));
  perform notif.emettre(v.tenant_id, 'mandat.accepte', jsonb_build_object('engagement_id', v_engagement, 'cabinet', v_cabinet,
                             'client', v.pme_name));

  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;

  return jsonb_build_object('engagementId', v_engagement, 'pmeTenantId', v.tenant_id,
                            'cabinetTenantId', p_cabinet);
end
$function$;


commit;
