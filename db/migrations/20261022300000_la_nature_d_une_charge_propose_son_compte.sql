-- La nature d'une charge propose son compte (20 octobre 2026).
--
-- Recette de la comptabilité : une facture d'honoraires, un loyer, une
-- facture STEG partaient tous au 601 « Achats stockés — matières premières ».
-- Le 7 octobre, `ref.charge_familles.main_account` a été renseigné pour les
-- vingt natures, mais laissé DOCUMENTAIRE : rien ne le lisait.
--
-- Désormais la PROPOSITION d'écriture le lit, à une condition stricte :
-- tous les articles de la pièce sont reconnus dans la MÊME nature, par leur
-- libellé. Une pièce mêlée, ou non classée, garde le compte du paramétrage
-- (`ref.account_mappings`) — on ne devine pas.
--
-- Ce n'est qu'une proposition : l'expert-comptable la valide ou la corrige
-- (`corrigerLImputation`), comme avant. Le référentiel reste un défaut livré,
-- daté et surchargeable (R10).
--
-- Ici : la vue publique expose `main_account` (ajouté en fin de liste, ce que
-- `create or replace view` permet), en gardant `security_invoker`.
--
-- REJEU (R11) : `create or replace view`.

begin;

create or replace view public.ref_charge_familles_v
  with (security_invoker = true) as
select id, pack_version_id, code, label, ordinal, is_fallback, valid_from, valid_to, main_account
  from ref.charge_familles;

commit;
