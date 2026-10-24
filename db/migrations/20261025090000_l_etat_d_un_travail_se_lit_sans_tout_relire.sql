-- L'etat d'un travail se lit sans relire tout l'historique.
--
-- ============================================================== POURQUOI
--
-- 24 octobre 2026 : l'ecran de capture redemande la liste des pieces toutes
-- les trois secondes pendant une lecture, et cette liste dit desormais ou en
-- est la lecture de chaque piece (« rien ne dit que la lecture casse »,
-- Wissem). Elle lit `fabrique.etat_des_travaux_v`.
--
-- La vue derivait le dernier fait et le nombre de prises par deux CTE
-- (`distinct on`, `group by`) sur TOUT `travail_faits` visible sous la RLS.
-- Mesure au plan d'execution : un filtre sur l'organisation ou la piece ne
-- descendait pas dans ces CTE — chaque appel triait l'historique entier, qui
-- ne fait que grandir (R7).
--
-- ============================================================ CE QUI CHANGE
--
-- Rien du sens : memes colonnes, meme ordre, memes regles d'etat (le `case`
-- est recopie a l'identique). Seule la FORME : deux jointures laterales par
-- travail, servies par `fabrique_travail_faits_travail_idx`
-- (travail_id, ordre desc). Un `count(*)` sans fait rend 0, ce que faisait le
-- `coalesce` de la jointure externe ; il reste en place.

begin;

create or replace view fabrique.etat_des_travaux_v with (security_invoker = true) as
with livres as (
  select distinct on (s.code) s.code, s.value_num
    from ref.socle_params s
   where s.code like 'fabrique.seuil.travail.%'
     and s.valid_from <= current_date
     and (s.valid_to is null or s.valid_to >= current_date)
   order by s.code, s.valid_from desc
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
  -- Le dernier fait et le nombre de prises, PAR TRAVAIL : l'index
  -- (travail_id, ordre desc) les sert, et un filtre sur le travail, la piece
  -- ou l'organisation ne lit plus que les travaux qu'il retient.
  left join lateral (
    select f.nature, f.motif, f.tentative, f.inscrit_le
      from fabrique.travail_faits f
     where f.travail_id = t.id
     order by f.ordre desc
     limit 1
  ) d on true
  left join lateral (
    select count(*) filter (where f.nature = 'pris') as tentatives
      from fabrique.travail_faits f
     where f.travail_id = t.id
  ) c on true
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

comment on view fabrique.etat_des_travaux_v is
  'Ou en est chaque travail, d''apres ses faits : a_faire, en_cours, '
  'abandonne, en_panne, epuise, termine, refuse, en_erreur. C''est ce que '
  'l''ecran lit pour dire ou en est une piece au lieu de se taire. Une borne '
  'absente du referentiel rend « prenable » faux — elle refuse, elle ne '
  'devine pas ; la fonction de prise, elle, leve et le dit. Le dernier fait '
  'et les prises se lisent par travail (jointures laterales, index '
  'travail_id/ordre) : filtrer par piece ou organisation ne relit pas tout.';

commit;
