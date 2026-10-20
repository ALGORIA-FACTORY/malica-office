-- lab@algoria-factory.com opère la tour (décidé le 20 octobre 2026).
--
-- Le dirigeant d'ALGORIA Factory veut mener les essais de staging avec
-- l'adresse du laboratoire. Elle devient opérateur à la création de son
-- compte, ou tout de suite s'il existe (`app.operateurs_attendus`, migration
-- 20261022210000).
--
-- REJEU (R11) : `on conflict do nothing`.

begin;

insert into app.operateurs_attendus (email, note)
values ('lab@algoria-factory.com',
        'Laboratoire d''ALGORIA Factory — essais de la tour (décision du 20 octobre 2026)')
on conflict (email) do nothing;

insert into app.platform_operators (user_id, note)
select u.id, a.note
  from auth.users u
  join app.operateurs_attendus a on a.email = lower(btrim(u.email))
 where a.email = 'lab@algoria-factory.com'
on conflict (user_id) do nothing;

update app.operateurs_attendus a set honore_le = now()
 where a.email = 'lab@algoria-factory.com' and a.honore_le is null
   and exists (select 1 from auth.users u where lower(btrim(u.email)) = a.email);

commit;
