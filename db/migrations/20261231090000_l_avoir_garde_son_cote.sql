-- L'avoir garde son côté : achat ou vente, dit par la personne.
--
-- ================================================================== POURQUOI
--
-- Le dirigeant, 21 novembre 2026, sur un avoir de vente : « je n'ai pas pu
-- cliquer Ventes en haut, et lorsque je clique Avoir en bas le bouton en haut
-- revient à l'achat ». Le type « avoir » est le même code des deux côtés
-- (`ref.document_types.dossier_si_vente`) ; choisir « Ventes → Avoir »
-- n'écrivait que le type, le côté restait celui de la lecture — et le
-- jugement prenait le type confirmé (« avoir ») pour le sens.
--
-- Désormais le côté se dit par une précision `sens` (facture_achat |
-- facture_vente), pour un type qui en a besoin. Quand le cabinet tient les
-- livres, la PME PROPOSE (`sens_propose`, « à confirmer ») ; le comptable
-- confirme en redisant le sens (`sens`), et rien ne bloque.
--
-- `app.pieces_de_la_liste` rend les deux : son type de retour change, d'où
-- le `drop` (aucune vue ni fonction n'en dépend ; l'API la lit par colonnes).
--
-- _Gardé par_ apps/api/src/scan/l-avoir-garde-son-cote.test.ts.

begin;

-- --- 1. Le signe d'un type au référentiel -----------------------------------------------------
--
-- Un avoir retranche : « −300,00 » sur la pièce, et deux factures moins leurs deux
-- avoirs font zéro au total du mois (le total additionnait tout : 1 320,000 au lieu
-- de 0). Le signe est un paramètre du référentiel, pas un code dans l'écran.
alter table ref.document_types
  add column signe smallint not null default 1 check (signe in (1, -1));
comment on column ref.document_types.signe is
  'Le signe du montant d''une pièce de ce type dans les totaux : 1 ajoute, -1 retranche (un avoir).';
update ref.document_types set signe = -1 where code = 'avoir';

-- --- 2. Le côté dit, ou proposé ------------------------------------------------------------------

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
  v_champ text := p_champ;
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
       and not app.prepare_le_dossier(v_tenant)
       and (exists (select 1 from ref.document_types d
                     where d.code = p_valeur and d.porte_ecriture)
            or (v_statut = 'confirme'
                and exists (select 1 from ref.document_types d
                             where d.code = v_avant and d.porte_ecriture))) then
      raise exception 'refus.sens.reserve_au_cabinet'
        using errcode = '42501', hint = 'sens.cabinet';
    end if;
  elsif p_champ = 'sens' then
    -- Le côté d'une pièce que son type ne fixe pas (un avoir, un bon de
    -- livraison : `dossier_si_vente`). Toucher « Ventes » puis « Avoir », c'est
    -- dire « un avoir sur vente » : le type seul le perdait, et la pièce
    -- retombait du côté lu (22 novembre 2026).
    if p_valeur not in ('facture_achat', 'facture_vente') then
      raise exception '%', app.refus_avec_valeurs('refus.precision.sens_inconnu', 'sens', (p_valeur)::text)
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from ref.document_types d
                    where d.code = v_avant and d.dossier_si_vente is not null) then
      raise exception 'refus.precision.sens_sans_objet' using errcode = 'check_violation';
    end if;
    -- Quand le cabinet tient les livres, le choix de la PME est une
    -- PROPOSITION : il s'inscrit « à confirmer », le comptable le valide ou le
    -- corrige, et rien ne bloque (décision du dirigeant, 22 novembre 2026).
    if app.livres_tenus_par_le_cabinet(v_tenant) and not app.prepare_le_dossier(v_tenant) then
      -- La PME ne défait pas le côté que le comptable a établi.
      if exists (select 1 from capture.precisions q
                  where q.piece_id = p_piece and q.champ = 'sens') then
        raise exception 'refus.sens.reserve_au_cabinet'
          using errcode = '42501', hint = 'sens.cabinet';
      end if;
      v_champ := 'sens_propose';
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
  elsif app.est_un_champ_de_lecture(p_champ) then
    -- Un montant ou un mot de la facture, tel que la personne le lit sur sa
    -- pièce : la base borne la saisie (devise, décimales), le moteur rejuge.
    v_nom := app.precision_de_lecture(p_piece, p_champ, p_valeur);
    v_lu := app.precision_avant(p_piece, p_champ);
    if app.precision_dite(p_piece, p_champ) is not distinct from v_nom then
      -- Redire la même valeur n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  else
    raise exception '%', app.refus_avec_valeurs('refus.precision.champ', 'champ', (p_champ)::text) using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, v_champ, coalesce(v_nom, p_valeur))
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
          jsonb_build_object('piece_id', p_piece, 'champ', v_champ,
                             'valeur', coalesce(v_nom, p_valeur))
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant)
                  when p_champ = 'issuer' or app.est_un_champ_de_lecture(p_champ)
                  then jsonb_build_object('avant', v_lu) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', v_champ,
                            'valeur', coalesce(v_nom, p_valeur));
