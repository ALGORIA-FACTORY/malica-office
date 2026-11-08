-- Un règlement ne s'invente ni retenue, ni date, ni compte de tiers ; un mandat en vigueur décide des livres.
--
-- ================================================================== POURQUOI
--
-- Vérification indépendante du lot S5b (7 novembre 2026,
-- `un-reglement-ne-s-invente-ni-retenue-ni-date.test.ts`). Le contrôle
-- `app.un_reglement_est_ce_que_son_paiement_dit()` liait le journal, la trésorerie et
-- le compte du tiers au paiement, mais :
--   - toute ligne au compte d'une retenue passait, quel qu'en soit le montant : la PME
--     d'un dossier confié inscrivait, pour 10 payés sans retenue, une dette fiscale de
--     90 et éteignait 100 de sa dette fournisseur ;
--   - la date était libre : un paiement d'octobre 2026 s'inscrivait en janvier 2020 ;
--   - le compte du tiers était « celui de l'écriture vivante OU celui du pack ». Depuis
--     le lot S2, la PME ne lit plus l'écriture du cabinet : le moteur du règlement
--     retombait sur le 401 du pack quand le cabinet avait inscrit la facture au 4011,
--     et le 4011 restait ouvert.
-- Et une trentaine de fonctions lisaient encore un mandat au seul statut `actif`.
--
-- ================================================================== CE QUI CHANGE
--
--   1. `app.comptes_du_tiers_de_la_piece(pièce, sens)` (interne) : les comptes, et
--      leurs montants, que l'écriture vivante de la pièce porte du côté du tiers (le
--      fournisseur crédité, le client débité). `app.compte_du_tiers_inscrit(pièce,
--      sens, montant)` en rend UNE valeur à qui lit la pièce, comme
--      `app.cours_de_l_ecriture_de_la_piece` (lot S2) : le code du compte ; '' quand
--      l'écriture vivante ne le dit pas sans ambiguïté ; null sans écriture vivante.
--      Le moteur du règlement (`scan/reglement.ts`) la lit au lieu de `ecritures_v`.
--   2. Le contrôle du règlement exige en plus :
--        - la date du paiement (`paye_le`) ;
--        - le compte du tiers de l'écriture vivante quand la pièce en a une, celui du
--          pack pour ce type sinon (un « sinon », plus une union) ;
--        - des retenues que le paiement DÉCLARE : la qualification posée avec lui
--          (le fait `reglement.qualifie` que consigne `office.proposerLeReglement`,
--          `codes`, `baseReglee`, `tvaReglee`, `assietteIR`). Chaque ligne de retenue
--          répond à un code déclaré, applicable au jour du paiement et dans le sens
--          de la pièce (`ref.retenues_au_reglement`), à son compte (le rôle de sa
--          famille) et pour taux × assiette arrondi au pair comme le moteur ; sans
--          qualification, aucune retenue ;
--        - le tiers éteint exactement le payé plus les retenues.
--   3. Les fonctions qui décident des livres lisent un mandat par
--      `app.engagement_en_vigueur` (statut ET dates) : `socle_ecriture_book`
--      (l'annulation d'un règlement), `app.annulation_contre_passe_le_reglement`,
--      `cours_de_change_saisir`, `app.ecriture_inscrite_dans_son_plan`,
--      `app.geler_la_prise_en_charge`, `retenues_du_mois`, `piece_retour` et
--      `piece_voir`. Corps repris de la base vivante ; seul le prédicat change.
--
-- REJEU (R11) : aucune donnée de référence n'est écrite ; `create or replace`.

-- --- 1. Le compte du tiers que l'écriture vivante porte -----------------------------------------------

