-- Un champ de ligne n'est pas un champ de la pièce.
--
-- Banc sans IA du 4 novembre 2026 : sept valeurs inventées avaient une seule cause. La
-- quantité d'un avoir, l'unité d'un bon de livraison, le kilométrage d'une note de frais,
-- les abstentions d'un procès-verbal, la date, la valeur et le chèque d'un relevé bancaire
-- sont des champs d'une parcelle RÉPÉTÉE — une occurrence par ligne, par résolution, par
-- mouvement. Le moteur les lisait comme des champs uniques : la première cellule de la
-- colonne devenait « la quantité » de la pièce. Rien ne disait qu'une parcelle se répète.
--
-- `repetee` le dit. Le moteur ne lit pas un champ répété hors d'une preuve de lignes qui
-- en lit toutes les occurrences. Classement fait parcelle par parcelle, à la main, sur
-- leurs noms (« Lignes… », « une par … », « une occurrence par … », échéanciers,
-- tableaux d'amortissement) ; « Lignes et totaux » (totaux mêlés) et « Historique des
-- inscriptions » restent uniques.

alter table ref.grille_champs add column if not exists repetee boolean not null default false;

update ref.grille_champs
   set repetee = true
 where not repetee
   and parcelle in (
     'Lignes', 'Lignes de loyer', 'lignes_salaries', 'articles',
     'Lignes d''échéance (une par échéance)', 'echeancier', 'lignes_bien',
     'Lignes d''opérations (une par mouvement)', 'Lignes d''émargement (une par associé)',
     'Résolutions (une occurrence par résolution)', 'Délibérations (une occurrence par décision)',
     'tableau_immobilisations', 'lignes_compte', 'Lignes de dépense', 'lignes_articles',
     'ligne_salarie', 'tableau_amortissement', 'lignes_ecriture', 'plan_amortissement'
   );

-- Ajoutée À LA FIN : `create or replace view` refuse tout autre changement.
create or replace view public.ref_grille_champs_v with (security_invoker = true) as
  select id, grille_id, parcelle, code, libelle, type, obligatoire, condition, reperes_fr,
         reperes_ar, format_code, groupe, fondement, source_fondement, statut, concept_id, role,
         repetee
    from ref.grille_champs;

revoke all on table public.ref_grille_champs_v from public, anon, service_role;
grant select on table public.ref_grille_champs_v to authenticated;
