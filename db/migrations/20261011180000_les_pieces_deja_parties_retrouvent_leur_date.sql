-- Les pièces déjà parties retrouvent leur date d'envoi.
--
-- ================================================================= POURQUOI
--
-- `20261011100000` a créé `capture.pieces.transmise_le` et laissé NULLES les
-- pièces déjà transmises, en écrivant ceci :
--
--   « Leur donner la date du jour les ferait TOUTES entrer dans la
--     déclaration du mois courant, ce qui est faux et invisible. »
--
-- C'était juste, et incomplet. J'avais conclu « à reprendre avec les yeux du
-- comptable », alors que la base PORTE la réponse : chaque passage au partage
-- est inscrit dans `audit.event_log` depuis le 25 août.
--
-- Conséquence du vide : l'écran de TVA restait à zéro pour toutes les pièces
-- existantes, et le commanditaire a signalé « la TVA est cassée ». Elle ne
-- l'était pas — elle n'avait aucune pièce datée à ranger.
--
-- ============================================ DEUX FAITS, ET AUCUNE SUPPOSITION
--
-- 1. La pièce est passée par `piece_definir_visibilite`. L'audit porte
--    l'instant exact. On prend le DERNIER passage à « partage » : si elle a
--    été rappelée puis renvoyée, c'est la dernière transmission qui décide de
--    la déclaration.
--
-- 2. La pièce n'a aucun événement et elle est partagée. Elle ne peut l'être
--    que d'une façon : la capture la marquait « partage » d'office, défaut
--    retiré le 7 octobre. Son instant de transmission EST son instant de
--    création — c'est un fait, pas une approximation.
--
-- Aucune pièce ne reçoit une date inventée. Celle qui ne relève d'aucun des
-- deux cas n'existe pas : une pièce non partagée n'a pas à être datée.
--
-- ===================================================================== R11
--
-- Aucune donnée de référence n'est touchée, et aucune date du jour n'est
-- écrite : les valeurs posées viennent de l'audit et de `created_at`, qui
-- sont des faits déjà inscrits.
--
-- ========================================= POURQUOI UNE MIGRATION, ET PAS UN SCRIPT
--
-- Parce qu'elle doit se jouer partout, une fois, dans le même ordre que le
-- reste — et parce qu'un script lancé à la main sur un serveur n'est relu
-- par personne.

-- --- 1. Celles dont l'audit garde la trace ----------------------------------------------------

update capture.pieces p
   set transmise_le = e.quand
  from (
    -- La colonne de l'audit s'appelle `at`, pas `created_at`.
    select object_id, max(at) as quand
      from audit.event_log
     where action = 'piece.vis_changed'
       and object_schema = 'capture'
       and object_table = 'pieces'
       and payload->>'to' = 'partage'
     group by object_id
  ) e
 where p.id = e.object_id
   and p.vis = 'partage'
   and p.transmise_le is null;

-- --- 2. Celles qui sont parties à la photo ----------------------------------------------------
--
-- Pas d'événement, et pourtant partagées : elles l'ont été à la capture, au
-- temps où `capture_piece_register` recevait « partage ». Leur transmission
-- et leur création sont le même instant.

update capture.pieces
   set transmise_le = created_at
 where vis = 'partage'
   and transmise_le is null;

-- --- 3. Et une pièce non partagée n'est datée pour rien ---------------------------------------
--
-- Ceinture : si un jour une date se posait sur une pièce gardée au coffre,
-- elle entrerait dans une déclaration que personne n'a déclenchée.

update capture.pieces
   set transmise_le = null
 where vis <> 'partage'
   and transmise_le is not null;
