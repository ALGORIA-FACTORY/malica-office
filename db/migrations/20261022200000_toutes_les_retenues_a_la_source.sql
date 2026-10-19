-- Toutes les retenues à la source qu'un règlement de facture peut porter
-- (demandé le 20 octobre 2026 : « termine toutes les retenues à la source »).
--
-- ================================================================ POURQUOI
--
-- `ref.retenues_au_reglement` (20261022170000) ne rendait que les trois taux
-- de l'article 52-I-g. Un règlement d'honoraires payé à 90 %, un loyer, un
-- paiement d'un ministère qui retient aussi 25 % de la TVA : le moteur n'y
-- voyait qu'un paiement partiel, et laissait au 401 un reliquat que personne
-- ne devait.
--
-- ================================================================ CE QUI EST RENDU
--
-- Chaque taux possible, avec ce qu'il faut au Socle pour le CONSTATER sur le
-- payé (`constaterLaRetenue`) :
--
--   code, taux, libellé ;
--   base    — `ttc` (impôt sur le revenu, art. 52) ou `tva` (art. 19 bis CTVA) ;
--   famille — `ir` ou `tva` : un payeur public retient les deux à la fois ;
--   seuil   — le seuil TTC propre au taux, ou vide sans seuil ;
--   sens    — `achat`, `vente` ou les deux : la TVA retenue par l'État ne
--             joue qu'à la VENTE, puisqu'une PME n'est pas un payeur public ;
--   rang    — l'ordre d'essai : le plus fréquent d'abord.
--
-- Deux codes de même taux et de même base (5 % : loyers d'hôtels, artistes)
-- ne se distinguent pas sur un chèque : le libellé du premier porte la
-- mention « à qualifier », et l'expert tranche.
--
-- Ce qui n'y entre PAS, et pourquoi : salaires, dividendes, jeux, plus-values
-- et cessions d'immeubles ne se règlent pas par une facture d'achat ou de
-- vente ; la TVA retenue sur un non-établi (art. 19-1, 100 %) est une
-- autoliquidation, qui s'écrit à la facture et non au règlement.
--
-- ================================================================ LE COMPTE DE LA TVA RETENUE
--
-- Un rôle nouveau, `TVA_RETENUE_SUBIE` : la TVA qu'un client public a retenue
-- est une créance sur l'État, imputable sur la déclaration suivante. Le pack
-- tunisien le lie à 43668 (« autres taxes sur le chiffre d'affaires »,
-- déductibles) ; la comptabilité le surcharge, comme tout rôle, au cabinet ou
-- au dossier.

begin;

insert into ref.account_roles (code, libelle, famille, classes_admises, resolution, auxiliaire)
values ('TVA_RETENUE_SUBIE', 'TVA retenue à la source par un client public', 'etat', '{4}', 'fixe', null)
on conflict (code) do nothing;

insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre)
select p.id, 'TVA_RETENUE_SUBIE', '43668', null
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, role_code) do nothing;

drop function if exists ref.retenues_au_reglement(text, date);

create function ref.retenues_au_reglement(p_jurisdiction text, p_le date)
returns table (code text, taux numeric, libelle text, seuil numeric,
               base text, famille text, sens text, rang int)
language sql
stable
set search_path = ''
as $$
  with vigueur as (
    select p.code, p.valeur_num, p.libelle
      from ref.fiscal_parameters p
     where p.jurisdiction = p_jurisdiction
       and p.valid_from <= p_le
       and (p.valid_to is null or p.valid_to > p_le)
       and p.confiance = 'confirme'),
  seuil_marches as (select valeur_num from vigueur where code = 'RAS_MARCHES_SEUIL'),
  seuil_tva     as (select valeur_num from vigueur where code = 'rs_tva_publique_seuil'),
  -- Le catalogue des taux qui se règlent sur une facture. Les libellés sont
  -- ceux qu'une écriture affiche ; le taux et le seuil viennent du référentiel.
  catalogue (code, libelle, base, famille, sens, a_seuil, rang) as (values
    ('RAS_MARCHES_ACQUISITIONS',                   'Retenue à la source 1,5 % (acquisitions, art. 52-I-g)',            'ttc', 'ir',  'tous',  'marches', 1),
    ('RAS_MARCHES_TAUX_REDUIT_1',                  'Retenue à la source 1 % (acquisitions, taux réduit)',              'ttc', 'ir',  'tous',  'marches', 2),
    ('RAS_MARCHES_TAUX_REDUIT_05',                 'Retenue à la source 0,5 % (acquisitions, taux réduit)',            'ttc', 'ir',  'tous',  'marches', 3),
    ('RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS', 'Retenue à la source 10 % (honoraires, commissions, loyers, art. 52-I-a)', 'ttc', 'ir', 'tous', null, 4),
    ('RAS_HONORAIRES_REEL',                        'Retenue à la source 3 % (honoraires et loyers, régime réel)',      'ttc', 'ir',  'tous',  null,      5),
    ('RAS_LOYERS_HOTELS',                          'Retenue à la source 5 % (loyers d''hôtels ou artistes — à qualifier)', 'ttc', 'ir', 'tous', null,   6),
    ('RAS_NON_RESIDENTS_GENERAL',                  'Retenue à la source 15 % (non-résidents, art. 52-I-b)',            'ttc', 'ir',  'achat', null,      7),
    ('rs_tva_publique',                            'TVA retenue à la source 25 % (payeur public, art. 19 bis CTVA)',   'tva', 'tva', 'vente', 'tva',     8))
  select c.code, v.valeur_num, c.libelle,
         case c.a_seuil when 'marches' then (select valeur_num from seuil_marches)
                        when 'tva'     then (select valeur_num from seuil_tva)
                        else null end,
         c.base, c.famille, c.sens, c.rang
    from catalogue c
    join vigueur v on v.code = c.code
   where v.valeur_num is not null
   order by c.rang;
