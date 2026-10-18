-- ======================================================================
--  La file durable des travaux de lecture.
--
--  CE QUI CLOCHAIT. Lire une pièce est aujourd'hui une PROMESSE EN MÉMOIRE :
--  `readPieceFlow` tourne dans le processus, et le registre qui dit « une
--  lecture est en cours » est une `Map` ancrée sur `globalThis`. Le processus
--  meurt, la lecture meurt avec lui — et, mesuré cette nuit, une pièce peut
--  être LUE, PERSISTÉE, et JAMAIS COMPTÉE parce que la mort est tombée entre
--  les deux. Pire, la route répond `{enCours:true}` AVANT que quoi que ce
--  soit soit écrit : un refus d'arrière-plan s'est déjà perdu dans ce trou.
--
--  Ce fichier copie l'idiome du dépôt pour une file durable —
--  `legal.ingestion_queue` (20260902130000), qui porte un statut, un motif
--  d'échec, une date d'aboutissement et une priorité — et il le copie avec la
--  leçon que cette table a laissée, écrite dans son propre en-tête :
--
--      « Le statut se DÉDUIT de la base, il ne se saisit pas. »
--
--  Quatre-vingt-seize documents s'y disaient « à faire » alors qu'ils étaient
--  ingérés, une vingtaine se disaient « ingérés » sans rien avoir produit,
--  parce que le statut était une COLONNE qu'on met à jour au fil des passes.
--  On ne refait pas cela.
--
--  ============================== LE PIÈGE QU'ON ÉVITE, ET CE QU'IL DÉCIDE
--
--  Une file de travaux doit PRENDRE un travail, donc le marquer pris. Le
--  réflexe est `select … for update` puis `update`. Les deux sont des pièges
--  dans ce dépôt, et le second est le pire :
--
--    `for update` est soumis à la politique UPDATE. Sur une table en ajout
--    seul, cette politique N'EXISTE PAS : la ligne devient « introuvable »
--    alors qu'elle est parfaitement lisible.
--
--    Et, mesuré le 19 octobre : UNE POLITIQUE ABSENTE NE REFUSE PAS, ELLE
--    IGNORE. Un `update` sous identité réelle touche zéro ligne, EN SILENCE,
--    sans erreur. Croire qu'il a réussi, c'est croire à la prise d'un travail
--    que personne n'a pris.
--
--  Deux issues étaient défendables : une table de travaux hors ajout seul,
--  avec une politique d'écriture explicite ; ou la prise comme FAIT NOUVEAU,
--  l'état se dérivant du dernier fait. On prend la seconde, pour trois
--  raisons qui tiennent toutes à ce dépôt :
--
--    1. R7 le dit déjà — « une correction est une écriture nouvelle » ;
--    2. `fabrique.promotions` + `fabrique.etat_des_recettes_v`, livrés il y a
--       trois heures, font exactement cela pour le cycle de vie d'une
--       recette : un second idiome dans le même schéma serait un doublon ;
--    3. et surtout, la prise devient alors ATOMIQUE SANS VERROU. Deux
--       preneurs calculent la même tentative suivante, tous deux l'insèrent,
--       et c'est un INDEX UNIQUE qui tranche : l'un reçoit sa ligne, l'autre
--       reçoit `23505`. La réussite se lit sur la LIGNE RENDUE, jamais sur un
--       nombre de lignes touchées.
--
--  ======================================================= LES TROIS ÉCHECS
--
--  Le dépôt les confond aujourd'hui sous un seul `catch` :
--
--    refus_metier        plafond atteint, pièce personnelle, licence
--                        suspendue. CE N'EST PAS UNE PANNE : le rejouer
--                        retesterait le même plafond sans fin. Le travail
--                        se ferme.
--    panne_fournisseur   le modèle ne répond pas. À réessayer, après un
--                        délai de repli, dans la limite des tentatives.
--    erreur_technique    un défaut de NOTRE code. À ne surtout pas réessayer
--                        en boucle : le travail se ferme, et quelqu'un lit
--                        le motif.
--
--  Aucune borne en SQL ni en TypeScript (R4, R10) : tentatives, âge d'abandon
--  et délai de repli vivent dans `ref.socle_params` sous `fabrique.seuil.*`,
--  datés, et se surchargent par cabinet dans `parametrage.fabrique_seuils` —
--  les deux tables que le socle a posées il y a trois heures. On ne crée pas
--  un troisième endroit.
--
--  R11 : la date de validité est un LITTÉRAL, et c'est le 18 octobre, pas une
--  date future. Un seuil daté du 20 n'est en vigueur nulle part le 18, et une
--  épreuve qui dépend de son absence passe alors pour la mauvaise raison.
-- ======================================================================

