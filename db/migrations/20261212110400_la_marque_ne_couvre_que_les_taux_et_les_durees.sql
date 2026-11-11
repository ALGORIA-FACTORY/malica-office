-- La marque « non vérifié » ne couvre qu'un taux ou une durée, jamais un montant.
--
-- Revue indépendante de la PR #352, constat reproduit : une fois le corpus
-- muet, la garde marquait TOUT chiffre sans source — y compris un montant de
-- facture inventé et le résultat d'un calcul fait de tête. Cela contredisait
-- l'en-tête de `20261212110200` (« un montant du dossier sans source reste
-- retiré ») et R3.
--
-- La décision du dirigeant (M-9) porte sur « un taux, un délai ». La base dit
-- désormais ce que cela veut dire : les unités qu'un nombre doit porter pour
-- partir marqué (R4 : en base, réglable). Tout autre chiffre sans source est
-- retiré, comme avant. Sans liste, rien ne se marque.

begin;

alter table plateforme.assistant_relectures
  add column if not exists unites_marquables text[] not null default '{}'
    check (cardinality(unites_marquables) <= 200);

comment on column plateforme.assistant_relectures.unites_marquables is
  'Les unités de taux et de durée (« % », « jours »…) qu''un chiffre de mémoire doit porter pour '
  'partir marqué « non vérifié » quand le corpus s''est tu. Vide : rien ne se marque.';

insert into plateforme.assistant_relectures (mode, sans_texte, unites_marquables, motif, decide_le)
select l.mode, l.sans_texte,
       array[
         '%', '٪', 'pour cent', 'pourcent', 'percent',
         'jour', 'jours', 'semaine', 'semaines', 'mois', 'an', 'ans', 'année', 'années',
         'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
         'يوم', 'يوما', 'يومًا', 'أيام', 'أسبوع', 'أسابيع', 'شهر', 'أشهر', 'سنة', 'سنوات'
       ]::text[],
       'Revue de la PR #352 : la marque « non vérifié » ne couvre qu''un taux ou une durée ; '
       || 'un montant sans source reste retiré.',
       l.decide_le + interval '1 second'
  from (select r.mode, r.sans_texte, r.decide_le from plateforme.assistant_relectures r
         order by r.decide_le desc, r.id desc limit 1) l
 where not exists (select 1 from plateforme.assistant_relectures x
                    where cardinality(x.unites_marquables) > 0);

-- La configuration lue par le serveur rend la liste.
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
                           order by l.decide_le desc, l.id desc limit 1)));
end
$function$;

revoke all on function public.assistant_configuration() from public, anon;
grant execute on function public.assistant_configuration() to authenticated;

-- La tour garde la liste quand elle inscrit une décision nouvelle.
create or replace function plateforme.assistant_relecture_regler(
  p_mode text, p_sans_texte text, p_motif text)
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
     or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.assistant.saisie' using errcode = 'check_violation';
  end if;
  -- La décision nouvelle passe toujours devant la précédente, même si celle-ci
  -- porte une date livrée postérieure à l'horloge du serveur.
  -- La liste des unités marquables n'est pas un choix de cette carte : elle
  -- suit la décision, reprise de la dernière en vigueur.
  insert into plateforme.assistant_relectures
    (mode, sans_texte, unites_marquables, motif, decide_par, decide_le)
  select p_mode, p_sans_texte,
         coalesce((select d.unites_marquables from plateforme.assistant_relectures d
                    order by d.decide_le desc, d.id desc limit 1), '{}'),
         btrim(p_motif), auth.uid(),
         greatest(now(), coalesce(max(l.decide_le), now()) + interval '1 millisecond')
    from plateforme.assistant_relectures l;
  return plateforme.assistant_relecture_etat();
end
$$;

revoke all on function plateforme.assistant_relecture_regler(text, text, text) from public, anon;
grant execute on function plateforme.assistant_relecture_regler(text, text, text) to authenticated;

commit;
