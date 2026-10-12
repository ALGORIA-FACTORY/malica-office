-- Un motif ne se déclenche pas au milieu d'un mot.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- `20261012220000` a rendu la résolution des familles DÉTERMINISTE : deux
-- règles de même priorité et de même nature se départageaient par le plan
-- d'exécution, ce que R11 interdit. L'ordre est devenu entièrement écrit.
--
-- Et une épreuve, verte depuis des semaines, est tombée :
--
--     Commission bancaire sur virement → DEPLACEMENT (attendu SERVICES_BANCAIRES)
--
-- La règle des déplacements contient `mission`. « Com·mission » le contient
-- aussi. Deux règles matchaient donc depuis toujours, et c'est le hasard du
-- plan qui rendait la bonne. Le déterminisme n'a pas créé ce défaut : il l'a
-- MONTRÉ, et c'est exactement à cela qu'il sert.
--
-- ============================== POURQUOI UNE FRONTIÈRE AU DÉBUT, ET PAS À LA FIN
--
-- La tentation est d'encadrer le motif des deux côtés — `\y(…)\y`. Ce serait
-- une erreur, et elle casserait la moitié du référentiel : « fourniture » ne
-- matcherait plus « fournitures », ni « câble » « câbles », ni « stylo »
-- « stylos ». Les suffixes sont des flexions, et elles sont voulues.
--
-- Le début, lui, porte le sens : un motif doit commencer à un début de mot.
-- `mission` ne doit pas se déclencher dans « commission », ni `prise` dans
-- « entreprise », ni `colle` dans « collecte ».
--
-- Une seule frontière, donc, et posée DANS LA FONCTION : les vingt-six règles
-- du pack en bénéficient, celles que le pack suivant apportera aussi, et
-- celles qu'un cabinet écrira un jour. Corriger les vingt-six motifs à la main
-- aurait laissé le piège intact pour le vingt-septième.
--
-- ===================================================== ET UN MOT DE TROP, DE MOI
--
-- La règle d'entretien ajoutée le même jour contient `sav`, qui commence bien
-- un mot dans « savon » et dans « savoir ». La frontière de début n'y change
-- rien : il faut l'écrire autrement, et c'est fait ici.

create or replace function public.charge_famille_resolve(
  p_pack uuid,
  p_account text,
  p_designation text,
  p_at date default current_date
)
returns table(famille_code text, famille_source text)
language sql
stable
set search_path = ''
as $$
  with rules as (
    select r.famille_code, r.match_kind, r.pattern, r.priority
      from ref.charge_famille_rules r
     where r.pack_version_id = p_pack
       and r.valid_from <= p_at
       and (r.valid_to is null or r.valid_to >= p_at)
  ),
  hit as (
    select famille_code, match_kind as famille_source, priority
      from rules
     where (match_kind = 'account_prefix'
            and p_account is not null
            and p_account like pattern || '%')
        -- `\y` : le motif doit commencer à un début de mot. Rien à la fin —
        -- « fourniture » doit continuer de matcher « fournitures ».
        or (match_kind = 'designation_pattern'
            and p_designation is not null
            and p_designation ~* ('\y' || pattern))
     order by priority, match_kind, famille_code, pattern
     limit 1
  )
  select coalesce((select h.famille_code from hit h),
                  (select f.code from ref.charge_familles f
                    where f.pack_version_id = p_pack and f.is_fallback
                      and f.valid_from <= p_at
                      and (f.valid_to is null or f.valid_to >= p_at)
                    order by f.code limit 1),
                  'NON_CLASSE'),
         coalesce((select h.famille_source from hit h), 'fallback');
$$;

revoke all on function public.charge_famille_resolve(uuid, text, text, date) from public, anon;
grant execute on function public.charge_famille_resolve(uuid, text, text, date)
  to authenticated, service_role;

comment on function public.charge_famille_resolve(uuid, text, text, date) is
  'La famille d''une charge, résolue contre le pack à une date. Deux garanties '
  'que le hasard du plan masquait : l''ordre est entièrement écrit (priorité, '
  'nature, famille, motif) et un motif de désignation ne se déclenche qu''à un '
  'DÉBUT de mot — `mission` ne doit pas matcher « commission ». Pas de '
  'frontière de fin : « fourniture » doit matcher « fournitures ».';

-- --- Le mot de trop -----------------------------------------------------------------------

update ref.charge_famille_rules
   set pattern = replace(pattern, '|sav|', '|s\.a\.v|service +apr[eè]s[- ]?vente|')
 where match_kind = 'designation_pattern'
   and famille_code = 'ENTRETIEN'
   and pattern like '%extension +de +garantie%'
   and pattern like '%|sav|%';
