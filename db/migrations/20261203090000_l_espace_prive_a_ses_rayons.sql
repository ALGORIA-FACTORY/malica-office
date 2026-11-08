-- ======================================================================
--  L'espace privé a ses rayons (planche 10, approuvée le 7 novembre 2026).
--
--  « Des rayons à soi, pas une liste "Non lue". » Un papier gardé pour soi
--  n'est jamais lu (B6) : rien ne lui donne un nom ni un classement. La
--  personne les donne elle-même, d'un toucher : un rayon (Maison, Santé,
--  Véhicule, Identité, Autres, ou un rayon à elle) et, si elle veut, un nom.
--
--  C'est à ELLE seule : le rangement est lu et écrit par son auteur, jamais
--  par le dirigeant, le cabinet ni la plateforme — comme l'espace privé
--  lui-même (`l-espace-prive-l-est-aussi-du-patron.test.ts`). Il ne s'écrit
--  que sur un papier privé dont elle est l'auteur, par sa porte (R6).
--
--  Le rayon est un code pour les rayons proposés (traduits à l'écran), ou le
--  nom que la personne a donné à son rayon.
-- ======================================================================

begin;

create table capture.rangements_prives (
  piece_id   uuid primary key references capture.pieces (id) on delete cascade,
  tenant_id  uuid not null references identity.organizations (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rayon      text not null check (char_length(btrim(rayon)) between 1 and 40),
  nom        text check (nom is null or char_length(btrim(nom)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rangements_prives_user_idx on capture.rangements_prives (user_id, tenant_id);

comment on table capture.rangements_prives is
  'Le rayon et le nom qu''une personne donne à un papier de son espace privé (planche 10). Lu et écrit par son auteur seul.';

create trigger rangements_prives_touch before update on capture.rangements_prives
  for each row execute function app.touch_updated_at();

alter table capture.rangements_prives enable row level security;
alter table capture.rangements_prives force row level security;
revoke all on table capture.rangements_prives from public, anon, authenticated;
grant select on table capture.rangements_prives to authenticated;
grant insert, update on table capture.rangements_prives to portier;

create policy rangements_prives_sel on capture.rangements_prives
  for select to authenticated using (user_id = auth.uid());
create policy rangements_prives_ins on capture.rangements_prives
  for insert to authenticated with check (user_id = auth.uid());
create policy rangements_prives_upd on capture.rangements_prives
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Le relecteur de nuit (compte de service) n'y écrit ni n'y lit : un papier
-- privé n'est jamais relu (`20261118100000_le_relecteur_de_nuit`).
create trigger service_hors_perimetre before insert or update or delete on capture.rangements_prives
  for each statement execute function app.service_hors_perimetre();
create policy service_hors_perimetre on capture.rangements_prives as restrictive for select
  to authenticated using ((select app.service()) is null);

-- Ranger un papier privé : son rayon, et son nom s'il en a un. Pour soi seul.
create or replace function public.piece_privee_ranger(p_piece uuid, p_rayon text, p_nom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_rangement jsonb;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select tenant_id into v_tenant
    from capture.pieces
   where id = p_piece and vis = 'personnel'::app.vis_t and created_by = auth.uid();
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  insert into capture.rangements_prives (piece_id, tenant_id, user_id, rayon, nom)
  values (p_piece, v_tenant, auth.uid(), btrim(p_rayon), nullif(btrim(p_nom), ''))
  on conflict (piece_id) do update set rayon = excluded.rayon, nom = excluded.nom
  returning jsonb_build_object('piece_id', piece_id, 'rayon', rayon, 'nom', nom)
    into v_rangement;
  return v_rangement;
end
$$;

comment on function public.piece_privee_ranger(uuid, text, text) is
  'Donne un rayon et, s''il y en a un, un nom à un papier privé dont l''appelant est l''auteur (planche 10).';

alter function public.piece_privee_ranger(uuid, text, text) owner to portier;
revoke all on function public.piece_privee_ranger(uuid, text, text) from public, anon;
grant execute on function public.piece_privee_ranger(uuid, text, text) to authenticated;

commit;
