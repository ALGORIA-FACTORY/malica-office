-- Les refus se disent par une clé : les gardes du socle (audit d'intégrité, 1er novembre 2026).
--
-- Ces fonctions levaient leur refus en français brut — « piece introuvable ou
-- non autorisee », « seul le proprietaire principal donne une place » — et la
-- frontière de l'API (`refus.ts`) le rendait tel quel : un utilisateur qui lit
-- l'arabe ou l'anglais le lisait en français. Elles lèvent désormais une CLÉ
-- du dictionnaire (`@malica/socle/messages`, en fr, en et ar), que l'écran dit
-- dans la langue de la personne ; les valeurs citées suivent la clé, encodées
-- par `app.refus_avec_valeurs` (migration 20261110090000).
--
-- Chaque fonction est recréée depuis sa définition EN VIGUEUR
-- (`pg_get_functiondef` d'une base migrée), seul le message changeant : même
-- corps, même `security definer`, même `set search_path`. `create or replace`
-- garde le propriétaire (le portier, lot 6) et les droits. Avant et après,
-- `prosecdef`, `proowner`, `proconfig` et les droits de chaque fonction ont
-- été relevés : identiques. Les messages restants que la frontière rend tels
-- quels sont tenus à zéro par `la-base-tient-son-integrite.test.ts`.

begin;

CREATE OR REPLACE FUNCTION agents.conversation_immuable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'refus.conversation.auteur_fixe'
      using errcode = 'check_violation';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'refus.conversation.dossier_fixe'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app.annulation_contre_passe_le_reglement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_original socle.ecritures%rowtype;
 v_reversal uuid;
begin
 if new.annule_paiement_id is null then return new; end if;
 if not exists (select 1 from capture.paiements p where p.id = new.annule_paiement_id
                  and p.tenant_id = new.tenant_id and p.piece_id = new.piece_id
                  and p.devise = new.devise and p.montant_mineur is not distinct from new.montant_mineur
                  and p.annule_paiement_id is null) then
   raise exception 'refus.ecriture.annulation_du_reglement' using errcode = '22023';
 end if;
 perform 1 from capture.pieces where id = new.piece_id for update;
 for v_original in
   select e.* from socle.ecritures e
    where e.paiement_id = new.annule_paiement_id and e.nature = 'reglement'
      and app.ecriture_vivante(e.id)
 loop
   insert into socle.ecritures
     (tenant_id, entity_id, piece_id, vis, journal, date_ecriture, devise, libelle,
      pack_version_id, status, reverses_id, nature, paiement_id, reversal_reason_id)
   values (v_original.tenant_id, v_original.entity_id, v_original.piece_id,
           v_original.vis, v_original.journal, current_date, v_original.devise,
           'Annulation du règlement — ' || v_original.libelle, v_original.pack_version_id,
           'proposee', v_original.id, 'reglement', new.annule_paiement_id,
           (select id from ref.rejet_motifs where code = 'reglement_annule'))
   returning id into v_reversal;
   insert into socle.ecriture_lignes
     (tenant_id, ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code)
   select tenant_id, v_reversal, ordinal, account_code,
          'Annulation — ' || libelle, credit, debit, tax_code
     from socle.ecriture_lignes where ecriture_id = v_original.id;
   -- Revue du 24 octobre 2026 (décision de Wissem Barouni) : quand une
   -- comptabilité tient le dossier, c'est son expert qui inscrit. La
   -- contre-passation reste PROPOSÉE dans sa file ; la PME ne touche pas au
   -- grand livre qu'elle a confié. Une PME autonome tient seule ses comptes :
   -- elle inscrit, par le même chemin que toute écriture.
   if not exists (select 1 from identity.engagements g
                   where g.pme_org_id = new.tenant_id and g.status = 'actif') then
     perform public.socle_ecriture_book(v_reversal);
   else
     -- La file du cabinet l'apprend : l'annulation attend son geste.
     insert into collab.notifications (tenant_id, kind, payload)
     values (new.tenant_id, 'ecriture.proposed',
             jsonb_build_object('piece_id', new.piece_id, 'ecriture_id', v_reversal,
                                'motif', 'reglement_annule'));
   end if;
   insert into audit.event_log
     (tenant_id, actor, action, object_schema, object_table, object_id, payload)
   values (new.tenant_id, auth.uid(), 'reglement.contre_passe', 'socle', 'ecritures',
           v_reversal, jsonb_build_object('original', v_original.id,
             'paiement', new.annule_paiement_id, 'motif', new.annulation_motif_id));
 end loop;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION app.ecriture_inscrite_dans_son_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 v_debit numeric;
 v_credit numeric;
 v_manquant text;
begin
 if new.status <> 'booked' then return null; end if;
 if tg_op = 'UPDATE' then
   if old.status = 'booked' then return null; end if;
 end if;
 select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_debit, v_credit
   from socle.ecriture_lignes where ecriture_id = new.id;
 if v_debit = 0 or v_debit <> v_credit then
   raise exception 'refus.ecriture.lignes_inscrites' using errcode = '22023';
 end if;
 -- Une correction exacte peut annuler une écriture historique dont un
 -- compte a depuis été retiré du plan ; elle ne réécrit jamais l'original.
 if new.reverses_id is not null and exists (
   select 1 from socle.ecritures o where o.id = new.reverses_id
     and o.tenant_id = new.tenant_id and o.status = 'booked' and o.devise = new.devise
 ) and not exists (
   (select ordinal, account_code, debit, credit from socle.ecriture_lignes where ecriture_id = new.id
    except select ordinal, account_code, credit, debit from socle.ecriture_lignes where ecriture_id = new.reverses_id)
   union all
   (select ordinal, account_code, credit, debit from socle.ecriture_lignes where ecriture_id = new.reverses_id
    except select ordinal, account_code, debit, credit from socle.ecriture_lignes where ecriture_id = new.id)
 ) then return null; end if;
 select l.account_code into v_manquant
   from socle.ecriture_lignes l
  where l.ecriture_id = new.id
    and not exists (select 1 from ref.accounts a
      where a.pack_version_id = new.pack_version_id and a.account_code = l.account_code)
    and not exists (select 1 from parametrage.accounts a where a.account_code = l.account_code
      and (a.tenant_id = new.tenant_id or a.tenant_id in (
        select e.cabinet_org_id from identity.engagements e
         where e.pme_org_id = new.tenant_id and e.status = 'actif')))
  order by l.ordinal limit 1;
 if v_manquant is not null then
   raise exception '%', app.refus_avec_valeurs('refus.ecriture.compte_hors_plan', 'compte', (v_manquant)::text) using errcode = '22023';
 end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION app.ecriture_proposee_equilibree()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    raise exception '%', app.refus_avec_valeurs('refus.ecriture.desequilibree', 'debit', (v_debit)::text, 'credit', (v_credit)::text)
      using errcode = '22023', hint = 'ecriture.desequilibree';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION app.envoyer_au_proprietaire(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_auteur uuid;
  v_dernier text;
  v_le     timestamptz;
begin
  select tenant_id, vis, created_by into v_tenant, v_vis, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or not app.piece_lisible(p_piece)
     or v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if not app.a_le_droit(v_tenant, 'envoi.proprietaire') then
    raise exception 'refus.envoi.proprietaire.droit' using errcode = '42501';
  end if;
  -- Le siège envoie les siennes.
  if v_auteur is distinct from auth.uid() then
    raise exception 'refus.envoi.proprietaire.pas_la_sienne' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  -- Mon espace : il la met d'abord dans la société. Chez le comptable : elle
  -- y est déjà, par le propriétaire.
  if v_vis <> 'entite'::app.vis_t then
    raise exception 'refus.envoi.proprietaire.hors_societe' using errcode = 'check_violation';
  end if;

  select fait, le into v_dernier, v_le from app.dernier_fait_du_circuit(p_piece);
  -- Le doigt ripe : elle est déjà chez le propriétaire, rien de nouveau.
  if v_dernier = 'envoyee' then
    return jsonb_build_object('piece_id', p_piece, 'le', v_le, 'deja', true, 'chez', 'proprietaire');
  end if;

  insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
  values (v_tenant, p_piece, 'envoyee', auth.uid(), app.prenom_au_moment(auth.uid()))
  returning le into v_le;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(),
          case when v_dernier = 'retournee' then 'piece.renvoyee_au_proprietaire'
               else 'piece.envoyee_au_proprietaire' end,
          -- `chez` : un fait du passage interne, que le cabinet ne lit pas
          -- (`audit_event_log_sel`, `20261104110000`).
          'capture', 'pieces', p_piece, jsonb_build_object('chez', 'proprietaire'));

  perform app.notifier_les_receveurs(v_tenant, 'piece.recue_du_siege',
                                     jsonb_build_object('piece_id', p_piece,
                                                        'renvoi', coalesce(v_dernier = 'retournee', false)));

  return jsonb_build_object('piece_id', p_piece, 'le', v_le, 'deja', false, 'chez', 'proprietaire');
end
$function$;

CREATE OR REPLACE FUNCTION app.exiger_origine_serveur()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Sous l'identité d'un utilisateur (claim `sub` posé par l'API), seule une
  -- transaction ouverte par le serveur pour sa propre chaîne peut écrire ici.
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
     and coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur'
      using errcode = '42501';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app.exiger_origine_serveur_sauf_question()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.role = 'user' then
    return new;
  end if;
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
     and coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur'
      using errcode = '42501';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app.exiger_un_motif_de_retour(p_motif uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_note_requise boolean;
begin
  select requires_note into v_note_requise
    from ref.rejet_motifs where id = p_motif and active;
  if v_note_requise is null then
    raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
  end if;
  if v_note_requise and coalesce(btrim(p_note), '') = '' then
    raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION app.export_mandats(p_cabinet uuid, p_client uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if p_client is not null and not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;
  if p_client is not null then
    perform app.exiger_licence_active(p_client, 'export');
  end if;
  return query
    select e.pme_org_id
      from identity.engagements e
     where e.cabinet_org_id = p_cabinet
       and (p_client is null or e.pme_org_id = p_client)
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)
       and app.licence_active(e.pme_org_id);
end $function$;

CREATE OR REPLACE FUNCTION app.familles_immobilisees(p_dossier uuid, p_pack uuid, p_kind text, p_jour date)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if p_dossier is null
     or p_dossier not in (select app.member_orgs() union select app.engaged_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return (
    with f as (
      select f.code, f.main_account
        from ref.charge_familles f
       where f.pack_version_id = p_pack and f.main_account is not null
         and f.valid_from <= p_jour and (f.valid_to is null or f.valid_to >= p_jour)
    )
    select coalesce(array_agg(distinct f.code order by f.code), '{}')
      from f
      join app.nature_des_comptes(null, p_dossier, p_pack, p_kind, p_jour,
                                  array(select distinct x.main_account from f x)) n
        on n.account_code = f.main_account and n.immobilisation
  );
end
$function$;

CREATE OR REPLACE FUNCTION app.fuseau_du_cabinet(p_cabinet uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fuseau text;
begin
  select coalesce(o.fuseau, c.fuseau) into v_fuseau
    from identity.organizations o
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where o.id = p_cabinet;
  if v_fuseau is null then
    raise exception 'refus.fuseau.non_defini'
      using errcode = '22023';
  end if;
  return v_fuseau;
end $function$;

CREATE OR REPLACE FUNCTION app.honoraires_taux_du_pack(p_cabinet uuid, p_code text, OUT o_pack uuid, OUT o_taux numeric)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_juridiction text;
begin
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  select p.id into o_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_juridiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to > current_date)
   order by p.effective_from desc limit 1;
  if o_pack is null then
    raise exception 'refus.referentiel.pack_absent' using errcode = '22023';
  end if;
  select t.rate into o_taux
    from ref.tva_rates t
   where t.pack_version_id = o_pack and t.code = p_code
     and t.valid_from <= current_date and (t.valid_to is null or t.valid_to >= current_date)
   order by t.valid_from desc limit 1;
  if o_taux is null then
    raise exception 'refus.referentiel.taux_tva_hors_pack' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION app.piece_qui_accompagne_garde(p_piece uuid, p_supprime boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
begin
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  if v_tenant is null or not app.piece_accompagne(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- Une pièce transmise ne disparaît que sur accord du cabinet
  -- (`capture_piece_supprimer`) : la fiche le dit, dans la langue de la
  -- personne, AVANT qu'une nouvelle photo ne soit prise pour rien.
  if p_supprime and v_vis = 'partage'::app.vis_t then
    raise exception 'refus.accompagne.transmise' using errcode = 'check_violation';
  end if;
  -- Les mêmes refus que `capture_piece_supprimer`, dits AVANT la photo : une
  -- pièce engagée ou qui sert dans une écriture ne disparaît plus.
  if p_supprime and (
       (select status from capture.pieces where id = p_piece) not in ('capturee', 'lue')
       or exists (select 1 from socle.ecritures e where e.piece_id = p_piece)) then
    raise exception 'refus.accompagne.engagee' using errcode = 'check_violation';
  end if;
  return v_tenant;
end
$function$;

CREATE OR REPLACE FUNCTION app.poser_la_source(p_piece uuid, p_source uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_source is null or p_source = p_piece
     or not app.piece_modifiable(p_piece) or not app.piece_lisible(p_source)
     or not exists (
       select 1 from capture.pieces p, capture.pieces s
        where p.id = p_piece and s.id = p_source
          and s.tenant_id = p.tenant_id
          and (s.vis = 'partage'::app.vis_t) = (p.vis = 'partage'::app.vis_t)) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  update capture.pieces set source_piece_id = p_source where id = p_piece;
end
$function$;

CREATE OR REPLACE FUNCTION app.refuser_lecture_de_licence()
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'refus.introuvable.dossier' using errcode = '42501';
end $function$;

CREATE OR REPLACE FUNCTION app.reglement_bookable_sur_paiement_actif()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.nature = 'reglement' and new.reverses_id is null and new.status = 'booked' then
   perform 1 from capture.pieces where id = new.piece_id for update;
   if not exists (select 1 from capture.paiements p where p.id = new.paiement_id
                    and p.piece_id = new.piece_id and p.annule_paiement_id is null)
      or exists (select 1 from capture.paiements a where a.annule_paiement_id = new.paiement_id) then
     raise exception 'refus.ecriture.reglement_annule' using errcode = '22023';
   end if;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION app.supervision_sur_ecriture_vivante()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.review_outcome is not null
     and new.reviewed_at is distinct from old.reviewed_at
     and old.reverses_id is null
     and exists (select 1 from socle.ecritures r
                  where r.reverses_id = old.id and r.status = 'booked') then
    raise exception 'refus.ecriture.contre_passee'
      using errcode = 'check_violation', hint = 'ecriture.contre_passee';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app.un_mandat_actif_a_la_fois()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status = 'actif'
     and (tg_op = 'INSERT' or old.status is distinct from 'actif')
     and exists (select 1 from identity.engagements o
                  where o.pme_org_id = new.pme_org_id and o.status = 'actif'
                    and o.id <> new.id) then
    raise exception 'refus.mandat.un_seul_actif'
      using errcode = 'check_violation', hint = 'mandat.deja_actif';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION capture.un_reglement_dit_vrai()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ttc  bigint;
  v_paye bigint;
  v_courante uuid;
  v_versions uuid[];
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes, et elle
  -- reste sur la pièce du règlement qu'elle annule.
  if new.annule_paiement_id is not null then
    return new;
  end if;

  -- La pièce appartient au dossier inscrit : la politique d'insertion vérifie
  -- le dossier, pas la pièce, et cette fonction lit (et éteint) au-delà de la
  -- RLS de l'appelant (revue Codex de #101).
  if not exists (select 1 from capture.pieces x
                  where x.id = new.piece_id and x.tenant_id = new.tenant_id) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  v_courante := app.version_courante(new.piece_id);
  select array_agg(v) into v_versions from app.versions_de_la_piece(new.piece_id) v;

  -- Un règlement nouveau ne s'inscrit pas sur une version gelée : c'est la
  -- même facture, il va à sa version courante — avec son établissement et son
  -- côté. La file hors ligne peut porter un identifiant d'avant la reprise ;
  -- la refuser ferait perdre un règlement réel (« rien ne bloque »).
  if new.piece_id <> v_courante then
    select c.id, c.entity_id, c.vis into new.piece_id, new.entity_id, new.vis
      from capture.pieces c where c.id = v_courante;
  end if;

  -- Une seule inscription à la fois par pièce — toutes versions : deux appuis
  -- simultanés, sur l'ancienne et la nouvelle photo, ne passent pas tous deux
  -- la règle du dépassement.
  perform pg_advisory_xact_lock(hashtextextended(v_courante::text, 0));

  if new.moyen_code = 'non_paye' then
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code <> 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_regle' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code = 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_non_paye' using errcode = 'check_violation';
    end if;
    new.montant_mineur := null;
    new.paye_le := null;
    return new;
  end if;

  v_ttc := capture.ttc_mineur(v_courante);
  -- Ce qui est DÉJÀ éteint : la dette qu'éteint chaque règlement (retenue à la
  -- source comprise, `app.dette_eteinte`), sinon son montant (revue Codex).
  select coalesce(sum(coalesce(
           round(app.dette_eteinte(p.id) * power(10, d.exposant))::bigint,
           p.montant_mineur)), 0) into v_paye
    from capture.paiements p
    join ref.devises d on d.code = p.devise
   where p.piece_id = any (v_versions) and p.annule_paiement_id is null
     and p.moyen_code <> 'non_paye'
     and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id);

  if new.montant_mineur is null then
    if v_ttc is null then
      raise exception 'paiement.montant_requis' using errcode = 'check_violation';
    end if;
    new.montant_mineur := v_ttc - v_paye;
    if new.montant_mineur <= 0 then
      raise exception 'paiement.deja_solde' using errcode = 'check_violation';
    end if;
  end if;

  if new.montant_mineur <= 0 then
    raise exception 'paiement.montant_positif' using errcode = 'check_violation';
  end if;

  if v_ttc is not null and v_paye + new.montant_mineur > v_ttc then
    raise exception 'paiement.depasse_le_total' using errcode = 'check_violation';
  end if;

  if new.paye_le is null then
    new.paye_le := current_date;
  end if;
  if new.paye_le > current_date + 1 then
    raise exception 'paiement.date_future' using errcode = 'check_violation';
  end if;

  if exists (select 1 from capture.paiements p
              where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                and p.moyen_code = new.moyen_code
                and p.montant_mineur = new.montant_mineur
                and p.paye_le is not distinct from new.paye_le
                and p.created_at > now() - interval '10 seconds'
                and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
    raise exception 'paiement.en_double' using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION collab.pv_figer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.statut = 'envoye' then
    raise exception 'refus.pv.envoye'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.statut = 'envoye'
     and coalesce(current_setting('app.pv_envoi', true), '') <> 'oui' then
    raise exception 'refus.pv.geste_d_envoi'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION collab.pv_reception_consigner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_cabinet uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'refus.pv.reception_datee' using errcode = '42501';
  end if;
  select p.cabinet_tenant_id into v_cabinet from collab.pv_reunions p
    where p.id = new.pv_id and p.client_tenant_id = new.tenant_id and p.statut = 'envoye';
  if v_cabinet is null or new.membre_id <> auth.uid()
     or not app.has_org_role(new.tenant_id, array['dirigeant']) then
    raise exception 'refus.introuvable.proces_verbal' using errcode = 'P0002';
  end if;
  new.recu_le := clock_timestamp();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION fabrique.bornes_de_generation(p_tenant uuid)
 RETURNS TABLE(borne text, valeur numeric, arrete_par_le_cabinet boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_attendues constant text[] := array['pieces_min'];
  v_manquantes text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.generation.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.generation\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.generation\.(.+)$') = any(v_attendues);

  select array_agg(a order by a) into v_manquantes
    from unnest(v_attendues) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.generation.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquantes is not null then
    raise exception
      '%', app.refus_avec_valeurs('refus.referentiel.incomplet', 'manque', (array_to_string(v_manquantes, ', '))::text)
      using errcode = 'no_data_found';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.bornes_de_recette(p_tenant uuid)
 RETURNS TABLE(borne text, valeur numeric, arrete_par_le_cabinet boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_attendues constant text[] := array[
    'ancre_texte_min', 'selecteurs_max', 'champs_max', 'jetons_max', 'rang_max'];
  v_manquantes text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.recette.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.recette\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.recette\.(.+)$') = any(v_attendues);

  select array_agg(a order by a) into v_manquantes
    from unnest(v_attendues) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.recette.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquantes is not null then
    raise exception
      '%', app.refus_avec_valeurs('refus.referentiel.incomplet', 'manque', (array_to_string(v_manquantes, ', '))::text)
      using errcode = 'no_data_found';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.bornes_de_travail(p_tenant uuid)
 RETURNS TABLE(borne text, valeur numeric, arrete_par_le_cabinet boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_attendues constant text[] := array['tentatives_max', 'abandon_s', 'repli_s'];
  v_manquantes text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.travail.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.travail\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.travail\.(.+)$') = any(v_attendues);

  select array_agg(a order by a) into v_manquantes
    from unnest(v_attendues) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.travail.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquantes is not null then
    raise exception
      '%', app.refus_avec_valeurs('refus.referentiel.incomplet', 'manque', (array_to_string(v_manquantes, ', '))::text)
      using errcode = 'no_data_found';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.candidate_inscrire(p_tenant uuid, p_libelle text, p_signature_cle text, p_portee fabrique.portee_t, p_definition jsonb, p_empreinte text, p_provenance jsonb, p_exemples uuid[], p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recette uuid;
  v_version uuid;
  v_rang    smallint;
begin
  if exists (select 1 from unnest(coalesce(p_exemples, '{}')) e(id)
              where not exists (select 1 from fabrique.exemples x
                                 where x.id = e.id and x.tenant_id = p_tenant)) then
    raise exception 'refus.introuvable.exemple' using errcode = '42501';
  end if;
  select r.id into v_recette from fabrique.recettes r
   where r.tenant_id = p_tenant and r.signature_cle = p_signature_cle;
  if v_recette is null then
    insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
    values (p_tenant, p_libelle, p_signature_cle, p_portee)
    returning id into v_recette;
  end if;
  -- Le rang se calcule ici : deux naissances simultanées se départagent par
  -- la contrainte d'unicité, l'une échoue au lieu d'écraser l'autre.
  insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte,
                                         provenance)
  select p_tenant, v_recette, coalesce(max(v.rang), 0) + 1, p_definition, p_empreinte,
         p_provenance
    from fabrique.recette_versions v
   where v.recette_id = v_recette
  returning id, rang into v_version, v_rang;
  insert into fabrique.recette_version_exemples (tenant_id, recette_version_id, exemple_id,
                                                 nourrit_une_recette, usage)
  select p_tenant, v_version, e.id, true, 'apprentissage'
    from unnest(coalesce(p_exemples, '{}')) with ordinality e(id, n)
   order by e.n;
  insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
  values (p_tenant, v_version, 'candidate', p_motif);
  return jsonb_build_object('recette_id', v_recette, 'version_id', v_version, 'rang', v_rang);
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.derive_inscrire(p_tenant uuid, p_version uuid, p_nature fabrique.derive_t, p_mesure jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from fabrique.recette_versions v
                  where v.id = p_version and v.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.recette' using errcode = '42501';
  end if;
  insert into fabrique.derives (tenant_id, recette_version_id, nature, mesure)
  values (p_tenant, p_version, p_nature, p_mesure);
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.evaluation_inscrire(p_tenant uuid, p_version uuid, p_mesures jsonb, p_exemples_comptes integer, p_exemples uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from fabrique.recette_versions v
                  where v.id = p_version and v.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.recette' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_exemples, '{}')) e(id)
              where not exists (select 1 from fabrique.exemples x
                                 where x.id = e.id and x.tenant_id = p_tenant)) then
    raise exception 'refus.introuvable.exemple' using errcode = '42501';
  end if;
  insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
  values (p_tenant, p_version, p_mesures, p_exemples_comptes)
  returning id into v_id;
  insert into fabrique.evaluation_exemples (tenant_id, evaluation_id, exemple_id, usage)
  select p_tenant, v_id, e.id, 'evaluation'
    from unnest(coalesce(p_exemples, '{}')) with ordinality e(id, n)
   order by e.n;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.execution_inscrire(p_tenant uuid, p_version uuid, p_piece uuid, p_issue fabrique.issue_t, p_motif text, p_champs_designes smallint, p_duree_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  insert into fabrique.executions (tenant_id, recette_version_id, piece_id, issue, motif,
                                   champs_designes, duree_ms)
  values (p_tenant, p_version, p_piece, p_issue, p_motif, p_champs_designes, p_duree_ms);
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.exemple_qualifier(p_tenant uuid, p_piece uuid, p_signature_cle text, p_provenance fabrique.provenance_t, p_qualification fabrique.qualification_t, p_usage fabrique.usage_t, p_attendu jsonb, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  insert into fabrique.exemples (tenant_id, piece_id, signature_cle, provenance, qualification,
                                 usage, attendu, note)
  values (p_tenant, p_piece, p_signature_cle, p_provenance, p_qualification, p_usage, p_attendu,
          p_note)
  returning id into v_id;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.issue_inscrire(p_tenant uuid, p_travail uuid, p_tentative smallint, p_nature fabrique.fait_t, p_motif text, p_detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from fabrique.travaux t where t.id = p_travail and t.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature, motif, detail)
  values (p_tenant, p_travail, p_tentative, p_nature, p_motif, p_detail);
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.promotion_inscrire(p_tenant uuid, p_version uuid, p_etat fabrique.etat_t, p_evaluation uuid, p_motif text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from fabrique.recette_versions v
                  where v.id = p_version and v.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.recette' using errcode = '42501';
  end if;
  insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
  values (p_tenant, p_version, p_etat, p_evaluation, p_motif);
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.reglages_de_signature(p_tenant uuid)
 RETURNS TABLE(reglage text, valeur numeric, arrete_par_le_cabinet boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_attendus constant text[] := array[
    'longueur_minimale_d_ancre', 'bandes_par_page', 'part_minimale_du_sens',
    'recouvrement_de_ligne', 'recouvrement_de_colonne', 'ancres_en_relation_max',
    'poids_ancres', 'poids_zones', 'poids_relations', 'poids_tableau',
    'poids_pagination', 'distance_max', 'ecart_minimal'];
  v_manquants text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.signature.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.signature\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.signature\.(.+)$') = any(v_attendus);

  select array_agg(a order by a) into v_manquants
    from unnest(v_attendus) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.signature.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquants is not null then
    raise exception
      '%', app.refus_avec_valeurs('refus.referentiel.incomplet', 'manque', (array_to_string(v_manquants, ', '))::text)
      using errcode = 'no_data_found';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.travail_inscrire(p_tenant uuid, p_piece uuid, p_nature fabrique.travail_nature_t, p_cle text, p_priorite smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if p_priorite is null then
    insert into fabrique.travaux (tenant_id, piece_id, nature, cle_idempotence)
    values (p_tenant, p_piece, p_nature, p_cle)
    on conflict (tenant_id, cle_idempotence) do nothing
    returning id into v_id;
  else
    insert into fabrique.travaux (tenant_id, piece_id, nature, cle_idempotence, priorite)
    values (p_tenant, p_piece, p_nature, p_cle, p_priorite)
    on conflict (tenant_id, cle_idempotence) do nothing
    returning id into v_id;
  end if;
  if v_id is not null then
    return jsonb_build_object('travail_id', v_id, 'deja', false);
  end if;
  select t.id into v_id from fabrique.travaux t
   where t.tenant_id = p_tenant and t.cle_idempotence = p_cle;
  if v_id is null then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  return jsonb_build_object('travail_id', v_id, 'deja', true);
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.verifier_fait_de_travail()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_piece  uuid;
  v_nature fabrique.travail_nature_t;
  v_etat   record;
begin
  -- `security invoker` : si l'appelant ne VOIT pas le travail, il n'y
  -- inscrit rien. La cle etrangere, elle, ne consulte aucune politique.
  select t.piece_id, t.nature into v_piece, v_nature
    from fabrique.travaux t where t.id = new.travail_id;
  if v_piece is null then
    raise exception 'refus.introuvable.travail'
      using errcode = '42501';
  end if;

  if new.nature <> 'pris' then
    -- Une issue appartient a UNE prise, la sienne. Sans cela, on raconterait
    -- la fin d'un travail que personne n'a commence.
    if not exists (
      select 1 from fabrique.travail_faits f
       where f.travail_id = new.travail_id
         and f.tentative = new.tentative
         and f.nature = 'pris')
    then
      raise exception
        '%', app.refus_avec_valeurs('refus.fabrique.issue_sans_prise', 'tentative', (new.tentative)::text, 'travail', (new.travail_id)::text)
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Une borne absente LEVE ici, au lieu de laisser la vue refuser en silence.
  perform fabrique.bornes_de_travail(new.tenant_id);

  /*
   * LA SERIALISATION, et elle porte sur la PIECE, pas sur le travail.
   *
   * L'index unique suffit pour deux preneurs du MEME travail. Il ne dit rien
   * de deux travaux DIFFERENTS sur la meme piece — le cas de la file hors
   * ligne qui rejoue sous une autre cle. Un verrou consultatif de
   * transaction les met en file : il n'est soumis a aucune politique, et il
   * tombe au commit comme au rollback.
   */
  perform pg_advisory_xact_lock(
    hashtextextended(v_piece::text || ':' || v_nature::text, 0));

  select * into v_etat from fabrique.etat_des_travaux_v e
   where e.travail_id = new.travail_id;

  if not coalesce(v_etat.prenable, false) then
    raise exception
      '%', app.refus_avec_valeurs('refus.fabrique.non_prenable', 'travail', (new.travail_id)::text, 'etat', (v_etat.etat)::text, 'tentatives', (v_etat.tentatives)::text, 'maximum', (v_etat.tentatives_max)::text)
      using errcode = 'check_violation';
  end if;

  if new.tentative <> v_etat.tentatives + 1 then
    raise exception
      '%', app.refus_avec_valeurs('refus.fabrique.tentative_suivante', 'tentative', (new.tentative)::text, 'suivante', (v_etat.tentatives + 1)::text)
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from fabrique.etat_des_travaux_v o
     where o.piece_id = v_piece
       and o.nature = v_nature
       and o.travail_id <> new.travail_id
       and o.etat = 'en_cours')
  then
    raise exception
      '%', app.refus_avec_valeurs('refus.fabrique.lecture_en_cours', 'piece', (v_piece)::text)
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.verifier_piece_visible()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.piece_id is null then
    return new;
  end if;
  if not exists (select 1 from capture.pieces p where p.id = new.piece_id) then
    raise exception 'refus.introuvable.piece'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION fabrique.verifier_promotion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_precedent fabrique.etat_t;
  v_permis    text[];
  v_mesures   jsonb;
  v_version   uuid;
  v_seuils    integer := 0;
  r           record;
  v_valeur    numeric;
begin
  select p.etat into v_precedent
    from fabrique.promotions p
   where p.recette_version_id = new.recette_version_id
   order by p.ordre desc
   limit 1;

  v_permis := case coalesce(v_precedent::text, 'neant')
    when 'neant'       then array['candidate']
    when 'candidate'   then array['evaluee', 'retiree']
    when 'evaluee'     then array['observation', 'retiree']
    when 'observation' then array['active', 'suspendue', 'retiree']
    when 'active'      then array['suspendue', 'retiree']
    when 'suspendue'   then array['observation', 'active', 'retiree']
    else array[]::text[]
  end;

  if not (new.etat::text = any(v_permis)) then
    raise exception
      '%', app.refus_avec_valeurs('refus.fabrique.transition', 'de', (coalesce(v_precedent::text, 'rien'))::text, 'vers', (new.etat)::text, 'permis', (v_permis)::text)
      using errcode = 'check_violation';
  end if;

  -- Une VALIDATION humaine fournit un exemple ; elle n'autorise aucune
  -- promotion. Tout état qui prétend à une qualité exige une ÉVALUATION.
  if new.etat in ('evaluee', 'observation', 'active') then
    if new.evaluation_id is null then
      raise exception
        '%', app.refus_avec_valeurs('refus.fabrique.evaluation_requise', 'etat', (new.etat)::text)
        using errcode = 'check_violation';
    end if;
    select e.mesures, e.recette_version_id into v_mesures, v_version
      from fabrique.evaluations e where e.id = new.evaluation_id;
    if v_version is distinct from new.recette_version_id then
      raise exception '%', app.refus_avec_valeurs('refus.fabrique.autre_version', 'evaluation', (new.evaluation_id)::text)
        using errcode = 'check_violation';
    end if;
  end if;

  -- L'activation, et elle seule, se mesure contre le référentiel.
  if new.etat = 'active' then
    for r in select * from fabrique.seuils_exiges(new.tenant_id) loop
      v_seuils := v_seuils + 1;
      v_valeur := (v_mesures ->> r.mesure)::numeric;
      if v_valeur is null then
        raise exception
          '%', app.refus_avec_valeurs('refus.fabrique.mesure_absente', 'mesure', (r.mesure)::text)
          using errcode = 'check_violation';
      end if;
      if r.sens = 'min' and v_valeur < r.exigence then
        raise exception '%', app.refus_avec_valeurs('refus.fabrique.seuil_minimum', 'mesure', (r.mesure)::text, 'valeur', (v_valeur)::text, 'exigence', (r.exigence)::text)
          using errcode = 'check_violation';
      end if;
      if r.sens = 'max' and v_valeur > r.exigence then
        raise exception '%', app.refus_avec_valeurs('refus.fabrique.seuil_maximum', 'mesure', (r.mesure)::text, 'valeur', (v_valeur)::text, 'exigence', (r.exigence)::text)
          using errcode = 'check_violation';
      end if;
    end loop;
    -- Aucun repli implicite (R4) : sans seuil en vigueur, on refuse.
    if v_seuils = 0 then
      raise exception
        'refus.referentiel.manquant'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION identity.api_keys_garde()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'refus.cle_api.revoquer' using errcode = '42501';
  end if;
  if new.tenant_id  is distinct from old.tenant_id
     or new.libelle    is distinct from old.libelle
     or new.prefixe    is distinct from old.prefixe
     or new.suffixe    is distinct from old.suffixe
     or new.empreinte  is distinct from old.empreinte
     or new.portees    is distinct from old.portees
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  then
    raise exception 'refus.cle_api.revoquer' using errcode = '42501';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION identity.fiche_regime_connu()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_jur text;
begin
  select o.jurisdiction into v_jur
    from identity.organizations o where o.id = new.tenant_id;

  if new.regime_imposition is not null and not exists (
    select 1 from ref.regimes_fiscaux r
     where r.jurisdiction = v_jur and r.axe = 'imposition'
       and r.code = new.regime_imposition
       and r.valid_from <= new.valid_from
       and (r.valid_to is null or r.valid_to > new.valid_from)
  ) then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.regime_inconnu', 'juridiction', (v_jur)::text, 'date', (new.valid_from)::text, 'regime', (new.regime_imposition)::text) using errcode = 'foreign_key_violation';
  end if;

  if new.regime_tva is not null and not exists (
    select 1 from ref.regimes_fiscaux r
     where r.jurisdiction = v_jur and r.axe = 'tva'
       and r.code = new.regime_tva
       and r.valid_from <= new.valid_from
       and (r.valid_to is null or r.valid_to > new.valid_from)
  ) then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.regime_inconnu', 'juridiction', (v_jur)::text, 'date', (new.valid_from)::text, 'regime', (new.regime_tva)::text) using errcode = 'foreign_key_violation';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION identity.un_matricule_une_societe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'refus.societe.matricule_existant'
      using errcode = '23505', hint = 'organisation.matricule_deja_pris';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION immo.bien_constate_fige()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (new.category_id      is distinct from old.category_id
      or new.mise_en_service  is distinct from old.mise_en_service
      or new.valeur_brute     is distinct from old.valeur_brute
      or new.valeur_residuelle is distinct from old.valeur_residuelle
      or new.method           is distinct from old.method
      or new.duree_annees     is distinct from old.duree_annees
      or new.coefficient      is distinct from old.coefficient
      or new.devise           is distinct from old.devise)
     and (exists (select 1 from immo.dotations d where d.asset_id = old.id)
          or exists (select 1 from immo.depreciations p where p.asset_id = old.id)
          or exists (select 1 from immo.cessions c where c.asset_id = old.id)) then
    raise exception
      '%', app.refus_avec_valeurs('refus.immo.bien_constate', 'bien', (old.label)::text)
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION notif.poster(p_destinataire uuid, p_code text, p_sujet_cle text, p_jetons jsonb DEFAULT '{}'::jsonb, p_tenant uuid DEFAULT NULL::uuid, p_canal text DEFAULT 'push'::text, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g          record;
  pref       record;
  v_locale   text;
  v_titre    text;
  v_corps    text;
  v_abandon  text := null;
  v_heure    time;
  v_id       uuid;
  k          text;
begin
  -- ─ verrou 1 : le droit. Un destinataire sans membership sur le tenant
  --   concerné n'a plus rien à recevoir de ce tenant.
  if p_tenant is not null and not exists (
       select 1 from identity.memberships m
        where m.tenant_id = p_tenant and m.user_id = p_destinataire)
  then
    v_abandon := 'droit_perdu';
  end if;

  select * into pref from notif.preferences where user_id = p_destinataire;
  if pref.user_id is null then
    insert into notif.preferences (user_id) values (p_destinataire)
      on conflict do nothing;
    select * into pref from notif.preferences where user_id = p_destinataire;
  end if;

  -- ─ verrou 2 : la cadence. `jamais` veut dire jamais, y compris pour une
  --   échéance fiscale — c'est son choix, et le produit le respecte.
  if v_abandon is null and pref.cadence = 'jamais' and p_canal <> 'app' then
    v_abandon := 'cadence';
  end if;

  -- ─ verrou 3 : le silence. Le calcul se fait dans le fuseau de la personne.
  --   La fenêtre traverse minuit, d'où le `or` plutôt qu'un `between`.
  if v_abandon is null and p_canal = 'push' then
    v_heure := (now() at time zone pref.fuseau)::time;
    if (pref.silence_de < pref.silence_a
        and v_heure >= pref.silence_de and v_heure < pref.silence_a)
       or (pref.silence_de > pref.silence_a
        and (v_heure >= pref.silence_de or v_heure < pref.silence_a))
    then
      v_abandon := 'silence';
    end if;
  end if;

  -- ─ verrou 4 : le doublon. La promesse « une fois, et je me tais ».
  -- Deux façons de s'être déjà exprimé, et il faut les deux :
  --
  --   REMIS        la personne l'a reçu ;
  --   À REMETTRE   c'est décidé, le travailleur ne l'a pas encore poussé.
  --
  -- Oublier le second a une conséquence mesurée : un ordonnanceur qui tourne
  -- toutes les heures repose la même relance vingt-quatre fois avant que le
  -- travailleur n'en ait poussé une seule, et le client reçoit vingt-quatre
  -- courriels d'un coup. C'est exactement la boucle que « une fois, et je me
  -- tais » existe pour empêcher.
  --
  -- Un envoi ABANDONNÉ, lui, ne compte pas : retenu par le silence de 23 h,
  -- la même chose doit pouvoir repartir à 8 h.
  if v_abandon is null and exists (
       select 1 from notif.envois_v e
        where e.destinataire = p_destinataire
          and e.code = p_code
          and e.sujet_cle = p_sujet_cle
          and e.decision = 'a_remettre'      -- décidé : remis, ou en attente
          and e.etat <> 'refuse'             -- refusé pour de bon : on peut redire
          and e.cree_le > now() - p_fenetre)
  then
    v_abandon := 'doublon';
  end if;

  -- Le canal doit exister. Un push sans appareil enregistré n'échoue pas :
  -- il s'abandonne, proprement, et la ligne le dit.
  if v_abandon is null and p_canal = 'push' and not exists (
       select 1 from collab.push_devices d
        where d.user_id = p_destinataire and d.revoked_at is null)
  then
    v_abandon := 'canal_absent';
  end if;

  -- Le gabarit, dans la langue de la personne, repli sur le français.
  select coalesce(pr.locale, 'fr') into v_locale
    from identity.profiles pr where pr.user_id = p_destinataire;
  v_locale := coalesce(v_locale, 'fr');

  select * into g from notif.gabarits
   where code = p_code and canal = p_canal
     and locale in (v_locale, 'fr')
     and effective_from <= current_date
   order by (locale = v_locale) desc, effective_from desc
   limit 1;

  if g.id is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.gabarit_absent', 'code', (p_code)::text, 'canal', (p_canal)::text)
      using errcode = 'no_data_found';
  end if;

  -- La substitution : {{jeton}} → valeur. Un jeton absent reste visible dans
  -- le texte rendu plutôt que de disparaître — on veut le voir en recette,
  -- pas découvrir une phrase amputée chez un client.
  v_titre := g.titre; v_corps := g.corps;
  for k in select jsonb_object_keys(p_jetons) loop
    v_titre := replace(v_titre, '{{' || k || '}}', coalesce(p_jetons ->> k, ''));
    v_corps := replace(v_corps, '{{' || k || '}}', coalesce(p_jetons ->> k, ''));
  end loop;

  insert into notif.envois
    (tenant_id, destinataire, code, canal, gabarit_id, sujet_cle,
     titre_rendu, corps_rendu, decision, motif_abandon)
  values
    (p_tenant, p_destinataire, p_code, p_canal, g.id, p_sujet_cle,
     v_titre, v_corps,
     case when v_abandon is null then 'a_remettre' else 'abandonne' end,
     v_abandon)
  returning id into v_id;

  -- Le centre de notifications de l'application reçoit tout, même ce qui n'a
  -- pas été poussé : le silence de 23 h ne doit pas faire disparaître
  -- l'information, seulement différer le bruit.
  if p_tenant is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (p_tenant, p_destinataire, p_code,
            jsonb_build_object('titre', v_titre, 'corps', v_corps,
                               'envoi_id', v_id) || p_jetons);
  end if;

  return jsonb_build_object('envoi_id', v_id, 'poste', v_abandon is null,
                            'motif', v_abandon, 'canal', p_canal);
end
$function$;

CREATE OR REPLACE FUNCTION notif.remettre(p_envoi uuid, p_resultat text, p_erreur text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_dest uuid;
begin
  select destinataire into v_dest from notif.envois where id = p_envoi;
  if v_dest is null then
    raise exception 'refus.introuvable.envoi' using errcode = 'no_data_found';
  end if;

  insert into notif.remises (envoi_id, resultat, erreur)
  values (p_envoi, p_resultat, p_erreur);

  if p_resultat = 'refuse' then
    update collab.push_devices set revoked_at = now(), updated_at = now()
     where user_id = v_dest and revoked_at is null;
  end if;

  return jsonb_build_object('envoi_id', p_envoi, 'resultat', p_resultat);
end
$function$;

CREATE OR REPLACE FUNCTION parametrage.verifier_compte_cabinet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_classe    text;
  v_collectif boolean;
  v_libelle   text;
begin
  -- 1. ne pas masquer un compte livré
  if exists (select 1 from ref.accounts a where a.account_code = NEW.account_code) then
    raise exception
      '%', app.refus_avec_valeurs('refus.plan.compte_livre', 'compte', (NEW.account_code)::text)
      using errcode = 'unique_violation';
  end if;

  -- 2. le parent existe, livré ou ouvert par ce cabinet
  select a.account_class, a.is_collective, a.label
    into v_classe, v_collectif, v_libelle
    from ref.accounts a where a.account_code = NEW.parent_code limit 1;

  if v_classe is null then
    select c.account_class, false, c.label into v_classe, v_collectif, v_libelle
      from parametrage.accounts c
     where c.account_code = NEW.parent_code and c.tenant_id = NEW.tenant_id
     limit 1;
  end if;

  if v_classe is null then
    raise exception
      '%', app.refus_avec_valeurs('refus.plan.rattachement_absent', 'compte', (NEW.parent_code)::text)
      using errcode = 'foreign_key_violation';
  end if;

  -- 3. un compte collectif prend des tiers, pas des subdivisions
  if v_collectif then
    raise exception
      '%', app.refus_avec_valeurs('refus.plan.compte_collectif', 'compte', (NEW.parent_code)::text, 'libelle', (v_libelle)::text)
      using errcode = 'check_violation';
  end if;

  -- 4. un compte prolonge son parent
  if position(NEW.parent_code in NEW.account_code) <> 1
     or length(NEW.account_code) <= length(NEW.parent_code) then
    raise exception
      '%', app.refus_avec_valeurs('refus.plan.prolonger_rattachement', 'compte', (NEW.account_code)::text, 'parent', (NEW.parent_code)::text)
      using errcode = 'check_violation';
  end if;

  -- 5. la classe se déduit
  NEW.account_class := v_classe;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION ref.appliquer_bareme(p_jurisdiction text, p_code text, p_date date, p_base numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
declare n int; bas numeric; total numeric;
begin

  with tr as (
    select b.ordre, b.taux, b.borne_max,
           coalesce(lag(b.borne_max) over (order by b.ordre), 0) as seuil_bas
    from ref.fiscal_scale_brackets b
    join ref.fiscal_parameters p
      on p.code = b.parameter_code and p.jurisdiction = b.jurisdiction
     and p.valid_from = b.valid_from
    where b.jurisdiction = p_jurisdiction and b.parameter_code = p_code
      and p.valid_from <= p_date and (p.valid_to is null or p.valid_to > p_date)
  )
  select count(*), min(seuil_bas),
         coalesce(sum(greatest(0, least(p_base, coalesce(borne_max, p_base)) - seuil_bas) * taux), 0)
    into n, bas, total
  from tr;

  if n = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.bareme_absent', 'code', (p_code)::text, 'date', (p_date)::text, 'juridiction', (p_jurisdiction)::text)
      using errcode = 'no_data_found';
  end if;

  -- Un barème dont la première tranche ne part pas de zéro est incomplet.
  -- Calculer dessus produirait un impôt faux, et personne ne le verrait.
  if bas <> 0 then
    raise exception
      'Barème % incomplet : la première tranche démarre à % au lieu de 0. Aucun calcul n''est effectué.',
      p_code, bas
      using errcode = 'data_exception';
  end if;

  return total;
end $function$;

CREATE OR REPLACE FUNCTION ref.parametre_fiscal(p_jurisdiction text, p_code text, p_date date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
declare r record;
begin
  select * into r from ref.fiscal_parameters
   where jurisdiction = p_jurisdiction and code = p_code
     and valid_from <= p_date and (valid_to is null or valid_to > p_date);

  if not found then
    raise exception
      '%', app.refus_avec_valeurs('refus.referentiel.parametre_fiscal_absent', 'code', (p_code)::text, 'juridiction', (p_jurisdiction)::text, 'date', (p_date)::text)
      using errcode = 'no_data_found';
  end if;

  if r.confiance = 'non_trouve' then
    raise exception
      '%', app.refus_avec_valeurs('refus.referentiel.parametre_fiscal_non_etabli', 'code', (p_code)::text, 'note', (coalesce(r.note,''))::text)
      using errcode = 'no_data_found';
  end if;

  if r.valeur_num is null then
    raise exception
      'Paramètre fiscal % n''est pas une valeur calculable (forme = %). Utilisez ref.parametre_fiscal_texte.',
      p_code, r.forme
      using errcode = 'wrong_object_type';
  end if;

  return r.valeur_num;
end $function$;

CREATE OR REPLACE FUNCTION ref.proteger_comptes_officiels()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if OLD.is_official and (
       NEW.account_code  is distinct from OLD.account_code or
       NEW.label         is distinct from OLD.label        or
       NEW.parent_code   is distinct from OLD.parent_code  or
       NEW.account_class is distinct from OLD.account_class or
       NEW.is_official   is distinct from OLD.is_official)
  then
    raise exception
      '%', app.refus_avec_valeurs('refus.plan.compte_officiel', 'compte', (OLD.account_code)::text)
      using errcode = 'insufficient_privilege';
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION ref.verifier_classe_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cls int;
  adm int[];
  lib text;
begin
  select a.account_class::int into cls
    from ref.accounts a where a.account_code = NEW.account_code limit 1;

  if cls is null and TG_TABLE_SCHEMA = 'parametrage' then
    select c.account_class::int into cls
      from parametrage.accounts c
     where c.account_code = NEW.account_code and c.tenant_id = NEW.tenant_id
     limit 1;
  end if;

  if cls is null then
    raise exception '%', app.refus_avec_valeurs('refus.ecriture.proposee_hors_plan', 'compte', (NEW.account_code)::text) using errcode = 'foreign_key_violation';
  end if;

  select r.classes_admises, r.libelle into adm, lib
    from ref.account_roles r where r.code = NEW.role_code;

  if not (cls = any(adm)) then
    raise exception
      '%', app.refus_avec_valeurs('refus.plan.classe_du_role', 'role', (lib)::text, 'code', (NEW.role_code)::text, 'classes', (adm)::text, 'compte', (NEW.account_code)::text, 'classe', (cls)::text)
      using errcode = 'check_violation';
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION socle.assert_bookable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'socle', 'identity', 'capture', 'ref', 'app', 'pg_catalog'
AS $function$
declare
  v_debit  numeric(38,3);
  v_credit numeric(38,3);
  v_count  integer;
  v_mode   app.validation_mode_t;
  v_kind   text;
  v_statut text;
  v_porte  boolean;
begin
  if new.status = 'booked' and (old.status is distinct from 'booked') then
    select count(*), coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
      into v_count, v_debit, v_credit
      from socle.ecriture_lignes l where l.ecriture_id = new.id;

    if v_count = 0 then
      raise exception 'refus.ecriture.sans_ligne'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception '%', app.refus_avec_valeurs('refus.ecriture.desequilibree', 'debit', (v_debit)::text, 'credit', (v_credit)::text)
        using errcode = 'check_violation';
    end if;

    /*
     * Ce qui a été photographié doit être un document qui porte écriture, et
     * son type doit être ÉTABLI — par le cabinet qui valide ou force
     * (`piece_type_etabli_par_le_cabinet`), ou par la personne qui l'a
     * précisé (`capture_precision_persist`).
     *
     * Une écriture sans pièce reste possible — une écriture d'à-nouveaux, une
     * régularisation. C'est le rattachement à une pièce qui est contrôlé, pas
     * son existence.
     *
     * Une photo reprise : c'est la version courante qui dit le type (un
     * règlement saisi sur l'ancienne garde son écriture sur l'ancienne).
     */
    if new.piece_id is not null then
      select p.document_kind, p.document_kind_statut
        into v_kind, v_statut
        from capture.pieces p where p.id = app.version_courante(new.piece_id);

      if v_statut is distinct from 'confirme' then
        raise exception 'refus.inscription.type_inconnu'
          using errcode = 'check_violation';
      end if;

      select t.porte_ecriture into v_porte
        from ref.document_types t where t.code = v_kind;

      if coalesce(v_porte, false) = false then
        raise exception 'refus.inscription.type_sans_ecriture'
          using errcode = 'check_violation';
      end if;
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome = 'valide' and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    if v_mode = 'mandate' and new.reviewed_by = new.booked_by then
      raise exception 'chk_ecr_4eyes : en mode mandat, le superviseur ne peut pas etre celui qui a comptabilise'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION tiers.verifier_compte_collectif()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_collectif boolean;
  v_libelle   text;
begin
  select a.is_collective, a.label into v_collectif, v_libelle
    from ref.accounts a where a.account_code = NEW.compte_collectif limit 1;

  -- Un cabinet peut avoir subdivisé un collectif : la subdivision hérite du
  -- caractère collectif de son parent.
  if v_collectif is null then
    select a.is_collective, c.label into v_collectif, v_libelle
      from parametrage.accounts c
      join ref.accounts a on a.account_code = c.parent_code
     where c.account_code = NEW.compte_collectif
       and c.tenant_id = NEW.tenant_id
     limit 1;
  end if;

  if v_collectif is null then
    raise exception '%', app.refus_avec_valeurs('refus.ecriture.proposee_hors_plan', 'compte', (NEW.compte_collectif)::text)
      using errcode = 'foreign_key_violation';
  end if;

  if not v_collectif then
    raise exception
      '%', app.refus_avec_valeurs('refus.tiers.compte_non_collectif', 'compte', (NEW.compte_collectif)::text, 'libelle', (v_libelle)::text)
      using errcode = 'check_violation';
  end if;

  return NEW;
end $function$;

commit;
