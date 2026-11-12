-- ======================================================================
--  La bibliothèque s'imprime (décision du dirigeant, 12 novembre 2026).
--
--  « Imprimer », à côté de « Télécharger », pour un document, un dossier
--  ou une sélection. Le serveur compose UN PDF d'impression à partir des
--  originaux conservés : une page de garde par société (société, matricule,
--  période, nombre de pièces), l'index, puis les pièces dans l'ordre de
--  l'index. Ce PDF est éphémère : rien n'est gardé, aucune lecture n'est
--  consommée. Ce que la base porte ici :
--
--   1. les MENTIONS de la page de garde et de l'index, en fr, en et ar
--      (`ref.mentions_d_impression`, `ref.labels`) : le serveur n'écrit
--      aucun libellé (R4, R12) ;
--   2. le SEUIL de volume (`plateforme.reglages_impression`) : au-delà, la
--      personne est avertie du nombre de pages et de la taille avant de
--      composer ; au-delà du plafond, la composition est refusée tant
--      qu'elle ne se fait pas en arrière-plan. Défaut livré, que la tour
--      change sans migration (R10) : daté, motivé, en ajout seul ;
--   3. le JOURNAL : chaque impression s'inscrit dans `audit.event_log`
--      (qui, quoi, quand), par une porte (R6). La porte ne journalise que
--      des pièces que l'appelant voit, et jamais une pièce de l'espace
--      privé.
--
--  REJEU (R11) : dates en littéral ; aucune horloge n'écrit dans `ref`.
-- ======================================================================

begin;

-- ------------------------------------------------- 1. Les mentions imprimées

create table ref.mentions_d_impression (
  code text primary key check (code ~ '^[a-z][a-z_]*$')
);

comment on table ref.mentions_d_impression is
  'Les mentions que le serveur écrit sur un PDF d''impression (page de garde, index) ; '
  'leur texte est dans ref.labels (ns mention_d_impression), en fr, en et ar.';

insert into ref.mentions_d_impression (code) values
  ('titre'), ('societe'), ('matricule'), ('periode'), ('pieces'), ('imprime_le'),
  ('index'), ('numero'), ('reference'), ('type'), ('tiers'), ('date'), ('montant'),
  ('original_non_imprimable');

insert into ref.labels (ns, key, locale, value) values
  ('mention_d_impression', 'titre', 'fr', 'Dossier d''impression'),
  ('mention_d_impression', 'titre', 'en', 'Print file'),
  ('mention_d_impression', 'titre', 'ar', 'ملف الطباعة'),
  ('mention_d_impression', 'societe', 'fr', 'Société'),
  ('mention_d_impression', 'societe', 'en', 'Company'),
  ('mention_d_impression', 'societe', 'ar', 'الشركة'),
  ('mention_d_impression', 'matricule', 'fr', 'Matricule fiscal'),
  ('mention_d_impression', 'matricule', 'en', 'Tax ID'),
  ('mention_d_impression', 'matricule', 'ar', 'المعرف الجبائي'),
  ('mention_d_impression', 'periode', 'fr', 'Période'),
  ('mention_d_impression', 'periode', 'en', 'Period'),
  ('mention_d_impression', 'periode', 'ar', 'الفترة'),
  ('mention_d_impression', 'pieces', 'fr', 'Nombre de pièces'),
  ('mention_d_impression', 'pieces', 'en', 'Number of documents'),
  ('mention_d_impression', 'pieces', 'ar', 'عدد الوثائق'),
  ('mention_d_impression', 'imprime_le', 'fr', 'Composé le'),
  ('mention_d_impression', 'imprime_le', 'en', 'Composed on'),
  ('mention_d_impression', 'imprime_le', 'ar', 'أُعدّ في'),
  ('mention_d_impression', 'index', 'fr', 'Index des pièces'),
  ('mention_d_impression', 'index', 'en', 'Document index'),
  ('mention_d_impression', 'index', 'ar', 'فهرس الوثائق'),
  ('mention_d_impression', 'numero', 'fr', 'N°'),
  ('mention_d_impression', 'numero', 'en', 'No.'),
  ('mention_d_impression', 'numero', 'ar', 'رقم'),
  ('mention_d_impression', 'reference', 'fr', 'Référence'),
  ('mention_d_impression', 'reference', 'en', 'Reference'),
  ('mention_d_impression', 'reference', 'ar', 'المرجع'),
  ('mention_d_impression', 'type', 'fr', 'Type'),
  ('mention_d_impression', 'type', 'en', 'Type'),
  ('mention_d_impression', 'type', 'ar', 'النوع'),
  ('mention_d_impression', 'tiers', 'fr', 'Tiers'),
  ('mention_d_impression', 'tiers', 'en', 'Third party'),
  ('mention_d_impression', 'tiers', 'ar', 'الطرف'),
  ('mention_d_impression', 'date', 'fr', 'Date'),
  ('mention_d_impression', 'date', 'en', 'Date'),
  ('mention_d_impression', 'date', 'ar', 'التاريخ'),
  ('mention_d_impression', 'montant', 'fr', 'Montant TTC'),
  ('mention_d_impression', 'montant', 'en', 'Total incl. tax'),
  ('mention_d_impression', 'montant', 'ar', 'المبلغ شامل الأداءات'),
  ('mention_d_impression', 'original_non_imprimable', 'fr',
   'L''original de cette pièce ne peut pas être composé pour l''impression : téléchargez-le.'),
  ('mention_d_impression', 'original_non_imprimable', 'en',
   'The original of this document cannot be composed for printing: download it.'),
  ('mention_d_impression', 'original_non_imprimable', 'ar',
   'لا يمكن إعداد أصل هذه الوثيقة للطباعة: قم بتنزيله.');

