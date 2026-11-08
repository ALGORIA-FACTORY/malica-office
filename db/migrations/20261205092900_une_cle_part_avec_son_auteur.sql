-- Une clé d'API part avec son auteur.
--
-- ================================================================== POURQUOI
--
-- Audit de sécurité du 6 novembre 2026, S3 : un membre du cabinet crée une clé ; on
-- retire son adhésion ; `capture.enregistrer` PAR LA CLÉ rendait encore 200, quand le
-- même geste par sa session rendait `refus.geste.non_permis`. `api_key_resoudre` ne
-- regardait que l'empreinte, la révocation et l'archivage du cabinet ; sous la clé,
-- `app.member_orgs()` rend le cabinet de la clé sans demander si son auteur en est
-- encore. Une clé survivait donc au départ de celui qui l'a créée.
--
-- ================================================================== CE QUI CHANGE
--
-- 1. La résolution exige que l'auteur soit ENCORE expert du cabinet de la clé — le
--    rôle qui crée une clé (`api_keys_insert_expert`), par une adhésion réelle
--    (`identity.memberships`) : l'accès total ne vaut que pour la session de
--    l'opérateur. C'est la garde : elle tient même si la révocation n'a pas eu lieu,
--    quel que soit le chemin par lequel l'adhésion est partie.
--
-- 2. Le départ révoque. Une adhésion qui s'efface, ou qui n'est plus d'expert,
--    révoque les clés que la personne a créées sur cette organisation, et le dit au
--    journal d'audit. La porte qui retire un membre (`siege_reprendre_sa_place`) ne
--    s'ouvre que là où un rôle reçoit le circuit — aucun rôle de cabinet ne le
--    reçoit, et seul un cabinet porte une clé : la révocation y serait du code
--    mort. Le déclencheur, lui, couvre la porte, l'administration et toute porte
--    future. Sans lui, l'écran des clés (Intégrations du cabinet) montrerait active
--    une clé qui ne résout plus.
--
-- 3. Les clés dont l'auteur n'est déjà plus expert du cabinet sont révoquées
--    aujourd'hui, avec leur trace : l'écran dit vrai dès cette migration.
--
-- REJEU (R11) : rien n'écrit dans une donnée de référence ; `revoked_at` et le journal
-- sont des données métier, datées du jour où l'on joue.

-- --- 1. La résolution ------------------------------------------------------------------
create or replace function public.api_key_resoudre(p_cle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select k.id, k.tenant_id, k.portees, k.created_by
    into r
    from identity.api_keys k
    join identity.organizations o on o.id = k.tenant_id and o.archived_at is null
   where k.empreinte = encode(sha256(convert_to(coalesce(p_cle, ''), 'UTF8')), 'hex')
     and k.revoked_at is null
     -- L'auteur est encore expert du cabinet : une clé ne survit pas à son départ.
     and exists (select 1 from identity.memberships m
                  where m.tenant_id = k.tenant_id and m.user_id = k.created_by
                    and m.role = 'expert');
  if not found then
    return null;
  end if;

  update identity.api_keys
     set last_used_at = now()
   where id = r.id
     and (last_used_at is null or last_used_at < now() - interval '1 minute');

  return jsonb_build_object('id', r.id, 'tenantId', r.tenant_id,
                            'portees', to_jsonb(r.portees), 'auNomDe', r.created_by);
end $$;

revoke all on function public.api_key_resoudre(text) from public, anon;
grant execute on function public.api_key_resoudre(text) to authenticated;

-- --- 2. Le départ révoque --------------------------------------------------------------
-- L'acteur du journal est celui qui retire l'adhésion ; hors de toute identité
-- (l'administration), c'est la personne partie, dont le départ est la cause.
-- `security definer`, comme tout déclencheur qui écrit : il agit pour la base,
-- quel que soit le chemin qui retire l'adhésion.
create or replace function identity.revoquer_les_cles_au_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un changement de rôle qui laisse l'expert expert ne révoque rien.
  if tg_op = 'UPDATE' and new.role = 'expert' then
    return new;
  end if;
  with revoquees as (
    update identity.api_keys k
       set revoked_at = now()
     where k.tenant_id = old.tenant_id
       and k.created_by = old.user_id
       and k.revoked_at is null
    returning k.id, k.prefixe
  )
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  select old.tenant_id, coalesce(auth.uid(), old.user_id), 'api_key.revoquee', 'identity',
         'api_keys', r.id,
         jsonb_build_object('prefixe', r.prefixe, 'motif', 'depart_de_l_auteur')
    from revoquees r;
  return null;
end $$;

revoke all on function identity.revoquer_les_cles_au_depart() from public, anon, authenticated;

drop trigger if exists revoquer_les_cles_au_depart on identity.memberships;
create trigger revoquer_les_cles_au_depart
  after delete or update of role on identity.memberships
  for each row execute function identity.revoquer_les_cles_au_depart();

-- --- 3. Les clés dont l'auteur n'est déjà plus expert du cabinet -----------------------
with revoquees as (
  update identity.api_keys k
     set revoked_at = now()
   where k.revoked_at is null
     and not exists (select 1 from identity.memberships m
                      where m.tenant_id = k.tenant_id and m.user_id = k.created_by
                        and m.role = 'expert')
  returning k.id, k.tenant_id, k.prefixe, k.created_by
)
insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                             object_id, payload)
select r.tenant_id, r.created_by, 'api_key.revoquee', 'identity', 'api_keys', r.id,
       jsonb_build_object('prefixe', r.prefixe, 'motif', 'depart_de_l_auteur')
  from revoquees r;
