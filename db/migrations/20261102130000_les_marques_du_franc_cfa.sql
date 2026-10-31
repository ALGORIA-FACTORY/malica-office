-- Les marques imprimées du franc CFA (30 octobre 2026, revue de la PR 144).
--
-- `ref.devises_marques` ne portait que le dinar et l'euro. Une pièce de Dakar
-- écrit « 1 234 560 F CFA », « 1 234 560 FCFA » : « F CFA » n'étant pas une
-- marque connue, le montant était pris pour un texte, et ne se lisait pas.
-- Pire, rien ne disait que la pièce était en francs CFA. Une marque est celle
-- d'UNE devise : c'est ce qui permet de refuser une devise imprimée qui
-- contredit la devise lue (`deviseDeLaPiece`).
--
-- La comparaison ignore la casse, les points et les espaces : « F CFA »,
-- « F.CFA » et « FCFA » sont une même marque ; elles sont écrites telles
-- qu'on les imprime. « CFA » seul s'imprime aussi ; « XOF » est le code de
-- `ref.devises`, donc déjà une marque.
--
-- INCERTAIN : « CFA » désigne aussi le franc d'Afrique centrale (XAF), que le
-- référentiel ne porte pas. Le jour où il entre, « CFA » seul ne tranche plus
-- entre les deux, et cette ligne se revoit.

insert into ref.devises_marques (marque, devise) values
  ('F CFA',       'XOF'),
  ('F.CFA',       'XOF'),
  ('FCFA',        'XOF'),
  ('CFA',         'XOF'),
  ('FRANC CFA',   'XOF'),
  ('FRANCS CFA',  'XOF');
