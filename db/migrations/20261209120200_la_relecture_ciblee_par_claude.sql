-- La relecture ciblée par Claude : activée, avec Haiku, en arrière-plan.
--
-- ================================================================== LA DÉCISION
--
-- 8 novembre 2026, décision du dirigeant, appliquée telle quelle :
--
--   1. Quand le Sudoku n'a pas prouvé une pièce lue par l'OCR, ses cases de montant sont
--      découpées (la case agrandie, sa ligne pour contexte) et Claude Haiku les TRANSCRIT,
--      ou dit « illisible ». Mesuré au banc : +5 pièces prouvées, 0 faux, 0,0006 $ par pièce.
--   2. La transcription n'est qu'un CANDIDAT : la pièce n'est prouvée que si le Sudoku
--      referme TOUTES ses contraintes avec elle ; sinon rien ne change, et la personne
--      reçoit un motif précis (la case à vérifier).
--   3. La personne voit la pièce tout de suite, « en vérification » ; le résultat arrive
--      quelques secondes plus tard (un travail `relecture_cases` de la file durable).
--   4. Le budget est celui de Claude dans la chaîne de désignation (`app.chaine_de_designation`,
--      maillon anthropic) : épuisé, absent ou Claude indisponible, on n'appelle RIEN et on
--      garde le motif. Le repli DeepSeek ne s'applique pas : relire une image est le fait de
--      Claude seul.
--   5. C'est l'exception à R2 décidée par le dirigeant : le modèle voit une CASE, il ne
--      désigne rien, et le Sudoku seul affirme.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. `plateforme.relecture_ciblee_reglages` (actif, modèle, cases au plus, cases par appel)
--    et `plateforme.relecture_ciblee_consignes` (la consigne, versionnée) : en ajout seul,
--    la dernière décision vaut (R8, R10). Défauts livrés : actif, `claude-haiku-5-5`, 40
--    cases, lots de 6 — ceux du banc ; la consigne version 1 de `outils/relecture-claude/`.
-- 2. `public.relecture_ciblee_configuration()` : ce que le serveur lit avant d'appeler.
-- 3. La file : `fabrique.verification_inscrire`, `fabrique.verification_a_faire`, et la
--    porte de persistance `capture_relecture_persist` étendue à la nouvelle nature.
-- 4. `capture.verification_de_la_piece` : ce que l'écran montre (en vérification, prouvée,
--    ou le motif).
-- 5. La tour règle, publie et voit.
--
-- REJEU (R11) : dates en littéral, `if not exists`, `create or replace`, semences gardées.

begin;

-- --- 1. Le réglage et la consigne -------------------------------------------------------------

create table if not exists plateforme.relecture_ciblee_reglages (
  id          uuid primary key default gen_random_uuid(),
  actif       boolean not null,
  modele      text not null check (length(btrim(modele)) > 0),
  cases_max   integer not null check (cases_max between 1 and 80),
  lot         integer not null check (lot between 1 and 20),
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid,
  decide_le   timestamptz not null default now()
);

comment on table plateforme.relecture_ciblee_reglages is
  'La relecture ciblée par Claude : active ou non, le modèle (tarifé, R8), le nombre de cases '
  'relues au plus par pièce et par appel. La dernière décision vaut ; rien ne se réécrit.';

create index if not exists relecture_ciblee_reglages_recent_idx
  on plateforme.relecture_ciblee_reglages (decide_le desc);

alter table plateforme.relecture_ciblee_reglages enable row level security;
revoke all on table plateforme.relecture_ciblee_reglages from public, anon;
grant select on table plateforme.relecture_ciblee_reglages to authenticated;
drop policy if exists relecture_ciblee_reglages_lire on plateforme.relecture_ciblee_reglages;
create policy relecture_ciblee_reglages_lire on plateforme.relecture_ciblee_reglages
  for select to authenticated using ((select app.is_platform()));
