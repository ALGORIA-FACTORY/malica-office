-- Un forfait se change, un accès a un début et une fin, et quelqu'un le paie.
--
-- ================================================================== POURQUOI
--
-- Le 18 octobre, `facturation.licences` a appris à porter un forfait et ses
-- places. Trois notions lui manquaient, et ce sont celles qui font vivre le
-- canal cabinet :
--
--   1. PERSONNE NE SAIT QUI PAIE. Le prix se lit dans `droits_v`, et rien ne
--      dit à qui l'envoyer. Or la règle D9 du 17 octobre pose deux payeurs sur
--      une même entité : le cabinet paie la base au prix public (19 DT HT,
--      aucune remise ni commission — contrainte de l'OECT), la PME monte seule
--      en Team ou en Premium sans sortir de l'accès ouvert par le cabinet, et
--      elle paie LA DIFFÉRENCE.
--
--   2. LE FORFAIT NE CHANGE PAS. `licences.offre_code` s'écrit à la
--      souscription et plus jamais. Aucun chemin pour monter, aucun pour
--      redescendre — alors que la dégradation est une demande explicite, et
--      qu'elle est le cas le plus délicat : une PME affectée en Solo et montée
--      en Premium redescend jusqu'au Solo, QUI EST SON PLANCHER tant que
--      l'accès ouvert par le cabinet vit. Elle ne descend pas en Basic sans
--      que cet accès cesse.
--
--   3. L'ACCÈS N'A PAS DE DURÉE. `facturation.licence_organisations` dit
--      QUELLE organisation est sur la licence, et rien de QUAND. Or c'est le
--      QUAND qui se facture : l'étape 3B nomme déjà « le compteur de
--      jours-licence par cabinet — lui seul produit la facture au prorata ».
--      Sans dates, aucun prorata, et aucune facture réexplicable deux ans
--      après.
--
-- ============================================ LES INTERVALLES, PAR LA BASE
--
-- Les deux nouvelles tables portent des PÉRIODES, et une période mal gardée
-- produit silencieusement des doubles facturations. Le dépôt sait déjà s'en
-- protéger : `ref.fiscal_parameters` (20260831120500) et
-- `identity.fiches_fiscales` (20260901210000) emploient `btree_gist` et
-- `exclude using gist (… daterange(du, au, '[)') with &&)`. On suit cette
-- convention, bornes comprises :
--
--   `effet_du` est INCLUSE, `effet_au` est EXCLUE, `null` veut dire « court
--   encore ». Un forfait du 1er au 31 mars s'écrit donc [2026-03-01,
--   2026-04-01), et le lendemain de la fin n'a plus à être calculé avec un
--   « + 1 » dispersé dans six vues : c'est la borne elle-même.
--
-- Une seule divergence, assumée, avec le socle fiscal : il exige `valid_to >
-- valid_from` ; ici `effet_au >= effet_du` est admis. Une version de paramètre
-- qui n'a jamais eu cours est du bruit ; une période de forfait ouverte puis
-- corrigée LE JOUR MÊME est un fait qui a eu lieu, et R7 veut qu'il laisse sa
-- trace. L'intervalle est alors vide, ne chevauche rien, et la contrainte
-- d'exclusion l'accepte sans qu'aucun jour ne se facture deux fois.
--
-- Ce que `EXCLUDE` garantit : jamais deux forfaits sur un même jour pour une
-- même licence, jamais deux accès sur un même jour pour une même organisation.
-- Ce qu'il ne garantit PAS : l'absence de TROU — un intervalle ne sait rien de
-- son voisin. C'est le déclencheur `facturation.forfait_sans_trou` qui l'exige,
-- et il le dit : une période reprend le jour où la précédente s'arrête.
--
-- ======================================= CE QU'EST UNE LICENCE, ET CE QU'ELLE N'EST PAS
--
-- Une licence n'est pas un objet qu'on détient, qu'on stocke et qu'on déplace.
-- C'est LE DROIT, POUR DES ORGANISATIONS DONNÉES, D'UTILISER MALICA PENDANT UN
-- INTERVALLE, À UN NIVEAU DONNÉ. Elle reste une table parce qu'un Premium
-- couvre deux sociétés et jusqu'à dix : le forfait est au-dessus du dossier,
-- et c'est tout ce qu'elle porte.
--
-- Ce qui n'existe donc PAS ici, par décision du dirigeant — « pas de max pour
-- le cabinet », « c'est commercial » : aucun stock de licences réservées,
-- aucun quota par cabinet, aucune place à réserver. Un cabinet dote qui il
-- veut ; ALGORIA facture des ACTIVATIONS. Le titulaire est la personne, c'est
-- elle qui paie, et on peut lui affecter UNE OU PLUSIEURS licences —
-- `licences_titulaire_idx` n'est pas unique, et c'est voulu.
--
-- ======================================= TROIS FAITS, ET ILS NE SE CONFONDENT PAS
--
--   L'ACCÈS       — `facturation.acces` : d'un jour à un jour, pour UNE
--     organisation, à un niveau, décidé par quelqu'un. C'est ce qui se
--     facture au prorata. Proposé, actif, suspendu, terminé — les quatre mots
--     d'`identity.engagements`, et non un second vocabulaire pour le même
--     geste.
--
--   LE DÉCIDEUR   — qui a ouvert l'accès : un cabinet, ou la société
--     elle-même. Il détermine le destinataire de la facture, et c'est son
--     retrait qui déclenche D10.
--
--   L'ORIGINE     — comment la licence est née. Un fait immuable : une licence
--     née d'un cabinet et reprise deux ans plus tard en direct reste née du
--     canal cabinet. C'est ce fait, et lui seul, qui porte la comparaison du
--     rendement des deux canaux, rétroactivement comprise.
--
-- ===================================== CE QUI SE DÉDUIT, ET CE QUI S'INSCRIT
--
-- « Tout dans la base, bien linké et tracé et calculé. »
--
--   LINKÉ   — `offre_code` cesse d'être un `check (code in (...))` recopié
--             dans quatre tables : clé étrangère vers `ref.offre_codes`. Un
--             code inexistant ne peut plus entrer, et un cinquième s'ajoute
--             par une ligne de table, non par une migration.
--
--   TRACÉ   — `facturation.forfait_historique` porte une ligne par période de
--             forfait, `facturation.acces` une ligne par intervalle d'accès.
--             Qui payait quoi au 3 mars reste lisible en décembre, sinon
--             aucune facture n'est explicable.
--
--   CALCULÉ — le forfait courant NE SE STOCKE PAS : il est la période ouverte
--             de l'historique. LE PAYEUR INITIAL NE SE STOCKE PAS : il est la
--             première ligne de `payeurs_v`. Prix total, part du cabinet, part
--             de la cliente, jours-licence, prorata : tout en SQL (R3).
--
-- ============================================= LE CAS D'ÉPREUVE, EN CHIFFRES
--
-- « Audicorp m'envoie une invitation Solo et moi je monte en Premium : la
-- facture part à Audicorp 19 DT HT et au client 30 DT HT s'il n'a acheté ni
-- organisation ni siège. »
--
--   part cabinet = prix de SA ligne de grille (`solo`, à la date de grille
--                  figée sur SON accès), plafonnée par le total   → 19,000
--   part cliente = total − part cabinet                          → 30,000
--   total        = ce que `droits_v` rend déjà (`premium`)        → 49,000
--
-- Aucun de ces trois nombres n'est écrit ici : les trois sortent de
-- `ref.offres`. La grille change, le même SQL rend les nouveaux montants.
-- Et si la cliente ajoute sièges ou sociétés au-delà des inclus, les
-- suppléments sont ENTIÈREMENT pour elle : la part du cabinet est plafonnée
-- par le niveau qu'il a ouvert, jamais par ce que sa cliente consomme.
--
-- ============================== DEUX PAYEURS EXIGENT DEUX FACTURES, ET LA CLÉ LE REFUSAIT
--
-- `facturation.factures` (20261019110000) portait `unique (licence_id,
-- periode, avoir_de)` et AUCUNE colonne de destinataire. Deux défauts, et le
-- second est pire que le premier :
--
--   — la table ne pouvait pas représenter deux payeurs : une seule facture par
--     licence et par période, et rien pour dire à qui elle part ;
--   — la clé était par surcroît INERTE pour les factures ordinaires.
--     `avoir_de` y est nul, et dans un `unique` les nuls sont tous distincts :
--     deux factures de la même licence sur le même mois passaient déjà. La
--     contrainte n'interdisait que les doublons d'AVOIR.
--
-- Le payeur et son rôle entrent donc dans la clé, et le destinataire devient
-- explicite et FIGÉ sur la facture — un cabinet renommé en mars ne réécrit pas
-- la facture de février. Une place donne UNE OU DEUX factures selon qui a doté
-- quoi, et jamais trois.
--
-- ===================================== LE TIMBRE EST PAR FACTURE, PAS PAR LICENCE
--
-- Conséquence fiscale du partage, et elle surprend : deux payeurs font deux
-- factures, donc DEUX droits de timbre. 19 × 1,19 + 1 = 23,610 et
-- 30 × 1,19 + 1 = 36,700, soit 60,310 — contre 59,310 si un seul payeur
-- réglait les 49. Le partage coûte exactement 1 DT de plus. Ce n'est pas un
-- arrondi : le timbre est dû par facture et ne se récupère pas.
--
-- Les vues de ce fichier ne portent donc AUCUN TTC et AUCUN taux. Le taux et
-- le timbre sont des constantes réglementaires (R4), lus du pack fiscal par
-- `facturation.emettre`, à l'émission, une fois par facture émise.
--
-- ==================================== TROIS TABLES QUI N'ONT RIEN À VOIR
--
-- Elles portent les mêmes mots et répondent à d'autres questions ; aucune
-- ligne d'ici ne s'y adosse.
--
--   `billing.*`, `catalog.*`, `pricing.*`  — les VENTES de la cliente ;
--   `collab.mandats_honoraires`            — les honoraires du cabinet à ses
--                                            clientes, et non l'abonnement ;
--   `agents.budgets.monthly_cost_cap`      — un plafond en DOLLARS chez le
--                                            fournisseur de modèles.
--
-- ============================================== CE QU'ELLE NE FAIT PAS
--
-- Elle n'encaisse rien, n'ouvre aucune page de paiement, n'envoie aucun
-- avertissement de détachement (D10 l'exige au moment même : c'est
-- `notif.envois`, et ce n'est pas ici), et ne décide d'aucune relance.
--
-- ============================================== REJEU (R11)
--
-- Deux rejeux doivent passer, et chaque énoncé est écrit pour les deux :
--
--   — une base NEUVE, où rien de ce fichier n'existe (la CI) ;
--   — une base À MOITIÉ APPLIQUÉE, où `ref.offres.rang` et
--     `ref.offres_par_canal` existent déjà et où tout `facturation.*` manque.
--
-- D'où, partout et sans exception : `create … if not exists`,
-- `add column if not exists`, `create or replace`, `drop … if exists` avant
-- chaque `create` qui ne sait pas se remplacer (contrainte, déclencheur,
-- politique, vue dont les colonnes bougent), et `on conflict do nothing` sur
-- chaque graine. Aucune colonne n'est ajoutée avec son `not null` : elle naît
-- nullable, on la remplit, puis on la contraint — sans quoi le rejeu sur la
-- base du dirigeant échouerait sur la première ligne existante.

begin;

-- `btree_gist` est déjà déclaré par `20260831120500_socle_fiscal.sql`, qui
-- s'exécute avant celui-ci sur une base neuve. La ligne est répétée parce
-- qu'elle est idempotente et que ce fichier dépend de l'extension pour ses
-- deux contraintes d'exclusion : la dépendance est écrite là où elle sert.
create extension if not exists btree_gist;

-- ===========================================================================
-- 1. LES CODES D'OFFRE DEVIENNENT UNE TABLE
-- ===========================================================================
--
-- `check (code in ('basic','solo','team','premium'))` était recopié dans
-- `ref.offres` et `facturation.licences`, et absent de
-- `facturation.factures` : trois endroits pour une liste, dont un non gardé —
-- et aucun moyen d'ajouter un code sans migration, ce que la tour doit
-- précisément pouvoir faire.

create table if not exists ref.offre_codes (
  code       text primary key check (length(btrim(code)) > 0),
  -- Le libellé français de secours. La traduction vit dans `ref.labels`,
  -- espace de noms `offre` ; celui-ci est un repli VISIBLE, donc pas un repli
  -- implicite au sens de R4.
  libelle    text not null,
  sort_order smallint not null default 100,
  created_at timestamptz not null default now()
);

comment on table ref.offre_codes is
  'Les codes d''offre existants. Une table et non un `check` : la tour en '
  'ajoute un sans migration, et cinq colonnes y pointent par clé étrangère.';

insert into ref.offre_codes (code, libelle, sort_order) values
  ('basic', 'Basic', 10), ('solo', 'Solo', 20),
  ('team', 'Team', 30), ('premium', 'Premium', 40)
on conflict (code) do nothing;

-- ===========================================================================
-- 2. L'ÉCHELLE DES OFFRES
-- ===========================================================================
--
-- Monter, descendre, « jusqu'où » : trois questions qui demandent un ORDRE, et
-- `ref.offres` n'en portait aucun. L'écrire en SQL — `case when code =
-- 'premium' then 4 ...` — serait la constante que R4 interdit, et il faudrait
-- la retrouver le jour où une cinquième offre s'insère entre deux autres.
--
-- Le rang vit donc sur la ligne de grille, versionné avec elle. Deux offres de
-- même rang sont interchangeables : le plancher se compare par `>=`, et
-- l'égalité passe. C'est voulu, et c'est pourquoi aucun unique ne le garde.

alter table ref.offres add column if not exists rang smallint;

update ref.offres set rang = case code
    when 'basic' then 1 when 'solo' then 2 when 'team' then 3 when 'premium' then 4 end
 where rang is null and code in ('basic','solo','team','premium');

alter table ref.offres alter column rang set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'ref.offres'::regclass and conname = 'offres_rang_positif') then
    alter table ref.offres add constraint offres_rang_positif check (rang > 0);
  end if;
end
$$;

comment on column ref.offres.rang is
  'L''échelle : plus haut, plus riche. Ce qui décide d''une montée, d''une '
  'descente, et du plancher qu''un accès de cabinet impose.';

-- Le `check` recopié cède la place à la clé étrangère.
alter table ref.offres drop constraint if exists offres_code_check;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'ref.offres'::regclass and conname = 'offres_code_fkey') then
    alter table ref.offres add constraint offres_code_fkey
      foreign key (code) references ref.offre_codes(code) on delete restrict;
  end if;
end
$$;

