-- ======================================================================
--  Les obligations déclaratives s'écrivent avec leurs accents (staging,
--  5 novembre 2026).
--
--  L'écran « Échéances » du cabinet cite `ref.fiscal_obligations` tel quel :
--  « Declaration mensuelle TVA », « Reversement des retenues a la source »,
--  « 15e jour du mois suivant le trimestre echu ». Le semis
--  (20260831120700) avait écrit les 43 obligations sans accents.
--
--  Texte seul — `libelle` et `echeance_regle` ; ni code, ni jour, ni
--  périodicité, ni référence légale ne change. Le remplacement porte sur des
--  mots entiers, d'une liste fermée : c'est une fonction des seules valeurs
--  livrées, et elle rend le même référentiel quel que soit le jour (R11).
--
--  Les copies déjà posées dans le calendrier des dossiers se corrigent
--  pareillement (ci-dessous).
--
--  NON TRAITÉ ICI : ces obligations n'ont aucun libellé traduit (`ref.labels`)
--  — l'écran arabe les lit en français. Leur traduction juridique est un
--  travail à part, à faire relire.
-- ======================================================================

begin;

update ref.fiscal_obligations
   set libelle = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(libelle, '\mDeclaration\M', 'Déclaration', 'g'), '\mdeclaration\M', 'déclaration', 'g'), '\mDepot\M', 'Dépôt', 'g'), '\ma\M', 'à', 'g'), '\mannee\M', 'année', 'g'), '\maout\M', 'août', 'g'), '\mcloture\M', 'clôture', 'g'), '\mdecembre\M', 'décembre', 'g'), '\mdeces\M', 'décès', 'g'), '\mdefinitive\M', 'définitive', 'g'), '\mdelais\M', 'délais', 'g'), '\mdeliberations\M', 'délibérations', 'g'), '\mdepart\M', 'départ', 'g'), '\mechu\M', 'échu', 'g'), '\metablissements\M', 'établissements', 'g'), '\mfacturees\M', 'facturées', 'g'), '\mfevrier\M', 'février', 'g'), '\ml''activite\M', 'l''activité', 'g'), '\ml''impot\M', 'l''impôt', 'g'), '\mmemes\M', 'mêmes', 'g'), '\mprecede\M', 'précède', 'g'), '\mrealisation\M', 'réalisation', 'g'), '\mresultats\M', 'résultats', 'g'), '\msiege\M', 'siège', 'g'),
       echeance_regle = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(echeance_regle, '\mDeclaration\M', 'Déclaration', 'g'), '\mdeclaration\M', 'déclaration', 'g'), '\mDepot\M', 'Dépôt', 'g'), '\ma\M', 'à', 'g'), '\mannee\M', 'année', 'g'), '\maout\M', 'août', 'g'), '\mcloture\M', 'clôture', 'g'), '\mdecembre\M', 'décembre', 'g'), '\mdeces\M', 'décès', 'g'), '\mdefinitive\M', 'définitive', 'g'), '\mdelais\M', 'délais', 'g'), '\mdeliberations\M', 'délibérations', 'g'), '\mdepart\M', 'départ', 'g'), '\mechu\M', 'échu', 'g'), '\metablissements\M', 'établissements', 'g'), '\mfacturees\M', 'facturées', 'g'), '\mfevrier\M', 'février', 'g'), '\ml''activite\M', 'l''activité', 'g'), '\ml''impot\M', 'l''impôt', 'g'), '\mmemes\M', 'mêmes', 'g'), '\mprecede\M', 'précède', 'g'), '\mrealisation\M', 'réalisation', 'g'), '\mresultats\M', 'résultats', 'g'), '\msiege\M', 'siège', 'g');

-- Les échéances déjà posées portent une COPIE du libellé (`schedule.echeances.label`,
-- écrite à la génération du calendrier) : on la corrige de la même façon, pour
-- les seules échéances qui viennent du référentiel. Les obligations propres
-- d'un cabinet (`collab.obligations_propres`) sont sa saisie : on n'y touche pas.
update schedule.echeances
   set label = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(label, '\mDeclaration\M', 'Déclaration', 'g'), '\mdeclaration\M', 'déclaration', 'g'), '\mDepot\M', 'Dépôt', 'g'), '\ma\M', 'à', 'g'), '\mannee\M', 'année', 'g'), '\maout\M', 'août', 'g'), '\mcloture\M', 'clôture', 'g'), '\mdecembre\M', 'décembre', 'g'), '\mdeces\M', 'décès', 'g'), '\mdefinitive\M', 'définitive', 'g'), '\mdelais\M', 'délais', 'g'), '\mdeliberations\M', 'délibérations', 'g'), '\mdepart\M', 'départ', 'g'), '\mechu\M', 'échu', 'g'), '\metablissements\M', 'établissements', 'g'), '\mfacturees\M', 'facturées', 'g'), '\mfevrier\M', 'février', 'g'), '\ml''activite\M', 'l''activité', 'g'), '\ml''impot\M', 'l''impôt', 'g'), '\mmemes\M', 'mêmes', 'g'), '\mprecede\M', 'précède', 'g'), '\mrealisation\M', 'réalisation', 'g'), '\mresultats\M', 'résultats', 'g'), '\msiege\M', 'siège', 'g')
 where kind in (select code from ref.fiscal_obligations);

-- Les catégories d'immobilisation, de même (« Materiel informatique »,
-- « Materiel de transport ») : le libellé seul, sur toutes les versions du pack.
update ref.immo_categories
   set label = regexp_replace(label, '\mMateriel\M', 'Matériel', 'g')
 where label ~ '\mMateriel\M';

commit;
