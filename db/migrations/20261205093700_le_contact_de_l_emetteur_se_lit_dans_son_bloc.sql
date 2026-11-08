-- Le contact de l'émetteur se lit dans son bloc.
--
-- ================================================================== POURQUOI
--
-- 7 novembre 2026, banc sans IA : `telephone_email_emetteur` ne s'était jamais lu — aucune
-- valeur juste sur 411 pièces. La famille « tiers » n'a pas d'expert à libellé : un
-- « Tél : » appartient aussi bien au client (« Tel: » sous « Livré à », algoria-001)
-- qu'à l'émetteur. Une fois le sens prouvé, le bloc de l'émetteur est connu : c'est
-- celui de son matricule.
--
-- ================================================================== CE QUI CHANGE
--
-- La preuve `parties` gagne `contact_emetteur` : les lignes du bloc de l'émetteur — alignées
-- sur le bord gauche du segment qui porte son matricule — qui s'ouvrent sur un repère du
-- champ (« Tél », « Fax », « E-mail »), et dont le reste porte un chiffre ou un « @ ».
-- Affirmé (`conforme`) par la couche de texte exacte ou une lecture assurée, sinon signalé
-- (`packages/sudoku/src/entete.rs`).
--
-- Les repères du champ gagnent les écritures du banc : « Email » (sans trait d'union),
-- « Téléphone », « GSM ». « Tél. », avec son point, se lit par le repère « Tél ».
--
-- R10 : défaut livré. REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = p.expression
                    || jsonb_build_object('contact_emetteur', 'telephone_email_emetteur')
 where p.expression ->> 'op' = 'parties'
   and not p.expression ? 'contact_emetteur'
   and exists (select 1 from ref.grille_champs c
                where c.grille_id = p.grille_id and c.code = 'telephone_email_emetteur');

update ref.grille_champs c
   set reperes_fr = c.reperes_fr
                    || array(select r from unnest(array['Email', 'Téléphone', 'GSM']) r
                              where not (r = any (c.reperes_fr)))
 where c.code = 'telephone_email_emetteur';

commit;
