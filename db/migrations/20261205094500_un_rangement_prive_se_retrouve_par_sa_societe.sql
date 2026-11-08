-- Un rangement privé se retrouve par sa société : la cascade a son index.
--
-- ================================================================== POURQUOI
--
-- `capture.rangements_prives` (20261203090000_l_espace_prive_a_ses_rayons)
-- porte `tenant_id references identity.organizations on delete cascade`. Le
-- seul index qui la nomme mène par `user_id` (`rangements_prives_user_idx`,
-- (user_id, tenant_id)) : l'effacement d'une société parcourrait la table
-- entière sous le verrou de la suppression. La garde posée par le lot D
-- (audit du 6 novembre 2026, § 3.5) l'a relevé à la réunion des branches,
-- le 8 novembre 2026 : on corrige à la racine, sans l'inscrire en exception.
--
-- _Gardé par_ apps/api/src/la-base-tient-son-integrite.test.ts, « chaque clé
-- étrangère qui efface en cascade a un index menant par ses colonnes ».

create index if not exists rangements_prives_tenant_idx on capture.rangements_prives (tenant_id);

-- ================================================================== RETOUR
--
-- La migration de retour, à jouer telle quelle (sans les « -- » de tête) :
--
-- drop index if exists capture.rangements_prives_tenant_idx;
-- delete from app.migrations where nom = '20261205094500_un_rangement_prive_se_retrouve_par_sa_societe.sql';
