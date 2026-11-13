-- ======================================================================
--  Une pièce reçue qui n'aboutit pas à une proposition se voit (G1, recette
--  du 13 novembre 2026).
--
--  Le 13 novembre, depuis 9 h 30 environ, aucune pièce reçue sur le staging
--  n'avait d'écriture proposée, et RIEN ne l'avait dit : la proposition se
--  calcule à la demande à partir de l'analyse de la lecture, la lecture passe
--  par la file durable (`fabrique.travaux`, nature `lecture_piece`), et
--  `/sante/profonde` ne contrôle que la base et le stockage. Une file qui ne
--  se vide plus (second lecteur injoignable, travaux abandonnés, forfait
--  refusé) n'avait aucune alarme.
--
--  Cette migration ajoute, sans second mécanisme :
--
--    * le seuil d'attente, en base, daté, dans la même couche que les bornes
--      du travail (`ref.socle_params`, `fabrique.seuil.travail.*`, surchargeable
--      par cabinet dans `parametrage.fabrique_seuils` — R10) ;
--    * `plateforme.lectures_en_souffrance_v`, sur le modèle de
--      `plateforme.relectures_de_nuit_v` : lue par la tour, réservée aux
--      opérateurs, `security_invoker`.
--
--  La vue ne lit QUE la file (état dérivé du dernier fait, motif) : jamais une
--  pièce, jamais une extraction — la plateforme n'y a pas droit sans
--  réquisition approuvée. Elle compte, par dossier, état et motif, les pièces
--  dont le DERNIER travail de lecture n'est pas terminé alors qu'il est
--  demandé depuis plus que le seuil.
--
--  Valeur de départ INCERTAINE : 10 minutes. Le p95 « photo → proposition »
--  visé est de 120 s (`docs/pilote/revue-go-no-go.md`) et l'abandon d'une prise
--  de 900 s ; 10 minutes laisse la marge d'une file chargée sans laisser une
--  pièce muette une heure. À revoir sur des mesures de staging.
--
--  REJEU (R11) : `valid_from` est un littéral, aucune horloge n'écrit dans `ref`.
-- ======================================================================

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, 'fabrique.seuil.travail.proposition_attente_min', 10,
       'Politique de supervision ALGORIA', date '2026-11-13'
  from ref.jurisdiction_packs p
 where p.effective_from <= date '2026-11-13'
   and (p.effective_to is null or p.effective_to >= date '2026-11-13')
on conflict do nothing;

/*
 * Les lectures en souffrance, par dossier, état et motif.
 *
 * `etat` suit `fabrique.etat_des_travaux_v` : a_faire (jamais prise),
 * en_cours (prise, encore fraîche), abandonne (le preneur est réputé mort),
 * en_panne (échec technique, un repli attend), epuise (tentatives épuisées),
 * en_erreur, refuse. Seul le DERNIER travail de chaque pièce compte : une
 * relecture réussie après un échec ne laisse pas d'alarme derrière elle.
 *
 * `alerte` est faux pour `refuse` : c'est le refus de la base (forfait,
 * abonnement suspendu, pièce remplacée), un état métier que l'écran du client
 * dit déjà. Il reste visible, avec son motif, parce que c'est l'une des trois
 * causes d'une pièce sans proposition.
 *
 * Le seuil est celui du pack en vigueur, et celui qu'un cabinet a arrêté pour
 * son dossier l'emporte. Sans seuil au référentiel, la vue ne rend rien : elle
 * ne devine pas (R4) — le test de la base le dit.
 */
create view plateforme.lectures_en_souffrance_v with (security_invoker = true) as
with livre as (
  select distinct on (s.code) s.code, s.value_num
    from ref.socle_params s
   where s.code = 'fabrique.seuil.travail.proposition_attente_min'
     and s.valid_from <= current_date
     and (s.valid_to is null or s.valid_to >= current_date)
   order by s.code, s.valid_from desc
),
derniers as (
  select distinct on (t.piece_id) t.tenant_id, t.piece_id, t.etat, t.dernier_motif, t.demande_le
    from fabrique.etat_des_travaux_v t
   where t.nature = 'lecture_piece'
   order by t.piece_id, t.demande_le desc
)
select d.tenant_id,
       o.name                                           as dossier,
       d.etat,
       d.dernier_motif                                  as motif,
       count(*)::integer                                as pieces,
       min(d.demande_le)                                as plus_ancienne_le,
       floor(extract(epoch from now() - min(d.demande_le)) / 60)::integer
                                                        as plus_ancienne_min,
       max(coalesce(f.value_num, l.value_num))::integer as seuil_min,
       d.etat <> 'refuse'                               as alerte
  from derniers d
  join identity.organizations o on o.id = d.tenant_id
  cross join livre l
  left join parametrage.fabrique_seuils f
    on f.tenant_id = d.tenant_id and f.code = l.code
 where d.etat <> 'termine'
   and d.demande_le < now() - make_interval(mins => coalesce(f.value_num, l.value_num)::integer)
   and (select app.is_platform())
 group by d.tenant_id, o.name, d.etat, d.dernier_motif;

revoke all on plateforme.lectures_en_souffrance_v from public, anon;
grant select on plateforme.lectures_en_souffrance_v to authenticated;

comment on view plateforme.lectures_en_souffrance_v is
  'Les pièces dont la dernière lecture n''est pas terminée depuis plus que le seuil '
  '(fabrique.seuil.travail.proposition_attente_min, en minutes), par dossier, état et motif : '
  'ce qui empêche leur proposition d''écriture. Lit la file, jamais une pièce. alerte = faux pour '
  'un refus de la base (état métier). Opérateurs seulement.';
