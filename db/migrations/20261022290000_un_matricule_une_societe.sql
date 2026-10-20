-- Un matricule, une société (20 octobre 2026).
--
-- Recette : rien n'empêchait deux organisations actives de porter le même
-- matricule fiscal. Un second compte pouvait donc créer « la même société »
-- — usurpation d'identité fiscale — et un mandat proposé par matricule
-- partait vers la plus ancienne des deux, sans que personne le sache.
--
-- Règle : dans une juridiction, un matricule n'appartient qu'à UNE
-- organisation non archivée. La seconde création est refusée avec un motif
-- lisible : la société existe, il faut en demander l'accès à son dirigeant.
--
-- Pourquoi un déclencheur et pas un index unique : les bases existantes
-- (staging) portent déjà des doublons de recette ; un index échouerait à sa
-- création et bloquerait le déploiement. Le déclencheur ne juge que ce qui
-- s'écrit désormais. Un verrou consultatif par matricule ferme la course de
-- deux créations simultanées.
--
-- REJEU (R11) : `create or replace`, `drop trigger if exists`.

begin;

create or replace function identity.un_matricule_une_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.legal_id is null or new.archived_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('matricule:' || new.jurisdiction || ':' || upper(new.legal_id)));
  if exists (
    select 1 from identity.organizations o
     where o.jurisdiction = new.jurisdiction
       and upper(o.legal_id) = upper(new.legal_id)
       and o.archived_at is null
       and o.id <> new.id
  ) then
    raise exception 'Une société porte déjà ce matricule fiscal. Demandez l''accès à son dirigeant.'
      using errcode = '23505', hint = 'organisation.matricule_deja_pris';
  end if;
  return new;
end
$$;

revoke all on function identity.un_matricule_une_societe() from public, anon, authenticated;

drop trigger if exists un_matricule_une_societe on identity.organizations;
create trigger un_matricule_une_societe
  before insert or update of legal_id, jurisdiction, archived_at on identity.organizations
  for each row execute function identity.un_matricule_une_societe();

commit;
