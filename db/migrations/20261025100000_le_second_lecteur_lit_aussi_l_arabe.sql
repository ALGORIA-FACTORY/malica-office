-- Le second lecteur lit aussi l'arabe : son nom complet a son tarif.
--
-- ============================================================== POURQUOI
--
-- 24 octobre 2026, banc de 48 pièces fictives (scan et photo, français, arabe,
-- bilingue, tickets, manuscrit) sur une RTX 5070 : le modèle latin lit les
-- montants à 100 % mais ne lit jamais un mot arabe ; le modèle arabe lit la
-- raison sociale arabe (100 % imprimée, 85 % manuscrite). Le service relit
-- donc chaque ligne en arabe quand `OCR_MODELE_RECONNAISSANCE_ARABE` est
-- posée, et il le dit dans le nom du relevé — les trois modèles, par leur nom
-- complet (R8).
--
-- `agents.model_pricing` cherche un tarif par ce NOM exact : sans cette
-- ligne, chaque relevé combiné serait refusé au journal, en silence — le
-- défaut déjà rencontré le 15 octobre avec un nom composé.
--
-- Zéro, souverain : le modèle tourne chez nous. R11 : date en littéral.

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
values
  ('interne', 'PP-OCRv5_mobile_det+latin_PP-OCRv5_mobile_rec+arabic_PP-OCRv5_mobile_rec', 'vision',
   0, 0, 'EUR', true, date '2026-10-24')
on conflict do nothing;
