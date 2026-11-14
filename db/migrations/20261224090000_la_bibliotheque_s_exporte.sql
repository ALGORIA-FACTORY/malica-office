-- ======================================================================
--  La bibliothèque s'exporte (décision du dirigeant, maquette
--  docs/maquettes/pme-export-bibliotheque.html, recette du 13 novembre
--  2026, G5).
--
--  Une société sans comptabilité dans Malica remet ses pièces à un comptable
--  extérieur : un ZIP des originaux, rangés par dossier, et un Excel d'une
--  ligne par pièce. Aucun écran neuf : le geste se pose à côté d'« Imprimer »,
--  et le fichier se relit par `/exports/:id/contenu`, sous la même RLS que
--  les exports déjà gardés. Ce que la base porte ici :
--
--   1. les LIMITES d'un export (taille, conservation, simultanés), à la tour,
--      datées, motivées, en ajout seul — défaut livré, changé sans migration
--      (R10, R4) ;
--   2. le JOURNAL des exports reçoit deux formats et une date d'expiration (la
--      conservation) ; un export de bibliothèque ne se relit que par son
--      auteur, parce qu'un membre qui ne voit pas une pièce n'a pas le droit
--      d'en lire l'original dans le fichier d'un autre ;
--   3. les PIÈCES REMISES (`collab.exports_pieces`) : ce qui dit « à exporter »
--      (jamais remise) puis « remis le » ;
--   4. la PORTE d'inscription (R6) : elle ne journalise que des pièces que
--      l'appelant voit, d'une société dont il est membre, et jamais une pièce
--      de l'espace privé (`personnel`) ;
--   5. les MENTIONS du fichier (en-têtes, noms de feuille), en fr, en et ar :
--      le serveur n'écrit aucun libellé (R12).
--
--  REJEU (R11) : dates en littéral ; aucune horloge n'écrit dans `ref`.
-- ======================================================================

begin;

-- ------------------------------------------------- 1. Les limites, à la tour

create table plateforme.reglages_export (
  id                 uuid primary key default gen_random_uuid(),
  octets_max         bigint  not null check (octets_max > 0),
  conservation_jours integer not null check (conservation_jours > 0),
  simultanes_max     integer not null check (simultanes_max > 0),
  motif              text not null check (length(btrim(motif)) > 0),
  decide_par         uuid,
  decide_le          timestamptz not null default now()
);

comment on table plateforme.reglages_export is
  'Les limites d''un export de bibliothèque : octets_max d''originaux au plus, un fichier gardé '
  'conservation_jours jours, simultanes_max préparations en même temps par société. La dernière '
  'décision de la tour vaut.';

alter table plateforme.reglages_export enable row level security;
alter table plateforme.reglages_export force row level security;
revoke all on table plateforme.reglages_export from public, anon;
grant select on table plateforme.reglages_export to authenticated;
create policy reglages_export_lire on plateforme.reglages_export
  for select to authenticated using ((select app.is_platform()));
create trigger reglages_export_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_export
  for each row execute function app.deny_mutation();

-- Valeurs INCERTAINES : aucun export n'a encore été mesuré en production.
insert into plateforme.reglages_export
  (octets_max, conservation_jours, simultanes_max, motif, decide_par, decide_le)
values
  (209715200, 7, 2,
   'Valeurs de départ du 13 novembre 2026, INCERTAINES : aucun export de bibliothèque n''a été '
   'mesuré en production. À revoir après les premiers exports observés.',
   null, timestamptz '2026-11-13 00:00:00+00');

create function public.export_reglages_lire()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  return (select jsonb_build_object('octetsMax', r.octets_max,
                                    'conservationJours', r.conservation_jours,
                                    'simultanesMax', r.simultanes_max)
            from plateforme.reglages_export r
           order by r.decide_le desc, r.id desc
           limit 1);
end
$$;

revoke all on function public.export_reglages_lire() from public, anon;
grant execute on function public.export_reglages_lire() to authenticated;