-- ===========================================================================
-- 3. LES CANAUX, ET CE QUE CHACUN PEUT VENDRE
-- ===========================================================================
--
-- Deux canaux, et ils n'obéissent pas aux mêmes règles. Le canal DIRECT vend
-- les quatre offres à qui les demande. Le canal CABINET est limité au SOLO en
-- libre-service : le cabinet achète au prix public et l'inclut dans ses
-- honoraires, sans remise, sans tarif revendeur, sans commission — contrainte
-- de l'OECT, et non un choix commercial.
--
-- Team et Premium par un cabinet existent, mais en COMMANDE SPÉCIALE : un
-- opérateur les pose, jamais un parcours en libre-service. Et Basic est une
-- offre de canal direct — le commerçant ou l'artisan seul ; un cabinet
-- n'ouvre pas un accès Basic.
--
-- Ces règles ne sont pas du code : une matrice, datée, que la tour modifie en
-- posant une ligne à une nouvelle date d'effet.

create table if not exists ref.canaux (
  code       text primary key check (length(btrim(code)) > 0),
  libelle    text not null,
  created_at timestamptz not null default now()
);

comment on table ref.canaux is
  'Par quel chemin une licence naît. `direct` : la PME ou le commerçant '
  's''abonne. `cabinet` : un cabinet dote une cliente, et paie pour elle.';

insert into ref.canaux (code, libelle) values
  ('direct',  'Direct'),
  ('cabinet', 'Cabinet')
on conflict (code) do nothing;

create table if not exists ref.offres_par_canal (
  canal              text not null references ref.canaux(code) on delete restrict,
  offre_code         text not null references ref.offre_codes(code) on delete restrict,
  libre_service      boolean,
  commande_speciale  boolean,
  cabinet_peut_ouvrir boolean,
  -- R11 : la date est écrite, jamais `current_date`.
  effective_from     date not null,
  created_at         timestamptz not null default now(),
  primary key (canal, offre_code, effective_from)
);

-- La table existe peut-être déjà, à moitié : la première rédaction de ce
-- fichier l'a posée sur la base du dirigeant. Les trois colonnes se rajoutent
-- donc une par une, puis se contraignent — jamais l'inverse.
alter table ref.offres_par_canal add column if not exists libre_service boolean;
alter table ref.offres_par_canal add column if not exists commande_speciale boolean;
alter table ref.offres_par_canal add column if not exists cabinet_peut_ouvrir boolean;

-- Et une colonne à RETIRER. Cette même première rédaction avait posé
-- `reservation_permise` en NOT NULL sans défaut. Le modèle retenu nomme ce
-- fait `cabinet_peut_ouvrir`, et plus aucun fichier du dépôt ne cite l'ancien
-- nom — vérifié. Sur une base neuve la colonne n'existe pas et cette ligne ne
-- fait rien ; sur la base de l'atelier elle existe, elle n'a pas de défaut, et
-- elle fait échouer TOUTE insertion qui suit. Mesuré à l'exécution :
--   « une valeur NULL viole la contrainte NOT NULL de la colonne
--     "reservation_permise" dans la relation "offres_par_canal" »
-- R9 : rien de mort ne reste.
alter table ref.offres_par_canal drop column if exists reservation_permise;

-- Ce qu'un cabinet peut OUVRIR pour une cliente est, à la grille du 17
-- octobre, exactement ce qu'il peut commander : le libre-service et la
-- commande spéciale réunis. On le DÉDUIT pour les lignes déjà posées sans
-- cette colonne, au lieu de la laisser nulle et de la lire comme un refus.
update ref.offres_par_canal
   set cabinet_peut_ouvrir = (canal = 'cabinet'
                              and (coalesce(libre_service, false)
                                   or coalesce(commande_speciale, false)))
 where cabinet_peut_ouvrir is null;

insert into ref.offres_par_canal
  (canal, offre_code, libre_service, commande_speciale, cabinet_peut_ouvrir, effective_from)
values
  ('direct',  'basic',   true,  true,  false, date '2026-10-17'),
  ('direct',  'solo',    true,  true,  false, date '2026-10-17'),
  ('direct',  'team',    true,  true,  false, date '2026-10-17'),
  ('direct',  'premium', true,  true,  false, date '2026-10-17'),
  ('cabinet', 'basic',   false, false, false, date '2026-10-17'),
  ('cabinet', 'solo',    true,  true,  true,  date '2026-10-17'),
  ('cabinet', 'team',    false, true,  true,  date '2026-10-17'),
  ('cabinet', 'premium', false, true,  true,  date '2026-10-17')
on conflict (canal, offre_code, effective_from) do nothing;

alter table ref.offres_par_canal alter column libre_service set not null;
alter table ref.offres_par_canal alter column commande_speciale set not null;
alter table ref.offres_par_canal alter column cabinet_peut_ouvrir set not null;

-- Et une COLONNE MAL PLACÉE, qui est le dernier reste de cette première
-- rédaction. `add column` ajoute EN FIN DE LIGNE : sur la base de l'atelier,
-- `cabinet_peut_ouvrir` est en position 7, et en 5 sur une base montée depuis
-- les migrations. `db/registre.test.mjs` le voit — « une colonne déplacée »
-- est l'un des quatre écarts qu'il se prouve capable de détecter — et il
-- rougissait : trois colonnes « différent », rien d'autre que leur rang.
--
-- PostgreSQL ne déplace pas une colonne : la table se REPOSE. Elle le peut
-- sans rien perdre, parce qu'elle est une grille livrée — son contenu est
-- écrit huit lignes plus bas, et elle ne porte aucune donnée de dossier.
--
-- `cascade` ne tombe que sur `ref.canal_offre_a`, dont le TYPE DE RETOUR est
-- cette table (mesuré : c'est la seule dépendance, et la section 6 la repose
-- quelques lignes plus loin). La politique et les droits tombent avec la
-- table ; la section 19 les repose. Les trois contraintes sont RENOMMÉES :
-- sans cela la base porterait `offres_par_canal_reposee_pkey` et le registre
-- dériverait pour un nom au lieu d'un rang.
--
-- La table de transit naît dans `app` et non dans `ref`, et c'est une raison
-- mesurée : `db/reproductibilite.mjs` lit TOUTE écriture dans `ref` comme une
-- donnée de référence, et le `default now()` de `created_at` à côté d'un
-- `insert into ref.…` dans le même bloc devenait une valeur non reproductible
-- (R11). Un transit n'est pas une grille livrée : il ne porte pas ce nom-là.
do $$
declare
  v_ordre text[];
begin
  select array_agg(a.attname::text order by a.attnum) into v_ordre
    from pg_catalog.pg_attribute a
   where a.attrelid = 'ref.offres_par_canal'::regclass
     and a.attnum > 0 and not a.attisdropped;

  if v_ordre = array['canal', 'offre_code', 'libre_service', 'commande_speciale',
                     'cabinet_peut_ouvrir', 'effective_from', 'created_at'] then
    return;
  end if;

  create table app.offres_par_canal_reposee (
    canal              text not null references ref.canaux(code) on delete restrict,
    offre_code         text not null references ref.offre_codes(code) on delete restrict,
    libre_service      boolean not null,
    commande_speciale  boolean not null,
    cabinet_peut_ouvrir boolean not null,
    effective_from     date not null,
    created_at         timestamptz not null default now(),
    primary key (canal, offre_code, effective_from)
  );

  insert into app.offres_par_canal_reposee
    (canal, offre_code, libre_service, commande_speciale, cabinet_peut_ouvrir,
     effective_from, created_at)
  select canal, offre_code, libre_service, commande_speciale, cabinet_peut_ouvrir,
         effective_from, created_at
    from ref.offres_par_canal;

  drop table ref.offres_par_canal cascade;
  alter table app.offres_par_canal_reposee set schema ref;
  alter table ref.offres_par_canal_reposee rename to offres_par_canal;
  alter table ref.offres_par_canal
    rename constraint offres_par_canal_reposee_pkey to offres_par_canal_pkey;
  alter table ref.offres_par_canal
    rename constraint offres_par_canal_reposee_canal_fkey to offres_par_canal_canal_fkey;
  alter table ref.offres_par_canal
    rename constraint offres_par_canal_reposee_offre_code_fkey
                   to offres_par_canal_offre_code_fkey;
end
$$;

comment on table ref.offres_par_canal is
  'Ce que chaque canal peut vendre, versionné par date d''effet. Les huit '
  'croisements sont écrits, FERMÉS COMPRIS : la table DIT que Basic n''est pas '
  'une offre de cabinet, au lieu de le taire par une absence.';

comment on column ref.offres_par_canal.cabinet_peut_ouvrir is
  'Un cabinet peut OUVRIR cet accès pour une cliente. Distinct des deux '
  'autres : ouvrir pour un autre, c''est payer pour un autre.';

-- ===========================================================================
-- 4. LES MOTIFS ET LES RÔLES, EN RÉFÉRENTIEL
-- ===========================================================================
--
-- `ref.rejet_motifs` et `ref.paiement_motifs_annulation` ont posé le motif :
-- un motif est une donnée du référentiel, pas un `check` dans une migration.
-- On suit, pour la même raison — un motif se relit un an après devant un
-- client, et il s'en ajoute un sans déploiement.

create table if not exists ref.forfait_motifs (
  code       text primary key check (length(btrim(code)) > 0),
  libelle    text not null,
  sort_order smallint not null default 100,
  active     boolean not null default true
);

insert into ref.forfait_motifs (code, libelle, sort_order) values
  ('souscription',      'Souscription',                    10),
  ('acces_cabinet',     'Accès ouvert par le cabinet',      20),
  ('montee',            'Montée de forfait',                30),
  ('descente',          'Descente de forfait',              40),
  ('commande_speciale', 'Commande spéciale',                50),
  ('fin_acces_cabinet', 'Fin de l''accès du cabinet',        60),
  ('correction',        'Correction',                       70)
on conflict (code) do nothing;

create table if not exists ref.fin_motifs (
  code       text primary key check (length(btrim(code)) > 0),
  libelle    text not null,
  sort_order smallint not null default 100,
  active     boolean not null default true
);

comment on table ref.fin_motifs is
  'Pourquoi un accès cesse. Nommer la fin est ce qui distingue un retrait '
  'd''un impayé — et D10 exige qu''on le dise au client, au moment même.';

insert into ref.fin_motifs (code, libelle, sort_order) values
  ('retrait_cabinet',    'Retrait par le cabinet',          10),
  ('revocation_client',  'Révocation par la cliente',       20),
  ('reprise_directe',    'Reprise en souscription directe', 30),
  ('impaye',             'Impayé',                          40),
  ('fin_engagement',     'Fin du mandat',                   50),
  ('changement_cabinet', 'Changement de cabinet',           60),
  ('resiliation',        'Résiliation',                     70)
on conflict (code) do nothing;

-- Le RÔLE du payeur. Deux natures, et elles ne sont pas du même ordre : un
-- cabinet est une organisation, un titulaire est une personne. Le rôle entre
-- dans la clé de `facturation.factures` ; il ne peut donc pas être un `check`
-- recopié à côté d'elle.
create table if not exists ref.payeur_types (
  code       text primary key check (length(btrim(code)) > 0),
  libelle    text not null,
  -- `organisation` ou `personne` : ce que l'identité du payeur désigne. C'est
  -- cette colonne qui dit laquelle des deux colonnes d'identité est remplie.
  nature     text not null check (nature in ('organisation','personne')),
  sort_order smallint not null default 100
);

insert into ref.payeur_types (code, libelle, nature, sort_order) values
  ('cabinet',   'Cabinet',   'organisation', 10),
  ('titulaire', 'Titulaire', 'personne',     20)
on conflict (code) do nothing;

comment on table ref.payeur_types is
  'Qui peut payer un abonnement, et de quelle nature est son identité. Le '
  'rôle du payeur entre dans la clé des factures : il est une donnée.';

-- ===========================================================================
-- 5. LA FORME DE LA RÉFÉRENCE PARLANTE
-- ===========================================================================
--
-- Décision du 19 octobre, non rouverte : la référence dit QUEL CABINET, SI
-- L'ABONNÉ EST SOLO, et L'ÉVOLUTION. Forme retenue :
--
--     ABO-00042-02-AUD
--     │   │     │  └── le trigramme du cabinet qui sert l'abonné
--     │   │     └───── le rang de l'épisode (02 = deuxième cabinet)
--     │   └─────────── le numéro d'abonné, stable à vie
--     └─────────────── le préfixe
--
-- Un abonné parti d'Audicorp vers MAP Expert garde son numéro et change
-- d'épisode : `ABO-00042-01-AUD` puis `ABO-00042-02-MAP`.
--
-- LA MARQUE DU SOLO SANS CABINET est `ALG`, et le choix se justifie : la
-- quatrième place répond toujours à la même question — QUI SERT CET ABONNÉ —
-- et en direct, c'est ALGORIA. Trois caractères comme un trigramme, donc une
-- référence de LARGEUR CONSTANTE : `like 'ABO-00042-%'` reste un parcours
-- d'intervalle sur l'index, et la position de chaque champ reste exacte pour
-- un `substring`. Elle est purement A-Z0-9, donc triable à l'identique sous
-- n'importe quelle collation.
--
-- Pourquoi la forme vit en table et non dans la fonction : « tout doit être
-- géré dans la tour et paramétrable dans la tour ». Le préfixe, les largeurs
-- et la marque directe y sont donc des données datées. Une référence déjà
-- émise ne change pas pour autant : elle est FIGÉE sur la ligne d'accès.

create table if not exists ref.reference_abonne (
  code             text not null check (length(btrim(code)) > 0),
  prefixe          text not null check (prefixe ~ '^[A-Z]{2,5}$'),
  largeur_numero   smallint not null check (largeur_numero between 3 and 9),
  largeur_episode  smallint not null check (largeur_episode between 1 and 3),
  -- La marque que porte un abonné SANS cabinet. Trois caractères, comme un
  -- trigramme : la largeur de la référence ne doit pas dépendre du canal.
  marque_directe   text not null check (marque_directe ~ '^[A-Z0-9]{3}$'),
  separateur       text not null check (length(separateur) = 1),
  effective_from   date not null,
  created_at       timestamptz not null default now(),
  primary key (code, effective_from)
);

insert into ref.reference_abonne
  (code, prefixe, largeur_numero, largeur_episode, marque_directe, separateur, effective_from)
values ('abonnement', 'ABO', 5, 2, 'ALG', '-', date '2026-10-20')
on conflict (code, effective_from) do nothing;

comment on table ref.reference_abonne is
  'La forme de la référence parlante d''un abonné, datée et paramétrable. '
  'Changer la forme ne réécrit aucune référence déjà émise : elles sont '
  'figées sur la ligne d''accès qui les porte.';

-- ===========================================================================
-- 6. DEUX LECTURES DE GRILLE, ÉCRITES UNE FOIS
-- ===========================================================================
--
-- Le `join lateral` de `droits_v` écrit la première depuis le 18 octobre, et
-- six vues allaient la recopier.

