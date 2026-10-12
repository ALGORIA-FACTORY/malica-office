-- La RLS laisse le cabinet répondre — parce que la fonction ne suffit pas.
--
-- ================================================================= POURQUOI
--
-- `20261012160000` a ouvert `charge_question_answer` aux mandats actifs, et la
-- réponse de l'expert était toujours refusée :
--
--   « la nouvelle ligne viole la politique de sécurité au niveau ligne pour la
--     table charge_questions »
--
-- La fonction est `security invoker` — volontairement : c'est ce qui fait que
-- la RLS décide, et non le code. Son contrôle interne autorisait donc l'expert,
-- et la POLITIQUE d'insertion, elle, reste membre-seulement.
--
-- C'est exactement ce que R6 dit, et dans le bon sens : une règle d'accès qui
-- ne vit que dans une fonction se contourne par un appel direct. Elle doit
-- vivre dans la base.
--
-- =============================================== LA FORME EST DÉJÀ CELLE DU PRODUIT
--
-- `20260825211034` a réglé le même problème pour les écritures, les pièces, la
-- conformité et les notifications : une politique NOMMÉE, pour le cabinet,
-- bornée aux lignes `partage` d'un dossier sous mandat actif. On la reprend
-- telle quelle. Rien d'élargi : l'expert ne peut répondre que sur un dossier
-- dont il a le mandat, et seulement sur une question partagée.

create policy charge_questions_ins_cabinet on collab.charge_questions
  for insert to authenticated
  with check (
    vis = 'partage'::app.vis_t
    and tenant_id in (select app.engaged_orgs())
  );

comment on table collab.charge_questions is
  'Les écarts de consommation que Malica relève, et les réponses. En ajout '
  'seul : chaque réponse est une ligne de plus, numérotée par `seq`, et la '
  'dernière vaut. L''expert sous mandat actif peut répondre comme le '
  'dirigeant, et `answered_side` dit lequel des deux a parlé — « exceptionnel » '
  'dit par l''expert est un avis professionnel, dit par le dirigeant une '
  'déclaration.';