end
$function$;


-- --- 3. Le cabinet tranche le côté d'un avoir sans en changer le type ------------------------

CREATE OR REPLACE FUNCTION public.piece_type_etabli_par_le_cabinet(p_piece uuid, p_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_type   text;
  v_statut text;
  v_retenu text;
  v_id     uuid;
begin
  select tenant_id, vis, document_kind, document_kind_statut
    into v_tenant, v_vis, v_type, v_statut
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if not app.prepare_le_dossier(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  /*
   * Un avoir (un type rangé selon le côté) GARDE son type : trancher « vente »,
   * c'est dire son côté, pas en faire une facture de vente (22 novembre 2026).
   * La précision `sens` du cabinet fait foi ; elle confirme ou corrige ce que la
   * PME a proposé (`sens_propose`).
   */
  if p_type in ('facture_achat', 'facture_vente')
     and exists (select 1 from ref.document_types d
                  where d.code = v_type and d.dossier_si_vente is not null) then
    if (select q.valeur from capture.precisions q
         where q.piece_id = p_piece and q.champ = 'sens'
         order by q.decided_at desc limit 1) is not distinct from p_type then
      return jsonb_build_object('piece_id', p_piece, 'type', v_type, 'deja', true);
    end if;
    insert into capture.precisions (tenant_id, piece_id, champ, valeur)
    values (v_tenant, p_piece, 'sens', p_type)
    returning id into v_id;
    update capture.pieces
       set document_kind_statut = 'confirme', updated_at = now()
     where id = p_piece;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
            jsonb_build_object('piece_id', p_piece, 'champ', 'sens', 'valeur', p_type,
                               'type', v_type, 'par_le_cabinet', true));
    return jsonb_build_object('piece_id', p_piece, 'type', v_type, 'deja', false);
  end if;

  v_retenu := coalesce(nullif(btrim(p_type), ''), v_type);
  if v_retenu is null then
    raise exception 'refus.inscription.type_inconnu' using errcode = 'check_violation';
  end if;
  if v_statut = 'confirme' and v_retenu = v_type then
    return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', true);
  end if;
  -- Un type qui ne porte pas d'écriture ne s'établit pas pour en inscrire une.
  if not exists (select 1 from ref.document_types d
                  where d.code = v_retenu and d.porte_ecriture) then
    raise exception 'refus.inscription.type_sans_ecriture' using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, 'document_kind', v_retenu)
  returning id into v_id;

  update capture.pieces
     set document_kind = v_retenu, document_kind_statut = 'confirme', updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', 'document_kind', 'valeur', v_retenu,
                             'avant', v_type, 'par_le_cabinet', true));

  return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', false);
end
$function$;


-- --- 4. La liste rend le côté dit et le côté proposé ---------------------------------------------

drop function app.pieces_de_la_liste(uuid[]);

CREATE FUNCTION app.pieces_de_la_liste(p_tenants uuid[])
 RETURNS TABLE(piece_id uuid, a_une_histoire boolean, a_une_lecture boolean, payload jsonb, precision_kind text, emetteur_dit text, circuit_recoit boolean, circuit_dernier text, circuit_envoyee timestamp with time zone, circuit_vue_le timestamp with time zone, circuit_vue_par text, circuit_retournee timestamp with time zone, circuit_retour_par text, circuit_corrigee timestamp with time zone, circuit_auteur text, circuit_mienne boolean, suivi_envoyee timestamp with time zone, suivi_vue_le timestamp with time zone, suivi_vue_par text, suivi_corrigee timestamp with time zone, suivi_prise_le timestamp with time zone, suivi_prise text, suivi_prise_par text, precision_sens text, sens_propose text)
 LANGUAGE sql
 STABLE SECURITY DEFINER ROWS 5000
 SET search_path TO ''
