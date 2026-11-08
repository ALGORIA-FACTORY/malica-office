-- Le titre d'une pièce a son domaine : le type de document se lit en un code.
--
-- Depuis `20261205090100`, un champ « liste » sans domaine ne rend plus de valeur :
-- ses repères mêlent étiquettes et valeurs (banc sans IA du 4 novembre 2026 :
-- « Statut », « Régime », « Motif » rendus comme valeurs). Le type de document de la
-- facture est une liste dont les repères SONT des titres : il reçoit son domaine,
-- les titres imprimés d'une pièce, en trois langues. Un titre double (« Bon de
-- Livraison/Facture ») porte deux codes : le moteur le signale, il ne choisit pas.
--
-- Les formes sont la PRATIQUE des pièces (`source`) ; le cabinet en ajoute sans
-- déploiement.

update ref.concepts set domaine = 'titre_de_piece' where code = 'type_document' and domaine is distinct from 'titre_de_piece';

insert into ref.formes_des_valeurs (pack_version_id, domaine, code, forme, source, valid_from)
select p.id, 'titre_de_piece', f.code, f.forme, 'pratique : titres imprimés des pièces', date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('facture', 'Facture'), ('facture', 'فاتورة'), ('facture', 'Invoice'),
   ('facture_globale', 'Facture globale'),
   ('avoir', 'Avoir'), ('avoir', 'Facture d''avoir'), ('avoir', 'إشعار دائن'), ('avoir', 'Credit note'),
   ('note_honoraires', 'Note d''honoraires'), ('note_honoraires', 'مذكرة أتعاب'),
   ('bon_livraison', 'Bon de livraison'), ('bon_livraison', 'وصل تسليم'),
   ('facture_proforma', 'Facture proforma'), ('facture_proforma', 'Proforma'), ('facture_proforma', 'Pro forma'),
   ('devis', 'Devis'),
   ('ticket_caisse', 'Ticket de caisse'),
   ('recu', 'Reçu'), ('recu', 'وصل'),
   ('quittance', 'Quittance')
 ) as f(code, forme)
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, domaine, code, forme, valid_from) do nothing;
