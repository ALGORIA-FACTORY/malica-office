-- Un avoir se dit aussi en arabe (31 octobre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Mesuré sur le jeu synthétique (outils/jeu-synthetique, cas 047) : un avoir
-- titré « إشعار دائن », aux montants positifs, recevait une écriture d'ACHAT.
-- `ref.titres_de_piece` (20261102120000) ne connaissait que des titres
-- français : « AVOIR » se refusait, son équivalent arabe passait pour une
-- facture. C'est le pire résultat — une écriture proposée, et fausse.
--
-- ================================================================ CE QUI CHANGE
--
-- Un titre de plus, au même statut que l'avoir français : le cabinet le
-- saisit (`anomalie`), jamais un achat ne se propose. Le motif est lu sans
-- casse par `new RegExp(motif, "iu")` (controles.ts) ; `\b` n'y est pas
-- employé, il ne connaît que les lettres latines.
--
-- INCERTAIN : « إشعار دائن » est le terme comptable usuel de l'avoir ; les
-- variantes employées par les éditeurs tunisiens (« فاتورة تعديلية »,
-- « إشعار بالتخفيض »…) restent à relever sur des pièces réelles et à
-- confirmer par un expert-comptable avant d'être ajoutées.
--
-- REJEU (R11) : aucune date ; `on conflict do nothing` sur la clé du motif.

begin;

insert into ref.titres_de_piece (motif, document_type, statut, refus, rang) values
  ('إشعار\s+دائن', 'avoir', 'anomalie',
   'Avoir : à saisir par le cabinet (titre « {titre} »).', 6)
on conflict (motif) do nothing;

commit;