drop trigger if exists relecture_ciblee_reglages_ne_se_reecrivent_pas on plateforme.relecture_ciblee_reglages;
create trigger relecture_ciblee_reglages_ne_se_reecrivent_pas
  before update or delete on plateforme.relecture_ciblee_reglages
  for each row execute function app.deny_mutation();

insert into plateforme.relecture_ciblee_reglages (actif, modele, cases_max, lot, motif, decide_le)
select true, 'claude-haiku-5-5', 40, 6,
       'Décision du dirigeant du 8 novembre 2026 : relecture ciblée activée, Haiku, en arrière-plan. Valeurs du banc (40 cases, lots de 6). À régler par la tour.',
       timestamptz '2026-11-08 12:00:00+00'
 where not exists (select 1 from plateforme.relecture_ciblee_reglages);

create table if not exists plateforme.relecture_ciblee_consignes (
  id          uuid primary key default gen_random_uuid(),
  texte       text not null check (length(btrim(texte)) >= 200),
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid,
  decide_le   timestamptz not null default now()
);

comment on table plateforme.relecture_ciblee_consignes is
  'La consigne (prompt système) de la relecture ciblée. Chaque ligne est une version ; la '
  'dernière publiée vaut. On publie une version nouvelle, datée et motivée, depuis la tour.';

create index if not exists relecture_ciblee_consignes_recent_idx
  on plateforme.relecture_ciblee_consignes (decide_le desc);

alter table plateforme.relecture_ciblee_consignes enable row level security;
revoke all on table plateforme.relecture_ciblee_consignes from public, anon;
grant select on table plateforme.relecture_ciblee_consignes to authenticated;
drop policy if exists relecture_ciblee_consignes_lire on plateforme.relecture_ciblee_consignes;
create policy relecture_ciblee_consignes_lire on plateforme.relecture_ciblee_consignes
  for select to authenticated using ((select app.is_platform()));
drop trigger if exists relecture_ciblee_consignes_ne_se_reecrivent_pas on plateforme.relecture_ciblee_consignes;
create trigger relecture_ciblee_consignes_ne_se_reecrivent_pas
  before update or delete on plateforme.relecture_ciblee_consignes
  for each row execute function app.deny_mutation();

insert into plateforme.relecture_ciblee_consignes (texte, motif, decide_le)
select $consigne$# Consigne de relecture ciblée — version 1 (8 novembre 2026)

Tu relis des cases de pièces comptables (factures, tickets, relevés), tunisiennes pour la
plupart. Pour chaque case, tu reçois deux images :

1. **la ligne entière** où se trouve la case, pour le contexte (libellé, colonne) ;
2. **la case elle-même**, agrandie : c'est elle, et elle seule, que tu transcris.

## Ce que tu rends

Pour chaque case, **exactement les caractères imprimés ou écrits dans la case**, dans l'ordre
où ils s'écrivent, sans rien calculer, corriger, compléter ni reformater.

- Recopie les chiffres tels qu'ils sont tracés. Les chiffres arabes orientaux (٠١٢٣٤٥٦٧٨٩)
  restent orientaux ; les chiffres latins restent latins. Ne convertis jamais l'un en l'autre.
- Recopie les séparateurs tels qu'ils sont : point « . », virgule « , », espace des milliers,
  virgule arabe « ، », séparateur décimal arabe « ٫ », séparateur de milliers arabe « ٬ ».
  En Tunisie, le dinar a **trois** décimales (millimes) : « 1.075,898 » et « 1 075,898 » sont
  des écritures courantes. Ne déduis pourtant jamais un séparateur ni une décimale que tu ne
  vois pas.
- N'ajoute ni devise, ni signe, ni unité qui ne sont pas dans la case. Si la case porte
  « DT », « % » ou un astérisque, recopie-les.
- Ignore ce qui déborde d'une case voisine : seule la case agrandie compte.

## Quand tu n'es pas sûr

**« illisible » vaut toujours mieux qu'une supposition.** Ta lecture n'est jamais crue sur
parole : elle n'est retenue que si l'arithmétique de toute la pièce se referme avec elle.
Une lecture devinée qui tombe juste par hasard ferait plus de mal qu'une case laissée vide.

