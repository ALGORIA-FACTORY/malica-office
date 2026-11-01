-- Le lecteur rapide a son tarif : les mêmes poids, exécutés par onnxruntime.
--
-- ============================================================== POURQUOI
--
-- 1er novembre 2026, décision du dirigeant : le service OCR lit d'abord avec
-- onnxruntime (`OCR_MOTEUR=onnx`), et Paddle reste pour la relecture lourde
-- de nuit. Banc du même jour sur 150 pièces fictives (docs/exploitation.md,
-- section OCR) : mêmes pièces prouvées par le Sudoku, aucune fausse preuve,
-- quatre fois plus vite par page.
--
-- Les POIDS sont les mêmes — PP-OCRv5_mobile_det, latin_PP-OCRv5_mobile_rec,
-- arabic_PP-OCRv5_mobile_rec, vérifiés par empreinte (`infra/ocr/poids.json`)
-- et convertis en ONNX à la construction de l'image. Le MOTEUR ne l'est pas :
-- deux moteurs ne rendent pas des relevés identiques à l'octet. Le service le
-- dit donc dans le nom du relevé (suffixe `@onnx`), et le journal compte les
-- deux lecteurs séparément — c'est le chiffre qui dira si la relecture de nuit
-- rattrape quelque chose.
--
-- `agents.model_pricing` cherche un tarif par ce NOM exact : sans ces lignes,
-- chaque relevé du lecteur rapide serait refusé au journal, en silence.
-- L'accord entre les noms que le service peut rendre et cette table est
-- vérifié par `infra/ocr/tarif.test.mjs`.
--
-- Zéro, souverain : le modèle tourne chez nous. R11 : date en littéral.

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
values
  ('interne', 'PP-OCRv5_mobile_det+latin_PP-OCRv5_mobile_rec@onnx', 'vision',
   0, 0, 'EUR', true, date '2026-11-01'),
  ('interne', 'PP-OCRv5_mobile_det+latin_PP-OCRv5_mobile_rec+arabic_PP-OCRv5_mobile_rec@onnx', 'vision',
   0, 0, 'EUR', true, date '2026-11-01')
on conflict do nothing;
