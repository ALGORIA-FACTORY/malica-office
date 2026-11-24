-- La facture dit à qui elle s'adresse : ses coordonnées viennent du compte du payeur, complètes
-- AVANT de payer.
--
-- Décision du dirigeant (24 novembre 2026) : les coordonnées du payeur (raison sociale, matricule
-- fiscal, adresse) sont reprises de son accès — la société qui paie sa montée, ou la comptabilité
-- qui paie sa facture du mois. La facture les lit dans `identity.organizations` (`factureDetail`).
-- Une facture sans matricule ni adresse n'est pas une facture qu'on remet à un client : la page de
-- paiement les montre, les demande s'il en manque (par les portes d'organisation existantes,
-- `organisation_definir` et `organisation_adresse_poser`), et la base refuse l'acceptation des
-- CGV — donc toute page de carte — tant qu'elles sont incomplètes.
--
--   1. `public.paiement_facture_a(paiement)` : à qui la facture de ce paiement s'adressera, et si
--      c'est complet. Lecture gardée par la règle de paiement (`facturation.peut_payer`).
--   2. `public.paiement_cgv_accepter` : refuse `refus.facturation.coordonnees_incompletes`.
--
-- _Gardé par_ apps/api/src/facturation/la-facture-dit-a-qui-elle-s-adresse.test.ts.

begin;

create function public.paiement_facture_a(p_paiement uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p facturation.paiements_en_ligne;
  o identity.organizations;
begin
  select * into p from facturation.paiements_en_ligne where id = p_paiement;
  if p.id is null or not facturation.peut_payer(p.licence_id, p.payeur_tenant_id) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  -- Le payeur : la comptabilité qui paie, sinon la société de la licence (celle que
  -- `factureDetail` imprime).
  select x.* into o from identity.organizations x
   where x.id = coalesce(p.payeur_tenant_id,
                         (select lo.tenant_id from facturation.licence_organisations lo
                           where lo.licence_id = p.licence_id order by lo.tenant_id limit 1));
  return jsonb_build_object(
    'tenant_id',   o.id,
    'nom',         o.name,
    'matricule',   o.legal_id,
    'adresse',     o.adresse,
    'juridiction', o.jurisdiction,
    'complet',     nullif(btrim(coalesce(o.legal_id, '')), '') is not null
                   and nullif(btrim(coalesce(o.adresse, '')), '') is not null);
end
$$;
revoke all on function public.paiement_facture_a(uuid) from public, anon;
grant execute on function public.paiement_facture_a(uuid) to authenticated;
comment on function public.paiement_facture_a(uuid) is
  'À qui la facture d''un paiement s''adressera (raison sociale, matricule, adresse du payeur) et '
  'si c''est complet. Gardée par facturation.peut_payer. 20261231310000.';

CREATE OR REPLACE FUNCTION public.paiement_cgv_accepter(p_paiement uuid, p_cgv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_cgv     plateforme.conditions_de_vente;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  -- La facture s'adressera au payeur, avec son matricule et son adresse : complets d'abord.
  if not (public.paiement_facture_a(p_paiement) ->> 'complet')::boolean then
    raise exception 'refus.facturation.coordonnees_incompletes' using errcode = 'check_violation';
  end if;
  v_cgv := plateforme.cgv_en_vigueur();
  if v_cgv.id is null or p_cgv is distinct from v_cgv.id then
    raise exception 'refus.cgv.version_perimee' using errcode = 'check_violation';
  end if;
  insert into facturation.acceptations_cgv (paiement_id, cgv_id, acceptees_par)
  values (p_paiement, v_cgv.id, auth.uid())
  on conflict (paiement_id) do nothing;
  return (select jsonb_build_object('paiement_id', a.paiement_id, 'cgv_id', a.cgv_id,
                                    'acceptees_le', a.acceptees_le)
            from facturation.acceptations_cgv a where a.paiement_id = p_paiement);
end
$function$;

commit;
