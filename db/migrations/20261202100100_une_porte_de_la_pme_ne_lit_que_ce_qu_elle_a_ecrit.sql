-- Une porte de la PME ne lit que ce qu'elle a écrit (lot S2, revue
-- indépendante du 6 novembre 2026).
--
-- `20261202100000` rendait au PORTIER, dans un dossier confié, les branches
-- de lecture de la PME d'avant le lot : toute écriture, toute ligne et tout
-- fait du dossier pour qui voit toute la société. Une porte s'exécute « sous
-- les mêmes politiques que son appelant » (R6) ; celles-là la rendaient plus
-- large que lui. La revue l'a reproduit : `fait_consigner` lit son objet sous
-- le portier, et le propriétaire de la PME consignait `reglement.qualifie` sur
-- l'écriture d'ACHAT du cabinet — il apprenait qu'elle existait, et écrivait
-- dans la piste du cabinet. Elle a trouvé un second chemin :
-- `socle_totaux_par_classe` prenait des bornes libres, et borné à un seul jour,
-- il rendait le débit et le crédit, classe par classe, de l'écriture de ce
-- jour.
--
-- 1. LE PORTIER ne lit plus, au-delà de son appelant, que ce que cet appelant
--    a lui-même ÉCRIT : une écriture qu'il a créée (`created_by`), ses
--    lignes, et un fait dont il est l'acteur. C'est ce que ses portes relisent
--    — `insert … returning`, la transmission d'une écriture proposée avec sa
--    pièce, la ligne qu'une porte vient de poser. Le règlement, geste de la
--    PME, est déjà lisible de l'appelant (`20261202100000`, §2). Une écriture
--    du CABINET n'est lisible d'aucune porte de la PME : une porte qui en a
--    besoin d'une valeur passe par une fonction qui ne rend que cette valeur
--    (le jour, le cours : `20261202100000`, §4).
--
-- 2. `fait_consigner` exige en outre qu'un fait `reglement.*` porte sur une
--    écriture de RÈGLEMENT.
--
-- 3. `socle_totaux_par_classe` ne se lit que par MOIS ENTIERS : du premier
--    jour d'un mois au dernier jour d'un mois, sinon
--    `refus.saisie.mois_entiers`. L'accueil lit deux mois entiers.
--
-- REJEU (R11) : `drop policy if exists`, `create or replace` ; aucune donnée
-- de référence n'est écrite.

begin;

-- --- 1. Ce que le portier lit au-delà de son appelant ------------------------------------------------

drop policy if exists socle_ecritures_sel_porte on socle.ecritures;
create policy socle_ecritures_sel_porte on socle.ecritures
  for select to portier
  using (created_by = (select auth.uid())
         and tenant_id in (select app.member_orgs()));

drop policy if exists socle_ecriture_lignes_sel_porte on socle.ecriture_lignes;
create policy socle_ecriture_lignes_sel_porte on socle.ecriture_lignes
  for select to portier
  using (tenant_id in (select app.member_orgs())
         and exists (select 1 from socle.ecritures e
                      where e.id = ecriture_id
                        and e.created_by = (select auth.uid())));

drop policy if exists audit_event_log_sel_porte on audit.event_log;
create policy audit_event_log_sel_porte on audit.event_log
  for select to portier
  using (actor = (select auth.uid())
         and tenant_id in (select app.member_orgs()));

-- « Renvoyer » (`piece_renvoyer`, au portier) efface les propositions de la
-- pièce calculées sur l'ancienne lecture — celles du Socle ou du cabinet, que
-- la PME ne lit plus. L'effacement passe en `security definer` : il ne rend
-- rien, n'efface que les propositions de PIÈCE encore ouvertes, et seulement
-- d'une pièce que l'appelant lit. Repris de
-- `20261029100000_une_piece_retournee_ne_bloque_jamais`, la garde en plus.
create or replace function app.piece_oublie_ses_propositions(p_piece uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from socle.ecritures e
   where e.piece_id = p_piece
     and e.status = 'proposee'
     and e.reverses_id is null
     and e.nature = 'piece'
     and app.piece_lisible(p_piece)
$$;

-- --- 2. Un fait de règlement porte sur un règlement --------------------------------------------------
--
-- Repris de `20261110090100_les_refus_se_disent_par_une_cle_public`, la nature
-- de l'écriture en plus.

create or replace function public.fait_consigner(p_action text, p_objet uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref     ref.faits_consignables%rowtype;
  v_tenant  uuid;
  v_pack    uuid;
  v_nature  text;
  v_id      uuid;
begin
  select * into v_ref from ref.faits_consignables where action = p_action;
  if not found then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  -- L'objet se lit sous la RLS de l'appelant : ce qu'il ne voit pas
  -- n'existe pas pour lui.
  if (v_ref.object_schema, v_ref.object_table) = ('socle', 'ecritures') then
    select e.tenant_id, e.pack_version_id, e.nature into v_tenant, v_pack, v_nature
      from public.ecritures_v e where e.id = p_objet;
  else
    select p.tenant_id into v_tenant from public.pieces_v p where p.id = p_objet;
  end if;
  if v_tenant is null then
    raise exception 'refus.introuvable' using errcode = '42501';
  end if;
  -- Un fait de règlement ne se pose que sur un règlement (lot S2).
  if p_action like 'reglement.%' and v_nature is distinct from 'reglement' then
    raise exception 'refus.introuvable' using errcode = '42501';
  end if;

  if (v_ref.garde = 'superviseur' and not app.peut_superviser(v_tenant))
     or (v_ref.garde = 'redacteur'
         and v_tenant not in (select app.member_orgs())
         and not app.supervise_le_dossier(v_tenant)) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), p_action, v_ref.object_schema, v_ref.object_table,
          p_objet, v_pack, p_payload)
  returning id into v_id;
  return v_id;
end
$$;

-- --- 3. Les totaux par classe, par mois entiers -----------------------------------------------------

create or replace function public.socle_totaux_par_classe(
  p_tenant uuid,
  p_from date,
  p_to date
) returns table (
  mois text,
  classe text,
  debit numeric(38,3),
  credit numeric(38,3)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Un jour, une semaine, isoleraient les montants d'une écriture : seuls des
  -- mois entiers se lisent.
  if p_from is null or p_to is null or p_from > p_to
     or p_from <> date_trunc('month', p_from)::date
     or p_to <> (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date then
    raise exception 'refus.saisie.mois_entiers' using errcode = '22023';
  end if;

  -- La définition de « comptabilisé » est celle de `socle_periode_lignes` :
  -- une écriture `booked` de la période, contre-passations comprises (elles
  -- s'annulent dans la somme).
  return query
  select to_char(e.date_ecriture, 'YYYY-MM'), c.prefix, sum(l.debit), sum(l.credit)
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
    cross join lateral (
      select k.prefix
        from ref.account_classes k
       where k.pack_version_id = e.pack_version_id
         and starts_with(l.account_code, k.prefix)
         and k.valid_from <= e.date_ecriture
         and (k.valid_to is null or k.valid_to >= e.date_ecriture)
       order by length(k.prefix) desc
       limit 1) c
   where e.tenant_id = p_tenant
     and e.status = 'booked'
     and e.date_ecriture between p_from and p_to
     and (p_tenant in (select app.orgs_avec_droit('societe.tout_voir'))
          or p_tenant in (select app.engaged_orgs())
          or app.plateforme_requise(p_tenant))
   group by 1, 2
   order by 1, 2;
end
$$;

commit;
