-- Une facture en devise se convertit, au cours d'une source officielle, à une
-- date que le référentiel nomme (31 octobre 2026 ; revue de #148).
--
-- Depuis #142 et #144, la devise d'une pièce se décide par une seule règle
-- (`deviseDeLaPiece`) ; une facture en euros d'un dossier tenu en dinars n'est
-- plus proposée, faute de cours. Avant #142, elle partait au journal à sa
-- valeur faciale : 1 000 € inscrits 1 000,000 DT.
--
-- Ce fichier pose ce qui manquait pour la PROPOSER juste :
--
--   0. USD au référentiel ; et l'exposant d'une devise n'a plus qu'une source,
--      `ref.devises` : `money.decimals` du pack, qui le doublait (un euro
--      s'affichait au dixième dans la bibliothèque), est retiré.
--   1. `ref.sources_de_cours` (BCT, BCEAO) ; les dates et les règles d'écart
--      que le Socle sait appliquer (`ref.change_dates_retenues`,
--      `ref.change_regles_d_ecart`) ; le rang de chaque origine de cours
--      (`ref.rangs_des_cours`) : la préséance est une donnée.
--   2. La règle de change : un DÉFAUT du pack (`ref.socle_params`, `change.*`),
--      que le cabinet arrête pour lui ou pour un dossier (R10,
--      `parametrage.regles_de_change`, résolu par `app.regle_de_change` :
--      le dossier, puis le cabinet, puis le pack — comme la déclaration de
--      TVA, #145).
--        change.source         la source dont le cours fait foi ;
--        change.date_retenue   la date de la pièce dont on prend le cours ;
--        change.recul_jours    combien de jours on remonte au dernier cours publié ;
--        change.ecart          où va l'écart d'arrondi de la conversion.
--      INCERTAIN — à confirmer par un expert-comptable : la date retenue
--      (facture, réception ou paiement ; le cours de quel jour) et le recul.
--      Les défauts sont dits comme tels dans `legal_reference`. Aucune source
--      officielle n'a pu être relue en ligne le 31 octobre 2026 : rien n'est
--      cité qui n'ait été lu.
--   3. `parametrage.cours_de_change` : les cours, en AJOUT SEUL (R7). Un cours
--      dit son ORIGINE : importé par l'exploitation (officiel), saisi par le
--      cabinet faute d'import, ou DÉROGATION du cabinet, motivée, pour un
--      dossier ou pour le cabinet. Une correction est une ligne nouvelle,
--      motivée ; rejouer un cours identique n'ajoute rien. AUCUN cours n'est
--      livré : un cours est une donnée, pas une constante.
--   4. `public.cours_de_change_saisir` : la seule porte d'écriture du cabinet ;
--      l'exploitation importe par `outils/importer-les-cours.mjs`, et chaque
--      import est consigné (`parametrage.cours_de_change_imports`).
--   5. `app.cours_applicable` : LE cours d'un dossier, pour une devise et un
--      jour — dans le recul, le rang de son origine d'abord (une dérogation
--      du dossier, du cabinet, puis l'import officiel, puis la saisie), puis
--      le plus proche du jour. Un cours saisi ne passe JAMAIS devant
--      l'import officiel sans dérogation motivée.
--   6. `app.cours_du_jugement_a_jour` : un jugement qui a lu un cours (ou une
--      règle) est périmé dès que la même question rend une autre réponse.
--   7. Les lignes d'écriture portent la devise d'origine, le montant d'origine,
--      le taux et le cours appliqués ; la contre-passation les recopie.
--   8. `socle_ecriture_propose` : la devise d'une écriture est celle du
--      dossier, toujours — et le défaut « TND » de sa signature, revenu par
--      `20261022450000` après que `20260830180000` l'eut retiré de la table,
--      disparaît (R4).
--   9. Le journal du jour rend les colonnes de devise, l'origine du cours
--      et son motif.
--
-- REJEU (R11) : les dates de validité sont des littéraux ; aucune horloge
-- n'écrit dans `ref`.

-- --- 0. Le dollar américain ; un seul exposant par devise --------------------------------------
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

-- `money.decimals` (3, « millime tunisien ») doublait l'exposant de la devise
-- du pack : deux sources pour la même vérité, et les lecteurs qui prenaient la
-- première l'appliquaient à TOUTE devise — une pièce en euros, au millième,
-- dans la bibliothèque. L'exposant se lit désormais dans `ref.devises`, pour
-- la devise du montant ; le paramètre n'a plus de lecteur, il part.
delete from ref.socle_params where code = 'money.decimals';

-- --- 1. Les sources, les dates, les règles d'écart, les rangs ----------------------------------

create table ref.sources_de_cours (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  nom  text not null check (length(btrim(nom)) > 0)
);

comment on table ref.sources_de_cours is
  'Qui publie un cours de change officiel. La règle de change (change.source) en nomme une.';

insert into ref.sources_de_cours (code, nom) values
  ('BCT',   'Banque centrale de Tunisie'),
  ('BCEAO', 'Banque centrale des États de l''Afrique de l''Ouest');

-- Les dates de la pièce dont le Socle sait prendre le cours, et les règles
-- d'écart qu'il sait appliquer : chaque code a son implémentation au Socle
-- (`scan/cours-de-change.ts`, `convertir-l-extrait.ts`), qu'une épreuve
-- confronte à ces tables.
create table ref.change_dates_retenues (
  code text primary key check (code ~ '^[a-z][a-z_]*$')
);
insert into ref.change_dates_retenues (code) values ('date_facture'), ('date_reception');

create table ref.change_regles_d_ecart (
  code text primary key check (code ~ '^[a-z][a-z_]*$')
);
insert into ref.change_regles_d_ecart (code) values ('base_la_plus_grande');

-- La préséance des origines d'un cours, dans le recul : la plus petite gagne.
create table ref.rangs_des_cours (
  code text primary key check (code ~ '^[a-z][a-z_]*$'),
  rang smallint not null unique check (rang > 0)
);
insert into ref.rangs_des_cours (code, rang) values
  ('derogation_dossier', 1),
  ('derogation_cabinet', 2),
  ('import', 3),
  ('saisie', 4);

do $$
declare t text;
begin
  foreach t in array array['sources_de_cours', 'change_dates_retenues', 'change_regles_d_ecart',
                           'rangs_des_cours']
  loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy %I on ref.%I for select to authenticated using (true)',
                   'ref_' || t || '_sel', t);
  end loop;
end $$;

-- Les mots des écrans (R4 : du référentiel, jamais du code).
insert into ref.labels (ns, key, locale, value) values
  ('change_date_retenue', 'date_facture', 'fr', 'Date de la facture'),
  ('change_date_retenue', 'date_facture', 'en', 'Invoice date'),
  ('change_date_retenue', 'date_facture', 'ar', 'تاريخ الفاتورة'),
  ('change_date_retenue', 'date_reception', 'fr', 'Date de réception'),
  ('change_date_retenue', 'date_reception', 'en', 'Date received'),
  ('change_date_retenue', 'date_reception', 'ar', 'تاريخ الاستلام'),
  ('change_regle_d_ecart', 'base_la_plus_grande', 'fr', 'Sur la plus grande base hors taxe'),
  ('change_regle_d_ecart', 'base_la_plus_grande', 'en', 'On the largest tax-exclusive base'),
  ('change_regle_d_ecart', 'base_la_plus_grande', 'ar', 'على أكبر أساس دون احتساب الضريبة'),
  ('origine_du_cours', 'import', 'fr', 'Importé (officiel)'),
  ('origine_du_cours', 'import', 'en', 'Imported (official)'),
  ('origine_du_cours', 'import', 'ar', 'مستورد (رسمي)'),
  ('origine_du_cours', 'saisie', 'fr', 'Saisi par le cabinet'),
  ('origine_du_cours', 'saisie', 'en', 'Entered by the firm'),
  ('origine_du_cours', 'saisie', 'ar', 'أدخله المكتب'),
  ('origine_du_cours', 'derogation_cabinet', 'fr', 'Dérogation du cabinet'),
  ('origine_du_cours', 'derogation_cabinet', 'en', 'Firm override'),
  ('origine_du_cours', 'derogation_cabinet', 'ar', 'استثناء من المكتب'),
  ('origine_du_cours', 'derogation_dossier', 'fr', 'Dérogation pour ce dossier'),
  ('origine_du_cours', 'derogation_dossier', 'en', 'Override for this file'),
  ('origine_du_cours', 'derogation_dossier', 'ar', 'استثناء لهذا الملف');

-- --- 2. La règle de change : le défaut du pack, puis ce que le cabinet arrête ------------------

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
     'Défaut livré, à confirmer par un expert-comptable : TVA de chaque taux et total convertis tels '
     'quels, l''écart d''arrondi de la conversion porté sur la plus grande base hors taxe.')
  ) as v(code, texte, nombre, reference)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- Ce que le cabinet arrête (R10) : comme `parametrage.tva_affectations`