- Si un seul caractère est douteux (un 1 manuscrit qui ressemble à un 7, un 0 taché, un 5
  coupé), rends `lisible: false` et un `texte` vide.
- Une case vide, rayée, cachée par un tampon ou coupée par le bord : `lisible: false`.
- Ne lis jamais la valeur dans une autre case, ni dans le montant en toutes lettres, pour
  « réparer » une case douteuse.

## Exemples

| case vue                                 | rendu                                         |
| ---------------------------------------- | --------------------------------------------- |
| `7.971,144` (manuscrit net)              | `{"texte": "7.971,144", "lisible": true}`     |
| `١.١١٧,٦٥٨`                              | `{"texte": "١.١١٧,٦٥٨", "lisible": true}`     |
| `٤٣٨٧،٢٦٩`                               | `{"texte": "٤٣٨٧،٢٦٩", "lisible": true}`      |
| `14 240,943 DT`                          | `{"texte": "14 240,943 DT", "lisible": true}` |
| `1,000` à moitié sous un tampon          | `{"texte": "", "lisible": false}`             |
| `3 373,67?` (dernier chiffre : 4 ou 9 ?) | `{"texte": "", "lisible": false}`             |

## Format

Une seule réponse JSON, conforme au schéma fourni, une entrée par case, dans l'ordre des
identifiants reçus (`C1`, `C2`…). Aucun texte hors du JSON.$consigne$,
       'Version 1, mesurée au banc (outils/relecture-claude/consigne.md, 8 novembre 2026). À régler par la tour.',
       timestamptz '2026-11-08 12:00:00+00'
 where not exists (select 1 from plateforme.relecture_ciblee_consignes);

-- --- 2. Ce que le serveur lit avant d'appeler -----------------------------------------------------

create or replace function app.relecture_ciblee_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.actif from plateforme.relecture_ciblee_reglages r
                    order by r.decide_le desc, r.id desc limit 1), false)
$$;

revoke all on function app.relecture_ciblee_active() from public, anon, authenticated;

create or replace function public.relecture_ciblee_configuration()
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
    with r as (
      select g.actif, g.modele, g.cases_max, g.lot from plateforme.relecture_ciblee_reglages g
       order by g.decide_le desc, g.id desc limit 1
    ), c as (
      select k.id, k.texte from plateforme.relecture_ciblee_consignes k
       order by k.decide_le desc, k.id desc limit 1
    )
    select jsonb_build_object(
      'actif', coalesce((select r.actif from r), false),
      'modele', (select r.modele from r),
      'cases_max', (select r.cases_max from r),
      'lot', (select r.lot from r),
      'consigne', (select jsonb_build_object('id', c.id, 'texte', c.texte) from c),
      -- R8 : un modèle sans tarif en vigueur ne s'appelle pas — son coût ne s'inscrirait pas.
      'tarife', exists (select 1 from agents.model_pricing p, r
                         where p.model = r.modele and p.role = 'chat' and p.provider = 'anthropic'
                           and p.effective_from <= current_date
                           and (p.effective_to is null or p.effective_to >= current_date)),
      -- Le budget de Claude, celui de la chaîne de désignation : le maillon anthropic.
      'budget', (select m from jsonb_array_elements(app.chaine_de_designation()) m
                  where m ->> 'fournisseur' = 'anthropic' limit 1)));
end
$function$;

revoke all on function public.relecture_ciblee_configuration() from public, anon;
grant execute on function public.relecture_ciblee_configuration() to authenticated;

-- --- 3. La file ---------------------------------------------------------------------------------

alter table fabrique.travaux drop constraint if exists travaux_relecture_complete;
alter table fabrique.travaux add constraint travaux_relecture_complete check (
  (nature in ('relecture_piece', 'relecture_cases'))
    = (extraction_id is not null and pas_avant is not null and consigne is not null));