create or replace function ref.offre_a(p_code text, p_a date)
returns ref.offres
language sql
stable
as $$
  select r.* from ref.offres r
   where r.code = p_code and r.effective_from <= p_a
   order by r.effective_from desc
   limit 1
$$;

comment on function ref.offre_a(text, date) is
  'La ligne de grille d''une offre à une date. Figée par `offre_depuis` : une '
  'hausse de tarif ne réécrit pas ce qu''un client a acheté.';

create or replace function ref.canal_offre_a(p_canal text, p_offre text, p_a date)
returns ref.offres_par_canal
language sql
stable
as $$
  select c.* from ref.offres_par_canal c
   where c.canal = p_canal and c.offre_code = p_offre and c.effective_from <= p_a
   order by c.effective_from desc
   limit 1
$$;

revoke all on function ref.offre_a(text, date) from public, anon;
revoke all on function ref.canal_offre_a(text, text, date) from public, anon;
grant execute on function ref.offre_a(text, date) to authenticated;
grant execute on function ref.canal_offre_a(text, text, date) to authenticated;

-- ===========================================================================
-- 7. L'ORIGINE D'UNE LICENCE — UN FAIT DE NAISSANCE, IMMUABLE
-- ===========================================================================
--
-- « Lors de la facturation je dois identifier le payeur initial (dans le cadre
-- d'activation ou invitation par le cabinet, ou le user lui-même). »
--
-- Trois faits distincts, et les confondre produit soit un doublon, soit une
-- perte :
--
--   L'ORIGINE         — comment la licence est venue à exister. Un événement,
--     pas un état, et il ne change JAMAIS. C'est lui qui porte la comparaison
--     du rendement des deux canaux, rétroactivement comprise.
--
--   LE PAYEUR INITIAL — la PREMIÈRE ligne de `facturation.payeurs_v`. Il ne
--     reçoit aucune colonne : `payeur_initial` serait le doublon qu'on
--     interdit, et le jour où les deux divergent plus personne ne sait
--     laquelle fait foi.
--
--   LE PAYEUR COURANT — la même lecture, à la date du jour. Il peut y en avoir
--     DEUX (règle D9) : c'est pourquoi `payeur_courant_v` rend des lignes et
--     non une colonne.
--
-- L'origine PRÉCÈDE le payeur, et c'est le cas limite qui l'exige : un cabinet
-- propose un accès, la cliente n'accepte jamais. La proposition existe
-- (`facturation.acces`, statut `propose`), la licence n'existe PAS encore, et
-- il n'y a donc aucun payeur. Les deux horloges ne démarrent pas ensemble.

alter table facturation.licences
  add column if not exists origine text not null default 'direct',
  add column if not exists origine_cabinet uuid
      references identity.organizations(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'facturation.licences'::regclass
                    and conname = 'licences_origine_fkey') then
    alter table facturation.licences add constraint licences_origine_fkey
      foreign key (origine) references ref.canaux(code) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'facturation.licences'::regclass
                    and conname = 'licences_origine_cabinet_coherente') then
    alter table facturation.licences add constraint licences_origine_cabinet_coherente
      check ((origine = 'cabinet') = (origine_cabinet is not null));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'facturation.licences'::regclass
                    and conname = 'licences_offre_code_fkey') then
    alter table facturation.licences drop constraint if exists licences_offre_code_check;
    alter table facturation.licences add constraint licences_offre_code_fkey
      foreign key (offre_code) references ref.offre_codes(code) on delete restrict;
  end if;
end
$$;

comment on column facturation.licences.origine is
  'Le canal par lequel la licence est NÉE. Immuable : le payeur change, '
  'l''origine jamais. `direct` est le défaut LIVRÉ (R10) — une licence née '
  'sans cabinet dans la boucle EST une souscription directe, et la porte '
  'qui répond à une proposition d''accès écrit `cabinet` explicitement.';

comment on column facturation.licences.origine_cabinet is
  'Le PREMIER cabinet, celui de la naissance. Les cabinets qui se succèdent '
  'sont tous dans `facturation.acces` ; l''origine ne nomme que le premier.';

comment on column facturation.licences.offre_code is
  'LA SOUSCRIPTION D''ORIGINE, et non le forfait courant. Le forfait courant '
  'est la période ouverte de `facturation.forfait_historique` ; le stocker ici '
  'en double serait la définition d''un doublon. Ces deux colonnes sont figées '
  'par `licences_naissance_immuable` : elles sont le premier fait, jamais un '
  'miroir du dernier.';

comment on column facturation.licences.titulaire is
  'La PERSONNE qui administre la licence — et, dans le canal direct, celle '
  'qui paie. On peut lui en affecter PLUSIEURS : `licences_titulaire_idx` '
  'n''est pas unique, et c''est une décision commerciale, pas un oubli. Ce '
  'n''est pas elle qui paie nécessairement tout : voir `facturation.payeurs_v`.';

create or replace function facturation.naissance_immuable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origine is distinct from old.origine
     or new.origine_cabinet is distinct from old.origine_cabinet
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or new.titulaire is distinct from old.titulaire
  then
    raise exception
      'la naissance d''une licence ne se reecrit pas : un changement de forfait s''inscrit dans facturation.forfait_historique'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists licences_naissance_immuable on facturation.licences;
create trigger licences_naissance_immuable
  before update on facturation.licences
  for each row execute function facturation.naissance_immuable();

-- ===========================================================================
-- 8. L'HISTORIQUE DU FORFAIT — LA VÉRITÉ, ET LA SEULE
-- ===========================================================================
--
-- R7 : une correction est une écriture nouvelle. Une ligne par PÉRIODE pendant
-- laquelle la licence a porté une offre. La période ouverte — `effet_au is
-- null` — EST le forfait courant, et il n'est écrit nulle part ailleurs.
--
-- `effet_du` est INCLUSE, `effet_au` est EXCLUE (convention du socle fiscal).
-- Une montée le 15 mars ferme la période précédente À `2026-03-15` et ouvre la
-- nouvelle LE MÊME JOUR : aucun jour n'appartient à deux forfaits, aucun jour
-- ne tombe entre les deux, et le prorata est une soustraction de dates.
--
-- `offre_depuis` est la date qui CHOISIT la ligne de grille, figée au moment
-- du changement : une hausse de tarif en janvier ne réécrit pas une montée de
-- novembre. C'est le même mécanisme que sur l'accès — chacun porte SA date, et
-- c'est la sienne qui le tarife.

create table if not exists facturation.forfait_historique (
  id           uuid primary key default gen_random_uuid(),
  licence_id   uuid not null references facturation.licences(id) on delete restrict,

  offre_code   text not null references ref.offre_codes(code) on delete restrict,
  offre_depuis date not null,
  canal        text not null references ref.canaux(code) on delete restrict,

  effet_du     date not null,
  -- `null` : la période court. C'est la définition du forfait courant.
  effet_au     date,

  motif        text not null references ref.forfait_motifs(code) on delete restrict,

  -- Qui a décidé. Un changement de forfait se relit devant un client.
  decide_par   uuid not null,
  -- Une ligne qui corrige une autre la CITE. R7 jusqu'au bout.
  remplace     uuid references facturation.forfait_historique(id),

  created_at   timestamptz not null default now(),

  -- Bornes demi-ouvertes : l'égalité est admise, et elle désigne une période
  -- VIDE — ouverte puis corrigée le jour même. Elle a existé dans le registre,
  -- sa trace reste, et `daterange(d, d, '[)')` ne chevauche rien.
  constraint forfait_historique_fenetre check (effet_au is null or effet_au >= effet_du)
);

-- Jamais deux forfaits sur un même jour pour une même licence. C'est la base
-- qui l'interdit, pas le code applicatif — même grammaire que
-- `fiscal_param_sans_chevauchement` et `fiches_sans_chevauchement`.
alter table facturation.forfait_historique
  drop constraint if exists forfait_historique_sans_chevauchement;
alter table facturation.forfait_historique
  add constraint forfait_historique_sans_chevauchement
  exclude using gist (
    licence_id with =,
    daterange(effet_du, effet_au, '[)') with &&
  );

-- Une seule période ouverte par licence. La contrainte d'exclusion l'implique
-- déjà — deux intervalles non bornés à droite se chevauchent toujours — mais
-- cet index est aussi celui que `forfait_courant_v` parcourt, et un invariant
-- qui porte un nom se lit dans un message d'erreur.
create unique index if not exists forfait_historique_une_seule_ouverte
  on facturation.forfait_historique (licence_id) where effet_au is null;

create index if not exists forfait_historique_licence_idx
  on facturation.forfait_historique (licence_id, effet_du desc);

comment on table facturation.forfait_historique is
  'Une ligne par période de forfait. La période ouverte EST le forfait '
  'courant : il ne se stocke pas deux fois. Qui payait quoi au 3 mars reste '
  'lisible en décembre, sinon aucune facture n''est explicable.';

comment on column facturation.forfait_historique.effet_au is
  'Borne EXCLUE, `null` tant que la période court. Un forfait de tout mars '
  's''écrit [2026-03-01, 2026-04-01) : le nombre de jours est la différence '
  'des deux bornes, sans « + 1 » dispersé dans les vues.';

-- La seule mise à jour admise sur une période : LA FERMER. Ajouter une date de
-- fin ajoute de l'information ; changer une offre déjà inscrite en retirerait.
create or replace function facturation.periode_se_ferme_seulement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'une periode d''abonnement ne se supprime pas'
      using errcode = 'check_violation';
  end if;
  if old.effet_au is not null then
    raise exception 'cette periode est deja fermee : une correction est une ecriture nouvelle'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create or replace function facturation.forfait_fige()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.licence_id is distinct from old.licence_id
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or new.canal is distinct from old.canal
     or new.effet_du is distinct from old.effet_du
     or new.motif is distinct from old.motif
     or new.decide_par is distinct from old.decide_par
     or new.effet_au is null
  then
    raise exception
      'une periode de forfait ne se reecrit pas : seule sa fermeture s''inscrit'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- SANS TROU. Une contrainte d'exclusion interdit le chevauchement et ignore le
-- vide : rien ne l'empêche d'ouvrir le 1er avril une période dont la
-- précédente s'est arrêtée le 15 mars, et ces seize jours seraient du droit
-- d'usage non facturé que personne ne verrait. D'où ce déclencheur : une
-- période reprend LE JOUR où la précédente s'arrête, pas un autre.
create or replace function facturation.forfait_sans_trou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lignes   bigint;
  v_ouvertes bigint;
  v_fin      date;
begin
  select count(*), count(*) filter (where h.effet_au is null), max(h.effet_au)
    into v_lignes, v_ouvertes, v_fin
    from facturation.forfait_historique h
   where h.licence_id = new.licence_id;

  if v_lignes = 0 then
    return new;                       -- la première période d'une licence
  end if;
  if v_ouvertes > 0 then
    raise exception
      'une periode de forfait court encore sur cette licence : fermez-la avant d''en ouvrir une autre'
      using errcode = 'check_violation';
  end if;
  if new.effet_du <> v_fin then
    raise exception
      'une periode de forfait reprend le jour ou la precedente s''arrete (%), et non le %',
      v_fin, new.effet_du
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists forfait_historique_fermeture on facturation.forfait_historique;
create trigger forfait_historique_fermeture
  before update or delete on facturation.forfait_historique
  for each row execute function facturation.periode_se_ferme_seulement();

drop trigger if exists forfait_historique_fige on facturation.forfait_historique;
create trigger forfait_historique_fige
  before update on facturation.forfait_historique
  for each row execute function facturation.forfait_fige();

drop trigger if exists forfait_historique_sans_trou on facturation.forfait_historique;
create trigger forfait_historique_sans_trou
  before insert on facturation.forfait_historique
  for each row execute function facturation.forfait_sans_trou();

