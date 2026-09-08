-- R7 s'applique à partir de l'ENGAGEMENT, pas de la lecture.
--
-- ============================================================== LA DÉCISION
--
-- Le plan de tokens était immuable sans condition : une pièce lue ne pouvait
-- plus jamais être effacée, même si elle n'avait jamais rien servi. Une photo
-- ratée, lue par erreur, restait à vie dans le coffre.
--
-- L'expert-comptable a tranché : la règle protège ce qui a SERVI. Un relevé de
-- pièce jamais classée, jamais proposée, jamais comptabilisée, jamais transmise
-- n'a rien à prouver — il n'a jamais fondé le moindre raisonnement.
--
-- Ce qui NE change pas : dès qu'une pièce est engagée — écriture, proposition,
-- immobilisation, mouvement de stock, fiche fiscale — ou seulement transmise au
-- cabinet, tout redevient immuable. Et les onze autres tables protégées par
-- `app.deny_mutation` ne sont pas touchées.
--
-- ==================================================== POURQUOI PAS UN SIMPLE DRAPEAU
--
-- La première idée était un drapeau de transaction posé par la fonction de
-- suppression et lu par les déclencheurs. Elle ne tient pas : `authenticated`
-- avait le droit de SUPPRIMER une pièce directement. N'importe qui pouvait donc
-- poser le drapeau lui-même, effacer une pièce COMPTABILISÉE, et laisser une
-- écriture sans justificatif — exactement ce que la règle empêche.
--
-- On ferme donc la porte plutôt que d'y mettre un écriteau :
--
--   1. le droit de DELETE est retiré à `authenticated` sur les pièces ;
--   2. la fonction devient `security definer`, et refait elle-même le contrôle
--      d'appartenance que la politique RLS faisait — `app.member_orgs()`, la
--      même expression, à la lettre ;
--   3. elle seule peut poser le drapeau, et elle ne le pose qu'après avoir
--      vérifié que la pièce n'est engagée nulle part.
--
-- Le drapeau est LOCAL À LA TRANSACTION : il ne peut pas survivre à l'appel ni
-- fuir vers une autre requête sur une connexion mutualisée.

-- ---------------------------------------------------------------- le garde
create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Le seul passage autorisé : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE'
     and coalesce(current_setting('malica.piece_effacable', true), '') = old.piece_id::text
  then
    return old;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.deny_mutation_hors_effacement_de_piece() is
  'Immuabilité R7, levée uniquement pour la cascade d''une pièce non engagée.';

-- Les cinq tables qui dépendent d'une pièce. Les onze autres gardent
-- `app.deny_mutation` : rien de ce qui touche aux écritures, aux lettrages, au
-- coffre ou au journal d'audit n'est concerné.
drop trigger if exists capture_token_plan_no_upd on capture.token_plan;
create trigger capture_token_plan_no_upd
  before delete or update on capture.token_plan
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists capture_citations_no_upd on capture.citations;
create trigger capture_citations_no_upd
  before delete or update on capture.citations
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists capture_extractions_no_upd on capture.extractions;
create trigger capture_extractions_no_upd
  before delete or update on capture.extractions
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists capture_conformite_no_upd on capture.conformite;
create trigger capture_conformite_no_upd
  before delete or update on capture.conformite
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists capture_piece_versions_no_upd on capture.piece_versions;
create trigger capture_piece_versions_no_upd
  before delete or update on capture.piece_versions
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- ------------------------------------------------------- la seule porte
revoke delete on capture.pieces from authenticated;
revoke delete on public.pieces_v from authenticated;

create or replace function public.capture_piece_supprimer(p_piece uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vis text;
  v_status text;
  v_tenant uuid;
begin
  select p.vis::text, p.status, p.tenant_id
    into v_vis, v_status, v_tenant
    from capture.pieces p
   where p.id = p_piece;

  if v_vis is null then
    raise exception 'piece introuvable'
      using errcode = 'no_data_found';
  end if;

  -- `security definer` court-circuite la RLS : on refait donc ICI, à la lettre,
  -- le contrôle que faisait la politique `capture_pieces_del`. Sans cette
  -- ligne, la fonction effacerait la pièce de n'importe quel dossier.
  if v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable'
      using errcode = 'no_data_found';
  end if;

  if v_vis <> 'personnel' then
    raise exception 'Cette pièce a été transmise à votre cabinet : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if v_status not in ('capturee', 'lue') then
    raise exception 'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece)
     or exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception 'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- Tous les contrôles sont passés : la pièce n'a servi à rien. On lève
  -- l'immuabilité pour ELLE SEULE, et le temps de cette transaction.
  perform set_config('malica.piece_effacable', p_piece::text, true);
  delete from capture.pieces where id = p_piece;
  perform set_config('malica.piece_effacable', '', true);

  return true;
end;
$$;

comment on function public.capture_piece_supprimer(uuid) is
  'Supprime une pièce non transmise et non engagée, avec son relevé. Refuse sinon.';

revoke all on function public.capture_piece_supprimer(uuid) from public;
grant execute on function public.capture_piece_supprimer(uuid) to authenticated;
