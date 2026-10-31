-- Le séparateur décimal d'une devise vit en table (30 octobre 2026).
--
-- ========================================================== LE CONSTAT
--
-- Deux lecteurs de montants lisaient les mêmes textes, et se contredisaient
-- sur 107 des 548 textes du corpus du dépôt. Le plus fréquent : « 100,000 ».
--
--   - la lecture au plan de jetons (`malica/lecture/montants.ts`) le lisait
--     100 dinars, parce qu'un commentaire y affirmait que « la virgule ne
--     sépare jamais les milliers en Tunisie » — une règle de juridiction
--     écrite en TypeScript, que R4 interdit ;
--   - la normalisation du scan (`scan/normaliser-montants.ts`) le lisait
--     100 ou 100 000, et laissait l'arithmétique de la facture trancher.
--
-- Il n'y a plus qu'un lecteur (`packages/socle/src/montant-imprime.ts`). La
-- règle qu'il applique est une donnée de la devise : son séparateur décimal
-- n'est un séparateur de milliers que si ses groupes de trois chiffres ne
-- peuvent pas en être les décimales. « 100,000 » vaut 100 dinars ;
-- « 1,000 » vaut 1,00 euro ou 1 000 euros, et l'arithmétique tranche.
--
-- La virgule pour les trois devises du référentiel : c'est l'écriture des
-- pièces tunisiennes, et des pièces en euros et en francs CFA qu'elles
-- reçoivent. Une devise dont les pièces écrivent le point se déclare ici,
-- sans toucher au lecteur.
--
-- Aucune valeur par défaut : une devise ajoutée sans séparateur échoue à
-- l'insertion, au lieu d'être lue avec celui d'une autre (R4, corollaire).

alter table ref.devises add column separateur_decimal text;

update ref.devises set separateur_decimal = ',' where code in ('TND', 'EUR', 'XOF');

alter table ref.devises
  alter column separateur_decimal set not null,
  add constraint devises_separateur_decimal_check check (separateur_decimal in (',', '.'));

comment on column ref.devises.separateur_decimal is
  'Le séparateur décimal des montants imprimés dans cette devise : il ne sépare des milliers '
  'que si ses groupes de trois chiffres ne peuvent pas être des décimales de la devise.';