$$;

revoke all on function ref.retenues_au_reglement(text, date) from public, anon;
grant execute on function ref.retenues_au_reglement(text, date) to authenticated;

comment on function ref.retenues_au_reglement(text, date) is
  'Les retenues à la source qu''un règlement de facture peut porter, à une date : '
  'impôt (art. 52 CIRPPIS) et TVA retenue par un payeur public (art. 19 bis '
  'CTVA), avec leur base, leur seuil et leur sens. Vide hors référentiel.';

-- ------------------------------------------------- les retenues du mois
--
-- Ce que le dossier a RETENU sur ses fournisseurs (à reverser à l'État le
-- mois suivant, art. 52-IV) et ce que ses clients lui ont retenu (créances sur
-- l'État). Lu dans les écritures elles-mêmes, ligne par ligne, sur les comptes
-- que le paramétrage lie aux trois rôles — le dossier, puis la comptabilité
-- qui le mandate, puis le pack. Une contrepassation vient en moins : le
-- montant est le solde de la ligne dans son sens, jamais une valeur stockée.
--
-- Sous la RLS de l'appelant (`security invoker`) : la PME lit le sien, la
-- comptabilité lit les dossiers qu'elle tient, personne d'autre.
create or replace function public.retenues_du_mois(p_tenant uuid, p_periode date)
returns table (ecriture_id uuid, date_ecriture date, ecriture text, ligne text,
               compte text, sens text, montant numeric, statut text)
language sql
stable
set search_path = ''
as $$
  with roles (role, sens) as (values
    ('RETENUE_SOURCE_OPEREE', 'operee'),
    ('RETENUE_SOURCE_SUBIE',  'subie'),
    ('TVA_RETENUE_SUBIE',     'subie')),
  ecritures as (
    select e.* from socle.ecritures e
     where e.tenant_id = p_tenant
       and e.date_ecriture >= date_trunc('month', p_periode)::date
       and e.date_ecriture < (date_trunc('month', p_periode) + interval '1 month')::date),
  comptes as (
    select distinct e.pack_version_id, ro.sens,
           coalesce(d.account_code, c.account_code, p.account_code) as compte
      from (select distinct pack_version_id from ecritures) e
      cross join roles ro
      left join ref.role_bindings p
        on p.role_code = ro.role and p.pack_version_id = e.pack_version_id
      left join public.parametrage_role_bindings_v d
        on d.role_code = ro.role and d.portee = 'dossier' and d.portee_id = p_tenant
      left join public.parametrage_role_bindings_v c
        on c.role_code = ro.role and c.portee = 'cabinet'
       and c.portee_id in (select g.cabinet_org_id from identity.engagements g
                            where g.pme_org_id = p_tenant and g.status = 'actif'))
  select e.id, e.date_ecriture, e.libelle, l.libelle, l.account_code, k.sens,
         case k.sens when 'operee' then l.credit - l.debit else l.debit - l.credit end,
         e.status
    from ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
    join comptes k on k.pack_version_id = e.pack_version_id and k.compte = l.account_code
   order by k.sens, e.date_ecriture, e.id, l.ordinal
$$;

revoke all on function public.retenues_du_mois(uuid, date) from public, anon;
grant execute on function public.retenues_du_mois(uuid, date) to authenticated;

comment on function public.retenues_du_mois(uuid, date) is
  'Les retenues à la source d''un dossier pour un mois, lues dans ses écritures : '
  'opérées (à reverser) et subies (créances sur l''État), ligne par ligne.';

commit;
