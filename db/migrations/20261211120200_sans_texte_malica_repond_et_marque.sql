-- « Parler à Malica » répond même quand le corpus se tait : le chiffre de mémoire part marqué.
--
-- Jusqu'ici, quand le conseil cité ne trouvait aucun texte, l'outil disait au
-- modèle « rapporte-le honnêtement, sans ajouter de règle de mémoire », et la
-- garde retirait toute phrase au chiffre liant sans source. La personne lisait
-- un refus.
--
-- Décision du dirigeant, 11 novembre 2026 (point M-9, choix 1) : Malica répond
-- quand même. Elle dit qu'elle n'a pas trouvé le point dans les textes,
-- explique la règle générale, et un chiffre tiré de sa mémoire s'affiche avec
-- la marque « non vérifié ». La réponse part chez l'expert-comptable quand un
-- cabinet suit le dossier. Ce chiffre n'entre jamais dans un calcul (l'outil
-- `calculer` n'admet que les nombres de la personne ou d'un outil) ni dans une
-- écriture (le modèle n'écrit rien).
--
-- La marque ne vaut QUE dans ce cas : le corpus, consulté dans le tour, n'a pas
-- répondu. Un montant du dossier sans source reste retiré (R2).
--
--   1. `plateforme.assistant_relectures.sans_texte` : `marquer` ou `retirer`.
--      Vide, la garde retire : le manque retombe du côté strict.
--   2. Une décision nouvelle, datée : `annoncer` et `marquer`.
--   3. `public.assistant_configuration()` rend la règle au serveur.
--   4. La consigne gagne la section « RÉPONDRE TOUJOURS ».

begin;

alter table plateforme.assistant_relectures
  add column if not exists sans_texte text check (sans_texte in ('marquer', 'retirer'));

comment on column plateforme.assistant_relectures.sans_texte is
  'Quand le corpus, consulté, ne répond pas : « marquer » laisse Malica répondre, ses chiffres '
  'marqués « non vérifié » ; « retirer » (ou vide) garde la règle stricte.';

insert into plateforme.assistant_relectures (mode, sans_texte, motif, decide_le)
select 'annoncer', 'marquer',
       'Décision du dirigeant, 11 novembre 2026 (M-9, choix 1) : sans texte trouvé, Malica répond '
       || 'quand même ; le chiffre de mémoire s''affiche marqué « non vérifié » et part chez l''expert.',
       timestamptz '2026-11-11 12:00:00+00'
 where not exists (select 1 from plateforme.assistant_relectures l where l.sans_texte is not null);

-- La configuration lue par le serveur gagne la règle « sans texte ».
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
                    order by l.decide_le desc, l.id desc limit 1)));
end
$function$;

revoke all on function public.assistant_configuration() from public, anon;
grant execute on function public.assistant_configuration() to authenticated;

insert into plateforme.assistant_consignes (texte, motif, decide_le)
select k.texte || E'\n\n' || $section$RÉPONDRE TOUJOURS
Tu ne laisses jamais la personne sans réponse. Pour une question de droit fiscal, comptable ou social, tu consultes d'abord conseil_fiscal. Si les textes répondent, tu réponds avec leurs citations. Si l'outil te dit que les textes ne répondent pas, tu réponds quand même : tu dis en une phrase que tu n'as pas trouvé ce point dans les textes, puis tu expliques la règle telle que tu la connais de façon générale — le principe, à qui il s'applique, ce qu'il faut faire en pratique. Un taux, un délai ou un montant que tu donnes alors de mémoire s'affiche avec la marque « non vérifié » : n'en donne que si tu en es raisonnablement sûre, n'en fais aucun calcul, et n'écris pas toi-même la marque. Tu ne dis jamais seulement « je ne sais pas » ou « consultez votre comptable » : tu donnes ce que tu sais, puis ce qui reste à confirmer.
Quand tu hésites entre deux lectures d'un texte, tu donnes les deux, tu dis laquelle te paraît la plus solide et pourquoi, et tu dis ce que l'expert-comptable devra trancher.$section$,
       'Décision du dirigeant, 11 novembre 2026 : Malica répond toujours ; sans texte, elle explique '
       || 'la règle générale et ses chiffres de mémoire partent marqués « non vérifié ».',
       greatest(timestamptz '2026-11-11 12:00:00+00', k.decide_le + interval '1 second')
  from (select c.texte, c.decide_le from plateforme.assistant_consignes c
         order by c.decide_le desc, c.id desc limit 1) k
 where position('RÉPONDRE TOUJOURS' in k.texte) = 0;

commit;
