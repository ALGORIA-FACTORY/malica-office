-- « Parler à Malica » répond toujours : la relecture du cabinet s'annonce, elle ne retient plus.
--
-- Depuis le 4 octobre 2026, un avis qui engage le dossier d'une PME sous mandat
-- était RETENU : la personne lisait « Votre comptable relit ma réponse », et la
-- réponse attendait dans la file du cabinet. Rien ne partait en flux.
--
-- Décision du dirigeant, 11 novembre 2026 : Malica répond toujours. En cas de
-- doute, elle le dit et annonce que la réponse part chez l'expert-comptable,
-- qui confirme, corrige ou écarte (docs/validation-chat-malica/
-- strategie-corpus-2026-11-11.md, section 6 bis).
--
-- Deux ajouts :
--
--   1. `plateforme.assistant_relectures` — le mode de relecture (R4, R10 : en
--      base, versionné, réglable sans déploiement). `annoncer` : la réponse
--      s'affiche, marquée « à confirmer », et part dans la file du cabinet.
--      `retenir` : la règle du 4 octobre. Sans ligne, le serveur retient : le
--      manque retombe du côté prudent.
--   2. `public.assistant_configuration()` rend ce mode au serveur.
--
-- La règle qui dit QUELLE réponse est à relire ne change pas (`doitEtreRelue`) :
-- un avis qui engage le dossier, demandé par un membre de la PME, sous mandat.

begin;

create table if not exists plateforme.assistant_relectures (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null check (mode in ('annoncer', 'retenir')),
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid references auth.users (id),
  decide_le   timestamptz not null default now()
);

comment on table plateforme.assistant_relectures is
  'Ce que devient, dans « Parler à Malica », une réponse que le cabinet doit relire : '
  '« annoncer » l''affiche marquée et l''envoie au cabinet, « retenir » ne montre que le '
  'message de relecture. La dernière décision vaut ; rien ne se réécrit.';

create index if not exists assistant_relectures_recent_idx
  on plateforme.assistant_relectures (decide_le desc);

alter table plateforme.assistant_relectures enable row level security;
revoke all on table plateforme.assistant_relectures from public, anon;
grant select on table plateforme.assistant_relectures to authenticated;

drop policy if exists assistant_relectures_lire on plateforme.assistant_relectures;
create policy assistant_relectures_lire on plateforme.assistant_relectures
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists assistant_relectures_ne_se_reecrivent_pas on plateforme.assistant_relectures;
create trigger assistant_relectures_ne_se_reecrivent_pas
  before update or delete on plateforme.assistant_relectures
  for each row execute function app.deny_mutation();

insert into plateforme.assistant_relectures (mode, motif, decide_le)
select 'annoncer',
       'Décision du dirigeant, 11 novembre 2026 : Malica répond toujours ; une réponse à relire '
       || 's''affiche marquée « à confirmer » et part chez l''expert-comptable.',
       timestamptz '2026-11-11 11:00:00+00'
 where not exists (select 1 from plateforme.assistant_relectures);

-- La configuration lue par le serveur gagne le mode de relecture.
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
                   order by l.decide_le desc, l.id desc limit 1)));
end
$function$;

revoke all on function public.assistant_configuration() from public, anon;
grant execute on function public.assistant_configuration() to authenticated;

commit;
