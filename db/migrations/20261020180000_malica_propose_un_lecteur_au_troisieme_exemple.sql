-- ======================================================================
--  Ce qui DECLENCHE une generation, et ce qui l'empeche de se declencher
--  deux fois.
--
--  ============================================================ LE NOMBRE
--
--  « La vraie question est commerciale : au bout de combien de pieces d'un
--  meme format Malica propose-t-elle ? » Son auteur avait raison de ne pas
--  trancher au fond d'un fichier. Mais R10 tranche a sa place : « un defaut
--  n'est pas un blocage. Livrer une valeur que l'expert changera n'est pas
--  une faute ; ne rien livrer et attendre sa validation l'est, parce que le
--  produit devient inutilisable entre-temps. »
--
--  Le defaut livre est TROIS, et il se fonde sur trois choses mesurees dans
--  ce depot, pas sur une impression :
--
--    1. DEUX est le plancher technique, pas un choix :
--       `EXEMPLES_MINIMUM_POUR_UNE_OSSATURE` vaut 2, et a un seul exemple
--       l'ossature porte le nom du client — mesure, 0,0000 devient 0,0960
--       chez un autre client. En dessous de 2, le generateur REFUSE.
--    2. Declencher AU plancher ferait depenser un appel paye pour un refus
--       probable : l'ossature de deux documents retient tout ce que ces
--       deux-la partagent par hasard, et un accident de mise en page pese
--       deja ~0,03 pour un seuil de reconnaissance a 0,08. Le troisieme
--       exemple est le moins cher des moyens de faire tomber un accord
--       fortuit — l'intersection est le seul outil qu'on ait.
--    3. Attendre PLUS que trois est une perte seche : une generation coute
--       0,0024 $ mesure, une designation par le modele 0,0035 $ par piece.
--       Le retour sur depense est atteint a la premiere piece lue par la
--       recette ; chaque piece lue par le modele au-dela du necessaire est
--       de l'argent depense pour rien.
--
--  Ce n'est donc pas un releve : c'est un POINT DE DEPART raisonnable,
--  livre, visible, et que le cabinet change sans deploiement (R10,
--  consequence 3) dans `parametrage.fabrique_seuils`. Un cabinet prudent
--  mettra cinq ; un cabinet presse mettra deux et verra des refus.
--
--  ============================================ PAS DEUX FOIS, ET LA BASE LE TIENT
--
--  Une generation est un appel paye. Deux generations pour le meme format
--  seraient deux depenses pour un seul lecteur. On n'invente rien : la file
--  porte deja `unique (tenant_id, cle_idempotence)`, et la cle est
--  `generation_recette:<signature>`. Deux propositions simultanees
--  s'inserent toutes les deux ; l'index en laisse passer UNE, et l'autre
--  recoit zero ligne par `on conflict do nothing`. La reussite se lit sur la
--  LIGNE RENDUE, jamais sur un nombre de lignes touchees.
--
--  Et un format qui a DEJA un lecteur n'en redemande pas un : la proposition
--  s'arrete sur `fabrique.recettes`. Une version nouvelle d'un format connu
--  reste une decision — la surveillance suspend, l'expert decide ; ce n'est
--  pas un declenchement automatique.
--
--  ======================================= POURQUOI LE PRENEUR DIT CE QU'IL SAIT FAIRE
--
--  `fabrique.travail_prendre` prenait le travail le plus prioritaire, de
--  n'importe quelle nature, et le coureur l'executait comme une LECTURE.
--  Avec une seule nature, c'etait juste ; avec deux, c'est une generation
--  executee comme une lecture. Le preneur recoit donc la liste des natures
--  que l'appelant sait executer, et ne prend rien d'autre. Un effet voulu :
--  sans generateur configure, le coureur ne nomme pas `generation_recette`,
--  et le travail ATTEND au lieu de s'epuiser en trois tentatives contre une
--  cle absente.
--
--  R11 : `valid_from` est un LITTERAL, et c'est aujourd'hui — le 19 octobre.
--  Une date posee dans le futur n'est en vigueur nulle part, et l'epreuve
--  qui depend de son absence passerait pour la mauvaise raison. La faute
--  s'est manifestee quatre fois dans ce depot.
-- ======================================================================

-- Le lanceur (db/migrer.mjs) ouvre deja la transaction : on n'en ouvre pas une seconde.

-- --------------------------------------------- 1. Ce qu'un travail de generation vise
--
-- Un travail de lecture vise une PIECE. Un travail de generation vise un
-- FORMAT, et le format est une cle de signature. La colonne reste nullable
-- parce qu'une lecture n'en porte pas ; la contrainte dit laquelle des deux
-- natures l'exige, pour qu'un travail de generation sans cible soit
-- impossible a inscrire plutot que decouvert a l'execution.

alter table fabrique.travaux
  add column if not exists signature_cle text;