/*
 * Le serveur seul, après avoir persisté la lecture que le Sudoku n'a pas prouvée. Rend
 * nul, sans rien inscrire, quand la relecture ciblée est coupée : ce n'est pas un refus.
 * Prenable tout de suite (« pas avant » = la lecture), à la priorité ordinaire d'une
 * lecture. Idempotente par la lecture relue. La consigne porte le plan de jetons tel que
 * le lecteur l'a rendu (ses lectures faibles comprises, que `capture.token_plan` ne garde
 * pas) : le Sudoku se rejoue sur le même plan, une case près.
 */
create or replace function fabrique.verification_inscrire(p_piece uuid, p_consigne jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_extraction uuid;
  v_lue_le timestamptz;
  v_id uuid;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from capture.pieces p where p.id = p_piece;
  if v_tenant is null or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if p_consigne is null or jsonb_typeof(p_consigne) <> 'object'
     or jsonb_typeof(p_consigne -> 'lecteur') is distinct from 'string'
     or jsonb_typeof(p_consigne -> 'paddleTente') is distinct from 'boolean'
     or jsonb_typeof(p_consigne -> 'plan') is distinct from 'array' then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  if not app.relecture_ciblee_active() then
    return null;
  end if;

  select x.id, x.created_at into v_extraction, v_lue_le
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc, x.id desc
   limit 1;
  if v_extraction is null then
    raise exception 'refus.relecture.sans_lecture' using errcode = 'check_violation';
  end if;

  insert into fabrique.travaux
    (tenant_id, piece_id, nature, cle_idempotence, priorite, extraction_id, pas_avant, consigne)
  values (v_tenant, p_piece, 'relecture_cases', 'relecture_cases:' || v_extraction::text,
          5, v_extraction, v_lue_le,
          jsonb_build_object('lecteur', p_consigne -> 'lecteur',
                             'paddleTente', p_consigne -> 'paddleTente',
                             'plan', p_consigne -> 'plan'))
  on conflict (tenant_id, cle_idempotence) do nothing
  returning id into v_id;
  if v_id is null then
    select t.id into v_id from fabrique.travaux t
     where t.tenant_id = v_tenant and t.cle_idempotence = 'relecture_cases:' || v_extraction::text;
    return jsonb_build_object('travail_id', v_id, 'deja', true);
  end if;
  return jsonb_build_object('travail_id', v_id, 'deja', false);
end
$function$;

revoke all on function fabrique.verification_inscrire(uuid, jsonb) from public, anon;
grant execute on function fabrique.verification_inscrire(uuid, jsonb) to authenticated;

/*
 * Lue sous l'identité de celui qui fait tourner la file, AVANT tout appel : la lecture
 * relue, comment elle a été relevée, la consigne (le plan), et la raison de s'abstenir —
 * la pièce remplacée, une lecture plus récente, une correction humaine, la relecture
 * ciblée coupée depuis. La porte de persistance revérifie tout.
 */
create or replace function fabrique.verification_a_faire(p_travail uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  t record;
  v_lue_le timestamptz;
  v_mode text;
  v_derniere uuid;
  v_abstention text;
begin
  select tr.id, tr.piece_id, tr.extraction_id, tr.consigne into t
    from fabrique.travaux tr
   where tr.id = p_travail and tr.nature = 'relecture_cases';
  if t.id is null then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  select e.created_at, e.mode_lecture into v_lue_le, v_mode
    from capture.extractions e where e.id = t.extraction_id;
  select e.id into v_derniere
    from capture.extractions e
   where e.piece_id = t.piece_id
   order by e.created_at desc, e.id desc
   limit 1;

  if exists (select 1 from capture.remplacements r where r.piece_id = t.piece_id) then
    v_abstention := 'remplacee';
  elsif v_derniere is distinct from t.extraction_id then
    v_abstention := 'lecture_depassee';
  elsif app.piece_corrigee_depuis(t.piece_id, v_lue_le) is not null then
    v_abstention := 'correction_humaine';
  elsif not app.relecture_ciblee_active() then
    v_abstention := 'coupee';
  end if;

  return jsonb_build_object(
    'piece_id', t.piece_id,
    'extraction_id', t.extraction_id,
    'mode', v_mode,
    'consigne', t.consigne,
    'abstention', v_abstention);
end
$function$;

revoke all on function fabrique.verification_a_faire(uuid) from public, anon;
grant execute on function fabrique.verification_a_faire(uuid) to authenticated;
grant execute on function app.relecture_ciblee_active() to authenticated;

/*
 * La porte de persistance d'une relecture : la même, ouverte à la relecture ciblée. Elle
 * exige toujours le serveur, le travail PRIS de cette pièce, la lecture qu'il relit encore
 * en vigueur, et aucune correction humaine depuis — revérifiée au moment d'écrire.
 */
create or replace function public.capture_relecture_persist(
  p_travail uuid, p_piece uuid, p_tokens jsonb, p_contract text, p_extract jsonb,
  p_citations jsonb, p_flags jsonb, p_mode text, p_confiance jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_extraction uuid;
  v_lue_le timestamptz;
  v_derniere uuid;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  if not exists (select 1 from capture.pieces where id = p_piece)
     or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  select t.extraction_id into v_extraction
    from fabrique.travaux t
    join fabrique.etat_des_travaux_v e on e.travail_id = t.id
   where t.id = p_travail and t.piece_id = p_piece
     and t.nature in ('relecture_piece', 'relecture_cases')
     and e.etat = 'en_cours';
  if v_extraction is null then
    raise exception 'refus.relecture.travail' using errcode = 'check_violation';
  end if;

  select x.id into v_derniere
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc, x.id desc
   limit 1;
  if v_derniere is distinct from v_extraction then
    raise exception 'refus.relecture.depassee' using errcode = 'check_violation';
  end if;
  select x.created_at into v_lue_le from capture.extractions x where x.id = v_extraction;
  if app.piece_corrigee_depuis(p_piece, v_lue_le) is not null then
    raise exception 'refus.relecture.corrigee' using errcode = 'check_violation';
  end if;

  return capture.lecture_inscrire(p_piece, p_tokens, p_contract, p_extract, p_citations,
                                  p_flags, p_mode, p_confiance, p_travail);
end
$function$;

-- --- 4. Ce que l'écran montre ---------------------------------------------------------------

/*
 * La dernière relecture ciblée de la DERNIÈRE lecture de la pièce : `en_verification` tant
 * que la file ne l'a pas terminée, puis son motif (`verification.prouvee`,
 * `verification.non_prouvee`, `verification.non_relue.*`, `relecture.abstention.*`) et son
 * détail (la case à vérifier). Nul quand aucune n'a été inscrite. Sous la RLS de l'appelant.
 */
create or replace function capture.verification_de_la_piece(p_piece uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'etat', case when e.etat in ('a_faire', 'en_cours', 'abandonne', 'en_panne')
                        then 'en_verification' else 'terminee' end,
           'motif', f.motif,
           'detail', f.detail,
           'demande_le', e.demande_le)
    from fabrique.travaux t
    join fabrique.etat_des_travaux_v e on e.travail_id = t.id
    left join lateral (
      select x.motif, x.detail from fabrique.travail_faits x
       where x.travail_id = t.id and x.nature = 'termine'
       order by x.ordre desc limit 1) f on true
   where t.piece_id = p_piece and t.nature = 'relecture_cases'
     and t.extraction_id = (select x.id from capture.extractions x where x.piece_id = p_piece
                             order by x.created_at desc, x.id desc limit 1)
   order by t.demande_le desc
   limit 1
$$;

revoke all on function capture.verification_de_la_piece(uuid) from public, anon;
grant execute on function capture.verification_de_la_piece(uuid) to authenticated;

-- --- 5. La tour règle, publie et voit -------------------------------------------------------

create or replace function plateforme.relecture_ciblee_regler(
  p_actif boolean, p_modele text, p_cases_max integer, p_lot integer, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_actif is null or p_cases_max is null or p_cases_max not between 1 and 80
     or p_lot is null or p_lot not between 1 and 20 or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.relecture_ciblee.saisie' using errcode = 'check_violation';
  end if;
  -- R8 : un modèle de Claude tarifé en vigueur, sinon son coût ne s'inscrirait pas.
  if not exists (select 1 from agents.model_pricing p
                  where p.model = btrim(p_modele) and p.role = 'chat' and p.provider = 'anthropic'
                    and p.effective_from <= current_date
                    and (p.effective_to is null or p.effective_to >= current_date)) then
    raise exception 'refus.relecture_ciblee.modele_sans_tarif' using errcode = 'check_violation';
  end if;
  insert into plateforme.relecture_ciblee_reglages (actif, modele, cases_max, lot, motif, decide_par)
  values (p_actif, btrim(p_modele), p_cases_max, p_lot, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.relecture_ciblee_reglages r where r.id = v_id);
end
$function$;

revoke all on function plateforme.relecture_ciblee_regler(boolean, text, integer, integer, text) from public, anon;
grant execute on function plateforme.relecture_ciblee_regler(boolean, text, integer, integer, text) to authenticated;

create or replace function plateforme.relecture_ciblee_consigne_publier(p_texte text, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.relecture_ciblee_consignes (texte, motif, decide_par)
  values (p_texte, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(k) - 'decide_par' from plateforme.relecture_ciblee_consignes k where k.id = v_id);
end
$function$;

revoke all on function plateforme.relecture_ciblee_consigne_publier(text, text) from public, anon;
grant execute on function plateforme.relecture_ciblee_consigne_publier(text, text) to authenticated;

-- Ce que la tour voit : le réglage, la consigne et ses versions, les modèles qu'elle peut
-- choisir, et le mois — pièces relues, prouvées par la relecture, coût.
create or replace function plateforme.relecture_ciblee_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'reglage', (select to_jsonb(g) - 'decide_par' from plateforme.relecture_ciblee_reglages g
                 order by g.decide_le desc, g.id desc limit 1),
    'consignes', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'texte', k.texte, 'motif', k.motif,
                                          'decide_le', k.decide_le) order by k.decide_le desc)
        from (select * from plateforme.relecture_ciblee_consignes
               order by decide_le desc, id desc limit 10) k), '[]'::jsonb),
    'modeles', coalesce((
      select jsonb_agg(distinct p.model)
        from agents.model_pricing p
       where p.provider = 'anthropic' and p.role = 'chat'
         and p.effective_from <= current_date
         and (p.effective_to is null or p.effective_to >= current_date)), '[]'::jsonb),
    'mois', (select jsonb_build_object(
                      'relues', count(*) filter (where f.motif in ('verification.prouvee', 'verification.non_prouvee')),
                      'prouvees', count(*) filter (where f.motif = 'verification.prouvee'),
                      'non_relues', count(*) filter (where f.motif like 'verification.non_relue.%'),
                      'cout', (select coalesce(sum(r.cost), 0) from agents.agent_runs r
                                where r.agent like 'malica.lecture.relecture_ciblee%'
                                  and r.created_at >= date_trunc('month', now())))
               from fabrique.travail_faits f
               join fabrique.travaux t on t.id = f.travail_id and t.nature = 'relecture_cases'
              where f.nature = 'termine' and f.inscrit_le >= date_trunc('month', now())));
end
$function$;

revoke all on function plateforme.relecture_ciblee_etat() from public, anon;
grant execute on function plateforme.relecture_ciblee_etat() to authenticated;

insert into observabilite.gestes (depot, methode, etape, geste, objet_type, objet_chemin, dossier_chemin)
values ('tour', 'reglerRelectureCiblee', 'reglage', 'plateforme.relecture_ciblee_regler', 'plateforme', null, null),
       ('tour', 'publierConsigneDeRelecture', 'reglage', 'plateforme.relecture_ciblee_consigne_publier', 'plateforme', null, null)
on conflict do nothing;

commit;