-- Le lanceur (db/migrer.mjs) ouvre deja la transaction : on n'en ouvre pas une seconde.

-- ------------------------------------------------------------ 1. Le vocabulaire

do $$ begin
  create type fabrique.travail_nature_t as enum ('lecture_piece');
exception when duplicate_object then null; end $$;

comment on type fabrique.travail_nature_t is
  'Ce qu''un travail fait. Une seule valeur aujourd''hui : la file ne sert '
  'qu''a la lecture d''une piece, et une valeur qu''on n''exerce pas est un '
  'placeholder (R9).';

do $$ begin
  create type fabrique.fait_t as enum (
    'pris',               -- quelqu'un a pris ce travail, et voici sa tentative
    'termine',            -- il a abouti
    'refus_metier',       -- la base a dit non : plafond, piece personnelle
    'panne_fournisseur',  -- le modele n'a pas repondu : a reessayer
    'erreur_technique');  -- notre code a casse : a NE PAS reessayer en boucle
exception when duplicate_object then null; end $$;

comment on type fabrique.fait_t is
  'Les faits d''un travail. « abandonne » n''y figure pas, et c''est '
  'volontaire : un processus mort n''inscrit rien. L''abandon se DEDUIT de '
  'l''age d''une prise sans issue — sinon la reprise dependrait de celui qui '
  'est justement mort.';

-- --------------------------------------------------------------- 2. Les travaux

create table if not exists fabrique.travaux (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  piece_id        uuid not null references capture.pieces(id) on delete cascade,
  nature          fabrique.travail_nature_t not null,
  -- L'idiome de `legal.ingestion_queue`, jusqu'au nom. Le defaut est du
  -- SCHEMA, visible et surchargeable a l'insertion : c'est ce qui evite un
  -- nombre ecrit en TypeScript.
  priorite        smallint not null default 5 check (priorite between 1 and 9),
  -- L'IDEMPOTENCE. Deux enregistrements sous la meme cle ne font qu'un
  -- travail : la file hors ligne du telephone rejoue, et un rejeu ne doit
  -- pas doubler la depense.
  cle_idempotence text not null check (length(btrim(cle_idempotence)) > 0),
  demande_par     uuid not null default auth.uid(),
  demande_le      timestamptz not null default now(),
  unique (tenant_id, cle_idempotence),
  -- Pour que les faits se rattachent au travail ET a son tenant d'un seul
  -- geste : un fait ne peut pas changer de cabinet en route.
  unique (tenant_id, id)
);
create index if not exists fabrique_travaux_tenant_idx
  on fabrique.travaux (tenant_id, priorite, demande_le);
create index if not exists fabrique_travaux_piece_idx
  on fabrique.travaux (piece_id);

comment on table fabrique.travaux is
  'Un travail a faire, inscrit DURABLEMENT avant tout accuse de prise en '
  'charge. Ajout seul : son etat n''est pas une colonne d''ici, il se derive '
  'de ses faits (fabrique.etat_des_travaux_v).';

-- ------------------------------------------------------------------ 3. Les faits

