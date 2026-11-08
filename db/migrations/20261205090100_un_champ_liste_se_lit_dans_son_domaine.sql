-- Un champ « liste » se lit dans le DOMAINE de son concept, et rend un code.
--
-- ==================================================================== POURQUOI
--
-- Banc sans IA du 4 novembre 2026 : un champ liste rendait le texte du repère
-- imprimé — « règlement: » pour le mode de règlement (15 pièces), « (DT) » pour la
-- devise (31). Les repères d'un champ liste mêlent des ÉTIQUETTES (« Mode de
-- paiement ») et des VALEURS (« Chèque ») : rien ne disait lesquelles sont des
-- valeurs, ni à quel code elles renvoient.
--
-- Le référentiel le sait déjà : chaque code y porte son libellé en français, en
-- anglais et en arabe (`ref.labels`, R12), et les devises leurs marques imprimées
-- (`ref.devises_marques`). Un concept nomme désormais son domaine ; le domaine
-- donne, pour chaque code, toutes ses formes imprimables. Le moteur ne rend plus
-- qu'un code du domaine, jamais un mot de la page.
--
-- ===================================================================== CE QUI EST POSÉ
--
--   - `ref.concepts.domaine` : l'espace de noms du domaine (`ref.labels.ns`, ou
--     `devise` pour les devises et leurs marques) ; null, le champ garde sa lecture.
--   - `public.ref_valeurs_des_domaines_v` (domaine, code, forme) : les formes de
--     chaque code — son code lui-même, ses libellés dans les trois langues, et, pour
--     les devises, leurs marques.
--   - `ref.formes_des_valeurs` : les formes imprimées d'un code que ses libellés ne
--     disent pas (« CARTE » sur un ticket pour la carte bancaire, « صك » pour le
--     chèque) — des données, versionnées, que le cabinet complète sans déploiement.
--   - Deux domaines, ceux que le banc a pris en défaut : le mode de paiement
--     (`moyen_paiement`) et la devise.

alter table ref.concepts add column if not exists domaine text;

update ref.concepts set domaine = 'moyen_paiement' where code = 'mode_paiement' and domaine is distinct from 'moyen_paiement';
update ref.concepts set domaine = 'devise' where code = 'devise' and domaine is distinct from 'devise';

-- Ajoutée À LA FIN : `create or replace view` refuse tout autre changement.
create or replace view public.ref_concepts_v with (security_invoker = true) as
  select id, pack_version_id, code, libelle, expert, statut, valid_from, valid_to,
         porte_sur_une_partie, domaine
    from ref.concepts;

create table if not exists ref.formes_des_valeurs (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  domaine         text not null,
  code            text not null,
  forme           text not null,
  source          text not null,
  valid_from      date not null,
  valid_to        date,
  unique (pack_version_id, domaine, code, forme, valid_from)
);
alter table ref.formes_des_valeurs enable row level security;
alter table ref.formes_des_valeurs force row level security;
drop policy if exists formes_des_valeurs_lecture on ref.formes_des_valeurs;
create policy formes_des_valeurs_lecture on ref.formes_des_valeurs for select to authenticated using (true);
revoke all on table ref.formes_des_valeurs from public, anon;
grant select on table ref.formes_des_valeurs to authenticated;

insert into ref.formes_des_valeurs (pack_version_id, domaine, code, forme, source, valid_from)
select p.id, f.domaine, f.code, f.forme, f.source, date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('moyen_paiement', 'carte_bancaire', 'Carte', 'pratique : « Mode de règlement : CARTE » (ticket, facture de grande surface)'),
   ('moyen_paiement', 'carte_bancaire', 'CB', 'pratique'),
   ('moyen_paiement', 'carte_bancaire', 'TPE', 'pratique'),
   ('moyen_paiement', 'especes', 'Comptant', 'pratique'),
   ('moyen_paiement', 'cheque', 'صك', 'pratique (arabe tunisien écrit)'),
   ('moyen_paiement', 'especes', 'نقدا', 'pratique'),
   ('moyen_paiement', 'virement', 'تحويل', 'pratique')
 ) as f(domaine, code, forme, source)
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, domaine, code, forme, valid_from) do nothing;

create or replace view public.ref_valeurs_des_domaines_v with (security_invoker = true) as
  select l.ns as domaine, l.key as code, l.value as forme
    from ref.labels l
   where l.ns in (select distinct domaine from ref.concepts where domaine is not null)
  union
  select l.ns, l.key, l.key
    from ref.labels l
   where l.ns in (select distinct domaine from ref.concepts where domaine is not null)
  union
  select 'devise', d.code, d.code from ref.devises d
  union
  select 'devise', m.devise, m.marque from ref.devises_marques m
  union
  select f.domaine, f.code, f.forme from ref.formes_des_valeurs f;

-- L'étiquette que les pièces impriment le plus pour le mode de paiement manquait aux
-- repères (« Mode de règlement », « طريقة الدفع ») : sans elle, la valeur n'est ancrée
-- par rien. Ajoutée à tous les champs du concept, dans toutes les grilles.
update ref.grille_champs gc
   set reperes_fr = gc.reperes_fr || array['Mode de règlement']
  from ref.concepts k
 where k.id = gc.concept_id and k.code = 'mode_paiement'
   and not ('Mode de règlement' = any (gc.reperes_fr));
update ref.grille_champs gc
   set reperes_ar = gc.reperes_ar || array['طريقة الدفع']
  from ref.concepts k
 where k.id = gc.concept_id and k.code = 'mode_paiement'
   and not ('طريقة الدفع' = any (gc.reperes_ar));

revoke all on table public.ref_valeurs_des_domaines_v from public, anon, service_role;
grant select on table public.ref_valeurs_des_domaines_v to authenticated;
