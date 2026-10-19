-- Une recette fabriquée se rattache à ce qui l'a produite, et son générateur a un tarif.
--
-- ================================================================== POURQUOI
--
-- Deux choses manquaient pour qu'une recette puisse NAÎTRE au lieu d'être
-- écrite à la main, et aucune des deux n'est cosmétique.
--
-- ------------------------------------------------------------ ① LA PROVENANCE
--
-- « Une recette qu'on ne peut pas rattacher à ce qui l'a produite n'est pas
-- auditable. » Le jour où un générateur s'avère mauvais, il faut retrouver ce
-- qu'il a produit sans relire chaque recette, et répondre à « qui a écrit
-- cette règle de lecture, avec quel modèle, sur quelles pièces ».
--
-- Ce n'est pas la `definition` : celle-ci est le LANGAGE, et son schéma est
-- `.strict()` — une clé de provenance glissée dedans serait refusée par le
-- validateur, et c'est juste. La provenance est donc une colonne à elle,
-- sur la même ligne, inscrite en même temps et jamais réécrite (R7, la table
-- est en ajout seul).
--
-- Le `check` reprend celui de `definition`, mot pour mot, et pour la même
-- raison : un `jsonb` accepte n'importe quelle clé, y compris celle que le
-- type interdit. Une facture arabe est sortie à 650 000 D là où le papier
-- portait 5 650 000 D parce qu'une valeur avait été recopiée au lieu d'être
-- relue ; une provenance qui porterait un montant rouvrirait ce chemin, à
-- l'endroit même où personne ne regarderait.
--
-- Le défaut `'{}'::jsonb` est du SCHÉMA, pas une donnée datée : R11 le permet
-- explicitement, et il évite qu'une version déjà inscrite devienne invalide.
--
-- ------------------------------------------------------------- ② LE TARIF
--
-- `public.agents_run_log` cherche un tarif par le COUPLE (modèle, rôle) et
-- LÈVE quand il n'en trouve pas ; l'appelant attrape, crie, et n'échoue pas —
-- ce qui est juste, et ce qui rend l'absence invisible. Le défaut a été nommé
-- QUATRE fois dans ce dépôt : le rôle « reasoner » écrit en dur le 5 octobre
-- (dix jours de désignations non mesurées), le suffixe « +pdf-scan » le 15,
-- l'étude de l'OCR le 18, et la recette qui désigne le 20.
--
-- Le générateur est le cinquième organe, et le premier qui COÛTE vraiment :
-- il appelle le raisonneur. Son rôle lui est propre — `generateur` — parce
-- que le plan de la fabrique demande le coût TOTAL par document, « génération,
-- observation, évaluation et secours compris » : la génération logée sous
-- `reasoner` se confondrait avec la désignation, et deux dépenses qu'on ne
-- peut pas séparer sont deux dépenses qu'on ne sait pas attribuer.
--
-- Le prix est celui du raisonneur, à l'identique — c'est le même modèle, sous
-- un autre rôle. Il n'est pas inventé : il est repris, chiffre pour chiffre et
-- devise comprise, de la ligne (deepseek-reasoner, reasoner) du 1er janvier
-- 2026. Deux prix différents pour le même modèle diraient que l'un des deux
-- est faux.
--
-- La liste close du `check` se réécrit ENTIÈRE, et en oublier un terme
-- supprimerait en silence ce que quelqu'un d'autre avait ouvert — « cache »
-- et « embedding » y figurent pour cela.
--
-- R11 : `effective_from` en littéral, `currency` écrite plutôt que laissée au
-- défaut. La date est celle du plan de la fabrique, comme les autres
-- livraisons de ce lot ; une date postérieure au jour où la migration se joue
-- rendrait le tarif absent, et l'organe se journaliserait en silence — ce que
-- cette migration existe précisément pour empêcher.

begin;

-- ------------------------------------------------------------ ① LA PROVENANCE

alter table fabrique.recette_versions
  add column if not exists provenance jsonb not null default '{}'::jsonb;

alter table fabrique.recette_versions
  drop constraint if exists recette_versions_provenance_sans_valeur;

alter table fabrique.recette_versions
  add constraint recette_versions_provenance_sans_valeur
  check (jsonb_typeof(provenance) = 'object'
         and not jsonb_path_exists(provenance, '$.**.valeur')
         and not jsonb_path_exists(provenance, '$.**.value')
         and not jsonb_path_exists(provenance, '$.**.montant')
         and not jsonb_path_exists(provenance, '$.**.amount'));

comment on column fabrique.recette_versions.provenance is
  'Ce qui a produit cette version : générateur, version du langage, version '
  'de la forme des signatures, modèle et rôle appelés, pièces d''apprentissage '
  'retenues, ossature commune. Jamais une valeur lue — le `check` le refuse, '
  'comme il le refuse déjà pour la définition.';

-- --------------------------------------------------------------- ② LE TARIF

alter table agents.model_pricing
  drop constraint if exists model_pricing_role_check;

alter table agents.model_pricing
  add constraint model_pricing_role_check
  check (role in ('reasoner', 'chat', 'vision', 'cache', 'embedding', 'recette', 'generateur'));

comment on column agents.model_pricing.role is
  'Le rôle sous lequel l''organe a été appelé. Le tarif se cherche par le '
  'COUPLE (modèle, rôle) : un rôle écrit en dur à côté d''un modèle dérivé '
  'd''ailleurs a déjà fait disparaître dix jours de mesures. « recette » est '
  'l''interprète déterministe de la fabrique de lecteurs ; « generateur » est '
  'ce qui PROPOSE une recette à partir d''exemples, et il se sépare de '
  '« reasoner » pour que la génération ne se confonde pas avec la désignation '
  'dans le coût par document.';

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign,
   effective_from)
values
  ('deepseek', 'deepseek-reasoner', 'generateur', 0.560, 1.680, 'USD', false, date '2026-10-18')
on conflict do nothing;

commit;
