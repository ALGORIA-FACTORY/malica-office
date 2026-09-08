-- =====================================================================================
--  Malica Office — Un encaissement ne dépasse pas le reste dû.
--
--  POURQUOI : `honoraires_encaisser` acceptait n'importe quel montant. Un
--  encaissement nul tombait sur la contrainte de la table — un message interne,
--  masqué à l'écran — et un encaissement supérieur au reste dû passait en
--  silence : la facture était « réglée » avec un trop-perçu que rien ne
--  portait. Malica ne devine pas un avoir ni un acompte sur la facture
--  suivante : elle refuse, et dit pourquoi.
--
--  Au passage, la somme encaissée rendue à l'appelant voyage en texte, comme
--  tout montant : un nombre JSON deviendrait un flottant.
--
--  Idempotent : `create or replace`.
-- =====================================================================================

create or replace function public.honoraires_encaisser(
  p_facture uuid, p_montant numeric, p_date date, p_moyen text, p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f       record;
  v_id    uuid;
  v_deja  numeric(18,3);
  v_reste numeric(18,3);
  v_somme numeric(18,3);
begin
  select * into f from collab.factures_honoraires where id = p_facture;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'facture introuvable ou non autorisée' using errcode = 'P0002';
  end if;
  if f.statut <> 'emise' then
    raise exception 'seule une facture émise et non soldée s''encaisse' using errcode = '22023';
  end if;
  if f.total_ttc <= 0 then
    raise exception 'un avoir ne s''encaisse pas' using errcode = '22023';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'un encaissement porte un montant positif' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'la date de l''encaissement est requise' using errcode = '22023';
  end if;

  select coalesce(sum(montant), 0) into v_deja
    from collab.encaissements_honoraires where facture_id = p_facture;
  v_reste := f.total_ttc - v_deja;
  if p_montant > v_reste then
    raise exception 'l''encaissement (%) dépasse le reste dû (%) : un trop-perçu ne se pose pas sur cette facture',
      p_montant, v_reste
      using errcode = '22023';
  end if;

  insert into collab.encaissements_honoraires (tenant_id, facture_id, montant, encaisse_le, moyen, reference)
  values (f.tenant_id, p_facture, p_montant, p_date, p_moyen, nullif(btrim(p_reference), ''))
  returning id into v_id;

  v_somme := v_deja + p_montant;

  if v_somme >= f.total_ttc then
    perform set_config('malica.honoraires_transition', p_facture::text, true);
    update collab.factures_honoraires set statut = 'payee', payee_le = p_date where id = p_facture;
    perform set_config('malica.honoraires_transition', '', true);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.encaissement', 'collab', 'encaissements_honoraires', v_id,
          jsonb_build_object('facture', p_facture, 'numero', f.numero, 'montant', p_montant::text,
                             'date', p_date, 'moyen', p_moyen, 'soldee', v_somme >= f.total_ttc));
  -- Le montant voyage en texte : un nombre JSON deviendrait un flottant.
  return jsonb_build_object('id', v_id, 'encaisse', v_somme::text, 'soldee', v_somme >= f.total_ttc);
end;
$$;
revoke all on function public.honoraires_encaisser(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.honoraires_encaisser(uuid, numeric, date, text, text) to authenticated;
