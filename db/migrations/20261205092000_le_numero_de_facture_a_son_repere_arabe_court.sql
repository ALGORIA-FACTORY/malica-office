-- Le numéro de facture a son repère arabe court, « رقم » (« numéro »), comme « N° » en
-- français.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, banc sans IA : 33 numéros de facture lus, exacts, se taisaient. Les
-- factures arabes (gabarit C) impriment « فاتورة رقم » (« facture numéro ») — l'ordre inverse
-- du repère « رقم الفاتورة » (« numéro de la facture ») ; les bilingues (gabarit D)
-- impriment « N° / رقم » juste avant la valeur. Le repère français court « N° » existait ;
-- son pendant arabe, non.
--
-- ================================================================== CE QUI CHANGE
--
-- Le champ `numero_facture` des grilles qui portent le repère « N° » gagne « رقم » et
-- « فاتورة رقم ». Les mêmes règles d'ancrage s'appliquent : un repère plus long d'un autre
-- champ (« رقم الهاتف », le téléphone) l'emporte.
--
-- R10 : défaut livré, que l'expertise corrige. REJEU (R11) : aucune horloge n'écrit dans
-- `ref`.

begin;

update ref.grille_champs c
   set reperes_ar = coalesce(c.reperes_ar, '{}')
                    || array(select r from unnest(array['فاتورة رقم', 'رقم']) r
                              where not (r = any (coalesce(c.reperes_ar, '{}'))))
 where c.code = 'numero_facture'
   and 'N°' = any (c.reperes_fr);

do $$
begin
  if exists (select 1 from ref.grille_champs
              where code = 'numero_facture' and 'N°' = any (reperes_fr)
                and not ('رقم' = any (reperes_ar))) then
    raise exception 'numero_facture : le repère arabe court manque';
  end if;
end $$;

commit;
