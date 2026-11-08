-- Le conseil cite le corpus : Claude répond sur les textes, et rien d'autre.
--
-- ================================================================== LA DEMANDE
--
-- 8 novembre 2026, le dirigeant : « donne à Claude ce qu'il ne connaît pas ».
-- Claude ne connaît pas fiablement le droit fiscal tunisien à jour. Le corpus
-- de la base devient sa source de vérité : les passages retenus lui sont
-- remis comme RÉSULTATS DE RECHERCHE CITABLES (blocs `search_result`, API
-- Citations), chaque affirmation de sa réponse porte sa citation, et ce que
-- le corpus ne dit pas, il le dit au lieu de répondre de mémoire.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. Les tarifs de Claude (R8) : ceux de la chaîne de désignation
--    (20261205092500), lus et non redéclarés.
-- 2. `plateforme.conseil_consignes` : le PROMPT SYSTÈME du conseil cité. Il
--    vit en base, versionné, en ajout seul (R10) : la tour en publie une
--    version nouvelle, datée et motivée ; la dernière vaut. Aucune consigne
--    n'est écrite en TypeScript.
-- 3. `plateforme.conseil_reglages` : quel modèle répond (Haiku par défaut),
--    quand passer au modèle des questions difficiles (Sonnet), combien de
--    passages, quels seuils de recherche. En ajout seul, réglé par la tour.
-- 4. `public.conseil_cite_configuration()` : ce que le serveur lit avant
--    chaque réponse — consigne, réglage, tarifs des deux modèles, hiérarchie
--    des sources (`legal.sources`). Lecture seule, sans `decide_par`.
-- 5. `plateforme.conseil_cite_regler(…)`, `plateforme.conseil_consigne_publier(…)`
--    et `plateforme.conseil_cite_etat()` : la tour règle, publie et voit.
--
-- Les taux, seuils, barèmes et échéances ne sont PAS ici : ils restent dans
-- `ref.fiscal_parameters` et dans le corpus (`legal.*`), et la réponse les y
-- lit, cités. La consigne ne contient aucun chiffre fiscal.
--
-- REJEU (R11) : dates en littéral, `if not exists`, `create or replace`,
-- `on conflict do nothing`, semences gardées par `where not exists`.

begin;

-- --- 1. Les tarifs de Claude ---------------------------------------------------------------------
--
-- Posés par 20261205092500_la_designation_a_un_principal_et_un_repli (chat, cache,
-- cache_ecriture ; contrainte `model_pricing_role_check`). Le conseil cité les lit,
-- il ne les redéclare pas (nettoyage du 8 novembre 2026 : zéro doublon).

-- --- 2. La consigne, versionnée ------------------------------------------------------------------

create table if not exists plateforme.conseil_consignes (
  id          uuid primary key default gen_random_uuid(),
  texte       text not null check (length(btrim(texte)) >= 200),
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid,
  decide_le   timestamptz not null default now()
);

comment on table plateforme.conseil_consignes is
  'Le prompt système du conseil cité (Claude sur le corpus). Chaque ligne est une '
  'version ; la dernière publiée vaut. Rien ne se réécrit : on publie une version '
  'nouvelle, datée et motivée, depuis la tour.';

create index if not exists conseil_consignes_recent_idx
  on plateforme.conseil_consignes (decide_le desc);

alter table plateforme.conseil_consignes enable row level security;
revoke all on table plateforme.conseil_consignes from public, anon;
grant select on table plateforme.conseil_consignes to authenticated;

drop policy if exists conseil_consignes_lire on plateforme.conseil_consignes;
create policy conseil_consignes_lire on plateforme.conseil_consignes
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists conseil_consignes_ne_se_reecrivent_pas on plateforme.conseil_consignes;
create trigger conseil_consignes_ne_se_reecrivent_pas
  before update or delete on plateforme.conseil_consignes
  for each row execute function app.deny_mutation();

insert into plateforme.conseil_consignes (texte, motif, decide_le)
select $consigne$Tu es Malica, l'assistante fiscale d'un cabinet d'expertise comptable tunisien. Tu réponds à des questions de droit fiscal tunisien : impôt sur le revenu et impôt sur les sociétés, TVA, droits d'enregistrement et de timbre, retenues à la source, fiscalité locale, procédures fiscales, lois de finances, notes communes, conventions de non-double imposition.

