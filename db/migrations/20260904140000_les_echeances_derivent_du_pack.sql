-- =====================================================================================
--  Regalica Office — Les échéances dérivent du pack.
--
--  POURQUOI : la table schedule.echeances existait, l'écran existait, et rien
--  ne l'alimentait. Le calendrier du cabinet était vide par construction.
--
--  Une échéance n'est pas une saisie : elle se DÉRIVE du référentiel des
--  obligations (ref.fiscal_obligations) et de ce que la fiche fiscale du
--  dossier établit — sa forme juridique et son mode de dépôt, parce que la
--  personne morale qui télédéclare a vingt jours là où la même sur papier en
--  a vingt-huit. Sans ces deux faits, Regalica ne dérive rien et le dit,
--  plutôt que de supposer un délai.
--
--  Seules les obligations PÉRIODIQUES (mensuelles, trimestrielles) à quantième
--  connu sont dérivées ici. Les obligations annuelles et les acomptes se
--  comptent depuis la clôture de l'exercice ; elles viendront avec leur règle.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. La fiche fiscale dit la forme et le mode de dépôt ----------------------------
-- Les deux valeurs possibles reflètent celles du référentiel des obligations ;
-- un CHECK ne peut pas les y lire, il les recopie.
alter table identity.fiches_fiscales
  add column if not exists forme_juridique text,
  add column if not exists mode_depot text;

alter table identity.fiches_fiscales drop constraint if exists fiches_forme_juridique_check;
alter table identity.fiches_fiscales add constraint fiches_forme_juridique_check
  check (forme_juridique is null or forme_juridique in ('physique', 'morale'));

alter table identity.fiches_fiscales drop constraint if exists fiches_mode_depot_check;
alter table identity.fiches_fiscales add constraint fiches_mode_depot_check
  check (mode_depot is null or mode_depot in ('papier', 'electronique'));

comment on column identity.fiches_fiscales.forme_juridique is
  'physique | morale — la forme décide du délai de dépôt. Nul : la fiche ne le sait pas encore.';
comment on column identity.fiches_fiscales.mode_depot is
  'papier | electronique — la télédéclaration RÉDUIT le délai (LF 2024). Nul : inconnu.';

-- --- 2. Le référentiel des obligations se lit ----------------------------------------
alter table ref.fiscal_obligations enable row level security;
alter table ref.fiscal_obligations force row level security;
drop policy if exists fiscal_obligations_sel on ref.fiscal_obligations;
create policy fiscal_obligations_sel on ref.fiscal_obligations
  for select to authenticated using (true);
grant select on ref.fiscal_obligations to authenticated;

-- --- 3. L'échéance sait qui l'a faite ------------------------------------------------
alter table schedule.echeances
  add column if not exists fait_le  date,
  add column if not exists fait_par uuid;

-- La vue porte désormais l'obligation qui fonde chaque échéance : son
-- libellé de référence, sa règle littérale, son texte et son article.
-- Les colonnes nouvelles s'ajoutent EN FIN de liste — une vue remplacée ne
-- réordonne pas ses colonnes.
create or replace view public.echeances_v
with (security_invoker = true) as
select e.id, e.tenant_id, e.entity_id, e.kind, e.label, e.period, e.due_date, e.pack_version_id,
       e.status, e.created_at, e.updated_at,
       e.fait_le, e.fait_par,
       fo.echeance_regle, fo.texte_source, fo.article, fo.periodicite
from schedule.echeances e
join identity.organizations o on o.id = e.tenant_id
left join ref.fiscal_obligations fo
  on fo.jurisdiction = o.jurisdiction
 and fo.code = e.kind
 and fo.valid_from <= e.due_date
 and (fo.valid_to is null or fo.valid_to > e.due_date);

-- Une vue jointe ne s'écrit pas ; l'écriture passe par les fonctions.
revoke insert, update on public.echeances_v from authenticated;