create table if not exists fabrique.travail_faits (
  id          uuid primary key default gen_random_uuid(),
  -- Monotone, comme `fabrique.promotions.ordre` : deux faits inscrits dans la
  -- meme transaction partagent `now()`, et un `order by inscrit_le` les
  -- departagerait au hasard. C'est cette colonne qui fait « le dernier fait ».
  ordre       bigint generated always as identity,
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  travail_id  uuid not null,
  -- Le numero de la tentative. C'est LUI qui porte l'exclusion mutuelle :
  -- voir l'index unique plus bas.
  tentative   smallint not null check (tentative > 0),
  nature      fabrique.fait_t not null,
  -- « echec sans motif est une tache oubliee qui se deguise en fait acquis »
  -- — l'en-tete de 20260902130000, mot pour mot, et toujours vrai.
  motif       text,
  detail      jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  inscrit_par uuid not null default auth.uid(),
  inscrit_le  timestamptz not null default now(),
  check (nature in ('pris', 'termine') or (motif is not null and length(btrim(motif)) > 0)),
  foreign key (tenant_id, travail_id)
    references fabrique.travaux (tenant_id, id) on delete cascade
);

-- L'EXCLUSION MUTUELLE, et elle tient en une ligne. Deux preneurs lisent le
-- meme etat, calculent la meme tentative suivante, et l'inserent tous les
-- deux : l'index en laisse passer UN. Le perdant recoit `23505` — une erreur,
-- pas un zero silencieux.
create unique index if not exists fabrique_travail_faits_prise_ux
  on fabrique.travail_faits (travail_id, tentative) where nature = 'pris';

-- Et une tentative n'a qu'une issue : on ne la termine pas deux fois, et on
-- ne la dit pas a la fois en panne et terminee.
create unique index if not exists fabrique_travail_faits_issue_ux
  on fabrique.travail_faits (travail_id, tentative) where nature <> 'pris';

create index if not exists fabrique_travail_faits_tenant_idx
  on fabrique.travail_faits (tenant_id, inscrit_le desc);
create index if not exists fabrique_travail_faits_travail_idx
  on fabrique.travail_faits (travail_id, ordre desc);

comment on table fabrique.travail_faits is
  'Ce qui est arrive a un travail, en faits dates et immuables. Prendre un '
  'travail, c''est INSCRIRE un fait — jamais mettre a jour une colonne : sur '
  'une table en ajout seul, un update touche zero ligne en silence.';

-- ------------------------------------------- 4. Les bornes, dans le referentiel
--
-- R4 : aucune borne en TypeScript, aucune borne dans un `check`. R10 : des
-- defauts LIVRES, visibles, surchargeables sans migration, dans la meme
-- table `parametrage.fabrique_seuils` que le socle a posee.
--
-- R11, forme ecrite ET forme cachee : `valid_from` est un litteral, et on
-- l'ECRIT au lieu de laisser la colonne prendre un defaut. Le 18 octobre, pas
-- le 20 : une date de reference placee dans le futur rend verte toute epreuve
-- qui depend de son absence.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, c.code, c.v, 'Politique de fabrique de lecteurs ALGORIA', date '2026-10-18'
  from ref.jurisdiction_packs p
  cross join (values
    -- Trois tentatives : la lecture a deja son propre rattrapage interne
    -- (deux lecteurs), donc ceci borne les PANNES, pas les lectures ratees.
    ('fabrique.seuil.travail.tentatives_max', 3::numeric),
    -- Quinze minutes. Une lecture mesuree dure 18 a 21 s ; un modele froid
    -- ou une pile de pages peut depasser la minute. C'est un POINT DE DEPART
    -- A MESURER, pas un releve : reprendre trop tot ferait tourner deux
    -- lectures sur la meme piece, trop tard laisserait une pièce muette.
    ('fabrique.seuil.travail.abandon_s',      900),
    -- Une minute avant de retenter apres une panne fournisseur.
    ('fabrique.seuil.travail.repli_s',        60)
  ) as c(code, v)
 where p.effective_from <= date '2026-10-18'
   and (p.effective_to is null or p.effective_to >= date '2026-10-18')
