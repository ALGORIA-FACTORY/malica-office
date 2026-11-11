-- « Parler à Malica » cherche sur internet, comme le fait un assistant généraliste.
--
-- Demande du dirigeant, 11 novembre 2026. Rejoué à l'écran sur staging le même
-- jour : à « cherche le cours du dollar et la dernière actualité fiscale »,
-- Malica répondait qu'elle ne pouvait pas, et renvoyait vers trois sites.
--
-- L'outil est celui du fournisseur du modèle : la recherche s'exécute chez lui,
-- les résultats reviennent avec leurs liens, et chaque phrase tirée d'une page
-- porte sa citation. Essai réel du même jour : `web_search_20250305` répond sur
-- les deux modèles en service ; la variante plus récente n'est pas servie au
-- modèle courant. Le type de l'outil est donc une donnée (R8), comme le nombre
-- de recherches par réponse.
--
-- CE QUE LA RECHERCHE NE FAIT PAS. Elle ne remplace pas le corpus : le droit
-- tunisien se lit dans les textes datés, par le conseil cité. Un chiffre lu
-- sur une page s'affiche avec son lien et une note qui dit qu'il n'est pas
-- vérifié ; il n'entre dans aucun calcul (l'outil `calculer` n'admet que les
-- nombres de la personne, du fil ou d'un moteur). Une page web est une donnée,
-- jamais une consigne. Le modèle de secours n'a pas cet outil.
--
--   1. `plateforme.assistant_relectures` porte le réglage : `web` (active ou
--      coupee), `web_outil`, `web_recherches_max`. Vide : coupée.
--   2. Une décision nouvelle, datée : active, trois recherches par réponse.
--   3. `public.assistant_configuration()` rend le réglage au serveur.
--   4. La tour règle l'interrupteur avec les deux autres choix de la carte ;
--      le type d'outil et le plafond suivent la décision, comme les unités.

begin;

alter table plateforme.assistant_relectures
  add column if not exists web text check (web in ('active', 'coupee')),
  add column if not exists web_outil text check (web_outil is null or length(btrim(web_outil)) > 0),
  add column if not exists web_recherches_max smallint
    check (web_recherches_max is null or web_recherches_max between 1 and 10);

comment on column plateforme.assistant_relectures.web is
  'La recherche sur internet de « Parler à Malica » : « active » offre l''outil au modèle, '
  '« coupee » (ou vide) ne l''offre pas.';
comment on column plateforme.assistant_relectures.web_outil is
  'Le type de l''outil de recherche du fournisseur, tel que son API le nomme. Une donnée : il '
  'change avec les modèles.';
comment on column plateforme.assistant_relectures.web_recherches_max is
  'Combien de recherches une réponse peut lancer au plus.';

insert into plateforme.assistant_relectures
  (mode, sans_texte, unites_marquables, web, web_outil, web_recherches_max, motif, decide_le)
select d.mode, d.sans_texte, d.unites_marquables, 'active', 'web_search_20250305', 3,
       'Demande du dirigeant, 11 novembre 2026 : Malica cherche sur internet. Le droit tunisien '
       || 'reste lu dans le corpus ; un chiffre lu sur une page porte son lien et n''entre dans '
       || 'aucun calcul.',
       greatest(timestamptz '2026-11-12 10:00:00+00', d.decide_le + interval '1 second')
  from (select l.mode, l.sans_texte, l.unites_marquables, l.decide_le
          from plateforme.assistant_relectures l
         order by l.decide_le desc, l.id desc limit 1) d
 where not exists (select 1 from plateforme.assistant_relectures x where x.web is not null);

