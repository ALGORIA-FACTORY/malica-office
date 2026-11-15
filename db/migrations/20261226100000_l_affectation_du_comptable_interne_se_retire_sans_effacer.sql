-- ======================================================================
--  L'affectation d'un comptable interne se donne et se retire par la société
--  (décision du dirigeant, 12 novembre 2026, point 7 : un comptable interne
--  peut tenir plusieurs sociétés ; chaque propriétaire lui affecte la sienne,
--  révocablement ; rien de la grille ne change pour lui).
--
--  L'accès est la ligne de rôle `comptable` (`identity.memberships`), déjà
--  bornée par société et par RLS. Ce qui manquait : l'HISTORIQUE de l'affectation.
--  Un retrait qui effaçait la ligne ne laisserait aucune trace (R7). Donc :
--
--  1. `identity.affectations_comptable` : journal d'événements, en ajout seul
--     (`affectee` / `retiree`), alimenté par déclencheur sur les lignes de
--     rôle `comptable`. Aucune mise à jour, aucune suppression (déclencheur).
--  2. `public.comptable_interne_retirer(p_tenant, p_comptable)` : la porte du
--     propriétaire. Elle retire la ligne de rôle ; le déclencheur écrit
--     `retiree`. Après le retrait, la société n'est plus lue par ce comptable
--     (`app.dossiers_du_comptable_interne` ne lit que les rôles en vigueur).
--  3. Les affectations déjà données sont reprises au journal, datées de la
--     date de leur ligne de rôle (sans rien réécrire).
-- ======================================================================

-- 1. Le journal ---------------------------------------------------------------

create table identity.affectations_comptable (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.organizations (id),
  personne uuid not null,
  evenement text not null check (evenement in ('affectee', 'retiree')),
  par uuid,
  le timestamptz not null default now()
);

create index affectations_comptable_tenant_idx
  on identity.affectations_comptable (tenant_id, personne, le);

alter table identity.affectations_comptable enable row level security;

-- Lire : le propriétaire de la société, et le comptable lui-même.
create policy affectations_comptable_lire on identity.affectations_comptable
  for select to authenticated
  using (app.has_org_role(tenant_id, array['dirigeant'])
         or personne = auth.uid());

revoke all on identity.affectations_comptable from public, anon;
grant select on identity.affectations_comptable to authenticated;

-- Ajout seul, jamais de mise à jour ni de suppression (R7).
create function identity.affectations_comptable_immuables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'refus.journal.immuable' using errcode = '42501';
end
$$;

create trigger affectations_comptable_pas_de_retouche
  before update or delete on identity.affectations_comptable
  for each row execute function identity.affectations_comptable_immuables();

-- 2. Le déclencheur sur les lignes de rôle `comptable` -------------------------

create function identity.affectations_comptable_journaliser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.role = 'comptable' then
    insert into identity.affectations_comptable (tenant_id, personne, evenement, par)
    values (new.tenant_id, new.user_id, 'affectee', auth.uid());
  elsif tg_op = 'DELETE' and old.role = 'comptable' then
    insert into identity.affectations_comptable (tenant_id, personne, evenement, par)
    values (old.tenant_id, old.user_id, 'retiree', auth.uid());
  end if;
  return null;
end
$$;

revoke all on function identity.affectations_comptable_journaliser() from public, anon;

create trigger memberships_affectation_comptable
  after insert or delete on identity.memberships
  for each row execute function identity.affectations_comptable_journaliser();

-- 3. Reprise des affectations existantes ---------------------------------------

insert into identity.affectations_comptable (tenant_id, personne, evenement, par, le)
select m.tenant_id, m.user_id, 'affectee', null, coalesce(m.created_at, now())
  from identity.memberships m
 where m.role = 'comptable';

-- 4. La porte du propriétaire -------------------------------------------------

create function public.comptable_interne_retirer(p_tenant uuid, p_comptable uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_tenant and m.user_id = p_comptable and m.role = 'comptable') then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  delete from identity.memberships
   where tenant_id = p_tenant and user_id = p_comptable and role = 'comptable';
  return jsonb_build_object('retiree', true);
end
$$;

revoke all on function public.comptable_interne_retirer(uuid, uuid) from public, anon;
grant execute on function public.comptable_interne_retirer(uuid, uuid) to authenticated;
