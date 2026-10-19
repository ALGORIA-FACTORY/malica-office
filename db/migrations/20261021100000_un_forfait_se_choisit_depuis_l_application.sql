-- Un forfait se choisit depuis l'application, et le refus dit pourquoi.
--
-- ================================================================== POURQUOI
--
-- `20261020110000` a modélisé l'abonnement entièrement : l'échelle des offres,
-- les canaux, l'historique par période, le prorata, les factures. Elle a posé
-- UNE fonction publique — `mon_forfait()` — qui LIT. Rien ne permettait de
-- changer de forfait. Son titre disait pourtant « un forfait se change » :
-- il décrivait le modèle, pas le geste.
--
-- Demandé le 19 octobre 2026 : « mon compte doit être team et affiche dans
-- réglages, et moi je vais faire le upgrade et downgrade ». Le geste est
-- celui du client, pas le mien : il faut donc qu'il existe dans l'application.
--
-- ===================================== CE QUE LA BASE AUTORISAIT DÉJÀ
--
-- Relevé par sonde, pas supposé : `facturation.forfait_historique` accorde
-- `insert` et `update` à `authenticated`, et ses politiques les bornent au
-- TITULAIRE de la licence. Le titulaire pouvait donc déjà changer son forfait
-- en écrivant la table — ce qui est voulu : c'est lui qui paie.
--
-- Ces fonctions sont donc `security invoker`. Elles ne contournent RIEN : la
-- RLS reste le garde, et ce qu'elles ajoutent est la RÈGLE MÉTIER, qui
-- n'existait nulle part. C'est l'inverse de `capture_piece_supprimer`, qui est
-- `security definer` parce qu'elle doit effacer ce qu'`authenticated` n'a pas
-- le droit d'effacer. Ici il n'y a rien à ouvrir.
--
-- ============================================= LES TROIS INVARIANTS À RESPECTER
--
-- Trois déclencheurs gardent déjà l'historique, et le changement s'écrit pour
-- eux, pas contre eux :
--
--   `forfait_fige`        — sur `update`, seule `effet_au` peut changer, et
--                           elle doit devenir non nulle. Fermer, rien d'autre.
--   `forfait_sans_trou`   — sur `insert`, aucune période ne doit courir, et
--                           `effet_du` doit valoir exactement le `effet_au` de
--                           la précédente. On reprend le jour où l'on s'arrête.
--   `periode_se_ferme_seulement` — la même chose, dite sur l'autre chemin.
--
-- D'où l'ordre, et il n'y en a pas d'autre : FERMER à J, puis OUVRIR à J.
--
-- ============================================== LE REFUS EST UNE DONNÉE, PAS UN SI
--
-- Trois choses peuvent empêcher un changement, et aucune n'est une constante
-- écrite dans du code (R4) :
--
--   1. L'offre ne se vend pas en libre-service sur ce canal. `ref.
--      offres_par_canal.libre_service` le dit, par canal et par date. Sur
--      `direct` les quatre offres le sont ; sur `cabinet`, `team` et `premium`
--      sont en commande spéciale, et `basic` ne se vend pas du tout.
--   2. La descente passerait sous les sièges OCCUPÉS. Solo n'a aucun siège :
--      y descendre avec un collaborateur en place le mettrait dehors sans que
--      personne ne l'ait décidé.
--   3. La descente passerait sous le nombre d'ORGANISATIONS ouvertes. Seul
--      Premium en porte plus d'une.
--
-- Le refus est RENDU par `mes_offres()` avant d'être levé par
-- `forfait_changer()`. L'écran montre donc les quatre offres, celle qu'on a,
-- et pour les autres soit l'action, soit la raison — jamais une porte muette.
-- « Ce qu'un forfait ne donne pas apparaît verrouillé et VISIBLE, jamais
-- masqué » : la règle de l'écran des réglages, tenue ici par la base.
--
-- ========================================= CE QUE CES FONCTIONS NE FONT PAS
--
-- Elles n'encaissent rien. Le prorata, la facture et le paiement sont déjà
-- écrits — `facturation.emettre`, section 17 de `20261020110000` — et ils
-- travaillent sur l'historique que ces fonctions écrivent. Changer de forfait
-- inscrit un FAIT ; ce que ce fait coûte se calcule ailleurs, et c'était déjà
-- vrai avant moi.
--
-- Elles ne créent pas de licence. Souscrire est un autre geste, avec un autre
-- motif (`souscription`), et il naît ailleurs.
--
-- ============================================================== REJEU (R11)
--
-- Que des `create or replace function`. Aucune date n'est calculée : la date
-- d'effet est un ARGUMENT, par défaut `current_date` — appelée, la fonction
-- s'exécute à un instant, et c'est cet instant qui décide. Un rejeu ne
-- réécrit aucune donnée.

begin;

-- ===========================================================================
-- 1. LA LICENCE DONT ON PARLE — ÉCRITE UNE FOIS
-- ===========================================================================
--
-- `mon_forfait()` résout déjà la licence du titulaire, et je ne la réécris pas
-- à côté : la règle vivrait en deux exemplaires et divergerait au premier
-- changement. Elle sort ici, et `mon_forfait()` n'est pas touchée — elle
-- marche, et une migration qui réécrit ce qui marche est une migration qui
-- casse ce qui marche.

create or replace function facturation.ma_licence(p_tenant uuid default null)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_n bigint;
  v_licence uuid;
begin
  if p_tenant is null then
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
     where l.titulaire = auth.uid();
  else
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where l.titulaire = auth.uid() and lo.tenant_id = p_tenant;
  end if;

  -- Le même code et le même message que `mon_forfait()` : deux fonctions qui
  -- répondent à la même ambiguïté doivent la dire de la même façon.
  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce titulaire : precisez l''organisation'
      using errcode = '21000';
  end if;

  return v_licence;   -- `null` : pas titulaire, ou aucune licence.
end;
$$;

comment on function facturation.ma_licence(uuid) is
  'La licence dont l''appelant est TITULAIRE. `null` s''il ne l''est pas : '
  'un membre n''est pas celui qui paie, et ne change donc pas le forfait.';


-- ===========================================================================
-- 2. L'EMPÊCHEMENT — UN CODE, DES CHIFFRES, ET PAS UNE PHRASE
-- ===========================================================================
--
-- La fonction rend un CODE, pas un texte. L'application parle français,
-- anglais et arabe : une phrase française inscrite ici serait fausse pour deux
-- lecteurs sur trois, et une base de données n'est pas un fichier de
-- traduction. Les chiffres partent avec, pour que la phrase traduite puisse
-- dire « 3 collaborateurs » sans les redemander.
--
--   null                  — rien n'empêche.
--   'offre_inconnue'      — aucune ligne de grille à cette date.
--   'pas_de_licence'      — l'appelant n'est pas titulaire.
--   'commande_speciale'   — l'offre existe mais ne se prend pas seul sur ce
--                           canal. `libre_service = false`.
--   'sieges_occupes'      — descendre mettrait des collaborateurs dehors.
--   'organisations'       — descendre laisserait des sociétés sans forfait.
--   'deja_courant'        — c'est le forfait qu'on a déjà.

create or replace function facturation.empechement_de_forfait(
  p_licence uuid, p_offre text, p_le date)
returns table (code text, chiffres jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_courant   record;
  v_cible     record;
  v_canal_ok  record;
  v_usage     record;
begin
  if p_licence is null then
    return query select 'pas_de_licence'::text, '{}'::jsonb; return;
  end if;

  select f.offre_code, f.canal into v_courant
    from facturation.forfait_courant_v f where f.licence_id = p_licence;

  if v_courant.canal is null then
    return query select 'pas_de_licence'::text, '{}'::jsonb; return;
  end if;

  -- La ligne de grille est celle qui VALAIT a la date demandee. Meme regle
  -- que partout : chacun porte SA date, et c'est la sienne qui le tarife.
  select o.* into v_cible
    from ref.offres o
   where o.code = p_offre and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  if v_cible.code is null then
    return query select 'offre_inconnue'::text, '{}'::jsonb; return;
  end if;

  if v_cible.code = v_courant.offre_code then
    return query select 'deja_courant'::text, jsonb_build_object('offre', v_cible.code); return;
  end if;

  select c.libre_service into v_canal_ok
    from ref.offres_par_canal c
   where c.canal = v_courant.canal and c.offre_code = p_offre and c.effective_from <= p_le
   order by c.effective_from desc limit 1;

  if v_canal_ok.libre_service is distinct from true then
    return query select 'commande_speciale'::text,
      jsonb_build_object('canal', v_courant.canal, 'offre', v_cible.code); return;
  end if;

  select co.sieges_occupes, co.organisations into v_usage
    from facturation.consommation_v co where co.licence_id = p_licence;

  -- Une descente ne met personne dehors. `sieges_max` est le plafond de
  -- l'offre visee, sieges supplementaires compris : Solo vaut zero, donc un
  -- seul collaborateur suffit a refuser.
  if coalesce(v_usage.sieges_occupes, 0) > v_cible.sieges_max then
    return query select 'sieges_occupes'::text,
      jsonb_build_object('occupes', v_usage.sieges_occupes, 'max', v_cible.sieges_max); return;
  end if;

  if coalesce(v_usage.organisations, 0) > v_cible.organisations_max then
    return query select 'organisations'::text,
      jsonb_build_object('ouvertes', v_usage.organisations, 'max', v_cible.organisations_max); return;
  end if;

  return query select null::text, '{}'::jsonb;
end;
$$;

comment on function facturation.empechement_de_forfait(uuid, text, date) is
  'Ce qui empeche de prendre une offre : un CODE et des chiffres, jamais une '
  'phrase — l''application parle trois langues.';

-- ===========================================================================
-- 3. CE QUE JE PEUX PRENDRE, ET POURQUOI PAS
-- ===========================================================================
--
-- Les quatre offres, toujours les quatre. Celle qu'on a est marquee, les
-- autres portent soit rien — on peut les prendre — soit la raison. Un ecran
-- qui masquerait les offres inaccessibles cacherait au client ce qu'il
-- gagnerait a monter, et c'est exactement ce que l'ecran des reglages
-- interdit : « ce qu'un forfait ne donne pas apparait verrouille et VISIBLE ».

create or replace function public.mes_offres(
  p_tenant uuid default null, p_le date default current_date)
returns table (
  code text, libelle text, rang smallint, prix_mensuel_ht numeric,
  lectures_par_organisation integer,
  sieges_inclus smallint, sieges_max smallint,
  organisations_incluses smallint, organisations_max smallint,
  courant boolean, empechement text, chiffres jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
begin
  select f.offre_code into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;

  return query
    with grille as (
      select distinct on (o.code) o.*
        from ref.offres o
       where o.effective_from <= p_le
       order by o.code, o.effective_from desc)
    select g.code, g.libelle, g.rang, g.prix_mensuel_ht::numeric,
           g.lectures_par_organisation,
           g.sieges_inclus, g.sieges_max,
           g.organisations_incluses, g.organisations_max,
           (g.code = v_courant) as courant,
           e.code, e.chiffres
      from grille g
      cross join lateral facturation.empechement_de_forfait(v_licence, g.code, p_le) e
     order by g.rang;
end;
$$;

comment on function public.mes_offres(uuid, date) is
  'Les quatre offres, celle qu''on a, et pour chaque autre soit rien soit la '
  'raison. Jamais une porte muette.';

-- ===========================================================================
-- 4. CHANGER — FERMER A J, OUVRIR A J
-- ===========================================================================

create or replace function public.forfait_changer(
  p_offre text, p_tenant uuid default null, p_le date default current_date)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_emp     record;
  v_courant record;
  v_cible   record;
  v_motif   text;
begin
  select e.code, e.chiffres into v_emp
    from facturation.empechement_de_forfait(v_licence, p_offre, p_le) e;

  if v_emp.code is not null then
    -- Le code part dans le message, et l'ecran le traduit. `check_violation`
    -- parce que c'est une regle metier, pas une panne.
    raise exception 'forfait_refuse:%:%', v_emp.code, v_emp.chiffres
      using errcode = 'check_violation';
  end if;

  select f.id, f.offre_code, f.canal, f.effet_du into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;

  select o.rang into v_cible
    from ref.offres o
   where o.code = p_offre and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  -- Le motif se DEDUIT de l'echelle, il ne se choisit pas : deux offres de
  -- meme rang sont interchangeables, et `>` tranche sans cas particulier.
  select case when v_cible.rang > o.rang then 'montee' else 'descente' end into v_motif
    from ref.offres o
   where o.code = v_courant.offre_code and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  -- FERMER. `forfait_fige` n'admet que ca sur une periode existante.
  update facturation.forfait_historique
     set effet_au = p_le
   where licence_id = v_licence and effet_au is null;

  -- OUVRIR, le meme jour. `forfait_sans_trou` exige l'egalite exacte : aucun
  -- jour n'appartient a deux forfaits, aucun jour ne tombe entre les deux.
  insert into facturation.forfait_historique
    (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
  values
    (v_licence, p_offre, p_le, v_courant.canal, p_le, v_motif, auth.uid());

  return true;
end;
$$;

comment on function public.forfait_changer(text, uuid, date) is
  'Fermer la periode courante a J, en ouvrir une a J. Le refus porte un code '
  'que l''ecran traduit. `security invoker` : la RLS reste le garde.';

commit;