-- (#145), en ajout seul, daté, signé ; la décision la plus récente l'emporte ;
-- une valeur nulle rend au pack.
create table parametrage.regles_de_change (
  id              uuid primary key default gen_random_uuid(),
  -- Le cabinet qui décide.
  tenant_id       uuid not null references identity.organizations (id),
  portee          text not null check (portee in ('cabinet', 'dossier')),
  portee_id       uuid not null references identity.organizations (id),
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  code            text not null
                  check (code in ('change.source', 'change.date_retenue', 'change.recul_jours',
                                  'change.ecart')),
  -- Nulle : rendu au défaut du pack.
  valeur          text,
  valid_from      date not null,
  motif           text,
  decide_par      uuid not null default auth.uid(),
  decide_le       timestamptz not null default clock_timestamp(),
  check (portee <> 'cabinet' or portee_id = tenant_id)
);

comment on table parametrage.regles_de_change is
  'R10 : la règle de change (source, date retenue, recul, règle d''écart) arrêtée par le cabinet '
  'pour lui-même ou pour un dossier. Ajout seulement : la plus récente l''emporte ; une valeur '
  'nulle rend au pack (31 octobre 2026).';

create index regles_de_change_tenant_idx
  on parametrage.regles_de_change (tenant_id, portee, portee_id);
create index regles_de_change_resolution_idx
  on parametrage.regles_de_change (portee, portee_id, pack_version_id, code,
                                   valid_from desc, decide_le desc);
create index regles_de_change_pack_idx on parametrage.regles_de_change (pack_version_id);
create index regles_de_change_portee_id_idx on parametrage.regles_de_change (portee_id);

create trigger regles_de_change_ajout_seulement
  before update or delete on parametrage.regles_de_change
  for each row execute function app.deny_mutation();

alter table parametrage.regles_de_change enable row level security;
alter table parametrage.regles_de_change force row level security;
revoke all on table parametrage.regles_de_change from public, anon;
grant select on table parametrage.regles_de_change to authenticated;
create policy regles_de_change_sel on parametrage.regles_de_change
  for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or (portee = 'dossier' and portee_id in (select app.member_orgs()))
         or (portee = 'dossier' and portee_id in (select app.engaged_orgs()))
         or (select app.is_platform()));
