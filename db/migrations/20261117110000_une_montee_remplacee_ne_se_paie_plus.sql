-- Une montée remplacée ne se paie plus (2 novembre 2026, décision de Wissem : « 1 »).
--
-- Chaque montée d'offre prépare un ACOMPTE : la différence du mois, au prorata
-- des jours restants (`paiement_montee_preparer`). Rien ne retirait l'acompte
-- quand le forfait changeait encore avant qu'il soit payé : « À régler »
-- empilait des montées contradictoires — Basic → Premium ET Basic → Team, puis
-- Team → Premium — et invitait à payer des jours qui se recouvraient.
--
-- La règle : un acompte de montée NON PAYÉ qui ne porte plus le forfait en
-- cours est REMPLACÉ. Rien ne se perd : la facture du mois facture les jours
-- réellement passés à chaque offre, et un acompte n'est qu'une avance qu'elle
-- impute (`20261022150000`). Un acompte déjà payé reste payé, et s'impute.
--
-- L'état se DÉDUIT, comme les autres (R7) : aucun événement n'est écrit, et
-- les montées déjà remplacées sur une base existante le sont d'elles-mêmes.
--
-- REJEU (R11) : `create or replace view`, mêmes colonnes, même ordre.

begin;

create or replace view facturation.paiements_en_ligne_v with (security_invoker = true) as
select
  p.id as paiement_id, p.licence_id, p.objet, p.libelle,
  p.montant_ht, p.montant_tva, p.montant_ttc, p.devise, p.cree_le,
  case
    when exists (select 1 from facturation.paiement_evenements e
                  where e.paiement_id = p.id and e.etat = 'paye') then 'paye'
    when p.objet = 'montee'
         and p.forfait_id is distinct from (select c.id from facturation.forfait_courant_v c
                                             where c.licence_id = p.licence_id) then 'remplace'
    else coalesce(d.etat, 'a_payer')
  end as etat,
  d.prestataire, d.reference, d.lien,
  exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) as impute,
  p.payeur_tenant_id
from facturation.paiements_en_ligne p
left join lateral (
  select e.etat, e.prestataire, e.reference, e.lien
    from facturation.paiement_evenements e
   where e.paiement_id = p.id
   order by e.le desc, e.id desc limit 1
) d on true;

comment on view facturation.paiements_en_ligne_v is
  'Les paiements en ligne et leur état DÉDUIT : payé, remplacé (un acompte de '
  'montée non payé dont le forfait n''est plus le forfait en cours, '
  '20261117110000), sinon le dernier événement, sinon à payer.';

commit;