on conflict do nothing;

/*
 * Les trois bornes du travail.
 *
 * Meme forme que `fabrique.bornes_de_recette`, et pour la meme raison : elles
 * sortent ENSEMBLE ou pas du tout. Une borne manquante est une EXCEPTION, pas
 * un `null` — l'appelant n'a aucune occasion de « completer », et c'est
 * exactement le repli implicite que R4 interdit.
 */
create or replace function fabrique.bornes_de_travail(p_tenant uuid)
returns table (borne text, valeur numeric, arrete_par_le_cabinet boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_attendues constant text[] := array['tentatives_max', 'abandon_s', 'repli_s'];
  v_manquantes text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.travail.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.travail\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.travail\.(.+)$') = any(v_attendues);

  select array_agg(a order by a) into v_manquantes
    from unnest(v_attendues) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.travail.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquantes is not null then
    raise exception
      'bornes de travail absentes du referentiel : % (ref.socle_params, codes fabrique.seuil.travail.*)',
      array_to_string(v_manquantes, ', ')
      using errcode = 'no_data_found';
  end if;
end
$$;

revoke all on function fabrique.bornes_de_travail(uuid) from public, anon;
grant execute on function fabrique.bornes_de_travail(uuid) to authenticated;

comment on function fabrique.bornes_de_travail(uuid) is
  'Les trois bornes que la file exige sans defaut : tentatives_max, '
  'abandon_s, repli_s. Ce que le cabinet a arrete, puis le defaut du pack ; '
  'une borne absente leve au lieu de laisser deviner.';

-- ------------------------------------------------- 5. L'etat, derive du dernier fait
--
-- Rien n'est stocke. C'est la lecon de `legal.ingestion_queue`, dont le
-- statut etait une colonne saisie par les scripts et qui a menti sur
-- quatre-vingt-seize documents.
--
-- `security_invoker` : la vue rend ce que l'APPELANT a le droit de voir. Dix
-- vues sans ce reglage ont ete une fuite entre clients le 17 octobre.

create or replace view fabrique.etat_des_travaux_v with (security_invoker = true) as
with livres as (
  select distinct on (s.code) s.code, s.value_num
    from ref.socle_params s
   where s.code like 'fabrique.seuil.travail.%'
     and s.valid_from <= current_date
     and (s.valid_to is null or s.valid_to >= current_date)
   order by s.code, s.valid_from desc
),
dernier as (
  select distinct on (f.travail_id)
         f.travail_id, f.nature, f.motif, f.tentative, f.inscrit_le
    from fabrique.travail_faits f
   order by f.travail_id, f.ordre desc
),
comptes as (
  select f.travail_id, count(*) filter (where f.nature = 'pris') as tentatives
    from fabrique.travail_faits f
   group by f.travail_id
)
select t.id                              as travail_id,
       t.tenant_id,
       t.piece_id,
       t.nature,
       t.priorite,
       t.demande_le,
       coalesce(c.tentatives, 0)::smallint as tentatives,
       b.tentatives_max,
       d.nature                          as dernier_fait,
       d.motif                           as dernier_motif,
       d.inscrit_le                      as dernier_le,
       e.etat,
       e.prenable_a,
       (e.prenable_a is not null and e.prenable_a <= now()) as prenable
  from fabrique.travaux t
  left join dernier d on d.travail_id = t.id
  left join comptes c on c.travail_id = t.id
  cross join lateral (
    select
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.tentatives_max') as tentatives_max,
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.abandon_s')      as abandon_s,
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.repli_s')        as repli_s
      from livres l
      left join parametrage.fabrique_seuils o
        on o.tenant_id = t.tenant_id and o.code = l.code
  ) b
  cross join lateral (
    -- L'ORDRE DE CES BRANCHES EST LA REGLE, et il se lit de haut en bas.
    select case
      when d.nature is null                 then 'a_faire'
      when d.nature = 'termine'             then 'termine'
      when d.nature = 'refus_metier'        then 'refuse'
      when d.nature = 'erreur_technique'    then 'en_erreur'
      -- Une prise encore fraiche : quelqu'un travaille.
      when d.nature = 'pris'
       and now() <= d.inscrit_le + make_interval(secs => b.abandon_s::double precision) then 'en_cours'
      -- Au-dela, le preneur est repute mort. Reste a savoir s'il reste des
      -- tentatives : la borne passe avant la reprise.
      when coalesce(c.tentatives, 0) >= b.tentatives_max then 'epuise'
      when d.nature = 'pris'                then 'abandonne'
      else                                       'en_panne'
    end as etat
  ) e0
  cross join lateral (
    select e0.etat,
           case e0.etat
             -- Un travail jamais pris est prenable depuis sa demande.
             when 'a_faire'   then t.demande_le
             -- Un travail abandonne l'est depuis que son preneur s'est tu.
             when 'abandonne' then d.inscrit_le + make_interval(secs => b.abandon_s::double precision)
             -- Une panne se retente apres le repli, et pas avant.
             when 'en_panne'  then d.inscrit_le + make_interval(secs => b.repli_s::double precision)
             -- termine, refuse, en_erreur, en_cours, epuise : jamais.
             else null
           end as prenable_a
  ) e;

grant select on fabrique.etat_des_travaux_v to authenticated;

comment on view fabrique.etat_des_travaux_v is
  'Ou en est chaque travail, d''apres ses faits : a_faire, en_cours, '
  'abandonne, en_panne, epuise, termine, refuse, en_erreur. C''est ce que '
  'l''ecran lit pour dire ou en est une piece au lieu de se taire. Une borne '
  'absente du referentiel rend « prenable » faux — elle refuse, elle ne '
  'devine pas ; la fonction de prise, elle, leve et le dit.';

-- ------------------------------------------------ 6. Ce que la base refuse elle-meme
--
-- Un ecran se contourne et une RPC s'oublie : la regle de prise vit ici.

create or replace function fabrique.verifier_fait_de_travail()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_piece  uuid;
  v_nature fabrique.travail_nature_t;
  v_etat   record;
begin
  -- `security invoker` : si l'appelant ne VOIT pas le travail, il n'y
  -- inscrit rien. La cle etrangere, elle, ne consulte aucune politique.
  select t.piece_id, t.nature into v_piece, v_nature
    from fabrique.travaux t where t.id = new.travail_id;
  if v_piece is null then
    raise exception 'travail % introuvable ou non lisible', new.travail_id
      using errcode = '42501';
  end if;

  if new.nature <> 'pris' then
    -- Une issue appartient a UNE prise, la sienne. Sans cela, on raconterait
    -- la fin d'un travail que personne n'a commence.
    if not exists (
      select 1 from fabrique.travail_faits f
       where f.travail_id = new.travail_id
         and f.tentative = new.tentative
         and f.nature = 'pris')
    then
      raise exception
        'issue sans prise : la tentative % du travail % n''a jamais ete prise',
        new.tentative, new.travail_id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Une borne absente LEVE ici, au lieu de laisser la vue refuser en silence.
  perform fabrique.bornes_de_travail(new.tenant_id);

  /*
   * LA SERIALISATION, et elle porte sur la PIECE, pas sur le travail.
   *
   * L'index unique suffit pour deux preneurs du MEME travail. Il ne dit rien
   * de deux travaux DIFFERENTS sur la meme piece — le cas de la file hors
   * ligne qui rejoue sous une autre cle. Un verrou consultatif de
   * transaction les met en file : il n'est soumis a aucune politique, et il
   * tombe au commit comme au rollback.
   */
  perform pg_advisory_xact_lock(
    hashtextextended(v_piece::text || ':' || v_nature::text, 0));

  select * into v_etat from fabrique.etat_des_travaux_v e
   where e.travail_id = new.travail_id;

  if not coalesce(v_etat.prenable, false) then
    raise exception
      'travail % non prenable : etat « % », tentatives %/%',
      new.travail_id, v_etat.etat, v_etat.tentatives, v_etat.tentatives_max
      using errcode = 'check_violation';
  end if;

  if new.tentative <> v_etat.tentatives + 1 then
    raise exception
      'tentative % : la prochaine tentative de ce travail est la %',
      new.tentative, v_etat.tentatives + 1
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from fabrique.etat_des_travaux_v o
     where o.piece_id = v_piece
       and o.nature = v_nature
       and o.travail_id <> new.travail_id
       and o.etat = 'en_cours')
  then
    raise exception
      'une autre execution est en cours sur la piece % : deux lectures '
      'concurrentes de la meme piece se paient deux fois', v_piece
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

