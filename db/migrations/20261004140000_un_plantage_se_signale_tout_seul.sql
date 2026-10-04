-- Un plantage se signale tout seul.
--
-- `app.signalements` ne recevait que les gestes volontaires — « ça n'a pas
-- marché », envoyé depuis l'écran Réglages. Le 4 octobre 2026, l'application
-- installée a planté sur un téléphone et n'a laissé AUCUNE trace : le journal
-- d'atelier n'existe qu'en développement, Sentry n'a pas de DSN posé, et le
-- serveur n'a rien vu. Diagnostiquer revenait à deviner.
--
-- La table convient telle quelle : où, quelle version, quel appareil, le
-- message, la pile. Rien d'une pièce n'y entre, et c'est déjà sa règle. Il lui
-- manquait seulement de distinguer QUI parle — la personne, ou le programme.
--
-- Pourquoi une colonne et non une seconde table : l'exploitant lit UNE liste.
-- Deux tables, c'est une des deux qu'on oublie de regarder.
--
-- `personne` par défaut : les lignes déjà écrites viennent toutes d'un geste.

alter table app.signalements
  add column if not exists origine text not null default 'personne';

alter table app.signalements
  drop constraint if exists signalements_origine_check;

alter table app.signalements
  add constraint signalements_origine_check
  check (origine in ('personne', 'plantage'));

comment on column app.signalements.origine is
  'personne : un geste volontaire depuis l''application. '
  'plantage : la frontière d''erreur a rapporté toute seule, texte expurgé '
  'côté client (apps/web/src/lib/rapport-plantage.ts).';

-- L'exploitant cherche d'abord les plantages récents, et il les cherche
-- souvent : l'index existant ne mène que par la date.
create index if not exists signalements_origine_idx
  on app.signalements (origine, cree_le desc);
