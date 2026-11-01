-- Une référence nomme ce qui existe (audit d'intégrité de la base, 1er novembre 2026).
--
-- « Dans la base et tables aussi. Pas d'orphelins, pas de hardcoding, pas de
-- doublons. » L'audit (`apps/api/src/la-base-tient-son-integrite.test.ts`) a
-- relevé quatorze colonnes `uuid` `*_id` sans clé étrangère. Neuf désignent
-- une ligne qui doit exister tant que la leur existe : elles reçoivent ici leur
-- clé. Les cinq autres désignent, par construction, une ligne qui peut être
-- partie — leur raison est écrite dans `verrous/integrite-de-la-base.json` :
--   app.signalements.piece_id         un signalement de plantage survit à la pièce ;
--   audit.event_log.object_id         le journal survit à l'objet qu'il raconte,
--                                     et nomme sa table (vérifiée par l'audit) ;
--   capture.effacements_en_cours.*    nomme ce qui est EN TRAIN d'être effacé ;
--   facturation.lectures.piece_id     une lecture reste comptée quand la pièce part.
--
-- La personne : `auth.users`. Ce qui n'appartient qu'à elle (son profil, ses
-- préférences, ses appareils, ses avis et leurs lectures) part avec elle ; ce
-- qui engage une organisation ou la plateforme (une adhésion, un rôle
-- d'opérateur, un signalement) REFUSE qu'on la supprime en silence — une
-- organisation s'archive, une personne aussi (R7).
--
-- La portée d'une liaison de rôle (`portee` = cabinet ou dossier) est toujours
-- une organisation : `portee_id` la nomme, comme `tenant_id`.
--
-- Chaque clé est posée `not valid` puis validée : une base qui porterait déjà
-- un orphelin s'arrête ICI, sur le nom de la contrainte, au lieu de le garder.
--
-- Et une porte morte part : `ref.compte_du_role` résolvait le compte d'un rôle
-- (dossier, puis cabinet, puis pack) — et plus rien ne l'appelait. La même
-- résolution vit ailleurs (`app.nature_des_comptes`, `public.retenues_du_mois`,
-- et trois lectures de l'API) ; une copie que personne n'exécute est celle qui
-- diverge en silence. Les lecteurs restants sont nommés par l'audit.

begin;

drop function ref.compte_du_role(uuid, uuid, text, uuid);

alter table identity.profiles
  add constraint profiles_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;
alter table identity.profiles validate constraint profiles_user_id_fkey;

alter table notif.preferences
  add constraint preferences_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;
alter table notif.preferences validate constraint preferences_user_id_fkey;

alter table collab.push_devices
  add constraint push_devices_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;
alter table collab.push_devices validate constraint push_devices_user_id_fkey;

alter table collab.notifications
  add constraint notifications_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;
alter table collab.notifications validate constraint notifications_user_id_fkey;

alter table collab.notification_lectures
  add constraint notification_lectures_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;
alter table collab.notification_lectures validate constraint notification_lectures_user_id_fkey;

alter table identity.memberships
  add constraint memberships_user_id_fkey
  foreign key (user_id) references auth.users (id) not valid;
alter table identity.memberships validate constraint memberships_user_id_fkey;

alter table app.platform_operators
  add constraint platform_operators_user_id_fkey
  foreign key (user_id) references auth.users (id) not valid;
alter table app.platform_operators validate constraint platform_operators_user_id_fkey;

alter table app.signalements
  add constraint signalements_user_id_fkey
  foreign key (user_id) references auth.users (id) not valid;
alter table app.signalements validate constraint signalements_user_id_fkey;

alter table parametrage.role_bindings
  add constraint role_bindings_portee_id_fkey
  foreign key (portee_id) references identity.organizations (id) on delete cascade not valid;
alter table parametrage.role_bindings validate constraint role_bindings_portee_id_fkey;

-- Une clé étrangère sans index fait parcourir la table entière à chaque
-- suppression de la ligne qu'elle nomme.
create index if not exists notifications_user_idx on collab.notifications (user_id);
create index if not exists signalements_user_idx on app.signalements (user_id);
create index if not exists role_bindings_portee_id_idx on parametrage.role_bindings (portee_id);

-- --- Les natures de charge ont leurs mots dans les trois langues -----------------------
--
-- `20261007140000_vingt_natures_de_charge_et_leur_compte` a porté les natures
-- de charge de neuf à vingt et une ; les douze nouvelles n'ont reçu aucun
-- libellé. L'écran retombait sur la colonne française de `ref.charge_familles`
-- — « Assurances » au milieu d'un écran arabe. Le français reprend le libellé
-- du référentiel, mot pour mot.
insert into ref.labels (ns, key, locale, value)
select 'charge_famille', f.code, t.locale, coalesce(t.valeur, f.label)
  from ref.charge_familles f
  join (values
    ('MATIERES_PREMIERES',  'en', 'Raw materials'),
    ('MATIERES_PREMIERES',  'ar', 'مواد أولية'),
    ('ENERGIE_EAU',         'en', 'Energy and water'),
    ('ENERGIE_EAU',         'ar', 'طاقة وماء'),
    ('PETIT_EQUIPEMENT',    'en', 'Small equipment and tools'),
    ('PETIT_EQUIPEMENT',    'ar', 'معدّات وأدوات صغيرة'),
    ('SOUS_TRAITANCE',      'en', 'Subcontracting'),
    ('SOUS_TRAITANCE',      'ar', 'مناولة'),
    ('CHARGES_LOCATIVES',   'en', 'Rental and co-ownership charges'),
    ('CHARGES_LOCATIVES',   'ar', 'أعباء الكراء والملكية المشتركة'),
    ('ENTRETIEN',           'en', 'Maintenance and repairs'),
    ('ENTRETIEN',           'ar', 'صيانة وإصلاحات'),
    ('ASSURANCE',           'en', 'Insurance'),
    ('ASSURANCE',           'ar', 'تأمينات'),
    ('ETUDES',              'en', 'Studies and external services'),
    ('ETUDES',              'ar', 'دراسات وخدمات خارجية'),
    ('PERSONNEL_EXTERIEUR', 'en', 'External staff'),
    ('PERSONNEL_EXTERIEUR', 'ar', 'أعوان من خارج المؤسسة'),
    ('PUBLICITE',           'en', 'Advertising and communication'),
    ('PUBLICITE',           'ar', 'إشهار واتصال'),
    ('DEPLACEMENT',         'en', 'Travel and assignments'),
    ('DEPLACEMENT',         'ar', 'تنقّلات ومهمّات'),
    ('LOGICIELS',           'en', 'Software and licence fees'),
    ('LOGICIELS',           'ar', 'برمجيات وإتاوات'),
    ('MATIERES_PREMIERES',  'fr', null),
    ('ENERGIE_EAU',         'fr', null),
    ('PETIT_EQUIPEMENT',    'fr', null),
    ('SOUS_TRAITANCE',      'fr', null),
    ('CHARGES_LOCATIVES',   'fr', null),
    ('ENTRETIEN',           'fr', null),
    ('ASSURANCE',           'fr', null),
    ('ETUDES',              'fr', null),
    ('PERSONNEL_EXTERIEUR', 'fr', null),
    ('PUBLICITE',           'fr', null),
    ('DEPLACEMENT',         'fr', null),
    ('LOGICIELS',           'fr', null)
  ) as t (code, locale, valeur) on t.code = f.code
on conflict (ns, key, locale) do nothing;

commit;
