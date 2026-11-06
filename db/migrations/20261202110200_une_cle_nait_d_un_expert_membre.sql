-- Une clé d'API naît d'un expert MEMBRE du cabinet.
--
-- ================================================================== POURQUOI
--
-- `20261202110000` exige, pour qu'une clé résolve, que son auteur soit expert du
-- cabinet par une adhésion RÉELLE : l'accès total ne vaut que pour la session de
-- l'opérateur. Mais la porte de création, elle, laissait passer l'opérateur sous
-- l'accès total (`api_keys_insert_expert` lit `app.has_org_role`, qui compte
-- l'adhésion virtuelle) : la clé naissait, l'écran Intégrations la listait
-- active, et elle ne résolvait jamais (vérification indépendante du lot S3).
--
-- ================================================================== CE QUI CHANGE
--
-- `api_key_creer` refuse une clé à qui n'est pas expert du cabinet par une
-- adhésion réelle : `refus.cle_api.expert_membre`. La règle de la création est
-- celle de la résolution — une clé active à l'écran résout. Un collaborateur du
-- cabinet, que la politique refusait déjà, reçoit désormais ce refus lisible au
-- lieu d'un refus de politique brut.
--
-- Le reste du corps est celui de `20261110090100`, inchangé.
--
-- REJEU (R11) : rien n'écrit dans une donnée de référence.

create or replace function public.api_key_creer(p_tenant uuid, p_libelle text, p_portees text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  -- La règle de `api_key_resoudre` : expert du cabinet, par une adhésion réelle.
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_tenant and m.user_id = auth.uid()
                    and m.role = 'expert') then
    raise exception 'refus.cle_api.expert_membre' using errcode = '42501';
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
end $$;
