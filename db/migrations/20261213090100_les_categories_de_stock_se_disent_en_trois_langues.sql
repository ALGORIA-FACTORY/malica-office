-- Les catégories de stock se disent en trois langues, accents compris
-- (recette du 11 novembre 2026, point 5.4).
--
-- Le pack TN 2026.1 a semé « Matieres premieres », sans accents, dans
-- `ref.stock_categories.label` (20260825221225), et l'écran le lisait tel
-- quel, dans toutes les langues. La ligne du pack ne se réécrit pas : le nom
-- de chaque catégorie s'ajoute à `ref.labels` (espace `stock_categorie`),
-- comme celui des catégories d'immobilisations, et le dépôt le lit dans la
-- langue demandée, le libellé du pack à défaut.
--
-- Rejouable (R11) : aucune date, aucune valeur tirée au sort.

insert into ref.labels (ns, key, locale, value) values
  ('stock_categorie', 'marchandises', 'fr', 'Marchandises'),
  ('stock_categorie', 'marchandises', 'en', 'Goods for resale'),
  ('stock_categorie', 'marchandises', 'ar', 'بضائع'),
  ('stock_categorie', 'matieres_premieres', 'fr', 'Matières premières'),
  ('stock_categorie', 'matieres_premieres', 'en', 'Raw materials'),
  ('stock_categorie', 'matieres_premieres', 'ar', 'مواد أولية'),
  ('stock_categorie', 'autres_appro', 'fr', 'Autres approvisionnements'),
  ('stock_categorie', 'autres_appro', 'en', 'Other supplies'),
  ('stock_categorie', 'autres_appro', 'ar', 'تموينات أخرى'),
  ('stock_categorie', 'encours', 'fr', 'En-cours de production'),
  ('stock_categorie', 'encours', 'en', 'Work in progress'),
  ('stock_categorie', 'encours', 'ar', 'إنتاج قيد الإنجاز'),
  ('stock_categorie', 'produits_finis', 'fr', 'Produits finis'),
  ('stock_categorie', 'produits_finis', 'en', 'Finished goods'),
  ('stock_categorie', 'produits_finis', 'ar', 'منتجات تامة الصنع')
on conflict (ns, key, locale) do nothing;
