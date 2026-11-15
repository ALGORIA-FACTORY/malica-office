-- Un envoi de l'application se lit avec l'accès d'aujourd'hui (revue de #402).
--
-- ================================================================== POURQUOI
--
-- L'ancien fil (`collab.notifications`) était protégé par sa politique : il
-- fallait être membre de la société, ou de la comptabilité engagée, AU MOMENT
-- de lire. Le moteur l'a remplacé par `notif.envois`, une ligne par
-- destinataire, dont la politique ne demandait que « c'est à moi »
-- (20261019150000). `notif.centre` exigeait bien l'accès actuel, mais une
-- fonction n'est pas une politique : la personne qui avait quitté la société,
-- ou dont le cabinet avait perdu le mandat, relisait encore ses lignes — et
-- leurs données — en lisant la table. Relevé par la revue automatique de #402
-- (P1) ; R6 veut l'isolation dans la base, pas dans l'application.
--
-- ================================================================== CE QUI SE FAIT
--
-- La politique de lecture exige ce que le centre exigeait : la ligne est à moi,
-- ET sa société est encore l'une des miennes (membre ou comptabilité engagée).
-- Une ligne sans société (un courriel d'inscription) reste à son destinataire.
-- L'accès perdu cache aussitôt ; retrouvé, il rend les lignes déjà écrites.
-- `notif.remises` suit : sa politique relit `notif.envois` sous la même règle.
--
-- REJEU (R11) : une politique, aucune donnée de référence.

alter policy notif_envois_sel on notif.envois
  using ((destinataire = (select auth.uid())
          and (tenant_id is null
               or tenant_id in (select app.member_orgs())
               or tenant_id in (select app.engaged_orgs())))
         or (select app.is_platform()));

-- L'index qui mène par `tenant_id` existe déjà (`envois_tenant_idx`, 20261019130000).