-- Aucune politique d'écriture : on écrit par `app.regle_de_change_arreter`.

-- Une valeur de la règle, au référentiel : la source, la date, l'écart
-- connus ; un recul entier, positif ou nul.
create or replace function app.valeur_de_change_valide(p_code text, p_valeur text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_code
    when 'change.source' then exists (select 1 from ref.sources_de_cours s where s.code = p_valeur)
    when 'change.date_retenue' then
      exists (select 1 from ref.change_dates_retenues d where d.code = p_valeur)
    when 'change.ecart' then
      exists (select 1 from ref.change_regles_d_ecart e where e.code = p_valeur)
    when 'change.recul_jours' then coalesce(p_valeur ~ '^[0-9]{1,3}$', false)
    else false
  end
$$;

revoke all on function app.valeur_de_change_valide(text, text) from public, anon;

-- La résolution : le dossier, puis le cabinet qui le tient, puis le pack.
-- Une ligne par code : la valeur, d'où elle vient, quand elle a été décidée,
-- et si c'est encore le défaut à confirmer (« un défaut se dit »).
create or replace function app.regle_de_change(p_dossier uuid, p_pack uuid, p_jour date)
returns table (code text, valeur text, origine text, decide_le timestamptz, reference text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_dossier is null
     or not (p_dossier in (select app.member_orgs() union select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.change.regle.droits' using errcode = '42501';
  end if;
  return query
    with pack as (
      select distinct on (s.code) s.code,
             coalesce(s.value_text, s.value_num::integer::text) as valeur, s.legal_reference
        from ref.socle_params s
       where s.pack_version_id = p_pack and s.code like 'change.%'
         and s.valid_from <= p_jour and (s.valid_to is null or s.valid_to >= p_jour)
       order by s.code, s.valid_from desc
    ),
    cabinet as (
      select g.cabinet_org_id as id
        from identity.engagements g
       where g.pme_org_id = p_dossier and g.status = 'actif'
       order by g.starts_on desc
       limit 1
    ),
    decisions as (
      select distinct on (r.portee, r.code) r.portee, r.code, r.valeur, r.decide_le
        from parametrage.regles_de_change r
       where r.pack_version_id = p_pack and r.valid_from <= p_jour
         -- Seules comptent les décisions du cabinet qui tient le dossier
         -- AUJOURD'HUI : celles d'un ancien cabinet ne le suivent pas.
         and r.tenant_id in (select c.id from cabinet c)
         and ((r.portee = 'dossier' and r.portee_id = p_dossier)
              or (r.portee = 'cabinet' and r.portee_id = r.tenant_id))
       order by r.portee, r.code, r.valid_from desc, r.decide_le desc
    ),
    -- Une décision dont la valeur n'est plus au référentiel ne décide rien.
    valides as (
      select d.* from decisions d
       where d.valeur is not null and app.valeur_de_change_valide(d.code, d.valeur)
    )
    select p.code,
           coalesce(d.valeur, c.valeur, p.valeur),
           case when d.valeur is not null then 'dossier'
                when c.valeur is not null then 'cabinet'
                else 'pack' end,
           coalesce(d.decide_le, c.decide_le),
           p.legal_reference
      from pack p
      left join valides d on d.portee = 'dossier' and d.code = p.code
      left join valides c on c.portee = 'cabinet' and c.code = p.code
     order by p.code;
end
$$;

revoke all on function app.regle_de_change(uuid, uuid, date) from public, anon;
grant execute on function app.regle_de_change(uuid, uuid, date) to authenticated;

-- Arrêter (ou confirmer) la règle : les mêmes droits que la déclaration de
-- TVA (`app.tva_affecter`). Pour tout le cabinet : l'expert-comptable. Pour
-- un dossier : quiconque, au cabinet qui le tient, le supervise.
create or replace function app.regle_de_change_arreter(
  p_cabinet uuid, p_portee text, p_portee_id uuid, p_pack uuid, p_valid_from date,
  p_valeurs jsonb, p_motif text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_portee = 'cabinet' then
    if p_portee_id is distinct from p_cabinet
       or not app.has_org_role(p_cabinet, array['expert']) then
      raise exception 'refus.change.regle.droits' using errcode = '42501';
    end if;
  elsif p_portee = 'dossier' then
    if p_cabinet not in (select app.member_orgs())
       or not app.supervise_le_dossier(p_portee_id)
       or not exists (select 1 from identity.engagements g
                       where g.cabinet_org_id = p_cabinet and g.pme_org_id = p_portee_id
                         and g.status = 'actif') then
      raise exception 'refus.change.regle.droits' using errcode = '42501';
    end if;
  else
    raise exception 'refus.change.regle.saisie' using errcode = '22023';
  end if;
  if p_valeurs is null or jsonb_typeof(p_valeurs) <> 'array'
     or jsonb_array_length(p_valeurs) = 0
     or p_valid_from is null
     -- Le pack de la juridiction de la portée, jamais celui d'une autre.
     or not exists (select 1 from ref.jurisdiction_packs j
                      join identity.organizations o on o.id = p_portee_id
                     where j.id = p_pack and j.jurisdiction = o.jurisdiction)
     or exists (
       select 1 from jsonb_array_elements(p_valeurs) e
        where e ->> 'code' is null
           or (e ->> 'valeur' is not null
               and not app.valeur_de_change_valide(e ->> 'code', e ->> 'valeur'))) then
    raise exception 'refus.change.regle.saisie' using errcode = '22023';
  end if;

  insert into parametrage.regles_de_change
    (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from, motif)
  select p_cabinet, p_portee, p_portee_id, p_pack, e ->> 'code', e ->> 'valeur', p_valid_from,
         nullif(btrim(coalesce(p_motif, '')), '')
    from jsonb_array_elements(p_valeurs) e;
  get diagnostics v_n = row_count;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'change.regle_arretee', 'parametrage', 'regles_de_change',
          p_portee_id, p_pack,
          jsonb_build_object('portee', p_portee, 'valid_from', p_valid_from,
                             'valeurs', p_valeurs, 'motif', p_motif));
  return v_n;
end
$$;

revoke all on function app.regle_de_change_arreter(uuid, text, uuid, uuid, date, jsonb, text)
  from public, anon;
grant execute on function app.regle_de_change_arreter(uuid, text, uuid, uuid, date, jsonb, text)
  to authenticated;

-- --- 3. Les cours ---------------------------------------------------------------------------------

create table parametrage.cours_de_change_imports (
  id          uuid primary key default gen_random_uuid(),
  -- Le fichier (son nom et son empreinte).
  lot         text not null check (length(btrim(lot)) > 0),
  lus         integer not null check (lus >= 0),
  nouveaux    integer not null check (nouveaux >= 0),
  corrections integer not null check (corrections >= 0),
  -- Qui a lancé l'import, tel que l'exploitation le nomme.
  par         text not null check (length(btrim(par)) > 0),
  importe_le  timestamptz not null default clock_timestamp()
);

comment on table parametrage.cours_de_change_imports is
  'Chaque import de cours par l''exploitation (outils/importer-les-cours.mjs) : le fichier, ce qu''il '
  'a ajouté et corrigé, qui l''a lancé. Ajout seulement (31 octobre 2026).';

create trigger cours_de_change_imports_ajout_seulement
  before update or delete on parametrage.cours_de_change_imports
  for each row execute function app.deny_mutation();

alter table parametrage.cours_de_change_imports enable row level security;
alter table parametrage.cours_de_change_imports force row level security;
revoke all on table parametrage.cours_de_change_imports from public, anon, service_role;
grant select on table parametrage.cours_de_change_imports to authenticated;
create policy cours_de_change_imports_sel on parametrage.cours_de_change_imports
  for select to authenticated using ((select app.is_platform()));

create table parametrage.cours_de_change (
  id            uuid primary key default gen_random_uuid(),
  -- L'organisation qui l'a saisi (le cabinet, ou la société qui tient ses
  -- livres) ; nul : importé par l'exploitation, pour tous.
  tenant_id     uuid references identity.organizations(id) on delete cascade,
  -- Une dérogation pour UN dossier : ce dossier.
  dossier_id    uuid references identity.organizations(id) on delete cascade,
  origine       text not null references ref.rangs_des_cours(code),
  devise        text not null references ref.devises(code),
  vers_devise   text not null references ref.devises(code),
  date_du_cours date not null,
  -- `unite` unités de `devise` valent `taux` unités de `vers_devise`.
  taux          numeric not null check (taux > 0),
  unite         integer not null default 1 check (unite > 0 and unite::text ~ '^10*$'),
  -- Les décimales du cours tel qu'il a été publié, ou saisi.
  decimales     smallint generated always as (scale(taux)::smallint) stored,
  source        text not null references ref.sources_de_cours(code),
  -- Pourquoi : exigé d'une dérogation, et de toute correction.
  motif         text check (motif is null or length(btrim(motif)) > 0),
  saisi_par     uuid,
  -- L'horloge réelle, pas celle de la transaction : deux saisies d'une même
  -- transaction restent ordonnées (la plus récente fait foi).
  saisi_le      timestamptz not null default clock_timestamp(),
  import_id     uuid references parametrage.cours_de_change_imports(id),
  check (devise <> vers_devise),
  check ((origine = 'import') = (tenant_id is null)),
  check ((origine = 'import') = (import_id is not null)),
  check ((origine = 'import') = (saisi_par is null)),
  check ((origine = 'derogation_dossier') = (dossier_id is not null)),
  check (origine not like 'derogation%' or motif is not null)
);

comment on table parametrage.cours_de_change is
  'Les cours de change, en ajout seul (R7) : une correction est une ligne nouvelle, motivée. '
  'Origine : import (officiel, pour tous), saisie (le cabinet, faute d''import), dérogation motivée '
  'du cabinet (pour lui, ou pour un dossier). Le choix : `app.cours_applicable`.';

create index cours_de_change_tenant_idx on parametrage.cours_de_change
  (tenant_id, devise, vers_devise, source, date_du_cours desc);
create index cours_de_change_dossier_id_idx on parametrage.cours_de_change (dossier_id)
  where dossier_id is not null;
create index cours_de_change_import_id_idx on parametrage.cours_de_change (import_id)
  where import_id is not null;

-- R7, et l'idempotence : un cours identique au dernier de sa clé n'ajoute
-- rien (un double clic, un import rejoué) ; un cours DIFFÉRENT est une
-- correction, et une correction dit pourquoi — y compris le retour à une
-- valeur officielle antérieure.
create or replace function app.cours_de_change_une_fois()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dernier parametrage.cours_de_change;
begin
  perform pg_advisory_xact_lock(hashtext('cours_de_change|' || new.devise || '|'
                                         || new.vers_devise || '|' || new.date_du_cours));
  select * into v_dernier
    from parametrage.cours_de_change c
   where c.tenant_id is not distinct from new.tenant_id
     and c.dossier_id is not distinct from new.dossier_id
     and c.origine = new.origine and c.devise = new.devise and c.vers_devise = new.vers_devise
     and c.date_du_cours = new.date_du_cours and c.source = new.source
   order by c.saisi_le desc, c.id desc
   limit 1;
  if v_dernier.id is not null and v_dernier.taux = new.taux and v_dernier.unite = new.unite then
    return null;
  end if;
  if v_dernier.id is not null and new.motif is null then
    raise exception 'refus.cours.correction_sans_motif' using errcode = '22023';
  end if;
  return new;
end
$$;

revoke all on function app.cours_de_change_une_fois() from public, anon, authenticated;

create trigger cours_de_change_une_fois before insert on parametrage.cours_de_change
  for each row execute function app.cours_de_change_une_fois();

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
-- dossiers ; une dérogation (`p_motif`) passe devant l'import officiel, pour
-- tout le cabinet, ou pour le seul dossier `p_dossier`, qu'il supervise.
-- Rend la ligne, nouvelle ou déjà là.

create or replace function public.cours_de_change_saisir(
  p_org uuid, p_devise text, p_vers_devise text, p_date date,
  p_taux numeric, p_unite integer, p_source text,
  p_motif text default null, p_dossier uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
                where g.cabinet_org_id = p_org and g.status = 'actif'
                  and app.peut_superviser(g.pme_org_id))
       or (not app.livres_tenus_par_le_cabinet(p_org) and app.peut_superviser(p_org))) then
    raise exception 'refus.cours.supervision' using errcode = '42501';
  end if;
  if p_dossier is not null and not (
       app.peut_superviser(p_dossier)
       and (p_dossier = p_org
            or exists (select 1 from identity.engagements g
                        where g.cabinet_org_id = p_org and g.pme_org_id = p_dossier
                          and g.status = 'actif'))) then
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
end $$;

revoke all on function public.cours_de_change_saisir(uuid, text, text, date, numeric, integer, text, text, uuid)
  from public, anon;
grant execute on function public.cours_de_change_saisir(uuid, text, text, date, numeric, integer, text, text, uuid)
  to authenticated;

-- --- 5. Le cours applicable -----------------------------------------------------------------------
--
-- Pour un dossier, une devise, un jour, la source et le recul de la règle :
-- parmi les cours publiés sans dépasser le jour ni remonter plus loin que le
-- recul, le RANG de son origine d'abord (`ref.rangs_des_cours`) : la
-- dérogation du dossier, celle du cabinet, l'import officiel, la saisie ;
-- puis le plus près du jour ; à rang et date égaux, la plus récente (une
-- correction). Les cours d'un AUTRE cabinet n'entrent jamais.
--
-- `security definer` : tout appelant qui lit le dossier obtient le même
-- cours — la PME qui lit sa pièce comme le cabinet qui la juge —, sans quoi
-- deux jugements de la même pièce se contrediraient.

create or replace function app.cours_applicable(
  p_dossier uuid, p_devise text, p_vers_devise text, p_jour date, p_source text, p_recul integer)
returns table (id uuid, date_du_cours date, taux numeric, unite integer, source text,
               origine text, motif text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.date_du_cours, c.taux, c.unite, c.source, c.origine, c.motif
    from parametrage.cours_de_change c
    join ref.rangs_des_cours r on r.code = c.origine
   where (p_dossier in (select app.member_orgs())
          or p_dossier in (select app.engaged_orgs())
          or app.is_platform())
     and c.devise = p_devise and c.vers_devise = p_vers_devise and c.source = p_source
     and c.date_du_cours <= p_jour and c.date_du_cours >= p_jour - p_recul
     and (c.dossier_id is null or c.dossier_id = p_dossier)
     and (c.tenant_id is null
          or c.tenant_id = p_dossier
          or c.tenant_id in (select g.cabinet_org_id from identity.engagements g
                              where g.pme_org_id = p_dossier and g.status = 'actif'))
   -- L'ORIGINE d'abord, la date ensuite (revue de #148) : une saisie du
   -- dimanche ne passe pas devant l'import officiel du vendredi que le recul
   -- retient ; seule une dérogation motivée passe devant l'import.
   order by r.rang, c.date_du_cours desc, c.saisi_le desc, c.id
   limit 1
$$;

revoke all on function app.cours_applicable(uuid, text, text, date, text, integer) from public, anon;
grant execute on function app.cours_applicable(uuid, text, text, date, text, integer) to authenticated;

-- --- 6. Un jugement qui a lu un cours se périme quand la réponse change -----------------------
--
-- Le contrôle `cours_de_change` du jugement (`scan/controles.ts`) garde la
-- question — la règle de change résolue au jour du paramétrage
-- (`jourDuParametrage`), la devise, le jour du cours — et la réponse (le
-- cours trouvé, ou rien). Le jugement est à jour tant que la règle résolue
-- aujourd'hui est la même ET que la même question rend le même cours. Une
-- règle dont la DATE retenue a changé périme le jugement : le jour du cours
-- se recalcule au rejugement.

create or replace function app.cours_du_jugement_a_jour(p_dossier uuid, p_controles jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(
           (c -> 'preuves' ->> 'jourDuParametrage') is null
           or (
             (select jsonb_object_agg(r.code, r.valeur)
                from app.regle_de_change(p_dossier, (c -> 'preuves' ->> 'pack')::uuid,
                                         (c -> 'preuves' ->> 'jourDuParametrage')::date) r)
             is not distinct from (c -> 'preuves' -> 'regle')
             and ((c -> 'preuves' ->> 'jour') is null
                  or (select a.id from app.cours_applicable(
                        p_dossier, c -> 'preuves' ->> 'devise', c -> 'preuves' ->> 'versDevise',
                        (c -> 'preuves' ->> 'jour')::date, c -> 'preuves' ->> 'source',
                        (c -> 'preuves' ->> 'recul')::integer) a)
                     is not distinct from (c -> 'preuves' -> 'cours' ->> 'id')::uuid))), true)
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
  v_controles jsonb;
  v_cours_juge uuid;
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
  -- Une ligne convertie porte LE cours de la pièce, jamais un autre (revue de
  -- #148 : la porte recopiait le cours, le taux et l'origine qu'on lui
  -- donnait). Ce cours est celui que le DERNIER jugement de la pièce a lu,
  -- jugement encore à jour ; la devise d'origine est celle du cours, le taux
  -- celui du cours pour une unité.
  if exists (select 1 from jsonb_array_elements(p_lignes) l
              where nullif(l ->> 'cours_id', '') is not null
                 or nullif(l ->> 'devise_origine', '') is not null) then
    select a.controles into v_controles
      from capture.analyses a
     where a.piece_id in (p_piece, app.version_courante(p_piece))
     order by a.created_at desc
     limit 1;
    select (k -> 'preuves' -> 'cours' ->> 'id')::uuid into v_cours_juge
      from jsonb_array_elements(case when jsonb_typeof(v_controles) = 'array' then v_controles
                                     else '[]'::jsonb end) k
     where k ->> 'code' = 'cours_de_change' and k ->> 'statut' = 'reserve'
     limit 1;
    if v_cours_juge is null or not app.cours_du_jugement_a_jour(v_tenant, v_controles) then
      raise exception 'refus.ecriture.cours_perime' using errcode = '22023';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_lignes) l
        left join parametrage.cours_de_change c on c.id = nullif(l ->> 'cours_id', '')::uuid
       where (nullif(l ->> 'cours_id', '') is not null
              or nullif(l ->> 'devise_origine', '') is not null)
         and (c.id is distinct from v_cours_juge
          or (l ->> 'devise_origine') is distinct from c.devise
          or c.vers_devise is distinct from v_devise_du_dossier
          or (l ->> 'taux_de_change')::numeric is distinct from c.taux / c.unite
          or (l ->> 'montant_origine') is null)) then
      raise exception 'refus.ecriture.cours_de_la_ligne' using errcode = '22023';
    end if;
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
-- Reprise de `20261029230000`, avec sept colonnes de plus, en fin de liste :
-- la devise et le montant d'origine d'une ligne convertie, le taux pour une
-- unité, la date, la source, l'ORIGINE du cours (importé officiel, saisi,
-- dérogation) et son motif — un cours saisi ne se lit jamais « BCT » tout
-- court. Une fonction ne change de colonnes qu'en se recréant. `security definer` : le cours d'une ligne se lit même
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
  source_du_cours  text,
  origine_du_cours text,
  motif_du_cours   text
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
           c.source,
           c.origine,
           c.motif
      from du_jour d
      join socle.ecriture_lignes l on l.ecriture_id = d.id
      join identity.organizations og on og.id = d.tenant_id
      left join ref.journals j on j.code = d.journal
      left join parametrage.cours_de_change c on c.id = l.cours_id
     order by j.rang nulls last, d.journal, d.v_inscrite_le, og.name, d.id, l.ordinal;
end $$;
revoke all on function public.journal_du_jour_lire(uuid, uuid, date) from public, anon;
grant execute on function public.journal_du_jour_lire(uuid, uuid, date) to authenticated;
