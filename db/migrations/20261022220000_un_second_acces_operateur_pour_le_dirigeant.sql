-- Un second accès opérateur pour le dirigeant d'ALGORIA Factory (20 octobre 2026).
--
-- Le compte w.barouni@algoria-factory.com existe sur staging, mais son mot de
-- passe est perdu et le produit n'a pas encore de réinitialisation. Pour ne pas
-- bloquer le développement, le dirigeant crée un nouvel accès à cette adresse,
-- avec un mot de passe qu'il choisit lui-même ; il devient opérateur à la
-- création (`app.operateurs_attendus`, migration 20261022210000).
--
-- REJEU (R11) : `on conflict do nothing`.

begin;

insert into app.operateurs_attendus (email, note)
values ('operateur@algoria-factory.com',
        'Dirigeant d''ALGORIA Factory — second accès à la tour (décision du 20 octobre 2026)')
on conflict (email) do nothing;

insert into app.platform_operators (user_id, note)
select u.id, a.note
  from auth.users u
  join app.operateurs_attendus a on a.email = lower(btrim(u.email))
 where a.email = 'operateur@algoria-factory.com'
on conflict (user_id) do nothing;

update app.operateurs_attendus a set honore_le = now()
 where a.email = 'operateur@algoria-factory.com' and a.honore_le is null
   and exists (select 1 from auth.users u where lower(btrim(u.email)) = a.email);

commit;
