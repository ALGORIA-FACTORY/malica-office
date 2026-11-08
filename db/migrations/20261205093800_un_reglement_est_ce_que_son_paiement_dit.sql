-- Un règlement est ce que son paiement dit ; un engagement en vigueur se lit d'une seule façon.
--
-- ================================================================== POURQUOI
--
-- Vérification indépendante du lot S5 (7 novembre 2026,
-- `un-reglement-ne-deguise-pas-une-ecriture.test.ts`) : le lot S5 laisse à la PME
-- d'un dossier confié ses seules écritures de règlement. Or `socle_ecriture_propose`
-- pose `nature = 'reglement'` dès qu'on lui passe un paiement, quelles que soient
-- les lignes, et `socle_ecriture_book` n'arrête la PME que sur la nature `piece`.
-- Le propriétaire a proposé, avec un vrai paiement, une « écriture de règlement »
-- au journal des ventes, 607 / 707, et l'a inscrite dans les livres du cabinet. La
-- nature n'était qu'une étiquette.
--
-- Deuxième constat de la même revue : `app.livres_tenus_par_le_cabinet` lisait un
-- engagement `actif` sans ses dates, quand `app.engaged_orgs()` exige aussi
-- `starts_on <= aujourd'hui` et `ends_on` à venir. Un mandat `actif` hors de ses
-- dates fermait les livres à la PME sans les ouvrir au cabinet : personne ne les
-- tenait.
--
-- ================================================================== CE QUI CHANGE
--
--   1. `app.engagement_en_vigueur(statut, debut, fin)` : LE prédicat d'un mandat en
--      vigueur. `app.engaged_orgs`, `app.engaged_orgs_as_expert`,
--      `app.supervise_le_dossier` et `app.livres_tenus_par_le_cabinet` le lisent
--      tous les quatre (corps repris de la base vivante ; seul le prédicat change).
--   2. `app.comptes_du_role(dossier, rôle, pack, défaut)` : le compte d'un rôle à
--      trois niveaux (le dossier, le cabinet qui le tient, le défaut puis le pack)
--      — la lecture que faisaient `compteDuRole` dans l'API et `app.compte_du_role`
--      dans la base, qui l'appellent désormais : une seule source pour la
--      proposition du règlement, pour son contrôle et pour la sortie d'un bien.
--   3. `app.un_reglement_est_ce_que_son_paiement_dit()`, à la proposition comme à
--      l'inscription de toute écriture de règlement (hors contre-passation), quel
--      que soit l'auteur, en fin de transaction (les lignes suivent l'écriture) :
--        - le journal est celui du moyen de paiement (`ref.payment_means`, en
--          vigueur au jour du paiement) ;
--        - une seule ligne de trésorerie, au compte du moyen (résolu par le rôle),
--          du côté du sens (crédit à l'achat, débit à la vente), pour le montant
--          payé, dans la devise du paiement ;
--        - une seule ligne de tiers, de l'autre côté, au compte du tiers de la
--          pièce (celui de son écriture vivante, sinon celui du pack pour ce type) ;
--        - les autres lignes, s'il y en a, sont des retenues : du côté de la
--          trésorerie, à un compte de retenue résolu par son rôle.
--      L'équilibre reste le contrôle de `socle.assert_bookable`. Refus :
--      `refus.ecriture.reglement_hors_paiement` (fr, en, ar dans `@malica/socle`).
--
-- REJEU (R11) : aucune donnée de référence n'est écrite ; `create or replace`.

-- --- 1. Un mandat en vigueur ------------------------------------------------------------------------

create or replace function app.engagement_en_vigueur(p_statut text, p_debut date, p_fin date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_statut = 'actif'
     and (p_debut is null or p_debut <= current_date)
     and (p_fin is null or p_fin >= current_date)
$$;

revoke all on function app.engagement_en_vigueur(text, date, date) from public, anon;
grant execute on function app.engagement_en_vigueur(text, date, date) to authenticated;

create or replace function app.engaged_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and (select app.service()) is null
     and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
     and (
       app.has_org_role(e.cabinet_org_id, array['expert'])
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = e.cabinet_org_id
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     )
$function$;

create or replace function app.engaged_orgs_as_expert()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
     and app.has_org_role(e.cabinet_org_id, array['expert'])
$function$;

create or replace function app.supervise_le_dossier(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from identity.engagements e
     where e.pme_org_id = p_tenant
       and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
       and (app.has_org_role(e.cabinet_org_id, array['expert'])
            or (app.has_org_role(e.cabinet_org_id, array['collaborateur'])
                and exists (select 1 from collab.assignments a
                             where a.cabinet_tenant_id = e.cabinet_org_id
                               and a.client_tenant_id = p_tenant
                               and a.collaborator_id = auth.uid()
                               and a.active))))
$function$;

create or replace function app.livres_tenus_par_le_cabinet(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from identity.engagements g
                  where g.pme_org_id = p_tenant
                    and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on))
$$;

-- --- 2. Le compte d'un rôle, une seule lecture -------------------------------------------------------
--
-- Rend les comptes distincts que donnent les trois niveaux : un seul, c'est le
-- compte ; plusieurs, deux surcharges se contredisent (l'appelant refuse, il ne
-- départage pas) ; aucun ligne nulle, rien n'est paramétré. Lisible du seul dossier
-- dont l'appelant est membre, ou qu'il tient.

create or replace function app.comptes_du_role(p_tenant uuid, p_role text, p_pack uuid,
                                               p_defaut text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct coalesce(d.account_code, c.account_code, p_defaut,
           (select p.account_code from ref.role_bindings p
             where p.role_code = p_role and p.pack_version_id = p_pack))
    from (select 1) source
    left join parametrage.role_bindings d on d.role_code = p_role
      and d.portee = 'dossier' and d.portee_id = p_tenant
    left join parametrage.role_bindings c on c.role_code = p_role and c.portee = 'cabinet'
      and c.portee_id in (select g.cabinet_org_id from identity.engagements g
                           where g.pme_org_id = p_tenant
                             and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on))
   where p_tenant in (select app.member_orgs())
      or p_tenant in (select app.engaged_orgs())
      or auth.uid() is null
$$;

revoke all on function app.comptes_du_role(uuid, text, uuid, text) from public, anon;
grant execute on function app.comptes_du_role(uuid, text, uuid, text) to authenticated;

-- `app.compte_du_role` (la sortie d'une immobilisation) recopiait la même lecture :
-- elle lit désormais celle-ci, et garde son refus quand le compte n'est pas un.
create or replace function app.compte_du_role(p_tenant uuid, p_role text, p_pack uuid)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_comptes text[];
begin
  select array_agg(c) into v_comptes from app.comptes_du_role(p_tenant, p_role, p_pack, null) c;
  -- Deux surcharges contradictoires ne se départagent pas par l'ordre d'une requête.
  if coalesce(array_length(v_comptes, 1), 0) <> 1 or v_comptes[1] is null then
    raise exception 'refus.immo.sortie.compte_du_role' using errcode = '22023',
      detail = p_role;
  end if;
  return v_comptes[1];
end
$function$;

-- --- 3. Un règlement est ce que son paiement dit ------------------------------------------------------

create or replace function app.un_reglement_est_ce_que_son_paiement_dit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p         capture.paiements%rowtype;
  v_m         ref.payment_means%rowtype;
  v_sens      text;
  v_paye      numeric;
  v_tresorerie text[];
  v_tiers     text[];
  v_retenues  text[];
  v_n_tres    integer;
  v_n_tiers   integer;
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

  if v_p.id is null or v_m.id is null or v_p.montant_mineur is null
     or v_sens not in ('facture_achat', 'facture_vente')
     or v_p.devise is distinct from new.devise
     or new.journal is distinct from v_m.journal_code then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;

  v_paye := v_p.montant_mineur / power(10::numeric,
              (select d.exposant from ref.devises d where d.code = v_p.devise));

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
  -- Le tiers : celui que l'écriture vivante de la pièce porte de l'autre côté
  -- (le fournisseur crédité, le client débité), sinon celui du pack pour ce type.
  v_tiers := array(
    select l.account_code
      from socle.ecritures e join socle.ecriture_lignes l on l.ecriture_id = e.id
     where e.piece_id in (select app.versions_de_la_piece(new.piece_id))
       and e.nature = 'piece' and app.ecriture_vivante(e.id)
       and ((v_sens = 'facture_achat' and l.credit > 0) or (v_sens = 'facture_vente' and l.debit > 0))
    union
    select m.counterparty_account from ref.account_mappings m
     where m.pack_version_id = v_p.pack_version_id and m.document_kind = v_sens);
  v_retenues := array(
    select app.comptes_du_role(new.tenant_id, r.role, v_p.pack_version_id, null)
      from unnest(array[case when v_sens = 'facture_achat' then 'RETENUE_SOURCE_OPEREE'
                             else 'RETENUE_SOURCE_SUBIE' end,
                        'TVA_RETENUE_SUBIE']) as r(role));

  select count(*) filter (where l.account_code = any (v_tresorerie)
                            and ((v_sens = 'facture_achat' and l.credit = v_paye and l.debit = 0)
                              or (v_sens = 'facture_vente' and l.debit = v_paye and l.credit = 0))),
         count(*) filter (where l.account_code = any (v_tiers)
                            and ((v_sens = 'facture_achat' and l.debit > 0 and l.credit = 0)
                              or (v_sens = 'facture_vente' and l.credit > 0 and l.debit = 0)))
    into v_n_tres, v_n_tiers
    from socle.ecriture_lignes l where l.ecriture_id = new.id;

  if v_n_tres <> 1 or v_n_tiers <> 1
     or exists (
       -- Toute autre ligne est une retenue, du côté de la trésorerie.
       select 1 from socle.ecriture_lignes l
        where l.ecriture_id = new.id
          and not (l.account_code = any (v_tresorerie)
                   and ((v_sens = 'facture_achat' and l.credit = v_paye and l.debit = 0)
                     or (v_sens = 'facture_vente' and l.debit = v_paye and l.credit = 0)))
          and not (l.account_code = any (v_tiers)
                   and ((v_sens = 'facture_achat' and l.debit > 0 and l.credit = 0)
                     or (v_sens = 'facture_vente' and l.credit > 0 and l.debit = 0)))
          and not (l.account_code = any (v_retenues)
                   and ((v_sens = 'facture_achat' and l.credit > 0 and l.debit = 0)
                     or (v_sens = 'facture_vente' and l.debit > 0 and l.credit = 0)))) then
    raise exception 'refus.ecriture.reglement_hors_paiement' using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function app.un_reglement_est_ce_que_son_paiement_dit() from public, anon, authenticated;

-- Différé à la fin de la transaction, comme `ecriture_inscrite_dans_son_plan` : les
-- lignes s'insèrent après l'écriture. Une proposition hors paiement ne s'enregistre
-- donc pas (et n'efface plus, en passant, la proposition ouverte de ce paiement), et
-- une inscription relit les lignes une dernière fois.
drop trigger if exists ecritures_un_reglement_est_ce_que_son_paiement_dit on socle.ecritures;
create constraint trigger ecritures_un_reglement_est_ce_que_son_paiement_dit
  after insert or update of status on socle.ecritures
  deferrable initially deferred
  for each row execute function app.un_reglement_est_ce_que_son_paiement_dit();
