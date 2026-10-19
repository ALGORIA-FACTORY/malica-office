-- Le dirigeant d'ALGORIA Factory opère la tour (décidé le 20 octobre 2026).
--
-- La tour — grille, paiement, émetteur des factures, abonnement — ne s'ouvre
-- qu'aux opérateurs de la plateforme (`app.platform_operators`). Ce niveau ne
-- s'accorde par aucune route, et personne ne l'avait sur staging : l'émetteur
-- des factures ne pouvait donc être désigné par personne, et sans émetteur il
-- n'y a ni TTC, ni paiement en ligne, ni facture.
--
-- Le compte désigné est celui que le dirigeant a nommé :
-- w.barouni@algoria-factory.com. S'il existe quand la migration joue, il
-- devient opérateur tout de suite. S'il n'existe pas encore, il le devient à
-- sa création : `app.operateurs_attendus` garde l'adresse, et un déclencheur
-- sur `auth.users` l'honore une fois, puis l'attente se referme.
--
-- REJEU (R11) : `on conflict do nothing` partout, déclencheur recréé.

begin;

create table if not exists app.operateurs_attendus (
  email      text primary key check (email = lower(btrim(email))),
  note       text not null,
  attendu_le timestamptz not null default now(),
  honore_le  timestamptz
);

alter table app.operateurs_attendus enable row level security;
revoke all on table app.operateurs_attendus from public, anon, authenticated;

comment on table app.operateurs_attendus is
  'Les adresses qui deviennent opérateur de plateforme à la création de leur '
  'compte. Écrites par migration seulement ; aucune route n''y touche.';

insert into app.operateurs_attendus (email, note)
values ('w.barouni@algoria-factory.com',
        'Dirigeant d''ALGORIA Factory — opère la tour (décision du 20 octobre 2026)')
on conflict (email) do nothing;

create or replace function app.honorer_operateur_attendu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and exists (
       select 1 from app.operateurs_attendus a
        where a.email = lower(btrim(new.email)) and a.honore_le is null) then
    insert into app.platform_operators (user_id, note)
    select new.id, a.note from app.operateurs_attendus a where a.email = lower(btrim(new.email))
    on conflict (user_id) do nothing;
    update app.operateurs_attendus set honore_le = now()
     where email = lower(btrim(new.email));
  end if;
  return new;
end
$$;

revoke all on function app.honorer_operateur_attendu() from public, anon, authenticated;

drop trigger if exists operateur_attendu on auth.users;
create trigger operateur_attendu
  after insert on auth.users
  for each row execute function app.honorer_operateur_attendu();

-- Le compte existe déjà : il est opérateur dès maintenant.
insert into app.platform_operators (user_id, note)
select u.id, a.note
  from auth.users u
  join app.operateurs_attendus a on a.email = lower(btrim(u.email))
on conflict (user_id) do nothing;

update app.operateurs_attendus a set honore_le = now()
 where a.honore_le is null
   and exists (select 1 from auth.users u where lower(btrim(u.email)) = a.email);

commit;
