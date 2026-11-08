-- ======================================================================
--  Les deux portes ont leurs types (planche 3, approuvée le 7 novembre 2026).
--
--  « Deux grandes portes, Achats et Ventes ; le type précis se choisit
--  ensuite. » À la photo, rien ne change : un toucher sur une porte, le type
--  par défaut de son dossier (`propose_a_la_capture`, exactement un par
--  dossier). En correction, une porte ouvre ses types précis : facture,
--  avoir, bon de livraison, note de frais.
--
--  Jusqu'ici la correction n'acceptait que les types proposés à la photo
--  (`refus.precision.type_non_propose`) : choisir « avoir » était refusé.
--  Une colonne de plus dit ce qui se choisit EN CORRECTION ; la règle reste
--  dans la table, pas dans le code. Le reste de la porte est inchangé : une
--  pièce engagée ne se précise plus, et le sens reste l'acte du cabinet quand
--  il tient les livres.
-- ======================================================================

begin;

alter table ref.document_types
  add column if not exists propose_en_correction boolean not null default false;

comment on column ref.document_types.propose_en_correction is
  'Se choisit en corrigeant le type d''une pièce, derrière la porte Achats ou Ventes (planche 3), en plus des types proposés à la photo.';

update ref.document_types
   set propose_en_correction = true
 where code in ('facture_achat', 'facture_vente', 'avoir', 'bon_livraison', 'note_frais');

CREATE OR REPLACE FUNCTION public.capture_precision_persist(p_piece uuid, p_champ text, p_valeur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_status text;
  v_avant  text;
  v_statut text;
  v_id uuid;
  v_date date;
  v_nom  text;
  v_lu   text;
begin
  select tenant_id, status, document_kind, document_kind_statut
    into v_tenant, v_status, v_avant, v_statut
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'refus.precision.engagee'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après, et derrière les
    -- deux portes, les types précis (planche 3).
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur
                      and (d.propose_a_la_capture or d.propose_en_correction)) then
      raise exception '%', app.refus_avec_valeurs('refus.precision.type_non_propose', 'type', (p_valeur)::text) using errcode = 'check_violation';
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
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_illisible', 'date', (p_valeur)::text) using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_a_venir', 'date', (p_valeur)::text)
        using errcode = 'check_violation';
    end if;
  elsif p_champ = 'issuer' then
    -- Le nom de l'émetteur, tel que la personne le lit sur sa pièce : le
    -- logo lu « MITEK » quand la facture imprime « MyTek ». Les blancs se
    -- resserrent ; un nom vide n'est pas un nom.
    v_nom := btrim(regexp_replace(coalesce(p_valeur, ''), '\s+', ' ', 'g'));
    if v_nom = '' then
      raise exception 'refus.precision.nom_vide' using errcode = 'check_violation';
    end if;
    -- Borne technique d'une saisie (pas une règle métier) : un nom de société
    -- tient sur une ligne de journal.
    if length(v_nom) > 200 then
      raise exception '%', app.refus_avec_valeurs('refus.precision.nom_trop_long', 'max', '200')
        using errcode = 'check_violation';
    end if;
    -- Ce qui était retenu avant : la dernière correction, sinon la lecture.
    v_lu := coalesce(app.emetteur_dit(p_piece),
                     (select x.payload ->> 'issuer' from capture.extractions x
                       where x.piece_id = p_piece order by x.created_at desc limit 1));
    if v_lu is not distinct from v_nom then
      -- Redire le même nom n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  else
    raise exception '%', app.refus_avec_valeurs('refus.precision.champ', 'champ', (p_champ)::text) using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, coalesce(v_nom, p_valeur))
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
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ,
                             'valeur', coalesce(v_nom, p_valeur))
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant)
                  when p_champ = 'issuer'
                  then jsonb_build_object('avant', v_lu) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', coalesce(v_nom, p_valeur));
end
$function$;

comment on function public.capture_precision_persist(uuid, text, text) is
  'Ce que la personne tranche ou corrige : le type de la pièce (parmi ceux que '
  'le référentiel propose au choix ou en correction), sa date et le nom de son émetteur. Une '
  'entrée NOUVELLE à côté de l''extraction, qui reste immuable (R7). Une pièce '
  'engagée ne se précise plus. Dans un dossier tenu par un cabinet, le sens (un '
  'type qui porte une écriture) ne se précise que par le cabinet '
  '(`piece_type_etabli_par_le_cabinet`).';


commit;