TA SEULE SOURCE
Tu ne connais pas le droit tunisien en vigueur : tu le LIS dans les résultats de recherche joints à la question. Chaque résultat est UNE version d'UN article, en vigueur à la date d'effet indiquée, avec son texte, sa nature (loi, décret, note commune…) et son édition. Les paramètres du référentiel (taux, seuils, montants, délais) te sont remis de la même manière, datés et fondés.
Un texte, un article, un taux ou un délai qui ne figure pas dans ces résultats n'existe pas pour toi — même si tu crois le connaître, même si tu en es sûre. Tu ne réponds JAMAIS de mémoire.

CHAQUE AFFIRMATION PORTE SA CITATION
Toute phrase qui énonce une règle, un taux, un seuil, un délai, une condition ou une exception s'appuie sur un résultat de recherche, et tu le cites — la toute première phrase, celle qui répond, comprise. Une phrase que tu ne peux pas citer, tu ne l'écris pas. Tu nommes le texte et l'article dans la phrase même : « selon l'article 52 du code de l'IRPP et de l'IS… ».
Un chiffre se recopie tel que le texte ou le paramètre le donne, dans la phrase qui le cite : tu ne calcules rien, tu n'additionnes rien, tu n'arrondis rien, tu n'appliques aucun taux à un montant, tu ne convertis pas « vingt-huit » en « 28 ». Une phrase non citée qui porte un chiffre est retirée de ta réponse avant qu'on la lise.

LE TEMPS
Le droit applicable est celui en vigueur à la DATE D'EFFET donnée avec la question. La ligne « En vigueur au … » qui liste les articles et leur version est ajoutée à ta réponse par le système : tu ne l'écris pas. Tu ne mélanges jamais deux versions d'un même article : tu n'en reçois qu'une, et c'est elle que tu cites. Une loi de finances qui MODIFIE un code ne dit pas, à elle seule, l'état du code à la date d'effet : si l'article du code qui répond ne t'est pas remis, tu ne reconstitues pas son contenu à partir des lois qui l'ont modifié. Si la question vise une autre date que la date d'effet, tu le signales et tu ne transposes pas.

QUAND LES TEXTES NE RÉPONDENT PAS
Si aucun résultat ne répond à la question, ou seulement à côté, tu réponds en une phrase, dans la langue de la question : « Je ne trouve pas cela dans les textes que j'ai sous les yeux. » — puis, en une phrase au plus, ce qu'il faudrait comme texte. Tu n'ajoutes aucune règle, aucun ordre de grandeur, aucune supposition, et tu ne cites rien : un refus ne porte pas de citation. Tu ne renvoies pas la personne chercher elle-même.
Le corpus est TUNISIEN : sur le droit d'un autre pays, tu réponds que tu ne trouves pas cela dans les textes, même si des articles tunisiens voisins te sont remis.
Si les résultats ne répondent qu'en partie, tu dis ce qu'ils établissent, cité, puis ce qui manque.

PESER LES TEXTES
La hiérarchie des sources t'est rappelée plus bas : le texte supérieur l'emporte ; à rang égal, le postérieur l'emporte et le spécial déroge au général dans son champ. Une note commune n'oblige que l'administration : quand tu t'appuies sur elle, tu le dis dans la phrase. Un texte dont le statut n'est pas « en vigueur » ne fonde aucune réponse actuelle. Une lecture marquée partielle ou incertaine se rend en sens, jamais entre guillemets.
L'arabe fait foi. Quand le passage décisif est en arabe, tu le cites dans sa langue puis tu en donnes le sens en précisant « traduction non officielle ».

LA FORME
Tu réponds dans la langue de la question (français, arabe ou anglais). La réponse d'abord, en une phrase ; le fondement ensuite ; la nuance en dernier. Sobre et dense, sans préambule, sans emoji, sans titre, sans liste à puces superflue. Tu ne rends pas de JSON.$consigne$,
       'Version initiale posée par la migration (8 novembre 2026) : à régler par la tour.',
       timestamptz '2026-11-08 12:00:00+00'
 where not exists (select 1 from plateforme.conseil_consignes);

-- --- 3. Le réglage du conseil cité ---------------------------------------------------------------

