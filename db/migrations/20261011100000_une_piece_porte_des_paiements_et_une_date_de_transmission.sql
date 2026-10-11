-- Une pièce porte DES paiements, et sait quand elle est partie au cabinet.
--
-- ================================================================= DEUX BESOINS
--
-- 1. Le parcours du 10 octobre : après la lecture, le moyen de paiement, sa
--    photo, et le tout transmis au comptable.
--
-- 2. La règle de TVA tranchée le même jour par le commanditaire : « le calcul
--    de TVA dans le dashboard serait imputé à la date de transmission au
--    comptable, car le comptable est censé la déclarer dans le mois courant ».
--
--    Or la transmission n'était pas une DATE : c'était un drapeau,
--    `capture.pieces.vis = 'partage'`. On savait qu'une pièce était partie,
--    jamais quand. Impossible de ranger une TVA au mois de sa transmission.
--
-- ======================================== POURQUOI « DES » PAIEMENTS, ET PAS UNE COLONNE
--
-- Il serait plus simple d'ajouter `moyen_paiement` et `paye_le` à
-- `capture.pieces`. Ce serait faux dès le deuxième mois :
--
--   — un ACOMPTE puis un solde, c'est deux paiements sur une même facture ;
--   — un paiement peut être partiel, et le reste dû ;
--   — une RETENUE À LA SOURCE fait que le montant payé diffère du TTC, sur
--     des honoraires ou un loyer — et l'écart n'est pas une erreur de lecture.
--
-- Une colonne dirait « cette facture a été payée par chèque » ; une table dit
-- « il y a eu un acompte en espèces le 3, puis un chèque le 28 ». La seconde
-- est la réalité, et y passer plus tard coûte une migration pénible sur des
-- données déjà saisies.
--
-- ======================================================================== R7
--
-- Append-only, par déclencheur. Un paiement est un fait : on n'en réécrit pas
-- un, on en inscrit un autre. Une erreur se corrige par un paiement
-- d'annulation, daté, qui laisse l'histoire lisible.

create table if not exists capture.paiements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.organizations(id) on delete cascade,
  entity_id         uuid references identity.entities(id) on delete set null,
  vis               app.vis_t not null default 'personnel',
  piece_id          uuid not null references capture.pieces(id) on delete cascade,

  -- Le code du moyen, pas son libellé : le libellé vit au référentiel et se
  -- traduit, le code ne bouge pas.
  moyen_code        text not null,
  pack_version_id   uuid not null references ref.jurisdiction_packs(id),

  -- Le montant réellement payé, en unité mineure. Il peut différer du TTC :
  -- acompte, solde, ou retenue à la source.
  montant_mineur    bigint,
  devise            text not null,

  -- La date du paiement, déclarée par la personne. Nulle quand le moyen est
  -- « pas encore payé » : il n'y a alors rien à dater.
  paye_le           date,

  -- La photo du talon, du ticket, de la traite ou de l'avis. C'est une PIÈCE
  -- à part entière, de type `justificatif_paiement`, rattachée ici.
  justificatif_piece_id uuid references capture.pieces(id) on delete set null,

  created_at        timestamptz not null default now(),

  -- Un paiement sans date mais avec un montant n'a pas de sens, et
  -- réciproquement : les deux vont ensemble ou aucun des deux.
  constraint paiements_date_et_montant_ensemble
    check ((paye_le is null) = (montant_mineur is null)),
  constraint paiements_montant_non_negatif
    check (montant_mineur is null or montant_mineur >= 0)
);

-- R6 : l'index mène par `tenant_id`, sans quoi chaque lecture parcourt la
-- table entière, tous tenants confondus.
create index if not exists paiements_tenant_piece_idx
  on capture.paiements (tenant_id, piece_id, created_at desc);

select app.enable_tenant_rls('capture', 'paiements', false, true);

create or replace view public.paiements_v with (security_invoker = true) as
  select id, tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
         montant_mineur, devise, paye_le, justificatif_piece_id, created_at
    from capture.paiements;
revoke all on table public.paiements_v from public, anon, service_role;
grant select on table public.paiements_v to authenticated;

-- --- La date de transmission -------------------------------------------------------------------
--
-- Une colonne, pas une table : contrairement aux paiements, une pièce ne part
-- qu'une fois — et si elle est rappelée puis renvoyée, c'est la DERNIÈRE
-- transmission qui décide de la déclaration. L'historique complet reste dans
-- `audit.event_log`, qui inscrit déjà chaque `piece.vis_changed`.

alter table capture.pieces
  add column if not exists transmise_le timestamptz;

comment on column capture.pieces.transmise_le is
  'Quand la pièce est partie au cabinet, pour la dernière fois. Nulle tant '
  'qu''elle est restée chez le dirigeant. C''est elle qui range la TVA : le '
  'cabinet déclare dans le mois où il reçoit, décision du commanditaire du '
  '10 octobre 2026. Le drapeau `vis` dit SI, cette colonne dit QUAND — et '
  'sans le quand, aucune déclaration ne pouvait être rangée.';

-- --- Le drapeau et la date ne divergent plus ---------------------------------------------------
--
-- `piece_definir_visibilite` est la SEULE porte par laquelle `vis` change :
-- la date s'y pose, dans la même transaction. Deux écritures séparées
-- finiraient par diverger, et une pièce partagée sans date de transmission
-- disparaîtrait de toutes les déclarations.
--
-- Corps repris de `20260825223452`. Trois lignes changent, et elles sont
-- marquées.

create or replace function public.piece_definir_visibilite(
  p_piece uuid, p_vis app.vis_t)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_old, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;
  if p_vis = 'personnel'::app.vis_t and v_status in ('comptabilisee','supervisee') then
    raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
  end if;

  -- CHANGÉ : la date part avec le drapeau. `now()` est ici le fait lui-même —
  -- l'instant où la pièce passe au cabinet — et non une date de référentiel ;
  -- R11 ne l'interdit pas, elle interdit les dates du jour dans `ref`.
  -- Un rappel efface la date : une pièce revenue chez le dirigeant n'est
  -- transmise nulle part, et la laisser datée la compterait dans une
  -- déclaration qu'elle n'a pas rejointe.
  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status));

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee',
            jsonb_build_object('piece_id', p_piece));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

-- --- Les pièces déjà parties -------------------------------------------------------------------
--
-- Elles sont partagées depuis un moment, et leur date de transmission est
-- perdue. Deux attitudes possibles, et une seule est honnête :
--
--   — leur donner la date du jour : elles entreraient TOUTES dans la
--     déclaration du mois courant, ce qui est faux et invisible ;
--   — les laisser NULLES, et que les écrans les nomment.
--
-- La seconde. Une pièce partagée sans date de transmission est une pièce dont
-- on ne sait pas dans quelle déclaration elle tombe — c'est un fait, et le
-- cacher derrière une date plausible est exactement la pire forme d'erreur.
--
-- L'audit porte la vérité pour celles qui sont passées par la fonction depuis
-- le 25 août ; la reprendre est un travail à part, qui se fera avec les yeux
-- du comptable et non par une migration muette.
