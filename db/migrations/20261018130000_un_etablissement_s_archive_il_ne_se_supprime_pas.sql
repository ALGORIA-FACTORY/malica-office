-- Un établissement s'archive, il ne se supprime pas.
--
-- ============================================================= LE DÉFAUT RÉEL
--
-- Dix colonnes `entity_id` pointent vers `identity.entities`, toutes en
-- `ON DELETE SET NULL` : `capture.pieces`, `capture.piece_articles`,
-- `capture.paiements`, `socle.ecritures`, `schedule.echeances`,
-- `billing.invoices`, `immo.assets`, `stocks.items`, `banque.comptes`,
-- `tiers.auxiliaires`.
--
-- Supprimer un établissement est donc aujourd'hui, selon les données
-- présentes, l'une ou l'autre de deux choses — et jamais celle qu'on croit :
--
--   — s'il porte un paiement, le SET NULL est un UPDATE sur une table en
--     ajout seul : `app.deny_mutation()` lève, et la suppression avorte sur
--     un `restrict_violation` technique. Bloqué par accident, par un garde
--     R7, pas par une règle métier qu'on aurait écrite ;
--   — sinon elle réussit, et détruit silencieusement l'affectation
--     analytique de toutes les pièces, écritures, factures, immobilisations,
--     stocks, comptes bancaires et auxiliaires qui s'y rattachaient.
--
-- Aucun test, aucune contrainte, aucun commentaire ne traite ce cas. Et
-- `identity.organizations`, elle, n'a aucune politique DELETE depuis le
-- premier jour : son retrait passe par `archived_at`. L'établissement était
-- resté en dehors de cette règle sans raison.
--
-- ====================================================== POURQUOI L'ARCHIVAGE
--
-- Décision du 18 octobre. Deux raisons, et la seconde est la vraie :
--
--   — R7 : « les tenants de test s'archivent, ils ne se suppriment pas ».
--     Un établissement est du même ordre ;
--   — dix ans de conservation. Une pièce doit pouvoir dire de quel
--     établissement elle venait, en 2036, même si cet établissement a fermé
--     en 2027. Un `entity_id` à NULL ne le dit plus, et rien ne le retrouve.
--
-- L'archivage est aussi le seul retrait réversible : une erreur se défait,
-- un DELETE ne se défait pas.

begin;

-- --- 1. La colonne, et son motif -------------------------------------------
--
-- Mêmes noms que sur `identity.organizations` (`20260826143655`) : deux
-- tables qui s'archivent de deux façons différentes, c'est une de trop.

alter table identity.entities
  add column if not exists archived_at     timestamptz,
  add column if not exists archived_reason text;

comment on column identity.entities.archived_at is
  'Fermé le. La ligne reste : dix ans de conservation l''exigent, et une '
  'pièce de 2026 doit pouvoir dire d''où elle venait en 2036.';

-- --- 2. La porte se ferme ---------------------------------------------------
--
-- `enable_tenant_rls` a posé une politique `entities_del`. On la retire et on
-- révoque le droit : deux verrous, parce qu'un seul se rouvre par distraction
-- le jour où quelqu'un rejoue le helper sur cette table.

drop policy if exists entities_del on identity.entities;
revoke delete on table identity.entities from authenticated;

-- --- 3. L'archivage, et ce qu'il vérifie avant ------------------------------
--
-- Il ne suffit pas de poser une date : un établissement qu'on ferme ne doit
-- pas laisser derrière lui des pièces non transmises que plus aucun écran ne
-- montrera. La fonction les COMPTE et refuse tant qu'il en reste, en disant
-- combien — c'est une liste à traiter, pas une surprise à découvrir.
--
-- Ce qui est déjà comptabilisé, en revanche, ne bloque pas : c'est du passé,
-- il est conservé, et il n'attend plus personne.

create or replace function public.etablissement_archiver(
  p_entity uuid, p_motif text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_defaut   boolean;
  v_en_cours integer;
  v_autres   integer;
begin
  select tenant_id, is_default into v_tenant, v_defaut
    from identity.entities where id = p_entity;
  if v_tenant is null then
    raise exception 'etablissement introuvable' using errcode = 'no_data_found';
  end if;

  if not app.has_org_role(v_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant ferme un etablissement' using errcode = '42501';
  end if;

  -- Le dernier établissement actif ne se ferme pas : une société sans
  -- établissement n'a plus où ranger la pièce suivante.
  select count(*) into v_autres
    from identity.entities
   where tenant_id = v_tenant and id <> p_entity and archived_at is null;
  if v_autres = 0 then
    raise exception 'c''est le dernier etablissement ouvert de cette societe'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_en_cours
    from capture.pieces
   where entity_id = p_entity
     and status in ('capturee', 'lue', 'proposee');
  if v_en_cours > 0 then
    return jsonb_build_object(
      'archive', false,
      'motif', 'pieces_en_cours',
      'pieces', v_en_cours);
  end if;

  update identity.entities
     set archived_at = now(), archived_reason = p_motif, updated_at = now()
   where id = p_entity;

  -- L'établissement par défaut qui ferme passe le relais : sans ça, la
  -- capture suivante n'a plus de destination et `pme.tsx` prend « le premier »,
  -- c'est-à-dire n'importe lequel.
  if v_defaut then
    update identity.entities
       set is_default = true, updated_at = now()
     where id = (select id from identity.entities
                  where tenant_id = v_tenant and archived_at is null
                  order by created_at limit 1);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'etablissement.archive', 'identity', 'entities',
          p_entity, jsonb_build_object('motif', p_motif, 'etait_defaut', v_defaut));

  return jsonb_build_object('archive', true, 'pieces', 0);
end
$$;

revoke all on function public.etablissement_archiver(uuid, text) from public, anon;
grant execute on function public.etablissement_archiver(uuid, text) to authenticated;

-- --- 4. Ce que les écrans voient -------------------------------------------
--
-- Une vue qui ne rend que l'ouvert, sur le modèle de `public.organizations_v`
-- (`20260826143655`). Les écrans la lisent ; la table reste entière pour le
-- journal, l'export et le contrôle.

create or replace view public.entities_v as
select id, tenant_id, code, name, is_default, created_at, updated_at
  from identity.entities
 where archived_at is null;

comment on view public.entities_v is
  'Les établissements ouverts. Un établissement fermé existe toujours — ses '
  'pièces le nomment — il ne s''offre simplement plus au classement.';

commit;
