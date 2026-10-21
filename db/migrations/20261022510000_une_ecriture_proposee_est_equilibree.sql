-- Une écriture proposée est déjà équilibrée (21 octobre 2026).
--
-- Re-test de la campagne de validation : `office.propose` acceptait des
-- lignes déséquilibrées. La comptabilisation les refusait (R5, déjà en
-- base) — les livres restaient justes —, mais une proposition fausse restait
-- stockée et s'affichait au cabinet comme « proposée par le Socle ».
--
-- Un déclencheur de contrainte DIFFÉRÉ juge l'écriture une fois toutes ses
-- lignes posées, à la fin de la transaction : débit = crédit, et au moins
-- une ligne non nulle. Il ne touche ni les écritures comptabilisées (R5 les
-- garde déjà) ni les contre-passations, qui recopient une écriture
-- équilibrée.
-- REJEU (R11) : `create or replace`, `drop trigger if exists`.

begin;

create or replace function app.ecriture_proposee_equilibree()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_debit  numeric;
  v_credit numeric;
  v_statut text;
begin
  select e.status into v_statut from socle.ecritures e where e.id = new.ecriture_id;
  if v_statut is distinct from 'proposee' then
    return null;
  end if;
  select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    into v_debit, v_credit
    from socle.ecriture_lignes l where l.ecriture_id = new.ecriture_id;
  if v_debit <> v_credit or v_debit = 0 then
    raise exception 'Écriture déséquilibrée : débit % pour crédit %. Une proposition s''équilibre avant d''être enregistrée.',
      v_debit, v_credit
      using errcode = '22023', hint = 'ecriture.desequilibree';
  end if;
  return null;
end $function$;

drop trigger if exists ecriture_proposee_equilibree on socle.ecriture_lignes;
create constraint trigger ecriture_proposee_equilibree
  after insert or update on socle.ecriture_lignes
  deferrable initially deferred
  for each row execute function app.ecriture_proposee_equilibree();

commit;
