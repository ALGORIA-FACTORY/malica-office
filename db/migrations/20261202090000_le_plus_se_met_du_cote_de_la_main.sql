-- ======================================================================
--  Le « + » se met du côté de la main (planche 5, approuvée le 7 novembre 2026).
--
--  « Le + est toujours à droite. Pour un gaucher qui tient son téléphone
--  d'une main, il est hors de portée du pouce. » Le côté devient un réglage :
--  à droite (comme aujourd'hui, par défaut) ou à gauche.
--
--  « Le choix suit votre compte : téléphone, ordinateur et application
--  Android. » Il vit donc dans le profil de la personne, pas dans le
--  navigateur, et ne s'écrit que par sa porte (R6), pour soi seul.
-- ======================================================================

begin;

alter table identity.profiles
  add column if not exists cote_du_plus text not null default 'droite'
  constraint profiles_cote_du_plus_check check (cote_du_plus in ('gauche', 'droite'));

comment on column identity.profiles.cote_du_plus is
  'Le côté du bouton « + » dans la barre du bas : droite (par défaut) ou gauche. Le côté physique, sous le pouce : le même en arabe.';

-- Le côté du « + », à soi seul.
create or replace function public.mon_cote_du_plus_ecrire(p_cote text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cote text;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  insert into identity.profiles (user_id, cote_du_plus)
  values (auth.uid(), p_cote)
  on conflict (user_id) do update set cote_du_plus = excluded.cote_du_plus
  returning cote_du_plus into v_cote;
  return v_cote;
end
$$;

comment on function public.mon_cote_du_plus_ecrire(text) is
  'Écrit le côté du bouton « + » de l''appelant (gauche ou droite) ; la contrainte de la colonne refuse le reste.';

alter function public.mon_cote_du_plus_ecrire(text) owner to portier;
revoke all on function public.mon_cote_du_plus_ecrire(text) from public, anon;
grant execute on function public.mon_cote_du_plus_ecrire(text) to authenticated;

-- Écrire son nom rend aussi le côté du « + » : le profil revient entier.
create or replace function public.mon_profil_ecrire(p_prenom text, p_nom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil jsonb;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  insert into identity.profiles (user_id, prenom, nom)
  values (auth.uid(), nullif(btrim(p_prenom), ''), nullif(btrim(p_nom), ''))
  on conflict (user_id) do update set prenom = excluded.prenom, nom = excluded.nom
  returning jsonb_build_object('prenom', prenom, 'nom', nom, 'display_name', display_name,
                               'cote_du_plus', cote_du_plus)
    into v_profil;
  return v_profil;
end
$$;

commit;
