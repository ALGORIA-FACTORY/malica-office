-- Un bien susceptible d'être immobilisé se signale ; il ne se devine pas
-- (31 octobre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Mesuré sur le jeu synthétique (outils/jeu-synthetique, cas 007, 071, 083) :
-- l'achat d'un serveur de stockage ou d'un photocopieur recevait l'écriture
-- d'une CHARGE (601, l'imputation du paramétrage), en silence. Le Socle ne
-- sait pas immobiliser — et il n'a pas à le décider : la frontière entre
-- charge et immobilisation (durée d'utilisation, seuil, politique du
-- cabinet) appartient à l'expert-comptable (R10). Mais rien ne disait au
-- cabinet que la question se posait : une écriture fausse ressemblait à une
-- écriture juste.
--
-- Le référentiel ne portait aucun marqueur : `app.familles_immobilisees`
-- (20261103090000) ne reconnaît que les familles d'articles dont le compte
-- est rangé en immobilisation, et aucune famille livrée n'en a un.
--
-- ================================================================== LA RÈGLE
--
-- Une table de MOTS, par famille de biens couramment immobilisés : un article
-- d'achat dont la désignation en porte un reçoit une RÉSERVE nommée
-- (`immobilisation_a_trancher`, `apps/api/src/scan/controles.ts`). L'écriture
-- reste celle du paramétrage, et la réserve dit au cabinet de trancher :
-- immobilisation ou charge. Aucun seuil, aucune règle de capitalisation n'est
-- posé ici — ce n'est pas un mot qui décide qu'un bien s'immobilise.
--
-- Le motif est une expression régulière de JavaScript, lue sans casse et en
-- Unicode (`new RegExp(motif, "iu")`) : `\b` n'y connaît que les lettres
-- latines, d'où `(?<!\p{L})` et `(?!\p{L})` pour borner un mot français. Un
-- mot arabe n'est pas borné : l'article, les conjonctions et les pluriels se
-- soudent à lui (« الحاسوب », « وسيارات »).
--
-- INCERTAIN (à confirmer par un expert-comptable) : la liste elle-même. Elle
-- signale des biens SUSCEPTIBLES d'être immobilisés (véhicules, ordinateurs et
-- serveurs, photocopieurs, matériel de bureau, informatique, de transport ou
-- industriel, mobilier) ; un bien de faible valeur peut aller en charge, un
-- bien absent de la liste peut s'immobiliser. Le texte qui décide est la
-- norme comptable tunisienne des immobilisations corporelles (référence
-- exacte non consultée le 31 octobre 2026). Chaque ligne est `incertain`.
--
-- REJEU (R11) : `valid_from` pris sur `effective_from` du pack ; aucune date
-- du jour ; `on conflict do nothing` sur la clé.

begin;

create table ref.biens_immobilisables (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  motif           text not null check (length(btrim(motif)) > 0),
  -- La famille de biens que le motif reconnaît : elle se dit dans la réserve.
  famille         text not null check (famille ~ '^[A-Z][A-Z0-9_]*$'),
  langue          text not null check (langue in ('fr', 'ar')),
  -- R10 : un défaut livré que l'expert-comptable doit confirmer.
  incertain       boolean not null,
  source          text not null check (length(btrim(source)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, motif, valid_from)
);

comment on table ref.biens_immobilisables is
  'Les mots qui désignent un bien SUSCEPTIBLE d''être immobilisé : un article d''achat qui en '
  'porte un reçoit la réserve « immobilisation à trancher ». Aucun seuil, aucune décision : '
  'le cabinet tranche (31 octobre 2026).';

insert into ref.biens_immobilisables
  (pack_version_id, motif, famille, langue, incertain, source, valid_from)
select p.id, v.motif, v.famille, v.langue, true,
       'Liste INCERTAINE posée le 31 octobre 2026 (jeu synthétique, cas 007, 071, 083) : '
       'elle signale, elle ne décide pas. À confirmer par un expert-comptable au regard de la '
       'norme comptable tunisienne des immobilisations corporelles.',
       p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('(?<!\p{L})(v[ée]hicules?|voitures?|camions?|camionnettes?|fourgons?)(?!\p{L})', 'VEHICULE', 'fr'),
   ('(?<!\p{L})(ordinateurs?|serveurs?|photocopieu(r|rs|se|ses))(?!\p{L})', 'INFORMATIQUE', 'fr'),
   ('(?<!\p{L})mat[ée]riels?\s+(informatiques?|de\s+bureau|de\s+transport|industriels?|roulants?)(?!\p{L})', 'MATERIEL', 'fr'),
   ('(?<!\p{L})machines?[-\s]outils?(?!\p{L})', 'MATERIEL', 'fr'),
   ('(?<!\p{L})mobiliers?(?!\p{L})', 'MOBILIER', 'fr'),
   ('سيار(ة|ات)', 'VEHICULE', 'ar'),
   ('شاحن(ة|ات)', 'VEHICULE', 'ar'),
   ('حاسو?ب', 'INFORMATIQUE', 'ar'),
   ('خادم', 'INFORMATIQUE', 'ar'),
   ('آل(ة|ات)\s+(ال)?نسخ', 'INFORMATIQUE', 'ar'),
   ('معدات\s+(إعلامية|مكتبية|نقل|صناعية)', 'MATERIEL', 'ar'),
   ('أثاث', 'MOBILIER', 'ar')
 ) as v(motif, famille, langue)
 where p.jurisdiction = 'TN'
on conflict do nothing;

alter table ref.biens_immobilisables enable row level security;
alter table ref.biens_immobilisables force row level security;
revoke all on table ref.biens_immobilisables from public, anon;
grant select on table ref.biens_immobilisables to authenticated;
create policy ref_biens_immobilisables_sel on ref.biens_immobilisables
  for select to authenticated using (true);

commit;
