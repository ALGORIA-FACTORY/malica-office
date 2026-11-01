-- Une vente se range par la nature de ce qu'elle vend (1er novembre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Le CEO a tranché le 31 octobre 2026 (`ventes.compte` = `par_nature_article`,
-- 20261108090000) : une vente de services va en 705, de marchandises en 707,
-- de produits finis en 701, d'une activité annexe en 706 (plan NC 01). Le
-- réglage était ENREGISTRÉ, pas appliqué : toute vente partait au compte
-- unique du paramétrage (701), une prestation comme une marchandise.
--
-- ================================================================= LA RÈGLE
--
-- Deux tables, sur le modèle de `ref.biens_immobilisables` (20261107090000) :
--
--   ref.natures_de_vente            les natures d'un article vendu, par pack et
--                                   datées : leur RÔLE comptable (le compte se
--                                   résout comme tout rôle — le dossier, son
--                                   cabinet, puis le pack : `parametrage.role_bindings`,
--                                   R10), leur rang, et la nature de REPLI ;
--   ref.motifs_de_nature_de_vente   les mots qui la reconnaissent dans la
--                                   désignation d'un article (expression
--                                   régulière de JavaScript, lue sans casse et
--                                   en Unicode, comme les biens immobilisables).
--
-- Le Socle range chaque article par le premier motif qui le reconnaît, au plus
-- petit rang (une location de matériel est une activité annexe avant d'être un
-- service ; un transport de marchandises est un service avant d'être une
-- marchandise). Il ne devine jamais : un article qu'aucun motif ne reconnaît,
-- une désignation perdue, une facture sans article, ou une facture mêlée dont
-- les montants des articles ne prouvent pas la ventilation de chaque taux, et
-- TOUTE la vente va au compte de repli, avec la réserve nommée « nature de la
-- vente à préciser » (`apps/api/src/scan/nature-de-vente.ts`).
--
-- Le repli est la nature « produits finis » : son compte est celui de
-- l'imputation du pack pour une vente (701), celui où toute vente allait
-- jusqu'ici. L'option `unique_cabinet` range toute vente à ce même rôle, dont
-- le cabinet choisit le compte dans son plan comptable.
--
-- INCERTAIN (à confirmer par un expert-comptable) : la liste des motifs. Une
-- marchandise se reconnaît à son conditionnement ou à son unité de mesure
-- (« ramette », « carton », « 50 kg », « 5 L ») ; un produit fini ne se
-- distingue pas d'une marchandise par un mot — il dépend de l'activité du
-- dossier (négoce ou fabrication) : aucun motif ne le reconnaît, il est le
-- repli. La frontière 705 / 706 (une location, une refacturation) suit la
-- pratique de la recherche du 31 octobre 2026.
--
-- REJEU (R11) : `valid_from` en littéral ; aucune horloge n'écrit dans `ref`.

begin;

create table ref.natures_de_vente (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  code            text not null check (code ~ '^[a-z][a-z_]*$'),
  -- Le rôle comptable de la nature : son compte se résout par le paramétrage.
  role_code       text not null references ref.account_roles (code),
  -- L'ordre d'examen : un article reconnu par deux natures prend la première.
  rang            smallint not null check (rang > 0),
  -- La nature de repli : la vente dont la nature ne se prouve pas, et le
  -- compte unique de l'option `unique_cabinet`.
  repli           boolean not null,
  legal_reference text not null check (length(btrim(legal_reference)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, code, valid_from),
  unique (pack_version_id, rang, valid_from)
);

-- Un seul repli par pack et par date d'effet.
create unique index natures_de_vente_un_repli
  on ref.natures_de_vente (pack_version_id, valid_from) where repli;
create index natures_de_vente_role_idx on ref.natures_de_vente (role_code);

comment on table ref.natures_de_vente is
  'Les natures d''un article vendu (plan NC 01 : 701, 705, 706, 707), leur rôle comptable et '
  'leur rang ; la nature de repli reçoit la vente dont la nature ne se prouve pas (1er novembre 2026).';

create table ref.motifs_de_nature_de_vente (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  motif           text not null check (length(btrim(motif)) > 0),
  -- La nature reconnue (`ref.natures_de_vente.code`, du même pack) : une
  -- épreuve vérifie qu'elle existe (`une-vente-se-range-par-nature.test.ts`).
  nature          text not null check (nature ~ '^[a-z][a-z_]*$'),
  langue          text not null check (langue in ('fr', 'ar')),
  -- R10 : un défaut livré que l'expert-comptable doit confirmer.
  incertain       boolean not null,
  source          text not null check (length(btrim(source)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, motif, valid_from)
);

comment on table ref.motifs_de_nature_de_vente is
  'Les mots qui reconnaissent la nature d''un article vendu dans sa désignation (expression '
  'régulière de JavaScript, sans casse, en Unicode). Une désignation qu''aucun ne reconnaît '
  'va au repli, avec la réserve « nature de la vente à préciser » (1er novembre 2026).';

do $$
declare t text;
begin
  foreach t in array array['natures_de_vente', 'motifs_de_nature_de_vente'] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy %I on ref.%I for select to authenticated using (true)',
                   'ref_' || t || '_sel', t);
  end loop;
end $$;

insert into ref.natures_de_vente
  (pack_version_id, code, role_code, rang, repli, legal_reference, valid_from)
select p.id, v.code, v.role, v.rang, v.repli,
       'Plan NC 01 (OECT) : ' || v.reference || ' Défaut décidé par le CEO le 31/10/2026 '
       '(ventes.compte = par_nature_article), à confirmer par un expert-comptable.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('annexes', 'VENTE_SERVICES', 1, false,
    '706 produits des activités annexes (refacturations, locations accessoires).'),
   ('prestations', 'VENTE_ETUDES_PRESTATIONS', 2, false, '705 études et prestations de services.'),
   ('marchandises', 'VENTE_MARCHANDISES', 3, false, '707 ventes de marchandises.'),
   ('produits_finis', 'VENTE_PRODUITS_FINIS', 4, true,
    '701 ventes de produits finis ; repli d''une vente dont la nature ne se prouve pas.')
 ) as v(code, role, rang, repli, reference)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

