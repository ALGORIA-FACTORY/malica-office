-- Premium garantit ses lectures, même avec une seule société (décidé le 19
-- octobre 2026).
--
-- La grille du 19 octobre donne au Premium 140 lectures par société et deux
-- sociétés incluses. Lue telle quelle, une licence Premium à UNE société avait
-- 140 lectures pour 59 DT — moins qu'un Team avec deux places de plus (220
-- lectures pour 50 DT). Wissem a tranché : les lectures des sociétés INCLUSES
-- sont dues, qu'elles soient occupées ou non. 280 sur un Premium, partagées
-- entre ses sociétés ; +140 à partir de la troisième.
--
-- La règle s'écrit pour toutes les offres d'un même geste : les lectures
-- comptent `greatest(sociétés rattachées, sociétés incluses)`. Basic, Solo et
-- Team incluent une société : rien ne change pour eux. Aucune constante
-- nouvelle (R4) : tout vient de `ref.offres`.

create or replace view facturation.droits_v with (security_invoker = true) as
select
  l.id as licence_id,
  l.titulaire,
  h.offre_code,
  l.statut,
  o.libelle as offre_libelle,
  p.organisations,
  o.organisations_max,
  p.sieges_occupes,
  o.sieges_inclus,
  o.sieges_max,
  o.lectures_par_organisation * greatest(p.organisations, o.organisations_incluses)
    + o.lectures_par_siege_sup * greatest(0, p.sieges_occupes - o.sieges_inclus) as lectures_droit,
  t.prix_total_ht as prix_mensuel_ht,
  o.rang as offre_rang,
  h.canal,
  h.offre_depuis,
  h.id as forfait_id,
  l.origine,
  l.origine_cabinet,
  o.prix_mensuel_ht as prix_offre_ht,
  o.organisations_incluses
from facturation.licences l
join facturation.forfait_courant_v h on h.licence_id = l.id
cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
join facturation.places_v p on p.licence_id = l.id
cross join lateral (
  select (o.prix_mensuel_ht::numeric
          + o.prix_siege_sup::numeric * greatest(0, p.sieges_occupes - o.sieges_inclus)::numeric
          + o.prix_organisation_sup::numeric * greatest(0, p.organisations - o.organisations_incluses)::numeric
         )::app.money_t as prix_total_ht
) t;

-- La grille, vue de l'application : elle dit désormais les lectures que
-- l'offre GARANTIT (`lectures_incluses`), pas seulement le taux par société —
-- l'écran n'a pas à multiplier (R3). Le type de retour change : la fonction
-- se recrée.
drop function public.mes_offres(uuid, date);

create function public.mes_offres(p_tenant uuid default null, p_le date default current_date)
returns table (
  code text, libelle text, rang smallint, prix_mensuel_ht numeric,
  lectures_par_organisation integer, lectures_incluses integer,
  sieges_inclus smallint, sieges_max smallint,
  organisations_incluses smallint, organisations_max smallint,
  courant boolean, empechement text, chiffres jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
begin
  select f.offre_code into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;

  return query
    with grille as (
      select distinct on (o.code) o.*
        from ref.offres o
       where o.effective_from <= p_le
       order by o.code, o.effective_from desc)
    select g.code, g.libelle, g.rang, g.prix_mensuel_ht::numeric,
           g.lectures_par_organisation,
           (g.lectures_par_organisation * g.organisations_incluses)::int,
           g.sieges_inclus, g.sieges_max,
           g.organisations_incluses, g.organisations_max,
           (g.code = v_courant) as courant,
           e.code, e.chiffres
      from grille g
      cross join lateral facturation.empechement_de_forfait(v_licence, g.code, p_le) e
     order by g.rang;
end;
$$;

revoke all on function public.mes_offres(uuid, date) from public, anon;
grant execute on function public.mes_offres(uuid, date) to authenticated;

comment on function public.mes_offres(uuid, date) is
  'La grille en vigueur, offre par offre : prix, lectures garanties, places et '
  'sociétés, l''offre courante, et ce qui empêcherait d''y passer (un CODE).';
