-- La facture mensuelle d'un cabinet se paie en ligne (23 octobre 2026).
--
-- Suite du lot C (20261023130000), qui n'ouvrait que les factures payées par
-- le titulaire d'une licence. Le cabinet reçoit UNE facture par mois, une
-- ligne par société cliente (20261022400000) : elle n'a pas de licence, et son
-- payeur est le cabinet. Mêmes décisions que le lot C — le reste dû en entier,
-- l'encaissement dès la confirmation, la reprise automatique — et un droit :
-- l'expert ou le dirigeant du cabinet paie (les rôles qui le représentent,
-- comme `app.mandats_visibles`). La reprise vaut pour chaque licence que la
-- facture couvre, si plus aucune facture ne la tient en retard.

-- --- 1. Le registre admet un paiement sans licence, au nom d'un cabinet -------

alter table facturation.paiements_en_ligne
  alter column licence_id drop not null,
  add column payeur_tenant_id uuid references identity.organizations (id),
  add constraint paiements_un_payeur check (
    (licence_id is not null and payeur_tenant_id is null)
    or (objet = 'facture' and payeur_tenant_id is not null));

create index paiements_en_ligne_payeur_idx on facturation.paiements_en_ligne (payeur_tenant_id)
  where payeur_tenant_id is not null;

drop policy paiements_en_ligne_lire on facturation.paiements_en_ligne;
create policy paiements_en_ligne_lire on facturation.paiements_en_ligne
  for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select l.id from facturation.licences l
                            where l.titulaire = (select auth.uid()))
         or payeur_tenant_id in (select app.member_orgs()));

-- Le payeur s'ajoute en fin de vue (la vue garde ses colonnes et leur ordre).
create or replace view facturation.paiements_en_ligne_v with (security_invoker = true) as
select
  p.id as paiement_id, p.licence_id, p.objet, p.libelle,
  p.montant_ht, p.montant_tva, p.montant_ttc, p.devise, p.cree_le,
  case
    when exists (select 1 from facturation.paiement_evenements e
                  where e.paiement_id = p.id and e.etat = 'paye') then 'paye'
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

-- --- 2. Qui paie : une règle ---------------------------------------------------

