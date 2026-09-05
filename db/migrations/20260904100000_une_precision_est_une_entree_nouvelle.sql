-- ============================================================================
-- Une précision est une entrée nouvelle.
--
-- POURQUOI
--
-- La lecture d'une pièce ne sait pas toujours dans quel sens elle va : une
-- facture MYTEK adressée à « Algoria Factory », dans le dossier d'ATLAS, n'est
-- ni un achat ni une vente qu'on puisse affirmer. Jusqu'ici le modèle
-- devinait — « vente » — et l'écran classait la pièce chez un client qui est
-- en réalité un fournisseur.
--
-- Désormais la lecture répond « je ne sais pas » (document_kind = null), et
-- c'est la personne qui tranche. Sa réponse ne MODIFIE pas l'extraction —
-- R7, `capture.extractions` est immuable — elle s'ajoute : une ligne dans
-- `capture.precisions`, datée, signée, et la dernière fait foi. La lecture
-- reste ce qu'elle était ; la décision est à côté, lisible, auditée.
--
-- Le même mécanisme servira à toute autre question que la lecture posera
-- (`champ` est libre) sans nouvelle table.
-- ============================================================================

create table capture.precisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  piece_id    uuid not null references capture.pieces(id) on delete cascade,
  champ       text not null check (length(btrim(champ)) > 0),
  valeur      text not null check (length(btrim(valeur)) > 0),
  decided_by  uuid not null default auth.uid(),
  decided_at  timestamptz not null default now()
);
create index precisions_piece_idx on capture.precisions (piece_id, champ, decided_at desc);
-- Toute lecture passe par la politique de tenant : l''index qui la sert mène
-- par tenant_id, comme sur chaque table du schéma.
create index precisions_tenant_idx on capture.precisions (tenant_id, piece_id);

comment on table capture.precisions is
  'Ce que la personne a précisé sur une pièce quand la lecture ne pouvait pas conclure. Ajout seul ; la dernière ligne par champ fait foi.';

-- Ajout seul, et la cascade d''une pièce non engagée reste possible (R7 à
-- partir de l''engagement).
select app.enable_tenant_rls('capture', 'precisions', false, true);
drop trigger if exists capture_precisions_no_upd on capture.precisions;
create trigger capture_precisions_no_upd
  before delete or update on capture.precisions
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

create or replace view public.precisions_v with (security_invoker = true) as
select id, tenant_id, piece_id, champ, valeur, decided_by, decided_at
from capture.precisions;
grant select on public.precisions_v to authenticated;

-- ----------------------------------------------------------------------------
-- Poser une précision. Le champ et sa valeur sont contraints ici, pas par
-- l''écran : un sens de facture ne peut être que « facture_achat » ou
-- « facture_vente ». Une pièce déjà engagée ne se précise plus — elle se
-- corrige par écriture, comme le veut R7.
-- ----------------------------------------------------------------------------
create or replace function public.capture_precision_persist(
  p_piece  uuid,
  p_champ  text,
  p_valeur text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_id uuid;
begin
  select tenant_id, status into v_tenant, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'une piece engagee ne se precise plus : elle se corrige par ecriture'
      using errcode = 'check_violation';
  end if;
  if p_champ = 'document_kind' and p_valeur not in ('facture_achat', 'facture_vente') then
    raise exception 'sens de facture inconnu : %', p_valeur using errcode = 'check_violation';
  end if;
  if p_champ <> 'document_kind' then
    raise exception 'champ non precisable : %', p_champ using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, p_valeur)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur));

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur);
end $$;

revoke all on function public.capture_precision_persist(uuid, text, text) from public, anon;
grant execute on function public.capture_precision_persist(uuid, text, text) to authenticated;