do $$ begin
  alter table fabrique.travaux
    add constraint fabrique_travaux_signature_ck
    check (nature <> 'generation_recette'::fabrique.travail_nature_t
           or (signature_cle is not null and length(btrim(signature_cle)) > 0));
exception when duplicate_object then null; end $$;

comment on column fabrique.travaux.signature_cle is
  'Le format que ce travail vise, pour une generation. Nul pour une lecture, '
  'qui vise une piece. La piece d''un travail de generation est l''un de ses '
  'exemples : elle rattache le travail a quelque chose de visible, et c''est '
  'ce que le declencheur de visibilite verifie.';

-- Menant par `tenant_id`, comme R6 l'exige de toute table de tenant.
create index if not exists fabrique_travaux_signature_idx
  on fabrique.travaux (tenant_id, nature, signature_cle);

-- ------------------------------------------------ 2. Le seuil, dans le referentiel
--
-- R4 : aucun seuil en TypeScript, aucun seuil dans un `check`. R10 : un
-- defaut LIVRE, visible, surchargeable sans migration. On reutilise
-- `ref.socle_params` et `parametrage.fabrique_seuils` — les deux tables que
-- le socle a posees. On ne cree pas un troisieme endroit.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, c.code, c.v, 'Politique de fabrique de lecteurs ALGORIA', date '2026-10-19'
  from ref.jurisdiction_packs p
  cross join (values
    ('fabrique.seuil.generation.pieces_min', 3::numeric)
  ) as c(code, v)
 where p.effective_from <= date '2026-10-19'
   and (p.effective_to is null or p.effective_to >= date '2026-10-19')
on conflict do nothing;

/*
 * La borne de la generation : ce que le cabinet a arrete, puis le defaut du
 * pack. Meme forme que `fabrique.bornes_de_travail` et
 * `fabrique.bornes_de_recette`, et pour la meme raison : une borne absente
 * est une EXCEPTION, pas un `null`. L'appelant n'a aucune occasion de
 * « completer » — c'est exactement le repli implicite que R4 interdit.
 */