comment on function fabrique.verifier_fait_de_travail() is
  'Qui peut prendre, quand, et pour la combientieme fois — dans la base. La '
  'prise reste un INSERT : cette fonction ne decide pas a sa place, elle '
  'refuse ce qui ne doit pas s''inscrire.';

-- ------------------------------------------------------------ 7. Prendre un travail
--
-- La prise, et la seule chose qu'on en croit : LA LIGNE RENDUE. Aucun
-- `update`, aucun `for update`, aucun `rowCount`.

create or replace function fabrique.travail_prendre(p_tenant uuid)
returns table (
  travail_id uuid,
  piece_id   uuid,
  nature     fabrique.travail_nature_t,
  tentative  smallint,
  fait_id    uuid)
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
    select e.travail_id, e.piece_id, e.nature, e.tentatives
      from fabrique.etat_des_travaux_v e
     where e.tenant_id = p_tenant
       and e.prenable
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

    travail_prendre.travail_id := c.travail_id;
    travail_prendre.piece_id   := c.piece_id;
    travail_prendre.nature     := c.nature;
    travail_prendre.tentative  := (c.tentatives + 1)::smallint;
    travail_prendre.fait_id    := v_fait;
    return next;
    return;
  end loop;
  -- Rien a prendre : zero ligne, et c'est une reponse, pas une erreur.
  return;
