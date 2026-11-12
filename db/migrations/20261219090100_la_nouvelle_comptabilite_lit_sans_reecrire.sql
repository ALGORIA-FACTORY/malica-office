-- La nouvelle comptabilité lit l'historique, sans réécrire celui de l'ancienne
-- (décision du dirigeant du 12 novembre 2026, 7.3).
--
-- Fondement donné par le dirigeant : les livres sont tenus sans blanc ni
-- altération (loi 96-112, art. 11) ; l'expert appelé à remplacer un confrère
-- l'en informe d'abord par lettre recommandée avec accusé de réception (code
-- des devoirs professionnels de l'OECT, art. 12).
--
-- CE QUI ÉTAIT FAUX. Mandatée, la nouvelle comptabilité lisait déjà tout le
-- dossier — c'est voulu — mais elle pouvait aussi REVOIR une écriture que
-- l'ancienne avait inscrite (`socle_ecriture_review` réécrit `reviewed_by`,
-- `reviewed_at`, `review_outcome` de la ligne) et la « retourner » au client ;
-- sa contre-passation se datait du jour de l'écriture d'origine, dans la
-- période de l'ancienne. Personne n'apprenait le changement : ni l'ancienne,
-- ni le journal.
--
-- CE QUE POSE CETTE MIGRATION.
--
--   1. `app.comptabilite_de_l_ecriture` : la comptabilité qui a inscrit une
--      écriture — celle de sa prise en charge (`socle.prises_en_charge`) dont
--      la personne qui l'a prise était membre. La copie qu'une contre-passation
--      laisse au journal de l'ancienne (`app.geler_la_prise_en_charge`) porte
--      la personne de la NOUVELLE : elle ne compte pas.
--   2. Une écriture d'une autre comptabilité ne se revoit pas : ni validée de
--      nouveau, ni retournée. Le refus est posé par déclencheur, sous toutes
--      les portes qui revoient (`refus.ecriture.d_un_confrere`).
--   3. Sa contre-passation se date du JOUR où on la passe, jamais dans la
--      période de l'ancienne ; elle porte le motif gouverné
--      `contre_passation_du_confrere` (inactif : il ne s'offre pas comme
--      motif de retour). La régularisation est ensuite une écriture neuve, à
--      son nom.
--   4. À l'activation d'un mandat qui succède à celui d'une autre
--      comptabilité : la séparation au jour du changement est consignée au
--      journal des trois parties, l'ancienne est prévenue, la nouvelle reçoit
--      la proposition d'un modèle de lettre au confrère — que Malica n'envoie
--      pas.
--
-- REJEU (R11) : le motif est daté en littéral ; `create or replace`,
-- `on conflict do nothing`, `drop trigger if exists`.

begin;

-- --- 1. Le motif gouverné de la contre-passation du confrère ----------------------------
-- Ce n'est pas un motif de RETOUR : la pièce ne part pas chez le client. Il a
-- son usage, `contre_passation`, et ne paraît dans aucune liste de retour.
alter table ref.rejet_motifs drop constraint if exists rejet_motifs_usage_check;
alter table ref.rejet_motifs add constraint rejet_motifs_usage_check
  check (usage in ('retour', 'delettrage', 'contre_passation'));

insert into ref.rejet_motifs (code, severity, requires_note, sort_order, active, valid_from,
                              geste, preuve, usage)
select 'contre_passation_du_confrere', 'avertissement', false, 120, false, date '2026-12-15',
       'repondre', 'aucune', 'contre_passation'
 where not exists (select 1 from ref.rejet_motifs where code = 'contre_passation_du_confrere');

insert into ref.labels (ns, key, locale, value) values
  ('rejet_motif', 'contre_passation_du_confrere', 'fr',
   'Contre-passation d’une écriture de la comptabilité précédente'),
  ('rejet_motif', 'contre_passation_du_confrere', 'en',
   'Reversal of an entry made by the previous accountant'),
  ('rejet_motif', 'contre_passation_du_confrere', 'ar',
   'إلغاء قيد سجّلته المحاسبة السابقة')