create or replace function app.comptes_du_tiers_de_la_piece(p_piece uuid, p_sens text)
returns table (account_code text, montant numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.account_code,
         case when p_sens = 'facture_vente' then l.debit else l.credit end
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece' and app.ecriture_vivante(e.id)
     and ((p_sens = 'facture_achat' and l.credit > 0 and l.debit = 0)
       or (p_sens = 'facture_vente' and l.debit > 0 and l.credit = 0))
$$;

revoke all on function app.comptes_du_tiers_de_la_piece(uuid, text) from public, anon, authenticated;

create or replace function app.compte_du_tiers_inscrit(p_piece uuid, p_sens text, p_montant numeric)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not app.piece_lisible(p_piece)
      or not exists (select 1 from socle.ecritures e
                      where e.piece_id in (select app.versions_de_la_piece(p_piece))
                        and e.nature = 'piece' and app.ecriture_vivante(e.id))
      then null
    else coalesce(
      (select min(t.account_code) from app.comptes_du_tiers_de_la_piece(p_piece, p_sens) t
        where t.montant = p_montant
       having count(distinct t.account_code) = 1),
      '')
  end
$$;

revoke all on function app.compte_du_tiers_inscrit(uuid, text, numeric) from public, anon;
grant execute on function app.compte_du_tiers_inscrit(uuid, text, numeric) to authenticated;

comment on function app.compte_du_tiers_inscrit(uuid, text, numeric) is
  'Le compte du tiers que l''écriture vivante de la pièce porte pour ce montant : une valeur, '
  'rien d''autre de l''écriture du cabinet (lots S2, S5b). Null sans écriture vivante, '''' '
  'quand elle ne le dit pas sans ambiguïté.';

-- --- 2. Un règlement est ce que son paiement dit, retenues et date comprises --------------------------

create or replace function app.un_reglement_est_ce_que_son_paiement_dit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p          capture.paiements%rowtype;
  v_m          ref.payment_means%rowtype;
  v_sens       text;
  v_exposant   integer;
  v_paye       numeric;
  v_q          jsonb;
  v_codes      text[];
  v_tresorerie text[];
  v_tiers      text[];
  v_attendues  text[];
  v_retenues   numeric;
  v_ligne_tres uuid;
  v_ligne_tiers uuid;
  v_montant_tiers numeric;
  v_autres     text[];
  v_declarees  boolean;
begin
  -- Une proposition remplacée dans la même transaction n'a plus rien à dire.
  if new.nature <> 'reglement' or new.reverses_id is not null
     or not exists (select 1 from socle.ecritures e where e.id = new.id) then
    return null;
  end if;

  select * into v_p from capture.paiements where id = new.paiement_id;
  select p.document_kind into v_sens
    from capture.pieces p where p.id = app.version_courante(new.piece_id);
  select * into v_m from ref.payment_means m
   where m.pack_version_id = v_p.pack_version_id and m.code = v_p.moyen_code
     and m.valid_from <= v_p.paye_le and (m.valid_to is null or m.valid_to >= v_p.paye_le);
  select d.exposant into v_exposant from ref.devises d where d.code = v_p.devise;

  if v_p.id is null or v_m.id is null or v_p.montant_mineur is null or v_exposant is null
     or v_sens not in ('facture_achat', 'facture_vente')
     or v_p.devise is distinct from new.devise
     or new.journal is distinct from v_m.journal_code
     or new.date_ecriture is distinct from v_p.paye_le then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  v_paye := v_p.montant_mineur / power(10::numeric, v_exposant);

  -- La trésorerie : le compte du moyen, par son rôle quand le moyen en nomme un.
  v_tresorerie := case
    when (case when v_sens = 'facture_vente' then v_m.role_vente else v_m.role_achat end) is null
      then array[case when v_sens = 'facture_vente' then v_m.tresorerie_account_vente
                      else v_m.tresorerie_account end]
    else array(select app.comptes_du_role(
                 new.tenant_id,
                 case when v_sens = 'facture_vente' then v_m.role_vente else v_m.role_achat end,
                 v_p.pack_version_id,
                 case when v_sens = 'facture_vente' then v_m.tresorerie_account_vente
                      else v_m.tresorerie_account end))
  end;
  -- Le tiers : celui de l'écriture vivante de la pièce ; sans elle, celui du pack.
  v_tiers := array(select distinct t.account_code
                     from app.comptes_du_tiers_de_la_piece(new.piece_id, v_sens) t);
  if cardinality(v_tiers) = 0 then
    v_tiers := array(select distinct m.counterparty_account from ref.account_mappings m
                      where m.pack_version_id = v_p.pack_version_id and m.document_kind = v_sens);
  end if;

  -- La trésorerie et le tiers : une ligne chacun.
  select min(l.id::text)::uuid into v_ligne_tres
    from socle.ecriture_lignes l
   where l.ecriture_id = new.id and l.account_code = any (v_tresorerie)
     and ((v_sens = 'facture_achat' and l.credit = v_paye and l.debit = 0)
       or (v_sens = 'facture_vente' and l.debit = v_paye and l.credit = 0))
  having count(*) = 1;
  select min(l.id::text)::uuid, min(case when v_sens = 'facture_achat' then l.debit else l.credit end)
    into v_ligne_tiers, v_montant_tiers
    from socle.ecriture_lignes l
   where l.ecriture_id = new.id and l.account_code = any (v_tiers)
     and ((v_sens = 'facture_achat' and l.debit > 0 and l.credit = 0)
       or (v_sens = 'facture_vente' and l.credit > 0 and l.debit = 0))
  having count(*) = 1;
  if v_ligne_tres is null or v_ligne_tiers is null then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  -- Les retenues : celles que le paiement déclare, et rien d'autre.
  select a.payload -> 'qualification' into v_q
    from audit.event_log a
   where a.object_id = new.id and a.action = 'reglement.qualifie'
   order by a.at desc limit 1;
  v_codes := case when jsonb_typeof(v_q -> 'codes') = 'array'
                  then array(select jsonb_array_elements_text(v_q -> 'codes'))
                  else '{}'::text[] end;
  with taux as (
    select r.code, r.taux, r.famille,
           case when r.base = 'tva' then nullif(v_q ->> 'tvaReglee', '')::numeric
                else coalesce(nullif(v_q ->> 'assietteIR', '')::numeric,
                              nullif(v_q ->> 'baseReglee', '')::numeric) end as assiette
      from ref.retenues_au_reglement(
             (select o.jurisdiction from identity.organizations o where o.id = new.tenant_id),
             v_p.paye_le) r
     where r.code = any (v_codes)
       and r.sens in ('tous', case when v_sens = 'facture_achat' then 'achat' else 'vente' end)
  ), attendues as (
    select (select c from app.comptes_du_role(
              new.tenant_id,
              case when t.famille = 'tva' then 'TVA_RETENUE_SUBIE'
                   when v_sens = 'facture_achat' then 'RETENUE_SOURCE_OPEREE'
                   else 'RETENUE_SOURCE_SUBIE' end,
              v_p.pack_version_id, null) c) as compte,
           app.arrondi_au_pair(t.assiette * t.taux, v_exposant) as montant
      from taux t
  )
  select array(select a.compte || '|' || trim_scale(a.montant)::text from attendues a
                order by 1),
         coalesce((select sum(a.montant) from attendues a), 0),
         (select count(*) from attendues) = cardinality(v_codes)
            and not exists (select 1 from attendues a where a.compte is null or a.montant is null
                                                       or a.montant <= 0)
    into v_attendues, v_retenues, v_declarees
    from (select 1) x;
  if v_declarees is not true then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  v_autres := array(
    select l.account_code || '|' ||
           trim_scale(case when v_sens = 'facture_achat' then l.credit else l.debit end)::text
      from socle.ecriture_lignes l
     where l.ecriture_id = new.id and l.id not in (v_ligne_tres, v_ligne_tiers)
       and ((v_sens = 'facture_achat' and l.credit > 0 and l.debit = 0)
         or (v_sens = 'facture_vente' and l.debit > 0 and l.credit = 0))
     order by 1);
  if v_autres is distinct from v_attendues
     or (select count(*) from socle.ecriture_lignes l where l.ecriture_id = new.id)
        <> 2 + cardinality(v_attendues)
     or v_montant_tiers <> v_paye + v_retenues then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function app.un_reglement_est_ce_que_son_paiement_dit() from public, anon, authenticated;

-- --- 3. Un mandat en vigueur décide des livres ---------------------------------------------------------

-- socle_ecriture_book(uuid) : 1 remplacement(s)
CREATE OR REPLACE FUNCTION public.socle_ecriture_book(p_ecriture uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_nature  text;
  v_paiement uuid;
  v_reverses uuid;
  v_dossier uuid;
begin
  select piece_id into v_piece from socle.ecritures where id = p_ecriture;
  -- La pièce de l'écriture ET sa version courante — celle que le contrôle R2
  -- juge —, dans l'ordre des identifiants : une reprise ou une suppression de
  -- la courante attend cette inscription, puis la voit.
  if v_piece is not null then
    perform 1 from capture.pieces
     where id in (v_piece, app.version_courante(v_piece)) order by id for update;
  end if;

  select e.nature, e.paiement_id, e.reverses_id, e.tenant_id
    into v_nature, v_paiement, v_reverses, v_dossier
    from socle.ecritures e where e.id = p_ecriture and e.status = 'proposee';

  -- L'annulation d'un règlement, dans un dossier confié à une comptabilité,
  -- est inscrite par l'expert mandaté, et par lui seul (revue du 24 octobre
  -- 2026) : la PME ne touche pas au grand livre qu'elle a confié.
  if v_nature = 'reglement' and v_reverses is not null
     and exists (select 1 from identity.engagements g
                  where g.pme_org_id = v_dossier and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on))
     and v_dossier not in (select app.engaged_orgs_as_expert()) then
    raise exception 'refus.reserve.expert_mandate'
      using errcode = '42501', hint = 'reglement.annulation_expert';
  end if;
  -- L'écriture d'une pièce, dans un dossier EN MANDAT confié à un cabinet
  -- engagé, est l'acte du cabinet (« Malica sans blocage ») : le client ne
  -- voit ni ne confirme d'écriture, il n'en inscrit donc pas non plus. Le
  -- dossier AUTONOME tient lui-même ses livres (`booked_autonome`), et un
  -- dossier sans cabinet n'a personne d'autre pour les tenir : ces deux cas
  -- restent ouverts. Le règlement, lui, reste un geste de la PME (`pme.regler`).
  if v_nature = 'piece'
     and app.livres_tenus_par_le_cabinet(v_dossier)
     and not app.supervise_le_dossier(v_dossier) then
    raise exception 'refus.inscription.reservee_au_cabinet'
      using errcode = '42501', hint = 'inscription.cabinet';
  end if;
  -- Une contre-passation éteint l'écriture vivante : elle ne la double pas.
  if v_nature is not null and v_piece is not null and v_reverses is null and exists (
       select 1 from socle.ecritures o
        where o.piece_id = v_piece and o.id <> p_ecriture
          and o.nature = v_nature and o.paiement_id is not distinct from v_paiement
          and app.ecriture_vivante(o.id)) then
    raise exception 'refus.ecriture.deja_inscrite'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  update socle.ecritures
     set status = 'booked',
         booked_by = auth.uid(),
         booked_at = now(),
         updated_at = now()
   where id = p_ecriture and status = 'proposee'
  returning tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'refus.ecriture.non_inscriptible'
      using errcode = '42501';
  end if;

  -- Un règlement inscrit ne fait pas repasser une facture supervisée en
  -- « comptabilisée » : seule l'écriture de la facture fait le statut. Celle
  -- que le cabinet inscrit est prise en charge (le déclencheur vient de le
  -- poser) : la pièce est supervisée.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when exists (select 1 from socle.prises_en_charge x
                                       where x.ecriture_id = p_ecriture)
                         then 'supervisee' else 'comptabilisee' end,
           updated_at = now()
     where id = v_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece, 'nature', v_nature,
                             'paiement_id', v_paiement));
end
$function$;

-- app.annulation_contre_passe_le_reglement() : 1 remplacement(s)
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
                   where g.pme_org_id = new.tenant_id and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on)) then
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

-- cours_de_change_saisir(uuid,text,text,date,numeric,integer,text,text,uuid) : 2 remplacement(s)
CREATE OR REPLACE FUNCTION public.cours_de_change_saisir(p_org uuid, p_devise text, p_vers_devise text, p_date date, p_taux numeric, p_unite integer, p_source text, p_motif text DEFAULT NULL::text, p_dossier uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id      uuid;
  v_motif   text := nullif(btrim(coalesce(p_motif, '')), '');
  v_origine text;
begin
  if auth.uid() is null or p_org is null or p_org not in (select app.member_orgs()) then
    raise exception 'refus.cours.supervision' using errcode = '42501';
  end if;
  if not (
       exists (select 1 from identity.engagements g
                where g.cabinet_org_id = p_org and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on)
                  and app.peut_superviser(g.pme_org_id))
       or (not app.livres_tenus_par_le_cabinet(p_org) and app.peut_superviser(p_org))) then
    raise exception 'refus.cours.supervision' using errcode = '42501';
  end if;
  if p_dossier is not null and not (
       app.peut_superviser(p_dossier)
       and (p_dossier = p_org
            or exists (select 1 from identity.engagements g
                        where g.cabinet_org_id = p_org and g.pme_org_id = p_dossier
                          and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on)))) then
    raise exception 'refus.cours.supervision' using errcode = '42501';
  end if;
  if p_dossier is not null and v_motif is null then
    raise exception 'refus.cours.derogation_sans_motif' using errcode = '22023';
  end if;
  if p_taux is null or p_taux <= 0 or p_unite is null or p_unite <= 0
     or p_unite::text !~ '^10*$' or p_date is null then
    raise exception 'refus.cours.invalide' using errcode = '22023';
  end if;
  if p_devise = p_vers_devise
     or not exists (select 1 from ref.devises d where d.code = p_devise)
     or not exists (select 1 from ref.devises d where d.code = p_vers_devise)
     or not exists (select 1 from ref.sources_de_cours s where s.code = p_source) then
    raise exception 'refus.cours.invalide' using errcode = '22023';
  end if;
  v_origine := case when p_dossier is not null then 'derogation_dossier'
                    when v_motif is not null then 'derogation_cabinet'
                    else 'saisie' end;

  insert into parametrage.cours_de_change
    (tenant_id, dossier_id, origine, devise, vers_devise, date_du_cours, taux, unite, source,
     motif, saisi_par)
  values (p_org, p_dossier, v_origine, p_devise, p_vers_devise, p_date, p_taux, p_unite, p_source,
          v_motif, auth.uid())
  returning id into v_id;

  -- Identique au dernier de sa clé : rien de nouveau (un double clic).
  if v_id is null then
    select c.id into v_id from parametrage.cours_de_change c
     where c.tenant_id = p_org and c.dossier_id is not distinct from p_dossier
       and c.origine = v_origine and c.devise = p_devise and c.vers_devise = p_vers_devise
       and c.date_du_cours = p_date and c.source = p_source
     order by c.saisi_le desc, c.id desc
     limit 1;
    return v_id;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_org, auth.uid(), 'cours_de_change.saisi', 'parametrage', 'cours_de_change', v_id,
          jsonb_build_object('devise', p_devise, 'vers_devise', p_vers_devise,
                             'date', p_date, 'taux', p_taux, 'unite', p_unite,
                             'source', p_source, 'origine', v_origine, 'motif', v_motif,
                             'dossier', p_dossier));
  return v_id;
end $function$;

-- app.ecriture_inscrite_dans_son_plan() : 1 remplacement(s)
CREATE OR REPLACE FUNCTION app.ecriture_inscrite_dans_son_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
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
         where e.pme_org_id = new.tenant_id and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on))))
  order by l.ordinal limit 1;
 if v_manquant is not null then
   raise exception '%', app.refus_avec_valeurs('refus.ecriture.compte_hors_plan', 'compte', (v_manquant)::text) using errcode = '22023';
 end if;
 return null;
end $function$;

-- app.geler_la_prise_en_charge() : 1 remplacement(s)
CREATE OR REPLACE FUNCTION app.geler_la_prise_en_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_par uuid;
  v_le  timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'booked' then return null; end if;
    v_par := new.booked_by;
    v_le := new.booked_at;
  elsif new.status = 'booked' and old.status is distinct from 'booked' then
    v_par := new.booked_by;
    v_le := new.booked_at;
  elsif new.review_outcome = 'valide' and new.reviewed_at is distinct from old.reviewed_at then
    v_par := new.reviewed_by;
    v_le := new.reviewed_at;
  else
    return null;
  end if;

  insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
  select e.cabinet_org_id, new.id, new.tenant_id, v_par, app.nom_au_moment(v_par), v_le
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id and m.user_id = v_par
   where e.pme_org_id = new.tenant_id and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
  on conflict (tenant_id, ecriture_id) do nothing;

  if new.reverses_id is not null and new.status = 'booked' then
    insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
    select o.tenant_id, new.id, new.tenant_id, v_par, app.nom_au_moment(v_par), v_le
      from socle.prises_en_charge o
     where o.ecriture_id = new.reverses_id
    on conflict (tenant_id, ecriture_id) do nothing;
  end if;
  return null;
end $function$;

-- retenues_du_mois(uuid,date) : 1 remplacement(s)
CREATE OR REPLACE FUNCTION public.retenues_du_mois(p_tenant uuid, p_periode date)
 RETURNS TABLE(ecriture_id uuid, date_ecriture date, ecriture text, ligne text, compte text, sens text, montant numeric, statut text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with roles (role, sens) as (values
    ('RETENUE_SOURCE_OPEREE', 'operee'),
    ('RETENUE_SOURCE_SUBIE',  'subie'),
    ('TVA_RETENUE_SUBIE',     'subie')),
  ecritures as (
    select e.* from socle.ecritures e
     where e.status = 'booked' and e.tenant_id = p_tenant
       and e.date_ecriture >= date_trunc('month', p_periode)::date
       and e.date_ecriture < (date_trunc('month', p_periode) + interval '1 month')::date),
  comptes as (
    select distinct e.pack_version_id, ro.sens,
           coalesce(d.account_code, c.account_code, p.account_code) as compte
      from (select distinct pack_version_id from ecritures) e
      cross join roles ro
      left join ref.role_bindings p
        on p.role_code = ro.role and p.pack_version_id = e.pack_version_id
      left join public.parametrage_role_bindings_v d
        on d.role_code = ro.role and d.portee = 'dossier' and d.portee_id = p_tenant
      left join public.parametrage_role_bindings_v c
        on c.role_code = ro.role and c.portee = 'cabinet'
       and c.portee_id in (select g.cabinet_org_id from identity.engagements g
                            where g.pme_org_id = p_tenant and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on)))
  select e.id, e.date_ecriture, e.libelle, l.libelle, l.account_code, k.sens,
         case k.sens when 'operee' then l.credit - l.debit else l.debit - l.credit end,
         e.status
    from ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
    join comptes k on k.pack_version_id = e.pack_version_id and k.compte = l.account_code
   order by k.sens, e.date_ecriture, e.id, l.ordinal
$function$;

-- piece_retour(uuid,text) : 1 remplacement(s)
CREATE OR REPLACE FUNCTION public.piece_retour(p_piece uuid, p_locale text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with recursive p as (
    select id, tenant_id, status, vis from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
       and app.piece_lisible(p_piece)
       and not exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
  ),
  versions(id) as (
    select id from p
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  ),
  du_proprietaire as (
    select f.le as decided_at, f.note, f.motif_id, f.par_nom as qui
      from app.dernier_fait_du_circuit(p_piece) f, p
     where p.vis = 'entite'::app.vis_t and f.fait = 'retournee'
  ),
  du_cabinet as (
    select c.decided_at, c.note, c.motif_id,
           (select o.name
              from identity.engagements e
              join identity.organizations o on o.id = e.cabinet_org_id
             where e.pme_org_id = (select tenant_id from p) and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
             order by e.starts_on desc nulls last limit 1) as qui
      from capture.conformite c join versions v on v.id = c.piece_id
     where c.verdict = 'a_corriger'::app.verdict_t
       and (select status from p) = 'retournee'
       and (select vis from p) = 'partage'::app.vis_t
     order by c.decided_at desc limit 1
  ),
  c as (
    select *, 'proprietaire'::text as chez from du_proprietaire
    union all
    select *, 'cabinet'::text from du_cabinet
  )
  select jsonb_build_object(
      'le', c.decided_at,
      'note', c.note,
      'motif', m.code,
      'motifLibelle', coalesce(l.value, lf.value, m.code),
      'geste', m.geste,
      'chez', c.chez,
      'qui', c.qui,
      'fait', case m.preuve
        when 'aucune' then true
        when 'rattachement' then exists (
          select 1 from public.rattachements_v r join versions v
              on v.id in (r.piece_id, r.piece_liee_id)
           where r.fait = 'rattache'
             and r.created_at > c.decided_at)
          or (m.geste = 'reprendre_photo' and exists (
          select 1 from capture.remplacements r join versions v on v.id = r.remplacee_par
           where r.created_at > c.decided_at))
        when 'precision' then exists (
          select 1 from capture.precisions pr join versions v on v.id = pr.piece_id
           where pr.champ = 'document_date'
             and pr.decided_at > c.decided_at)
        when 'reponse' then exists (
          select 1 from audit.event_log ev join versions v on v.id = ev.object_id
           where ev.action = 'piece.reponse_client'
             and ev.at > c.decided_at)
        else false end)
    from c
    join ref.rejet_motifs m on m.id = c.motif_id
    left join ref.labels l on l.ns = 'rejet_motif' and l.key = m.code and l.locale = p_locale
    left join ref.labels lf on lf.ns = 'rejet_motif' and lf.key = m.code and lf.locale = 'fr'
   limit 1
$function$;

-- piece_voir(uuid) : 1 remplacement(s)
CREATE OR REPLACE FUNCTION public.piece_voir(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_cabinet uuid;
  v_archivee timestamptz;
  v_depuis  timestamptz;
  v_le      timestamptz;
  v_membre  boolean;
  v_rien    constant jsonb := jsonb_build_object('piece_id', p_piece, 'vue_le', null,
                                                 'deja', false);
begin
  select tenant_id, vis, archivee_le into v_tenant, v_vis, v_archivee
    from capture.pieces where id = p_piece;
  v_membre := coalesce(v_tenant in (select app.member_orgs()) and app.piece_lisible(p_piece),
                       false);

  -- Dans la société : le propriétaire qui ouvre la pièce qu'un siège lui a
  -- envoyée la « voit ». Ouvrir n'importe quelle autre pièce de la société
  -- n'écrit rien, et ne refuse rien : l'écran ouvre, la base décide. Une pièce
  -- PARTAGÉE prend le passage du comptable, même pour qui est membre des deux
  -- côtés (compte de développement : la « Vue » du cabinet ne s'écrivait plus).
  if v_membre and v_vis = 'entite'::app.vis_t then
    if v_archivee is not null
       or not app.a_le_droit(v_tenant, 'circuit.recevoir')
       -- L'accès total ouvre sans « voir » : le siège croirait que son
       -- propriétaire a vu la pièce (20261129090000).
       or exists (select 1 from app.mes_adhesions() a
                   where a.tenant_id = v_tenant and a.par_acces_total)
       or exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
       or (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      return v_rien;
    end if;
    -- Une « Vue » par envoi et par correction de l'auteur — la première, quel
    -- que soit le propriétaire : deux propriétaires qui ouvrent ensemble n'en
    -- écrivent qu'une (l'index unique tranche).
    v_depuis := greatest(app.dernier_envoi_au_proprietaire(p_piece),
                         coalesce(app.corrigee_par_l_auteur(p_piece), '-infinity'::timestamptz));
    insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
    values (v_tenant, p_piece, v_tenant, auth.uid(), app.prenom_au_moment(auth.uid()), v_depuis)
    on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
    returning vue_le into v_le;
    if v_le is not null then
      return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
    end if;
    select v.vue_le into v_le
      from capture.vues v
     where v.tenant_id = v_tenant and v.piece_id = p_piece
       and v.cabinet_org_id = v_tenant and v.depuis = v_depuis;
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
  end if;

  -- Le comptable : repris de `20261030090000`. Un membre qui n'est pas du
  -- cabinet ouvre sans rien écrire.
  if v_tenant is null or v_vis <> 'partage'::app.vis_t then
    if v_membre then
      return v_rien;
    end if;
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id
   where e.pme_org_id = v_tenant and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on) and m.user_id = auth.uid()
     and v_tenant in (select app.mandats_visibles(e.cabinet_org_id))
   order by e.starts_on desc nulls last
   limit 1;
  if v_cabinet is null then
    if v_membre then
      return v_rien;
    end if;
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_archivee is not null
     or exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return v_rien;
  end if;

  v_depuis := coalesce(greatest(app.dernier_envoi(p_piece), app.corrigee_par_le_client(p_piece)),
                       '-infinity'::timestamptz);
  insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
  values (v_tenant, p_piece, v_cabinet, auth.uid(), app.nom_au_moment(auth.uid()), v_depuis)
  on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
  returning vue_le into v_le;
  if v_le is not null then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
  end if;

  select v.vue_le into v_le
    from capture.vues v
   where v.tenant_id = v_tenant and v.piece_id = p_piece
     and v.cabinet_org_id = v_cabinet and v.depuis = v_depuis;
  return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
end
$function$;

