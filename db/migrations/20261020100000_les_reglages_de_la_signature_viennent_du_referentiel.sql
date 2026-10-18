--
--  Les réglages de la reconnaissance, dans le référentiel — pas dans le code.
--
--  ============================================================== POURQUOI
--
--  La signature structurelle et sa distance n'ont AUCUN défaut en TypeScript :
--  `ParametresDeSignature`, `ParametresDeDistance` et `ParametresDeClassement`
--  arrivent par argument, et le compilateur refuse un appel qui en oublie un.
--  C'était la bonne moitié du travail ; l'autre moitié manquait — personne ne
--  les fournissait, et le premier appelant réel (l'interprète déterministe,
--  18 octobre 2026) les aurait inventés dans son propre fichier. Treize
--  nombres écrits en TypeScript : R4, exactement.
--
--  Ils vivent donc ici, à côté des bornes du validateur de recette, dans la
--  même table (`ref.socle_params`), avec la même surcharge par organisation
--  (`parametrage.fabrique_seuils`) et la même règle de refus : ils sortent
--  TOUS LES TREIZE ou pas du tout.
--
--  ================================= CE QUE CES VALEURS SONT, ET NE SONT PAS
--
--  Des DÉFAUTS LIVRÉS (R10), pas des vérités. Six d'entre elles sont celles
--  qu'a employées le banc de la signature ; les sept autres — les cinq poids
--  et les deux seuils de classement — sont le point de départ mesuré sur les
--  plans synthétiques du 18 octobre, et rien d'autre. Un cabinet les change
--  sans déploiement, et `arrete_par_le_cabinet` dit qui a décidé.
--
--  R11 : `valid_from` est écrit en littéral. L'omettre ferait entrer la date
--  du jour dans le référentiel sans que rien ne soit écrit nulle part — c'est
--  la forme cachée de la faute, et la plus courante.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, c.code, c.v, 'Politique de fabrique de lecteurs ALGORIA', date '2026-10-18'
  from ref.jurisdiction_packs p
  cross join (values
    -- Comment une signature se calcule (`ParametresDeSignature`).
    ('fabrique.seuil.signature.longueur_minimale_d_ancre', 2::numeric),
    ('fabrique.seuil.signature.bandes_par_page',           3),
    ('fabrique.seuil.signature.part_minimale_du_sens',     0.6),
    ('fabrique.seuil.signature.recouvrement_de_ligne',     0.5),
    ('fabrique.seuil.signature.recouvrement_de_colonne',   0.5),
    ('fabrique.seuil.signature.ancres_en_relation_max',    40),
    -- Ce qui pèse dans la distance (`ParametresDeDistance`). Une composante
    -- indécidable ne pèse rien : ces poids ne se comparent qu'entre eux.
    ('fabrique.seuil.signature.poids_ancres',              3),
    ('fabrique.seuil.signature.poids_zones',               1),
    ('fabrique.seuil.signature.poids_relations',           2),
    ('fabrique.seuil.signature.poids_tableau',             3),
    ('fabrique.seuil.signature.poids_pagination',          1),
    -- Quand on reconnaît, et quand on refuse de choisir
    -- (`ParametresDeClassement`). `ecart_minimal` est le garde-fou qui coûte
    -- le moins et protège le plus : en deçà, deux formats voisins sont ex
    -- æquo, et on rend la main au lieu d'appliquer la recette de l'un à
    -- l'autre.
    --
    -- `distance_max` = 0,08 est MESURÉ, et la marge est mince. Sur les plans
    -- synthétiques du 18 octobre, avec les poids ci-dessus et l'ossature de
    -- trois exemples :
    --
    --   le même format, d'autres valeurs, un autre client, six lignes  0,0000
    --   le format VOISIN et incompatible (prix unitaires TTC)          0,0992
    --   un document de deux pages contre une référence d'une page      0,1529
    --
    -- Un seuil qui admettrait le format voisin appliquerait la recette de
    -- l'un à l'autre, et rendrait un résultat plausible et faux. On refuse
    -- donc large : une reconnaissance manquée rend la main au modèle, ce que
    -- le produit sait déjà faire, tandis qu'une reconnaissance fautive ne se
    -- voit nulle part.
    --
    -- À REMESURER sur un corpus réel. 0,08 contre 0,0992 n'est pas une marge
    -- confortable, et ces plans sont fabriqués.
    ('fabrique.seuil.signature.distance_max',              0.08),
    ('fabrique.seuil.signature.ecart_minimal',             0.05)
  ) as c(code, v)
 where p.effective_from <= date '2026-10-18'
   and (p.effective_to is null or p.effective_to >= date '2026-10-18')
on conflict do nothing;

/*
 * Les treize réglages de la reconnaissance.
 *
 * Même forme que `fabrique.bornes_de_recette`, et pour la même raison : ils
 * sortent ensemble ou pas du tout. En rendre douze laisserait l'appelant
 * inventer le treizième, et un poids inventé déplace une distance sans que
 * rien ne le dise — un format reconnu à tort rend un résultat plausible et
 * faux.
 */
create or replace function fabrique.reglages_de_signature(p_tenant uuid)
returns table (reglage text, valeur numeric, arrete_par_le_cabinet boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_attendus constant text[] := array[
    'longueur_minimale_d_ancre', 'bandes_par_page', 'part_minimale_du_sens',
    'recouvrement_de_ligne', 'recouvrement_de_colonne', 'ancres_en_relation_max',
    'poids_ancres', 'poids_zones', 'poids_relations', 'poids_tableau',
    'poids_pagination', 'distance_max', 'ecart_minimal'];
  v_manquants text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.signature.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.signature\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.signature\.(.+)$') = any(v_attendus);

  select array_agg(a order by a) into v_manquants
    from unnest(v_attendus) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.signature.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquants is not null then
    raise exception
      'reglages de signature absents du referentiel : % (ref.socle_params, codes fabrique.seuil.signature.*)',
      array_to_string(v_manquants, ', ')
      using errcode = 'no_data_found';
  end if;
end
$$;

revoke all on function fabrique.reglages_de_signature(uuid) from public, anon;
grant execute on function fabrique.reglages_de_signature(uuid) to authenticated;

comment on function fabrique.reglages_de_signature(uuid) is
  'Les treize réglages que la reconnaissance exige sans défaut : six pour la '
  'signature, cinq poids de distance, deux seuils de classement. Ce que le '
  'cabinet a arrêté, puis le défaut du pack ; un réglage absent lève une '
  'erreur au lieu de laisser inventer le treizième.';
