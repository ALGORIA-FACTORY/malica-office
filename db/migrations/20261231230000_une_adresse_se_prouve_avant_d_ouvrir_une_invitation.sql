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
-- DÉCLARÉE. Elle ne rend plus qu'une adresse PROUVÉE, et une seule preuve
-- existe : le lien de confirmation envoyé à l'inscription
-- (`auth.confirmations_adresse`, comme `auth.reinitialisations` : hors RLS, seule
-- l'empreinte du secret est gardée, l'API seule y écrit).
--
-- Le lien d'une invitation n'est PAS une preuve : celui qui invite reçoit le
-- jeton à l'écran (le lien se copie quand le courriel ne part pas). Un compte
-- ouvert sur l'adresse d'autrui pouvait s'inviter lui-même depuis une société à
-- lui, accepter, et se faire ainsi « prouver » l'adresse (contre-audit exécuté
-- du 23 novembre 2026). Une invitation, par lien ou depuis la liste, attend
-- donc l'adresse confirmée.
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

-- Deux gestes de la tour nomment une personne par son adresse : confier une
-- société à un dirigeant, accorder l'accès total. Ils exigent eux aussi une
-- adresse prouvée (contre-audit du 23 novembre 2026).

CREATE OR REPLACE FUNCTION public.plateforme_organisation_confier(p_org uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind    text;
  v_archive timestamptz;
  v_user    uuid;
  v_licence uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select o.kind, o.archived_at into v_kind, v_archive
    from identity.organizations o where o.id = p_org for update;
  if v_kind is null or v_archive is not null then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  if v_kind <> 'pme' then
    raise exception 'refus.organisation.pas_une_societe' using errcode = '22023';
  end if;
  if exists (select 1 from identity.memberships m where m.tenant_id = p_org) then
    raise exception 'refus.organisation.deja_dirigee' using errcode = '22023';
  end if;

  select u.id into v_user
    from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'refus.introuvable.compte' using errcode = '22023';
  end if;
  -- Une adresse seulement déclarée ne reçoit rien (audit du 23 novembre 2026).
  if not exists (select 1 from auth.users u
                  where u.id = v_user and u.adresse_confirmee_le is not null) then
    raise exception 'refus.compte.adresse_non_confirmee' using errcode = '22023';
  end if;

  insert into identity.memberships (tenant_id, user_id, role)
  values (p_org, v_user, 'dirigeant');

  -- Sa licence, à son nom : la société ne fonctionne pas sans (le forfait,
  -- les lectures, les accès que propose un cabinet). Idempotente.
  v_licence := facturation.licence_naitre(p_org, v_user);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (p_org, auth.uid(), 'organisation.confiee', 'identity', 'organizations', p_org,
          jsonb_build_object('dirigeant', v_user, 'licence', v_licence));

  return jsonb_build_object('organisation_id', p_org, 'dirigeant', v_user, 'licence', v_licence);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.acces_total_accorder(p_email text, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
  v_org  uuid;
  v_id   uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.acces_total.motif_requis' using errcode = '22023';
  end if;
  select u.id into v_user
    from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'refus.introuvable.compte' using errcode = '22023';
  end if;
  -- Une adresse seulement déclarée ne reçoit rien (audit du 23 novembre 2026).
  if not exists (select 1 from auth.users u
                  where u.id = v_user and u.adresse_confirmee_le is not null) then
    raise exception 'refus.compte.adresse_non_confirmee' using errcode = '22023';
  end if;
  if not exists (select 1 from app.platform_operators po where po.user_id = v_user) then
    raise exception 'refus.acces_total.pas_operateur' using errcode = '22023';
  end if;
  -- Une décision à la fois par personne : deux accords simultanés liraient le
  -- même état et s'inscriraient tous les deux.
  perform pg_advisory_xact_lock(hashtextextended('plateforme.acces_total:' || v_user::text, 0));
  if coalesce((select a.actif from plateforme.acces_total a where a.user_id = v_user
                order by a.rang desc limit 1), false) then
    raise exception 'refus.acces_total.deja_accorde' using errcode = '22023';
  end if;
  v_org := plateforme.organisation_de_la_plateforme();
  if v_org is null then
    raise exception 'refus.acces_total.sans_emetteur' using errcode = '22023';
  end if;

  insert into plateforme.acces_total (user_id, actif, motif, par)
  values (v_user, true, btrim(p_motif), auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (v_org, auth.uid(), 'acces_total.accorde', 'plateforme', 'acces_total', v_id,
          jsonb_build_object('personne', v_user, 'motif', btrim(p_motif)));

  return jsonb_build_object('decision', v_id, 'personne', v_user, 'actif', true);
end
$function$;

commit;