/*
 * Les motifs. Un mot français est borné par `(?<!\p{L})` et `(?!\p{L})` (`\b`
 * ne connaît que les lettres latines) ; un mot arabe ne l'est pas : l'article
 * et les conjonctions se soudent à lui. Une unité de mesure n'est reconnue
 * qu'après un nombre (« 50 kg », « 5 L », « 2 mm ») : seule, une lettre ne
 * dit rien.
 */
insert into ref.motifs_de_nature_de_vente
  (pack_version_id, motif, nature, langue, incertain, source, valid_from)
select p.id, v.motif, v.nature, v.langue, true,
       'Liste INCERTAINE posée le 1er novembre 2026 (pratique de la recherche du 31 octobre 2026 : '
       'négoce 707, services 705, refacturations et locations accessoires 706) : à confirmer par '
       'un expert-comptable.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('(?<!\p{L})(locations?|loyers?|refacturations?|refactur[ée]e?s?|commissions?|mises?\s+[àa]\s+disposition)(?!\p{L})',
    'annexes', 'fr'),
   ('(كراء|إيجار|إعادة\s+فوترة|عمولة)', 'annexes', 'ar'),
   ('(?<!\p{L})(prestations?|services?|maintenance|entretiens?|r[ée]parations?|installations?|interventions?|formations?|conseils?|[ée]tudes?|audits?|assistance|honoraires?|main\s*-?\s*d.\s*[œo]e?uvre|transports?|h[ée]bergements?|nuit[ée]es?|abonnements?|missions?)(?!\p{L})',
    'prestations', 'fr'),
   ('(خدم(ة|ات)|صيان(ة|ات)|إسداء|تكوين|استشار(ة|ات)|دراس(ة|ات)|نقل|إقامة|إصلاح|تركيب|أتعاب)',
    'prestations', 'ar'),
   ('(?<!\p{L})(marchandises?|ramettes?|cartons?|sacs?|bidons?|bo[iî]tes?|paquets?|rouleaux?|palettes?|f[uû]ts?|caisses?|tonnes?|cartouches?)(?!\p{L})',
    'marchandises', 'fr'),
   ('\d\s*(kg|g|l|ml|cl|t|mm|cm|m)(?!\p{L})', 'marchandises', 'fr'),
   ('(بضا(ئع|عة)|رزم(ة|ات)|صندوق|صناديق|كيس|أكياس|علب(ة)?|خرطوش(ة|ات)|(?<!\p{L})طن(?!\p{L}))', 'marchandises', 'ar'),
   ('\d\s*(كغ|غ|لتر|مل|مم|سم)', 'marchandises', 'ar')
 ) as v(motif, nature, langue)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

insert into ref.labels (ns, key, locale, value) values
  ('nature_de_vente', 'annexes', 'fr', 'Activités annexes'),
  ('nature_de_vente', 'annexes', 'en', 'Ancillary activities'),
  ('nature_de_vente', 'annexes', 'ar', 'أنشطة ملحقة'),
  ('nature_de_vente', 'prestations', 'fr', 'Études et prestations de services'),
  ('nature_de_vente', 'prestations', 'en', 'Studies and services'),
  ('nature_de_vente', 'prestations', 'ar', 'دراسات وإسداء خدمات'),
  ('nature_de_vente', 'marchandises', 'fr', 'Marchandises'),
  ('nature_de_vente', 'marchandises', 'en', 'Goods'),
  ('nature_de_vente', 'marchandises', 'ar', 'بضائع'),
  ('nature_de_vente', 'produits_finis', 'fr', 'Produits finis'),
  ('nature_de_vente', 'produits_finis', 'en', 'Finished products'),
  ('nature_de_vente', 'produits_finis', 'ar', 'منتجات تامة الصنع');

-- Le sujet « ventes » MONTRE les natures du pack et leur compte, comme le
-- sujet des immobilisations montre ses catégories : l'écran ne les recopie pas.
alter table ref.reglages_comptables_sujets
  add column natures_de_vente boolean not null default false;
update ref.reglages_comptables_sujets set natures_de_vente = true where code = 'ventes';

-- Le réglage est appliqué, ses deux options aussi.
update ref.reglages_comptables set applique = true where code = 'ventes.compte';
update ref.reglages_comptables_options set applique = true where reglage = 'ventes.compte';

commit;
