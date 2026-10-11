-- Le justificatif de paiement arrive parfois APRÈS le paiement.
--
-- ================================================================= POURQUOI
--
-- 10 octobre 2026 : « à l'exception d'espèces les autres on doit prendre une
-- photo et la rattacher à la facture, et qui doit être transmise au comptable
-- avec la photo. » Le 11, `ref.payment_means` dit quels moyens l'exigent et
-- `capture.paiements.justificatif_piece_id` attend la preuve — et aucun chemin
-- ne permettait d'y arriver autrement qu'en photographiant AVANT de payer.
--
-- ================================ POURQUOI UNE TABLE, ET PAS UNE MISE À JOUR
--
-- `capture.paiements` est en ajout seul (R7) : un déclencheur refuse toute
-- mise à jour, et c'est juste — « payé par chèque, 613,493, le 9 octobre » est
-- un fait comptable, et un fait ne se réécrit pas.
--
-- Restaient deux mauvaises réponses :
--
--   — bloquer le paiement jusqu'à la photo. Un écran qui refuse d'avancer se
--     contourne en cochant « espèces », et l'information est perdue au lieu
--     d'être gagnée. C'est la règle que l'écran des paiements s'est donnée le
--     11 octobre, et elle ne se défait pas ici ;
--   — inscrire un SECOND paiement portant la photo. Il doublerait le montant,
--     et la seule chose pire qu'une charge manquante est une charge comptée
--     deux fois.
--
-- D'où un rattachement qui est une écriture nouvelle, dans sa propre table.
-- Le paiement ne bouge pas ; la preuve s'ajoute, datée, et c'est la dernière
-- qui vaut — reprendre une photo floue est le cas normal, pas l'exception.
--
-- ======================================================= UNE SEULE LECTURE
--
-- Deux endroits portent donc une preuve : la colonne, quand la photo précède
-- le paiement et entre dans la même ligne, et cette table quand elle suit.
-- Deux ÉCRITURES, et une seule LECTURE : `paiements_v` rend un champ unique,
-- `justificatif_piece_id`, qui prend le dernier rattachement s'il existe et
-- la colonne sinon. Aucun écran ne choisit, aucun ne peut se tromper.

create table if not exists capture.paiement_justificatifs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  paiement_id  uuid not null references capture.paiements(id) on delete cascade,

  -- La preuve est une PIÈCE à part entière : même capture, même archive, même
  -- chiffrement. Son type porte `porte_ecriture = false` — un document
  -- comptabilisable une seconde fois est la façon la plus simple de compter
  -- une charge deux fois.
  piece_id     uuid not null references capture.pieces(id) on delete cascade,

  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);

comment on table capture.paiement_justificatifs is
  'Les preuves rattachées à un paiement après son inscription. La table existe '
  'parce que `capture.paiements` est en ajout seul : le paiement ne se réécrit '
  'pas, donc la preuve tardive s''AJOUTE. La dernière vaut, et l''historique '
  'garde les précédentes — reprendre une photo floue est le cas normal.';

-- R6 : l'index mène par `tenant_id`, sans quoi chaque lecture parcourt la
-- table entière, tous tenants confondus.
create index if not exists paiement_justificatifs_tenant_paiement_idx
  on capture.paiement_justificatifs (tenant_id, paiement_id, created_at desc);

select app.enable_tenant_rls('capture', 'paiement_justificatifs', false, true);

-- --- La porte -----------------------------------------------------------------------------
--
-- Elle vérifie que les deux pièces appartiennent au même dossier. Sans cela
-- une preuve pourrait pointer hors du dossier, et la RLS du cabinet rendrait
-- un justificatif introuvable sans dire pourquoi.

create or replace function public.paiement_rattacher_justificatif(
  p_paiement uuid, p_piece uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tenant_preuve uuid;
begin
  select tenant_id into v_tenant from capture.paiements where id = p_paiement;
  if v_tenant is null then
    raise exception 'paiement introuvable ou non autorise' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_preuve from capture.pieces where id = p_piece;
  if v_tenant_preuve is null or v_tenant_preuve <> v_tenant then
    raise exception 'justificatif introuvable ou non autorise dans ce dossier'
      using errcode = '42501';
  end if;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id)
  values (v_tenant, p_paiement, p_piece);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_rattache', 'capture', 'paiements',
          p_paiement, jsonb_build_object('piece_id', p_piece));

  return jsonb_build_object('paiement_id', p_paiement, 'piece_id', p_piece);
end
$$;

revoke all on function public.paiement_rattacher_justificatif(uuid, uuid) from public, anon;
grant execute on function public.paiement_rattacher_justificatif(uuid, uuid) to authenticated;

comment on function public.paiement_rattacher_justificatif(uuid, uuid) is
  'Rattache une preuve à un paiement déjà inscrit, par une écriture nouvelle. '
  'Le paiement est en ajout seul et ne se réécrit pas ; refuser la preuve '
  'tardive obligerait soit à bloquer le paiement — donc à faire cocher '
  '« espèces » pour avancer — soit à inscrire un second paiement, qui '
  'doublerait le montant.';

-- --- La lecture, unique ------------------------------------------------------------------
--
-- Corps repris de `20261011100000`, le champ `justificatif_piece_id` en plus
-- du dernier rattachement. L'écran lit un seul champ et ne choisit rien.

create or replace view public.paiements_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.entity_id, p.vis, p.piece_id, p.moyen_code,
         p.pack_version_id, p.montant_mineur, p.devise, p.paye_le,
         coalesce(j.piece_id, p.justificatif_piece_id) as justificatif_piece_id,
         p.created_at
    from capture.paiements p
    left join lateral (
      select pj.piece_id
        from capture.paiement_justificatifs pj
       where pj.paiement_id = p.id
       order by pj.created_at desc, pj.id desc
       limit 1
    ) j on true;

revoke all on table public.paiements_v from public, anon, service_role;
grant select on table public.paiements_v to authenticated;