alter table ref.mentions_d_impression enable row level security;
alter table ref.mentions_d_impression force row level security;
revoke all on table ref.mentions_d_impression from public, anon;
grant select on table ref.mentions_d_impression to authenticated;
create policy ref_mentions_d_impression_sel on ref.mentions_d_impression
  for select to authenticated using (true);

-- ------------------------------------------------- 2. Le seuil de volume, à la tour

create table plateforme.reglages_impression (
  id            uuid primary key default gen_random_uuid(),
  pages_seuil   integer not null check (pages_seuil > 0),
  octets_seuil  bigint  not null check (octets_seuil > 0),
  pages_max     integer not null,
  motif         text not null check (length(btrim(motif)) > 0),
  decide_par    uuid,
  decide_le     timestamptz not null default now(),
  constraint reglages_impression_plafond check (pages_max >= pages_seuil)
);

comment on table plateforme.reglages_impression is
  'Le volume d''une impression : au-delà de pages_seuil pages ou de octets_seuil octets '
  'd''originaux, la personne est avertie avant la composition ; au-delà de pages_max pages, la '
  'composition est refusée (elle se fait dans la requête, pas encore en arrière-plan). La '
  'dernière décision de la tour vaut.';

alter table plateforme.reglages_impression enable row level security;
alter table plateforme.reglages_impression force row level security;
revoke all on table plateforme.reglages_impression from public, anon;
grant select on table plateforme.reglages_impression to authenticated;
create policy reglages_impression_lire on plateforme.reglages_impression
  for select to authenticated using ((select app.is_platform()));
create trigger reglages_impression_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_impression
  for each row execute function app.deny_mutation();

-- Valeurs INCERTAINES (durée réelle d'une composition non mesurée en production).
insert into plateforme.reglages_impression
  (pages_seuil, octets_seuil, pages_max, motif, decide_par, decide_le)
values
  (40, 20971520, 400,
   'Valeurs de départ du 12 novembre 2026, INCERTAINES : la durée d''une composition n''a pas '
   'été mesurée en production. À revoir après les premières impressions observées.',
   null, timestamptz '2026-11-12 00:00:00+00');

/* Le réglage en vigueur : ce que toute personne connectée a besoin d'en savoir. */
create function public.impression_reglages_lire()
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
  return (select jsonb_build_object('pagesSeuil', r.pages_seuil,
                                    'octetsSeuil', r.octets_seuil,
                                    'pagesMax', r.pages_max)
            from plateforme.reglages_impression r
           order by r.decide_le desc, r.id desc
           limit 1);
end
$$;

revoke all on function public.impression_reglages_lire() from public, anon;
grant execute on function public.impression_reglages_lire() to authenticated;

/* La tour règle le volume : daté, motivé, en ajout seul. */
create function plateforme.impression_regler(
  p_pages_seuil integer, p_octets_seuil bigint, p_pages_max integer, p_motif text)
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
  if p_pages_seuil is null or p_octets_seuil is null or p_pages_max is null
     or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_pages_seuil <= 0 or p_octets_seuil <= 0 or p_pages_max < p_pages_seuil then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into plateforme.reglages_impression
    (pages_seuil, octets_seuil, pages_max, motif, decide_par)
  values (p_pages_seuil, p_octets_seuil, p_pages_max, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_impression r
           where r.id = v_id);
end
$$;

revoke all on function plateforme.impression_regler(integer, bigint, integer, text)
  from public, anon;
grant execute on function plateforme.impression_regler(integer, bigint, integer, text)
  to authenticated;

-- ------------------------------------------------- 3. Le journal d'une impression

/*
 * Une ligne par société imprimée : qui (l'appelant), quoi (les pièces, la
 * portée, le volume), quand (l'horloge de la base). La porte appartient au
 * portier : elle lit `capture.pieces` sous les politiques de son appelant.
 * Une pièce qu'il ne voit pas, ou une pièce de l'espace privé, fait refuser
 * l'impression entière — on n'imprime, et on ne journalise, que ce qu'on voit.
 */
create function public.impression_journaliser(
  p_pieces uuid[], p_portee text, p_pages integer, p_octets bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vues integer;
  v_n    integer;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  if p_pieces is null or cardinality(p_pieces) = 0
     or p_portee is null or p_portee not in ('piece', 'dossier', 'selection')
     or p_pages is null or p_pages <= 0 or p_octets is null or p_octets <= 0 then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  select count(*) into v_vues
    from capture.pieces p
   where p.id = any(p_pieces) and p.vis = 'partage';
  if v_vues <> (select count(distinct x) from unnest(p_pieces) as x) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select p.tenant_id, auth.uid(), 'impression.generee', 'capture', 'pieces',
         case when count(*) = 1 then (array_agg(p.id))[1] end,
         jsonb_build_object('portee', p_portee,
                            'pieces', jsonb_agg(p.id order by p.created_at, p.id),
                            'nombre', count(*),
                            'pages', p_pages,
                            'octets', p_octets)
    from capture.pieces p
   where p.id = any(p_pieces) and p.vis = 'partage'
   group by p.tenant_id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

comment on function public.impression_journaliser(uuid[], text, integer, bigint) is
  'Inscrit une impression au journal (audit.event_log, action impression.generee), une ligne '
  'par société ; refuse toute pièce que l''appelant ne voit pas ou qui est de l''espace privé.';

alter function public.impression_journaliser(uuid[], text, integer, bigint) owner to portier;
revoke all on function public.impression_journaliser(uuid[], text, integer, bigint)
  from public, anon;
grant execute on function public.impression_journaliser(uuid[], text, integer, bigint)
  to authenticated;

commit;