AS $function$
  with membres as materialized (
    select m as tenant_id from app.member_orgs() m
  ),
  -- Une fois par société : seules celles qui ont au moins une pièce.
  droits as materialized (
    select t.tenant_id,
           t.tenant_id in (select tenant_id from membres) as membre,
           t.tenant_id in (select app.engaged_orgs()) as engage,
           coalesce(t.tenant_id in (select app.orgs_avec_droit('societe.tout_voir')), false)
             as tout_voir,
           coalesce(t.tenant_id in (select app.orgs_avec_droit('circuit.recevoir')), false)
             as recoit,
           app.plateforme_requise(t.tenant_id) as requise,
           t.tenant_id in (select tenant_id from membres)
             and not app.prepare_le_dossier(t.tenant_id) as client
      from (select distinct p.tenant_id from capture.pieces p
             where p.tenant_id = any(p_tenants)) t
  ),
  ayant_une_histoire as materialized (
    select h as id from app.pieces_avec_historique(p_tenants) h
  ),
  -- Celles que la liste montre, ni archivées ni remplacées, et la règle de
  -- `app.piece_lisible` pour celles-là.
  lisibles as materialized (
    select p.id, p.tenant_id, p.vis, p.created_by, p.created_at, p.transmise_le,
           d.membre, d.recoit, d.client,
           p.id in (select id from ayant_une_histoire) as a_une_histoire
      from capture.pieces p
      join droits d on d.tenant_id = p.tenant_id
     where p.tenant_id = any(p_tenants)
       and p.archivee_le is null
       and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
       and ((p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
            or (p.vis in ('entite'::app.vis_t, 'partage'::app.vis_t)
                and (d.tout_voir or (d.membre and p.created_by = auth.uid())))
            or (p.vis = 'partage'::app.vis_t and d.engage)
            or d.requise
            or case when app.dossier_du_service() is null then false
                    else app.piece_lisible(p.id) end)
  ),
  lectures as (
    select distinct on (e.piece_id) e.piece_id, e.payload
      from capture.extractions e
      join lisibles l on l.id = e.piece_id
     where e.contract like 'extract.v1%'
     order by e.piece_id, e.created_at desc
  ),
  precisions_dites as (
    select distinct on (q.piece_id, q.champ) q.piece_id, q.champ, q.valeur
      from capture.precisions q
      join lisibles l on l.id = q.piece_id
     where q.champ in ('document_kind', 'issuer', 'sens', 'sens_propose')
     order by q.piece_id, q.champ, q.decided_at desc
  ),
  cibles as materialized (
    select l.*,
           exists (select 1 from capture.remplacements r where r.remplacee_par = l.id)
             as a_des_versions
      from lisibles l
     where l.a_une_histoire
  ),
  -- Une pièce jamais remplacée n'a qu'une version : elle-même.
  versions as materialized (
    select c.id as piece_id, c.id as version_id from cibles c where not c.a_des_versions
    union all
    select c.id, v from cibles c, app.versions_de_la_piece(c.id) v where c.a_des_versions
  ),
  auteurs as materialized (
    select a.created_by, app.prenom_au_moment(a.created_by) as prenom
      from (select distinct created_by from cibles
             where membre and created_by is not null) a
  ),
  faits as materialized (
    select v.piece_id, f.id, f.fait, f.le, f.par_nom, f.tenant_id
      from versions v
      join capture.circuit f on f.piece_id = v.version_id
  ),
  dernier as (
    select distinct on (f.piece_id) f.piece_id, f.fait
      from faits f
     where f.tenant_id in (select tenant_id from membres)
     order by f.piece_id, f.le desc, f.id desc
  ),
  envois as materialized (
    select f.piece_id, max(f.le) as le from faits f where f.fait = 'envoyee' group by 1
  ),
  retours as (
    select distinct on (f.piece_id) f.piece_id, f.le, f.par_nom
      from faits f
     where f.fait = 'retournee'
     order by f.piece_id, f.le desc
  ),
  vues as materialized (
    select v.piece_id, x.vue_le, x.par_nom, x.cabinet_org_id, x.tenant_id
      from versions v
      join capture.vues x on x.piece_id = v.version_id
  ),
  vue_de_la_societe as (
    select distinct on (x.piece_id) x.piece_id, x.vue_le, x.par_nom
      from vues x
     where x.cabinet_org_id = x.tenant_id
     order by x.piece_id, x.vue_le desc
  ),
  vue_du_cabinet as (
    select distinct on (x.piece_id) x.piece_id, x.vue_le, o.name
      from vues x
      join identity.organizations o on o.id = x.cabinet_org_id
     where x.cabinet_org_id <> x.tenant_id
     order by x.piece_id, x.vue_le desc
  ),
  corrections as materialized (
    select v.piece_id, pr.decided_at as le, pr.decided_by as par, true as precision
      from versions v
      join capture.precisions pr on pr.piece_id = v.version_id
    union all
    select v.piece_id, r.created_at, r.auteur, false
      from versions v
      join capture.remplacements r on r.remplacee_par = v.version_id
  ),
  par_l_auteur as (
    select k.piece_id, max(k.le) as le
      from corrections k
      join cibles c on c.id = k.piece_id
      join envois e on e.piece_id = k.piece_id
     where k.le > e.le and k.par = c.created_by
     group by 1
  ),
  par_le_client as (
    select k.piece_id, max(k.le) as le
      from corrections k
      join cibles c on c.id = k.piece_id
     where k.le > coalesce(c.transmise_le, c.created_at)
       and (not k.precision
            or exists (select 1 from identity.memberships m
                        where m.tenant_id = c.tenant_id and m.user_id = k.par))
     group by 1
  ),
  renvois as (
    select v.piece_id, max(a.at) as le
      from versions v
      join audit.event_log a on a.object_id = v.version_id
     where a.object_table = 'pieces' and a.action = 'piece.renvoyee'
     group by 1
  ),
  prises as materialized (
    select distinct on (v.piece_id) v.piece_id, e.id as ecriture_id, pc.tenant_id as cabinet,
           pc.prise_le, pc.par_nom
      from versions v
      join socle.ecritures e on e.piece_id = v.version_id
      join socle.prises_en_charge pc on pc.ecriture_id = e.id
     where e.nature = 'piece'
       and e.status = 'booked'
       and e.reverses_id is null
       and not exists (select 1 from socle.ecritures r
                        where r.reverses_id = e.id and r.status = 'booked')
     order by v.piece_id, pc.prise_le desc
  ),
  origines as (
    select x.*, o.origine
      from prises x
      left join lateral app.ecriture_prise_en_charge(x.cabinet, x.ecriture_id) o on true
  )
  select l.id, l.a_une_histoire,
         exists (select 1 from capture.extractions e where e.piece_id = l.id),
         lu.payload, qk.valeur, qi.valeur,
         case when c.membre then c.recoit end,
         case when c.membre then d.fait end,
         case when c.membre then e.le end,
         case when c.membre then vs.vue_le end,
         case when c.membre then vs.par_nom end,
         case when c.membre then r.le end,
         case when c.membre then r.par_nom end,
         case when c.membre then pa.le end,
         case when c.membre then a.prenom end,
         case when c.membre then c.created_by is not distinct from auth.uid() end,
         case when c.vis = 'partage'::app.vis_t
              then greatest(coalesce(c.transmise_le, c.created_at), rv.le) end,
         case when c.vis = 'partage'::app.vis_t then vc.vue_le end,
         case when c.vis = 'partage'::app.vis_t then vc.name end,
         case when c.vis = 'partage'::app.vis_t then pc.le end,
         case when c.vis = 'partage'::app.vis_t then pr.prise_le end,
         case when c.vis = 'partage'::app.vis_t then pr.origine end,
         case when c.vis = 'partage'::app.vis_t and not c.client then pr.par_nom end,
         qs.valeur,
         -- Une proposition que le comptable a tranchée depuis ne se montre plus.
         case when qs.valeur is null then qp.valeur end
    from lisibles l
    left join cibles c on c.id = l.id
    left join lectures lu on lu.piece_id = l.id
    left join precisions_dites qk on qk.piece_id = l.id and qk.champ = 'document_kind'
    left join precisions_dites qi on qi.piece_id = l.id and qi.champ = 'issuer'
    left join precisions_dites qs on qs.piece_id = l.id and qs.champ = 'sens'
    left join precisions_dites qp on qp.piece_id = l.id and qp.champ = 'sens_propose'
    left join dernier d on d.piece_id = c.id
    left join envois e on e.piece_id = c.id
    left join retours r on r.piece_id = c.id
    left join vue_de_la_societe vs on vs.piece_id = c.id
    left join vue_du_cabinet vc on vc.piece_id = c.id
    left join par_l_auteur pa on pa.piece_id = c.id
    left join par_le_client pc on pc.piece_id = c.id
    left join renvois rv on rv.piece_id = c.id
    left join auteurs a on a.created_by = c.created_by
    left join origines pr on pr.piece_id = c.id
$function$;


comment on function app.pieces_de_la_liste(uuid[]) is
  'Pour chaque pièce de la liste : sa dernière lecture, ses précisions (type, émetteur, côté dit ou proposé), son circuit et son suivi, en une lecture — ce que les vues et app.circuit_de_la_piece, app.suivi_de_la_piece disent pièce par pièce. Bornée à ce que l''appelant peut lire.';

revoke all on function app.pieces_de_la_liste(uuid[]) from public, anon;
grant execute on function app.pieces_de_la_liste(uuid[]) to authenticated;

commit;

-- ================================================================== RETOUR
--
-- alter table ref.document_types drop column signe;
-- Rejouer les définitions de 20261221090000_le_comptable_interne_tient_les_livres.sql
-- (après `drop function app.pieces_de_la_liste(uuid[]);`), puis :
-- delete from app.migrations where nom = '20261231090000_l_avoir_garde_son_cote.sql';