-- Toute licence naît avec sa première période. Sans ce déclencheur, une
-- licence insérée par un chemin qui ignore l'historique serait invisible de
-- `droits_v` — qui lit l'historique désormais, et non plus `licences`.
create or replace function facturation.licence_ouvre_son_historique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into facturation.forfait_historique
    (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
  values
    (new.id, new.offre_code, new.offre_depuis, new.origine, new.offre_depuis,
     case when new.origine = 'cabinet' then 'acces_cabinet' else 'souscription' end,
     coalesce(auth.uid(), new.titulaire));
  return new;
end
$$;

drop trigger if exists licences_ouvre_historique on facturation.licences;
create trigger licences_ouvre_historique
  after insert on facturation.licences
  for each row execute function facturation.licence_ouvre_son_historique();

-- Les licences déjà en base reçoivent leur première période. Rejouable (R11) :
-- `not exists`, parce que la clé n'est pas la date.
insert into facturation.forfait_historique
  (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
select l.id, l.offre_code, l.offre_depuis, l.origine, l.offre_depuis,
       'souscription', l.titulaire
  from facturation.licences l
 where not exists (select 1 from facturation.forfait_historique h
                    where h.licence_id = l.id);

create or replace view facturation.forfait_courant_v with (security_invoker = true) as
select h.* from facturation.forfait_historique h where h.effet_au is null;

comment on view facturation.forfait_courant_v is
  'Le forfait d''aujourd''hui, DÉDUIT de la période ouverte. Aucune colonne '
  'ne le double.';

-- ===========================================================================
-- 9. LE NUMÉRO D'ABONNÉ, ET LA RÉFÉRENCE PARLANTE
-- ===========================================================================
--
-- L'ABONNÉ EST L'ORGANISATION, et c'est le cas du changement de cabinet qui le
-- décide : « un abonné parti d'Audicorp vers MAP Expert garde son numéro ». Ce
-- qui passe d'un cabinet à l'autre est la SOCIÉTÉ CLIENTE — pas la personne
-- (elle peut en diriger trois), pas la licence (un Premium en couvre dix).
--
-- Le numéro naît avec le premier accès de l'organisation et ne change jamais.
-- L'épisode est le rang de l'accès dans la suite de ses accès : 01, 02, 03.
-- `acces_un_seul_vivant` garantit qu'un seul épisode vit à la fois, et
-- `acces_pas_de_suppression` qu'aucun ne disparaît — le rang est donc stable.

create sequence if not exists facturation.numero_abonne_seq;

create table if not exists facturation.abonnes (
  tenant_id  uuid primary key references identity.organizations(id) on delete restrict,
  numero     integer not null unique
             default nextval('facturation.numero_abonne_seq'),
  created_at timestamptz not null default now()
);

comment on table facturation.abonnes is
  'Le numéro d''abonné d''une organisation, attribué au premier accès et '
  'stable à vie. C''est le « 00042 » de `ABO-00042-02-AUD` : il survit au '
  'changement de cabinet, et c''est tout son intérêt.';

-- Le trigramme : trois caractères A-Z0-9, dérivés du nom du cabinet. Les
-- accents et la ponctuation tombent — une référence doit se trier à
-- l'identique sous n'importe quelle collation, et se dicter au téléphone.
--
-- DEUX CABINETS PEUVENT PARTAGER UN TRIGRAMME, et c'est admis : l'identité est
-- portée par le numéro et l'épisode. Le trigramme est une AIDE À LA LECTURE,
-- jamais une clé.
create or replace function facturation.trigramme(p_nom text)
returns text
language sql
immutable
as $$
  select rpad(
           substr(regexp_replace(upper(coalesce(p_nom, '')), '[^A-Z0-9]', '', 'g'), 1, 3),
           3, 'X')
$$;

comment on function facturation.trigramme(text) is
  'Trois caractères A-Z0-9 tirés d''un nom, complétés par des X s''il est trop '
  'court. Une aide à la lecture, pas une clé : deux cabinets peuvent les '
  'partager, l''identité reste le numéro et l''épisode.';

create or replace function facturation.reference_abonne(
  p_tenant uuid, p_episode integer, p_cabinet uuid, p_a date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        ref.reference_abonne;
  v_numero integer;
  v_marque text;
begin
  select * into f from ref.reference_abonne r
   where r.code = 'abonnement' and r.effective_from <= p_a
   order by r.effective_from desc limit 1;
  if f.code is null then
    raise exception
      'aucun format de reference d''abonne en vigueur au % (ref.reference_abonne)', p_a
      using errcode = 'no_data_found';
  end if;

  select a.numero into v_numero
    from facturation.abonnes a where a.tenant_id = p_tenant;
  if v_numero is null then
    raise exception
      'cette organisation n''a pas de numero d''abonne (facturation.abonnes)'
      using errcode = 'no_data_found';
  end if;

  if p_cabinet is null then
    -- La marque d'un abonné sans cabinet. La quatrième place répond toujours à
    -- « qui sert cet abonné » ; en direct, c'est ALGORIA.
    v_marque := f.marque_directe;
  else
    select facturation.trigramme(o.name) into v_marque
      from identity.organizations o where o.id = p_cabinet;
    if v_marque is null then
      raise exception 'cabinet introuvable (%)' , p_cabinet using errcode = 'no_data_found';
    end if;
  end if;

  return f.prefixe || f.separateur || lpad(v_numero::text, f.largeur_numero, '0')
      || f.separateur || lpad(p_episode::text, f.largeur_episode, '0')
      || f.separateur || v_marque;
end
$$;

comment on function facturation.reference_abonne(uuid, integer, uuid, date) is
  'La référence parlante d''un épisode d''abonnement : `ABO-00042-02-AUD`. '
  'Construite une seule fois, à l''ouverture de l''accès, et figée dessus — '
  'un cabinet renommé ne réécrit pas les références déjà émises.';

-- ===========================================================================
-- 10. L'ACCÈS — UN INTERVALLE, UNE ORGANISATION, UN NIVEAU, UN DÉCIDEUR
-- ===========================================================================
--
-- C'est l'objet du domaine, et c'est le seul que la facturation compte. « Moi
-- je facture des activations » : une activation est le jour où un accès
-- devient actif, et la facture compte LES JOURS de cet intervalle.
--
-- Les quatre statuts sont ceux d'`identity.engagements` — `propose`, `actif`,
-- `suspendu`, `termine` — et c'est délibéré : le dépôt a déjà ce vocabulaire
-- pour « le cabinet propose, la cliente accepte, la cliente révoque, effet
-- immédiat ». Un second vocabulaire pour le même geste serait le doublon que
-- le dirigeant interdit.
--
-- `offre_code` + `offre_depuis` disent LE NIVEAU QUE LE DÉCIDEUR A OUVERT, et
-- la date de grille qui le tarife. Dans le canal cabinet, c'est exactement ce
-- que le cabinet paie — 19,000 pour un Solo — et le plafond de sa part : si la
-- cliente monte en Premium et ajoute six sièges, ces deux colonnes ne bougent
-- pas, et le cabinet paie toujours le Solo, au tarif de SA date.
--
-- `licence_id` est nul tant que l'accès est `propose`, et seulement alors : la
-- licence n'existe pas encore. Ce n'est pas « pointer vers rien », c'est NE
-- PAS POINTER, et la contrainte dit à quel moment exactement.

create table if not exists facturation.acces (
  id            uuid primary key default gen_random_uuid(),

  -- L'organisation qui accède. R6 : la politique filtre par elle, l'index
  -- mène par elle.
  tenant_id     uuid not null references identity.organizations(id) on delete restrict,

  licence_id    uuid references facturation.licences(id) on delete restrict,

  canal         text not null references ref.canaux(code) on delete restrict,
  -- Le cabinet qui a décidé, quand c'est un cabinet. C'est lui qui paie la
  -- base, et son retrait déclenche D10.
  cabinet_tenant_id uuid references identity.organizations(id) on delete restrict,

  offre_code    text not null references ref.offre_codes(code) on delete restrict,
  offre_depuis  date not null,

  statut        text not null default 'propose'
                check (statut in ('propose','actif','suspendu','termine')),

  -- Le rang de cet épisode dans la vie de l'abonné, et la référence parlante
  -- qui en découle. Les deux sont posés par la base (`acces_reference`) et
  -- figés ensuite.
  episode       smallint,
  reference     text,

  propose_le    date not null,
  propose_par   uuid not null,
  repondu_le    date,
  repondu_par   uuid,

  -- Le jour de l'ACTIVATION, et le jour où elle finit. Bornes demi-ouvertes,
  -- comme le forfait : `effet_au` est EXCLUE. C'est cet intervalle que la
  -- facture compte, et sa longueur est `effet_au - effet_du`.
  effet_du      date,
  effet_au      date,
  motif_fin     text references ref.fin_motifs(code) on delete restrict,

  created_at    timestamptz not null default now(),

  constraint acces_cabinet_coherent check ((canal = 'cabinet') = (cabinet_tenant_id is not null)),
  constraint acces_pas_son_propre_cabinet check (cabinet_tenant_id is distinct from tenant_id),
  constraint acces_propose_sans_licence check ((statut = 'propose') = (licence_id is null)),
  constraint acces_propose_sans_effet check ((statut = 'propose') = (effet_du is null)),
  constraint acces_reponse_coherente check ((repondu_le is null) = (repondu_par is null)),
  constraint acces_fin_motivee check ((effet_au is null) = (motif_fin is null)),
  constraint acces_termine_ferme check ((statut = 'termine') = (effet_au is not null)),
  constraint acces_episode_positif check (episode is null or episode > 0),
  constraint acces_fenetre check (effet_au is null or effet_du is null or effet_au >= effet_du)
);

-- Les deux colonnes de la référence naissent nullables pour que le rejeu sur
-- une table déjà posée les ajoute sans échouer, puis elles se remplissent et
-- se contraignent.
alter table facturation.acces add column if not exists episode smallint;
alter table facturation.acces add column if not exists reference text;

-- Jamais deux accès sur un même jour pour une même organisation : sans cela,
-- deux cabinets paieraient la base du même dossier le même jour, ou le même
-- dossier serait facturé deux fois pour les mêmes jours.
--
-- La contrainte est PARTIELLE, et elle doit l'être : un accès `propose` n'a pas
-- de `effet_du`, et `daterange(null, null)` n'est pas vide — c'est l'intervalle
-- INFINI, qui chevaucherait tout. Les propositions sont donc hors de la
-- contrainte d'exclusion, et c'est `acces_un_seul_vivant` qui les garde.
alter table facturation.acces drop constraint if exists acces_sans_chevauchement;
alter table facturation.acces add constraint acces_sans_chevauchement
  exclude using gist (
    tenant_id with =,
    daterange(effet_du, effet_au, '[)') with &&
  ) where (effet_du is not null);

-- Un seul accès vivant par organisation, propositions comprises : un deuxième
-- cabinet ne propose pas par-dessus celui qui sert. Changer de cabinet, c'est
-- terminer puis proposer — et c'est précisément l'épisode suivant.
create unique index if not exists acces_un_seul_vivant
  on facturation.acces (tenant_id) where statut <> 'termine';

-- R6 : index menant par `tenant_id`.
create index if not exists acces_tenant_idx
  on facturation.acces (tenant_id, propose_le desc);
create index if not exists acces_licence_idx
  on facturation.acces (licence_id, propose_le desc);
create index if not exists acces_cabinet_idx
  on facturation.acces (cabinet_tenant_id, propose_le desc)
  where cabinet_tenant_id is not null;

-- L'ÉVOLUTION D'UN ABONNÉ SE LIT DANS CET INDEX, SANS JOINTURE.
--
--   select reference from facturation.acces
--    where reference like 'ABO-00042-%'
--    order by reference collate "C";
--
--     ABO-00042-01-AUD
--     ABO-00042-02-MAP
--     ABO-00042-03-ALG
--
-- Le préfixe commun est constant, donc le `like` est un parcours d'intervalle
-- sur l'index ; la largeur est constante, donc l'ordre des octets EST l'ordre
-- des épisodes ; et le trigramme est dans la clé, donc la succession des
-- cabinets se lit sans toucher `identity.organizations`. C'est la raison d'être
-- de la forme : trois faits dans un seul index.
--
-- `text_pattern_ops`, ET C'EST MESURÉ : sous une collation autre que `C` —
-- celle de Supabase comme celle d'un poste Windows — un index B-tree ordinaire
-- NE SERT PAS un `like 'préfixe%'`, et le plan retombe en parcours séquentiel.
-- La classe d'opérateurs compare les octets, ce qui rend le parcours
-- d'intervalle possible, et l'unicité reste exacte : une référence est de
-- l'ASCII pur (préfixe A-Z, chiffres, trigramme A-Z0-9), où l'égalité d'octets
-- et l'égalité de texte sont la même chose. Le `collate "C"` du `order by` est
-- ce qui aligne le tri sur l'ordre de l'index.
create unique index if not exists acces_reference_idx
  on facturation.acces (reference text_pattern_ops) where reference is not null;
create unique index if not exists acces_episode_idx
  on facturation.acces (tenant_id, episode) where episode is not null;

comment on table facturation.acces is
  'Le droit, pour UNE organisation, d''utiliser Malica pendant un intervalle, '
  'à un niveau, décidé par quelqu''un. L''objet du domaine : ce sont ses JOURS '
  'que la facture compte, et son `offre_code` qui plafonne la part du cabinet.';

comment on column facturation.acces.licence_id is
  'Nul tant que l''accès est `propose`, et seulement alors — la licence naît à '
  'l''acceptation. La contrainte `acces_propose_sans_licence` dit quand.';

comment on column facturation.acces.reference is
  'La référence parlante de l''épisode : `ABO-00042-02-AUD`. Numéro d''abonné, '
  'rang de l''épisode, trigramme du cabinet — ou `ALG` pour un abonné sans '
  'cabinet. Figée : elle dit qui servait l''abonné à ce moment-là.';

comment on column facturation.acces.effet_au is
  'Borne EXCLUE, `null` tant que l''accès vit. Un accès de tout mars s''écrit '
  '[2026-03-01, 2026-04-01) et compte 31 jours, par soustraction.';

-- Un accès ne s'ouvre pas au hasard. Le déclencheur nomme LES DEUX colonnes —
-- `tenant_id` et `licence_id` — parce qu'une clé étrangère dit « cette licence
-- existe », jamais « cette licence est celle de cette organisation ».
create or replace function facturation.acces_legitime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_regle  ref.offres_par_canal;
begin
  if new.canal = 'cabinet' then
    select o.kind into v_kind
      from identity.organizations o where o.id = new.cabinet_tenant_id;
    if v_kind is distinct from 'cabinet' then
      raise exception 'seul un cabinet ouvre un acces pour une autre (dossier % de type %)',
        new.cabinet_tenant_id, coalesce(v_kind, 'inconnu')
        using errcode = 'check_violation';
    end if;

    -- Le mandat existe, et il est le même objet que partout ailleurs dans le
    -- dépôt : `identity.engagements`. Un cabinet n'ouvre pas un accès chez une
    -- société dont il n'est pas l'expert.
    if not exists (
      select 1 from identity.engagements e
       where e.cabinet_org_id = new.cabinet_tenant_id
         and e.pme_org_id = new.tenant_id
         and e.status in ('propose','actif')
    ) then
      raise exception
        'ce cabinet n''a aucun mandat sur cette organisation (identity.engagements)'
        using errcode = 'check_violation';
    end if;
  end if;

  v_regle := ref.canal_offre_a(new.canal, new.offre_code, new.propose_le);
  if v_regle.canal is null then
    raise exception 'le canal % ne porte aucune regle pour l''offre % au % (ref.offres_par_canal)',
      new.canal, new.offre_code, new.propose_le
      using errcode = 'no_data_found';
  end if;
  if new.canal = 'cabinet' and not v_regle.cabinet_peut_ouvrir then
    raise exception 'un cabinet n''ouvre pas un acces % (ref.offres_par_canal)', new.offre_code
      using errcode = 'check_violation';
  end if;
  if new.canal = 'direct' and not (v_regle.libre_service or v_regle.commande_speciale) then
    raise exception 'l''offre % n''est pas vendue en direct (ref.offres_par_canal)', new.offre_code
      using errcode = 'check_violation';
  end if;

  if (ref.offre_a(new.offre_code, new.offre_depuis)).code is null then
    raise exception 'aucune ligne de grille pour % au % (ref.offres)',
      new.offre_code, new.offre_depuis
      using errcode = 'no_data_found';
  end if;

  -- Le lien, nommé : l'organisation de l'accès doit être CELLE de la licence.
  if new.licence_id is not null and not exists (
    select 1 from facturation.licence_organisations lo
     where lo.licence_id = new.licence_id and lo.tenant_id = new.tenant_id
  ) then
    raise exception 'cette organisation n''est pas rattachee a cette licence'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists acces_legitime on facturation.acces;
create trigger acces_legitime
  before insert on facturation.acces
  for each row execute function facturation.acces_legitime();

-- Le numéro d'abonné et la référence sont posés PAR LA BASE. Une application
-- qui les calculerait pourrait sauter un épisode, et deux applications en
-- fabriqueraient deux formes. Le déclencheur s'appelle après `acces_legitime`
-- (PostgreSQL les déclenche dans l'ordre de leur nom) : on ne numérote que ce
-- qui a été jugé légitime.
create or replace function facturation.acces_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode integer;
begin
  insert into facturation.abonnes (tenant_id) values (new.tenant_id)
  on conflict (tenant_id) do nothing;

  select count(*) + 1 into v_episode
    from facturation.acces a where a.tenant_id = new.tenant_id;

  new.episode   := v_episode;
  new.reference := facturation.reference_abonne(
                     new.tenant_id, v_episode, new.cabinet_tenant_id, new.propose_le);
  return new;
end
$$;

drop trigger if exists acces_reference on facturation.acces;
create trigger acces_reference
  before insert on facturation.acces
  for each row execute function facturation.acces_reference();

-- Ce qui est figé sur un accès, et ce qui peut bouger. Bougent : le statut (en
-- avant seulement), la réponse, l'ouverture, la fermeture. Le reste jamais —
-- et surtout pas `offre_code` ni `offre_depuis`, qui sont ce que le cabinet a
-- commandé et le tarif auquel il l'a commandé, ni `reference`, qui dit qui
-- servait l'abonné à ce moment-là.
create or replace function facturation.acces_fige()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.canal is distinct from old.canal
     or new.cabinet_tenant_id is distinct from old.cabinet_tenant_id
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or new.propose_le is distinct from old.propose_le
     or new.propose_par is distinct from old.propose_par
     or new.episode is distinct from old.episode
     or new.reference is distinct from old.reference
  then
    raise exception 'ce qu''un acces porte a son ouverture ne se reecrit pas'
      using errcode = 'check_violation';
  end if;

  if old.statut = 'termine' then
    raise exception 'un acces termine ne se rouvre pas : un autre s''ouvre'
      using errcode = 'check_violation';
  end if;
  if old.effet_du is not null and new.effet_du is distinct from old.effet_du then
    raise exception 'le jour d''activation ne se reecrit pas'
      using errcode = 'check_violation';
  end if;
  if old.licence_id is not null and new.licence_id is distinct from old.licence_id then
    raise exception 'un acces ne change pas de licence'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists acces_fige on facturation.acces;
create trigger acces_fige
  before update on facturation.acces
  for each row execute function facturation.acces_fige();

drop trigger if exists acces_pas_de_suppression on facturation.acces;
create trigger acces_pas_de_suppression
  before delete on facturation.acces
  for each row execute function app.deny_mutation();

-- `licence_organisations` reste L'INDEX DU PRÉSENT : son `unique (tenant_id)`
-- garantit qu'une organisation n'est sur qu'une licence, et c'est lui que lit
-- le chemin chaud (`lecture_verdict`, `facturation.lectures`). Il est
-- désormais MAINTENU PAR LA BASE depuis `acces` — jamais par une application.
-- C'est ce qui le distingue d'un doublon : il n'a pas de source propre.
create or replace function facturation.acces_entretient_le_rattachement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'actif' and coalesce(old.statut, '') <> 'actif' then
    insert into facturation.licence_organisations (licence_id, tenant_id)
    values (new.licence_id, new.tenant_id)
    on conflict (tenant_id) do nothing;
  elsif new.statut = 'termine' and coalesce(old.statut, '') <> 'termine' then
    -- L'accès finit, le rattachement tombe : l'organisation redevient libre de
    -- prendre une licence à elle (D10). Son archive ne bouge pas — elle
    -- appartient au dossier, pas à la licence.
    delete from facturation.licence_organisations
     where licence_id = new.licence_id and tenant_id = new.tenant_id;
  end if;
  return new;
end
$$;

drop trigger if exists acces_entretient_rattachement on facturation.acces;
create trigger acces_entretient_rattachement
  after insert or update of statut on facturation.acces
  for each row execute function facturation.acces_entretient_le_rattachement();

-- Le rattachement vérifiait « le titulaire est dirigeant de cette
-- organisation ». Vrai du canal direct, faux du canal cabinet : c'est le
-- cabinet qui ouvre, et la dirigeante qui accepte. La légitimité se lit donc
-- désormais sur l'accès, et le contrôle d'origine reste pour le canal direct.
create or replace function facturation.rattachement_legitime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulaire uuid;
  v_droits    record;
begin
  select titulaire into v_titulaire
    from facturation.licences where id = new.licence_id;

  if not exists (
    select 1 from identity.memberships m
     where m.tenant_id = new.tenant_id
       and m.user_id = v_titulaire
       and m.role = 'dirigeant'
  ) and not exists (
    select 1 from facturation.acces a
     where a.licence_id = new.licence_id
       and a.tenant_id = new.tenant_id
       and a.statut in ('actif','suspendu')
  ) then
    raise exception
      'le titulaire de la licence n''est pas dirigeant de cette organisation, et aucun acces ne l''y rattache'
      using errcode = 'check_violation';
  end if;

  select organisations, organisations_max into v_droits
    from facturation.droits_v where licence_id = new.licence_id;
  if v_droits.organisations >= v_droits.organisations_max then
    raise exception 'cette offre ne porte pas une organisation de plus'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

-- ===========================================================================
-- 11. LES PLACES, ÉCRITES UNE FOIS
-- ===========================================================================
--
-- `droits_v` comptait les organisations et les sièges par deux `left join` et
-- deux `count(distinct)` dans un `group by` de quatorze colonnes. Trois vues
-- de plus allaient recopier ce comptage. Il est écrit une fois.
--
-- LIMITE NOMMÉE : `identity.memberships` ne porte aucune période. Le nombre de
-- sièges et d'organisations est donc celui D'AUJOURD'HUI, y compris quand on
-- regarde un segment de mars. Une facture de mars recalculée en décembre
-- vaudrait le mars d'aujourd'hui — c'est pourquoi `facturation.factures` FIGE
-- ses montants à l'émission, et c'est la facture qui fait foi, jamais le
-- recalcul.

create or replace view facturation.places_v with (security_invoker = true) as
select
  l.id as licence_id,
  (select count(distinct lo.tenant_id)
     from facturation.licence_organisations lo
    where lo.licence_id = l.id)::int as organisations,
  (select count(distinct m.user_id)
     from facturation.licence_organisations lo
     join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = l.id and m.role = 'collaborateur')::int as sieges_occupes
from facturation.licences l;

comment on view facturation.places_v is
  'Ce qu''une licence occupe aujourd''hui : ses organisations, ses sièges de '
  'collaborateurs. Le dirigeant n''occupe pas de place — il détient.';

-- ===========================================================================
-- 12. `droits_v` LIT L'HISTORIQUE, PLUS LA COLONNE
-- ===========================================================================
--
-- Un seul changement de fond : l'offre vient de la période ouverte de
-- l'historique, et non de `licences.offre_code`. Les colonnes d'origine sont
-- conservées à l'identique, dans le même ordre ; sept s'ajoutent à la fin —
-- dont `organisations_max` et `offre_libelle`, que `droits_v` portait déjà et
-- que `mon_forfait()` n'exposait pas, faute de quoi deux écrans ont comblé
-- avec des constantes (`forfait.ts` testait `offre === "premium"` pour ouvrir
-- les sociétés ; `pme.reglages.tsx` recopiait les quatre libellés).
--
-- La chaîne se repose en entier : `create or replace view` refuse de réordonner
-- les colonnes, et `droits_reels_v` s'écrivait `select d.*`. `plateforme.clients_v`
-- s'adosse à `consommation_v` : elle tombe avec la chaîne, et elle est reposée
-- à l'identique plus bas — sans quoi la tour de contrôle perdrait sa liste de
-- clients, et le `grant` qui va avec.

drop view if exists plateforme.clients_v;
drop view if exists facturation.consommation_v;
drop view if exists facturation.droits_reels_v;
drop view if exists facturation.droits_v;

create view facturation.droits_v with (security_invoker = true) as
select
  l.id                                        as licence_id,
  l.titulaire,
  h.offre_code,
  l.statut,
  o.libelle                                   as offre_libelle,
  p.organisations,
  o.organisations_max,
  p.sieges_occupes,
  o.sieges_inclus,
  o.sieges_max,
  (o.lectures_par_organisation * p.organisations
   + o.lectures_par_siege_sup
     * greatest(0, p.sieges_occupes - o.sieges_inclus))::int  as lectures_droit,
  t.prix_total_ht                             as prix_mensuel_ht,
  -- Ce qui s'ajoute le 20 octobre.
  o.rang                                      as offre_rang,
  h.canal,
  h.offre_depuis,
  h.id                                        as forfait_id,
  l.origine,
  l.origine_cabinet,
  o.prix_mensuel_ht                           as prix_offre_ht,
  o.organisations_incluses
from facturation.licences l
join facturation.forfait_courant_v h          on h.licence_id = l.id
cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
join facturation.places_v p                   on p.licence_id = l.id
cross join lateral (
  select (o.prix_mensuel_ht
          + o.prix_siege_sup * greatest(0, p.sieges_occupes - o.sieges_inclus)
          + o.prix_organisation_sup
            * greatest(0, p.organisations - o.organisations_incluses))::app.money_t
         as prix_total_ht) t;

comment on view facturation.droits_v is
  'Ce à quoi une licence donne droit AUJOURD''HUI, déduit et jamais stocké. '
  'L''offre vient de la période ouverte de `forfait_historique` : la colonne '
  '`licences.offre_code` est la souscription d''origine, pas le courant.';

create view facturation.droits_reels_v with (security_invoker = true) as
select
  d.licence_id, d.titulaire, d.offre_code, d.statut, d.offre_libelle,
  d.organisations, d.organisations_max, d.sieges_occupes, d.sieges_inclus,
  d.sieges_max, d.lectures_droit, d.prix_mensuel_ht,
  d.offre_rang, d.canal, d.offre_depuis, d.forfait_id, d.origine,
  d.origine_cabinet, d.prix_offre_ht, d.organisations_incluses,
  coalesce(s.supplement, 0)::int                      as lectures_supplement,
  (d.lectures_droit + coalesce(s.supplement, 0))::int  as lectures_droit_total
from facturation.droits_v d
left join lateral (
  select sum(i.valeur)::int as supplement
  from plateforme.interventions i
  where i.licence_id = d.licence_id
    and i.acte = 'supplement_lectures'
    and coalesce(i.effet_du, '-infinity'::date) <= current_date
    and coalesce(i.effet_au, 'infinity'::date)  >= current_date
) s on true;

comment on view facturation.droits_reels_v is
  'Le droit de la grille, plus les suppléments en vigueur. C''est ce que la '
  'porte `lecture_autorisee` doit lire. Les colonnes sont NOMMÉES et non '
  '`d.*` : une colonne ajoutée à `droits_v` ne réordonne plus celle-ci.';

create view facturation.consommation_v with (security_invoker = true) as
select
  d.licence_id, d.offre_code, d.statut,
  d.lectures_droit_total                                 as lectures_droit,
  d.lectures_droit                                       as lectures_forfait,
  d.lectures_supplement,
  coalesce(c.consommees, 0)::int                         as lectures_consommees,
  greatest(0, d.lectures_droit_total - coalesce(c.consommees, 0))::int
                                                         as lectures_restantes,
  d.organisations, d.sieges_occupes, d.sieges_inclus, d.sieges_max,
  d.prix_mensuel_ht,
  -- Les deux champs que `mon_forfait()` n'exposait pas.
  d.organisations_max, d.offre_libelle,
  d.offre_rang, d.canal, d.origine, d.titulaire
from facturation.droits_reels_v d
left join lateral (
  select count(*) as consommees
  from facturation.lectures l
  where l.licence_id = d.licence_id
    and l.periode = date_trunc('month', current_date)::date
) c on true;

comment on view facturation.consommation_v is
  'Le droit, le consommé et le reste, pour le mois en cours. C''est la ligne '
  '« Lectures restantes 9 » de l''écran d''accueil.';

-- Reposée telle que `20261019100000` l'avait écrite, `security_invoker` comme
-- `20261019150000` l'a corrigée ensuite. Rien n'y change : elle tombait par
-- dépendance, elle revient à l'identique.
create view plateforme.clients_v with (security_invoker = true) as
select
  l.id                             as licence_id,
  l.titulaire,
  p.display_name                   as titulaire_nom,
  c.offre_code, c.statut,
  c.organisations, c.sieges_occupes, c.sieges_max,
  c.lectures_droit, c.lectures_consommees, c.lectures_restantes,
  c.prix_mensuel_ht,
  -- Le signal qui compte : depuis quand plus rien n'arrive. Un client qui ne
  -- dépose plus est un client qui part, et il part en silence.
  (select max(pi.created_at) from capture.pieces pi
    join facturation.licence_organisations lo on lo.tenant_id = pi.tenant_id
   where lo.licence_id = l.id)     as derniere_piece_le,
  (select count(*) from facturation.licence_organisations lo
    where lo.licence_id = l.id)    as organisations_rattachees,
  l.created_at                     as cliente_depuis
from facturation.licences l
join facturation.consommation_v c on c.licence_id = l.id
left join identity.profiles p on p.user_id = l.titulaire;

comment on view plateforme.clients_v is
  'Un client, une ligne. Des compteurs uniquement — aucun contenu n''y entre.';

-- ===========================================================================
-- 13. LA SEGMENTATION — LE CALCUL, ET IL EST ENTIER EN SQL
-- ===========================================================================
--
-- Le temps d'une licence se découpe à ses ruptures : chaque borne de forfait et
-- chaque borne d'accès. Les bornes étant demi-ouvertes, LA BORNE EST LA
-- RUPTURE — plus de `+ 1` à écrire, et plus d'occasion de l'oublier dans l'une
-- des six vues. Entre deux ruptures, rien ne change — ni l'offre, ni le niveau
-- ouvert par le cabinet — et le prorata devient une multiplication par un
-- nombre de jours.
--
-- C'est ici que les trois nombres du cas d'épreuve se produisent, et aucun
-- n'est écrit :
--
--   prix_total_ht   = la grille de l'offre COURANTE, plus les suppléments
--                     (`premium` 49,000)
--   part_cabinet_ht = la grille du niveau que le cabinet a OUVERT, à SA date,
--                     plafonnée par le total (`solo` 19,000)
--   part_pme_ht     = la différence (30,000)
--
-- Les suppléments de sièges et de sociétés entrent dans `prix_total_ht` et
-- donc, intégralement, dans `part_pme_ht` : la part du cabinet est plafonnée
-- par ce qu'il a ouvert, jamais par ce que sa cliente consomme.
--
-- AUCUN TTC ICI, et c'est volontaire : deux payeurs font deux factures, donc
-- DEUX droits de timbre. 19 × 1,19 + 1 = 23,610 et 30 × 1,19 + 1 = 36,700,
-- soit 60,310 contre 59,310 pour un payeur unique. Le partage coûte exactement
-- 1 DT de plus, le timbre étant dû PAR FACTURE et non récupérable. La somme
-- des parts TTC n'est donc pas le TTC du forfait, et cette vue ne doit jamais
-- laisser croire le contraire : elle s'arrête au HT, et `facturation.emettre`
-- lit le taux et le timbre du pack fiscal, une fois par facture émise (R4).
--
-- LIMITE NOMMÉE : `facturation.acces.statut` n'est pas historisé. Les jours se
-- comptent donc sur la FENÊTRE de l'accès (`effet_du` → `effet_au`), et une
-- suspension pour impayé n'interrompt pas le compteur tant qu'elle ne ferme
-- pas l'accès. Pour qu'elle l'interrompe il faudrait une table de périodes de
-- suspension ; elle n'est pas écrite, et ce trou est nommé plutôt que comblé.

create or replace view facturation.periodes_v with (security_invoker = true) as
with bornes as (
  select h.licence_id, h.effet_du as jour
    from facturation.forfait_historique h
  union
  select h.licence_id, h.effet_au
    from facturation.forfait_historique h where h.effet_au is not null
  union
  select a.licence_id, a.effet_du
    from facturation.acces a where a.licence_id is not null and a.effet_du is not null
  union
  select a.licence_id, a.effet_au
    from facturation.acces a where a.licence_id is not null and a.effet_au is not null
),
segments as (
  select b.licence_id, b.jour as du,
         lead(b.jour) over (partition by b.licence_id order by b.jour) as au_exclu
    from bornes b
)
select
  s.licence_id,
  s.du,
  s.au_exclu,
  -- Le dernier jour INCLUS, pour les écrans et les relevés : un client lit
  -- « jusqu'au 31 mars », pas « jusqu'au 1er avril exclu ». Dérivé, jamais
  -- stocké, et la base ne contraint que `au_exclu`.
  (s.au_exclu - 1)          as au,
  l.titulaire,
  l.origine,
  l.origine_cabinet,
  h.id                      as forfait_id,
  h.offre_code,
  h.offre_depuis,
  h.canal,
  h.motif                   as forfait_motif,
  o.libelle                 as offre_libelle,
  o.rang                    as offre_rang,
  p.organisations,
  p.sieges_occupes,
  o.prix_mensuel_ht         as prix_offre_ht,
  t.prix_total_ht,
  ca.acces_id,
  ca.acces_reference,
  -- La référence de l'accès vivant, cabinet OU direct : c'est elle qui nomme
  -- l'épisode sur une facture de titulaire, y compris quand aucun cabinet
  -- n'est dans la boucle.
  ca.reference_vivante,
  ca.cabinet_tenant_id,
  ca.acces_offre_code,
  ca.plancher_rang,
  ca.plancher_offre_code,
  least(coalesce(ca.base_cabinet, 0), t.prix_total_ht)::app.money_t   as part_cabinet_ht,
  (t.prix_total_ht - least(coalesce(ca.base_cabinet, 0), t.prix_total_ht))::app.money_t
                            as part_pme_ht,
  -- Un accès proposé et jamais accepté ne produit aucun segment (son
  -- `effet_du` est nul) ; une licence sans accès vivant et sans titulaire ne se
  -- facture pas. C'est la réponse au cas « le cabinet propose, la cliente
  -- n'accepte jamais » : l'origine existe, le payeur non.
  (coalesce(ca.vivants, 0) > 0 or l.titulaire is not null) as facturable
from segments s
join facturation.licences l                   on l.id = s.licence_id
join facturation.forfait_historique h
     on h.licence_id = s.licence_id
    and h.effet_du <= s.du
    and (h.effet_au is null or h.effet_au > s.du)
cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
join facturation.places_v p                   on p.licence_id = s.licence_id
cross join lateral (
  select (o.prix_mensuel_ht
          + o.prix_siege_sup * greatest(0, p.sieges_occupes - o.sieges_inclus)
          + o.prix_organisation_sup
            * greatest(0, p.organisations - o.organisations_incluses))::app.money_t
         as prix_total_ht) t
left join lateral (
  select
    count(*)                                                      as vivants,
    sum(oa.prix_mensuel_ht) filter (where a.canal = 'cabinet')     as base_cabinet,
    max(oa.rang)            filter (where a.canal = 'cabinet')     as plancher_rang,
    (array_agg(a.offre_code        order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as plancher_offre_code,
    (array_agg(a.offre_code        order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as acces_offre_code,
    (array_agg(a.cabinet_tenant_id order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as cabinet_tenant_id,
    (array_agg(a.id                order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as acces_id,
    (array_agg(a.reference         order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as acces_reference,
    (array_agg(a.reference         order by oa.rang desc))[1]      as reference_vivante
  from facturation.acces a
  cross join lateral ref.offre_a(a.offre_code, a.offre_depuis) oa
  where a.licence_id = s.licence_id
    and a.effet_du is not null
    and a.effet_du <= s.du
    and (a.effet_au is null or a.effet_au > s.du)
) ca on true
where s.au_exclu is null or s.au_exclu > s.du;

comment on view facturation.periodes_v is
  'Le temps d''une licence découpé à ses ruptures, et ce que chacun doit sur '
  'chaque segment. Tout le calcul de l''abonnement est ici : Malica appelle, '
  'elle ne calcule pas (R3). `au_exclu` est la borne que la base contraint, '
  '`au` le dernier jour inclus, pour les écrans. HT seulement — le timbre est '
  'par facture.';

-- ===========================================================================
-- 14. L'HISTORIQUE DES PAYEURS — DÉDUIT, JAMAIS STOCKÉ
-- ===========================================================================
--
-- Deux payeurs possibles, et ils ne sont pas de la même nature : un CABINET
-- est une organisation, un TITULAIRE est une personne. D'où deux colonnes
-- d'identité et non une, avec le rôle en clair — ce n'est pas un doublon,
-- c'est l'union étiquetée de deux clés étrangères distinctes, et les deux
-- rôles sont ceux de `ref.payeur_types`.
--
-- Le payeur initial est la PREMIÈRE ligne de cette vue. Il n'a pas de colonne,
-- et c'est le point : une colonne `payeur_initial` divergerait un jour de
-- l'historique, et plus personne ne saurait laquelle fait foi.

create or replace view facturation.payeurs_v with (security_invoker = true) as
select
  pv.licence_id, pv.du, pv.au_exclu, pv.au,
  'cabinet'::text              as payeur_type,
  pv.cabinet_tenant_id         as payeur_tenant_id,
  null::uuid                   as payeur_personne,
  pv.acces_id,
  pv.acces_reference,
  pv.acces_offre_code          as part_offre_code,
  pv.part_cabinet_ht           as part_ht
from facturation.periodes_v pv
where pv.facturable and pv.part_cabinet_ht > 0 and pv.cabinet_tenant_id is not null
union all
select
  pv.licence_id, pv.du, pv.au_exclu, pv.au,
  'titulaire',
  null::uuid,
  pv.titulaire,
  null::uuid,
  pv.reference_vivante,
  pv.offre_code,
  pv.part_pme_ht
from facturation.periodes_v pv
where pv.facturable and pv.part_pme_ht > 0 and pv.titulaire is not null;

comment on view facturation.payeurs_v is
  'Qui devait quoi, sur quel intervalle. L''historique des payeurs, déduit de '
  '`periodes_v`. Sa première ligne EST le payeur initial.';

create or replace view facturation.payeur_initial_v with (security_invoker = true) as
select distinct on (p.licence_id)
  p.licence_id, p.payeur_type, p.payeur_tenant_id, p.payeur_personne,
  p.du as depuis, p.part_ht as part_initiale_ht
from facturation.payeurs_v p
order by p.licence_id, p.du, (p.payeur_type = 'cabinet') desc;

comment on view facturation.payeur_initial_v is
  'Le premier payeur. Quand cabinet et titulaire commencent le MÊME jour — '
  'un accès de cabinet et une montée immédiate — c''est le cabinet : c''est '
  'son geste qui a ouvert l''accès. Le départage est écrit, pas implicite.';

create or replace view facturation.payeur_courant_v with (security_invoker = true) as
select p.*
from facturation.payeurs_v p
where p.du <= current_date and (p.au_exclu is null or p.au_exclu > current_date);

comment on view facturation.payeur_courant_v is
  'Qui paie aujourd''hui. PLUSIEURS LIGNES par licence quand il y a deux '
  'payeurs : c''est la règle D9, et une colonne ne saurait pas la dire.';

-- La réponse aux quatre questions de la facturation, en une ligne par licence.
create or replace view facturation.repartition_v with (security_invoker = true) as
select
  pv.licence_id,
  pv.du                        as segment_du,
  pv.au_exclu                  as segment_au_exclu,
  pv.au                        as segment_au,
  pv.origine,
  pv.origine_cabinet,
  pv.canal,
  pv.offre_code,
  pv.offre_libelle,
  pv.offre_rang,
  pv.prix_total_ht,
  pv.part_cabinet_ht,
  pv.part_pme_ht,
  pv.cabinet_tenant_id,
  pv.acces_id,
  pv.acces_reference,
  pv.acces_offre_code,
  pv.plancher_offre_code,
  pv.plancher_rang,
  pv.facturable,
  pv.titulaire,
  pi.payeur_type               as payeur_initial_type,
  pi.payeur_tenant_id          as payeur_initial_tenant_id,
  pi.payeur_personne           as payeur_initial_personne,
  pi.depuis                    as payeur_initial_depuis
from facturation.periodes_v pv
left join facturation.payeur_initial_v pi on pi.licence_id = pv.licence_id
where pv.du <= current_date and (pv.au_exclu is null or pv.au_exclu > current_date);

comment on view facturation.repartition_v is
  'Pour une licence, aujourd''hui : qui était le payeur initial, qui paie, '
  'quelle part revient au cabinet, quelle part à la cliente, et quel est le '
  'plancher de dégradation. Les quatre réponses sortent de la base.';

-- ===========================================================================
-- 15. LE PRORATA — PAR PÉRIODE, ET PAR PAYEUR
-- ===========================================================================
--
-- « Sur les licences actives, à terme échu, au prorata du nombre de jours. »
-- Une montée au milieu du mois ne produit donc pas 30,000 le premier mois,
-- mais la fraction des jours restants — et c'est cette fonction qui le dit.
--
-- Le mois est lui aussi DEMI-OUVERT : [le 1er, le 1er du mois suivant). Son
-- nombre de jours est la différence des deux bornes, et il n'y a plus de
-- `extract(day from fin_de_mois)` à relire deux fois pour s'en convaincre.
--
-- L'arrondi est au MILLIME (trois décimales) : c'est la plus petite unité du
-- dinar, et `app.money_t` est un `numeric(38,3)`.
--
-- `security definer` et une garde explicite : les vues qu'elle lit sont
-- `security_invoker`, et sous l'identité d'un cabinet elles ne rendraient rien
-- de `facturation.licences`. La fonction lit donc les vraies valeurs, et dit
-- en toutes lettres qui a le droit de l'appeler.

create or replace function facturation.a_facturer(p_licence uuid, p_periode date)
returns table (
  payeur_type       text,
  payeur_tenant_id  uuid,
  payeur_personne   uuid,
  offre_code        text,
  acces_reference   text,
  jours             integer,
  jours_du_mois     integer,
  montant_ht        app.money_t)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_platform()
          or exists (select 1 from facturation.licences l
                      where l.id = p_licence and l.titulaire = auth.uid())
          or exists (select 1 from facturation.acces a
                      where a.licence_id = p_licence
                        and a.cabinet_tenant_id in (select app.member_orgs()))) then
    raise exception
      'reserve a la plateforme, au titulaire de la licence, et au cabinet qui la dote'
      using errcode = '42501';
  end if;

  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  lignes as (
    select pv.payeur_type                        as payeur_type,
           pv.payeur_tenant_id                   as payeur_tenant_id,
           pv.payeur_personne                    as payeur_personne,
           pv.part_offre_code                    as part_offre_code,
           pv.acces_reference                    as acces_reference,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           greatest(pv.du, m.du)                 as seg_du,
           least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu) as seg_au_exclu
      from facturation.payeurs_v pv
      cross join mois m
     where pv.licence_id = p_licence
       and pv.du < m.au_exclu
       and (pv.au_exclu is null or pv.au_exclu > m.du)
  )
  select
    l.payeur_type,
    l.payeur_tenant_id,
    l.payeur_personne,
    (array_agg(l.part_offre_code order by l.seg_du desc))[1],
    (array_agg(l.acces_reference order by l.seg_du desc))[1],
    sum(l.seg_au_exclu - l.seg_du)::int,
    max(l.jours_du_mois)::int,
    round(sum(l.part_ht * (l.seg_au_exclu - l.seg_du) / l.jours_du_mois), 3)::app.money_t
  from lignes l
  group by l.payeur_type, l.payeur_tenant_id, l.payeur_personne;
end
$$;

comment on function facturation.a_facturer(uuid, date) is
  'Ce qu''il y a à facturer pour une licence et un mois, UNE LIGNE PAR PAYEUR, '
  'au prorata des jours. Les deux parts sortent séparément et nommément : '
  'elles ne partent pas par le même chemin — le cabinet est facturé à terme '
  'échu, la cliente passe par une page de paiement.';

-- Le compteur de jours-licence d'un cabinet : « lui seul produit la facture au
-- prorata » (étape 3B). Une ligne par licence qu'il a dotée, et c'est cette
-- liste qui devient les lignes de SA facture unique.
create or replace function facturation.a_facturer_cabinet(p_cabinet uuid, p_periode date)
returns table (
  licence_id    uuid,
  tenant_id     uuid,
  organisation  text,
  reference     text,
  offre_code    text,
  jours         integer,
  jours_du_mois integer,
  montant_ht    app.money_t)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'reserve a la plateforme et au cabinet lui-meme'
      using errcode = '42501';
  end if;

  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  lignes as (
    select pv.licence_id                         as licence_id,
           a.tenant_id                           as tenant_id,
           pv.acces_reference                    as reference,
           pv.part_offre_code                    as part_offre_code,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           greatest(pv.du, m.du)                 as seg_du,
           least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu) as seg_au_exclu
      from facturation.payeurs_v pv
      join facturation.acces a on a.id = pv.acces_id
      cross join mois m
     where pv.payeur_type = 'cabinet'
       and pv.payeur_tenant_id = p_cabinet
       and pv.du < m.au_exclu
       and (pv.au_exclu is null or pv.au_exclu > m.du)
  )
  select
    l.licence_id,
    l.tenant_id,
    o.name,
    (array_agg(l.reference order by l.seg_du desc))[1],
    (array_agg(l.part_offre_code order by l.seg_du desc))[1],
    sum(l.seg_au_exclu - l.seg_du)::int,
    max(l.jours_du_mois)::int,
    round(sum(l.part_ht * (l.seg_au_exclu - l.seg_du) / l.jours_du_mois), 3)::app.money_t
  from lignes l
  join identity.organizations o on o.id = l.tenant_id
  group by l.licence_id, l.tenant_id, o.name;
end
$$;

comment on function facturation.a_facturer_cabinet(uuid, date) is
  'Les jours-licence d''un cabinet sur un mois, une ligne par licence dotée. '
  'C''est le compteur que l''étape 3B nomme : « lui seul produit la facture au '
  'prorata ». Une seule facture pour le cabinet, autant de lignes que de '
  'clientes activées, chacune nommée par sa référence parlante.';

-- ===========================================================================
-- 16. `facturation.factures` APPREND QUI PAIE ET À QUI ELLE PART
-- ===========================================================================
--
-- Le défaut, mesuré sur la table du 19 octobre :
--
--   `unique (licence_id, periode, avoir_de)` — une seule facture par licence
--   et par période, et AUCUNE colonne de destinataire. Deux payeurs étaient
--   donc inexprimables, alors que c'est le cas métier réel.
--
--   Pire : cette clé était INERTE pour les factures ordinaires. `avoir_de` y
--   est nul, et dans un `unique` deux nuls sont distincts — deux factures de
--   la même licence sur le même mois passaient déjà sans rien heurter. La
--   contrainte n'interdisait en pratique que les doublons d'avoir.
--
-- Le payeur et son RÔLE entrent dans la clé, et le destinataire devient
-- explicite. La clé est un index UNIQUE et non une contrainte de table, parce
-- qu'elle porte deux `coalesce` : sans eux les nuls rendraient la clé inerte
-- une seconde fois, exactement comme avant.

alter table facturation.factures
  add column if not exists payeur_type text,
  add column if not exists payeur_tenant_id uuid
      references identity.organizations(id) on delete restrict,
  add column if not exists payeur_personne uuid,
  -- Le destinataire, FIGÉ comme les montants. Un cabinet renommé en mars ne
  -- réécrit pas la facture de février ; c'est la même raison qui fait stocker
  -- le taux de TVA plutôt que de le relire (R7 appliqué à nos propres ventes).
  add column if not exists destinataire_nom text,
  add column if not exists destinataire_legal_id text,
  -- La référence parlante de l'épisode facturé : `ABO-00042-02-AUD`. Elle dit
  -- sur le papier quel cabinet dotait l'abonné ce mois-là.
  add column if not exists reference_abonne text;

-- Les factures déjà émises, s'il en existe, sont celles du canal direct :
-- avant ce fichier, aucun chemin n'en produisait d'autres. Elles reçoivent le
-- titulaire de leur licence comme payeur, et son nom comme destinataire.
update facturation.factures f
   set payeur_type     = 'titulaire',
       payeur_personne = l.titulaire
  from facturation.licences l
 where l.id = f.licence_id and f.payeur_type is null;

update facturation.factures f
   set destinataire_nom = p.display_name
  from identity.profiles p
 where p.user_id = f.payeur_personne
   and f.destinataire_nom is null
   and p.display_name is not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'facturation.factures'::regclass
                    and conname = 'factures_payeur_type_fkey') then
    alter table facturation.factures add constraint factures_payeur_type_fkey
      foreign key (payeur_type) references ref.payeur_types(code) on delete restrict;
  end if;
  -- Le rôle dit LAQUELLE des deux colonnes d'identité est remplie, et l'autre
  -- doit être vide : sans cette contrainte, une facture pourrait nommer un
  -- cabinet ET une personne, et personne ne saurait qui doit payer.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'facturation.factures'::regclass
                    and conname = 'factures_payeur_identifie') then
    alter table facturation.factures add constraint factures_payeur_identifie
      check ((payeur_type = 'cabinet'
              and payeur_tenant_id is not null and payeur_personne is null)
             or (payeur_type = 'titulaire'
                 and payeur_personne is not null and payeur_tenant_id is null));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'facturation.factures'::regclass
                    and conname = 'factures_destinataire_nomme') then
    alter table facturation.factures add constraint factures_destinataire_nomme
      check (length(btrim(destinataire_nom)) > 0);
  end if;
end
$$;

-- Reste-t-il des factures sans destinataire ? Leur payeur existe, son nom
-- manque — `identity.profiles.display_name` est nullable. Ce sont des lignes
-- d'essai : aucune facture réelle n'a pu être émise avant ce fichier, puisque
-- `facturation.emettre` refuse d'émettre sans émetteur désigné et qu'aucun ne
-- l'est. On leur donne un nom TRAÇABLE, tiré de l'identifiant du payeur,
-- plutôt que de relâcher l'invariant : un rattrapage qui se voit vaut mieux
-- qu'une colonne nullable que personne ne remplira jamais.
update facturation.factures
   set destinataire_nom = 'Titulaire ' || left(payeur_personne::text, 8)
 where destinataire_nom is null and payeur_personne is not null;
update facturation.factures
   set destinataire_nom = 'Cabinet ' || left(payeur_tenant_id::text, 8)
 where destinataire_nom is null and payeur_tenant_id is not null;

-- LE PAYEUR N'EST JAMAIS NUL, ET LA BASE SAIT POURQUOI.
--
-- 18 octobre 2026, mesuré : `une-vue-ne-contourne-pas-l-isolation.test.ts`
-- tombait sur `23502 payeur_type`. Son montage insère une facture en retard
-- pour prouver R6 sur `encours_v`, `a_relancer_v` et `flux_mensuel_v` — il
-- nomme les montants, pas le payeur, parce qu'avant ce fichier la colonne
-- n'existait pas. La règle que cette épreuve porte est l'ISOLATION ; rendre
-- son montage impossible, c'est perdre la preuve sans gagner l'invariant.
--
-- L'invariant ne se relâche donc pas : il devient DÉDUCTIBLE. Le canal direct
-- est celui où le titulaire paie pour lui — c'est exactement ce que fait le
-- rattrapage ci-dessus sur les factures déjà émises, et ce que la base peut
-- refaire seule pour toute écriture qui ne nomme pas son payeur. Le rôle
-- devient `titulaire`, l'identité est le titulaire de la licence, et le nom du
-- destinataire se LIT : le profil d'abord, à défaut le nom de l'organisation
-- que la licence sert. Si personne n'est nommé nulle part, on refuse — aucun
-- libellé plausible n'est fabriqué ici (R4), et c'est la même réponse que
-- `facturation.emettre` donne au même manque.
--
-- Ce n'est pas un `default` : un défaut est une constante posée à l'avance,
-- celui-ci est un calcul fait dans la base sur les données de la ligne (R3).
-- Et il rend la nouvelle clé unique effective pour TOUT écrivain, pas
-- seulement pour `facturation.emettre` : une identité de payeur nulle rendrait
-- la clé inerte, ce que la section 16 passe son temps à refuser.
create or replace function facturation.facture_nomme_son_payeur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulaire uuid;
  v_nom       text;
begin
  -- `facturation.emettre` nomme toujours le payeur : une ligne déjà nommée
  -- sort d'ici intacte, et c'est ce qui garde les deux factures du partage.
  if new.payeur_type is not null then
    return new;
  end if;

  select l.titulaire into v_titulaire
    from facturation.licences l
   where l.id = new.licence_id;
  if v_titulaire is null then
    raise exception
      'licence % introuvable : le payeur d''une facture ne se devine pas',
      new.licence_id
      using errcode = 'no_data_found';
  end if;

  new.payeur_type      := 'titulaire';
  new.payeur_personne  := v_titulaire;
  new.payeur_tenant_id := null;

  if new.destinataire_nom is null then
    select p.display_name into v_nom
      from identity.profiles p
     where p.user_id = v_titulaire
       and length(btrim(coalesce(p.display_name, ''))) > 0;
  end if;

  -- Et PAS de second recours sur le nom de l'organisation servie. Il avait ete
  -- ecrit, il est retire : le payeur deduit ici est une PERSONNE, et une
  -- facture adressee a une personne qui porterait le nom d'une societe est une
  -- mention legale fausse. R4 : on refuse la valeur plausible. Le payeur, lui,
  -- se deduit sans rien inventer — sur le canal direct il EST le titulaire,
  -- c'est un fait du modele.
  new.destinataire_nom := coalesce(new.destinataire_nom, v_nom);
  if new.destinataire_nom is null then
    raise exception
      'le titulaire % n''a pas de nom (identity.profiles.display_name) : une facture sans destinataire n''est pas une facture',
      v_titulaire
      using errcode = 'no_data_found';
  end if;
  return new;
end
$$;

drop trigger if exists factures_nomme_son_payeur on facturation.factures;
create trigger factures_nomme_son_payeur
  before insert on facturation.factures
  for each row execute function facturation.facture_nomme_son_payeur();

comment on function facturation.facture_nomme_son_payeur() is
  'Complete le payeur d''une facture qui ne le nomme pas : canal direct, donc '
  'le titulaire de la licence, et son nom lu sur le profil ou sur '
  'l''organisation servie. Refuse si personne n''est nomme — jamais de '
  'libelle fabrique. Sans effet sur `facturation.emettre`, qui nomme toujours.';

-- `payeur_type` et `destinataire_nom` ne deviennent `not null` qu'ici, après
-- le rattrapage : une colonne ajoutée `not null` sans défaut échouerait sur la
-- première ligne existante, et un défaut serait la valeur invisible que R4
-- interdit.
alter table facturation.factures alter column payeur_type set not null;
alter table facturation.factures alter column destinataire_nom set not null;

-- L'ancienne clé tombe, et elle tombe PAR SA FORME et non par son nom : le
-- nom est fabriqué par PostgreSQL, et une base restaurée depuis un dump peut
-- en porter un autre.
do $$
declare
  v_conname text;
begin
  for v_conname in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'facturation.factures'::regclass
       and c.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(c.conkey) k
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           = array['avoir_de','licence_id','periode']
  loop
    execute format('alter table facturation.factures drop constraint %I', v_conname);
  end loop;
end
$$;

-- LA NOUVELLE CLÉ. Une facture par licence, par période, PAR PAYEUR et par
-- rôle — et un seul avoir par facture citée et par payeur. Les deux `coalesce`
-- sont ce qui la rend effective : une identité de payeur est toujours
-- renseignée (la contrainte `factures_payeur_identifie` l'exige), et un
-- `avoir_de` nul devient une valeur comparable au lieu d'un laissez-passer.
create unique index if not exists factures_une_par_payeur_et_periode
  on facturation.factures (
    licence_id,
    periode,
    payeur_type,
    coalesce(payeur_tenant_id, payeur_personne),
    coalesce(avoir_de, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- R6 : un cabinet lit ses factures par un index qui mène par lui.
create index if not exists factures_payeur_cabinet_idx
  on facturation.factures (payeur_tenant_id, periode desc)
  where payeur_tenant_id is not null;
create index if not exists factures_payeur_personne_idx
  on facturation.factures (payeur_personne, periode desc)
  where payeur_personne is not null;

comment on column facturation.factures.payeur_type is
  'Le RÔLE du payeur (`ref.payeur_types`), et il entre dans la clé : une '
  'place peut donner une ou deux factures selon qui a doté quoi.';
comment on column facturation.factures.destinataire_nom is
  'À qui la facture part, FIGÉ à l''émission. Une facture de février doit '
  'dire en décembre à qui elle était adressée, même si le cabinet a changé '
  'de nom depuis.';

-- Le cabinet qui paie doit lire SES factures. La politique du 19 octobre ne
-- connaissait que le titulaire : sans cette ligne, un cabinet facturé ne
-- verrait rien de ce qu'on lui réclame.
alter policy facturation_factures_sel on facturation.factures
  using ((select app.is_platform())
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid())
         or payeur_personne = auth.uid()
         or payeur_tenant_id in (select app.member_orgs()));

alter policy facturation_facture_lignes_sel on facturation.facture_lignes
  using (exists (select 1 from facturation.factures f
                  where f.id = facture_lignes.facture_id
                    and ((select app.is_platform())
                         or f.licence_id in (select id from facturation.licences
                                              where titulaire = auth.uid())
                         or f.payeur_personne = auth.uid()
                         or f.payeur_tenant_id in (select app.member_orgs()))));

alter policy facturation_encaissements_sel on facturation.encaissements
  using (exists (select 1 from facturation.factures f
                  where f.id = encaissements.facture_id
                    and ((select app.is_platform())
                         or f.licence_id in (select id from facturation.licences
                                              where titulaire = auth.uid())
                         or f.payeur_personne = auth.uid()
                         or f.payeur_tenant_id in (select app.member_orgs()))));

-- ===========================================================================
-- 17. ÉMETTRE — UNE FACTURE PAR PAYEUR, ET PAS UNE DE PLUS
-- ===========================================================================
--
-- Le corps est celui du 19 octobre (émetteur, pack, taux, timbre, devise : rien
-- n'y change, et la garde « aucun emetteur designe » reste la première). Ce qui
-- change est la BOUCLE : `facturation.a_facturer` rend une ligne par payeur, et
-- chaque ligne devient une facture.
--
-- Le timbre et la TVA sont appliqués PAR FACTURE, et c'est le coût du partage :
-- deux factures, deux timbres. Ce n'est pas un arrondi, c'est la loi.
--
-- `facture_id`, `numero` et `ttc` restent dans la réponse, pour le seul appelant
-- qui existe (`emettre-une-facture.test.ts` et le dépôt `facturation.ts`) : ils
-- désignent LA PREMIÈRE facture émise. `factures` est la réponse complète, et
-- c'est elle que tout nouvel appelant doit lire.

create or replace function facturation.emettre(
  p_licence uuid, p_periode date, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          record;
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_sieges   smallint;
  l          record;
  v_tva      app.money_t;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  v_faites   jsonb := '[]'::jsonb;
  v_premiere uuid;
  v_premier  text;
  v_ttc      app.money_t := 0;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'une periode est un premier du mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'licence introuvable' using errcode = 'no_data_found';
  end if;

  -- R4 : l'émetteur est une donnée, pas une hypothèse. Sa devise est celle de
  -- la facture ; sa juridiction désigne le pack dont on lit le taux et le
  -- timbre.
  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'aucun pack de juridiction en vigueur pour l''emetteur (ref.jurisdiction_packs)'
      using errcode = 'no_data_found';
  end if;

  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack
     and r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack
     and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  -- Pas de valeur de repli. R4 jusqu'au bout : une facture émise sous un taux
  -- supposé serait fausse sans que personne ne le voie.
  if v_taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'aucun droit de timbre en vigueur (ref.socle_params, code facture.droit_de_timbre)'
      using errcode = 'no_data_found';
  end if;

  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  -- Une ligne par payeur. `order by payeur_type` fixe l'ordre — `cabinet`
  -- avant `titulaire` — pour que `facture_id` désigne toujours la même facture
  -- d'une exécution à l'autre.
  for l in
    select * from facturation.a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    -- Pas de repli (R4) : une facture sans destinataire nommé n'est pas une
    -- facture. On refuse, et on dit où le nom manque.
    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        'le destinataire % n''a pas de nom (identity.organizations.name ou identity.profiles.display_name)',
        coalesce(l.payeur_tenant_id, l.payeur_personne)
        using errcode = 'no_data_found';
    end if;

    v_tva    := round(l.montant_ht * v_taux, 3);
    v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
                || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

    insert into facturation.factures
      (licence_id, numero, periode, emise_le, echeance_le, offre_code,
       organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
       timbre, montant_ttc, devise,
       payeur_type, payeur_tenant_id, payeur_personne,
       destinataire_nom, destinataire_legal_id, reference_abonne)
    values
      (p_licence, v_numero, p_periode, current_date,
       current_date + p_jours_echeance, l.offre_code,
       c.organisations, v_sieges, l.montant_ht, v_taux, v_tva, v_timbre,
       l.montant_ht + v_tva + v_timbre, v_emetteur.currency,
       l.payeur_type, l.payeur_tenant_id, l.payeur_personne,
       v_nom, v_legal, l.acces_reference)
    returning id into v_id;

    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Abonnement ' || l.offre_code || ' — '
            || to_char(p_periode, 'TMMonth YYYY')
            || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
            1, l.montant_ht, l.montant_ht);

    if v_premiere is null then
      v_premiere := v_id;
      v_premier  := v_numero;
    end if;
    v_ttc    := v_ttc + l.montant_ht + v_tva + v_timbre;
    v_faites := v_faites || jsonb_build_object(
                  'facture_id', v_id, 'numero', v_numero,
                  'payeur_type', l.payeur_type,
                  'payeur', coalesce(l.payeur_tenant_id, l.payeur_personne),
                  'destinataire', v_nom,
                  'offre_code', l.offre_code,
                  'jours', l.jours, 'jours_du_mois', l.jours_du_mois,
                  'ht', l.montant_ht,
                  'ttc', l.montant_ht + v_tva + v_timbre);
  end loop;

  if jsonb_array_length(v_faites) = 0 then
    raise exception
      'rien a facturer sur cette licence pour % : aucun payeur sur la periode (facturation.a_facturer)',
      p_periode
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$$;

comment on function facturation.emettre(uuid, date, integer) is
  'Émet les factures d''une licence pour un mois : UNE PAR PAYEUR. Le cas '
  'Audicorp/Selim en produit deux — 19 DT HT au cabinet, 30 DT HT à la '
  'cliente — chacune avec son timbre, parce que le timbre est dû par facture. '
  '`factures` porte la réponse complète ; `facture_id` désigne la première.';

revoke all on function facturation.emettre(uuid, date, integer) from public, anon;
grant execute on function facturation.emettre(uuid, date, integer) to authenticated;

-- ===========================================================================
-- 18. `mon_forfait()` RÉPOND PAR ORGANISATION
-- ===========================================================================
--
-- Le défaut, mesuré : la fonction du 19 octobre finissait par
--
--     where l.titulaire = auth.uid() order by c.licence_id limit 1
--
-- soit « la première licence par ordre d'UUID ». Tant qu'un titulaire n'en
-- avait qu'une, c'était juste par accident. Le modèle en autorise désormais
-- PLUSIEURS — « on peut affecter une ou plusieurs licences au titulaire » — et
-- la fonction répondrait alors au hasard : un dirigeant de trois sociétés
-- verrait le forfait de l'une, sans savoir laquelle, et se croirait au plafond
-- pendant qu'il lui reste 200 lectures ailleurs.
--
-- Elle prend donc l'ORGANISATION. Et quand on ne la lui donne pas, elle ne
-- choisit pas : s'il n'y a qu'une réponse possible elle la rend, sinon elle
-- LÈVE. Un refus explicite est réparable ; un chiffre plausible et faux ne
-- l'est pas (R4).
--
-- ⚠ POUR L'APPELANT — et ce n'est pas corrigé ici, ce fichier ne touche pas au
-- web : `apps/web` interroge `mon_forfait()` sous la clé de cache
-- `["mon-forfait"]`, qui NE PORTE PAS le tenant. Deux sociétés du même
-- dirigeant partageraient donc une entrée de cache, et la seconde afficherait
-- les compteurs de la première. La clé doit devenir `["mon-forfait", tenant]`
-- et l'appel passer le tenant courant. Jusque-là, un titulaire à plusieurs
-- licences recevra l'exception ci-dessous plutôt qu'un chiffre faux — c'est le
-- comportement voulu.

drop function if exists public.mon_forfait();

create or replace function public.mon_forfait(p_tenant uuid default null)
returns table (
  licence_id uuid,
  tenant_id uuid,
  offre text, statut text,
  lectures_droit integer, lectures_consommees integer, lectures_restantes integer,
  organisations integer, sieges_occupes integer, sieges_inclus integer, sieges_max integer,
  prix_mensuel_ht numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_n       bigint;
begin
  -- 1. TITULAIRE : la ligne entière. C'est lui qui paie, il a droit au prix.
  if p_tenant is null then
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
     where l.titulaire = auth.uid();
  else
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where l.titulaire = auth.uid() and lo.tenant_id = p_tenant;
  end if;

  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce titulaire : precisez l''organisation (public.mon_forfait(p_tenant))'
      using errcode = '21000';
  end if;

  if v_n = 1 then
    return query
      select v_licence, p_tenant,
             c.offre_code, c.statut, c.lectures_droit, c.lectures_consommees,
             c.lectures_restantes, c.organisations, c.sieges_occupes,
             c.sieges_inclus::integer, c.sieges_max::integer,
             -- `prix_mensuel_ht` est un `app.money_t` depuis que `droits_v` le
             -- CASTE en domaine (section 12) ; la signature annonce `numeric`.
             -- Sans ce cast explicite, `return query` lève « structure of query
             -- does not match function result type » — mesuré à l'exécution.
             c.prix_mensuel_ht::numeric
        from facturation.consommation_v c
       where c.licence_id = v_licence;
    return;
  end if;

  -- 2. MEMBRE d'une organisation rattachée : le nom de l'offre et le compteur
  -- de lectures. Ce qui limite son travail le concerne ; ce que son employeur
  -- paie, non. Un membre de cabinet n'est membre que du cabinet : il ne lit
  -- pas le compteur de sa cliente.
  if p_tenant is null then
    select count(distinct lo.licence_id), (array_agg(distinct lo.licence_id))[1]
      into v_n, v_licence
      from facturation.licence_organisations lo
     where lo.tenant_id in (select app.member_orgs());
  else
    select count(distinct lo.licence_id), (array_agg(distinct lo.licence_id))[1]
      into v_n, v_licence
      from facturation.licence_organisations lo
     where lo.tenant_id = p_tenant
       and lo.tenant_id in (select app.member_orgs());
  end if;

  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce membre : precisez l''organisation (public.mon_forfait(p_tenant))'
      using errcode = '21000';
  end if;

  if v_n = 1 then
    return query
      select v_licence, p_tenant,
             c.offre_code, null::text, c.lectures_droit, c.lectures_consommees,
             c.lectures_restantes, null::integer, null::integer, null::integer,
             null::integer, null::numeric
        from facturation.consommation_v c
       where c.licence_id = v_licence;
  end if;

  return;
end
$$;

revoke all on function public.mon_forfait(uuid) from public, anon;
grant execute on function public.mon_forfait(uuid) to authenticated;

comment on function public.mon_forfait(uuid) is
  'Le forfait de l''appelant POUR UNE ORGANISATION. Titulaire : la ligne '
  'entière. Membre d''une organisation rattachée : le nom de l''offre et le '
  'compteur de lectures, le reste à null. Sans organisation, elle répond '
  's''il n''y a qu''une réponse possible, et lève sinon — elle ne choisit '
  'jamais une licence au hasard. Un AFFICHAGE : la décision d''une lecture se '
  'prend dans `lecture_autorisee`.';

-- ===========================================================================
-- 19. L'ISOLATION (R6)
-- ===========================================================================
--
-- Les sept tables du référentiel suivent le régime commun de `ref` : tout le
-- monde lit la grille, personne ne l'écrit depuis l'application — la tour
-- écrit, sous l'identité de la plateforme. La boucle est celle de
-- `20260830120000`, avec un `drop policy if exists` de plus : sans lui, le
-- rejeu du fichier échouerait sur « la politique existe déjà ».

do $$
declare
  t text;
begin
  foreach t in array array[
    'offre_codes', 'canaux', 'offres_par_canal',
    'forfait_motifs', 'fin_motifs', 'payeur_types', 'reference_abonne'
  ] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon, service_role', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('drop policy if exists %I on ref.%I', 'ref_' || t || '_sel', t);
    execute format(
      'create policy %I on ref.%I for select to authenticated using (true)',
      'ref_' || t || '_sel', t);
  end loop;
end $$;

-- `facturation.forfait_historique` ne porte pas de `tenant_id` : elle est
-- au-dessus du dossier, comme `facturation.licences`, et reçoit donc ses
-- politiques à la main. Son titulaire la lit, la plateforme aussi, personne
-- d'autre. L'écriture est ouverte aux deux — un client change de forfait
-- lui-même — et le `delete` est refusé par déclencheur, pas par politique :
-- un refus par déclencheur porte un message, une politique rend une table
-- vide.

alter table facturation.forfait_historique enable row level security;
alter table facturation.forfait_historique force row level security;
revoke all on table facturation.forfait_historique from public, anon, service_role;
grant select, insert, update on table facturation.forfait_historique to authenticated;

drop policy if exists facturation_forfait_historique_sel on facturation.forfait_historique;
create policy facturation_forfait_historique_sel on facturation.forfait_historique
  for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid()));

drop policy if exists facturation_forfait_historique_ins on facturation.forfait_historique;
create policy facturation_forfait_historique_ins on facturation.forfait_historique
  for insert to authenticated
  with check ((select app.is_platform())
              or licence_id in (select id from facturation.licences
                                 where titulaire = auth.uid()));

drop policy if exists facturation_forfait_historique_upd on facturation.forfait_historique;
create policy facturation_forfait_historique_upd on facturation.forfait_historique
  for update to authenticated
  using ((select app.is_platform())
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid()))
  with check ((select app.is_platform())
              or licence_id in (select id from facturation.licences
                                 where titulaire = auth.uid()));

-- `facturation.acces` porte `tenant_id` : le helper pose le régime commun —
-- RLS, `force`, révocations, index de lecture élargi aux mandats. Deux
-- politiques sont ensuite REPOSÉES, parce que le cas du cabinet sort du
-- régime : il écrit chez une organisation DONT IL N'EST PAS MEMBRE, et c'est
-- exactement ce qu'« ouvrir un accès pour une cliente » veut dire.

select app.enable_tenant_rls('facturation', 'acces', false, false);

drop policy if exists facturation_acces_sel on facturation.acces;
create policy facturation_acces_sel on facturation.acces
  for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or cabinet_tenant_id in (select app.member_orgs())
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid())
         or (select app.is_platform()));

drop policy if exists facturation_acces_ins on facturation.acces;
create policy facturation_acces_ins on facturation.acces
  for insert to authenticated
  with check (tenant_id in (select app.member_orgs())
              or cabinet_tenant_id in (select app.member_orgs())
              or (select app.is_platform()));

-- La cliente accepte ou révoque, le cabinet retire, la plateforme suspend.
-- Ce que chacun peut écrire est borné par les déclencheurs `acces_fige` et
-- `acces_legitime`, pas par cette politique : elle dit QUI touche la ligne,
-- eux disent CE QUI peut y changer.
drop policy if exists facturation_acces_upd on facturation.acces;
create policy facturation_acces_upd on facturation.acces
  for update to authenticated
  using (tenant_id in (select app.member_orgs())
         or cabinet_tenant_id in (select app.member_orgs())
         or (select app.is_platform()))
  with check (tenant_id in (select app.member_orgs())
              or cabinet_tenant_id in (select app.member_orgs())
              or (select app.is_platform()));

-- `facturation.abonnes` n'est écrite que par la base, depuis `acces_reference`
-- (`security definer`). Aucune politique d'écriture, donc, et aucun droit
-- d'`insert` : un numéro d'abonné ne se choisit pas.
alter table facturation.abonnes enable row level security;
alter table facturation.abonnes force row level security;
revoke all on table facturation.abonnes from public, anon, service_role;
grant select on table facturation.abonnes to authenticated;

drop policy if exists facturation_abonnes_sel on facturation.abonnes;
create policy facturation_abonnes_sel on facturation.abonnes
  for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or tenant_id in (select app.engaged_orgs())
         or (select app.is_platform()));

-- Les vues reposées ont perdu leurs droits avec le `drop view` : ils se
-- redonnent, sans quoi la tour de contrôle et les écrans de l'abonnement
-- s'arrêteraient sur un 42501 — c'est le défaut exact qu'a corrigé
-- `20260830120000`, et il se reproduit à chaque vue reposée.
grant select on facturation.droits_v, facturation.droits_reels_v,
                facturation.consommation_v to authenticated;
grant select on plateforme.clients_v to authenticated;

grant select on facturation.forfait_courant_v, facturation.places_v,
                facturation.periodes_v, facturation.payeurs_v,
                facturation.payeur_initial_v, facturation.payeur_courant_v,
                facturation.repartition_v to authenticated;

revoke all on function facturation.a_facturer(uuid, date) from public, anon;
revoke all on function facturation.a_facturer_cabinet(uuid, date) from public, anon;
revoke all on function facturation.trigramme(text) from public, anon;
revoke all on function facturation.reference_abonne(uuid, integer, uuid, date)
  from public, anon;
grant execute on function facturation.a_facturer(uuid, date) to authenticated;
grant execute on function facturation.a_facturer_cabinet(uuid, date) to authenticated;
grant execute on function facturation.trigramme(text) to authenticated;
grant execute on function facturation.reference_abonne(uuid, integer, uuid, date)
  to authenticated;

-- Et l'hygiène que `20261019150000` a posée en règle, tenue pour les
-- déclencheurs de CE fichier : une fonction qui retourne `trigger` n'est pas
-- une surface d'appel — PostgreSQL refuse « trigger functions can only be
-- called as triggers » — mais `execute` pour `public` reste un droit inutile,
-- et `schema.test.ts:486` le relève désormais sur les deux qui ÉCRIVENT dans
-- `facturation` (`acces_entretient_le_rattachement`, `licence_ouvre_son_historique`) :
-- une definer écrivant l'argent sans porte nommée. Elles n'ont pas de porte
-- parce qu'elles n'ont pas d'appelant ; le droit tombe, et l'épreuve retrouve
-- l'ensemble qu'elle garde — les fonctions APPELABLES. Le déclenchement ne
-- vérifie pas `execute` ; seul `create trigger` le fait, et ils existent déjà.
revoke all on function facturation.naissance_immuable() from public, anon;
revoke all on function facturation.periode_se_ferme_seulement() from public, anon;
revoke all on function facturation.forfait_fige() from public, anon;
revoke all on function facturation.forfait_sans_trou() from public, anon;
revoke all on function facturation.licence_ouvre_son_historique() from public, anon;
revoke all on function facturation.acces_legitime() from public, anon;
revoke all on function facturation.acces_reference() from public, anon;
revoke all on function facturation.acces_fige() from public, anon;
revoke all on function facturation.acces_entretient_le_rattachement() from public, anon;
revoke all on function facturation.facture_nomme_son_payeur() from public, anon;
revoke all on function facturation.rattachement_legitime() from public, anon;

commit;