create function plateforme.export_regler(
  p_octets_max bigint, p_conservation_jours integer, p_simultanes_max integer, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_octets_max is null or p_conservation_jours is null or p_simultanes_max is null
     or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_octets_max <= 0 or p_conservation_jours <= 0 or p_simultanes_max <= 0 then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into plateforme.reglages_export
    (octets_max, conservation_jours, simultanes_max, motif, decide_par)
  values (p_octets_max, p_conservation_jours, p_simultanes_max, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_export r where r.id = v_id);
end
$$;

revoke all on function plateforme.export_regler(bigint, integer, integer, text) from public, anon;
grant execute on function plateforme.export_regler(bigint, integer, integer, text)
  to authenticated;

-- ------------------------------------------------- 2. Le journal des exports

alter table collab.exports drop constraint exports_format_check;
alter table collab.exports add constraint exports_format_check
  check (format = any (array['fec', 'csv_ecritures', 'csv_plan', 'journal_csv', 'journal_xlsx',
                             'bibliotheque_zip', 'bibliotheque_xlsx']));

-- La conservation : au-delà, le fichier ne se relit plus. Nul : sans échéance (le journal du jour).
alter table collab.exports add column if not exists expire_le timestamptz;

create or replace view public.exports_v with (security_invoker = true) as
select id, tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
       pack_version_id, created_by, created_at, numero, ecritures, contre_passees,
       fuseau, nom_de_fichier, type_mime, expire_le
  from collab.exports;
revoke all on public.exports_v from public, anon, service_role;
grant select on public.exports_v to authenticated;

drop policy collab_exports_sel on collab.exports;
create policy collab_exports_sel on collab.exports
  for select to authenticated
  using (
    ((tenant_id in (select app.member_orgs()))
      or (tenant_id in (select app.engaged_orgs()))
      or (select app.is_platform()))
    -- Un export de bibliothèque ne se relit que par son auteur : un membre qui ne voit pas
    -- une pièce n'a pas le droit de lire son original dans le fichier d'un autre.
    and (format not like 'bibliotheque\_%' or created_by = (select auth.uid()))
  );

-- ------------------------------------------------- 3. Les pièces remises

create table collab.exports_pieces (
  export_id uuid not null references collab.exports(id) on delete cascade,
  piece_id  uuid not null references capture.pieces(id) on delete cascade,
  -- La société de la PIÈCE : un export de plusieurs sociétés remet des pièces de chacune.
  tenant_id uuid not null references identity.organizations(id) on delete cascade,
  remis_le  timestamptz not null default now(),
  primary key (export_id, piece_id)
);
create index exports_pieces_tenant_idx on collab.exports_pieces (tenant_id, piece_id);
create index exports_pieces_piece_idx on collab.exports_pieces (piece_id);
select app.enable_tenant_rls('collab', 'exports_pieces', false, true);
-- Aucun client n'écrit : la porte export_bibliotheque_inscrire écrit pour lui (R6).
revoke insert, update, delete on collab.exports_pieces from authenticated;
-- Le relecteur de nuit n'y touche pas : ni écriture, ni lecture (le-relecteur-de-nuit).
create trigger service_hors_perimetre before insert or update or delete on collab.exports_pieces
  for each statement execute function app.service_hors_perimetre();
create policy service_hors_perimetre on collab.exports_pieces as restrictive for select
  to authenticated using ((select app.service()) is null);

create or replace view public.exports_pieces_v with (security_invoker = true) as
select export_id, piece_id, tenant_id, remis_le from collab.exports_pieces;
revoke all on public.exports_pieces_v from public, anon, service_role;
grant select on public.exports_pieces_v to authenticated;

comment on table collab.exports_pieces is
  'Les pièces qu''un export a remises : « à exporter » est ce qui n''y figure pas, « remis le » '
  'le jour du dernier export qui les contient. Écrite par la porte export_bibliotheque_inscrire.';

-- ------------------------------------------------- 4. La porte d'inscription

create or replace function public.export_bibliotheque_inscrire(
  p_societe uuid, p_pieces uuid[], p_format text, p_lignes integer, p_taille bigint,
  p_empreinte text, p_nom_de_fichier text, p_type_mime text, p_du date, p_au date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_vues      integer;
  v_societes  integer;
  v_jours     integer;
  v_expire    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  if p_pieces is null or cardinality(p_pieces) = 0
     or p_format is null or p_format not in ('bibliotheque_zip', 'bibliotheque_xlsx')
     or p_lignes is null or p_lignes <= 0 or p_taille is null or p_taille <= 0
     or p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$'
     or p_nom_de_fichier is null or length(btrim(p_nom_de_fichier)) = 0
     or p_type_mime is null or p_du is null or p_au is null or p_au < p_du then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  -- On ne remet que ce qu'on voit (RLS de l'appelant), jamais l'espace privé.
  select count(*), count(distinct p.tenant_id) into v_vues, v_societes
    from capture.pieces p
   where p.id = any(p_pieces) and p.vis <> 'personnel';
  if v_vues <> (select count(distinct x) from unnest(p_pieces) as x) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- Le fichier se range sous une société dont l'appelant est membre, qui a l'une des pièces.
  if p_societe is null or p_societe not in (select app.member_orgs())
     or not exists (select 1 from capture.pieces p
                     where p.id = any(p_pieces) and p.tenant_id = p_societe) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;
  -- Toute société remise doit être une société dont l'appelant est membre.
  if exists (select 1 from capture.pieces p
              where p.id = any(p_pieces) and p.tenant_id not in (select app.member_orgs())) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;

  -- Le réglage se lit par sa fonction : la table n'est lisible que de la tour.
  v_jours := (public.export_reglages_lire() ->> 'conservationJours')::integer;
  if v_jours is null then
    raise exception 'refus.export.reglage_absent' using errcode = '22023';
  end if;
  v_expire := now() + make_interval(days => v_jours);

  insert into collab.exports
    (tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
     nom_de_fichier, type_mime, expire_le)
  values (p_societe, null, p_format, p_du, p_au, p_lignes, p_taille, p_empreinte,
          p_nom_de_fichier, p_type_mime, v_expire)
  returning id into v_id;

  insert into collab.exports_pieces (export_id, piece_id, tenant_id)
  select v_id, p.id, p.tenant_id
    from capture.pieces p
   where p.id = any(p_pieces) and p.vis <> 'personnel';

  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_societe, auth.uid(), 'export.bibliotheque', 'collab', 'exports', v_id,
          jsonb_build_object('format', p_format, 'pieces', cardinality(p_pieces),
                             'societes', v_societes, 'taille', p_taille,
                             'empreinte', p_empreinte, 'expireLe', v_expire));
  return jsonb_build_object('id', v_id, 'expireLe', v_expire);