end
$$;

revoke all on function fabrique.travail_prendre(uuid) from public, anon;
grant execute on function fabrique.travail_prendre(uuid) to authenticated;

comment on function fabrique.travail_prendre(uuid) is
  'Prend le travail le plus prioritaire que l''appelant peut prendre, et rend '
  'la ligne du fait inscrit. Aucune ligne rendue = rien a prendre. Deux '
  'preneurs simultanes : l''index unique tranche, le perdant passe au '
  'candidat suivant.';

-- ------------------------------------------------------------ 8. L'isolation (R6, R7)

select app.enable_tenant_rls('fabrique', 'travaux',       false, true);
select app.enable_tenant_rls('fabrique', 'travail_faits', false, true);

-- `ordre` est une colonne d'identite : personne ne l'ecrit.
revoke insert (ordre) on table fabrique.travail_faits from authenticated;

-- Une piece qu'on ne voit pas ne se met pas en file : la cle etrangere ne
-- consulte aucune politique, et un travail suffirait a apprendre qu'une piece
-- existe chez un autre cabinet.
drop trigger if exists fabrique_travaux_piece_visible on fabrique.travaux;
create trigger fabrique_travaux_piece_visible
  before insert on fabrique.travaux
  for each row execute function fabrique.verifier_piece_visible();

drop trigger if exists fabrique_travail_faits_regle on fabrique.travail_faits;
create trigger fabrique_travail_faits_regle
  before insert on fabrique.travail_faits
  for each row execute function fabrique.verifier_fait_de_travail();