on conflict (ns, key, locale) do nothing;

-- --- 2. Qui a inscrit cette écriture ----------------------------------------------------
create or replace function app.comptabilite_de_l_ecriture(p_ecriture uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pc.tenant_id
    from socle.prises_en_charge pc
   where pc.ecriture_id = p_ecriture
   order by exists (select 1 from identity.memberships m
                     where m.tenant_id = pc.tenant_id and m.user_id = pc.par) desc,
            pc.prise_le
   limit 1
$$;
revoke all on function app.comptabilite_de_l_ecriture(uuid) from public;

-- L'écriture d'une comptabilité dont l'appelant n'est pas membre.
create or replace function app.ecriture_d_un_confrere(p_ecriture uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c is not null and c not in (select app.member_orgs())
    from app.comptabilite_de_l_ecriture(p_ecriture) c
$$;
revoke all on function app.ecriture_d_un_confrere(uuid) from public;
grant execute on function app.ecriture_d_un_confrere(uuid) to portier;

-- Le nom à l'écran : « Inscrite par {comptabilité} · lecture seule ». Rien
-- pour une écriture de sa propre comptabilité, ni pour qui ne lit pas le
-- dossier.
create or replace function app.inscrite_par_un_confrere(p_ecriture uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from socle.ecritures e
    join identity.organizations o on o.id = app.comptabilite_de_l_ecriture(e.id)
   where e.id = p_ecriture
     and (e.tenant_id in (select app.engaged_orgs()) or e.tenant_id in (select app.member_orgs()))
     and app.ecriture_d_un_confrere(e.id)
$$;
revoke all on function app.inscrite_par_un_confrere(uuid) from public;
grant execute on function app.inscrite_par_un_confrere(uuid) to authenticated;

-- --- 3. Elle ne se revoit pas, et sa contre-passation se date du jour ------------------
create or replace function app.une_ecriture_du_confrere_ne_se_revoit_pas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.reviewed_at is distinct from old.reviewed_at
     and app.ecriture_d_un_confrere(old.id) then
    raise exception 'refus.ecriture.d_un_confrere'
      using errcode = '42501', hint = 'ecriture.d_un_confrere';
  end if;
  return new;
end
$$;
revoke all on function app.une_ecriture_du_confrere_ne_se_revoit_pas() from public;

drop trigger if exists une_ecriture_du_confrere_ne_se_revoit_pas on socle.ecritures;
create trigger une_ecriture_du_confrere_ne_se_revoit_pas
  before update of reviewed_at on socle.ecritures
  for each row execute function app.une_ecriture_du_confrere_ne_se_revoit_pas();

create or replace function app.contre_passation_du_confrere_au_jour()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reverses_id is not null
     and auth.uid() is not null
     and app.ecriture_d_un_confrere(new.reverses_id) then
    new.date_ecriture := current_date;
  end if;
  return new;
end
$$;
revoke all on function app.contre_passation_du_confrere_au_jour() from public;

drop trigger if exists contre_passation_du_confrere_au_jour on socle.ecritures;
create trigger contre_passation_du_confrere_au_jour
  before insert on socle.ecritures
  for each row execute function app.contre_passation_du_confrere_au_jour();

-- La porte du geste « Contre-passer », pour la nouvelle comptabilité : sur une
-- écriture du confrère, avec le motif gouverné. Les droits sont ceux de
-- `socle_ecriture_contre_passer` (supervision du dossier, écriture vivante).
create or replace function public.ecriture_du_confrere_contre_passer(p_ecriture uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from socle.ecritures e
                  where e.id = p_ecriture and e.tenant_id in (select app.engaged_orgs()))
     or not app.ecriture_d_un_confrere(p_ecriture) then
    raise exception 'refus.introuvable.ecriture' using errcode = '42501';
  end if;
  return public.socle_ecriture_contre_passer(
    p_ecriture,
    (select m.id from ref.rejet_motifs m where m.code = 'contre_passation_du_confrere'));
end
$$;
-- Une porte appartient au portier (R6) : elle s'exécute sous les politiques
-- de son appelant.
alter function public.ecriture_du_confrere_contre_passer(uuid) owner to portier;
revoke all on function public.ecriture_du_confrere_contre_passer(uuid) from public;
grant execute on function public.ecriture_du_confrere_contre_passer(uuid) to authenticated;

-- --- 4. Le changement de comptabilité, au jour, au journal ------------------------------
-- La comptabilité qui précède : le dernier mandat clos de la société, s'il est
-- d'une AUTRE comptabilité que celle qui s'active.
create or replace function app.comptabilite_precedente(p_pme uuid, p_cabinet uuid)
returns table (cabinet uuid, clos_le timestamptz, fin date)
language sql
stable
security definer
set search_path = ''
as $$
  select c.tenant_id, c.clos_le, c.fin
    from (select * from identity.mandats_clos x
           where x.pme_org_id = p_pme
           order by x.clos_le desc limit 1) c
   where c.tenant_id <> p_cabinet
$$;
revoke all on function app.comptabilite_precedente(uuid, uuid) from public;

create or replace function app.consigner_le_changement_de_comptabilite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avant   record;
  v_payload jsonb;
  -- La personne qui fait le geste ; à défaut (une reprise d'administration),
  -- celle qui a créé le mandat. Sans personne, il n'y a pas de geste à consigner.
  v_acteur  uuid := coalesce(auth.uid(), new.created_by);
begin
  if new.status <> 'actif' or old.status = 'actif' or v_acteur is null then
    return null;
  end if;
  select * into v_avant from app.comptabilite_precedente(new.pme_org_id, new.cabinet_org_id);
  if v_avant.cabinet is null then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'jour', current_date,
    'pme_org_id', new.pme_org_id,
    'client', (select o.name from identity.organizations o where o.id = new.pme_org_id),
    'precedente_org_id', v_avant.cabinet,
    'precedente', (select o.name from identity.organizations o where o.id = v_avant.cabinet),
    'precedente_jusqu_au', v_avant.fin,
    'nouvelle_org_id', new.cabinet_org_id,
    'nouvelle', (select o.name from identity.organizations o where o.id = new.cabinet_org_id));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  select t, v_acteur, 'mandat.changement_de_comptabilite', 'identity', 'engagements', new.id,
         v_payload
    from unnest(array[new.pme_org_id, v_avant.cabinet, new.cabinet_org_id]) t;

  -- L'ancienne l'apprend chez elle ; la nouvelle reçoit le modèle de lettre.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v_avant.cabinet, 'mandat.succede', v_payload),
         (new.cabinet_org_id, 'mandat.lettre_au_confrere', v_payload);
  return null;
end
$$;
revoke all on function app.consigner_le_changement_de_comptabilite() from public;

-- Après `consigner_la_fin_du_mandat` (ordre alphabétique des déclencheurs) :
-- dans un passage simultané, la fin de l'ancien est consignée d'abord.
drop trigger if exists consigner_le_changement_de_comptabilite on identity.engagements;
create trigger consigner_le_changement_de_comptabilite
  after update of status on identity.engagements
  for each row execute function app.consigner_le_changement_de_comptabilite();

-- Le modèle de lettre : ce que la nouvelle comptabilité doit y lire. Réservé
-- à l'expert de la comptabilité mandatée.
create or replace function public.lettre_au_confrere_lire(p_cabinet uuid, p_pme uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'confrere', (select o.name from identity.organizations o where o.id = a.cabinet),
           'comptabilite', (select o.name from identity.organizations o where o.id = p_cabinet),
           'client', (select o.name from identity.organizations o where o.id = p_pme),
           'matricule', (select o.legal_id from identity.organizations o where o.id = p_pme),
           'depuis', e.starts_on)
    from identity.engagements e
    cross join lateral app.comptabilite_precedente(p_pme, p_cabinet) a
   where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_pme
     and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
     and app.has_org_role(p_cabinet, array['expert'])
$$;
revoke all on function public.lettre_au_confrere_lire(uuid, uuid) from public;
grant execute on function public.lettre_au_confrere_lire(uuid, uuid) to authenticated;

commit;
