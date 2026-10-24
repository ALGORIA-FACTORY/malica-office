-- L'équilibre ne suffit pas : les comptes doivent appartenir au plan du
-- pack ou avoir été ouverts dans le dossier / cabinet mandaté. Sous RLS.
begin;
create or replace function app.ecriture_inscrite_dans_son_plan()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
 v_debit numeric;
 v_credit numeric;
 v_manquant text;
begin
 if new.status <> 'booked' then return null; end if;
 if tg_op = 'UPDATE' then
   if old.status = 'booked' then return null; end if;
 end if;
 select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_debit, v_credit
   from socle.ecriture_lignes where ecriture_id = new.id;
 if v_debit = 0 or v_debit <> v_credit then
   raise exception 'Une écriture inscrite exige des lignes non nulles et équilibrées.' using errcode = '22023';
 end if;
 -- Une correction exacte peut annuler une écriture historique dont un
 -- compte a depuis été retiré du plan ; elle ne réécrit jamais l'original.
 if new.reverses_id is not null and exists (
   select 1 from socle.ecritures o where o.id = new.reverses_id
     and o.tenant_id = new.tenant_id and o.status = 'booked' and o.devise = new.devise
 ) and not exists (
   (select ordinal, account_code, debit, credit from socle.ecriture_lignes where ecriture_id = new.id
    except select ordinal, account_code, credit, debit from socle.ecriture_lignes where ecriture_id = new.reverses_id)
   union all
   (select ordinal, account_code, credit, debit from socle.ecriture_lignes where ecriture_id = new.reverses_id
    except select ordinal, account_code, debit, credit from socle.ecriture_lignes where ecriture_id = new.id)
 ) then return null; end if;
 select l.account_code into v_manquant
   from socle.ecriture_lignes l
  where l.ecriture_id = new.id
    and not exists (select 1 from ref.accounts a
      where a.pack_version_id = new.pack_version_id and a.account_code = l.account_code)
    and not exists (select 1 from parametrage.accounts a where a.account_code = l.account_code
      and (a.tenant_id = new.tenant_id or a.tenant_id in (
        select e.cabinet_org_id from identity.engagements e
         where e.pme_org_id = new.tenant_id and e.status = 'actif')))
  order by l.ordinal limit 1;
 if v_manquant is not null then
   raise exception 'Compte absent du plan du dossier : %.', v_manquant using errcode = '22023';
 end if;
 return null;
end $$;
revoke all on function app.ecriture_inscrite_dans_son_plan() from public, anon, authenticated;
drop trigger if exists ecriture_inscrite_dans_son_plan on socle.ecritures;
create constraint trigger ecriture_inscrite_dans_son_plan
 after insert or update on socle.ecritures deferrable initially deferred
 for each row execute function app.ecriture_inscrite_dans_son_plan();
commit;