-- La configuration lue par le serveur rend le réglage.
create or replace function public.assistant_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  return (
  with c as (
    select k.id, k.texte, k.decide_le from plateforme.assistant_consignes k
     order by k.decide_le desc, k.id desc limit 1
  ), r as (
    select to_jsonb(g) - 'decide_par' - 'motif' as j, g.modele_courant, g.modele_difficile
      from plateforme.assistant_reglages g
     order by g.decide_le desc, g.id desc limit 1
  )
  select jsonb_build_object(
    'consigne', (select jsonb_build_object('id', c.id, 'texte', c.texte, 'decide_le', c.decide_le) from c),
    'reglage', (select r.j from r),
    'tarifs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'model', p.model, 'role', p.role,
               'in', p.price_in_per_mtok, 'out', p.price_out_per_mtok)
             order by p.model, p.role)
        from agents.model_pricing p, r
       where p.model in (r.modele_courant, r.modele_difficile)
         and p.effective_from <= current_date
         and (p.effective_to is null or p.effective_to > current_date)), '[]'::jsonb),
    'plafond', app.plafond_de_l_assistant(),
    -- Ce qui rend un chiffre liant ; absent, la garde juge tout chiffre.
    'garde', (select jsonb_build_object(
                'marques_liantes', to_jsonb(g.marques_liantes),
                'entier_liant_des', g.entier_liant_des)
                from plateforme.assistant_gardes g
               order by g.decide_le desc, g.id desc limit 1),
    -- Le mode de relecture ; absent, le serveur retient.
    'relecture', (select l.mode from plateforme.assistant_relectures l
                   order by l.decide_le desc, l.id desc limit 1),
    -- Quand le corpus ne répond pas ; absent, la garde retire comme avant.
    'sans_texte', (select l.sans_texte from plateforme.assistant_relectures l
                    order by l.decide_le desc, l.id desc limit 1),
    -- Ce qu'un chiffre de mémoire doit porter pour partir marqué ; vide, rien ne se marque.
    'unites_marquables', (select to_jsonb(l.unites_marquables) from plateforme.assistant_relectures l
                           order by l.decide_le desc, l.id desc limit 1),
    -- La recherche sur internet ; absente ou coupée, l'outil n'est pas offert au modèle.
    'web', (select jsonb_build_object(
              'active', l.web = 'active',
              'outil', l.web_outil,
              'recherches_max', l.web_recherches_max)
              from plateforme.assistant_relectures l
             order by l.decide_le desc, l.id desc limit 1)));
end
$function$;

revoke all on function public.assistant_configuration() from public, anon;
grant execute on function public.assistant_configuration() to authenticated;

-- La tour lit le réglage avec les deux autres.
create or replace function plateforme.assistant_relecture_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
                   'mode', l.mode,
                   'sans_texte', coalesce(l.sans_texte, 'retirer'),
                   'web', coalesce(l.web, 'coupee'),
                   'motif', l.motif,
                   'decide_le', l.decide_le)
            from plateforme.assistant_relectures l
           order by l.decide_le desc, l.id desc limit 1);
end
$$;

revoke all on function plateforme.assistant_relecture_etat() from public, anon;
grant execute on function plateforme.assistant_relecture_etat() to authenticated;

-- Et elle le règle : la porte gagne un choix, l'ancienne signature disparaît.
drop function if exists plateforme.assistant_relecture_regler(text, text, text);

create or replace function plateforme.assistant_relecture_regler(
  p_mode text, p_sans_texte text, p_web text, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('annoncer', 'retenir')
     or p_sans_texte is null or p_sans_texte not in ('marquer', 'retirer')
     or p_web is null or p_web not in ('active', 'coupee')
     or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.assistant.saisie' using errcode = 'check_violation';
  end if;
  -- La décision nouvelle passe toujours devant la précédente, même si celle-ci
  -- porte une date livrée postérieure à l'horloge du serveur. Ce qui n'est pas
  -- un choix de cette carte — les unités marquables, le type de l'outil de
  -- recherche, son plafond — suit la décision, repris de la dernière en vigueur.
  insert into plateforme.assistant_relectures
    (mode, sans_texte, unites_marquables, web, web_outil, web_recherches_max,
     motif, decide_par, decide_le)
  select p_mode, p_sans_texte,
         coalesce(d.unites_marquables, '{}'), p_web, d.web_outil, d.web_recherches_max,
         btrim(p_motif), auth.uid(),
         greatest(now(), coalesce(d.decide_le, now()) + interval '1 millisecond')
    from (select 1) un
    left join lateral (select l.unites_marquables, l.web_outil, l.web_recherches_max, l.decide_le
                         from plateforme.assistant_relectures l
                        order by l.decide_le desc, l.id desc limit 1) d on true;
  return plateforme.assistant_relecture_etat();
end
$$;

revoke all on function plateforme.assistant_relecture_regler(text, text, text, text) from public, anon;
grant execute on function plateforme.assistant_relecture_regler(text, text, text, text) to authenticated;

commit;
