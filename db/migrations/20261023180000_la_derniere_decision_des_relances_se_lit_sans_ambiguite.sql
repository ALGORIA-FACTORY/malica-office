-- La dernière décision de la tour sur les relances se lit sans ambiguïté
-- (23 octobre 2026).
--
-- `plateforme.relances_reglage()` prenait « la dernière » par
-- `decide_le desc, id desc`. Deux décisions dans la même transaction ont le
-- même `decide_le` (`now()` est figé par transaction), et `id` est un uuid
-- aléatoire : l'ordre devenait un tirage. Constaté en CI (exécution
-- 40016900906) : « fermer » après « ouvrir », dans une épreuve, lisait une
-- fois sur deux « ouvert ».
--
-- Un rang monotone départage : la décision inscrite après est la dernière.

alter table plateforme.reglages_relances
  add column rang bigint generated always as identity;

comment on column plateforme.reglages_relances.rang is
  'Ordre d''inscription. Départage deux décisions de même instant : la plus tardive vaut.';

create or replace function plateforme.relances_reglage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('actives', r.actives,
                               'suspension_automatique', r.suspension_automatique,
                               'tentatives_max', r.tentatives_max, 'decide_le', r.decide_le)
       from plateforme.reglages_relances r
      order by r.decide_le desc, r.rang desc limit 1),
    jsonb_build_object('actives', false, 'suspension_automatique', false,
                       'tentatives_max', null, 'decide_le', null))
$$;

revoke all on function plateforme.relances_reglage() from public, anon, authenticated;