end
$$;

comment on function public.export_bibliotheque_inscrire(
  uuid, uuid[], text, integer, bigint, text, text, text, date, date) is
  'Inscrit un fichier d''export de la bibliothèque (collab.exports) et les pièces qu''il remet ; '
  'refuse toute pièce que l''appelant ne voit pas, de l''espace privé, ou d''une société dont il '
  'n''est pas membre.';

alter function public.export_bibliotheque_inscrire(
  uuid, uuid[], text, integer, bigint, text, text, text, date, date) owner to portier;
revoke all on function public.export_bibliotheque_inscrire(
  uuid, uuid[], text, integer, bigint, text, text, text, date, date) from public, anon;
grant execute on function public.export_bibliotheque_inscrire(
  uuid, uuid[], text, integer, bigint, text, text, text, date, date) to authenticated;

grant insert on collab.exports, collab.exports_pieces to portier;
grant usage on schema collab to portier;

-- ------------------------------------------------- 5. Les mentions du fichier

create table ref.mentions_d_export (
  code text primary key check (code ~ '^[a-z][a-z_]*$')
);

comment on table ref.mentions_d_export is
  'Les mentions que le serveur écrit dans un export de bibliothèque (en-têtes, noms de feuille) ; '
  'leur texte est dans ref.labels (ns export_bibliotheque), en fr, en et ar.';

insert into ref.mentions_d_export (code) values
  ('feuille_pieces'), ('date'), ('tiers'), ('type'), ('montant'), ('devise'), ('dossier'),
  ('fichier'), ('reference'), ('sans_dossier'), ('original_absent');

alter table ref.mentions_d_export enable row level security;
alter table ref.mentions_d_export force row level security;
revoke all on table ref.mentions_d_export from public, anon;
grant select on table ref.mentions_d_export to authenticated;
create policy ref_mentions_d_export_sel on ref.mentions_d_export
  for select to authenticated using (true);

insert into ref.labels (ns, key, locale, value) values
  ('export_bibliotheque', 'feuille_pieces', 'fr', 'Pièces'),
  ('export_bibliotheque', 'feuille_pieces', 'en', 'Documents'),
  ('export_bibliotheque', 'feuille_pieces', 'ar', 'الوثائق'),
  ('export_bibliotheque', 'date', 'fr', 'Date'),
  ('export_bibliotheque', 'date', 'en', 'Date'),
  ('export_bibliotheque', 'date', 'ar', 'التاريخ'),
  ('export_bibliotheque', 'tiers', 'fr', 'Tiers'),
  ('export_bibliotheque', 'tiers', 'en', 'Third party'),
  ('export_bibliotheque', 'tiers', 'ar', 'الطرف'),
  ('export_bibliotheque', 'type', 'fr', 'Type'),
  ('export_bibliotheque', 'type', 'en', 'Type'),
  ('export_bibliotheque', 'type', 'ar', 'النوع'),
  ('export_bibliotheque', 'montant', 'fr', 'Montant TTC'),
  ('export_bibliotheque', 'montant', 'en', 'Total incl. tax'),
  ('export_bibliotheque', 'montant', 'ar', 'المبلغ شامل الأداءات'),
  ('export_bibliotheque', 'devise', 'fr', 'Devise'),
  ('export_bibliotheque', 'devise', 'en', 'Currency'),
  ('export_bibliotheque', 'devise', 'ar', 'العملة'),
  ('export_bibliotheque', 'dossier', 'fr', 'Dossier'),
  ('export_bibliotheque', 'dossier', 'en', 'Folder'),
  ('export_bibliotheque', 'dossier', 'ar', 'الملف'),
  ('export_bibliotheque', 'fichier', 'fr', 'Fichier dans le ZIP'),
  ('export_bibliotheque', 'fichier', 'en', 'File in the ZIP'),
  ('export_bibliotheque', 'fichier', 'ar', 'الملف داخل ZIP'),
  ('export_bibliotheque', 'reference', 'fr', 'Référence'),
  ('export_bibliotheque', 'reference', 'en', 'Reference'),
  ('export_bibliotheque', 'reference', 'ar', 'المرجع'),
  ('export_bibliotheque', 'sans_dossier', 'fr', 'Sans dossier'),
  ('export_bibliotheque', 'sans_dossier', 'en', 'No folder'),
  ('export_bibliotheque', 'sans_dossier', 'ar', 'بدون ملف'),
  ('export_bibliotheque', 'original_absent', 'fr', 'Original absent'),
  ('export_bibliotheque', 'original_absent', 'en', 'Original missing'),
  ('export_bibliotheque', 'original_absent', 'ar', 'الأصل غير موجود');

commit;