create table if not exists plateforme.conseil_reglages (
  id                          uuid primary key default gen_random_uuid(),
  -- Le modèle de toutes les questions, et celui des questions jugées difficiles.
  modele_courant              text not null check (length(btrim(modele_courant)) > 0),
  modele_difficile            text not null check (length(btrim(modele_difficile)) > 0),
  -- La règle « difficile » : simple, lisible, réglable. Une question est
  -- difficile si elle dépasse cette longueur, OU contient l'un de ces mots,
  -- OU si les passages retenus viennent d'au moins autant de textes distincts.
  longueur_difficile          integer not null check (longueur_difficile between 40 and 4000),
  mots_difficiles             text[] not null default '{}',
  corpus_distincts_difficile  integer not null check (corpus_distincts_difficile between 2 and 20),
  -- La recherche : combien de passages, et quand un passage ne répond plus.
  passages_max                integer not null check (passages_max between 1 and 20),
  distance_max                numeric(5,4) not null check (distance_max > 0 and distance_max < 2),
  distance_max_mots           numeric(5,4) not null check (distance_max_mots > 0 and distance_max_mots < 2),
  sortie_max_jetons           integer not null check (sortie_max_jetons between 256 and 8192),
  motif                       text not null check (length(btrim(motif)) > 0),
  decide_par                  uuid,
  decide_le                   timestamptz not null default now(),
  constraint conseil_reglages_seuils_ordonnes check (distance_max_mots >= distance_max)
);

comment on table plateforme.conseil_reglages is
  'Le réglage du conseil cité : modèle par défaut, modèle des questions difficiles et '
  'la règle qui les sépare, nombre de passages, seuils de recherche. La dernière '
  'décision vaut ; rien ne se réécrit.';

create index if not exists conseil_reglages_recent_idx
  on plateforme.conseil_reglages (decide_le desc);

alter table plateforme.conseil_reglages enable row level security;
revoke all on table plateforme.conseil_reglages from public, anon;
grant select on table plateforme.conseil_reglages to authenticated;

drop policy if exists conseil_reglages_lire on plateforme.conseil_reglages;
create policy conseil_reglages_lire on plateforme.conseil_reglages
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists conseil_reglages_ne_se_reecrivent_pas on plateforme.conseil_reglages;
create trigger conseil_reglages_ne_se_reecrivent_pas
  before update or delete on plateforme.conseil_reglages
  for each row execute function app.deny_mutation();

-- Valeurs initiales (R10 : défauts livrés, que la tour change).
--   10 passages, 4 096 jetons de sortie : mesurés à l'épreuve réelle du
--     8 novembre 2026 — à 1 500 jetons, Haiku épuisait sa borne sans écrire
--     (sa réflexion compte dans la borne) ; à 8 passages, l'article 33 du
--     code de la fiscalité locale restait hors du filet.
--   distance_max 0,37 : l'étalonnage de `db/corpus/etalonner.mjs` (sépare les
--     questions qui doivent trouver, ≤ 0,3575, des hors sujet, ≥ 0,3804) ;
--   distance_max_mots 0,45 : un passage trouvé AUSSI par les mots de la
--     question garde sa place un peu plus loin — les numéros d'article et les
--     termes exacts (« acompte provisionnel ») sont un signal que le vecteur
--     dilue.
insert into plateforme.conseil_reglages
  (modele_courant, modele_difficile, longueur_difficile, mots_difficiles,
   corpus_distincts_difficile, passages_max, distance_max, distance_max_mots,
   sortie_max_jetons, motif, decide_le)
select 'claude-haiku-5-5', 'claude-sonnet-5-5', 320,
       array['convention', 'non-résident', 'non résident', 'plus-value', 'prescription',
             'transitoire', 'rétroactif', 'double imposition', 'comparer', 'contradiction'],
       3, 10, 0.37, 0.45, 4096,
       'Valeurs initiales posées par la migration (8 novembre 2026) : Haiku répond, Sonnet pour les questions difficiles. À régler par la tour.',
       timestamptz '2026-11-08 12:00:00+00'
 where not exists (select 1 from plateforme.conseil_reglages);

-- --- 4. Ce que le serveur lit -------------------------------------------------------------------

create or replace function public.conseil_cite_configuration()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select k.id, k.texte, k.decide_le from plateforme.conseil_consignes k
     order by k.decide_le desc, k.id desc limit 1
  ), r as (
    select to_jsonb(g) - 'decide_par' as j, g.modele_courant, g.modele_difficile
      from plateforme.conseil_reglages g
     order by g.decide_le desc, g.id desc limit 1
  )
  select jsonb_build_object(
    'consigne', (select jsonb_build_object('id', c.id, 'texte', c.texte, 'decide_le', c.decide_le) from c),
    'reglage', (select r.j from r),
    -- Les tarifs en vigueur des deux modèles, par rôle : le coût d'une réponse
    -- se lit ici, jamais dans le code (R8).
    'tarifs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'model', p.model, 'role', p.role,
               'in', p.price_in_per_mtok, 'out', p.price_out_per_mtok)
             order by p.model, p.role)
        from agents.model_pricing p, r
       where p.model in (r.modele_courant, r.modele_difficile)
         and p.effective_from <= current_date
         and (p.effective_to is null or p.effective_to > current_date)), '[]'::jsonb),
    -- La hiérarchie des sources : un texte de référence stable, mis en cache
    -- avec la consigne.
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', s.code, 'libelle', s.libelle, 'autorite', s.autorite,
               'opposable_a', array_to_string(s.opposable_a, ', '), 'fondement', s.fondement)
             order by s.code)
        from legal.sources s), '[]'::jsonb))
