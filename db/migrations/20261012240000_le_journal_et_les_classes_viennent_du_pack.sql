-- Le journal d'une écriture, et la nature d'une classe, viennent du pack.
--
-- ================================================================= POURQUOI
--
-- Vérification comptable du 11 octobre 2026, défaut 2 consigné le même jour
-- dans `docs/verification-comptable-des-ecritures-2026-10-11.md`. Trois
-- constantes réglementaires vivaient en TypeScript, et R4 les nomme :
--
--   1. `journal: document_kind === "facture_achat" ? "ACH" : "VEN"`
--      (`propose-ecriture.ts`). Un code de journal appartient au plan de
--      l'organisation, pas au produit. `ref.journals` porte les quatre
--      journaux depuis le 31 août — ACH, VEN, BQ, OD — et rien ne les lisait.
--
--   2. `if (!code.startsWith("6") && !code.startsWith("7")) continue`
--      (`engines/pnl/snapshot.ts`). « La classe 6 est une charge » est une
--      propriété du plan comptable, pas une vérité universelle, et la
--      première juridiction qui numérote autrement rendrait un compte de
--      résultat vide — sans aucune erreur.
--
--   3. Le seuil d'écart entre la date d'une pièce et celle de sa réception,
--      qui n'existait pas : rien ne distinguait une date confirmée d'une date
--      acceptée sans la lire. Une facture de janvier confirmée en mars part
--      dans la déclaration de mars, et personne ne le voit.
--
-- ============================================= POURQUOI LE JOURNAL SUR L'IMPUTATION
--
-- `ref.account_mappings` dit déjà, par pack et par sens de document, quels
-- comptes mouvementer. Le journal est la même décision : où cette écriture
-- s'inscrit. Une table de plus aurait séparé deux faces d'un seul choix, et
-- la prochaine correction serait allée dans la moitié qu'on aurait sous les
-- yeux.
--
-- ============================ POURQUOI UNE CLASSE EST UN PRÉFIXE, ET NON UN CHIFFRE
--
-- `ref.accounts.account_class` existe, et ne suffit pas : elle dit de quelle
-- classe est un compte CONNU. Une écriture peut porter un compte absent du
-- plan livré — un compte qu'un cabinet a créé — et le compte de résultat ne
-- doit pas le perdre en silence.
--
-- La classe se reconnaît donc au PRÉFIXE du code, ce qui est la règle du plan
-- lui-même, et le préfixe le plus long gagne. Le moteur n'a plus besoin de
-- savoir que « 6 » signifie charge : il lit la nature.
--
-- R11 : toutes les dates sont littérales.

-- --- 1. Le journal de chaque imputation ---------------------------------------------------

alter table ref.account_mappings
  add column if not exists journal_code text references ref.journals(code);

comment on column ref.account_mappings.journal_code is
  'Le journal où s''inscrit l''écriture de ce sens de document. Il était écrit '
  'en TypeScript — « achat ? ACH : VEN » — et un code de journal appartient au '
  'plan de l''organisation, pas au produit.';

update ref.account_mappings set journal_code = 'ACH'
 where document_kind = 'facture_achat' and journal_code is null;
update ref.account_mappings set journal_code = 'VEN'
 where document_kind = 'facture_vente' and journal_code is null;

-- La vue : colonne AJOUTÉE À LA FIN. `create or replace view` refuse de
-- renommer ou de déplacer une colonne existante.
create or replace view public.ref_account_mappings_v with (security_invoker = true) as
  select id, pack_version_id, document_kind, tax_code, main_account, vat_account,
         counterparty_account, journal_code
    from ref.account_mappings;

revoke all on table public.ref_account_mappings_v from public, anon, service_role;
grant select on table public.ref_account_mappings_v to authenticated, service_role;

-- --- 2. La nature d'une classe de comptes -------------------------------------------------

create table if not exists ref.account_classes (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  -- Le préfixe du code de compte. Le plus long gagne : « 63 » l'emporte sur
  -- « 6 » si un pack distingue un jour les charges financières.
  prefix          text not null,
  -- Ce que la classe EST, pour les moteurs : seules ces deux natures entrent
  -- au compte de résultat.
  nature          text not null check (nature in ('charge', 'produit', 'actif', 'passif')),
  libelle         text not null,
  valid_from      date not null,
  valid_to        date,
  unique (pack_version_id, prefix, valid_from)
);

comment on table ref.account_classes is
  'Ce qu''est une classe du plan : charge, produit, actif ou passif. Le moteur '
  'du compte de résultat testait `code.startsWith("6")` — une propriété du plan '
  'tunisien écrite dans le code du produit, qui aurait rendu un résultat vide '
  'dans la première juridiction numérotant autrement, sans aucune erreur.';

create index if not exists account_classes_pack_idx
  on ref.account_classes (pack_version_id, prefix);

-- Le référentiel est public en lecture pour qui est authentifié, comme les
-- autres tables de `ref` : il ne porte aucune donnée de tenant.
create or replace view public.ref_account_classes_v with (security_invoker = true) as
  select id, pack_version_id, prefix, nature, libelle, valid_from, valid_to
    from ref.account_classes;

revoke all on table public.ref_account_classes_v from public, anon, service_role;
grant select on table public.ref_account_classes_v to authenticated, service_role;

-- Les sept classes du plan comptable tunisien (NC 01). La date est celle du
-- pack, et non celle du jour : le plan ne commence pas à exister aujourd'hui.
insert into ref.account_classes (pack_version_id, prefix, nature, libelle, valid_from)
select p.id, c.prefix, c.nature, c.libelle, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
    ('1', 'passif',  'Comptes de capitaux propres et passifs non courants'),
    ('2', 'actif',   'Comptes d''actifs non courants'),
    ('3', 'actif',   'Comptes de stocks'),
    ('4', 'actif',   'Comptes de tiers'),
    ('5', 'actif',   'Comptes financiers'),
    ('6', 'charge',  'Comptes de charges'),
    ('7', 'produit', 'Comptes de produits')
  ) as c(prefix, nature, libelle)
 where p.jurisdiction = 'TN'
   and not exists (
     select 1 from ref.account_classes a
      where a.pack_version_id = p.id and a.prefix = c.prefix
   );

-- --- 3. Le seuil d'écart entre la date d'une pièce et sa réception ------------------------
--
-- Au-delà, la pièce est SIGNALÉE — pas refusée. Un dirigeant qui rattrape six
-- mois de factures saisit des dates de six mois, et c'est légitime : ce qui ne
-- l'est pas, c'est que personne ne le remarque.
--
-- Soixante jours : deux mois, soit le délai au-delà duquel une facture
-- échappe à la déclaration du mois de sa date. C'est un DÉFAUT livré au sens
-- de R10 — visible, daté, et que l'expert change sans déploiement.

insert into ref.socle_params (pack_version_id, code, value_num, valid_from)
select p.id, 'piece.ecart_date_jours', 60, p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and not exists (
     select 1 from ref.socle_params s
      where s.pack_version_id = p.id and s.code = 'piece.ecart_date_jours'
   );