-- --- 4. Dériver ----------------------------------------------------------------------
-- Le cabinet mandaté dérive le calendrier de son client sans en être membre :
-- la fonction porte ses droits et vérifie le mandat elle-même.
create or replace function public.echeances_deriver(
  p_tenant uuid,
  p_jusqua date default (current_date + interval '4 months')::date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_fiche       record;
  v_pack        uuid;
  v_depuis      date := date_trunc('month', current_date)::date;
  v_n           int  := 0;
  v_ob          record;
  v_mois        date;
  v_periode     text;
  v_echeance    date;
begin
  if not (p_tenant in (select app.member_orgs())
          or p_tenant in (select app.engaged_orgs())
          or app.is_platform()) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;

  select jurisdiction into v_juridiction from identity.organizations where id = p_tenant;

  select forme_juridique, mode_depot, regime_imposition
    into v_fiche
    from identity.fiches_fiscales
   where tenant_id = p_tenant and valid_to is null
   order by valid_from desc
   limit 1;
  if not found then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.absente');
  end if;
  if v_fiche.forme_juridique is null or v_fiche.mode_depot is null then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.incomplete');
  end if;

  select id into v_pack
    from ref.jurisdiction_packs
   where jurisdiction = v_juridiction
     and effective_from <= current_date
     and (effective_to is null or effective_to > current_date)
   order by effective_from desc
   limit 1;
  if v_pack is null then
    return jsonb_build_object('generees', 0, 'raison', 'pack.absent');
  end if;

  -- Les obligations périodiques qui s'appliquent à CETTE fiche, et, par
  -- famille (TVA, RS, TCL…), seulement les plus précises : une règle qui
  -- nomme la forme et le mode l'emporte sur la règle générale.
  for v_ob in
    with applicables as (
      select o.code, o.libelle, o.periodicite, o.echeance_jour,
             split_part(o.code, '_', 1) as famille,
             (case when o.forme_juridique is not null then 2 else 0 end
              + case when o.mode_depot is not null then 1 else 0 end
              + case when o.regime is not null then 4 else 0 end) as precision
        from ref.fiscal_obligations o
       where o.jurisdiction = v_juridiction
         and o.periodicite in ('mensuelle', 'trimestrielle')
         and o.echeance_jour is not null
         and o.valid_from <= p_jusqua
         and (o.valid_to is null or o.valid_to > v_depuis)
         and (o.forme_juridique is null or o.forme_juridique = v_fiche.forme_juridique)
         and (o.mode_depot is null or o.mode_depot = v_fiche.mode_depot)
         and (o.regime is null or o.regime = v_fiche.regime_imposition)
    )
    select a.* from applicables a
     where a.precision = (select max(b.precision) from applicables b where b.famille = a.famille)
  loop
    v_mois := v_depuis;
    while v_mois <= p_jusqua loop
      v_echeance := null;
      if v_ob.periodicite = 'mensuelle' then
        -- La période est le mois d'activité ; le dépôt tombe le mois suivant.
        v_periode  := to_char(v_mois - interval '1 month', 'YYYY-MM');
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      elsif extract(month from v_mois)::int % 3 = 1 then
        -- Trimestrielle : le dépôt tombe le mois qui suit le trimestre échu.
        v_periode  := to_char(v_mois - interval '1 month', 'YYYY')
                      || '-T' || extract(quarter from v_mois - interval '1 month')::text;
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      end if;

      if v_echeance is not null and v_echeance between v_depuis and p_jusqua then
        insert into schedule.echeances (tenant_id, kind, label, period, due_date, pack_version_id)
        values (p_tenant, v_ob.code, v_ob.libelle, v_periode, v_echeance, v_pack)
        on conflict (tenant_id, kind, period) do update
          set due_date        = excluded.due_date,
              label           = excluded.label,
              pack_version_id = excluded.pack_version_id
          where schedule.echeances.status <> 'fait';
        v_n := v_n + 1;
      end if;
      v_mois := (v_mois + interval '1 month')::date;
    end loop;
  end loop;

  -- Le retard se constate, il ne se saisit pas.
  update schedule.echeances set status = 'en_retard'
   where tenant_id = p_tenant and status = 'a_venir' and due_date < current_date;
  update schedule.echeances set status = 'a_venir'
   where tenant_id = p_tenant and status = 'en_retard' and due_date >= current_date;

  return jsonb_build_object('generees', v_n, 'raison', null);
end
$$;

revoke all on function public.echeances_deriver(uuid, date) from public, anon;
grant execute on function public.echeances_deriver(uuid, date) to authenticated;

-- --- 5. Marquer ----------------------------------------------------------------------
-- L'expert dit qu'une échéance est faite, ou la rouvre. Le journal le garde.
create or replace function public.echeance_marquer(p_id uuid, p_fait boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        record;
  v_status text;
begin
  select id, tenant_id, due_date, status into v from schedule.echeances where id = p_id;
  if v.id is null
     or not (v.tenant_id in (select app.member_orgs())
             or v.tenant_id in (select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'echeance introuvable ou non autorisee' using errcode = '42501';
  end if;

  v_status := case
    when p_fait then 'fait'
    when v.due_date < current_date then 'en_retard'
    else 'a_venir'
  end;

  update schedule.echeances
     set status   = v_status,
         fait_le  = case when p_fait then current_date else null end,
         fait_par = case when p_fait then auth.uid() else null end
   where id = p_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(),
          case when p_fait then 'echeance.faite' else 'echeance.rouverte' end,
          'schedule', 'echeances', p_id,
          jsonb_build_object('due_date', v.due_date, 'avant', v.status, 'apres', v_status));

  return jsonb_build_object('status', v_status);
end
$$;

revoke all on function public.echeance_marquer(uuid, boolean) from public, anon;
grant execute on function public.echeance_marquer(uuid, boolean) to authenticated;