create or replace function fabrique.bornes_de_generation(p_tenant uuid)
returns table (borne text, valeur numeric, arrete_par_le_cabinet boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_attendues constant text[] := array['pieces_min'];
  v_manquantes text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.generation.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.generation\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.generation\.(.+)$') = any(v_attendues);

  select array_agg(a order by a) into v_manquantes
    from unnest(v_attendues) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.generation.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquantes is not null then
    raise exception
      'bornes de generation absentes du referentiel : % (ref.socle_params, codes fabrique.seuil.generation.*)',
      array_to_string(v_manquantes, ', ')
      using errcode = 'no_data_found';
  end if;
end
$$;

revoke all on function fabrique.bornes_de_generation(uuid) from public, anon;
grant execute on function fabrique.bornes_de_generation(uuid) to authenticated;

comment on function fabrique.bornes_de_generation(uuid) is
  'La borne que la generation exige sans defaut : pieces_min, le nombre de '
  'pieces distinctes d''un meme format au bout duquel Malica propose un '
  'lecteur. Ce que le cabinet a arrete, puis le defaut du pack ; une borne '
  'absente leve au lieu de laisser deviner.';

-- ------------------------------------------------------- 3. La proposition elle-meme
--
-- Toute la REGLE est ici : le compte, le seuil, le format deja pourvu, la
-- piece de rattachement, et l'unicite. R3 — la couche agentique n'emet
-- aucune valeur liante : elle appelle, et restitue ce que la base repond.

create or replace function fabrique.generation_proposer(p_tenant uuid, p_signature text)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_min     numeric;
  v_pieces  integer;
  v_piece   uuid;
  v_travail uuid;
begin
  -- Sans borne, on ne propose rien : on le dit, on ne devine pas (R4). La
  -- fonction leve si elle manque — on n'arrive ici qu'avec une valeur.
  select b.valeur into v_min
    from fabrique.bornes_de_generation(p_tenant) b
   where b.borne = 'pieces_min';

  -- Un format qui a deja un lecteur n'en redemande pas un.
  if exists (select 1 from fabrique.recettes r
              where r.tenant_id = p_tenant and r.signature_cle = p_signature) then
    return null;
  end if;

  /*
   * Le compte porte sur des PIECES DISTINCTES, pas sur des exemples : deux
   * exemples du meme document ne font pas deux exemples — « l'intersection
   * de quelque chose avec lui-meme ne fait rien tomber ». Et seuls les
   * exemples qui NOURRISSENT une recette comptent : une decision comptable
   * n'est pas une regle de lecture, et la colonne est calculee en base.
   *
   * `security invoker` : ce compte est celui que l'appelant VOIT. Un intrus
   * compte zero, passe sous le seuil, et ne propose rien — la RLS repond
   * avant toute regle.
   */
  select count(distinct e.piece_id) into v_pieces
    from fabrique.exemples e
   where e.tenant_id = p_tenant
     and e.signature_cle = p_signature
     and e.usage = 'apprentissage'
     and e.nourrit_une_recette;

  if v_pieces < v_min then
    return null;
  end if;

  -- La piece de rattachement : le dernier exemple qualifie de ce format.
  -- `fabrique.travaux.piece_id` est obligatoire, et le declencheur de
  -- visibilite la verifie — un travail ne nomme pas une piece qu'on ne voit
  -- pas.
  select e.piece_id into v_piece
    from fabrique.exemples e
   where e.tenant_id = p_tenant
     and e.signature_cle = p_signature
     and e.usage = 'apprentissage'
     and e.nourrit_une_recette
   order by e.qualifie_le desc, e.id desc
   limit 1;

  /*
   * PAS DEUX FOIS, et c'est l'index unique qui le tient — pas un verrou
   * applicatif, pas un `if not exists` qui laisserait une fenetre. Zero
   * ligne rendue veut dire « deja propose », et c'est une reponse.
   */
  insert into fabrique.travaux
    (tenant_id, piece_id, nature, cle_idempotence, signature_cle)
  values
    (p_tenant, v_piece, 'generation_recette',
     'generation_recette:' || p_signature, p_signature)
  on conflict (tenant_id, cle_idempotence) do nothing
  returning id into v_travail;

  return v_travail;
end
$$;

revoke all on function fabrique.generation_proposer(uuid, text) from public, anon;
grant execute on function fabrique.generation_proposer(uuid, text) to authenticated;

comment on function fabrique.generation_proposer(uuid, text) is
  'Met en file une generation de recette pour ce format, si et seulement si '
  'assez de pieces distinctes le portent, qu''aucun lecteur n''existe deja, '
  'et qu''aucune generation n''a deja ete proposee. Rend l''identifiant du '
  'travail, ou null — et null n''est pas une erreur.';

-- -------------------------------------- 4. Le preneur dit ce qu'il sait executer
--
-- Le corps ne change pas d'un iota, sauf deux choses : le filtre de nature,
-- et `signature_cle` dans ce qui est rendu. On REMPLACE la fonction a un
-- argument au lieu d'en ajouter une seconde : deux surcharges dont l'une a
-- un defaut rendraient `travail_prendre($1)` ambigu, et PostgreSQL refuserait
-- l'appel.

drop function if exists fabrique.travail_prendre(uuid);

create or replace function fabrique.travail_prendre(
  p_tenant  uuid,
  p_natures fabrique.travail_nature_t[] default null)
returns table (
  travail_id    uuid,
  piece_id      uuid,
  nature        fabrique.travail_nature_t,
  signature_cle text,
  tentative     smallint,
  fait_id       uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c       record;
  v_fait  uuid;
begin
  -- Sans bornes, on ne prend rien : on le dit, on ne devine pas (R4).
  perform fabrique.bornes_de_travail(p_tenant);

  for c in
    select e.travail_id, e.piece_id, e.nature, t.signature_cle, e.tentatives
      from fabrique.etat_des_travaux_v e
      join fabrique.travaux t on t.id = e.travail_id
     where e.tenant_id = p_tenant
       and e.prenable
       and (p_natures is null or e.nature = any(p_natures))
     order by e.priorite, e.demande_le
  loop
    begin
      insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature)
      values (p_tenant, c.travail_id, (c.tentatives + 1)::smallint, 'pris')
      returning id into v_fait;
    exception
      -- Un autre preneur a eu cette tentative. On passe au suivant : ce
      -- n'est pas une panne, c'est une file qui fonctionne.
      when unique_violation then continue;
      -- L'etat a bouge entre la lecture et l'ecriture — une autre execution
      -- vient de demarrer sur la meme piece, par exemple. Meme reponse.
      when check_violation then continue;
    end;

    travail_prendre.travail_id    := c.travail_id;
    travail_prendre.piece_id      := c.piece_id;
    travail_prendre.nature        := c.nature;
    travail_prendre.signature_cle := c.signature_cle;
    travail_prendre.tentative     := (c.tentatives + 1)::smallint;
    travail_prendre.fait_id       := v_fait;
    return next;
    return;
  end loop;
  -- Rien a prendre : zero ligne, et c'est une reponse, pas une erreur.
  return;
end
$$;

revoke all on function fabrique.travail_prendre(uuid, fabrique.travail_nature_t[])
  from public, anon;
grant execute on function fabrique.travail_prendre(uuid, fabrique.travail_nature_t[])
  to authenticated;

comment on function fabrique.travail_prendre(uuid, fabrique.travail_nature_t[]) is
  'Prend le travail le plus prioritaire que l''appelant peut prendre PARMI '
  'les natures qu''il sait executer, et rend la ligne du fait inscrit. '
  'Aucune nature dite = toutes. Aucune ligne rendue = rien a prendre. Deux '
  'preneurs simultanes : l''index unique tranche, le perdant passe au '
  'candidat suivant.';
