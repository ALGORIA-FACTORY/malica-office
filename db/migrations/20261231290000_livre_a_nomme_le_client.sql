-- « Livré à » nomme le client d'une facture (24 novembre 2026).
--
-- Banc sans IA du 24 novembre 2026 : sur 33 pièces, le sens achat/vente n'est pas dit,
-- « indices de sens contradictoires », alors que les deux matricules sont lus. Rejeu natif
-- d'algoria-001 : le matricule du dossier est imprimé sous « Livré à : », qui n'était un
-- repère que de l'adresse de livraison. Le moteur ne le plaçait donc pas au camp du client ;
-- seul un repli votait « achat », et la hauteur — le fournisseur imprime son matricule en
-- pied de page — votait « vente ». Prudent, le moteur se taisait, et la pièce appelait un
-- modèle.
--
-- Sur une facture, « Livré à » désigne le destinataire de la marchandise : l'acheteur. Le
-- repère est ajouté au champ `nom_client` des grilles `facture`, et à lui seul : la
-- raison sociale est un concept partagé par d'autres pièces (un bon de livraison a son
-- destinataire), qui ne changent pas. Rejoué avec ce repère, algoria-001 sort « achat »,
-- prouvé. C'est un défaut livré (R10) : l'expertise le retire sans migration.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_champs gc
   set reperes_fr = gc.reperes_fr || array['Livré à']
  from ref.grilles g
 where g.id = gc.grille_id and g.code = 'facture' and gc.code = 'nom_client'
   and not ('Livré à' = any (gc.reperes_fr));

commit;
