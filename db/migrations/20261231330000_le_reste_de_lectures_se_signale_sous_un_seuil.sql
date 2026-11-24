-- Le reste de lectures se signale sous un seuil, réglé par la tour.
--
-- Pilote (24 novembre 2026) : sous le total des charges, en couleur d'alerte, « Il vous reste
-- 269 lectures sur 280 ce mois. Au-delà, vos charges de novembre seront incomplètes. » Une
-- alerte qui paraît à 96 % du forfait n'alerte de rien. L'écran l'affichait dès que le
-- compteur était lu, faute de seuil : « décider à partir de quel reste il doit se taire est
-- une décision de produit, pas une liberté d'écran » (pme.charges.tsx).
--
-- La décision (Wissem Barouni, 24 novembre 2026) : elle paraît sous un seuil. Le seuil est un
-- réglage de la tour, comme la durée d'un lien de paiement (20261222090000) : une colonne de
-- `plateforme.reglages_abonnement`, la dernière décision vaut, défaut livré 10 % du droit.
-- La base dit si le reste est bas (`public.lectures_basses`) ; l'écran lit ce verdict, il ne
-- calcule rien.
--
-- _Gardé par_ apps/api/src/facturation/le-reste-de-lectures-se-signale-sous-un-seuil.test.ts.

begin;

alter table plateforme.reglages_abonnement
  add column alerte_lectures_part numeric(4, 3) not null default 0.100
    check (alerte_lectures_part > 0 and alerte_lectures_part <= 1);

comment on column plateforme.reglages_abonnement.alerte_lectures_part is
  'Sous quelle part du droit du mois le reste de lectures se signale à la société (0,100 = 10 %). '
  'Défaut livré : 10 % ; la tour le change par une ligne de plus (R10).';

-- Repris de 20261222090000 ; ajoute la part d'alerte.
create or replace function public.abonnement_reglage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'lien_valide_minutes', r.lien_valide_minutes,
                               'alerte_lectures_part', r.alerte_lectures_part,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'annuel_ouvert', false, 'annuel_mois_offerts', 0,
                       'lien_valide_minutes', null, 'alerte_lectures_part', null,
                       'motif', null, 'decide_le', null))
$$;

-- Repris de 20261222090000 : la décision de la tour sur le report ou l'année garde la durée du
-- lien ET la part d'alerte en vigueur — une décision ne remet pas à son défaut ce qu'elle ne
-- touche pas.
create or replace function plateforme.abonnement_regler(
  p_report_mois smallint, p_annuel_ouvert boolean, p_annuel_mois_offerts smallint, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_courant plateforme.reglages_abonnement;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select r.* into v_courant
    from plateforme.reglages_abonnement r order by r.decide_le desc, r.id desc limit 1;
  insert into plateforme.reglages_abonnement
    (report_mois, annuel_ouvert, annuel_mois_offerts, lien_valide_minutes, alerte_lectures_part,
     motif, decide_par)
  values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts,
          coalesce(v_courant.lien_valide_minutes, 60),
          coalesce(v_courant.alerte_lectures_part, 0.100),
          p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$$;

-- Le verdict : le reste est-il bas ? Faux sans droit lu ; nul si aucune décision n'existe.
create or replace function public.lectures_basses(p_restantes numeric, p_droit numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_restantes is null or p_droit is null or p_droit <= 0 then false
    else p_restantes <= p_droit * (
      select r.alerte_lectures_part from plateforme.reglages_abonnement r
       order by r.decide_le desc, r.id desc limit 1)
  end
$$;

comment on function public.lectures_basses(numeric, numeric) is
  'Vrai quand le reste de lectures est au plus la part d''alerte réglée par la tour du droit du mois.';

revoke all on function public.lectures_basses(numeric, numeric) from public, anon;
grant execute on function public.lectures_basses(numeric, numeric) to authenticated;

commit;
