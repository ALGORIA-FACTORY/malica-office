-- Le sens d'une pièce se tranche au cabinet, jamais chez la PME.
--
-- Décision du dirigeant, 29 octobre 2026 : quand le sens d'une pièce (achat
-- ou vente) est incertain ou contredit par la lecture, c'est le COMPTABLE qui
-- décide. La PME ne confirme rien (« Malica sans blocage », lot 5 : elle
-- envoie, c'est tout). Jusqu'ici l'écran de la PME lui demandait encore
-- « Oui, c'est bien une vente de ma société », et sa réponse levait le
-- contrôle `sens_de_la_piece` à la place du cabinet.
--
-- Ce que ce fichier pose :
--   1. `capture_precision_persist` : dans un dossier dont le cabinet tient les
--      livres (`app.livres_tenus_par_le_cabinet`), la PME ne précise plus un
--      type qui porte une écriture — c'est-à-dire un sens, achat ou vente —
--      et ne défait pas un sens déjà établi. Elle range toujours une pièce
--      dans un dossier sans écriture (un ticket, un relevé). Le cabinet qui
--      supervise le dossier passe par `piece_type_etabli_par_le_cabinet`
--      (lot 5), qui trace la précision à son nom. Le dossier autonome et le
--      dossier sans cabinet gardent la main : personne d'autre ne tient leurs
--      livres.
--   2. Le jugement d'une pièce (`capture.analyses`) peut être posé par celui
--      qui supervise le dossier : le sens établi, le Socle rejuge la pièce et
--      propose l'écriture. Une politique EN PLUS, sous un nom que le helper
--      `app.enable_tenant_rls` ne connaît pas (un rejeu ne l'efface pas) ;
--      PostgreSQL applique les politiques d'insertion en OU, celle du membre
--      vaut toujours mot pour mot.

begin;

-- --- 1. La PME ne tranche plus le sens dans un dossier tenu par le cabinet -------------------------
--
-- Corps repris de `20261023170000`. Seule s'ajoute la garde du sens, après
-- la vérification du type proposé.

create or replace function public.capture_precision_persist(
  p_piece  uuid,
  p_champ  text,
  p_valeur text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_avant  text;
  v_statut text;
  v_id uuid;
  v_date date;
begin
  select tenant_id, status, document_kind, document_kind_statut
    into v_tenant, v_status, v_avant, v_statut
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'une piece engagee ne se precise plus : elle se corrige par ecriture'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après : une seule liste.
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur and d.propose_a_la_capture) then
      raise exception 'type de piece non propose : %', p_valeur using errcode = 'check_violation';
    end if;
    -- Le sens (un type qui porte une écriture) est l'acte du cabinet quand il
    -- tient les livres : la PME ne le pose pas, et ne défait pas celui qu'une
    -- personne a établi.
    if app.livres_tenus_par_le_cabinet(v_tenant)
       and not app.supervise_le_dossier(v_tenant)
       and (exists (select 1 from ref.document_types d
                     where d.code = p_valeur and d.porte_ecriture)
            or (v_statut = 'confirme'
                and exists (select 1 from ref.document_types d
                             where d.code = v_avant and d.porte_ecriture))) then
      raise exception 'refus.sens.reserve_au_cabinet'
        using errcode = '42501', hint = 'sens.cabinet';
    end if;
  elsif p_champ = 'document_date' then
    -- Une date qui n'est pas une date lève ici, et non trois écrans plus loin.
    begin
      v_date := p_valeur::date;
    exception when others then
      raise exception 'date illisible : %', p_valeur using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception 'une date a venir ne se precise pas : %', p_valeur
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'champ non precisable : %', p_champ using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, p_valeur)
  returning id into v_id;

  -- La personne a tranché : la pièce porte le type, confirmé, et c'est ce que
  -- le verrou R2 attend avant toute écriture. Une date précisée ne touche pas
  -- au type.
  if p_champ = 'document_kind' then
    update capture.pieces
       set document_kind = p_valeur,
           document_kind_statut = 'confirme',
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur)
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', p_valeur);
end
$$;
revoke all on function public.capture_precision_persist(uuid, text, text) from public, anon;
grant execute on function public.capture_precision_persist(uuid, text, text) to authenticated;

comment on function public.capture_precision_persist(uuid, text, text) is
  'Ce que la personne tranche ou corrige : le type de la pièce (parmi ceux que '
  'le référentiel propose au choix) et sa date. Une entrée NOUVELLE à côté de '
  'l''extraction, qui reste immuable (R7). Une pièce engagée ne se précise plus. '
  'Dans un dossier tenu par un cabinet, le sens (un type qui porte une écriture) '
  'ne se précise que par le cabinet (`piece_type_etabli_par_le_cabinet`).';

-- --- 2. Celui qui supervise le dossier rejuge la pièce ---------------------------------------------

drop policy if exists capture_analyses_ins_superviseur on capture.analyses;
create policy capture_analyses_ins_superviseur on capture.analyses
  for insert to authenticated
  with check (app.supervise_le_dossier(tenant_id));

comment on policy capture_analyses_ins_superviseur on capture.analyses is
  'Le cabinet qui supervise le dossier (expert, ou collaborateur affecté) pose '
  'le jugement d''une pièce dont il vient d''établir le sens. Le membre du '
  'dossier garde sa politique, `capture_analyses_ins`.';

commit;
