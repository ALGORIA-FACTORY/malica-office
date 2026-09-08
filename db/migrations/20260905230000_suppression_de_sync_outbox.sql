-- =====================================================================================
--  Malica Office — La table sync.outbox s'en va.
--
--  POURQUOI : elle avait été prévue pour une file côté serveur, et personne ne
--  l'a jamais écrite ni lue — aucun dépôt, aucun outil. La file hors ligne du
--  téléphone vit côté client, par nature : elle existe pour quand le serveur est
--  injoignable. Ce que le serveur garantit, il le garantit déjà ailleurs —
--  `capture.pieces (tenant_id, idempotency_key)` est unique, et rejouer un
--  enregistrement rend la même pièce.
--
--  Une table sous RLS que rien n'alimente est un placeholder au sens de R9. Le
--  schéma se corrige par migration, jamais à la main.
--
--  Idempotent.
-- =====================================================================================

drop table if exists sync.outbox;
drop schema if exists sync;