$$;

revoke all on function public.conseil_cite_configuration() from public, anon;
grant execute on function public.conseil_cite_configuration() to authenticated;

-- --- 5. La tour règle, publie et voit -----------------------------------------------------------

create or replace function plateforme.conseil_cite_regler(
  p_modele_courant text,
  p_modele_difficile text,
  p_longueur_difficile integer,
  p_mots_difficiles text[],
  p_corpus_distincts_difficile integer,
  p_passages_max integer,
  p_distance_max numeric,
  p_distance_max_mots numeric,
  p_sortie_max_jetons integer,
  p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_modele text;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  -- R8 : un modèle sans tarif en vigueur s'exécuterait sans coût journalisé.
  foreach v_modele in array array[p_modele_courant, p_modele_difficile] loop
    if not exists (select 1 from agents.model_pricing p
                    where p.model = v_modele and p.role = 'chat' and p.provider = 'anthropic'
                      and p.effective_from <= current_date
                      and (p.effective_to is null or p.effective_to > current_date)) then
      raise exception 'refus.conseil.modele_sans_tarif'
        using errcode = '22023', detail = v_modele;
    end if;
  end loop;
  insert into plateforme.conseil_reglages
    (modele_courant, modele_difficile, longueur_difficile, mots_difficiles,
     corpus_distincts_difficile, passages_max, distance_max, distance_max_mots,
     sortie_max_jetons, motif, decide_par)
  values
    (p_modele_courant, p_modele_difficile, p_longueur_difficile,
     coalesce(p_mots_difficiles, '{}'), p_corpus_distincts_difficile, p_passages_max,
     p_distance_max, p_distance_max_mots, p_sortie_max_jetons, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(g) - 'decide_par' from plateforme.conseil_reglages g where g.id = v_id);
end
$$;

revoke all on function plateforme.conseil_cite_regler(text, text, integer, text[], integer, integer,
  numeric, numeric, integer, text) from public, anon;
grant execute on function plateforme.conseil_cite_regler(text, text, integer, text[], integer, integer,
  numeric, numeric, integer, text) to authenticated;

create or replace function plateforme.conseil_consigne_publier(p_texte text, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.conseil_consignes (texte, motif, decide_par)
  values (p_texte, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(k) - 'decide_par' from plateforme.conseil_consignes k where k.id = v_id);
end
$$;

revoke all on function plateforme.conseil_consigne_publier(text, text) from public, anon;
grant execute on function plateforme.conseil_consigne_publier(text, text) to authenticated;

-- La tour voit : la consigne en vigueur, ses versions précédentes, le réglage,
-- les modèles qu'elle peut choisir, et ce que le conseil cité a coûté ce mois.
create or replace function plateforme.conseil_cite_etat()
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
  return jsonb_build_object(
    'consignes', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'texte', k.texte, 'motif', k.motif,
                                          'decide_le', k.decide_le) order by k.decide_le desc)
        from (select * from plateforme.conseil_consignes
               order by decide_le desc, id desc limit 10) k), '[]'::jsonb),
    'reglage', (select to_jsonb(g) - 'decide_par' from plateforme.conseil_reglages g
                 order by g.decide_le desc, g.id desc limit 1),
    'modeles', coalesce((
      select jsonb_agg(distinct p.model)
        from agents.model_pricing p
       where p.provider = 'anthropic' and p.role = 'chat'
         and p.effective_from <= current_date
         and (p.effective_to is null or p.effective_to > current_date)), '[]'::jsonb),
    -- Une réponse journalise jusqu'à trois lignes (entrée et sortie, cache
    -- lu, cache écrit) ; seule la première porte la latence de l'appel.
    'mois', (select jsonb_build_object(
                      'appels', count(*) filter (where r.latency_ms > 0 or r.status = 'error'),
                      'cout', coalesce(sum(r.cost), 0))
               from agents.agent_runs r
              where r.agent = 'malica.conseil.cite'
                and r.created_at >= date_trunc('month', now())));
end
$$;

revoke all on function plateforme.conseil_cite_etat() from public, anon;
grant execute on function plateforme.conseil_cite_etat() to authenticated;

commit;
