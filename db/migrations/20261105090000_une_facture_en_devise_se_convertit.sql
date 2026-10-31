-- Une facture en devise se convertit, au cours d'une source officielle, à une
-- date que le référentiel nomme (31 octobre 2026).
--
-- Depuis #142 et #144, la devise d'une pièce se décide par une seule règle
-- (`deviseDeLaPiece`) ; une facture en euros d'un dossier tenu en dinars n'est
-- plus proposée, faute de cours. Avant #142, elle partait au journal à sa
-- valeur faciale : 1 000 € inscrits 1 000,000 DT.
--
-- Ce fichier pose ce qui manquait pour la PROPOSER juste :
--
--   1. `ref.sources_de_cours` : qui publie un cours (BCT, BCEAO).
--   2. La règle de change du pack, dans `ref.socle_params` — le mécanisme de
--      paramétrage daté qui existe déjà (aucune table de plus) :
--        change.source         la source dont le cours fait foi ;
--        change.date_retenue   la date dont on prend le cours ;
--        change.recul_jours    combien de jours on remonte au dernier cours
--                              publié (week-end, jour férié) ;
--        change.ecart          où va l'écart d'arrondi de la conversion.
--      INCERTAIN — à confirmer par un expert-comptable : la date retenue
--      (facture, réception ou paiement ; le cours de quel jour) et le recul.
--      Les valeurs livrées sont des DÉFAUTS (R10), marqués comme tels dans
--      `legal_reference`. Aucune source officielle n'a pu être relue en ligne
--      le 31 octobre 2026 (le site de la BCT n'était pas joignable depuis
--      l'atelier) : rien n'est cité qui n'ait été lu.
--   3. `parametrage.cours_de_change` : les cours, en AJOUT SEUL (R7) — une
--      correction est une ligne nouvelle, la plus récente fait foi. Une ligne
--      sans organisation est importée par l'exploitation (`outils/importer-
--      les-cours.mjs`) ; une ligne d'une organisation est saisie par le
--      cabinet qui supervise (ou la société qui tient ses livres), et ne vaut
--      que pour ses dossiers. AUCUN cours n'est livré ici : un cours est une
--      donnée, pas une constante.
--   4. `public.cours_de_change_saisir` : la seule porte d'écriture.
--   5. `app.cours_applicable` : LE cours d'un dossier, pour une devise et un
--      jour — la seule règle de choix, en base.
--   6. `app.cours_du_jugement_a_jour` : un jugement qui a lu un cours est
--      périmé dès que le cours applicable change (un cours saisi, importé,
--      corrigé) ; l'ouverture le rejuge (#143).
--   7. Les lignes d'écriture portent la devise d'origine, le montant d'origine,
--      le taux et le cours appliqués ; la contre-passation les recopie.
--   8. `socle_ecriture_propose` : la devise d'une écriture est celle du
--      dossier, toujours — et le défaut « TND » de sa signature, revenu par
--      `20261022450000` après que `20260830180000` l'eut retiré de la table,
--      disparaît (R4).
--   9. Le journal du jour rend les colonnes de devise.
--  10. Les extraits de la TVA d'une pièce en devise sont ceux que le jugement
--      a convertis ; sans cours, l'extrait reste en devise et le calcul de la
--      TVA le REFUSE en le nommant (`tvaDesExtraits`), jamais en silence.
--
-- REJEU (R11) : les dates de validité sont des littéraux ; aucune horloge
-- n'écrit dans `ref`.

-- --- 0. Le dollar américain ----------------------------------------------------------------------
--
-- Les factures en dollars que reçoivent les dossiers tunisiens (logiciels,
-- services en ligne) restaient inconnues du référentiel : leur montant ne se
-- lisait dans aucune devise. ISO 4217 : 840, deux décimales ; le point
-- sépare les décimales des pièces en dollars. Sa marque « US$ » est la
-- sienne ; « $ » seul ne l'est pas — il s'imprime aussi pour d'autres
-- dollars (INCERTAIN : à revoir si le référentiel en porte un second).

insert into ref.devises (code, iso_numerique, exposant, separateur_decimal) values
  ('USD', '840', 2, '.');

insert into ref.devises_marques (marque, devise) values
  ('US$', 'USD');

-- --- 1. Les sources de cours ---------------------------------------------------------------------

create table ref.sources_de_cours (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  nom  text not null check (length(btrim(nom)) > 0)
);

comment on table ref.sources_de_cours is
  'Qui publie un cours de change officiel. La règle de change du pack (change.source) en nomme une.';

insert into ref.sources_de_cours (code, nom) values
  ('BCT',   'Banque centrale de Tunisie'),
  ('BCEAO', 'Banque centrale des États de l''Afrique de l''Ouest');

alter table ref.sources_de_cours enable row level security;
alter table ref.sources_de_cours force row level security;
revoke all on table ref.sources_de_cours from public, anon;
grant select on table ref.sources_de_cours to authenticated;
create policy ref_sources_de_cours_sel on ref.sources_de_cours
  for select to authenticated using (true);

-- --- 2. La règle de change du pack tunisien (défaut livré, à confirmer) ---------------------------

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, v.code, v.texte, v.nombre, v.reference, date '2026-01-01'
  from ref.jurisdiction_packs p
  cross join (values
    ('change.source', 'BCT', null::numeric,
     'Défaut livré, à confirmer par un expert-comptable : le cours de la Banque centrale de Tunisie.'),
    ('change.date_retenue', 'date_facture', null::numeric,
     'Défaut livré, à confirmer par un expert-comptable (INCERTAIN) : le cours du jour de la facture, '
     'à défaut de celui de sa réception, de son paiement ou d''un autre jour.'),
    ('change.recul_jours', null, 5::numeric,
     'Défaut livré, à confirmer par un expert-comptable (INCERTAIN) : sans cours publié le jour retenu '
     '(week-end, jour férié), le dernier cours publié dans les 5 jours qui précèdent.'),
    ('change.ecart', 'base_la_plus_grande', null::numeric,
     'Défaut livré, à confirmer par un expert-comptable : TVA et total convertis tels quels, l''écart '
     'd''arrondi de la conversion porté sur la plus grande base hors taxe.')
  ) as v(code, texte, nombre, reference)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- --- 3. Les cours ---------------------------------------------------------------------------------

create table parametrage.cours_de_change (
  id            uuid primary key default gen_random_uuid(),
  -- L'organisation qui l'a saisi (le cabinet, ou la société qui tient ses
  -- livres) ; nul : importé par l'exploitation, pour tous.
  tenant_id     uuid references identity.organizations(id) on delete cascade,
  devise        text not null references ref.devises(code),
  vers_devise   text not null references ref.devises(code),
  date_du_cours date not null,
  -- `unite` unités de `devise` valent `taux` unités de `vers_devise`.
  taux          numeric not null check (taux > 0),
  unite         integer not null default 1 check (unite > 0 and unite::text ~ '^10*$'),
  -- Les décimales du cours tel qu'il a été publié, ou saisi.
  decimales     smallint generated always as (scale(taux)::smallint) stored,
  source        text not null references ref.sources_de_cours(code),
  saisi_par     uuid,
  -- L'horloge réelle, pas celle de la transaction : deux saisies d'une même
  -- transaction restent ordonnées (la plus récente fait foi).
  saisi_le      timestamptz not null default clock_timestamp(),
  -- Le fichier d'un import de l'exploitation (son nom et son empreinte).
  import_lot    text,
  check (devise <> vers_devise),
  check ((tenant_id is null) = (saisi_par is null)),
  check ((tenant_id is null) = (import_lot is not null))
);

comment on table parametrage.cours_de_change is
  'Les cours de change, en ajout seul (R7) : une correction est une ligne nouvelle, la plus récente fait foi. '
  'Sans organisation : importé par l''exploitation. Avec : saisi par le cabinet qui supervise, pour ses dossiers. '
  'Le choix du cours d''un dossier est `app.cours_applicable`.';

-- Un import rejoué n'ajoute rien. (Une saisie du cabinet, elle, se compare à
-- la DERNIÈRE ligne de son cours : un double clic n'ajoute rien, mais revenir
-- à une valeur antérieure après une correction est une correction de plus —
-- voir `cours_de_change_saisir`.)
create unique index cours_de_change_import_une_fois_idx on parametrage.cours_de_change
  (devise, vers_devise, date_du_cours, source, taux, unite) where tenant_id is null;
create index cours_de_change_tenant_idx on parametrage.cours_de_change
  (tenant_id, devise, vers_devise, source, date_du_cours desc);

alter table parametrage.cours_de_change enable row level security;
alter table parametrage.cours_de_change force row level security;
revoke all on table parametrage.cours_de_change from public, anon, service_role;
-- Seule la porte écrit (`cours_de_change_saisir`) ; la lecture est sous RLS.
grant select on table parametrage.cours_de_change to authenticated;
create policy parametrage_cours_de_change_sel on parametrage.cours_de_change
  for select to authenticated
  using (tenant_id is null
         or tenant_id in (select app.member_orgs())
         or (select app.is_platform()));

create trigger cours_de_change_no_upd before update or delete on parametrage.cours_de_change
  for each row execute function app.deny_mutation();

-- --- 4. La porte : saisir un cours ----------------------------------------------------------------
--
-- Le cabinet qui supervise au moins un dossier, ou la société qui tient ses
-- livres : c'est `app.peut_superviser`, la règle de toute supervision. Le
-- cours vaut pour l'organisation qui le saisit (`p_org`), donc pour ses
-- dossiers. Rend la ligne, nouvelle ou déjà là.

create or replace function public.cours_de_change_saisir(
  p_org uuid, p_devise text, p_vers_devise text, p_date date,
  p_taux numeric, p_unite integer, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or p_org is null or p_org not in (select app.member_orgs()) then
    raise exception 'refus.cours.supervision' using errcode = '42501';
  end if;
  if not (
       exists (select 1 from identity.engagements g
                where g.cabinet_org_id = p_org and g.status = 'actif'
                  and app.peut_superviser(g.pme_org_id))
       or (not app.livres_tenus_par_le_cabinet(p_org) and app.peut_superviser(p_org))) then
    raise exception 'refus.cours.supervision' using errcode = '42501';
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

  -- Le même cours que la dernière saisie de ce cours : rien de nouveau (un
  -- double clic). Les saisies d'un même cours se sérialisent sur le verrou
  -- de l'organisation.
  perform 1 from identity.organizations o where o.id = p_org for update;
  select c.id into v_id
    from parametrage.cours_de_change c
   where c.tenant_id = p_org and c.devise = p_devise and c.vers_devise = p_vers_devise
     and c.date_du_cours = p_date and c.source = p_source
   order by c.saisi_le desc, c.id desc
   limit 1;
  if v_id is not null and exists (
       select 1 from parametrage.cours_de_change c
        where c.id = v_id and c.taux = p_taux and c.unite = p_unite) then
    return v_id;
  end if;

  insert into parametrage.cours_de_change
    (tenant_id, devise, vers_devise, date_du_cours, taux, unite, source, saisi_par)
  values (p_org, p_devise, p_vers_devise, p_date, p_taux, p_unite, p_source, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_org, auth.uid(), 'cours_de_change.saisi', 'parametrage', 'cours_de_change', v_id,
          jsonb_build_object('devise', p_devise, 'vers_devise', p_vers_devise,
                             'date', p_date, 'taux', p_taux, 'unite', p_unite,
                             'source', p_source));
  return v_id;
end $$;

revoke all on function public.cours_de_change_saisir(uuid, text, text, date, numeric, integer, text)
  from public, anon;
grant execute on function public.cours_de_change_saisir(uuid, text, text, date, numeric, integer, text)
  to authenticated;

-- --- 5. Le cours applicable -----------------------------------------------------------------------
--
-- Pour un dossier, une devise, un jour, la source et le recul de la règle :
-- le cours publié le plus près du jour, sans le dépasser ni remonter plus
-- loin que le recul. À date égale, celui du cabinet qui supervise le dossier
-- (ou du dossier) l'emporte sur l'import (R10) ; à scope égal, le plus récent
-- saisi (une correction). Les cours d'un AUTRE cabinet n'entrent jamais.
--
-- `security definer` : tout appelant qui lit le dossier obtient le même
-- cours — la PME qui lit sa pièce comme le cabinet qui la juge —, sans quoi
-- deux jugements de la même pièce se contrediraient.

create or replace function app.cours_applicable(
  p_dossier uuid, p_devise text, p_vers_devise text, p_jour date, p_source text, p_recul integer)
returns table (id uuid, date_du_cours date, taux numeric, unite integer, source text,
               du_cabinet boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.date_du_cours, c.taux, c.unite, c.source, c.tenant_id is not null
    from parametrage.cours_de_change c
   where (p_dossier in (select app.member_orgs())
          or p_dossier in (select app.engaged_orgs())
          or app.is_platform())
     and c.devise = p_devise and c.vers_devise = p_vers_devise and c.source = p_source
     and c.date_du_cours <= p_jour and c.date_du_cours >= p_jour - p_recul
     and (c.tenant_id is null
          or c.tenant_id = p_dossier
          or c.tenant_id in (select g.cabinet_org_id from identity.engagements g
                              where g.pme_org_id = p_dossier and g.status = 'actif'))
   order by c.date_du_cours desc, (c.tenant_id is not null) desc, c.saisi_le desc, c.id
   limit 1
$$;

revoke all on function app.cours_applicable(uuid, text, text, date, text, integer) from public, anon;
grant execute on function app.cours_applicable(uuid, text, text, date, text, integer) to authenticated;

-- --- 6. Un jugement qui a lu un cours se périme quand le cours change --------------------------
--
-- Le contrôle `cours_de_change` du jugement (`scan/controles.ts`) garde ce
-- qu'il a demandé (devise, devise du dossier, jour, source, recul) et le cours
-- qu'il a trouvé (`cours.id`, ou rien). Le jugement est à jour tant que la
-- même question rend la même réponse.

create or replace function app.cours_du_jugement_a_jour(p_dossier uuid, p_controles jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(
           (c -> 'preuves' ->> 'jour') is null
           or (select a.id from app.cours_applicable(
                 p_dossier, c -> 'preuves' ->> 'devise', c -> 'preuves' ->> 'versDevise',
                 (c -> 'preuves' ->> 'jour')::date, c -> 'preuves' ->> 'source',
                 (c -> 'preuves' ->> 'recul')::integer) a)
              is not distinct from (c -> 'preuves' -> 'cours' ->> 'id')::uuid), true)
    from jsonb_array_elements(case when jsonb_typeof(p_controles) = 'array'
                                   then p_controles else '[]'::jsonb end) c
   where c ->> 'code' = 'cours_de_change'
$$;

revoke all on function app.cours_du_jugement_a_jour(uuid, jsonb) from public, anon;
grant execute on function app.cours_du_jugement_a_jour(uuid, jsonb) to authenticated;

-- --- 7. Les lignes d'écriture portent leur devise d'origine ---------------------------------------

alter table socle.ecriture_lignes
  add column devise_origine  text references ref.devises(code),
  -- Le montant de la ligne dans la devise de la pièce, du même côté.
  add column montant_origine numeric(38,4) check (montant_origine > 0),
  -- Le taux appliqué, pour UNE unité de la devise d'origine.
  add column taux_de_change  numeric check (taux_de_change > 0),
  add column cours_id        uuid references parametrage.cours_de_change(id),
  add constraint ecriture_lignes_origine_entiere check (
    (devise_origine is null) = (montant_origine is null)
    and (devise_origine is null) = (taux_de_change is null)
    and (devise_origine is null) = (cours_id is null));

create index ecriture_lignes_cours_id_idx on socle.ecriture_lignes (cours_id)
  where cours_id is not null;

comment on column socle.ecriture_lignes.devise_origine is
  'La devise de la pièce quand elle n''est pas celle du dossier : la ligne en porte le montant d''origine, '
  'le taux pour une unité et le cours appliqués (31 octobre 2026).';

create or replace view public.ecriture_lignes_v
with (security_invoker = true) as
select id, tenant_id, ecriture_id, ordinal, account_code, libelle,
       debit, credit, tax_code, created_at,
       devise_origine, montant_origine, taux_de_change, cours_id
from socle.ecriture_lignes;

revoke all on public.ecriture_lignes_v from public, anon, service_role;
grant select on public.ecriture_lignes_v to authenticated;

-- La contre-passation recopie l'original, devise d'origine comprise : le
-- journal du jour la montre au même cours. Reprise de `20261030090000`.
create or replace function public.socle_ecriture_contre_passer(p_ecriture uuid, p_motif uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_entity  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_journal text;
  v_libelle text;
  v_devise  text;
  v_date    date;
  v_rev     uuid;
  v_i       smallint := 0;
  v_l       record;
begin
  select tenant_id, entity_id, piece_id, pack_version_id, journal, libelle, devise, date_ecriture
    into v_tenant, v_entity, v_piece, v_pack, v_journal, v_libelle, v_devise, v_date
    from socle.ecritures where id = p_ecriture;
  if v_tenant is null then
    raise exception 'ecriture introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Défaire une écriture d'un dossier tenu par un cabinet est l'acte du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if not app.ecriture_vivante(p_ecriture) then
    raise exception 'Cette écriture est déjà contre-passée : elle ne se supervise plus.'
      using errcode = 'check_violation', hint = 'ecriture.contre_passee';
  end if;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               status, reverses_id, reversal_reason_id)
  values (v_tenant, v_entity, v_piece, 'partage', v_journal,
          app.date_de_contre_passation(v_tenant, v_date), v_devise,
          'Contre-passation — ' || v_libelle, v_pack,
          'proposee', p_ecriture, p_motif)
  returning id into v_rev;

  for v_l in
    select ordinal, account_code, libelle, debit, credit, tax_code,
           devise_origine, montant_origine, taux_de_change, cours_id
      from socle.ecriture_lignes where ecriture_id = p_ecriture order by ordinal
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code,
                                       devise_origine, montant_origine, taux_de_change, cours_id)
    values (v_tenant, v_rev, v_i, v_l.account_code,
            'Contre-passation — ' || v_l.libelle,
            v_l.credit, v_l.debit, v_l.tax_code,
            v_l.devise_origine, v_l.montant_origine, v_l.taux_de_change, v_l.cours_id);
  end loop;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_rev;

  return v_rev;
end
$$;

revoke all on function public.socle_ecriture_contre_passer(uuid, uuid) from public, anon;
grant execute on function public.socle_ecriture_contre_passer(uuid, uuid) to authenticated;

-- --- 8. Une écriture est dans la devise du dossier ------------------------------------------------
--
-- Reprise de `20261029160000`, avec deux changements : la devise est EXIGÉE
-- et doit être celle du dossier (une pièce en devise se convertit avant),
-- et une ligne peut porter sa devise d'origine. La signature perd son défaut
-- « TND » : une fonction ne se dépouille d'un défaut qu'en se recréant.

drop function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text, uuid);

create function public.socle_ecriture_propose(
  p_piece uuid, p_journal text, p_date date, p_libelle text, p_pack_version uuid,
  p_lignes jsonb, p_devise text, p_paiement uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis    app.vis_t;
  v_nature text := case when p_paiement is null then 'piece' else 'reglement' end;
  v_ecr    uuid;
  v_inscrite uuid;
  v_l      jsonb;
  v_i      smallint := 0;
  v_devise_du_dossier text;
begin
  -- Le verrou de la pièce sérialise deux clics, deux onglets, deux personnes.
  -- Une photo reprise se lit à sa version courante : c'est elle qu'on
  -- verrouille, et elle qui dit le dossier, l'établissement et le côté.
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = app.version_courante(p_piece) for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Les livres d'un dossier sont dans SA devise : une pièce en devise se
  -- convertit avant (la proposition le fait, au cours de la règle de change).
  select o.currency into v_devise_du_dossier from identity.organizations o where o.id = v_tenant;
  if p_devise is distinct from v_devise_du_dossier then
    raise exception 'refus.ecriture.devise_du_dossier' using errcode = '22023';
  end if;
  if p_paiement is not null
     and not exists (select 1 from capture.paiements
                      where id = p_paiement and piece_id = p_piece) then
    raise exception 'ce reglement n''appartient pas a cette piece' using errcode = '22023';
  end if;

  select e.id into v_inscrite
    from socle.ecritures e
   where e.piece_id = p_piece and e.nature = v_nature
     and e.paiement_id is not distinct from p_paiement
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_inscrite is not null then
    -- Un règlement inscrit l'est une fois : redemander rend la même écriture.
    if v_nature = 'reglement' then
      return v_inscrite;
    end if;
    raise exception 'Cette pièce est déjà inscrite. Pour la réimputer, retournez d''abord son écriture : elle sera contre-passée.'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  delete from socle.ecritures
   where piece_id = p_piece and status = 'proposee' and reverses_id is null
     and nature = v_nature and paiement_id is not distinct from p_paiement;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               nature, paiement_id)
  values (v_tenant, v_entity, p_piece, v_vis, p_journal, p_date, p_devise,
          p_libelle, p_pack_version, v_nature, p_paiement)
  returning id into v_ecr;

  for v_l in select * from jsonb_array_elements(p_lignes)
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code,
                                       devise_origine, montant_origine, taux_de_change, cours_id)
    values (v_tenant, v_ecr, v_i, v_l->>'account_code', v_l->>'libelle',
            coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0),
            nullif(v_l->>'tax_code',''),
            nullif(v_l->>'devise_origine', ''),
            (v_l->>'montant_origine')::numeric,
            (v_l->>'taux_de_change')::numeric,
            (v_l->>'cours_id')::uuid);
  end loop;

  -- Seule l'écriture de la facture fait avancer la pièce.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when status in ('capturee','lue','retournee') then 'proposee' else status end,
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.proposed', 'socle', 'ecritures', v_ecr,
          jsonb_build_object('piece_id', p_piece, 'pack_version_id', p_pack_version,
                             'nature', v_nature, 'paiement_id', p_paiement,
                             'lignes', jsonb_array_length(p_lignes)));

  return v_ecr;
end $function$;

revoke all on function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text, uuid) to authenticated;

-- --- 9. Le journal du jour dit la devise d'origine ---------------------------------------------
--
-- Reprise de `20261029230000`, avec cinq colonnes de plus, en fin de liste :
-- la devise et le montant d'origine d'une ligne convertie, le taux pour une
-- unité, la date et la source du cours. Une fonction ne change de colonnes
-- qu'en se recréant. `security definer` : le cours d'une ligne se lit même
-- quand il a été saisi par un autre cabinet que celui qui exporte.

drop function public.journal_du_jour_lire(uuid, uuid, date);

create function public.journal_du_jour_lire(p_cabinet uuid, p_client uuid, p_jour date)
returns table (
  client_tenant_id uuid,
  client_nom       text,
  ecriture_id      uuid,
  journal          text,
  journal_libelle  text,
  journal_rang     smallint,
  piece_id         uuid,
  ecriture_libelle text,
  ordinal          smallint,
  compte           text,
  compte_libelle   text,
  debit            numeric,
  credit           numeric,
  devise           text,
  origine          text,
  inscrite_le      timestamptz,
  heure            text,
  par              text,
  reverses_id      uuid,
  contre_passee_le timestamptz,
  devise_origine   text,
  montant_origine  numeric,
  taux_de_change   numeric,
  date_du_cours    date,
  source_du_cours  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
  v_fuseau  text := app.fuseau_du_cabinet(p_cabinet);
  v_debut   timestamptz := p_jour::timestamp at time zone v_fuseau;
  v_fin     timestamptz := (p_jour + 1)::timestamp at time zone v_fuseau;
begin
  return query
    with du_jour as (
      select e.*, o.origine as v_origine, o.prise_le as v_inscrite_le, o.par_nom as v_par_nom
        from socle.prises_en_charge pc
        join socle.ecritures e on e.id = pc.ecriture_id
        cross join lateral app.ecriture_prise_en_charge(p_cabinet, e.id) o
       where pc.tenant_id = p_cabinet
         and pc.prise_le >= v_debut and pc.prise_le < v_fin
         and pc.client_tenant_id = any(v_mandats)
         and e.status = 'booked'
         and e.vis = 'partage'::app.vis_t
    )
    select d.tenant_id,
           og.name,
           d.id,
           d.journal,
           coalesce(j.libelle, d.journal),
           j.rang,
           app.version_courante(d.piece_id),
           d.libelle,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = d.pack_version_id and ra.account_code = l.account_code),
             l.libelle),
           l.debit::numeric,
           l.credit::numeric,
           d.devise,
           d.v_origine,
           d.v_inscrite_le,
           to_char(d.v_inscrite_le at time zone v_fuseau, 'HH24:MI'),
           d.v_par_nom,
           d.reverses_id,
           (select r.booked_at from socle.ecritures r
             where r.reverses_id = d.id and r.status = 'booked'
             order by r.booked_at limit 1),
           l.devise_origine,
           l.montant_origine::numeric,
           l.taux_de_change,
           c.date_du_cours,
           c.source
      from du_jour d
      join socle.ecriture_lignes l on l.ecriture_id = d.id
      join identity.organizations og on og.id = d.tenant_id
      left join ref.journals j on j.code = d.journal
      left join parametrage.cours_de_change c on c.id = l.cours_id
     order by j.rang nulls last, d.journal, d.v_inscrite_le, og.name, d.id, l.ordinal;
end $$;
revoke all on function public.journal_du_jour_lire(uuid, uuid, date) from public, anon;
grant execute on function public.journal_du_jour_lire(uuid, uuid, date) to authenticated;