-- Pour une licence : son titulaire, dirigeant d'une de ses sociétés. Pour un
-- cabinet : son expert ou son dirigeant.
create or replace function facturation.peut_payer(p_licence uuid, p_payeur_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_payeur_tenant is not null then
      app.has_org_role(p_payeur_tenant, array['expert', 'dirigeant'])
    when p_licence is not null then
      exists (select 1 from facturation.licence_organisations lo
               where lo.licence_id = p_licence
                 and app.has_org_role(lo.tenant_id, array['dirigeant']))
      and facturation.titulaire_de(p_licence)
    else false
  end
$$;

revoke all on function facturation.peut_payer(uuid, uuid) from public, anon, authenticated;

-- Le reste dû d'une facture que l'appelant peut payer en ligne.
create or replace function facturation.reste_du_payable(p_facture uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select f.payeur_type, f.licence_id, f.payeur_tenant_id, e.etat, e.reste_du into v
    from facturation.factures f
    join facturation.encours_v e on e.facture_id = f.id
   where f.id = p_facture;
  if not found
     or not facturation.peut_payer(
          case when v.payeur_type = 'titulaire' then v.licence_id end,
          case when v.payeur_type = 'cabinet' then v.payeur_tenant_id end) then
    raise exception 'facture introuvable' using errcode = '42501';
  end if;
  if v.etat not in ('a_echoir', 'en_retard', 'partielle') or v.reste_du <= 0 then
    raise exception 'paiement.facture_rien_a_regler' using errcode = 'check_violation';
  end if;
  return v.reste_du;
end
$$;

revoke all on function facturation.reste_du_payable(uuid) from public, anon, authenticated;

create or replace function public.paiement_facture_preparer(p_facture uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f      facturation.factures;
  v_du   numeric;
  v_id   uuid;
begin
  -- Une préparation à la fois par facture : deux onglets liraient le même
  -- « aucun paiement ouvert » et en créeraient deux, payables tous les deux.
  perform 1 from facturation.factures where id = p_facture for update;
  v_du := facturation.reste_du_payable(p_facture);
  select * into f from facturation.factures where id = p_facture;

  select v.paiement_id into v_id
    from facturation.paiements_en_ligne p
    join facturation.paiements_en_ligne_v v on v.paiement_id = p.id
   where p.facture_id = p_facture and p.montant_ttc = v_du and v.etat <> 'paye'
   order by p.cree_le desc limit 1;
  if v_id is null then
    insert into facturation.paiements_en_ligne
      (licence_id, payeur_tenant_id, objet, facture_id, libelle, montant_ht, taux_tva,
       montant_tva, montant_ttc, devise, cree_par)
    values
      (case when f.payeur_type = 'titulaire' then f.licence_id end,
       case when f.payeur_type = 'cabinet' then f.payeur_tenant_id end,
       'facture', f.id, f.numero, f.montant_ht, f.taux_tva, f.montant_tva, v_du,
       f.devise, auth.uid())
    returning id into v_id;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$$;

revoke all on function public.paiement_facture_preparer(uuid) from public, anon;
grant execute on function public.paiement_facture_preparer(uuid) to authenticated;

-- --- 3. Inscrire : la même règle de payeur -----------------------------------
--
-- Corps repris de 20261023110000 ; deux changements : le droit se lit par
-- `facturation.peut_payer` (une licence ou un cabinet), et la trace d'audit
-- porte le cabinet payeur quand il n'y a pas de licence.

create or replace function public.paiement_inscrire(
  p_paiement uuid, p_etat text, p_prestataire text,
  p_reference text default null, p_lien text default null, p_detail jsonb default '{}'::jsonb,
  p_moyen text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_presta  facturation.prestataires_paiement;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'paiement introuvable' using errcode = '42501';
  end if;
  select * into v_presta from facturation.prestataires_paiement where code = p_prestataire;
  if not found or not v_presta.ouvre_le_paiement then
    raise exception 'prestataire de paiement inconnu' using errcode = 'check_violation';
  end if;
  -- Un prestataire qui ne fait entrer aucun argent n'est admis que si l'API l'a
  -- déclaré pour la transaction, ce qu'elle ne fait que si la tour l'a ouvert.
  if not v_presta.fait_entrer_argent
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'le simulateur de paiement n''est pas ouvert ici' using errcode = '42501';
  end if;
  -- Le lien se crée pour un moyen choisi, actif, que ce prestataire accepte.
  if p_etat = 'lien_cree' and not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  -- « Payé » ou « refusé » se constate chez le prestataire qui a créé le lien,
  -- et chez lui seul : un simulateur ouvert après coup ne solde pas un
  -- paiement parti chez un prestataire réel (dont le vrai « payé » serait
  -- ensuite refusé par l'index « payé une fois »).
  if p_etat in ('paye', 'refuse') and p_prestataire is distinct from (
       select e.prestataire from facturation.paiement_evenements e
        where e.paiement_id = p_paiement and e.etat = 'lien_cree'
        order by e.le desc, e.id desc limit 1) then
    raise exception 'paiement.prestataire_du_lien' using errcode = 'check_violation';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail, moyen)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb),
          case when p_etat = 'lien_cree' then p_moyen end);

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.recu', 'facturation',
           'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from (select 1) un
      left join lateral (
        select x.tenant_id from facturation.licence_organisations x
         where x.licence_id = v_licence order by x.tenant_id limit 1) lo on true
     where coalesce(v_payeur, lo.tenant_id) is not null;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$$;

revoke all on function public.paiement_inscrire(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.paiement_inscrire(uuid, text, text, text, text, jsonb, text) to authenticated;


-- --- 4. La reprise, pour chaque licence que la facture couvre -----------------

-- Une licence est-elle encore tenue en retard ? Par une facture d'elle, ou par
-- une facture de cabinet dont une ligne la porte.
create or replace function facturation.licence_a_un_retard(p_licence uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from facturation.factures f
      join facturation.encours_v e on e.facture_id = f.id
     where e.reste_du > 0 and e.etat in ('en_retard', 'partielle')
       and f.echeance_le < current_date
       and (f.licence_id = p_licence
            or (f.licence_id is null
                and exists (select 1 from facturation.facture_lignes fl
                             where fl.facture_id = f.id and fl.licence_id = p_licence))))
$$;

revoke all on function facturation.licence_a_un_retard(uuid) from public, anon, authenticated;

create or replace function facturation.une_facture_payee_s_encaisse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p       facturation.paiements_en_ligne;
  v_enc   uuid;
  v_lic   uuid;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  select * into p from facturation.paiements_en_ligne where id = new.paiement_id;
  if p.objet <> 'facture'
     or not exists (select 1 from facturation.prestataires_paiement pp
                     where pp.code = new.prestataire and pp.fait_entrer_argent)
     or exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
    return new;
  end if;

  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
  values (p.facture_id, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
          new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
  returning id into v_enc;
  insert into facturation.paiement_imputations (paiement_id, encaissement_id)
  values (p.id, v_enc);

  -- Les licences que la facture couvre : la sienne, ou celles de ses lignes.
  for v_lic in
    select f.licence_id from facturation.factures f
     where f.id = p.facture_id and f.licence_id is not null
    union
    select fl.licence_id from facturation.facture_lignes fl
     where fl.facture_id = p.facture_id and fl.licence_id is not null
  loop
    if exists (select 1 from facturation.licences l
                where l.id = v_lic and l.statut = 'suspendue' and l.motif_suspension = 'impaye')
       and not facturation.licence_a_un_retard(v_lic) then
      update facturation.licences
         set statut = 'active', suspendue_le = null, motif_suspension = null, updated_at = now()
       where id = v_lic;
      insert into plateforme.interventions (licence_id, acte, motif, valeur_text)
      values (v_lic, 'reprise',
              'Reprise automatique : plus aucune facture en retard après le paiement en ligne',
              p.libelle);
    end if;
  end loop;
  return new;
end
$$;

revoke all on function facturation.une_facture_payee_s_encaisse() from public, anon, authenticated;
