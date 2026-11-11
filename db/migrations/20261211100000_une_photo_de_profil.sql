-- ======================================================================
--  Une photo de profil (11 novembre 2026).
--
--  La pastille d'un siège porte les initiales de la personne ; sa photo,
--  « le jour où le compte en aura une », prend sa place
--  (`rangee-des-sieges.tsx`). Ce jour est là.
--
--  Ce que la base garde, c'est l'EMPREINTE de la photo, pas ses octets :
--  les octets vivent dans le stockage, au chemin que le serveur calcule
--  (`<racine>/profils/<user_id>.jpg`), comme ceux d'une pièce. L'empreinte
--  dit qu'une photo existe, et sert de version à l'écran (une photo changée
--  se recharge, une photo inchangée non).
--
--  Qui la voit : la RLS de `identity.profiles` (`profiles_own`) — moi, les
--  membres de mes organisations, l'accès total. Aucune seconde règle ; la
--  route de lecture demande la ligne à la base, sous l'identité de l'appelant.
--
--  Qui l'écrit : la personne, pour elle seule, par sa porte (R6).
-- ======================================================================

begin;

alter table identity.profiles
  add column if not exists photo_version text
  constraint profiles_photo_version_check
    check (photo_version is null or photo_version ~ '^[0-9a-f]{64}$');

comment on column identity.profiles.photo_version is
  'L''empreinte SHA-256 (hex) de la photo de profil gardée dans le stockage ; null : pas de photo. Elle sert aussi de version à l''écran.';

-- La photo, à soi seul. `null` l'ôte ; la forme de l'empreinte, la contrainte la tient.
create or replace function public.ma_photo_ecrire(p_version text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  insert into identity.profiles (user_id, photo_version)
  values (auth.uid(), p_version)
  on conflict (user_id) do update set photo_version = excluded.photo_version
  returning photo_version into v_version;
  return v_version;
end
$$;

comment on function public.ma_photo_ecrire(text) is
  'Écrit (ou ôte, avec null) l''empreinte de la photo de profil de l''appelant ; la contrainte de la colonne refuse toute autre forme.';

alter function public.ma_photo_ecrire(text) owner to portier;
revoke all on function public.ma_photo_ecrire(text) from public, anon;
grant execute on function public.ma_photo_ecrire(text) to authenticated;

commit;
