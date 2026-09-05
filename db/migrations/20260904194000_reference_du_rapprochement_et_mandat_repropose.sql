-- =====================================================================================
--  Regalica Office — Une référence qui en est une, et un mandat qu'on peut reproposer.
--
--  POURQUOI, trouvé par les épreuves et le jeu de données :
--    · le rapprochement prenait `max(tax_code)` pour « référence » d'une
--      écriture : un code de taxe n'a jamais été le numéro d'un document, et
--      la « référence exacte » ne pouvait donc jamais être vraie. La référence
--      vient de la lecture de la pièce (numéro de facture relevé), ou de rien ;
--    · un mandat refusé ou terminé ne pouvait plus être proposé : la ligne
--      d'engagement existait et la proposition rendait « déjà ». Un cabinet
--      peut revenir vers une PME ; la proposition renaît, la PME répond.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. La référence d'une écriture, pour le rapprochement --------------------------------
create or replace function public.banque_book_lignes(
  p_tenant uuid,
  p_prefix text,
  p_from date,
  p_to date
) returns table(
  ecriture_id uuid,
  piece_id uuid,
  date_ecriture date,
  journal text,
  libelle text,
  montant numeric,
  reference text,
  lettree boolean
)
language sql
stable
set search_path to ''
as $$
  select e.id, e.piece_id, e.date_ecriture, e.journal, e.libelle,
         sum(l.debit - l.credit) as montant,
         -- La référence relevée sur le document — un numéro de facture d'abord —, ou rien.
         (select r.valeur
            from capture.extractions x
            cross join lateral jsonb_each_text(coalesce(x.payload -> 'references', '{}'::jsonb))
                 as r(cle, valeur)
           where x.piece_id = e.piece_id and x.contract = 'extract.v1'
             and length(btrim(r.valeur)) > 0
           order by x.created_at desc,
                    (r.cle ~* 'invoice|facture|numero|number') desc,
                    r.cle
           limit 1) as reference,
         exists (select 1 from banque.lettrage_etat t
                  where t.ecriture_id = e.id and t.active) as lettree
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
   where e.tenant_id = p_tenant
     and e.status = 'booked'
     and e.date_ecriture between p_from and p_to
     and l.account_code like p_prefix || '%'
   group by e.id, e.piece_id, e.date_ecriture, e.journal, e.libelle
   order by e.date_ecriture, e.id
$$;

-- --- 2. Reproposer un mandat terminé ou refusé --------------------------------------------
create or replace function public.mandat_proposer(p_cabinet uuid, p_legal_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legal text := trim(p_legal_id);
  v_pme uuid;
  v_nom text;
  v_id uuid;
  v_status text;
  v_cabinet text;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul un expert du cabinet peut proposer un mandat.' using errcode = '42501';
  end if;
  if v_legal = '' then
    raise exception 'Indiquez l''identifiant fiscal de la PME.' using errcode = '22023';
  end if;
  select id, name into v_pme, v_nom
    from identity.organizations
   where kind = 'pme' and archived_at is null and legal_id = v_legal
   order by created_at limit 1;
  if v_pme is null then
    raise exception 'Aucune PME ne porte cet identifiant fiscal dans Regalica Office.'
      using errcode = 'P0002';
  end if;

  select id, status into v_id, v_status
    from identity.engagements where pme_org_id = v_pme and cabinet_org_id = p_cabinet;

  -- Un mandat en cours, proposé ou suspendu : rien à reproposer.
  if v_id is not null and v_status <> 'termine' then
    return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                              'status', v_status, 'deja', true);
  end if;

  select name into v_cabinet from identity.organizations where id = p_cabinet;

  if v_id is null then
    insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
    values (v_pme, p_cabinet, 'propose', auth.uid())
    returning id into v_id;
  else
    -- Terminé ou refusé : la proposition renaît, la PME répondra à nouveau.
    update identity.engagements
       set status = 'propose', starts_on = current_date, ends_on = null
     where id = v_id;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('pme_org_id', v_pme));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_pme, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('cabinet_org_id', p_cabinet));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v_pme, 'mandat.propose',
          jsonb_build_object('engagement_id', v_id, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                            'status', 'propose', 'deja', false);
end $$;

revoke all on function public.mandat_proposer(uuid, text) from public, anon;
grant execute on function public.mandat_proposer(uuid, text) to authenticated;
