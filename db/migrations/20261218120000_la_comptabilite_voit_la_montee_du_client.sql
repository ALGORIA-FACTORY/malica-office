-- ======================================================================
--  La comptabilité voit la montée faite par le client (recette du
--  11 novembre 2026, point 1.2).
--
--  Un client couvert en Team qui monte en Premium à sa charge : la fiche
--  Client › Abonnement disait « Team · payé par vous » et proposait de
--  « monter » en Premium — l'offre qu'il a déjà. L'écran lit désormais le
--  forfait de la licence (`clients_du_cabinet_etat.forfait_offre`, existant)
--  et dit la montée ; la porte refuse la « montée » vers l'offre du client.
--
--  Repris de sa définition en vigueur (20261208093000) ; seul le refus est neuf.
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

create or replace function public.acces_changer_offre(p_acces uuid, p_offre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        facturation.acces;
  v_grille ref.offres;
  v_regle  ref.offres_par_canal;
  v_id     uuid;
  v_rang_a smallint;
  v_rang_o smallint;
  v_forfait text;
  v_nom    text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  v_regle := ref.canal_offre_a('cabinet', v_grille.code, current_date);
  if v_regle.canal is null or not v_regle.cabinet_peut_ouvrir then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_par_un_cabinet', 'offre', v_grille.code)
      using errcode = 'check_violation';
  end if;
  if v_grille.code = v.offre_code then
    return jsonb_build_object('acces_id', v.id, 'effet', 'inchange');
  end if;
  v_nom := (select name from identity.organizations where id = v.cabinet_tenant_id);

  -- Le dirigeant n'a pas encore rejoint (A2) : la proposition change, rien ne se facture.
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'changement_offre', licence_id = null
     where id = v.id;
    insert into facturation.acces
      (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
       propose_le, propose_par)
    values
      (v.tenant_id, 'cabinet', v.cabinet_tenant_id, v_grille.code, v_grille.effective_from,
       'propose', current_date, auth.uid())
    returning id into v_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.cabinet_tenant_id, auth.uid(), 'acces.offre_changee', 'facturation', 'acces', v_id,
            jsonb_build_object('client', v.tenant_id, 'avant', v.offre_code, 'offre', v_grille.code));
    return jsonb_build_object('acces_id', v_id, 'effet', 'proposition');
  end if;

  v_rang_a := (ref.offre_a(v.offre_code, current_date)).rang;
  v_rang_o := v_grille.rang;

  -- Le client est monté à sa charge au-dessus de ce que la comptabilité paie :
  -- elle ne « monte » pas vers l'offre qu'il a déjà (recette du 11 novembre, 1.2).
  select f.offre_code into v_forfait
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  if v_grille.code = v_forfait and v_rang_o > v_rang_a then
    raise exception 'refus.abonnement.deja_l_offre_du_client' using errcode = 'check_violation';
  end if;

  if v_rang_o > v_rang_a then
    -- Montée : sur-le-champ, le dirigeant est prévenu.
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where tenant_id = v.tenant_id and statut = 'propose';
    v_id := facturation.acces_relayer(v.id, v_grille.code);
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_rang_o > coalesce((ref.offre_a(v_forfait, current_date)).rang, 0) then
      perform facturation.forfait_poser(v.licence_id, v_grille.code, current_date);
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'acces.monte', 'facturation', 'acces', v_id,
            jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                               'offre', v_grille.code));
    insert into collab.notifications (tenant_id, kind, payload)
    values (v.tenant_id, 'acces.monte',
            jsonb_build_object('acces_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
    return jsonb_build_object('acces_id', v_id, 'effet', 'immediat');
  end if;

  -- Descente : elle attend l'accord du dirigeant. Elle doit tenir dans ce
  -- que la société utilise déjà (sociétés, places), si le forfait la suit.
  select f.offre_code into v_forfait
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  if v_forfait = v.offre_code then
    perform facturation.descente_possible(v.licence_id, v_grille.code);
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  insert into facturation.acces_descentes (acces_id, tenant_id, offre_code, propose_par)
  values (v.id, v.tenant_id, v_grille.code, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.descente_demandee', 'facturation', 'acces_descentes', v_id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                             'offre', v_grille.code));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.tenant_id, 'acces.descente_demandee',
          jsonb_build_object('descente_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
  return jsonb_build_object('acces_id', v.id, 'descente_id', v_id, 'effet', 'accord_attendu');
end
$function$;
