-- Le nom tapé à l'inscription n'allait nulle part.
--
-- Recette du 8 novembre 2026 : « Nom et prénom » est demandé à la création de
-- l'accès, `creerCompte` le range dans `auth.users.raw_user_meta_data`, mais
-- AUCUN profil n'est créé. Le salut de l'accueil, l'avatar et la liste des
-- collaborateurs du cabinet lisent `identity.profiles` : ils montraient
-- l'adresse e-mail, ou une initiale tirée de l'adresse, à quelqu'un qui venait
-- de taper son nom.
--
-- Le profil naît donc avec le compte, dans la même transaction, dès que
-- l'inscription a reçu un nom. Rien n'est deviné : « Nom et prénom » est un
-- seul champ, dont l'ordre n'est pas sûr — il va dans `display_name`, tel
-- quel. `prenom` et `nom` ne sont remplis que s'ils arrivent séparés. Sans
-- aucun nom, rien n'est créé : le profil naîtra quand la personne l'écrira
-- (`mon_profil_ecrire`), comme avant.
create or replace function identity.profil_naissant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, identity
as $$
begin
  if coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
              nullif(btrim(new.raw_user_meta_data ->> 'prenom'), ''),
              nullif(btrim(new.raw_user_meta_data ->> 'nom'), '')) is null then
    return new;
  end if;
  insert into identity.profiles (user_id, display_name, prenom, nom)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'prenom'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'nom'), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function identity.profil_naissant() from public;

create trigger le_compte_a_son_profil
  after insert on auth.users
  for each row execute function identity.profil_naissant();

-- Les comptes déjà ouverts sans profil retrouvent le nom qu'ils avaient tapé.
insert into identity.profiles (user_id, display_name)
select u.id, nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '')
  from auth.users u
 where not exists (select 1 from identity.profiles p where p.user_id = u.id)
   and nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') is not null;

-- L'adresse du siège, que le cabinet saisit en ouvrant le dossier, n'était
-- servie par aucune lecture : l'écran de bienvenue affichait « — » sous une
-- adresse connue. La vue des organisations la porte désormais, en dernière
-- colonne (une vue ne s'étend qu'à la fin).
create or replace view public.organizations_v
  with (security_invoker = true) as
select id,
       kind,
       name,
       legal_id,
       jurisdiction,
       currency,
       validation_mode,
       created_by,
       created_at,
       updated_at,
       archived_at,
       archived_reason,
       adresse
  from identity.organizations
 where archived_at is null;
