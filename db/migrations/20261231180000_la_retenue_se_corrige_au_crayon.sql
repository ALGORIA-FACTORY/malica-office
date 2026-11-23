-- La retenue à la source se corrige au crayon, comme la TVA.
--
-- Pilote, 22 novembre 2026 : la facture MAP imprime « Retenue à la source 14,280 » et
-- « Net à payer 462,720 » ; la lecture ne les avait pas relevés, et rien ne permettait de
-- les dire. Le moteur sait juger une retenue déduite (HT + TVA + droits − retenue = net,
-- 21 novembre 2026) : `totals.withholding` devient un champ de lecture que la personne
-- précise, et le jugement le prend comme un montant imprimé (R3, R7).

begin;

create or replace function app.est_un_champ_de_lecture(p_champ text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_champ ~ ('^(totals\.(base_ht|vat|ttc|withholding)'
                    || '|other_charges\[[0-9]{1,3}\]\.amount'
                    || '|articles\[[0-9]{1,3}\]\.(designation|quantity|unit_price_ht|total_ht|tax_code))$')
$function$;

commit;
